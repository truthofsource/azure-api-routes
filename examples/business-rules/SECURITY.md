# Security scope

Use fictional data only. Keep credentials, tokens, real employee/payroll records, raw HTTP responses and Terraform state out of this repository. The local viewer is unauthenticated and loopback-only; it must not be exposed as a protected application.

Local tests do not establish full deployed security, cloud compliance or transaction correctness. Live scanning, state migration and business writes are separate authorized operations. Report code issues without private data.
