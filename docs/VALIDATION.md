# Source and validation evidence

Source snapshot: `28ffac03a537d3bbd667200c3fee333d880bd3c8`. The [source map](source-map.json) records selected private paths, original hashes and public adaptations. Role prefixes and organization wording were replaced consistently; these references contain no environment configuration or business records.

The build extracts 20 named pure timesheet functions and their constants/types. It transpiles the actual application parser, its supporting title/phone modules and 15 original contract tests. TypeScript AST parsing also inventories the five `app.http` registrations, exposing six method/path pairs. SQL and authentication dependencies remain reference-only and are not imported.

`npm test`: **26 passed, zero failed**. Eleven additional checks cover registration counts, period alignment, calculated hours, reversed times, duplicates, period boundaries, paired time blocks, entry bounds, pagination, status filters and explicit role calls in protected source. Static checks of role-call presence do not execute authorization or prove resistance to access bypass.

The first local fixtures incorrectly expected the period helper to throw and supplied `query` instead of the source helper's `request.url`. Those fixture assumptions were corrected to match the existing source contract; platform source behavior was not changed.

`npm run demo`: eight fictional hours, page size capped at 100, valid application parsed, real authentication false, SQL writes zero, emails zero. Screenshot evidence shows the local explanatory preview only.

Not claimed: complete handler typechecking, Azure Functions host discovery, Entra token verification, database writes, transaction/replay concurrency, SQL grant acceptance, live application submission or inbox receipt. These require the maintained private application and separately authorized hosted checks.

The optional GitHub workflow is manual-only; repository publication does not run it. Local checks are used to avoid spending Actions minutes for this portfolio update.
