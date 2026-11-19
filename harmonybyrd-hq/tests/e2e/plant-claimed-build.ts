/**
 * Run by 06-review-labels.spec.ts (through tsx, which the test runner's loader is not). Stores, as the
 * owner and as an import would, a build marked as accepted whose statement quotes no source: what an
 * older pack could hold. Neither an import nor a proposal can add one now (F1), so a browser test
 * of how such a build is shown has to plant it. Uses the TEST database only (tests/helpers/env.ts).
 */
import "../helpers/env";
import { admin } from "../helpers/db";

const CLAIMED_BUILD = {
  id: "BLD-FX-03",
  label: "gamma-preview-1",
  module_id: "MOD-FX-GAMMA",
  filename: null,
  sha256: null,
  bytes: null,
  standing: "accepted_reported",
  statement: { text: "Said to be accepted.", epistemic: "submitter_claim", citations: [] },
  artifact_source_id: null,
  citations: [],
};

async function main() {
  const client = await admin();
  try {
    await client.query("select hq.admin_put_records($1::jsonb, 'A build marked as accepted with no source (browser test)', null, 'hq-import', false)", [
      JSON.stringify([{ type: "build", id: CLAIMED_BUILD.id, data: CLAIMED_BUILD }]),
    ]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
