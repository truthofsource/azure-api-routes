> This example is maintained within **azure-api-routes**. Run its local commands from this subfolder; its nested workflow files are retained examples and are not active repository workflows. See [the consolidation guide](https://github.com/truthofsource/azure-api-routes/blob/main/docs/CONSOLIDATION.md).

# API Business Logic and Reliable Workforce Processes

**Make sure a business change is allowed, accurate and based on the latest information.**

[Business problem](#the-business-problem) · [Solution](#the-solution) · [Strengths](#engineering-strengths) · [Proof](#proof-it-works) · [Commands](docs/COMMANDS.md) · [Step by step](#step-by-step)

## The Business Problem

Payroll and employee administration depend on more than a form being filled in. A wage change needs a valid amount, an authorized reviewer and the current record. A payroll draft may contain meaningful earlier work even if its latest visible version appears empty. Staff need those distinctions to remain true when several people use the system.

Two reviewers can open the same record before either saves. Without a current-version check, the later action can overwrite or approve information the reviewer never saw. A delete operation that looks only at the newest draft can remove work whose history still matters. Hiding controls in the browser does not enforce those rules on a direct request.

The business need was dependable server-side rules for approval, change and deletion, so the stored result reflects an allowed action on the right version of the record.

## The Solution

Put the business rules on the server, where users cannot bypass them by changing the page. Check the requested change, the person’s permissions and the record’s version before saving. This project uses real wage and payroll-draft rules with fictional examples.

**Business outcome:** The example blocks unauthorized or out-of-date approvals and avoids treating meaningful payroll work as an empty draft.

## Tools Used and What They Do

| Tool or service | What it does | Where it fits |
| --- | --- | --- |
| Node.js and TypeScript | Express the pay, approval, version and discard rules. | Actual selected rule implementation and source tests. |
| Azure Functions | Receive the protected business request in the platform. | Reference route context; the local example is not a deployed handler. |
| Microsoft Entra ID | Supply roles and verified staff identity for allowed actions. | Actual access boundary; fixture roles do not verify real tokens. |
| Azure SQL and T-SQL | Apply guarded changes and preserve related records together. | Actual store context; pure-rule tests do not exercise live transactions. |
| Node test runner and Python | Check extracted decisions and show fictional outcomes. | Local validation and preview utilities. |
| Terraform and GitHub Actions | Provide related infrastructure and manual reference checks. | No business operation or infrastructure change occurs through the demo. |

The rule, API route, database permission and user interface are separate parts of one process. Passing a local rule test does not establish a completed approval, payment or saved record.

## Step by Step

Your own wage-change rule with validation and a stale-version test, separated from HTTP and storage code.

[Open the standalone build guide](docs/BUILD-YOUR-OWN.md) or follow the same complete instructions below.

Start with a new folder, your own files and your own accounts. The numbered steps below describe the build; no portfolio repository checkout is required. The existing implementation/evidence elsewhere in this repository is a separate reference, not a claim that your new build has already passed.

### Prerequisites

Node.js with its built-in test runner. This small rule is a learning policy, not a complete wage, payroll, legal or authorization system.

Use Bash on Linux/macOS/WSL for Bash blocks and PowerShell for PowerShell blocks. Select the tool versions supported by the official sources below, record the versions you actually install and retain generated dependency locks. Cloud resources, scanner downloads, logs and external AI calls can create costs; review the stated scope before enabling them.

### Create your project folder

Choose a new folder name. These first commands create a blank project; an optional `git init` gives it its own history. Create parent directories in your editor when a later step introduces a nested file.

```bash
mkdir my-api-business-logic-and-workflow-controls
cd my-api-business-logic-and-workflow-controls
git init
```

Create `.gitignore` before saving credentials or build outputs:

```gitignore
.venv/
node_modules/
.env
.env.*
local.settings.json
credentials.json
token.json
*.pem
*.key
*.tfstate*
*.tfplan
.terraform/
private*/
captures/
backups/
batch.json
reports/
out/
app-config.local.yaml
```

The source/file snippets are a starting implementation you type or paste into the named files. Replace `YOUR_*`, names, regions and addresses only with values from your own lab; do not place real client/employee records in a test project. Keep your terminal in this project root unless a step explicitly changes directory.

Before a first commit, set your own repository-local author with `git config user.name "YOUR_NAME"` and `git config user.email "YOUR_PUBLIC_COMMIT_EMAIL"`. Review `git status --short` and the staged diff before publishing; ignored local files are not a substitute for reviewing what you upload.

### Step 1 — Write the business decision first

**Where:** A policy.md file.

Define a wage as whole cents, a permitted example range and a version number that increments on change. State who may request the change separately from whether the value and version are valid.

**Check before continuing:** The valid, invalid and stale-request outcomes are written down.

### Step 2 — Implement the rule in its own module

**Where:** Your new project folder.

Create wage.mjs with the rule below. It returns a new record instead of modifying the original, which makes a repeated test easier to reason about.

Create **`wage.mjs`** with the following contents:

```javascript
export function changeWage(current, cents, expectedVersion) {
  if (!current || !Number.isSafeInteger(current.version) || current.version < 1)
    throw new Error('Invalid current record');
  if (expectedVersion !== current.version) throw new Error('Version conflict');
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000)
    throw new Error('Wage must be whole cents from 0 to 100000');
  if (current.version === Number.MAX_SAFE_INTEGER) throw new Error('Version limit reached');
  return {...current, cents, version: current.version + 1};
}
```

**Check before continuing:** The rule depends on input values rather than a database connection.

### Step 3 — Create positive and failure tests

**Where:** The same folder.

Create wage.test.mjs below. A negative test passes when the unsafe request is rejected; it is not a failure you should remove to make a report green. Include the largest safe version number so incrementing it cannot silently lose precision.

Create **`wage.test.mjs`** with the following contents:

```javascript
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeWage} from './wage.mjs';
test('valid wage creates a new version', () => {
  const old = {id: 'EMP-001', cents: 1500, version: 1};
  assert.deepEqual(changeWage(old, 1600, 1), {...old, cents: 1600, version: 2});
  assert.equal(old.version, 1);
});
test('invalid and stale changes are rejected', () => {
  const old = {id: 'EMP-001', cents: 1500, version: 2};
  assert.throws(() => changeWage(old, -1, 2), /whole cents/);
  assert.throws(() => changeWage(old, 1600, 1), /Version conflict/);
});
test('exhausted version is rejected without changing the record', () => {
  const old = {id: 'EMP-001', cents: 1500, version: Number.MAX_SAFE_INTEGER};
  assert.throws(() => changeWage(old, 1600, old.version), /Version limit reached/);
  assert.equal(old.cents, 1500);
  assert.equal(old.version, Number.MAX_SAFE_INTEGER);
});
```

**Check before continuing:** The tests cover a good change, an invalid value and a stale version.

### Step 4 — Run and explain your tests

**Where:** Your terminal.

Run the test file and read each result. Change one input in a new test to demonstrate a boundary; do not change the chosen policy silently to satisfy a failing case.

```bash
node --test wage.test.mjs
```

**Check before continuing:** Node reports the tests passed and you can explain each rejection.

### Step 5 — Define a real API/database integration

**Where:** Your design notes.

Place authentication/role and exact-record ownership checks before calling this rule. For SQL persistence, use a transaction and a conditional update on the expected version, require one affected row, then commit the audit record with the change.

**Check before continuing:** Your design handles concurrent writers; the in-memory test alone is not called a safe SQL save.

### Step 6 — Document the result

**Where:** Your project folder.

Keep the policy, implementation, tests and observed output together. Record that no actual employee, wage or database was changed by this standalone build.

**Check before continuing:** A reader can implement the rule independently and demonstrate its limits.

### Verification and your own screenshots

| Evidence | What to record | Your result |
| --- | --- | --- |
| New build | Your own files/resource settings and tool versions | Not yet recorded |
| Working path | The actual successful request, configuration or recovery result | Not yet recorded |
| Failure boundary | A meaningful denied, malformed, stale or failed case | Not yet recorded |
| Recovery / cleanup | What you restored or removed and what remains billed | Not yet recorded |

Capture your own architecture/configuration, one working result and one failure/recovery result. Keep tokens, credentials, personal records and private identifiers out of public screenshots. The architecture diagram explains the design; record your own results rather than treating it as execution evidence.

### Troubleshooting order

1. Confirm the named file, working directory and selected tool/interpreter.
2. Check the exact input and resource/account selected for the failing step.
3. Separate identity permission, network/DNS reachability and application validation.
4. Keep the actual error and reconcile an unknown write outcome before repeating it; do not widen access or repeat paid operations blindly.

The numbered steps describe a build procedure. Local syntax checks, an accepted API request, a completed hosted operation and a human verification are different evidence levels; fill in the verification table with what you actually observed.

### Official implementation references

- [nodejs.org — test.html](https://nodejs.org/api/test.html)
- [learn.microsoft.com — update-transact-sql](https://learn.microsoft.com/en-us/sql/t-sql/queries/update-transact-sql)

The walkthrough layout follows the prerequisites → creation/configuration → test → verification → troubleshooting → cleanup pattern of the [Splunk project reference](https://github.com/davidharris6/splunk-siem-log-analysis). Its Splunk-specific settings are not copied into unrelated projects.

<details>
<summary>Reference: how the existing platform implementation operates</summary>

A short walkthrough of the process, with technical instructions and evidence limits in the sections below.

1. **Receive the requested change** — The server receives an action such as a wage update or payroll decision. It checks who is making the request and which record they want to change.

2. **Check the business rules (TypeScript)** — The application checks the values, permissions and current record status. An outdated or unauthorized request is rejected before anything is saved.

3. **Save a consistent result (Azure SQL)** — An allowed change is saved together with its audit record. Checks inside the database help prevent two competing requests from applying conflicting decisions.

4. **Explain the outcome** — The application returns a useful success, validation or conflict message. The local examples demonstrate these decisions with fictional records.

</details>

## Engineering Strengths

| Strength | Practical value |
| --- | --- |
| **Rules stay testable** | Pure rules can be checked without an HTTP server, Azure login or live database. |
| **Conflicts are explicit** | A out-of-date record version or decision that is no longer awaiting approval returns a conflict instead of silently overwriting newer work. |
| **Data meaning is preserved** | Draft classification examines every saved version and treats unknown shapes conservatively. |

## Architecture

1. **User action / JSON** → **HTTP route**.
2. **HTTP route** → **Verified identity / route permissions**.
3. **Verified identity / route permissions** → **Input / role / state / revision rules**.
4. **Input / role / state / revision rules** → **Parameterized SQL transaction**.
5. **Parameterized SQL transaction** → **Business change + audit**.
6. **Business change + audit** → **Useful success / validation / conflict response**.

[View the illustrated project overview](../../docs/diagrams/architecture.svg).

This project is derived from actual workforce-platform implementation. Identifying labels/targets use examples. The local viewer and demonstration are new reference code; [source mapping](docs/SOURCE-MAP.md) identifies the copied/extracted files and limitations.

## What Was Built

| Component | Purpose | Implementation |
| --- | --- | --- |
| Actual extracted wage rules | Validate money/date/action fields, role combination and version still awaiting a decision | [Rules](src/wageRules.ts) |
| Actual draft classifier | Examine every payroll snapshot; refuse unknown/incorrectly structured shape | [Source](src/payrollPacketDiscard.ts) |
| Actual route reference | Authorization before store, JSON/body limits and useful failures | [Route](reference/wagechanges-route.ts) |
| Actual SQL store reference | Serializable transaction, locking, parameterized queries and audit | [Store](reference/wageChanges.ts) |
| Local demonstration | Exercise actual rule/evaluation code using fictional data | [Demo](scripts/demo.py) |
| Dated context | Keep earlier platform results separate from the new local example | [Context](data/history.json) |

## Proof It Works

### 1. Run focused checks

```bash
node --experimental-strip-types --test src/payrollPacketDiscard.test.ts src/wageRules.test.ts
node --experimental-strip-types src/example.mjs
python -B scripts/demo.py
```

**Observed:** Ten Node tests passed: two original discard tests and eight new focused tests over the actual extracted wage rules. [Validation](docs/VALIDATION.md) records the exact scope and distinguishes pure/mock checks from testing with the hosted services.

### 2. Inspect the decision output

The output is explicitly fictional and exercises the included logic. A successful rule test or simulation is not a completed real-world operation. The public example runs standalone rules and reports errors. It does not verify login credentials, connect to SQL, test competing requests across servers or complete payroll.

### 3. Open the reference viewer

```bash
python -B scripts/preview.py --port 8139
```

Open [the local reference](http://127.0.0.1:8139). Switch between Overview, Working example and Implementation context. Ctrl+C stops it. Proper application and Azure screenshots are deferred; this remains a runnable local reference.

## What Business Logic Means Here

Business logic is the set of rules that gives a request meaning: who can approve a wage change, what a valid rate/date looks like, which revision may still be changed and whether a saved payroll draft contains work worth preserving. An API route exposes that action over HTTP; SQL persists the accepted result; the frontend explains and requests the action.

The actual wage route authenticates/authorizes before opening the store, separates self-service current pay from staff operations, restricts content type/body size/fields and maps known errors to useful responses. Its Functions authLevel=anonymous means the app's own verified role middleware is responsible for authorization; it does not mean the business action is public.

The extracted rules require a positive decimal rate with at most two decimal places and a real date. Approval requires Admin or HR together with Payroll. The row must still be pending at the record version supplied in the request. Invalid input is 400, wrong permission is 403 and stale state is 409. An unexpected store failure asks the user to reload history before retrying because a save result may be uncertain.

The full database code checks the saved history again before changing it. It uses SQL queries that keep user values separate from query instructions, and database locks that prevent competing changes. It then saves an audit record. Record IDs and version checks help prevent duplicates and outdated changes. The standalone rule tests do not test these database and retry steps.

The draft classifier checks all versions. Earlier lines, payment changes, secure details or meaningful notes make the packet a draft even when the latest version has no hours. Unknown/incorrectly structured snapshots return unknown rather than being classified safe to discard.

## Operations, Limits and Growth

State clearly which system is being checked, who owns it and what the result actually proves. Test the cases that should be denied or rejected as well as the successful ones. Keep incomplete results clearly marked. Preserve private inputs and unrelated changes. Before expanding the design, measure what is slow or limited, review costs, and check access restrictions and recovery again. [Operations and scaling](docs/OPERATIONS-AND-SCALING.md).

## Troubleshooting Lessons

A draft-discard operation failed because the runtime identity lacked one required column read. Tests with database-owner authority had missed the gap. [Read the incident, evidence and verification](docs/LESSONS-LEARNED.md).

## Project Guides

| Guide | Purpose |
| --- | --- |
| [Implementation](docs/IMPLEMENTATION.md) | Rules, boundaries and actual source design |
| [Commands](docs/COMMANDS.md) | Local tests, expected output and inspection |
| [Operations and scaling](docs/OPERATIONS-AND-SCALING.md) | Strengths, weaknesses, costs and growth |
| [Source map](docs/SOURCE-MAP.md) | Actual files and public adaptations |
| [Validation](docs/VALIDATION.md) | What was tested locally and what still needs real-service testing |

No Azure service, business record or live state was changed. The public validation workflow is manual-only and was not dispatched, conserving hosted Actions minutes.
