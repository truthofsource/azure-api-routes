import sql from "mssql";
import { randomUUID } from "node:crypto";
import { EmployeeProfileError, employeeIdPattern } from "../employees/employeeProfiles";
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
const columns = `change_id AS changeId,employee_id AS employeeId,CONVERT(varchar(20),hourly_rate) AS hourlyRate,CONVERT(varchar(20),respite_hourly_rate) AS respiteHourlyRate,CONVERT(char(10),effective_date,23) AS effectiveDate,
 reason,status,requested_by AS requestedBy,approved_by AS approvedBy,approved_at_utc AS approvedAtUtc,revision,baseline_revision AS baselineRevision,created_at_utc AS createdAtUtc`;
export function createWageStore(pool: sql.ConnectionPool) {
  return {
    async resolveSelf(actor: string): Promise<string> {
      const rows = (await pool.request().input("actor", sql.NVarChar(100), actor).query<{ employeeId: string }>(`SELECT TOP(2) employee_id AS employeeId FROM dbo.employees WHERE entra_object_id=@actor AND employment_status IN(N'active',N'onboarding');`)).recordset;
      if (rows.length !== 1) return fail(403, "Your account must be linked to one active employee.");
      return rows[0].employeeId;
    },
    async current(employeeId: string): Promise<WageRow | null> {
      return (await pool.request().input("employee", sql.UniqueIdentifier, employeeId).query<WageRow>(`SELECT TOP(1) ${columns} FROM dbo.employee_wage_changes WHERE employee_id=@employee AND status=N'approved'
        AND effective_date<=CONVERT(date,SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time') ORDER BY effective_date DESC,approved_at_utc DESC,change_id DESC;`)).recordset[0] ?? null;
    },
    async list(employeeId: string): Promise<{ employeeId: string; changes: WageRow[]; current: WageRow | null; baselineRevision: string | null }> {
      const req = () => pool.request().input("employee", sql.UniqueIdentifier, employeeId);
      const changes = (await req().query<WageRow>(`SELECT TOP(100) ${columns} FROM dbo.employee_wage_changes WHERE employee_id=@employee ORDER BY created_at_utc DESC,change_id DESC;`)).recordset;
      const current = (await req().query<WageRow>(`SELECT TOP(1) ${columns} FROM dbo.employee_wage_changes WHERE employee_id=@employee AND status=N'approved'
        AND effective_date<=CONVERT(date,SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time') ORDER BY effective_date DESC,approved_at_utc DESC,change_id DESC;`)).recordset[0] ?? null;
      const baseline = (await req().query<{ revision: string }>(`SELECT TOP(1) revision FROM dbo.employee_wage_changes WHERE employee_id=@employee AND status=N'approved' ORDER BY approved_at_utc DESC,change_id DESC;`)).recordset[0]?.revision ?? null;
      return { employeeId, changes: [...changes], current, baselineRevision: baseline };
    },
    async save(input: WageInput, actor: string, roles: readonly string[], requestId: string): Promise<WageRow> {
      const tx = new sql.Transaction(pool); let active = false;
      try {
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); active = true;
        const req = () => new sql.Request(tx).input("employee", sql.UniqueIdentifier, input.employeeId).input("id", sql.UniqueIdentifier, input.changeId);
        const employee = (await req().query<{ status: string }>(`SELECT employment_status AS status FROM dbo.employees WITH(UPDLOCK,HOLDLOCK) WHERE employee_id=@employee;`)).recordset[0];
        if (!employee) return fail(404, "Employee not found.");
        const row = (await req().query<WageRow>(`SELECT ${columns} FROM dbo.employee_wage_changes WITH(UPDLOCK,HOLDLOCK) WHERE change_id=@id;`)).recordset[0];
        if (row && row.employeeId.toLowerCase() !== input.employeeId.toLowerCase()) return fail(409, "This request belongs to another employee.");
        if ((input.action === "request" || input.action === "set") && row) {
          if (row.requestedBy.toLowerCase() !== actor.toLowerCase() || row.status !== (input.action === "set" ? "approved" : "pending") || row.hourlyRate !== input.hourlyRate || (row.respiteHourlyRate ?? null) !== (input.respiteHourlyRate ?? null) || row.effectiveDate !== input.effectiveDate || row.reason !== input.reason || row.baselineRevision?.toLowerCase() !== input.baselineRevision?.toLowerCase()) return fail(409, "This request identifier was already used for different details.");
          await tx.rollback(); active = false; return row;
        }
        if (input.action !== "cancel") {
          if (!["active", "onboarding", "on_leave"].includes(employee.status)) return fail(409, "Review this employee's employment status before changing wages.");
          const leaving = (await req().query(`SELECT TOP(1) offboarding_case_id FROM dbo.employee_offboarding_cases WHERE employee_id=@employee AND status IN(N'draft',N'pending_approval',N'scheduled',N'in_progress');`)).recordset;
          if (leaving.length) return fail(409, "Resolve the open offboarding case before changing wages.");
        }
        const baseline = (await req().query<{ revision: string }>(`SELECT TOP(1) revision FROM dbo.employee_wage_changes WITH(UPDLOCK,HOLDLOCK) WHERE employee_id=@employee AND status=N'approved' ORDER BY approved_at_utc DESC,change_id DESC;`)).recordset[0]?.revision ?? null;
        if (!("revision" in input)) {
          if (baseline?.toLowerCase() !== input.baselineRevision?.toLowerCase()) return fail(409, "Approved wage history changed. Reload before requesting a change.");
          if ((await req().query(`SELECT change_id FROM dbo.employee_wage_changes WHERE employee_id=@employee AND status=N'pending';`)).recordset.length) return fail(409, "Review or cancel the existing pending wage change first.");
          await req().input("rate", sql.Decimal(10, 2), input.hourlyRate).input("respiteRate", sql.Decimal(10, 2), input.respiteHourlyRate ?? null).input("date", sql.Date, input.effectiveDate).input("reason", sql.NVarChar(30), input.reason)
            .input("baseline", sql.UniqueIdentifier, baseline).input("actor", sql.UniqueIdentifier, actor).input("revision", sql.UniqueIdentifier, randomUUID())
            .input("status", sql.NVarChar(20), input.action === "set" ? "approved" : "pending")
            .query(`INSERT dbo.employee_wage_changes(change_id,employee_id,hourly_rate,respite_hourly_rate,effective_date,reason,status,requested_by,approved_by,approved_at_utc,revision,baseline_revision)
              VALUES(@id,@employee,@rate,@respiteRate,@date,@reason,@status,@actor,CASE WHEN @status=N'approved' THEN @actor ELSE NULL END,CASE WHEN @status=N'approved' THEN SYSUTCDATETIME() ELSE NULL END,@revision,@baseline);`);
        } else {
          if (!row) return fail(404, "Wage change not found."); validateWageDecision(row, input, actor, roles);
          if (input.action === "approve" && row.baselineRevision?.toLowerCase() !== baseline?.toLowerCase()) return fail(409, "Approved wage history changed. Cancel and replace this request.");
          await req().input("status", sql.NVarChar(20), input.action === "approve" ? "approved" : "cancelled").input("actor", sql.UniqueIdentifier, actor).input("revision", sql.UniqueIdentifier, randomUUID())
            .query(`UPDATE dbo.employee_wage_changes SET status=@status,revision=@revision,approved_by=CASE WHEN @status=N'approved' THEN @actor ELSE NULL END,
              approved_at_utc=CASE WHEN @status=N'approved' THEN SYSUTCDATETIME() ELSE NULL END WHERE change_id=@id;`);
        }
        await req().input("actor", sql.NVarChar(100), actor).input("request", sql.NVarChar(100), requestId).input("action", sql.NVarChar(50), `payroll.wage_${input.action}`)
          .query(`INSERT dbo.audit_events(actor_type,actor_object_id,action,entity_type,entity_id,correlation_id,metadata_json)
            VALUES(N'user',@actor,@action,N'employee_wage_change',CONVERT(nvarchar(100),@id),@request,(SELECT CONVERT(nvarchar(36),@employee) AS employeeId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));`);
        const result = (await req().query<WageRow>(`SELECT ${columns} FROM dbo.employee_wage_changes WHERE change_id=@id;`)).recordset[0];
        await tx.commit(); active = false; return result;
      } catch (error) { if (active) try { await tx.rollback(); } catch { /* SQL may already have rolled back. */ } throw error; }
    },
  };
}
