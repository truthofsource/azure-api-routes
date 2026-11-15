# Build your own from scratch: Azure Api Routes

Your own HTTP server with a public application-validation route, health route and a closed staff-route boundary.

Start with a new folder, your own files and your own accounts. The numbered steps below describe the build; no portfolio repository checkout is required. The existing implementation/evidence elsewhere in this repository is a separate reference, not a claim that your new build has already passed.

## Prerequisites

Node.js, a text editor and a terminal; no Azure account is required for this route-focused build. Staff sign-in, persistence and actual application submission are separate additions, not features hidden in this sample.

Use Bash on Linux/macOS/WSL for Bash blocks and PowerShell for PowerShell blocks. Select the tool versions supported by the official sources below, record the versions you actually install and retain generated dependency locks. Cloud resources, scanner downloads, logs and external AI calls can create costs; review the stated scope before enabling them.

## Create your project folder

Choose a new folder name. These first commands create a blank project; an optional `git init` gives it its own history. Create parent directories in your editor when a later step introduces a nested file.

```bash
mkdir my-azure-api-routes
cd my-azure-api-routes
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

## Step 1 — Define your route contract

**Where:** A new routes.md file.

Write GET /api/health, POST /api/applications and the protected /api/timesheets boundary. Specify 400 for broken JSON, 422 for invalid application fields, 413 for oversized input, 401 for missing staff authentication and 404 for unknown paths.

**Check before continuing:** You have a route/method/status table before writing handlers.

## Step 2 — Create the server

**Where:** Your new project folder.

Create server.mjs below. The example validates fictional application input but deliberately does not save applications or pretend that a header supplied by a browser proves a staff role.

Create **`server.mjs`** with the following contents:

```javascript
import http from 'node:http';
const server = http.createServer(async (req, res) => {
  const send = (status, value) => {
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(value));
  };
  if (req.method === 'GET' && req.url === '/api/health')
    return send(200, {service: 'my-api', status: 'ok'});
  if (req.method === 'POST' && req.url === '/api/applications') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4096) return send(413, {error: 'Request too large'});
    }
    let body;
    try { body = JSON.parse(raw); }
    catch { return send(400, {error: 'Send valid JSON'}); }
    if (typeof body?.name !== 'string' || !body.name.trim() ||
        body.name.length > 100 || typeof body?.email !== 'string' ||
        body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      return send(422, {error: 'A name and valid email are required'});
    return send(202, {status: 'validated-not-saved'});
  }
  if (req.url === '/api/timesheets')
    return send(401, {error: 'Configure and validate staff authentication before enabling this route'});
  return send(404, {error: 'Route not found'});
});
server.listen(8080, '127.0.0.1');
```

**Check before continuing:** Your file contains the routes and explicit failure responses.

## Step 3 — Start your own API

**Where:** Terminal in that folder.

Run Node and leave this terminal open. The server binds to your computer only; use a second terminal for the requests in the next step.

```bash
node server.mjs
```

**Check before continuing:** GET /api/health returns JSON with status ok.

## Step 4 — Prove each request path

**Where:** Second terminal in the same folder.

Send the requests below with curl (curl.exe in Windows PowerShell). Record response status and body for each case; 202 here means validated-not-saved, not a database commit.

```bash
curl -i http://127.0.0.1:8080/api/health
curl -i -X POST http://127.0.0.1:8080/api/applications -H 'Content-Type: application/json'   --data '{"name":"Taylor Example","email":"taylor@example.invalid"}'
curl -i -X POST http://127.0.0.1:8080/api/applications -H 'Content-Type: application/json' --data '{}'
curl -i http://127.0.0.1:8080/api/timesheets
curl -i http://127.0.0.1:8080/api/missing
```

**Check before continuing:** The valid body is accepted for validation, the incomplete body is rejected and timesheets remains closed.

## Step 5 — Design the staff and storage additions

**Where:** Your route contract and identity configuration.

Before implementing staff timesheets, define the issuer/audience/signature validation, allowed role and exact employee ownership check. Add a real data transaction and conflict handling before changing validated-not-saved to a saved response; do not open the route with a browser-provided role flag.

**Check before continuing:** The remaining work is explicit and the incomplete staff route stays denied.

## Step 6 — Document and stop the project

**Where:** Your terminal and evidence folder.

Save the route table, server file and observed requests without personal records. Stop Node with Ctrl+C; no cloud deletion is needed for this local build.

**Check before continuing:** Another reader can create the same files and reproduce your response table.

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

- [nodejs.org — http.html](https://nodejs.org/api/http.html)
- [learn.microsoft.com — functions-reference-node](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)

The walkthrough layout follows the prerequisites → creation/configuration → test → verification → troubleshooting → cleanup pattern of the [Splunk project reference](https://github.com/davidharris6/splunk-siem-log-analysis). Its Splunk-specific settings are not copied into unrelated projects.
