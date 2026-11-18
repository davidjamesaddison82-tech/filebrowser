import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessionPrincipal } from "@/lib/auth/current";
import { safeNext } from "@/lib/auth/safe-next";
import { param, type SearchParams } from "@/lib/server/page";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // The hidden field never carries a destination off HQ (the action checks it again on submit).
  const next = safeNext(param(params, "next"));
  let signedIn = false;
  try {
    signedIn = (await sessionPrincipal()) !== null;
  } catch {
    signedIn = false;
  }
  if (signedIn) redirect("/");
  return (
    <main className="signin">
      <div className="card">
        <div className="card-body stack" style={{ padding: 22 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="brand-mark" aria-hidden="true">
              HQ
            </span>
            <div>
              <h1 style={{ fontSize: "1.25rem" }}>HarmonyByrd HQ</h1>
              <p className="muted small">Development command centre</p>
            </div>
          </div>
          <SignInForm next={next} />
          <p className="muted xsmall">
            Local identities are created by <code>npm run setup</code>; their passphrases are saved in{" "}
            <code>.hq-local-credentials.json</code> on this machine. AI clients do not sign in here: they use their own API tokens.
          </p>
        </div>
      </div>
    </main>
  );
}
