import { verifyClientWorkDates, ClientAssignmentDenied } from "../auth/clientAssignmentAccess";
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import * as sql from "mssql";
import { requireAnyAppRole } from "../auth/requireAppRole";
import { getSqlPool } from "../db/sqlPool";

const adminRole = "Workforce.Admin";
const hrRole = "Workforce.HR";
const caregiverRole = "Workforce.Caregiver";

const timesheetCorrectionRoles = [caregiverRole, adminRole, hrRole] as const;

export const caregiverEmployeeResolutionQuery = `
      SELECT TOP 1 employee_id
      FROM dbo.employees
      WHERE entra_object_id = @submitterObjectId
        AND employment_status = N'active';
    `;

const allowedTimesheetServiceTypes = new Set(["regular", "respite"]);

type TimesheetCorrectionBody = {
  timesheetId?: unknown;
  editReason?: unknown;
  expectedUpdatedAtUtc?: unknown;
  department?: unknown;
  employeeAttestationAccepted?: unknown;
  employeeAttestedByName?: unknown;
  clientAttestationObtained?: unknown;
  clientAttestedByName?: unknown;
  entries?: unknown;
};

type TimesheetCorrectionEntry = {
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

type TimesheetStatusRow = {
  timesheet_id: string;
  employee_id: string;
  client_id: string;
  pay_period_start_date: Date;
  pay_period_end_date: Date;
  status: string;
  updated_at_utc: Date;
};

type EmployeeMappingRow = {
  employee_id: string;
};

type TimesheetRow = {
  timesheet_id: string;
  employee_id: string;
  employee_first_name: string;
  employee_last_name: string;
  client_id: string;
  client_first_name: string;
  client_last_name: string;
  department: string | null;
  pay_period_start_date: Date;
  pay_period_end_date: Date;
  status: string;
  week1_total_hours: number;
  week2_total_hours: number;
  regular_total_hours: number;
  respite_total_hours: number;
  total_hours: number;
  employee_attestation_accepted: boolean;
  employee_attested_by_name: string | null;
  employee_attested_at_utc: Date | null;
  client_attestation_obtained: boolean;
  client_attested_by_name: string | null;
  client_attested_at_utc: Date | null;
  submitted_at_utc: Date | null;
  reviewed_at_utc: Date | null;
  reviewed_by_object_id: string | null;
  review_notes: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
  entries_json: string | null;
};

class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
  };
}

