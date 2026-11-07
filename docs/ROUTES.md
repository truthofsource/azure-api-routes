# Routes, access and request flow

## How the pieces connect

React builds the request from the form. Azure Functions matches the URL and HTTP method to an `app.http` registration, then runs its handler; shared helpers validate access and answers, and the handler uses SQL for business records. These selected handlers often contain SQL directly; this project does not invent an Express router, API Management gateway or universal repository layer.

The catalog in [routes.json](../data/routes.json) is generated from TypeScript syntax, not hand-maintained route guesses. Five registrations expose six method/path pairs because `timesheets` accepts both GET and POST. The default `/api` prefix is configured by the Functions host; see [Microsoft's HTTP trigger documentation](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger).

## Why protected routes say anonymous

The registrations use `authLevel: "anonymous"`, meaning the Functions host does not require a function key. The staff handlers still call `requireAnyAppRole`, validate the bearer identity and check active staff access; this is not anonymous access to employee data. See the [selected access helper](../reference/auth/requireAppRole.ts) and [Microsoft's Node.js programming model](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node).

The selected helper imports the real token validator from the private application, which is not a runnable dependency here. None of the local tests sign in to Entra or exercise token verification.

## Timesheet submission

`POST /api/timesheets` allows Caregiver or Admin. It validates the client reference, pay-period dates, required employee confirmation and entries before resolving the actual employee and verifying client assignments. The caregiver's identity maps to their employee record; an arbitrary employee ID is not a substitute for that mapping.

The source uses a 14-day cycle anchored on June 21, 2026, which is this application's business policy rather than a general payroll rule. It accepts 1–28 entries, rejects duplicate date/service pairs, checks positive time intervals and paired second-period times, and calculates totals. These selected checks are exercised locally; their presence does not prove every possible payroll rule is enforced.

In the live handler, a serializable SQL transaction writes the timesheet, child entries and audit record. A successful create returns 201 with `submitted` status. This endpoint is not a draft-save API.

`GET /api/mytimesheets` reads the caregiver's mapped records, while Admin may use an employee filter or read across employees. `GET /api/timesheets` serves Supervisor/Admin/HR review listing with the source's record/team filters. Pagination defaults to 25 and caps page size at 100.

## Review and correction

`POST /api/timesheetreview` permits Supervisor/Admin and accepts `in_review`, `approved`, `rejected` or `needs_correction`. Rejection and correction requests require review notes. The handler locks the record and uses a conditional update; it can return a conflict when the current record is no longer reviewable.

The review handler's `expectedUpdatedAtUtc` value is optional in this source. When supplied, it must match the expected timestamp format and participates in the update check. Do not describe this as mandatory ETags or universal If-Match support.

`POST /api/timesheetcorrection` has different staff and caregiver paths, record ownership requirements and correction rules. Read the [actual handler](../reference/routes/timesheetcorrection.ts); this local workbench inventories the route but does not execute correction transactions.

## Public initial application

`POST /api/publicemploymentapplications` accepts an initial application without a staff bearer role. It checks JSON content type, a 256 KiB body limit, a UUID-shaped `requestId`, the application contract, required acknowledgments and a honeypot field.

The handler records a receipt pairing `requestId` with the submitted payload hash. An exact repeated request can return 200 with the existing confirmation; the same ID with changed answers returns 409. A new accepted application returns 201 after its transaction commits. The local suite runs the application parser, not these SQL receipt and concurrency paths.

The live transaction groups the application and related records with audit, notification-event and Stage 2 handoff records. Invitation delivery follows commit; an accepted application is not proof an invitation email arrived. Applying for Administrator does not assign the Entra Admin role.

This public submission route does not expose the internal application list. Body limits, a honeypot and request receipts alone are not a complete internet abuse defense.
