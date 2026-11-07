import { clientAssignmentPredicate, centralTodaySql } from "./clientAssignmentAccess";
import sql from "mssql";

// Callers bind the actor from verified claims, never request parameters. A null
// actor is reserved for an explicitly authorized Admin or scoped self-service.
export function teamReviewActor(auth: { roles: readonly string[]; claims: Record<string, unknown> }): string | null {
  if (auth.roles.includes("Workforce.Admin")) return null;
  if (!auth.roles.includes("Workforce.Supervisor") || typeof auth.claims.oid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auth.claims.oid)) return "";
  return auth.claims.oid;
}

// Only static source-code column expressions are accepted. The reporting
// relationship and a date-scoped client relationship must both exist. Missing canonical
// employee/client links never expand a supervisor's view.
export function teamRecordPredicate(employee: string, client: string, start = centralTodaySql, end = start,
  undated = false) {
  if (![employee, client].every(column => /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(column))) throw new Error("Invalid record scope column.");
  // A row without a work date cannot inherit access from a date-scoped
  // appointment or assignment. Only an explicit, unbounded assignment applies.
  const assignment = undated ? `EXISTS (SELECT 1 FROM dbo.employee_client_assignments ca_manual
    WHERE ca_manual.employee_id=${employee} AND ca_manual.client_id=${client}
      AND ca_manual.assignment_status=N'active'
      AND ca_manual.effective_start_date IS NULL AND ca_manual.effective_end_date IS NULL)`
    : clientAssignmentPredicate(employee, client, start, end, true);
  return `(@teamActor IS NULL OR EXISTS (
    SELECT 1 FROM dbo.attendance_routes access_route
    INNER JOIN dbo.employees access_supervisor ON access_supervisor.employee_id=access_route.supervisor_id
    WHERE access_route.employee_id=${employee}
      AND access_supervisor.entra_object_id=@teamActor AND access_supervisor.employment_status=N'active'
      AND NOT EXISTS(SELECT 1 FROM dbo.employees duplicate_account
        WHERE duplicate_account.entra_object_id=@teamActor AND duplicate_account.employee_id<>access_supervisor.employee_id)
      AND ${assignment}
  ))`;
}

export async function lockTeamReviewRecord(transaction: sql.Transaction,
  kind: "timesheet" | "shift_note", recordId: string, actor: string | null) {
  const table = kind === "timesheet" ? "timesheets" : "shift_notes";
  const id = kind === "timesheet" ? "timesheet_id" : "shift_note_id";
  const result = await new sql.Request(transaction).input("recordId", sql.UniqueIdentifier, recordId)
    .input("teamActor", sql.NVarChar(100), actor)
    .query(`SELECT record.${id} FROM dbo.${table} record WITH (UPDLOCK,HOLDLOCK)
      WHERE record.${id}=@recordId AND ${teamRecordPredicate("record.employee_id", "record.client_id", kind === "timesheet" ? "record.pay_period_start_date" : "CONVERT(date,record.shift_start_utc AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time')", kind === "timesheet" ? "record.pay_period_end_date" : "CONVERT(date,record.shift_end_utc AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time')")};`);
  return result.recordset.length === 1;
}
