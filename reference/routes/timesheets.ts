import { verifyClientWorkDates, ClientAssignmentDenied } from "../auth/clientAssignmentAccess";
import { withReturnedRecordAudit } from "../auth/returnedRecordAudit";
import { parseReportPeople, parseReportDates } from "../reports/reportFilters";
import { teamReviewActor, teamRecordPredicate } from "../auth/teamRecordAccess";
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { requireAnyAppRole } from "../auth/requireAppRole";
import { getSqlPool } from "../db/sqlPool";

const adminRole = "Workforce.Admin";
const supervisorRole = "Workforce.Supervisor";
const caregiverRole = "Workforce.Caregiver";

const timesheetSubmitRoles = [caregiverRole, adminRole] as const;
const timesheetListRoles = [supervisorRole, adminRole, "Workforce.HR"] as const;
const myTimesheetRoles = [caregiverRole, adminRole] as const;

const allowedStatuses = new Set([
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "needs_correction",
]);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const payPeriodAnchorStartDate = "2026-06-21";
const payPeriodLengthDays = 14;

const allowedTimesheetServiceTypes = new Set(["regular", "respite"]);

type TimesheetEntryInput = {
  workDate?: unknown;
  serviceType?: unknown;
  timeIn1?: unknown;
  timeOut1?: unknown;
  timeIn2?: unknown;
  timeOut2?: unknown;
  taskId?: unknown;
  notes?: unknown;
};

type ValidatedTimesheetEntry = {
  workDate: string;
  serviceType: string;
  timeIn1: string;
  timeOut1: string;
  timeIn2: string | null;
  timeOut2: string | null;
  taskId: string | null;
  totalHours: number;
  notes: string | null;
};

type TimesheetBody = {
  employeeId?: unknown;
  clientId?: unknown;
  department?: unknown;
  payPeriodStartDate?: unknown;
  payPeriodEndDate?: unknown;
  entries?: unknown;
  employeeAttestationAccepted?: unknown;
  employeeAttestedByName?: unknown;
  clientAttestationObtained?: unknown;
  clientAttestedByName?: unknown;
};

type ResolvedEmployee = {
  employeeId: string;
  source: "admin_request_body" | "entra_object_id_mapping";
};

function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
  };
}

function getClaimString(claims: Record<string, unknown>, claimName: string) {
  const value = claims[claimName];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
}

function getRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  const trimmed = getOptionalString(value, fieldName, maxLength);

  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmed;
}

function getRequiredUuid(value: unknown, fieldName: string): string {
  const trimmed = getRequiredString(value, fieldName, 36);

  if (!uuidPattern.test(trimmed)) {
    throw new Error(`${fieldName} must be a valid GUID.`);
  }

  return trimmed;
}

function getOptionalUuid(value: unknown, fieldName: string): string | null {
  const trimmed = getOptionalString(value, fieldName, 36);

  if (!trimmed) {
    return null;
  }

  if (!uuidPattern.test(trimmed)) {
    throw new Error(`${fieldName} must be a valid GUID.`);
  }

  return trimmed;
}

function getRequiredDate(value: unknown, fieldName: string): string {
  const trimmed = getRequiredString(value, fieldName, 10);

  if (!datePattern.test(trimmed)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error(`${fieldName} must be a valid calendar date.`);
  }

  return trimmed;
}

