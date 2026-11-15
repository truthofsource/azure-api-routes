# Build your own: Azure API Routes: Timesheets and Public Applications

This is a reader-operated build recipe for an independent learning copy. Follow the numbered steps in order and record your own results. The included local implementation is not a complete deployment of the private business platform; cloud extensions are separate and must use your own authorized resources.

## What you will create

Local route/validator behavior, not complete handler hosting, real bearer-token validation or SQL access.

## Prerequisites and working locations

| Location | What you need |
| --- | --- |
| Your workstation | Git and the runtime versions documented in [the command guide](COMMANDS.md); use its package/lockfile instructions. |
| Bash, Linux or WSL terminal | The commands below use Bash syntax. Prepare the compatible Node.js version documented by the project; use the project's pinned dependency files. |
| PowerShell alternative | Use the PowerShell forms in the command guide, or run this Bash recipe in WSL; do not paste Bash loops into PowerShell. |
| Azure or external service | Not needed for default local tests. Any cloud extension requires your own account, target, permissions, budget and acceptance plan. |

Read [the existing validation scope](VALIDATION.md) before running anything. A recorded historical test result is not evidence that your new copy has passed.

## Step 1: Create your own workspace

**Where:** your workstation, in a new project folder.

1. Clone the public source below into a new directory; keep the source attribution and included license terms. This creates your local learning copy, not cloud resources.
2. Record the selected commit and tool versions before editing. If you later publish a fork, review any origin, hash or target bindings rather than disabling guards to make the fork pass.

```bash
git clone https://github.com/truthofsource/azure-api-routes.git
cd azure-api-routes
git rev-parse HEAD
git status --short
```

**Expected result:** the project files are present and you can identify the starting source. Continue from this repository root unless a command explicitly changes directory.

## Step 2: Prepare dependencies and build the local baseline

**Where:** the same workstation terminal.

1. Follow the runtime instructions and install only the dependencies selected by this project's files. Terraform provider downloads, optional browser downloads and scanner databases are separate prerequisites where the detailed guide identifies them.
2. Run these source-derived baseline commands one at a time and stop on an unexpected failure. Read any skipped integration cases; a skip is not a successful live check.

```bash
npm ci --ignore-scripts
npm test
npm run demo
```

**Expected result:** the selected tests finish without unexpected failures, and a demonstration command, where provided, produces fictional local decisions. These commands reproduce the included lab scope; they do not commission the live platform.

## Step 3: Make one project-specific change

**Where:** your editor, in your own local copy.

1. Start with [`data/routes.json`](../data/routes.json) and the matching test or configuration instructions. Add a fictional request case to the matching validator tests; keep public and staff access rules separate.
2. Save your new case separately from the original acceptance records, then rerun the affected tests and the baseline. Do not edit recorded scanner results, screenshots or validation counts to manufacture a successful outcome.

**Expected result:** you can explain what you changed, why the result changed and which negative case still fails safely. An unexpected failure means investigate the implementation or setup, not remove the failing check.

## Step 4: Verify behavior and capture your own evidence

**Where:** the test output, local viewer where supplied, and your private evidence folder.

1. If the project supplies a viewer, use its startup command in [the command guide](COMMANDS.md); keep long-running preview servers in a separate terminal. Follow its exact loopback address and stop it with Ctrl+C when finished; for a command-line-only example, inspect its terminal output and generated files instead.
2. Compare your own output with [the proof and limits](../README.md#proof-it-works), then record source version, command, expected result, observed result and unresolved work. Capture screenshots of your own fictional output rather than presenting the existing screenshots as your execution.

**Expected result:** Local route/validator behavior, not complete handler hosting, real bearer-token validation or SQL access. Your evidence must say whether it covers local logic, a real tool run, a hosted service or a human observation.

## Step 5: Plan an independent cloud extension, if needed

**Where:** your own architecture/configuration files first; a separately authorized lab subscription only later.

1. Read the implementation and infrastructure references linked below. Substitute your own names, identities, address ranges and service settings in an isolated environment; a public reference may contain only selected components and is not authority to apply someone else's production state.
2. List the missing integrations and acceptance checks before deployment: runtime hosting, permissions, network/DNS paths, secrets, source data, notification or provider access as applicable. Keep disabled examples disabled until their specific dependencies, costs and cleanup are understood.

**Expected result:** a scoped extension plan with owners and explicit acceptance criteria, not a claim that the full service is deployed. No cloud `apply`, scanner targeting, paid operation or provider sign-in is implied by the local recipe.

- [Operations](OPERATIONS.md)
- [Validation](VALIDATION.md)

## Step 6: Troubleshoot, close out and explain what you built

**Where:** your project folder and the operating guide for any environment you actually created.

1. Check the failing stage in order: working directory and runtime, dependencies, test input, configuration, then any separately enabled service. Preserve the error and consult the existing troubleshooting lessons before widening permissions or changing the target.
2. Stop only the viewers/containers you started, retain your useful evidence and remove only resources belonging to your own reviewed lab. A local-only run needs no cloud deletion; if you created cloud resources, verify residual storage/address/monitoring charges rather than assuming compute stop removes all cost.

**Finish checklist:** explain the business problem, show your own change and verification, describe one failure/recovery case, identify limitations and name the next owner action. Keep credentials and business records out of public commits and screenshots.
