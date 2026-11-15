# Build your own from scratch: Api Business Logic And Workflow Controls

Your own wage-change rule with validation and a stale-version test, separated from HTTP and storage code.

Start with a new folder, your own files and your own accounts. The numbered steps below describe the build; no portfolio repository checkout is required. The existing implementation/evidence elsewhere in this repository is a separate reference, not a claim that your new build has already passed.

## Prerequisites

Node.js with its built-in test runner. This small rule is a learning policy, not a complete wage, payroll, legal or authorization system.

Use Bash on Linux/macOS/WSL for Bash blocks and PowerShell for PowerShell blocks. Select the tool versions supported by the official sources below, record the versions you actually install and retain generated dependency locks. Cloud resources, scanner downloads, logs and external AI calls can create costs; review the stated scope before enabling them.

## Create your project folder

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

## Step 1 — Write the business decision first

**Where:** A policy.md file.

Define a wage as whole cents, a permitted example range and a version number that increments on change. State who may request the change separately from whether the value and version are valid.

**Check before continuing:** The valid, invalid and stale-request outcomes are written down.

## Step 2 — Implement the rule in its own module

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

## Step 3 — Create positive and failure tests

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

## Step 4 — Run and explain your tests

**Where:** Your terminal.

Run the test file and read each result. Change one input in a new test to demonstrate a boundary; do not change the chosen policy silently to satisfy a failing case.

```bash
node --test wage.test.mjs
```

**Check before continuing:** Node reports the tests passed and you can explain each rejection.

## Step 5 — Define a real API/database integration

**Where:** Your design notes.

Place authentication/role and exact-record ownership checks before calling this rule. For SQL persistence, use a transaction and a conditional update on the expected version, require one affected row, then commit the audit record with the change.

**Check before continuing:** Your design handles concurrent writers; the in-memory test alone is not called a safe SQL save.

## Step 6 — Document the result

**Where:** Your project folder.

Keep the policy, implementation, tests and observed output together. Record that no actual employee, wage or database was changed by this standalone build.

**Check before continuing:** A reader can implement the rule independently and demonstrate its limits.

## Verification and your own screenshots

| Evidence | What to record | Your result |
| --- | --- | --- |
| New build | Your own files/resource settings and tool versions | Not yet recorded |
| Working path | The actual successful request, configuration or recovery result | Not yet recorded |
| Failure boundary | A meaningful denied, malformed, stale or failed case | Not yet recorded |
| Recovery / cleanup | What you restored or removed and what remains billed | Not yet recorded |

Capture your own architecture/configuration, one working result and one failure/recovery result. Keep tokens, credentials, personal records and private identifiers out of public screenshots. Existing portfolio images are references, not evidence that you performed these steps.

## Troubleshooting order

1. Confirm the named file, working directory and selected tool/interpreter.
2. Check the exact input and resource/account selected for the failing step.
3. Separate identity permission, network/DNS reachability and application validation.
4. Keep the actual error and reconcile an unknown write outcome before repeating it; do not widen access or repeat paid operations blindly.

The numbered steps describe a build procedure. Local syntax checks, an accepted API request, a completed hosted operation and a human verification are different evidence levels; fill in the verification table with what you actually observed.

## Official implementation references

- [nodejs.org — test.html](https://nodejs.org/api/test.html)
- [learn.microsoft.com — update-transact-sql](https://learn.microsoft.com/en-us/sql/t-sql/queries/update-transact-sql)

The walkthrough layout follows the prerequisites → creation/configuration → test → verification → troubleshooting → cleanup pattern of the [Splunk project reference](https://github.com/davidharris6/splunk-siem-log-analysis). Its Splunk-specific settings are not copied into unrelated projects.
