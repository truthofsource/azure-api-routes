# Commands and expected output

Run from the project root:

```bash
node --experimental-strip-types --test src/payrollPacketDiscard.test.ts src/wageRules.test.ts
node --experimental-strip-types src/example.mjs
python -B scripts/demo.py
```

Ten Node tests passed: two original discard tests and eight new focused tests over the actual extracted wage rules.

```bash
python -B scripts/preview.py --port 8139
```

Open http://127.0.0.1:8139. Ctrl+C stops the loopback-only viewer. Use Python 3.12.

Use Node 22.23.2 or the reviewed compatible runtime. No npm dependency install is required. Built-in type stripping executes these selected erasable TypeScript constructs; it is not a full type check. The original route/store source under reference requires the complete application dependencies and is not executed by this example.