function getClaimString(
  claims: Record<string, unknown>,
  claimName: string
): string | null {
  const value = claims[claimName];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isGuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateToUtcMs(dateValue: string) {
  const parsed = new Date(`${dateValue}T00:00:00.000Z`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(`${fieldName} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new ApiError(`${fieldName} must be ${maxLength} characters or less.`);
  }

  return trimmed;
}

function getRequiredUuid(value: unknown, fieldName: string) {
  const stringValue = getRequiredString(value, fieldName, 36);

  if (!isGuidLike(stringValue)) {
    throw new ApiError(`${fieldName} must be a valid GUID.`);
  }

  return stringValue;
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
    throw new ApiError(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new ApiError(`${fieldName} must be ${maxLength} characters or less.`);
  }

  return trimmed;
}

function getRequiredBoolean(value: unknown, fieldName: string) {
  if (typeof value !== "boolean") {
    throw new ApiError(`${fieldName} must be true or false.`);
  }

  return value;
}

function getOptionalBoolean(value: unknown, fieldName: string, fallback: boolean) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new ApiError(`${fieldName} must be true or false.`);
  }

  return value;
}

function getRequiredDate(value: unknown, fieldName: string) {
  const stringValue = getRequiredString(value, fieldName, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    throw new ApiError(`${fieldName} must use YYYY-MM-DD format.`);
  }

  if (dateToUtcMs(stringValue) === null) {
    throw new ApiError(`${fieldName} must be a valid date.`);
  }

  return stringValue;
}

function getTimesheetServiceType(value: unknown, fieldName: string): string {
  const serviceType = getOptionalString(value, fieldName, 50) ?? "regular";

  if (!allowedTimesheetServiceTypes.has(serviceType)) {
    throw new ApiError(
      `${fieldName} must be one of: ${Array.from(allowedTimesheetServiceTypes).join(", ")}.`
    );
  }

  return serviceType;
}

function getRequiredTime(value: unknown, fieldName: string) {
  const stringValue = getRequiredString(value, fieldName, 8);

  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(stringValue)) {
    throw new ApiError(`${fieldName} must use HH:mm format.`);
  }

  return stringValue;
}

function getOptionalTime(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(`${fieldName} must use HH:mm format.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(trimmed)) {
    throw new ApiError(`${fieldName} must use HH:mm format.`);
  }

  return trimmed;
}

function parseTimeToMinutes(value: string) {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new ApiError("Timesheet entry time values must use valid HH:mm values.");
  }

  return hours * 60 + minutes;
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function calculateEntryHours(entry: {
  timeIn1: string;
  timeOut1: string;
  timeIn2: string | null;
  timeOut2: string | null;
}) {
  const firstStart = parseTimeToMinutes(entry.timeIn1);
  const firstEnd = parseTimeToMinutes(entry.timeOut1);

  if (firstEnd <= firstStart) {
    throw new ApiError("timeOut1 must be later than timeIn1.");
  }

  let totalMinutes = firstEnd - firstStart;

  if ((entry.timeIn2 && !entry.timeOut2) || (!entry.timeIn2 && entry.timeOut2)) {
    throw new ApiError("timeIn2 and timeOut2 must both be provided or both be blank.");
  }

  if (entry.timeIn2 && entry.timeOut2) {
    const secondStart = parseTimeToMinutes(entry.timeIn2);
    const secondEnd = parseTimeToMinutes(entry.timeOut2);

    if (secondEnd <= secondStart) {
      throw new ApiError("timeOut2 must be later than timeIn2.");
    }

    totalMinutes += secondEnd - secondStart;
  }

  const totalHours = roundHours(totalMinutes / 60);

  if (totalHours > 24) {
    throw new ApiError("A single timesheet entry cannot exceed 24 hours.");
  }

  return totalHours;
}

function parseEntries(value: unknown): TimesheetCorrectionEntry[] {
  if (!Array.isArray(value)) {
    throw new ApiError("entries must be an array.");
  }

  if (value.length === 0) {
    throw new ApiError("entries must contain at least one daily timesheet entry.");
  }

  if (value.length > 28) {
    throw new ApiError("entries cannot contain more than 28 rows for one timesheet.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(`entries[${index}] must be an object.`);
    }

    const entry = item as Record<string, unknown>;
    const timeIn1 = getRequiredTime(entry.timeIn1, `entries[${index}].timeIn1`);
    const timeOut1 = getRequiredTime(entry.timeOut1, `entries[${index}].timeOut1`);
    const timeIn2 = getOptionalTime(entry.timeIn2, `entries[${index}].timeIn2`);
    const timeOut2 = getOptionalTime(entry.timeOut2, `entries[${index}].timeOut2`);

    const correctedEntry = {
      workDate: getRequiredDate(entry.workDate, `entries[${index}].workDate`),
      serviceType: getTimesheetServiceType(
        entry.serviceType,
        `entries[${index}].serviceType`
      ),
      timeIn1,
      timeOut1,
      timeIn2,
      timeOut2,
      taskId: getOptionalString(entry.taskId, `entries[${index}].taskId`, 100),
      totalHours: 0,
      notes: getOptionalString(entry.notes, `entries[${index}].notes`, 2000),
    };

    return {
      ...correctedEntry,
      totalHours: calculateEntryHours(correctedEntry),
    };
  });
}

function validateEntriesInsidePayPeriod(
  entries: TimesheetCorrectionEntry[],
  payPeriodStartDate: string,
  payPeriodEndDate: string
) {
  const startMs = dateToUtcMs(payPeriodStartDate);
  const endMs = dateToUtcMs(payPeriodEndDate);

  if (startMs === null || endMs === null) {
    throw new ApiError("Timesheet pay period dates are invalid.", 500);
  }

  const seenDateServiceTypes = new Set<string>();

  for (const entry of entries) {
    const entryMs = dateToUtcMs(entry.workDate);

    if (entryMs === null || entryMs < startMs || entryMs > endMs) {
      throw new ApiError(
        `entries workDate ${entry.workDate} must be inside the timesheet pay period.`
      );
    }

    const dateServiceKey = `${entry.workDate}|${entry.serviceType}`;

    if (seenDateServiceTypes.has(dateServiceKey)) {
      throw new ApiError(
        `Duplicate workDate and serviceType combination found: ${entry.workDate} / ${entry.serviceType}.`
      );
    }

    seenDateServiceTypes.add(dateServiceKey);
  }
}

function calculateTotals(
  entries: TimesheetCorrectionEntry[],
  payPeriodStartDate: string
) {
  const startMs = dateToUtcMs(payPeriodStartDate);

  if (startMs === null) {
    throw new ApiError("Timesheet pay period start date is invalid.", 500);
  }

  const weekTwoStartMs = startMs + 7 * 86_400_000;
  let week1TotalHours = 0;
  let week2TotalHours = 0;
  let regularTotalHours = 0;
  let respiteTotalHours = 0;

  for (const entry of entries) {
    const entryMs = dateToUtcMs(entry.workDate);

    if (entryMs !== null && entryMs >= weekTwoStartMs) {
      week2TotalHours += entry.totalHours;
    } else {
      week1TotalHours += entry.totalHours;
    }

    if (entry.serviceType === "respite") {
      respiteTotalHours += entry.totalHours;
    } else {
      regularTotalHours += entry.totalHours;
    }
  }

  week1TotalHours = roundHours(week1TotalHours);
  week2TotalHours = roundHours(week2TotalHours);
  regularTotalHours = roundHours(regularTotalHours);
  respiteTotalHours = roundHours(respiteTotalHours);

  return {
    week1TotalHours,
    week2TotalHours,
    regularTotalHours,
    respiteTotalHours,
    totalHours: roundHours(week1TotalHours + week2TotalHours),
  };
}

async function readJsonObject(request: HttpRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError("Request body must be a JSON object.");
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError("Request body must be valid JSON.");
  }
}

