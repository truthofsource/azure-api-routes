# Troubleshooting lessons from the actual platform

These are historical engineering incidents summarized from maintained internal records. They are not newly reproduced tests, a fresh cloud inventory or instructions to repeat a consumed operation. Names, resource identifiers, private payloads and credentials are excluded.

## Database-owner tests missed a runtime permission

**What happened.** Discarding an unpublished Notice draft returned HTTP 500, even though the application could authenticate and earlier database tests had passed.

**What the evidence showed.** The trace identified SELECT denial on the discard marker. Its migration had granted UPDATE, but the API used column-level SELECT grants and needed to read the new marker before a guarded update and on replay. Earlier disposable tests used database-owner authority and did not expose that boundary.

**What changed and how it was checked.** Migration 161 granted SELECT on the existing marker to the existing runtime principal. Disposable tests impersonated that principal, reproduced the denial and verified the narrow repair while DELETE remained denied; fictional discard and replay then passed nonproduction acceptance.

**What to carry forward.** Run permission-sensitive tests as the application identity, not only the database owner. Authentication, table existence and permission to write one column do not prove permission to read another; a discard operation need not require SQL DELETE.

Source record: `docs/troubleshooting/notice-draft-discard-read-permission.md — October 25, 2026; docs/runbooks/notice-filter-production-20261025.md`. These internal paths identify provenance; they are not public file links.

## Evidence and project boundaries

The local examples and screenshots in this repository remain separate from the dated hosted incidents above. A new documentation summary does not establish another successful deployment, restore, security scan or business transaction. Follow the repository’s existing validation guide for the commands and limits of the runnable reference.

The practical sequence is: identify the failing boundary, preserve safe correlation evidence, reconcile any uncertain result, apply only the relevant repair and verify the resulting state. A completed local command is not interchangeable with a completed cloud operation.
