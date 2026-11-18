import { KeepRevLink } from "@/components/nav";

/** Shown for an unknown record, a malformed address or a dataset revision that does not exist. */
export default function NotFound() {
  return (
    <section className="card" role="alert">
      <div className="card-body stack-sm">
        <h1>Not found</h1>
        <p className="muted">
          There is no such record, page or dataset revision. The address may be mistyped, or the revision may be later than the latest one.
        </p>
        <p>
          <KeepRevLink href="/">Go to the dashboard</KeepRevLink>
        </p>
      </div>
    </section>
  );
}