async function resolveCaregiverEmployeeId(
  pool: sql.ConnectionPool,
  submitterObjectId: string | null,
  roles: string[]
): Promise<string | null> {
  if (roles.includes(adminRole) || roles.includes(hrRole)) {
    return null;
  }

  if (!submitterObjectId) {
    throw new ApiError(
      "Caregiver timesheet correction requires an Entra object ID in the access token."
    );
  }

  const result = await pool
    .request()
    .input("submitterObjectId", sql.NVarChar(100), submitterObjectId)
    .query<EmployeeMappingRow>(caregiverEmployeeResolutionQuery);

  if (result.recordset.length === 0) {
    throw new ApiError(
      "No active employee record is mapped to the signed-in caregiver account.",
      403
    );
  }

  return result.recordset[0].employee_id;
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
    .input("entityId", sql.NVarChar(100), entityId)
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

function parseEntriesJson(entriesJson: string | null) {
  if (!entriesJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(entriesJson);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => ({
      timesheetEntryId: entry.timesheetEntryId,
      workDate: entry.workDate?.slice?.(0, 10) ?? entry.workDate,
      serviceType: entry.serviceType ?? "regular",
      timeIn1: entry.timeIn1?.slice?.(0, 5) ?? entry.timeIn1,
      timeOut1: entry.timeOut1?.slice?.(0, 5) ?? entry.timeOut1,
      timeIn2: entry.timeIn2?.slice?.(0, 5) ?? entry.timeIn2 ?? null,
      timeOut2: entry.timeOut2?.slice?.(0, 5) ?? entry.timeOut2 ?? null,
      taskId: entry.taskId ?? null,
      totalHours: Number(entry.totalHours ?? 0),
      notes: entry.notes ?? null,
    }));
  } catch {
    return [];
  }
}

