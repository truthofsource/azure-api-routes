# Operations, security and scaling

## Release compatibility

Match frontend requests to the exact API source and published package. Preserve the tested artifacts, inspect required route registrations and use the established release/rollback process; a successful frontend build does not prove the backend contains a newly expected route.

The selected references are not a deployment root. Related host/Terraform examples live in the [Node.js deployment project](https://github.com/truthofsource/azure-nodejs-api-deployment); deploying that teaching root is not necessary to run this workbench.

## Observe useful boundaries

Track route, method, status, duration, correlation ID, authorized actor and safe action outcome. Keep tokens, application answers and document contents out of logs. Distinguish HTTP acceptance, a committed database record, a queued event and actual email delivery; those are separate observations.

## Strengths

Explicit registrations make the contract visible. Shared validators reduce differing answers between entry points, server authorization protects data independently of hidden buttons, and transactional writes reduce half-saved business records. Application request receipts provide a clear replay/conflict rule for initial submissions.

## Weaknesses and tradeoffs

Flat action routes are established compatibility choices, not a universal API design standard. Inline SQL keeps the implementation direct but makes handler files larger and requires careful transaction and permission review. Handlers have different validation and response contracts, so this project does not promise a uniform error format, mandatory version token or identical retry behavior everywhere.

## How this could scale

Keep list queries bounded and ensure indexes support employee, date and status filters. Monitor SQL duration and connection pressure before increasing host instances, because more Functions capacity can overwhelm a smaller database. Reassess large offsets if queues grow; cursor pagination would be a future change, not a feature claimed here.

For public forms, review gateway/edge abuse controls, body limits and receipt retention against real traffic. Move slow downstream work out of request paths when justified, while preserving the distinction between a committed application and its notification delivery. Test concurrent submissions and replays against isolated SQL before claiming scale safety.

Version breaking contracts deliberately. Preserve current caller behavior or migrate callers together; renaming a route, widening a role or changing an expected field can break a working website even when unit tests pass.
