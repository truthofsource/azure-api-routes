import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { teamReviewActor, lockTeamReviewRecord } from "../auth/teamRecordAccess";
import { requireAnyAppRole } from "../auth/requireAppRole";
import { getSqlPool } from "../db/sqlPool";

const adminRole = "Workforce.Admin";
const supervisorRole = "Workforce.Supervisor";

const timesheetReviewRoles = [supervisorRole, adminRole] as const;

const reviewStatuses = new Set([
  "in_review",
  "approved",
  "rejected",
  "needs_correction",
]);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TimesheetReviewBody = {
  timesheetId?: unknown;
  status?: unknown;
  reviewNotes?: unknown;
  expectedUpdatedAtUtc?: unknown;
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

function getRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required and must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
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

function getRequiredUuid(value: unknown, fieldName: string): string {
  const trimmed = getRequiredString(value, fieldName, 36);

  if (!uuidPattern.test(trimmed)) {
    throw new Error(`${fieldName} must be a valid GUID.`);
  }

  return trimmed;
}

function getReviewStatus(value: unknown): string {
  const status = getRequiredString(value, "status", 50);

  if (!reviewStatuses.has(status)) {
    throw new Error(
      `status must be one of: ${Array.from(reviewStatuses).join(", ")}.`
    );
  }

  return status;
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

export async function timesheetReview(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Processing protected POST /api/timesheetreview request.");

  const roleResult = await requireAnyAppRole(request, timesheetReviewRoles);

  if (!roleResult.ok) {
    return roleResult;
  }

  let body: TimesheetReviewBody;

  try {
    body = (await request.json()) as TimesheetReviewBody;
  } catch {
    return json(400, {
      ok: false,
      error: "Request body must be valid JSON.",
    });
  }

  try {
    const timesheetId = getRequiredUuid(body.timesheetId, "timesheetId");
    const status = getReviewStatus(body.status);
    const expected = body.expectedUpdatedAtUtc;
    if (expected !== undefined && (typeof expected !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expected))) throw new Error("Reload the record before approval.");
    const reviewNotes = getOptionalString(body.reviewNotes, "reviewNotes", 2000);

    if ((status === "rejected" || status === "needs_correction") && !reviewNotes) {
      return json(400, {
        ok: false,
        error: "reviewNotes is required when rejecting or requesting correction.",
      });
    }

    const reviewerObjectId = getClaimString(roleResult.claims, "oid");

    if (!reviewerObjectId) {
      return json(400, {
        ok: false,
        error: "Authenticated reviewer token does not include an object ID.",
      });
    }

    const pool = await getSqlPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      if (!await lockTeamReviewRecord(transaction, "timesheet", timesheetId, teamReviewActor(roleResult))) {
        await transaction.rollback();
        return json(404, { ok: false, error: "Timesheet was not found." });
      }

      const updateResult = await new sql.Request(transaction)
        .input("timesheetId", sql.UniqueIdentifier, timesheetId)
        .input("expected", sql.VarChar(23), typeof expected === "string" ? expected.slice(0,23) : null)
        .input("status", sql.NVarChar(50), status)
        .input("reviewNotes", sql.NVarChar(sql.MAX), reviewNotes)
        .input("reviewerObjectId", sql.NVarChar(100), reviewerObjectId)
        .query(`
          UPDATE dbo.timesheets
          SET
            status = @status,
            reviewed_at_utc = SYSUTCDATETIME(),
            reviewed_by_object_id = @reviewerObjectId,
            review_notes = COALESCE(@reviewNotes, review_notes),
            updated_at_utc = SYSUTCDATETIME()
          OUTPUT
            INSERTED.timesheet_id,
            INSERTED.employee_id,
            INSERTED.client_id,
            INSERTED.department,
            INSERTED.pay_period_start_date,
            INSERTED.pay_period_end_date,
            INSERTED.status,
            INSERTED.week1_total_hours,
            INSERTED.week2_total_hours,
            INSERTED.regular_total_hours,
            INSERTED.respite_total_hours,
            INSERTED.total_hours,
            INSERTED.employee_attestation_accepted,
            INSERTED.employee_attested_by_name,
            INSERTED.employee_attested_at_utc,
            INSERTED.client_attestation_obtained,
            INSERTED.client_attested_by_name,
            INSERTED.client_attested_at_utc,
            INSERTED.submitted_at_utc,
            INSERTED.reviewed_at_utc,
            INSERTED.reviewed_by_object_id,
            INSERTED.review_notes,
            INSERTED.created_at_utc,
            INSERTED.updated_at_utc,
            DELETED.status AS previous_status
          WHERE timesheet_id = @timesheetId
            AND status IN (N'submitted', N'in_review')
            AND (@expected IS NULL OR CONVERT(varchar(23),updated_at_utc,126)=@expected);
        `);

      if (updateResult.recordset.length === 0) {
        const currentResult = await new sql.Request(transaction)
          .input("timesheetId", sql.UniqueIdentifier, timesheetId)
          .query(`
            SELECT TOP 1 status
            FROM dbo.timesheets
            WHERE timesheet_id = @timesheetId;
          `);

        await transaction.rollback();

        if (currentResult.recordset.length === 0) {
          return json(404, {
            ok: false,
            error: "Timesheet was not found.",
          });
        }

        return json(409, {
          ok: false,
          error: "The timesheet changed or is no longer awaiting review. Reload before deciding again.",
        });
      }

      const baseRow = updateResult.recordset[0];

      const timesheetResult = await new sql.Request(transaction)
        .input("timesheetId", sql.UniqueIdentifier, timesheetId)
        .query(`
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
          WHERE t.timesheet_id = @timesheetId;
        `);

      await insertAuditEvent(
        transaction,
        reviewerObjectId,
        `timesheet.${status}`,
        timesheetId,
        {
          previousStatus: baseRow.previous_status,
          newStatus: status,
          reviewNotes,
          reviewerObjectId,
          roles: roleResult.roles,
        }
      );

      await transaction.commit();

      return json(200, {
        ok: true,
        timesheet: mapTimesheetRow(timesheetResult.recordset[0]),
        audit: {
          action: `timesheet.${status}`,
        },
        auth: {
          requiredRoles: roleResult.requiredRoles,
          roles: roleResult.roles,
          reviewerObjectId,
        },
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    context.error("Timesheet review failed.", error);

    return json(400, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error.",
    });
  }
}

app.http("timesheetReview", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "timesheetreview",
  handler: timesheetReview,
});
