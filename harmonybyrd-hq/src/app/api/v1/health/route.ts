import { databaseHealthy } from "@/lib/server/db";
import { json } from "@/lib/server/http";

/** Liveness. Unauthenticated on purpose and therefore tells an anonymous caller nothing about the records. */
export async function GET() {
  const db = await databaseHealthy();
  return json({ ok: db.ok, database: db.ok ? "reachable" : "unreachable" }, { status: db.ok ? 200 : 503 });
}
