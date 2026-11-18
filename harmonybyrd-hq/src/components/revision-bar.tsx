import Link from "next/link";
import type { DatasetContext } from "@/lib/server/store";
import { isoDateTime } from "@/lib/ui/format";

/** Shown only when the page is pinned to an older dataset revision. */
export function RevisionBar({ ctx }: { ctx: DatasetContext }) {
  const r = ctx.ds.revision;
  if (!ctx.pinned || r.rev === ctx.head) return null;
  return (
    <div className="notice info" role="status">
      You are viewing <strong>dataset revision {r.rev}</strong> ({isoDateTime(r.created_at)}), not the latest (revision {ctx.head}). Records are shown
      exactly as they stood then. <Link href="?">Return to the latest</Link>.
    </div>
  );
}
