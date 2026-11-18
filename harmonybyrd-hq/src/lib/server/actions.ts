"use server";

/**
 * Server actions for the governance screens. Every action re-authenticates the session and
 * calls the same service functions as the API, so the browser has no privileged path.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/current";
import { claimsFor, isFounderSession } from "@/lib/auth/principal";
import { issueToken } from "@/lib/auth/secrets";
import { audit, writeAs } from "./db";
import { HqError } from "./errors";
import { getProposal, recordFounderDecision, reviewProposal, submitChangeProposal, submitDefectReport, withdrawProposal } from "./services";
import { getDataset } from "./store";

export interface ActionState {
  ok?: boolean;
  error?: string;
  detail?: string[];
  message?: string;
  token?: string;
}

function failure(error: unknown): ActionState {
  if (error instanceof HqError) {
    const detail = Array.isArray(error.detail) ? (error.detail as unknown[]).map(String) : undefined;
    return { error: error.message, detail };
  }
  // Redirects are signalled by throwing; let them through.
  if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
    throw error;
  }
  return { error: "Unexpected error. Nothing was changed." };
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

/** The proposal's status now, or null if it cannot be read. Used after a refusal to tell "already closed" apart from other refusals. */
async function currentStatus(principal: Awaited<ReturnType<typeof requireSession>>, id: string): Promise<string | null> {
  try {
    return (await getProposal(principal, id)).status;
  } catch {
    return null;
  }
}

/**
 * The founder's review. The proposal page renders the review form only while the proposal is open,
 * so a result shown inside the form would vanish with it (ui-5). Instead, every outcome that closes
 * the proposal redirects to its page with the outcome in the address, where the closed panel shows it:
 * `?done=<decision>` when this review was applied, `?refused=<decision>` when the proposal had
 * already been closed by someone else (for example in another tab). A refusal that leaves the
 * proposal open (a quotation that no longer verifies, a founder acceptance on the target) is
 * returned to the form, which is still on the page.
 */
export async function reviewProposalAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const principal = await requireSession();
  const id = text(form, "proposal_id");
  const decision = text(form, "decision");
  if (decision !== "accept" && decision !== "reject" && decision !== "needs_changes") return { error: "Choose accept, ask for changes or reject." };
  let outcome: "done" | "refused";
  try {
    await reviewProposal(principal, id, decision, text(form, "note") || undefined);
    outcome = "done";
  } catch (error) {
    // Accepting a stale proposal marks it stale and then reports the conflict: that is this review's own outcome.
    const markedStale = error instanceof HqError && (error.detail as { marked?: unknown } | undefined)?.marked === "stale";
    if (markedStale) {
      outcome = "done";
    } else if ((await currentStatus(principal, id)) !== "submitted" && error instanceof HqError && error.status === 409) {
      outcome = "refused";
    } else {
      return failure(error);
    }
  }
  revalidatePath("/", "layout");
  redirect(`/proposals/${encodeURIComponent(id)}?${outcome}=${decision}`);
}

/** Withdrawal by the submitter. Like the review, the outcome is shown on the closed proposal's page. */
export async function withdrawProposalAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const principal = await requireSession();
  const id = text(form, "proposal_id");
  let outcome: "done" | "refused";
  try {
    await withdrawProposal(principal, id, text(form, "note") || undefined);
    outcome = "done";
  } catch (error) {
    if ((await currentStatus(principal, id)) !== "submitted" && error instanceof HqError && error.status === 409) {
      outcome = "refused";
    } else {
      return failure(error);
    }
  }
  revalidatePath("/", "layout");
  redirect(`/proposals/${encodeURIComponent(id)}?${outcome}=withdraw`);
}