function toDateUtc(dateValue: string): Date {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

function differenceInDays(startDate: string, endDate: string): number {
  const start = toDateUtc(startDate).getTime();
  const end = toDateUtc(endDate).getTime();

  return Math.round((end - start) / 86_400_000);
}

function isDateInRange(dateValue: string, startDate: string, endDate: string) {
  const date = toDateUtc(dateValue).getTime();

  return date >= toDateUtc(startDate).getTime() && date <= toDateUtc(endDate).getTime();
}

function addDays(dateValue: string, days: number) {
  const date = toDateUtc(dateValue);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function validatePayPeriodCycle(
  payPeriodStartDate: string,
  payPeriodEndDate: string
): string | null {
  const payPeriodDays =
    differenceInDays(payPeriodStartDate, payPeriodEndDate) + 1;

  if (payPeriodDays !== payPeriodLengthDays) {
    return `Pay period must be exactly ${payPeriodLengthDays} calendar days.`;
  }

  const expectedEndDate = addDays(
    payPeriodStartDate,
    payPeriodLengthDays - 1
  );

  if (payPeriodEndDate !== expectedEndDate) {
    return `payPeriodEndDate must equal payPeriodStartDate plus ${
      payPeriodLengthDays - 1
    } days. Expected ${expectedEndDate}.`;
  }

  const daysSinceAnchor = differenceInDays(
    payPeriodAnchorStartDate,
    payPeriodStartDate
  );

  if (daysSinceAnchor % payPeriodLengthDays !== 0) {
    return `payPeriodStartDate must align to the Example organization 14-day pay period cycle anchored at ${payPeriodAnchorStartDate}.`;
  }

  return null;
}

function getBoolean(value: unknown, fieldName: string, defaultValue = false): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be true or false.`);
  }

  return value;
}

function getTimesheetServiceType(value: unknown, fieldName: string): string {
  const serviceType = getOptionalString(value, fieldName, 50) ?? "regular";

  if (!allowedTimesheetServiceTypes.has(serviceType)) {
    throw new Error(
      `${fieldName} must be one of: ${Array.from(allowedTimesheetServiceTypes).join(", ")}.`
    );
  }

  return serviceType;
}

function normalizeTime(value: unknown, fieldName: string): string {
  const trimmed = getRequiredString(value, fieldName, 8);

  if (!timePattern.test(trimmed)) {
    throw new Error(`${fieldName} must use HH:MM or HH:MM:SS 24-hour format.`);
  }

  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function normalizeOptionalTime(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeTime(value, fieldName);
}

function timeToMinutes(timeValue: string): number {
  const [hoursRaw, minutesRaw] = timeValue.split(":");

  return Number(hoursRaw) * 60 + Number(minutesRaw);
}

function calculateEntryHours(
  timeIn1: string,
  timeOut1: string,
  timeIn2: string | null,
  timeOut2: string | null
): number {
  const firstMinutes = timeToMinutes(timeOut1) - timeToMinutes(timeIn1);

  if (firstMinutes <= 0) {
    throw new Error("timeOut1 must be after timeIn1.");
  }

  let totalMinutes = firstMinutes;

  if ((timeIn2 && !timeOut2) || (!timeIn2 && timeOut2)) {
    throw new Error("timeIn2 and timeOut2 must both be provided when using a second time block.");
  }

  if (timeIn2 && timeOut2) {
    const secondMinutes = timeToMinutes(timeOut2) - timeToMinutes(timeIn2);

    if (secondMinutes <= 0) {
      throw new Error("timeOut2 must be after timeIn2.");
    }

    totalMinutes += secondMinutes;
  }

  if (totalMinutes > 24 * 60) {
    throw new Error("A single timesheet entry cannot exceed 24 hours.");
  }

  return Math.round((totalMinutes / 60) * 100) / 100;
}

function validateEntries(
  entries: unknown,
  payPeriodStartDate: string,
  payPeriodEndDate: string
): ValidatedTimesheetEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("entries must contain at least one daily timesheet entry.");
  }

  if (entries.length > 28) {
    throw new Error("entries cannot contain more than 28 rows for one timesheet.");
  }

  const seenDateServiceTypes = new Set<string>();

  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`entries[${index}] must be an object.`);
    }

    const typedEntry = entry as TimesheetEntryInput;

    const workDate = getRequiredDate(typedEntry.workDate, `entries[${index}].workDate`);

    if (!isDateInRange(workDate, payPeriodStartDate, payPeriodEndDate)) {
      throw new Error(`entries[${index}].workDate must be inside the pay period.`);
    }

    const serviceType = getTimesheetServiceType(
      typedEntry.serviceType,
      `entries[${index}].serviceType`
    );
    const dateServiceKey = `${workDate}|${serviceType}`;

    if (seenDateServiceTypes.has(dateServiceKey)) {
      throw new Error(
        `Duplicate workDate and serviceType combination is not allowed: ${workDate} / ${serviceType}.`
      );
    }

    seenDateServiceTypes.add(dateServiceKey);

    const timeIn1 = normalizeTime(typedEntry.timeIn1, `entries[${index}].timeIn1`);
    const timeOut1 = normalizeTime(typedEntry.timeOut1, `entries[${index}].timeOut1`);
    const timeIn2 = normalizeOptionalTime(typedEntry.timeIn2, `entries[${index}].timeIn2`);
    const timeOut2 = normalizeOptionalTime(typedEntry.timeOut2, `entries[${index}].timeOut2`);
    const taskId = getOptionalString(typedEntry.taskId, `entries[${index}].taskId`, 100);
    const notes = getOptionalString(typedEntry.notes, `entries[${index}].notes`, 1000);
    const totalHours = calculateEntryHours(timeIn1, timeOut1, timeIn2, timeOut2);

    return {
      workDate,
      serviceType,
      timeIn1,
      timeOut1,
      timeIn2,
      timeOut2,
      taskId,
      totalHours,
      notes,
    };
  });
}

function calculateTotals(
  entries: ValidatedTimesheetEntry[],
  payPeriodStartDate: string
) {
  const weekTwoStart = new Date(toDateUtc(payPeriodStartDate).getTime() + 7 * 86_400_000);

  let week1TotalHours = 0;
  let week2TotalHours = 0;
  let regularTotalHours = 0;
  let respiteTotalHours = 0;

  for (const entry of entries) {
    if (toDateUtc(entry.workDate).getTime() < weekTwoStart.getTime()) {
      week1TotalHours += entry.totalHours;
    } else {
      week2TotalHours += entry.totalHours;
    }

    if (entry.serviceType === "respite") {
      respiteTotalHours += entry.totalHours;
    } else {
      regularTotalHours += entry.totalHours;
    }
  }

  week1TotalHours = Math.round(week1TotalHours * 100) / 100;
  week2TotalHours = Math.round(week2TotalHours * 100) / 100;
  regularTotalHours = Math.round(regularTotalHours * 100) / 100;
  respiteTotalHours = Math.round(respiteTotalHours * 100) / 100;

  return {
    week1TotalHours,
    week2TotalHours,
    regularTotalHours,
    respiteTotalHours,
    totalHours: Math.round((week1TotalHours + week2TotalHours) * 100) / 100,
  };
}

function formatSqlDate(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function formatSqlTime(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(11, 19);
  }

  return String(value).slice(0, 8);
}

function parseEntriesJson(entriesJson: unknown) {
  if (typeof entriesJson !== "string" || entriesJson.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(entriesJson);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => ({
      timesheetEntryId: entry.timesheetEntryId,
      workDate: formatSqlDate(entry.workDate),
      serviceType: entry.serviceType ?? "regular",
      timeIn1: formatSqlTime(entry.timeIn1),
      timeOut1: formatSqlTime(entry.timeOut1),
      timeIn2: formatSqlTime(entry.timeIn2),
      timeOut2: formatSqlTime(entry.timeOut2),
      taskId: entry.taskId ?? null,
      totalHours: Number(entry.totalHours ?? 0),
      notes: entry.notes ?? null,
    }));
  } catch {
    return [];
  }
}

function mapTimesheetRow(row: Record<string, any>) {
  return {
    timesheetId: row.timesheet_id,
    employeeId: row.employee_id,
    clientId: row.client_id,
    employeeName: [row.employee_first_name, row.employee_last_name]
      .filter(Boolean)
      .join(" ")
      .trim(),
    clientName: [row.client_first_name, row.client_last_name]
      .filter(Boolean)
      .join(" ")
      .trim(),
    department: row.department,
    payPeriodStartDate: formatSqlDate(row.pay_period_start_date),
    payPeriodEndDate: formatSqlDate(row.pay_period_end_date),
    status: row.status,
    week1TotalHours: Number(row.week1_total_hours ?? 0),
    week2TotalHours: Number(row.week2_total_hours ?? 0),
    regularTotalHours: Number(row.regular_total_hours ?? row.total_hours ?? 0),
    respiteTotalHours: Number(row.respite_total_hours ?? 0),
    totalHours: Number(row.total_hours ?? 0),
    employeeAttestationAccepted: Boolean(row.employee_attestation_accepted),
    employeeAttestedByName: row.employee_attested_by_name,
    employeeAttestedAtUtc: row.employee_attested_at_utc,
    clientAttestationObtained: Boolean(row.client_attestation_obtained),
    clientAttestedByName: row.client_attested_by_name,
    clientAttestedAtUtc: row.client_attested_at_utc,
    submittedAtUtc: row.submitted_at_utc,
    reviewedAtUtc: row.reviewed_at_utc,
    reviewedByObjectId: row.reviewed_by_object_id,
    reviewNotes: row.review_notes,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    entries: parseEntriesJson(row.entries_json),
  };
}

function parsePaging(request: HttpRequest) {
  const url = new URL(request.url);
  const pageRaw = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(pageSizeRaw, 100)
      : 25;

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

function getStatusFilter(request: HttpRequest) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  if (!status) {
    return null;
  }

  if (!allowedStatuses.has(status)) {
    throw new Error(
      `status must be one of: ${Array.from(allowedStatuses).join(", ")}.`
    );
  }

  return status;
}

async function resolveEmployeeForSubmit(
  pool: sql.ConnectionPool,
  body: TimesheetBody,
  submitterObjectId: string | null,
  roles: string[]
): Promise<ResolvedEmployee> {
  const isAdmin = roles.includes(adminRole);
  const requestedEmployeeId = getOptionalUuid(body.employeeId, "employeeId");

  if (requestedEmployeeId) {
    if (!isAdmin) {
      throw new Error("employeeId can only be supplied by admins.");
    }

    const employeeResult = await pool.request()
      .input("employeeId", sql.UniqueIdentifier, requestedEmployeeId)
      .query(`
        SELECT TOP 1 employee_id
        FROM dbo.employees
        WHERE employee_id = @employeeId;
      `);

    if (employeeResult.recordset.length === 0) {
      throw new Error("employeeId was not found.");
    }

    return {
      employeeId: requestedEmployeeId,
      source: "admin_request_body",
    };
  }

  if (!submitterObjectId) {
    throw new Error("Authenticated user token does not include an object ID.");
  }

  const employeeResult = await pool.request()
    .input("submitterObjectId", sql.NVarChar(100), submitterObjectId)
    .query(`
      SELECT TOP 1 employee_id
      FROM dbo.employees
      WHERE entra_object_id = @submitterObjectId;
    `);

  if (employeeResult.recordset.length === 0) {
    throw new Error("Authenticated user is not mapped to an employee record.");
  }

  return {
    employeeId: employeeResult.recordset[0].employee_id,
    source: "entra_object_id_mapping",
  };
}

async function verifyClientForSubmit(
  pool: sql.ConnectionPool,
  clientId: string
) {
  const clientResult = await pool.request()
    .input("clientId", sql.UniqueIdentifier, clientId)
    .query(`
      SELECT TOP 1 client_id
      FROM dbo.clients
      WHERE client_id = @clientId;
    `);

  if (clientResult.recordset.length === 0) {
    throw new Error("clientId was not found.");
  }
}

async function insertAuditEvent(
  transaction: sql.Transaction,
  actorObjectId: string | null,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>
) {
  await new sql.Request(transaction)
    .input("actorObjectId", sql.NVarChar(100), actorObjectId)
    .input("action", sql.NVarChar(100), action)
    .input("entityType", sql.NVarChar(100), "timesheet")
    .input("entityId", sql.UniqueIdentifier, entityId)
    .input("metadataJson", sql.NVarChar(sql.MAX), JSON.stringify(metadata))
    .query(`
      INSERT INTO dbo.audit_events (
        actor_object_id,
        action,
        entity_type,
        entity_id,
        metadata_json
      )
      VALUES (
        @actorObjectId,
        @action,
        @entityType,
        @entityId,
        @metadataJson
      );
    `);
}

export async function listTimesheets(
  pool: sql.ConnectionPool,
  options: {
    status: string | null;
    page: number;
    pageSize: number;
    offset: number;
    employeeId?: string | null;
    teamActor?: string | null;
    report?: ReturnType<typeof parseReportPeople> & ReturnType<typeof parseReportDates>;
  }
) {
  const countRequest = pool.request()
    .input("teamActor", sql.NVarChar(100), options.teamActor === undefined ? (options.employeeId ? null : "") : options.teamActor)
    .input("status", sql.NVarChar(50), options.status)
    .input("employeeId", sql.UniqueIdentifier, options.employeeId ?? null)
    .input("reportEmployeeName", sql.NVarChar(202), options.report?.employeeName ?? null)
    .input("reportClientName", sql.NVarChar(202), options.report?.clientName ?? null)
    .input("reportStartDate", sql.Date, options.report?.startDate ?? null)
    .input("reportEndDate", sql.Date, options.report?.endDate ?? null);

  const listRequest = pool.request()
    .input("teamActor", sql.NVarChar(100), options.teamActor === undefined ? (options.employeeId ? null : "") : options.teamActor)
    .input("status", sql.NVarChar(50), options.status)
    .input("employeeId", sql.UniqueIdentifier, options.employeeId ?? null)
    .input("reportEmployeeName", sql.NVarChar(202), options.report?.employeeName ?? null)
    .input("reportClientName", sql.NVarChar(202), options.report?.clientName ?? null)
    .input("reportStartDate", sql.Date, options.report?.startDate ?? null)
    .input("reportEndDate", sql.Date, options.report?.endDate ?? null)
    .input("offset", sql.Int, options.offset)
    .input("pageSize", sql.Int, options.pageSize);

  const whereClause = `
    WHERE (@status IS NULL OR t.status = @status)
      AND ${teamRecordPredicate("t.employee_id", "t.client_id", "t.pay_period_start_date", "t.pay_period_end_date")}
      AND (@employeeId IS NULL OR t.employee_id = @employeeId)
      AND (@reportEmployeeName IS NULL OR CONCAT(e.first_name,N' ',e.last_name) LIKE @reportEmployeeName ESCAPE N'~')
      AND (@reportClientName IS NULL OR CONCAT(c.first_name,N' ',c.last_name) LIKE @reportClientName ESCAPE N'~')
      AND (@reportStartDate IS NULL OR t.pay_period_end_date >= @reportStartDate)
      AND (@reportEndDate IS NULL OR t.pay_period_start_date <= @reportEndDate)
  `;

  const countResult = await countRequest.query(`
    SELECT COUNT_BIG(1) AS total_count
    FROM dbo.timesheets AS t
    INNER JOIN dbo.employees e ON e.employee_id=t.employee_id
    INNER JOIN dbo.clients c ON c.client_id=t.client_id
    ${whereClause};
  `);

  const listResult = await listRequest.query(`
    SELECT
      t.timesheet_id,
      t.employee_id,
      t.client_id,
      e.first_name AS employee_first_name,
      e.last_name AS employee_last_name,
      c.first_name AS client_first_name,
      c.last_name AS client_last_name,
      t.department,
      t.pay_period_start_date,
      t.pay_period_end_date,
      t.status,
      t.week1_total_hours,
      t.week2_total_hours,
      t.regular_total_hours,
      t.respite_total_hours,
      t.total_hours,
      t.employee_attestation_accepted,
      t.employee_attested_by_name,
      t.employee_attested_at_utc,
      t.client_attestation_obtained,
      t.client_attested_by_name,
      t.client_attested_at_utc,
      t.submitted_at_utc,
      t.reviewed_at_utc,
      t.reviewed_by_object_id,
      t.review_notes,
      t.created_at_utc,
      t.updated_at_utc,
      (
        SELECT
          te.timesheet_entry_id AS timesheetEntryId,
          te.work_date AS workDate,
          te.service_type AS serviceType,
          CONVERT(varchar(8), te.time_in_1, 108) AS timeIn1,
          CONVERT(varchar(8), te.time_out_1, 108) AS timeOut1,
          CONVERT(varchar(8), te.time_in_2, 108) AS timeIn2,
          CONVERT(varchar(8), te.time_out_2, 108) AS timeOut2,
          te.task_id AS taskId,
          te.total_hours AS totalHours,
          te.notes
        FROM dbo.timesheet_entries AS te
        WHERE te.timesheet_id = t.timesheet_id
        ORDER BY te.work_date
        FOR JSON PATH
      ) AS entries_json
    FROM dbo.timesheets AS t
    INNER JOIN dbo.employees AS e
      ON e.employee_id = t.employee_id
    INNER JOIN dbo.clients AS c
      ON c.client_id = t.client_id
    ${whereClause}
    ORDER BY
      COALESCE(t.submitted_at_utc, t.created_at_utc) DESC,
      t.created_at_utc DESC,
      t.timesheet_id
    OFFSET @offset ROWS
    FETCH NEXT @pageSize ROWS ONLY;
  `);

  return {
    timesheets: listResult.recordset.map(mapTimesheetRow),
    paging: {
      page: options.page,
      pageSize: options.pageSize,
      totalCount: Number(countResult.recordset[0]?.total_count ?? 0),
    },
  };
}

async function createTimesheet(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const roleResult = await requireAnyAppRole(request, timesheetSubmitRoles);

  if (!roleResult.ok) {
    return roleResult;
  }

  let body: TimesheetBody;

  try {
    body = (await request.json()) as TimesheetBody;
  } catch {
    return json(400, {
      ok: false,
      error: "Request body must be valid JSON.",
    });
  }

  try {
    const submitterObjectId = getClaimString(roleResult.claims, "oid");
    const clientId = getRequiredUuid(body.clientId, "clientId");
    const department = getOptionalString(body.department, "department", 150);
    const payPeriodStartDate = getRequiredDate(
      body.payPeriodStartDate,
      "payPeriodStartDate"
    );
    const payPeriodEndDate = getRequiredDate(
      body.payPeriodEndDate,
      "payPeriodEndDate"
    );

    const payPeriodCycleError = validatePayPeriodCycle(
      payPeriodStartDate,
      payPeriodEndDate
    );

    if (payPeriodCycleError) {
      return json(400, {
        ok: false,
        error: payPeriodCycleError,
        payPeriodRule: {
          anchorStartDate: payPeriodAnchorStartDate,
          lengthDays: payPeriodLengthDays,
        },
      });
    }

    const employeeAttestationAccepted = getBoolean(
      body.employeeAttestationAccepted,
      "employeeAttestationAccepted"
    );

    if (!employeeAttestationAccepted) {
      return json(400, {
        ok: false,
        error: "employeeAttestationAccepted must be true before submitting a timesheet.",
      });
    }

    const employeeAttestedByName = getRequiredString(
      body.employeeAttestedByName,
      "employeeAttestedByName",
      200
    );

    const clientAttestationObtained = getBoolean(
      body.clientAttestationObtained,
      "clientAttestationObtained",
      false
    );

    const clientAttestedByName = clientAttestationObtained
      ? getRequiredString(body.clientAttestedByName, "clientAttestedByName", 200)
      : getOptionalString(body.clientAttestedByName, "clientAttestedByName", 200);

    const entries = validateEntries(
      body.entries,
      payPeriodStartDate,
      payPeriodEndDate
    );
    const totals = calculateTotals(entries, payPeriodStartDate);

    const pool = await getSqlPool();
    const resolvedEmployee = await resolveEmployeeForSubmit(
      pool,
      body,
      submitterObjectId,
      roleResult.roles
    );

    await verifyClientForSubmit(pool, clientId);

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      if (!roleResult.roles.includes(adminRole)) await verifyClientWorkDates(transaction, resolvedEmployee.employeeId, clientId, entries.map(entry => entry.workDate));

      const insertTimesheetResult = await new sql.Request(transaction)
        .input("employeeId", sql.UniqueIdentifier, resolvedEmployee.employeeId)
        .input("clientId", sql.UniqueIdentifier, clientId)
        .input("department", sql.NVarChar(150), department)
        .input("payPeriodStartDate", sql.Date, payPeriodStartDate)
        .input("payPeriodEndDate", sql.Date, payPeriodEndDate)
        .input("week1TotalHours", sql.Decimal(9, 2), totals.week1TotalHours)
        .input("week2TotalHours", sql.Decimal(9, 2), totals.week2TotalHours)
        .input("regularTotalHours", sql.Decimal(9, 2), totals.regularTotalHours)
        .input("respiteTotalHours", sql.Decimal(9, 2), totals.respiteTotalHours)
        .input("totalHours", sql.Decimal(9, 2), totals.totalHours)
        .input("employeeAttestationAccepted", sql.Bit, employeeAttestationAccepted)
        .input("employeeAttestedByName", sql.NVarChar(200), employeeAttestedByName)
        .input("clientAttestationObtained", sql.Bit, clientAttestationObtained)
        .input("clientAttestedByName", sql.NVarChar(200), clientAttestedByName)
        .query(`
          INSERT INTO dbo.timesheets (
            employee_id,
            client_id,
            department,
            pay_period_start_date,
            pay_period_end_date,
            status,
            week1_total_hours,
            week2_total_hours,
            regular_total_hours,
            respite_total_hours,
            total_hours,
            employee_attestation_accepted,
            employee_attested_by_name,
            employee_attested_at_utc,
            client_attestation_obtained,
            client_attested_by_name,
            client_attested_at_utc,
            submitted_at_utc
          )
          OUTPUT INSERTED.timesheet_id
          VALUES (
            @employeeId,
            @clientId,
            @department,
            @payPeriodStartDate,
            @payPeriodEndDate,
            N'submitted',
            @week1TotalHours,
            @week2TotalHours,
            @regularTotalHours,
            @respiteTotalHours,
            @totalHours,
            @employeeAttestationAccepted,
            @employeeAttestedByName,
            SYSUTCDATETIME(),
            @clientAttestationObtained,
            @clientAttestedByName,
            CASE WHEN @clientAttestationObtained = 1 THEN SYSUTCDATETIME() ELSE NULL END,
            SYSUTCDATETIME()
          );
        `);

      const timesheetId = insertTimesheetResult.recordset[0].timesheet_id as string;

      for (const entry of entries) {
        await new sql.Request(transaction)
          .input("timesheetId", sql.UniqueIdentifier, timesheetId)
          .input("workDate", sql.Date, entry.workDate)
          .input("serviceType", sql.NVarChar(50), entry.serviceType)
          .input("timeIn1", sql.VarChar(8), entry.timeIn1)
          .input("timeOut1", sql.VarChar(8), entry.timeOut1)
          .input("timeIn2", sql.VarChar(8), entry.timeIn2)
          .input("timeOut2", sql.VarChar(8), entry.timeOut2)
          .input("taskId", sql.NVarChar(100), entry.taskId)
          .input("totalHours", sql.Decimal(9, 2), entry.totalHours)
          .input("notes", sql.NVarChar(sql.MAX), entry.notes)
          .query(`
            INSERT INTO dbo.timesheet_entries (
              timesheet_id,
              work_date,
              service_type,
              time_in_1,
              time_out_1,
              time_in_2,
              time_out_2,
              task_id,
              total_hours,
              notes
            )
            VALUES (
              @timesheetId,
              @workDate,
              @serviceType,
              CAST(@timeIn1 AS time(0)),
              CAST(@timeOut1 AS time(0)),
              CASE WHEN @timeIn2 IS NULL THEN NULL ELSE CAST(@timeIn2 AS time(0)) END,
              CASE WHEN @timeOut2 IS NULL THEN NULL ELSE CAST(@timeOut2 AS time(0)) END,
              @taskId,
              @totalHours,
              @notes
            );
          `);
      }

      await insertAuditEvent(
        transaction,
        submitterObjectId,
        "timesheet.submitted",
        timesheetId,
        {
          employeeId: resolvedEmployee.employeeId,
          clientId,
          employeeSource: resolvedEmployee.source,
          payPeriodStartDate,
          payPeriodEndDate,
          entryCount: entries.length,
          regularTotalHours: totals.regularTotalHours,
          respiteTotalHours: totals.respiteTotalHours,
          totalHours: totals.totalHours,
          roles: roleResult.roles,
        }
      );

      await transaction.commit();

      return json(201, {
        ok: true,
        timesheet: {
          timesheetId,
          employeeId: resolvedEmployee.employeeId,
          clientId,
          department,
          payPeriodStartDate,
          payPeriodEndDate,
          status: "submitted",
          week1TotalHours: totals.week1TotalHours,
          week2TotalHours: totals.week2TotalHours,
          regularTotalHours: totals.regularTotalHours,
          respiteTotalHours: totals.respiteTotalHours,
          totalHours: totals.totalHours,
          employeeAttestationAccepted,
          employeeAttestedByName,
          clientAttestationObtained,
          clientAttestedByName,
          entries,
        },
        audit: {
          action: "timesheet.submitted",
        },
        auth: {
          requiredRoles: roleResult.requiredRoles,
          roles: roleResult.roles,
          objectId: submitterObjectId,
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    if (error instanceof ClientAssignmentDenied) return json(403, { ok: false, error: error.message });
    const message = error instanceof Error ? error.message : "Unknown error.";
    const duplicateMessage =
      message.includes("UX_timesheets_employee_client_period")
        ? "A timesheet already exists for this employee, client, and pay period."
        : message;

    context.error("Timesheet submit failed.", error);

    return json(400, {
      ok: false,
      error: duplicateMessage,
    });
  }
}

async function listTimesheetsForReview(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const roleResult = await requireAnyAppRole(request, timesheetListRoles);

  if (!roleResult.ok) {
    return roleResult;
  }

  try {
    const status = getStatusFilter(request);
    const paging = parsePaging(request);
    const report = { ...parseReportPeople(request.query), ...parseReportDates(request.query) };
    const pool = await getSqlPool();
    const result = await listTimesheets(pool, {
      status,
      ...paging,
      employeeId: null, report, teamActor: roleResult.roles.includes("Workforce.HR") ? null : teamReviewActor(roleResult),
    });

    return json(200, {
      ok: true,
      ...result,
      auth: {
        requiredRoles: roleResult.requiredRoles,
        roles: roleResult.roles,
      },
    });
  } catch (error) {
    context.error("Timesheet list failed.", error);

    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error.",
    });
  }
}

async function listMyTimesheets(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const roleResult = await requireAnyAppRole(request, myTimesheetRoles);

  if (!roleResult.ok) {
    return roleResult;
  }

  try {
    const status = getStatusFilter(request);
    const paging = parsePaging(request);
    const url = new URL(request.url);
    const requestedEmployeeId = getOptionalUuid(url.searchParams.get("employeeId"), "employeeId");
    const submitterObjectId = getClaimString(roleResult.claims, "oid");

    const pool = await getSqlPool();
    let employeeId: string | null = null;

    if (roleResult.roles.includes(adminRole) && requestedEmployeeId) {
      employeeId = requestedEmployeeId;
    } else if (roleResult.roles.includes(adminRole) && !requestedEmployeeId) {
      employeeId = null;
    } else {
      if (!submitterObjectId) {
        return json(400, {
          ok: false,
          error: "Authenticated user token does not include an object ID.",
        });
      }

      const employeeResult = await pool.request()
        .input("submitterObjectId", sql.NVarChar(100), submitterObjectId)
        .query(`
          SELECT TOP 1 employee_id
          FROM dbo.employees
          WHERE entra_object_id = @submitterObjectId;
        `);

      if (employeeResult.recordset.length === 0) {
        return json(404, {
          ok: false,
          error: "Authenticated user is not mapped to an employee record.",
        });
      }

      employeeId = employeeResult.recordset[0].employee_id;
    }

    const result = await listTimesheets(pool, {
      status,
      ...paging,
      employeeId,
      teamActor: null,
    });

    return json(200, {
      ok: true,
      ...result,
      auth: {
        requiredRoles: roleResult.requiredRoles,
        roles: roleResult.roles,
        objectId: submitterObjectId,
        employeeId,
      },
    });
  } catch (error) {
    context.error("My timesheets list failed.", error);

    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error.",
    });
  }
}

async function timesheetsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method === "POST") {
    return createTimesheet(request, context);
  }

  return listTimesheetsForReview(request, context);
}

app.http("timesheets", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "timesheets",
  handler: withReturnedRecordAudit("timesheets", timesheetsHandler),
});

app.http("myTimesheets", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "mytimesheets",
  handler: withReturnedRecordAudit("myTimesheets", listMyTimesheets),
});
