# Commands and response handling

## Local checks

```bash
npm ci --ignore-scripts
npm test
npm run demo
npm run preview
```

The build parses TypeScript syntax and transpiles selected pure functions. It does not import the Azure handlers, start a Functions host or typecheck the full private application. The preview listens only on loopback and does not accept business writes.

In a second terminal, inspect the fictional preview:

```bash
curl -i http://127.0.0.1:8145/
```

This reads an HTML teaching page, not a platform API. To inspect source paths without invoking anything:

```bash
node -e "const fs=require('node:fs'); console.table(JSON.parse(fs.readFileSync('data/routes.json','utf8')).map(r=>({route:r.path,methods:r.methods.join(',')})))"
```

## Safe browser response handling

The following is an illustrative reader, not a replacement for the platform's maintained client helper:

```js
async function readJson(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}).`);
  if (!text.trim()) throw new Error('The server returned an empty response.');
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('The server returned an unexpected response type.');
  }
  try { return JSON.parse(text); }
  catch { throw new Error('The response could not be read as JSON.'); }
}
```

Inspect and correlate safe server diagnostics for detail. Do not show raw HTML, personal application data or token content as an error message, and do not automatically repeat an uncertain write.

## Live checks are separate

Authorized hosted validation must verify the real token, record ownership, SQL permissions, transaction state, concurrency and downstream delivery. No live curl token or service-start command is supplied here; the local demo cannot prove those controls.
