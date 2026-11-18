"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        Name
        <input type="text" name="handle" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
      </label>
      <label className="field">
        Passphrase
        <input type="password" name="passphrase" autoComplete="current-password" required />
      </label>
      {state?.error ? (
        <div className="notice bad" role="alert">
          {state.error}
        </div>
      ) : null}
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
