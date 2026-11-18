"use client";

import { useActionState, useState } from "react";
import {
  type ActionState,
  issueCredentialAction,
  recordDecisionAction,
  reviewProposalAction,
  revokeCredentialAction,
  submitProposalAction,
  withdrawProposalAction,
} from "@/lib/server/actions";

function Result({ state }: { state: ActionState | undefined }) {
  if (!state) return null;
  if (state.error) {
    return (
      <div className="notice bad" role="alert">
        {state.error}
        {state.detail?.length ? (
          <ul className="plain">
            {state.detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="notice ok" role="status">
        {state.message}
      </div>
    );
  }
  return null;
}

export function ReviewForm({ proposalId, stale }: { proposalId: string; stale: boolean }) {
  const [state, action, pending] = useActionState(reviewProposalAction, undefined);
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="proposal_id" value={proposalId} />
      <label className="field">
        Note to the proposer (optional)
        <textarea name="note" rows={3} placeholder="Why you are accepting, rejecting or asking for changes" />
      </label>
      {stale ? (
        <div className="notice warn">
          The target record has changed since this proposal was written. Accepting will not apply it: it will be marked stale and must be resubmitted.
        </div>
      ) : null}
      <div className="row">
        <button className="btn primary" type="submit" name="decision" value="accept" disabled={pending}>
          Accept and apply
        </button>
        <button className="btn" type="submit" name="decision" value="needs_changes" disabled={pending}>
          Ask for changes
        </button>
        <button className="btn danger" type="submit" name="decision" value="reject" disabled={pending}>
          Reject
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function WithdrawForm({ proposalId }: { proposalId: string }) {
  const [state, action, pending] = useActionState(withdrawProposalAction, undefined);
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="proposal_id" value={proposalId} />
      <button className="btn" type="submit" disabled={pending}>
        Withdraw this proposal
      </button>
      <Result state={state} />
    </form>
  );
}

export function DecisionForm({
  resolves,
  title,
  requirements,
  acceptable,
}: {
  resolves: string;
  title: string;
  requirements: { id: string; title: string }[];
  acceptable: { type: string; id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(recordDecisionAction, undefined);
  const [effect, setEffect] = useState("none");
  return (
    <form action={action} className="stack-sm">
      <label className="field">
        Decision title
        <input type="text" name="title" defaultValue={title} required minLength={3} maxLength={200} />
      </label>
      <label className="field">
        Your decision, in your own words
        <span className="help">Stored exactly as typed and never edited afterwards.</span>
        <textarea name="exact_text" rows={4} required minLength={3} />
      </label>
      <label className="field">
        Reasoning (optional)
        <textarea name="rationale" rows={2} />
      </label>
      <label className="field">
        Resolves (ids of pending decisions or open items, separated by spaces)
        <input type="text" name="resolves" defaultValue={resolves} placeholder="e.g. FD-REP-01 OPEN-EAR-03" />
      </label>
      <label className="field">
        What this decision changes in HQ
        <select name="effect_type" value={effect} onChange={(e) => setEffect(e.target.value)}>
          <option value="none">Nothing else — record the decision only</option>
          <option value="set_requirement_disposition">Set the standing of a founder requirement</option>
          <option value="set_acceptance">Record acceptance (or rejection) of a build, module, loop, evidence or commission</option>
        </select>
      </label>
      {effect === "set_requirement_disposition" ? (
        <div className="grid-2">
          <label className="field">
            Requirement
            <select name="effect_record_id" required>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.title.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            New standing
            <select name="effect_disposition" defaultValue="active">
              <option value="active">Active</option>
              <option value="satisfied">Satisfied</option>
              <option value="deferred">Deferred</option>
              <option value="superseded">Superseded</option>
              <option value="conflicted">Conflicted</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="unreviewed">Unreviewed</option>
            </select>
          </label>
        </div>
      ) : null}
      {effect === "set_acceptance" ? (
        <div className="stack-sm">
          <AcceptanceTarget acceptable={acceptable} />
          <div className="grid-2">
            <label className="field">
              Outcome
              <select name="effect_state" defaultValue="accepted">
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="none">Clear a previous acceptance</option>
              </select>
            </label>
            <label className="field">
              Scope of the acceptance
              <input type="text" name="effect_scope_note" placeholder="e.g. desktop browsers only; documentary acceptance only" />
            </label>
          </div>
        </div>
      ) : null}
      <label className="field">
        Commission this belongs to (optional)
        <input type="text" name="commission_ref" placeholder="e.g. HB-HQ-P02-R1" />
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record founder decision"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

function AcceptanceTarget({ acceptable }: { acceptable: { type: string; id: string; title: string }[] }) {
  const [selected, setSelected] = useState(acceptable[0] ? `${acceptable[0].type}|${acceptable[0].id}` : "");
  const [type, id] = selected.split("|");
  return (
    <label className="field">
      Record being accepted
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {acceptable.map((a) => (
          <option key={`${a.type}|${a.id}`} value={`${a.type}|${a.id}`}>
            {a.type}: {a.id} — {a.title.slice(0, 56)}
          </option>
        ))}
      </select>
      <input type="hidden" name="effect_record_type" value={type ?? ""} />
      <input type="hidden" name="effect_record_id" value={id ?? ""} />
    </label>
  );
}

/** An example of a statement, shown when a structured field is empty. */
const CLAIM_EXAMPLE = '{"text": "…", "epistemic": "submitter_claim", "citations": []}';

export function ProposalForm({
  target,
  fields,
  fieldKinds,
  headRev,
}: {
  target: { type: string; id: string; title: string; version: number; data: Record<string, unknown> };
  fields: string[];
  /** How each field is edited, decided from the record schema (not from the current value, which may be empty). */
  fieldKinds: Record<string, "text" | "json">;
  headRev: number;
}) {
  const [state, action, pending] = useActionState(submitProposalAction, undefined);
  const [field, setField] = useState(fields[0] ?? "");
  const current = target.data[field];
  const empty = current === null || current === undefined;
  // A field the schema does not describe falls back to its current value's type.
  const isText = fieldKinds[field] ? fieldKinds[field] === "text" : typeof current === "string" || empty;
  const [value, setValue] = useState<string | null>(null);
  const shown = value ?? (empty ? "" : isText ? String(current) : JSON.stringify(current, null, 2));
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="mode" value="change" />
      <input type="hidden" name="target_type" value={target.type} />
      <input type="hidden" name="target_id" value={target.id} />
      <input type="hidden" name="base_version" value={target.version} />
      <input type="hidden" name="base_rev" value={headRev} />
      <input type="hidden" name="value_is_json" value={isText ? "0" : "1"} />
      <label className="field">
        Field to change
        <select
          name="field"
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setValue(null);
          }}
        >
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Proposed new value
        <span className="help">
          {isText
            ? "Plain text."
            : empty
              ? `This field is structured and empty now: write it as JSON. A statement is written as ${CLAIM_EXAMPLE}. Write null to leave it empty.`
              : "This field is structured: edit it as JSON."}
        </span>
        <textarea name="value" rows={isText ? 4 : 10} value={shown} onChange={(e) => setValue(e.target.value)} className={isText ? undefined : "mono"} />
      </label>
      <label className="field">
        Title of the proposal
        <input type="text" name="title" required minLength={3} maxLength={200} placeholder={`Change ${field} of ${target.id}`} />
      </label>
      <label className="field">
        Why this change is right
        <span className="help">Say what supports it. A proposal changes nothing until the founder accepts it.</span>
        <textarea name="rationale" rows={4} required minLength={3} />
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={pending || !field}>
          {pending ? "Submitting…" : "Submit to the proposal inbox"}
        </button>
        <span className="muted small">
          Written against version {target.version} of {target.id} (dataset revision {headRev}).
        </span>
      </div>
      <Result state={state} />
    </form>
  );
}

export function DefectForm({ modules, preselected }: { modules: { id: string; name: string }[]; preselected: string }) {
  const [state, action, pending] = useActionState(submitProposalAction, undefined);
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="mode" value="defect" />
      <label className="field">
        Module
        <select name="module_ids" defaultValue={preselected} required>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Defect title
        <input type="text" name="title" required minLength={3} maxLength={200} />
      </label>
      <label className="field">
        What happens, and how to see it
        <textarea name="rationale" rows={5} required minLength={3} />
      </label>
      <label className="field">
        Severity
        <select name="severity" defaultValue="unknown">
          <option value="unknown">Not assessed</option>
          <option value="blocking">Blocking</option>
          <option value="major">Major</option>
          <option value="minor">Minor</option>
        </select>
      </label>
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Report defect to the inbox"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function CredentialForm() {
  const [state, action, pending] = useActionState(issueCredentialAction, undefined);
  return (
    <form action={action} className="stack-sm">
      <div className="grid-2">
        <label className="field">
          Client handle
          <span className="help">An existing client (claude, chatgpt) or a new one. Lowercase letters, digits, hyphens.</span>
          <input type="text" name="handle" required pattern="[a-z0-9][a-z0-9_\-]{1,40}" placeholder="claude" />
        </label>
        <label className="field">
          Display name (for a new client)
          <input type="text" name="display_name" placeholder="Claude (desktop)" />
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          Label for this token
          <input type="text" name="label" placeholder="e.g. Claude connector, issued 18 Nov" />
        </label>
        <label className="field">
          Expires after (days; blank = no expiry)
          <input type="number" name="days" min={1} max={3650} placeholder="90" />
        </label>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>
          Scopes
        </legend>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" name="scopes" value="read" defaultChecked /> read — retrieve records
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" name="scopes" value="propose" /> propose — submit proposals, defect reports and test evidence to the inbox
        </label>
        <p className="muted xsmall">There is no scope that allows approval. Approval is only possible in the founder&apos;s own session.</p>
      </fieldset>
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? "Issuing…" : "Issue API token"}
      </button>
      {state?.token ? (
        <div className="notice ok" role="status">
          {state.message}
          <pre className="json" style={{ marginTop: 8 }} data-testid="issued-token">
            {state.token}
          </pre>
        </div>
      ) : (
        <Result state={state} />
      )}
    </form>
  );
}

export function RevokeButton({ credentialId }: { credentialId: string }) {
  const [state, action, pending] = useActionState(revokeCredentialAction, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="credential_id" value={credentialId} />
      <button className="btn small danger" type="submit" disabled={pending}>
        Revoke
      </button>
      {state?.error ? <span className="small" style={{ color: "var(--bad)" }}>{state.error}</span> : null}
    </form>
  );
}