export async function recordDecisionAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const principal = await requireSession();
  const effects: unknown[] = [];
  const effectType = text(form, "effect_type");
  if (effectType === "set_requirement_disposition") {
    effects.push({ type: effectType, requirement_id: text(form, "effect_record_id"), disposition: text(form, "effect_disposition") });
  } else if (effectType === "set_acceptance") {
    effects.push({
      type: effectType,
      record_type: text(form, "effect_record_type"),
      record_id: text(form, "effect_record_id"),
      state: text(form, "effect_state"),
      scope_note: text(form, "effect_scope_note") || undefined,
    });
  }
  const resolves = text(form, "resolves")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const moduleIds = text(form, "module_ids")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let decisionId: string;
  try {
    const result = await recordFounderDecision(principal, {
      title: text(form, "title"),
      exact_text: text(form, "exact_text"),
      rationale: text(form, "rationale") || undefined,
      effects,
      resolves,
      module_ids: moduleIds,
      commission_ref: text(form, "commission_ref") || undefined,
    });
    decisionId = String(result.decision_id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect(`/records/decision/${decisionId}`);
}

export async function submitProposalAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const principal = await requireSession();
  const mode = text(form, "mode");
  let proposalId: string;
  try {
    const head = (await getDataset(principal)).head;
    if (mode === "defect") {
      const result = await submitDefectReport(principal, {
        title: text(form, "title"),
        description: text(form, "rationale"),
        module_ids: text(form, "module_ids")
          .split(/[\s,]+/)
          .filter(Boolean),
        severity: text(form, "severity") || "unknown",
        base_rev: head,
      });
      proposalId = String((result.proposal as { id: string }).id);
    } else {
      let value: unknown = text(form, "value");
      const field = text(form, "field");
      if (text(form, "value_is_json") === "1") {
        try {
          value = JSON.parse(String(value));
        } catch {
          return { error: "The new value is not valid JSON." };
        }
      }
      const result = await submitChangeProposal(principal, {
        kind: (text(form, "kind") || "change_proposal") as "change_proposal",
        title: text(form, "title"),
        rationale: text(form, "rationale"),
        base_rev: Number(text(form, "base_rev")) || head,
        target: { type: text(form, "target_type"), id: text(form, "target_id"), base_version: Number(text(form, "base_version")) },
        set: { [field]: value },
      });
      proposalId = String((result.proposal as { id: string }).id);
    }
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect(`/proposals/${proposalId}`);
}

/** Founder only: register an AI client or person and issue an API token. The token is shown once. */
export async function issueCredentialAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const principal = await requireSession();
  const claims = claimsFor(principal);
  if (!isFounderSession(principal)) {
    await audit(claims, { action: "credential.issue", outcome: "denied", detail: { reason: "founder authority required" } });
    return { error: "Only the founder can issue credentials." };
  }
  const handle = text(form, "handle").toLowerCase();
  const scopes = form.getAll("scopes").map(String);
  const days = Number(text(form, "days")) || 0;
  const issued = issueToken();
  try {
    await writeAs(claims, async (q) => {
      const exists = await q.query("select 1 from hq.principal_directory() where handle = $1", [handle]);
      if (!exists.rowCount) {
        await q.query("select hq.founder_register_client($1, $2, $3, $4)", [handle, text(form, "display_name") || handle, "ai_client", "ai_agent"]);
      }
      await q.query("select hq.founder_issue_credential($1, $2, $3::text[], $4, $5, $6)", [
        handle,
        text(form, "label") || "token",
        scopes.length ? scopes : ["read"],
        issued.prefix,
        issued.hash,
        days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
      ]);
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/access");
  return { ok: true, token: issued.token, message: `Token issued for ${handle}. Copy it now: it is shown once and only its SHA-256 is stored.` };
}

export async function revokeCredentialAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const principal = await requireSession();
  if (!isFounderSession(principal)) return { error: "Only the founder can revoke credentials." };
  try {
    await writeAs(claimsFor(principal), (q) => q.query("select hq.founder_revoke_credential($1::uuid)", [text(form, "credential_id")]));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/access");
  return { ok: true, message: "Credential revoked." };
}
