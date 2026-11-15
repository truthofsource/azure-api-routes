import { EmployeeProfileError, employeeIdPattern } from "./errors.ts";
const fail = (status: number, message: string): never => { throw new EmployeeProfileError(status, "wage_change", message); };
export type WageInput = { action: "request" | "set"; changeId: string; employeeId: string; hourlyRate: string; respiteHourlyRate?: string | null; effectiveDate: string; reason: "initial_rate" | "pay_change" | "correction" | "role_change"; baselineRevision: string | null }
  | { action: "approve" | "cancel"; changeId: string; employeeId: string; revision: string; confirmed: true };
export type WageRow = { changeId: string; employeeId: string; hourlyRate: string; respiteHourlyRate?: string | null; effectiveDate: string; reason: string; status: string; requestedBy: string; approvedBy: string | null; approvedAtUtc: Date | null; revision: string; baselineRevision: string | null; createdAtUtc: Date };
export function parseWageInput(value: unknown): WageInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(400, "Provide a wage change.");
  const b = value as Record<string, unknown>;
  const id = (key: string) => { if (typeof b[key] !== "string" || !employeeIdPattern.test(b[key])) return fail(400, "Reload the employee and wage change."); return b[key]; };
  id("employeeId"); id("changeId");
  if (b.action === "request" || b.action === "set") {
    if (Object.keys(b).some(k => !["action", "changeId", "employeeId", "hourlyRate", "respiteHourlyRate", "effectiveDate", "reason", "baselineRevision"].includes(k))) return fail(400, "Unsupported wage change fields.");
    if (b.baselineRevision !== null) id("baselineRevision");
    if (typeof b.hourlyRate !== "string" || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(b.hourlyRate) || Number(b.hourlyRate) <= 0) return fail(400, "Enter a positive hourly rate with at most two decimal places.");
    if (typeof b.effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveDate) || b.effectiveDate.startsWith("0000") || !Number.isFinite(Date.parse(b.effectiveDate)) || new Date(b.effectiveDate).toISOString().slice(0, 10) !== b.effectiveDate) return fail(400, "Choose a valid effective date.");
    if (!["initial_rate", "pay_change", "correction", "role_change"].includes(String(b.reason))) return fail(400, "Choose the wage change reason.");
    const respite = b.respiteHourlyRate ?? null;
    if (respite !== null && (typeof respite !== "string" || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(respite) || Number(respite) <= 0)) return fail(400, "Enter a positive In Home Respite rate with at most two decimal places, or leave it unset.");
    const respiteRate = typeof respite === "string" ? `${respite.split(".")[0]}.${(respite.split(".")[1] ?? "").padEnd(2, "0")}` : null;
    const [whole, fraction = ""] = b.hourlyRate.split("."); return { ...b, hourlyRate: `${whole}.${fraction.padEnd(2, "0")}`, respiteHourlyRate: respiteRate } as WageInput;
  }
  if (!["approve", "cancel"].includes(String(b.action)) || b.confirmed !== true || Object.keys(b).some(k => !["action", "changeId", "employeeId", "revision", "confirmed"].includes(k))) return fail(400, "Confirm a supported wage decision.");
  id("revision"); return b as WageInput;
}
export function validateWageDecision(row: WageRow, input: Extract<WageInput, { action: "approve" | "cancel" }>, actor: string, roles: readonly string[]) {
  if (row.revision.toLowerCase() !== input.revision.toLowerCase() || row.status !== "pending") return fail(409, "The wage change is no longer pending at this revision. Reload it.");
  if (input.action === "approve" && !(roles.includes("Workforce.Admin") || (roles.includes("Workforce.HR") && roles.includes("Workforce.Payroll")))) return fail(403, "An Admin or HR with Payroll access must approve this wage change.");
}
