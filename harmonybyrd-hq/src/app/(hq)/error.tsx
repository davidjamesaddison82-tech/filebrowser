"use client";

/**
 * A screen that fails to render shows this in place of the screen, inside the normal navigation,
 * instead of a blank page. Nothing is changed by a failed render; records stay as stored.
 */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card" role="alert">
      <div className="card-body stack-sm">
        <h1>This screen could not be shown</h1>
        <p className="muted">
          Something in the records it displays could not be rendered. Nothing was changed. The records are still readable through the API and on other
          screens.
          {error.digest ? <> Reference for the server log: <code>{error.digest}</code>.</> : null}
        </p>
        <p>
          <button type="button" className="btn" onClick={() => reset()}>
            Try again
          </button>
        </p>
      </div>
    </section>
  );
}
