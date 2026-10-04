# Local automation upgrade

The local studio is at http://127.0.0.1:4182/. Generate or open a process, then find **Check what can actually run** below its automation map. The same panel is available on private result pages; public shared snapshots show the assessment without the runner.

## Built

- A bounded capability catalog and planner that separates task feasibility, connection route, missing information, approval, and execution readiness.
- Seven local operations: sorting, exact/substring filtering, deduplication, four basic arithmetic calculations, copying columns, matching rows between two files, and template drafts.
- CSV and flat JSON inputs. Quoted CSV fields, embedded newlines, and doubled quotes are supported. Duplicate headers, malformed rows, dangerous property names, and invalid calculations stop the run.
- A workflow can chain selected local steps in the displayed order. No arbitrary generated scripts execute.
- Sample testing on the first 20 rows; every full run validates all input rows again. Errors prevent an output download for the failed run.
- Original data stays unchanged. Local runs make no network requests and no external writes. Inputs and outputs remain in page memory; only workflow settings are saved when requested.
- JSON/CSV output downloads, clipboard export, and a downloadable run log. CSV export neutralizes spreadsheet formula prefixes; choose JSON when exact text preservation matters.
- Saved settings can be restored only against the same source and decisions. Restoring requires confirmation and a new sample test; files must be loaded again after a page reload.
- Changes to source, operation, settings, or input invalidate previous verification. Late file reads cannot overwrite a newer file selection.
- A documented route catalog for Google Sheets, Gmail, and Slack, with source links and setup requirements. Unknown CRMs and unsupported actions remain explicit blockers. A documented route is not a working account connection.
- An optional local **Check an app connection** form probes a specific spreadsheet's metadata, a Gmail account profile, or Slack authentication using an existing temporary access token. It uses fixed provider addresses, refuses redirects and foreign origins, never saves or returns the token, and does not claim write readiness. No real account credentials were available for live verification; request routing and failure handling were tested with fixtures.
- Fixes for false warnings about locally saved email drafts, refund labels, local spreadsheets, and a narrowly equivalent “into” / “to” instruction. Contradictory instructions still become uncertain. Source evidence remains preserved.

## Use it

1. Open each applicable step's **Set up a local operation** section.
2. Confirm column names and operation settings. Explicitly named sort, calculation, copy, lookup and duplicate-key fields are preserved; changing them is rejected by the runner.
3. For **Copy from matching rows**, choose the matching key in both files, the reference column to copy, a reference file, and a new output column. Missing, duplicate, empty, or differently typed keys stop execution. Existing columns are preserved.
4. Include supported unconditional steps and confirm their settings. Conditions, prohibitions, dependencies and wording outside the bounded operation grammar block execution in both the interface and runner. A condition anywhere in the walkthrough blocks its local operations because its scope has not been established. Checking a box cannot bypass this. Keep those steps manual or provide a separate unconditional walkthrough.
5. Load a CSV/JSON file, or choose **Use example data** for a clearly labeled demonstration.
6. Test the sample, inspect its output, and run all rows. Download or copy the result. Save workflow settings if you want to reuse them.

Filtering and deduplication deliberately discard rows from the output copy, and the log reports the count. Deduplication keeps the first row for each key. Sorting uses text order. Calculations require finite numeric inputs; division by zero stops the run. Templates use `{{column_name}}` placeholders and create text locally without sending it.

Limits: 5 MB per input file, 25,000 rows per input, up to 100 selected steps, templates up to 10,000 characters, and 10 MB of output text. Matching uses a reference input and never silently guesses a match. Zero-row filtered output preserves CSV headers and logs later steps as skipped.

## Verified locally

- Cloud/frontend project: 66 automated tests, including 16 planner/operation tests and four connection-check tests.
- Original local processing project: 23 automated tests.
- Three actual local model checks passed: a source-defined calculation compiled and produced 7; an unspecified CRM remained unconnected with specific missing information; local email drafts remained local without sending approval.
- Browser checks passed for source-to-result planning, suggested settings, chained sorting/calculation, saving/restoring settings, immediate invalidation after edits, real CSV file loading, copying complete output, and stopping a full run on an invalid 21st row after its 20-row sample passed. The copied JSON was read back and matched the expected values; the prior clipboard was restored.
- The browser displayed the expected two-row result: Alex first with total 4, Zoe second with total 7. The result and source remained separate.
- The hosted release build and artifact validation passed. No publishing was performed.

Evidence: `research/local-planner-verification.json`, `research/local-workflow.jpg`, and fixtures under `tests/fixtures/`.

The browser download control was exercised without a console error, but the in-app browser automation did not return a saved-file event for its Blob download. Download delivery in that browser is therefore unconfirmed by automation. Clipboard export provides another way to retrieve complete output. This limitation does not affect the verified calculations, file loading, or input protection.

These authored checks establish behavior on the tested inputs, not an accuracy benchmark or semantic guarantee. The model still proposes interpretations; users confirm rules and inspect sample outputs. A successful sample does not prove untested rows or business correctness.

## Scope and cost

The operation runner works entirely locally without a model or API key. Process generation can use the existing local model. No new model, paid service, subscription, or workflow platform was installed.

Live third-party account connectors, automatic background schedules, arbitrary desktop/browser actions, and complex branching are not included in this runner. The app exposes documented connection routes and missing requirements instead of claiming those integrations are active. Future account integrations require the chosen app, authorized access, exact action mapping, and appropriate plan limits.

Connection probes establish only their narrow checked scope: spreadsheet metadata, Gmail profile, or Slack authentication. They do not establish access to every cell/message/channel, write permission, correct business rules, or a working end-to-end integration. Provider references: [Sheets API](https://developers.google.com/workspace/sheets/api/reference/rest), [Gmail profile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile), [Slack authentication check](https://docs.slack.dev/reference/methods/auth.test/).

Larger models and bounded reasoning remain optional benchmark candidates; they were not made prerequisites. The existing 8 GB GPU continues to run the installed model.
