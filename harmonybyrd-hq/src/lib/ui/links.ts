import { guessType } from "@/lib/domain/derive";
import type { RecordType } from "@/lib/domain/schemas";

/** The canonical page for a record. Every id shown anywhere in HQ links here. */
export function recordHref(type: RecordType | string, id: string): string {
  const safe = encodeURIComponent(id);
  switch (type) {
    case "module":
      return `/modules/${safe}`;
    case "loop":
      return `/loops/${safe}`;
    case "requirement":
      return `/requirements/${safe}`;
    default:
      return `/records/${type}/${safe}`;
  }
}

export function refHref(id: string): string {
  if (typeof id !== "string") return "#";
  if (id.startsWith("PROP-")) return `/proposals/${encodeURIComponent(id)}`;
  return recordHref(guessType(id), id);
}

export { isPinnablePath, readRev, withRev } from "./pin-rules";
