# Historical API route issues

## The nested-route incident

The old layer-era records preserve an explicit decision: use simple, single-segment Function routes because earlier Flex Consumption testing found them more reliable. Examples included `/api/schemahealth`, `/api/employmentapplicationreview` and `/api/shiftnotereview`. They warned against nested or hyphenated routes until tested on the deployed hosting plan.

The earliest located runbook record is commit `c493b633` on June 29, 2026. The preserved wording appears in `docs/runbooks/sql-private-access-and-grants.md`, Design notes, and the archived post-Layer-10 `docs/archive/careops-workflow-status.md`, Route naming convention.

**What the evidence establishes:** the platform deliberately adopted flat route names after testing trouble. **What it does not establish:** the exact failed nested URL, original status/host logs, whether a proxy or packaging issue contributed, or a general Azure Functions limitation. Nested routes must not be called unsupported on this evidence alone; Microsoft's HTTP trigger reference supports configurable route templates.

For that reason, this project shows actual `timesheetreview` and `timesheetcorrection` paths. A hypothetical `/timesheets/{id}/approve` would conceal the implementation choice and is not presented as a real route.

## A different incident: frontend/backend mismatch

The archived common-issues guide records employee/client reference buttons receiving 404 with an empty response body when the deployed frontend expected backend routes that were missing from the published package. It also records the old frontend attempting JSON parsing on that empty body.

Layer 34E introduced a shared response helper for simple JSON requests while leaving employee/client reference loading on explicit text handling for empty/non-JSON responses. That was a parsing improvement, not evidence that a missing backend route had been repaired.

## A third incident: production discovered test modules

Layer 39H-B4 documents a broad `dist/src/functions/*.js` entrypoint discovering compiled `.test.ts` output. One test module set synthetic environment values at module scope and overwrote runtime configuration in the same process.

The durable repair separated production compilation from test compilation and excluded tests from production output. A passing unit test or existing TypeScript file does not prove the deployed host loaded the intended function set.

## Troubleshoot in order

| Observation | Check first | Do not assume |
|---|---|---|
| API 404, empty body | Exact host, path, method, intended route shields, published package and registrations | SQL is broken or parsing the body will explain it |
| Page deep link 404, home loads | Static Web App fallback and asset delivery | The backend API route is missing |
| JSON parse error | Status, content type and whether a body exists | The server returned valid JSON |
| 401 | Token presence, audience, issuer, expiry and scope | Granting a database role will fix authentication |
| 403 | App role, active staff status and access to this record | Every denial is a missing app role |
| 409 | Current record and request/version state | Repeating the same action is always safe |
| SQL permission failure | Exact statement and managed-identity grant | Networking failed before SQL was reached |
| Zero registered functions | Package root, entrypoints, runtime dependencies and load errors | Source files alone prove registration |

Inspect the actual response before parsing. Log only safe status, route, correlation and content-type information; do not dump tokens, application answers or employee documents. A resource intentionally paused or a route intentionally shielded is not permission to enable it.

For a future nested-route experiment, use a separate fictional route, verify the compiled registration, exercise exact methods and paths on the intended host, and preserve the response plus host diagnostics. Do not rename working production routes merely to make them look more REST-like.

## Historical source references

- `docs/archive/careops-workflow-status.md`: post-Layer-10 flat-route decision.
- `docs/runbooks/sql-private-access-and-grants.md`: Flex Consumption design notes; history located at `c493b633`.
- `docs/archive/common-careops-issues.md`: missing reference routes and empty-response parsing.
- `docs/architecture/layer-30-timesheets-checkpoint.md` and `layer-31-timesheet-corrections-checkpoint.md`: submission/review/correction evolution.
- `docs/architecture/layer-34e-frontend-api-helper.md`: shared response handling.
- `docs/troubleshooting/layer-39h-b4-stage2-sensitive-data-commissioning-recovery.md`: test discovery defect.
- `docs/troubleshooting/layer-42i-production-portal-ui-recovery.md`: frontend deep links versus protected API behavior.

These are historical internal-document titles, not public operational instructions or fresh reproduction results. No old deployment, SQL grant or service start was repeated for this project.
