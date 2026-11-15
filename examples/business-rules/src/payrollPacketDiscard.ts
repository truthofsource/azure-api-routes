import type { PacketSnapshot } from "./payrollPacketContract";

// A zero-hour packet can still carry payment changes or review notes. Inspect
// every saved version so an earlier edit cannot be mistaken for an empty draft.
export function discardKind(snapshotJsons: string[]): "empty" | "draft" | null {
  if (!snapshotJsons.length) return null;
  let meaningful = false;
  for (const json of snapshotJsons) {
    let value: unknown;
    try { value = JSON.parse(json); } catch { return null; }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as PacketSnapshot;
    const known = new Set(["startDate", "endDate", "weekStartsOn", "sourceHash", "lines", "unapproved", "paymentSetups", "employeeNotes", "secureDetails"]);
    if (Object.keys(snapshot).some(key => !known.has(key)) ||
      !Array.isArray(snapshot.lines) || !Array.isArray(snapshot.unapproved) ||
      (snapshot.paymentSetups !== undefined && !Array.isArray(snapshot.paymentSetups)) ||
      (snapshot.secureDetails !== undefined && !Array.isArray(snapshot.secureDetails)) ||
      (snapshot.employeeNotes !== undefined && (!snapshot.employeeNotes || typeof snapshot.employeeNotes !== "object" || Array.isArray(snapshot.employeeNotes)))) return null;
    meaningful ||= snapshot.lines.length > 0 || snapshot.unapproved.length > 0 ||
      (snapshot.paymentSetups?.length ?? 0) > 0 || (snapshot.secureDetails?.length ?? 0) > 0 ||
      Object.values(snapshot.employeeNotes ?? {}).some(note => typeof note !== "string" || note.trim().length > 0);
  }
  return meaningful ? "draft" : "empty";
}
