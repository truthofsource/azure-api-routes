# Implementation and boundaries

## What Business Logic Means Here

Business logic is the set of rules that gives a request meaning: who can approve a wage change, what a valid rate/date looks like, which revision may still be changed and whether a saved payroll draft contains work worth preserving. An API route exposes that action over HTTP; SQL persists the accepted result; the frontend explains and requests the action.

The actual wage route authenticates/authorizes before opening the store, separates self-service current pay from staff operations, restricts content type/body size/fields and maps known errors to useful responses. Its Functions authLevel=anonymous means the app's own verified role middleware is responsible for authorization; it does not mean the business action is public.

The extracted rules require a positive decimal rate with at most two decimal places and a real date. Approval requires Admin or HR together with Payroll. The row must still be pending at the record version supplied in the request. Invalid input is 400, wrong permission is 403 and stale state is 409. An unexpected store failure asks the user to reload history before retrying because a save result may be uncertain.

The full database code checks the saved history again before changing it. It uses SQL queries that keep user values separate from query instructions, and database locks that prevent competing changes. It then saves an audit record. Record IDs and version checks help prevent duplicates and outdated changes. The standalone rule tests do not test these database and retry steps.

The draft classifier checks all versions. Earlier lines, payment changes, secure details or meaningful notes make the packet a draft even when the latest version has no hours. Unknown/incorrectly structured snapshots return unknown rather than being classified safe to discard.


The public example runs standalone rules and reports errors. It does not verify login credentials, connect to SQL, test competing requests across servers or complete payroll.
