/**
 * Run by 06-review-labels.spec.ts (through tsx, as plant-claimed-build.ts is). Puts a proposal in the
 * inbox as the owner, past every check of submission: what a caller that went round the application
 * could have left there before the database refused it (migration 0008). The founder's review screen
 * must say it cannot be accepted, and accepting it must be refused. Uses the TEST database only.
 *
 *   npx tsx tests/e2e/plant-proposal.ts <id> <target type> <target id> '<set as JSON>'
 */
import "../helpers/env";
import { admin } from "../helpers/db";

async function main() {
  const [id, targetType, targetId, setJson] = process.argv.slice(2);
  if (!id || !targetType || !targetId || !setJson) throw new Error("usage: <id> <target type> <target id> '<set as JSON>'");
  const client = await admin();
  try {
    const target = await client.query<{ version: number }>(
      "select max(version) as version from hq.record_versions where record_type = $1 and record_id = $2",
      [targetType, targetId],
    );
    const head = await client.query<{ rev: string }>("select max(rev) as rev from hq.dataset_revisions where content_hash is not null");
    const developer = await client.query<{ id: string }>("select id from hq.principals where handle = 'developer'");
    await client.query(
      `insert into hq.proposals (id, kind, target_type, target_id, base_version, base_rev, title, rationale, payload, submitted_by)
       values ($1, 'change_proposal', $2, $3, $4, $5, 'Planted proposal (browser test)', 'Put in the inbox past the submission checks.', $6::jsonb, $7)`,
      [id, targetType, targetId, target.rows[0].version, Number(head.rows[0].rev), JSON.stringify({ op: "update", set: JSON.parse(setJson) }), developer.rows[0].id],
    );
    await client.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, 'submitted', $2)", [id, developer.rows[0].id]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
