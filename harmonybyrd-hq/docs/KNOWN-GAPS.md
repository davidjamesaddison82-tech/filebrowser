# Known gaps, blocked integrations and limits

Nothing here is hidden elsewhere. If something is not listed as working in docs/TEST-RESULTS.md, assume it is not proven.

## Standing

| | |
| --- | --- |
| HQ is not authoritative | The prerequisite HB-AI-P00 could not be shown to be completed or accepted. HQ says so on every screen and in every API answer |
| HQ is not accepted | No founder acceptance of HQ exists. Building it satisfies no gate |
| HQ is not deployed | It runs on a local machine only |

## Sources HQ could not read

- The governing documents the commission names (the blueprint, the prerequisite and HQ commission
  specifications, the module atlas, the recent founder directions, the migration register and the
  acceptance documents) were not found in the material available to the build: the shared documents,
  the connected Drive and the reachable repositories. They are listed one by one in the application
  under *Sources* and in the private findings report.
- The connected Google Drive returned no files; listing shared drives was refused.
- No HarmonyByrd code repository was reachable, so no build in HQ is tied to a code revision.
- The real evidence pack therefore rests on working documents (reports, briefs, test sheets, design
  packages and a few runnable candidates). The module atlas and learning loops in it are a
  reconstruction and may differ from the governing Atlas in number, names and scope.
- Several hundred further documents are named by those sources but were not accessible. HQ lists each one as “named, not accessible”.
- Three large runnable builds were read only in part (the first 400,000 characters of their embedded script). None was executed.

The precise inventory — every source, what was read, checksums, and every document that is only
named — is in the application under *Sources*, and in the private findings report delivered with the evidence pack.

## Integrations

| Integration | State | What is missing |
| --- | --- | --- |
| Claude (any application) | **Not connected** | Claude Code route untested; claude.ai/Desktop and the API need a public HTTPS deployment |
| ChatGPT application | **Blocked** | OAuth 2.1 in HQ, and a public HTTPS deployment |
| OpenAI Agents SDK / Responses API | Untested / blocked | See docs/CONNECTING-AI-CLIENTS.md |
| GitHub | Adapter built; **not configured** | A token and the names of the real repositories. Only its failure handling is tested (no network was used in tests) |
| Google Drive | Adapter built; **not configured** | An access token with read access to the governing documents. Only its failure handling is tested |
| Supabase | **Not created** | The schema follows Supabase conventions and runs on plain PostgreSQL 16. No Supabase project exists; Supabase Auth is not wired in (HQ has its own sign-in) |
| Docker Compose | **Untested** | `docker-compose.yml` is provided; Docker was not available in the build environment |

## Functional limits

- **No OAuth.** Clients use static bearer tokens.
- **No editing in place, by design.** Records change only through proposals the founder accepts, founder decisions, or a new import.
- **Search** is a simple all-words match over record text. No ranking, stemming or fuzzy matching.
- **Importing new documents is a build step,** not a screen. Turning a document into cited records
  was done by an extraction-and-audit process during this commission, outside the application. HQ
  verifies and imports the result; it does not read documents itself.
- **The ecosystem map** is laid out automatically by family. It is not a hand-drawn architecture diagram.
- **“Not mentioned in recent sources”** uses the dates of the documents HQ read. It can only be as recent as those documents.
- **One founder.** The model assumes a single founder identity. Delegated or shared founder authority is not modelled.
- **Runnable builds are not executed.** HQ records what documents report about builds, and the checksums of the few builds it holds. It did not run or test any HarmonyByrd module.
- **Requirement dispositions are all “unreviewed”** until the founder reviews them in HQ.
- **Accessibility** was considered (semantic headings, labels, keyboard reachability, contrast) but not audited with assistive technology.
- **Browsers:** automated tests use Chromium only.
- **Scale:** exercised with about 1,600 records. No load test.

## Quality of the evidence pack

- Every quotation is machine-verified against its source snapshot. That proves the words are in the
  source; it does not prove that HQ's one-line summary of them is the best reading. Each cluster of
  records was reviewed by a second, sceptical pass that corrected overstatements, but nobody other
  than the builder's own process has reviewed them.
- Many “founder requirements” drawn from documents are a document author's restatement of what the
  founder asked, not the founder's own words. HQ labels how it has each wording and marks all of them unreviewed.
- Where two documents described the same decision or build, HQ merged them and kept each document's
  own statement. Where two documents disagreed about a module's state, HQ shows the more cautious
  reading and lists the other. These are editorial judgements and are flagged as such.

## Environment notes

- The build container restarted once during the work; the local database and servers were restarted and the work continued from files on disk.
- Dependencies are pinned in `package-lock.json`. The build used Node 22.23, PostgreSQL 16.15, Chromium via Playwright 1.63.
