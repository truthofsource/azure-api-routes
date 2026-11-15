import assert from "node:assert/strict";
import { test } from "node:test";
import { discardKind } from "./payrollPacketDiscard.ts";

const base = { startDate: "2026-10-11", endDate: "2026-10-24", weekStartsOn: 0, sourceHash: "test", lines: [], unapproved: [], paymentSetups: [], secureDetails: [] };
test("classifies all packet versions, including payment-only changes", () => {
  assert.equal(discardKind([JSON.stringify(base)]), "empty");
  assert.equal(discardKind([JSON.stringify(base), JSON.stringify({ ...base, paymentSetups: [{ employeeId: "employee" }] })]), "draft");
  assert.equal(discardKind([JSON.stringify({ ...base, lines: [{}] }), JSON.stringify(base)]), "draft");
  assert.equal(discardKind([JSON.stringify({ ...base, employeeNotes: { employee: " Follow up " } })]), "draft");
});
test("unknown or malformed snapshots fail closed", () => {
  assert.equal(discardKind([]), null);
  assert.equal(discardKind(["{bad json"]), null);
  assert.equal(discardKind([JSON.stringify({ ...base, newPayrollField: "important" })]), null);
  assert.equal(discardKind([JSON.stringify({ ...base, lines: null })]), null);
});