function mapTimesheetRow(row: TimesheetRow) {
  return {
    timesheetId: row.timesheet_id,
    employeeId: row.employee_id,
    employeeName: `${row.employee_first_name} ${row.employee_last_name}`,
    clientId: row.client_id,
    clientName: `${row.client_first_name} ${row.client_last_name}`,
    department: row.department,
    payPeriodStartDate: toDateOnly(row.pay_period_start_date),
    payPeriodEndDate: toDateOnly(row.pay_period_end_date),
    status: row.status,
    week1TotalHours: Number(row.week1_total_hours),
    week2TotalHours: Number(row.week2_total_hours),
    regularTotalHours: Number(row.regular_total_hours ?? row.total_hours ?? 0),
    respiteTotalHours: Number(row.respite_total_hours ?? 0),
    totalHours: Number(row.total_hours),
    employeeAttestationAccepted: row.employee_attestation_accepted,
    employeeAttestedByName: row.employee_attested_by_name,
    employeeAttestedAtUtc: row.employee_attested_at_utc,
    clientAttestationObtained: row.client_attestation_obtained,
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

async function readTimesheetWithEntries(
  transaction: sql.Transaction,
  timesheetId: string
) {
  const result = await new sql.Request(transaction)
    .input("timesheetId", sql.UniqueIdentifier, timesheetId)
    .query<TimesheetRow>(`
      SELECT
        t.timesheet_id,
        t.employee_id,
        e.first_name AS employee_first_name,
        e.last_name AS employee_last_name,
        t.client_id,
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
      WHERE t.timesheet_id = @timesheetId;
    `);

  if (result.recordset.length === 0) {
    throw new ApiError("Timesheet was not found after correction.", 404);
  }

  return mapTimesheetRow(result.recordset[0]);
}

export async function timesheetCorrection(
  request: HttpRequest,
  context: InvocationContext,
  dependencies = { requireAnyAppRole, getSqlPool }
): Promise<HttpResponseInit> {
  context.log("Processing protected POST /api/timesheetcorrection request.");

  const roleResult = await dependencies.requireAnyAppRole(request, timesheetCorrectionRoles);

  if (!roleResult.ok) {
    return roleResult;
  }

  let body: TimesheetCorrectionBody;

  try {
    body = (await readJsonObject(request)) as TimesheetCorrectionBody;
  } catch (error) {
    return json(error instanceof ApiError ? error.statusCode : 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid request body.",
    });
  }

  try {
    const roles = roleResult.roles;
    const staffEdit = roles.includes(adminRole) || roles.includes(hrRole);
    const editReason = staffEdit ? getRequiredString(body.editReason, "editReason", 50) : null;
    if (staffEdit && !["clock_time_correction", "missing_entry", "duplicate_entry", "service_correction", "other_reviewed"].includes(editReason!)) throw new ApiError("Choose a timesheet edit reason.");
    const expectedUpdatedAtUtc = staffEdit ? getRequiredString(body.expectedUpdatedAtUtc, "expectedUpdatedAtUtc", 40) : null;
    const submitterObjectId = getClaimString(roleResult.claims, "oid");
    if (staffEdit && (!submitterObjectId || !isGuidLike(submitterObjectId))) throw new ApiError("Staff edits require a verified sign-in identity.", 403);
    const timesheetId = getRequiredUuid(body.timesheetId, "timesheetId");
    const department = getOptionalString(body.department, "department", 200);
    const employeeAttestationAccepted = staffEdit ? false : getRequiredBoolean(
      body.employeeAttestationAccepted,
      "employeeAttestationAccepted"
    );
    const employeeAttestedByName = staffEdit ? null : getRequiredString(
      body.employeeAttestedByName,
      "employeeAttestedByName",
      200
    );
    const clientAttestationObtained = staffEdit ? false : getOptionalBoolean(
      body.clientAttestationObtained,
      "clientAttestationObtained",
      false
    );
    const clientAttestedByName = staffEdit ? null : getOptionalString(
      body.clientAttestedByName,
      "clientAttestedByName",
      200
    );

    if (!staffEdit && !employeeAttestationAccepted) {
      return json(400, {
        ok: false,
        error: "employeeAttestationAccepted must be true before correcting a timesheet.",
      });
    }

    if (clientAttestationObtained && !clientAttestedByName) {
      return json(400, {
        ok: false,
        error: "clientAttestedByName is required when clientAttestationObtained is true.",
      });
    }

    const entries = parseEntries(body.entries);
    const pool = await dependencies.getSqlPool();
    const caregiverEmployeeId = await resolveCaregiverEmployeeId(
      pool,
      submitterObjectId,
      roles
    );

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

      const statusResult = await new sql.Request(transaction)
        .input("timesheetId", sql.UniqueIdentifier, timesheetId)
        .query<TimesheetStatusRow>(`
          SELECT
            timesheet_id,
            employee_id,
            client_id,
            pay_period_start_date,
            pay_period_end_date,
            status, updated_at_utc
          FROM dbo.timesheets WITH (UPDLOCK, HOLDLOCK)
          WHERE timesheet_id = @timesheetId;
        `);

      if (statusResult.recordset.length === 0) {
        await transaction.rollback();

        return json(404, {
          ok: false,
          error: "Timesheet was not found.",
        });
      }

      const existingTimesheet = statusResult.recordset[0];

      if (staffEdit && existingTimesheet.updated_at_utc.toISOString() !== expectedUpdatedAtUtc) throw new ApiError("This timesheet changed. Reload it before editing.", 409);
      if (!staffEdit && existingTimesheet.status !== "needs_correction") {
        await transaction.rollback();

        return json(409, {
          ok: false,
          error: `Timesheet cannot be corrected from current status: ${existingTimesheet.status}.`,
          currentStatus: existingTimesheet.status,
          requiredStatus: "needs_correction",
        });
      }

      if (
        caregiverEmployeeId &&
        existingTimesheet.employee_id.toLowerCase() !==
          caregiverEmployeeId.toLowerCase()
      ) {
        await transaction.rollback();

        return json(403, {
          ok: false,
          error: "Caregiver users can only correct their own timesheets.",
        });
      }

      const payPeriodStartDate = toDateOnly(existingTimesheet.pay_period_start_date);
      const payPeriodEndDate = toDateOnly(existingTimesheet.pay_period_end_date);

      validateEntriesInsidePayPeriod(entries, payPeriodStartDate, payPeriodEndDate);
      if (caregiverEmployeeId) {
        const original = await new sql.Request(transaction).input("id",sql.UniqueIdentifier,timesheetId)
          .query<{ work_date: Date }>("SELECT work_date FROM dbo.timesheet_entries WITH(UPDLOCK,HOLDLOCK) WHERE timesheet_id=@id;");
        const retainedDates = new Set(original.recordset.map(row => toDateOnly(row.work_date)));
        const addedDates = entries.map(entry => entry.workDate).filter(date => !retainedDates.has(date));
        if (addedDates.length) await verifyClientWorkDates(transaction, caregiverEmployeeId, existingTimesheet.client_id, addedDates);
      }

      if (staffEdit) {
        const before = await readTimesheetWithEntries(transaction, timesheetId);
        await new sql.Request(transaction).input("timesheetId", sql.UniqueIdentifier, timesheetId)
          .input("actor", sql.UniqueIdentifier, submitterObjectId).input("reason", sql.NVarChar(50), editReason)
          .input("snapshot", sql.NVarChar(sql.MAX), JSON.stringify(before))
          .query("INSERT dbo.timesheet_edit_history(timesheet_id,edited_by,reason,previous_snapshot_json) VALUES(@timesheetId,@actor,@reason,@snapshot);");
      }
      const totals = calculateTotals(entries, payPeriodStartDate);

      await new sql.Request(transaction)
        .input("timesheetId", sql.UniqueIdentifier, timesheetId)
        .query(`
          DELETE FROM dbo.timesheet_entries
          WHERE timesheet_id = @timesheetId;
        `);

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

      await new sql.Request(transaction)
        .input("timesheetId", sql.UniqueIdentifier, timesheetId)
        .input("department", sql.NVarChar(200), department)
        .input("staffEdit", sql.Bit, staffEdit)
        .input("week1TotalHours", sql.Decimal(9, 2), totals.week1TotalHours)
        .input("week2TotalHours", sql.Decimal(9, 2), totals.week2TotalHours)
        .input("regularTotalHours", sql.Decimal(9, 2), totals.regularTotalHours)
        .input("respiteTotalHours", sql.Decimal(9, 2), totals.respiteTotalHours)
        .input("totalHours", sql.Decimal(9, 2), totals.totalHours)
        .input("employeeAttestedByName", sql.NVarChar(200), employeeAttestedByName)
        .input("clientAttestationObtained", sql.Bit, clientAttestationObtained)
        .input("clientAttestedByName", sql.NVarChar(200), clientAttestedByName)
        .query(`
          UPDATE dbo.timesheets
          SET
            department = @department,
            status = N'submitted',
            week1_total_hours = @week1TotalHours,
            week2_total_hours = @week2TotalHours,
            regular_total_hours = @regularTotalHours,
            respite_total_hours = @respiteTotalHours,
            total_hours = @totalHours,
            employee_attestation_accepted = CASE WHEN @staffEdit=1 THEN 0 ELSE 1 END,
            employee_attested_by_name = @employeeAttestedByName,
            employee_attested_at_utc = CASE WHEN @staffEdit=1 THEN NULL ELSE SYSUTCDATETIME() END,
            client_attestation_obtained = @clientAttestationObtained,
            client_attested_by_name = @clientAttestedByName,
            client_attested_at_utc = CASE
              WHEN @clientAttestationObtained = 1 THEN SYSUTCDATETIME()
              ELSE NULL
            END,
            submitted_at_utc = SYSUTCDATETIME(),
            reviewed_at_utc = NULL,
            reviewed_by_object_id = NULL,
            updated_at_utc = SYSUTCDATETIME()
          WHERE timesheet_id = @timesheetId
            AND (@staffEdit=1 OR status = N'needs_correction');
        `);

      const correctedTimesheet = await readTimesheetWithEntries(
        transaction,
        timesheetId
      );

      await insertAuditEvent(
        transaction,
        submitterObjectId,
        "timesheet.corrected",
        timesheetId,
        {
          previousStatus: existingTimesheet.status,
          editReason,
          newStatus: "submitted",
          correctedByObjectId: submitterObjectId,
          correctedByRole: roles.includes(adminRole) ? "admin" : roles.includes(hrRole) ? "hr" : "caregiver",
          entryCount: entries.length,
          week1TotalHours: totals.week1TotalHours,
          week2TotalHours: totals.week2TotalHours,
          regularTotalHours: totals.regularTotalHours,
          respiteTotalHours: totals.respiteTotalHours,
          totalHours: totals.totalHours,
        }
      );

      await transaction.commit();

      return json(200, {
        ok: true,
        timesheet: correctedTimesheet,
        audit: {
          action: "timesheet.corrected",
          entityType: "timesheet",
          entityId: timesheetId,
        },
        auth: {
          requiredRoles: timesheetCorrectionRoles,
          roles,
          objectId: submitterObjectId,
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    const statusCode = error instanceof ClientAssignmentDenied ? 403 : error instanceof ApiError ? error.statusCode : 500;

    context.error("Timesheet correction failed.", error);

    return json(statusCode, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown timesheet correction error.",
    });
  }
}

app.http("timesheetCorrection", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "timesheetcorrection",
  handler: timesheetCorrection,
});
