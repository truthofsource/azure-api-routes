import type { DetailsReference } from "./payrollDetailsStore";
import { createHash } from "node:crypto";
import { EmployeeProfileError, employeeIdPattern } from "../employees/employeeProfiles";
export const packetError = (status: number, message: string): never => { throw new EmployeeProfileError(status, "payroll_packet", message); };
export const adjustmentReasons = ["hours_correction", "missing_timesheet", "duplicate_source", "outside_period", "other_reviewed"] as const;
export type PacketLine = { lineId: string; employeeId: string; employeeName: string; preparerReference?: string | null; workDate: string; serviceType: string; hoursHundredths: number; originalHoursHundredths: number | null; hourlyRateCents: number | null; wageChangeId: string | null; timesheetId: string | null; sourceEntryId: string | null; intervals: [number, number][]; included: boolean; reason: string | null; adjusted: boolean; setupStatus: string };
export type SourceWarning = { timesheetId: string; employeeId: string; employeeName?: string; status: string };
export type PaymentSetup = { employeeId: string; employeeName: string; preparerReference: string | null; revision: string; paymentMethod: string; previousPaymentMethod: string | null; setupStatus: string; confirmedOn: string | null; updatedAtUtc: string; reason: string };
export type PacketSnapshot = { startDate: string; endDate: string; weekStartsOn: number; sourceHash: string; lines: PacketLine[]; unapproved: SourceWarning[]; paymentSetups?: PaymentSetup[]; employeeNotes?: Record<string, string>; secureDetails?: DetailsReference[] };
export type PacketIssue = { key: string; severity: "block" | "review"; message: string; employeeId?: string; employeeName?: string; timesheetId?: string; lineId?: string };
export function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function packetRange(start: unknown, end: unknown, week: unknown) {
  if (!validDate(start) || !validDate(end) || end < start || Date.parse(end) - Date.parse(start) > 30 * 86400000 || week !== 0) return packetError(400, "Choose a period of up to 31 days. The workweek starts on Sunday.");
  if (Date.parse(end) - Date.parse(start) !== 13 * 86400000 || (Date.parse(start) - Date.parse("2026-06-21")) % (14 * 86400000) !== 0) return packetError(400, "Choose a complete 14-day timesheet pay period.");
  return { startDate: start, endDate: end, weekStartsOn: 0 as const };
}
export function hoursHundredths(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d?)(\.\d{1,2})?$/.test(value)) return packetError(400, "Enter hours with at most two decimal places.");
  const [a, b = ""] = value.split("."), result = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (result > 2400) return packetError(400, "Daily hours cannot exceed 24."); return result;
}
export function packetUuid(value: unknown): string { if (typeof value !== "string" || !employeeIdPattern.test(value)) return packetError(400, "Choose a valid payroll record."); return value.toLowerCase(); }
export function packetReason(value: unknown): string { if (!(adjustmentReasons as readonly unknown[]).includes(value)) return packetError(400, "Choose the adjustment reason."); return value as string; }
export function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function weekStart(date: string, startsOn: number) {
  const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - (day.getUTCDay() - startsOn + 7) % 7); return day.toISOString().slice(0, 10);
}
export function packetIssues(snapshot: PacketSnapshot): PacketIssue[] {
  const issues: PacketIssue[] = [], included = snapshot.lines.filter(l => l.included && l.hoursHundredths > 0);
  if (!included.length && !snapshot.paymentSetups?.length && !snapshot.secureDetails?.length) issues.push({ key: "empty", severity: "block", message: "No payable hours or payment arrangements records are included." });
  for (const ref of snapshot.secureDetails ?? []) issues.push({ key: `secure:${ref.employeeId}:${ref.revision}`, severity: ref.status === "approved" ? "review" : "block", message: ref.status === "approved" ? "Review the approved new-hire/payment-details version included in the restricted supplement." : "New-hire/payment details need Payroll/Admin review. Worked hours remain in the packet.", employeeId: ref.employeeId });
  for (const setup of snapshot.paymentSetups ?? []) issues.push({ key: `payment:${setup.employeeId}:${setup.revision}`, severity: "review", message: `Review payment arrangements: ${setup.paymentMethod.replaceAll("_", " ")} (${setup.setupStatus.replaceAll("_", " ")}). Confirm any change with the preparer through the secure enrollment process.`, employeeId: setup.employeeId });
  for (const [employeeId, note] of Object.entries(snapshot.employeeNotes ?? {})) if (note) issues.push({ key: `note:${employeeId}`, severity: "review", message: "Review the payroll note in the employee summary.", employeeId });
  const days = new Map<string, PacketLine[]>();
  for (const line of included) {
    if (line.hourlyRateCents === null) issues.push({ key: `rate:${line.lineId}`, severity: "block", message: "An approved rate is missing for this work date.", employeeId: line.employeeId, lineId: line.lineId });
    if (line.setupStatus !== "ready") issues.push({ key: `setup:${line.employeeId}`, severity: "review", message: line.setupStatus === "awaiting_preparer" ? "Confirm the payroll preparer received this employee's payment instructions. These hours remain included." : line.setupStatus === "on_hold" ? "Review this employee's payment arrangements with the preparer. These hours remain included." : "Record this employee's payment method and preparer confirmation. These hours remain included.", employeeId: line.employeeId });
    const key = `${line.employeeId}:${line.workDate}`; days.set(key, [...days.get(key) ?? [], line]);
  }
  for (const [key, lines] of days) {
    if (lines.reduce((n, l) => n + l.hoursHundredths, 0) > 2400) issues.push({ key: `day:${key}`, severity: "block", message: "Included hours exceed 24 for one employee and day.", employeeId: lines[0].employeeId });
    const intervals = lines.flatMap(l => l.intervals.map(([start, end]) => ({ start, end, lineId: l.lineId }))).sort((a, b) => a.start - b.start);
    let previousEnd = -1;
    for (const interval of intervals) { if (interval.start < previousEnd) { issues.push({ key: `overlap:${key}`, severity: "block", message: "Included source clock intervals overlap. Review duplicates or replace with an explained manual row.", employeeId: lines[0].employeeId }); break; } previousEnd = Math.max(previousEnd, interval.end); }
  }
  for (const line of snapshot.lines) if (line.adjusted || !line.included || !line.timesheetId) issues.push({ key: `adjustment:${line.lineId}`, severity: "review", message: line.included ? "Review a manually entered or adjusted row." : "Review an excluded row; its original hours remain retained.", employeeId: line.employeeId, lineId: line.lineId });
  for (const warning of snapshot.unapproved) issues.push({ key: `unapproved:${warning.timesheetId}`, severity: warning.status === "approved_without_entries" ? "block" : "review", message: warning.status === "approved_without_entries" ? "An approved source timesheet has no daily rows. Resolve the source inconsistency." : "A source timesheet is not approved and was not automatically included.", employeeId: warning.employeeId, employeeName: warning.employeeName, timesheetId: warning.timesheetId });
  return [...new Map(issues.map(i => [i.key, i])).values()];
}
export function assertPacketApproval(snapshot: PacketSnapshot, acknowledged: unknown, confirmed: unknown) {
  if (confirmed !== true || !Array.isArray(acknowledged) || acknowledged.some(v => typeof v !== "string")) return packetError(400, "Confirm the packet and review each exception.");
  const issues = packetIssues(snapshot); if (issues.some(i => i.severity === "block")) return packetError(409, "Resolve blocked payroll exceptions before approval.");
  const expected = issues.filter(i => i.severity === "review").map(i => i.key).sort();
  if (JSON.stringify([...new Set(acknowledged)].sort()) !== JSON.stringify(expected)) return packetError(409, "Review every current exception before approving this version.");
}
export function packetTotals(snapshot: PacketSnapshot) {
  const groups = new Map<string, { employeeId: string; employeeName: string; weekStart: string; hoursHundredths: number; straightTimeEstimateCents: number | null }>();
  for (const line of snapshot.lines.filter(l => l.included)) {
    const week = weekStart(line.workDate, snapshot.weekStartsOn), key = `${line.employeeId}:${week}`;
    const group = groups.get(key) ?? { employeeId: line.employeeId, employeeName: line.employeeName, weekStart: week, hoursHundredths: 0, straightTimeEstimateCents: 0 };
    group.hoursHundredths += line.hoursHundredths;
    group.straightTimeEstimateCents = group.straightTimeEstimateCents === null || line.hourlyRateCents === null ? null : group.straightTimeEstimateCents + Math.round(line.hoursHundredths * line.hourlyRateCents / 100);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.weekStart.localeCompare(b.weekStart));
}
export function packetCsv(snapshot: PacketSnapshot) {
  const escape = (value: unknown) => { const raw = String(value ?? ""); return `"${(/^[\s]*[=+\-@]/.test(raw) ? "'" : "") + raw.replaceAll('"', '""')}"`; };
  const header = ["Employee", "Workforce employee reference", "Preparer employee reference", "Work date", "Workweek start", "Service", "Included", "Reviewed hours", "Original hours", "Approved hourly rate USD", "Reason", "Timesheet reference", "Wage reference"];
  const extra = ["Record type", "Payment method", "Previous recorded method", "Payment arrangements status", "Payment arrangement revision reference", "Payment arrangement updated UTC", "Preparer confirmation date", "Payment arrangement reason"];
  const hours = snapshot.lines.map(l => [l.employeeName, l.employeeId, l.preparerReference, l.workDate, weekStart(l.workDate, snapshot.weekStartsOn), l.serviceType === "respite" ? "In Home Respite" : "Personal Care", l.included ? "Yes" : "No", (l.hoursHundredths / 100).toFixed(2), l.originalHoursHundredths === null ? "" : (l.originalHoursHundredths / 100).toFixed(2), l.hourlyRateCents === null ? "" : (l.hourlyRateCents / 100).toFixed(2), l.reason, l.timesheetId, l.wageChangeId, "Hours", ...Array(7).fill("")]);
  const setups = (snapshot.paymentSetups ?? []).map(p => [p.employeeName, p.employeeId, p.preparerReference, ...Array(10).fill(""), "Payment arrangements", p.paymentMethod, p.previousPaymentMethod, p.setupStatus, p.revision, p.updatedAtUtc, p.confirmedOn, p.reason]);
  return [[...header, ...extra], ...hours, ...setups].map(row => row.map(escape).join(",")).join("\r\n");
}
