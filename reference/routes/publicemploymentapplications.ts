import { createHash } from "node:crypto";
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import * as sql from "mssql";
import { recordWorkflowNotificationEvent } from "../workflowNotifications/workflowNotificationEvents";
import { createPublicSubmissionStage2Handoff } from "./stage2packetinvitation";
import { deliverStage2InvitationAfterCommit } from "../queues/stage2InvitationDelivery";
import type { Stage2InvitationEmailMessage } from "../contracts/stage2InvitationEmail";
import {
  createApplicantConfirmationEmailMessage,
} from "../contracts/applicantConfirmationEmail";
import {
  parsePublicEmploymentApplication,
  publicApplicationContractVersions,
  type PublicApplicationAvailability,
  type PublicApplicationCertification,
  type PublicApplicationEducation,
  type PublicApplicationEmploymentHistory,
  type PublicApplicationReference,
  type PublicEmploymentApplicationSubmission,
} from "../contracts/publicEmploymentApplication";
import { getSqlPool } from "../db/sqlPool";
import {
  enqueueApplicantConfirmationEmail,
} from "../queues/applicantConfirmationQueue";

const maximumRequestBodyBytes = 256 * 1024;

type ApplicationInsertRow = {
  application_id: string;
  status: string;
};

function getHeaderValue(
  request: HttpRequest,
  headerName: string,
  maximumLength: number
): string | null {
  const value = request.headers.get(headerName)?.trim();

  if (!value) {
    return null;
  }

  return value.slice(0, maximumLength);
}

function getSourceIp(request: HttpRequest): string | null {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();

  const azureClientIp = request.headers
    .get("x-azure-clientip")
    ?.trim();

  const sourceIp = forwardedFor || azureClientIp || null;

  return sourceIp?.slice(0, 64) ?? null;
}

function getContentLength(request: HttpRequest): number | null {
  const value = request.headers.get("content-length");

  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readJsonBody(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function toMayContactSupervisor(
  status: "yes" | "no" | "later"
): boolean | null {
  if (status === "yes") {
    return true;
  }

  if (status === "no") {
    return false;
  }

  return null;
}

async function insertEducation(
  transaction: sql.Transaction,
  applicationId: string,
  entries: PublicApplicationEducation[]
): Promise<void> {
  for (const [index, entry] of entries.entries()) {
    await new sql.Request(transaction)
      .input(
        "applicationId",
        sql.UniqueIdentifier,
        applicationId
      )
      .input(
        "educationType",
        sql.NVarChar(50),
        entry.educationType
      )
      .input(
        "schoolName",
        sql.NVarChar(200),
        entry.schoolName
      )
      .input(
        "schoolLocation",
        sql.NVarChar(200),
        entry.schoolLocation
      )
      .input(
        "degreeOrProgram",
        sql.NVarChar(200),
        entry.degreeOrProgram
      )
      .input(
        "yearsAttended",
        sql.NVarChar(50),
        entry.yearsAttended
      )
      .input(
        "graduated",
        sql.Bit,
        entry.graduated
      )
      .input(
        "sortOrder",
        sql.TinyInt,
        index + 1
      )
      .query(`
        INSERT INTO dbo.application_education (
          application_id,
          education_type,
          school_name,
          school_location,
          degree_or_program,
          years_attended,
          graduated,
          sort_order
        )
        VALUES (
          @applicationId,
          @educationType,
          @schoolName,
          @schoolLocation,
          @degreeOrProgram,
          @yearsAttended,
          @graduated,
          @sortOrder
        );
      `);
  }
}

async function insertEmploymentHistory(
  transaction: sql.Transaction,
  applicationId: string,
  entries: PublicApplicationEmploymentHistory[]
): Promise<void> {
  for (const [index, entry] of entries.entries()) {
    await new sql.Request(transaction)
      .input(
        "applicationId",
        sql.UniqueIdentifier,
        applicationId
      )
      .input(
        "companyName",
        sql.NVarChar(200),
        entry.companyName
      )
      .input(
        "positionTitle",
        sql.NVarChar(200),
        entry.positionTitle
      )
      .input(
        "employerAddress",
        sql.NVarChar(300),
        entry.employerAddress
      )
      .input(
        "employerPhone",
        sql.NVarChar(50),
        entry.employerPhone
      )
      .input(
        "supervisorName",
        sql.NVarChar(200),
        entry.supervisorName
      )
      .input(
        "startDate",
        sql.NVarChar(10),
        entry.startDate
      )
      .input(
        "endDate",
        sql.NVarChar(10),
        entry.endDate
      )
      .input(
        "reasonForLeaving",
        sql.NVarChar(1000),
        entry.reasonForLeaving
      )
      .input(
        "salaryOrRate",
        sql.NVarChar(100),
        entry.salaryOrRate
      )
      .input(
        "responsibilities",
        sql.NVarChar(2000),
        entry.responsibilities
      )
      .input(
        "mayContactSupervisor",
        sql.Bit,
        toMayContactSupervisor(entry.mayContactStatus)
      )
      .input(
        "mayContactStatus",
        sql.NVarChar(20),
        entry.mayContactStatus
      )
      .input(
        "sortOrder",
        sql.TinyInt,
        index + 1
      )
      .query(`
        INSERT INTO dbo.application_employment_history (
          application_id,
          company_name,
          position_title,
          employer_address,
          employer_phone,
          supervisor_name,
          start_date,
          end_date,
          reason_for_leaving,
          salary_or_rate,
          responsibilities,
          may_contact_supervisor,
          may_contact_status,
          sort_order
        )
        VALUES (
          @applicationId,
          @companyName,
          @positionTitle,
          @employerAddress,
          @employerPhone,
          @supervisorName,
          CASE
            WHEN @startDate IS NULL THEN NULL
            ELSE CONVERT(date, @startDate, 23)
          END,
          CASE
            WHEN @endDate IS NULL THEN NULL
            ELSE CONVERT(date, @endDate, 23)
          END,
          @reasonForLeaving,
          @salaryOrRate,
          @responsibilities,
          @mayContactSupervisor,
          @mayContactStatus,
          @sortOrder
        );
      `);
  }
}

async function insertReferences(
  transaction: sql.Transaction,
  applicationId: string,
  entries: PublicApplicationReference[]
): Promise<void> {
  for (const [index, entry] of entries.entries()) {
    await new sql.Request(transaction)
      .input(
        "applicationId",
        sql.UniqueIdentifier,
        applicationId
      )
      .input(
        "fullName",
        sql.NVarChar(200),
        entry.fullName
      )
      .input(
        "relationship",
        sql.NVarChar(100),
        entry.relationship
      )
      .input(
        "yearsKnown",
        sql.SmallInt,
        entry.yearsKnown
      )
      .input(
        "companyName",
        sql.NVarChar(200),
        entry.companyName
      )
      .input(
        "phone",
        sql.NVarChar(50),
        entry.phone
      )
      .input(
        "email",
        sql.NVarChar(320),
        entry.email
      )
      .input(
        "address",
        sql.NVarChar(300),
        entry.address
      )
      .input(
        "sortOrder",
        sql.TinyInt,
        index + 1
      )
      .query(`
        INSERT INTO dbo.application_references (
          application_id,
          full_name,
          relationship,
          years_known,
          company_name,
          phone,
          email,
          address,
          sort_order
        )
        VALUES (
          @applicationId,
          @fullName,
          @relationship,
          @yearsKnown,
          @companyName,
          @phone,
          @email,
          @address,
          @sortOrder
        );
      `);
  }
}

async function insertAvailability(
  transaction: sql.Transaction,
  applicationId: string,
  entries: PublicApplicationAvailability[]
): Promise<void> {
  for (const entry of entries) {
    await new sql.Request(transaction)
      .input(
        "applicationId",
        sql.UniqueIdentifier,
        applicationId
      )
      .input(
        "dayOfWeek",
        sql.NVarChar(10),
        entry.dayOfWeek
      )
      .input(
        "available",
        sql.Bit,
        entry.available
      )
      .input(
        "firstShiftAvailable",
        sql.Bit,
        entry.firstShiftAvailable
      )
      .input(
        "secondShiftAvailable",
        sql.Bit,
        entry.secondShiftAvailable
      )
      .input(
        "thirdShiftAvailable",
        sql.Bit,
        entry.thirdShiftAvailable
      )
      .input(
        "earliestStartTime",
        sql.NVarChar(5),
        entry.earliestStartTime
      )
      .input(
        "latestEndTime",
        sql.NVarChar(5),
        entry.latestEndTime
      )
      .input(
        "preferredShift",
        sql.NVarChar(50),
        entry.preferredShift
      )
      .input(
        "notes",
        sql.NVarChar(500),
        entry.notes
      )
      .query(`
        INSERT INTO dbo.application_availability (
          application_id,
          day_of_week,
          available,
          first_shift_available,
          second_shift_available,
          third_shift_available,
          earliest_start_time,
          latest_end_time,
          preferred_shift,
          notes
        )
        VALUES (
          @applicationId,
          @dayOfWeek,
          @available,
          @firstShiftAvailable,
          @secondShiftAvailable,
          @thirdShiftAvailable,
          CASE
            WHEN @earliestStartTime IS NULL THEN NULL
            ELSE CONVERT(time(0), @earliestStartTime)
          END,
          CASE
            WHEN @latestEndTime IS NULL THEN NULL
            ELSE CONVERT(time(0), @latestEndTime)
          END,
          @preferredShift,
          @notes
        );
      `);
  }
}

async function insertCertifications(
  transaction: sql.Transaction,
  applicationId: string,
  entries: PublicApplicationCertification[]
): Promise<void> {
  for (const [index, entry] of entries.entries()) {
    await new sql.Request(transaction)
      .input(
        "applicationId",
        sql.UniqueIdentifier,
        applicationId
      )
      .input(
        "certificationType",
        sql.NVarChar(50),
        entry.certificationType
      )
      .input(
        "certificationName",
        sql.NVarChar(200),
        entry.certificationName
      )
      .input(
        "issuingOrganization",
        sql.NVarChar(200),
        entry.issuingOrganization
      )
      .input(
        "issuedDate",
        sql.NVarChar(10),
        entry.issuedDate
      )
      .input(
        "expirationDate",
        sql.NVarChar(10),
        entry.expirationDate
      )
      .input(
        "notes",
        sql.NVarChar(500),
        entry.notes
      )
      .input(
        "sortOrder",
        sql.TinyInt,
        index + 1
      )
      .query(`
        INSERT INTO dbo.application_certifications (
          application_id,
          certification_type,
          certification_name,
          issuing_organization,
          issued_date,
          expiration_date,
          proof_document_id,
          notes,
          sort_order
        )
        VALUES (
          @applicationId,
          @certificationType,
          @certificationName,
          @issuingOrganization,
          CASE
            WHEN @issuedDate IS NULL THEN NULL
            ELSE CONVERT(date, @issuedDate, 23)
          END,
          CASE
            WHEN @expirationDate IS NULL THEN NULL
            ELSE CONVERT(date, @expirationDate, 23)
          END,
          NULL,
          @notes,
          @sortOrder
        );
      `);
  }
}

async function insertApplication(
  transaction: sql.Transaction,
  submission: PublicEmploymentApplicationSubmission,
  sourceIp: string | null,
  userAgent: string | null
): Promise<ApplicationInsertRow> {
  const result = await new sql.Request(transaction)
    .input(
      "applicantFirstName",
      sql.NVarChar(100),
      submission.applicant.firstName
    )
    .input(
      "applicantMiddleName",
      sql.NVarChar(100),
      submission.applicant.middleName
    )
    .input(
      "applicantLastName",
      sql.NVarChar(100),
      submission.applicant.lastName
    )
    .input(
      "applicantEmail",
      sql.NVarChar(320),
      submission.applicant.email
    )
    .input(
      "applicantPhone",
      sql.NVarChar(50),
      submission.applicant.phone
    )
    .input(
      "addressLine1",
      sql.NVarChar(200),
      submission.applicant.addressLine1
    )
    .input(
      "addressLine2",
      sql.NVarChar(200),
      submission.applicant.addressLine2
    )
    .input(
      "city",
      sql.NVarChar(100),
      submission.applicant.city
    )
    .input(
      "stateCode",
      sql.NVarChar(2),
      submission.applicant.stateCode
    )
    .input(
      "postalCode",
      sql.NVarChar(20),
      submission.applicant.postalCode
    )
    .input(
      "county",
      sql.NVarChar(100),
      submission.applicant.county
    )
    .input(
      "preferredContactMethod",
      sql.NVarChar(20),
      submission.applicant.preferredContactMethod
    )
    .input(
      "desiredRole",
      sql.NVarChar(100),
      submission.position.desiredRole
    )
    .input(
      "dateAvailable",
      sql.NVarChar(10),
      submission.position.dateAvailable
    )
    .input(
      "employmentTypePreference",
      sql.NVarChar(50),
      submission.position.employmentTypePreference
    )
    .input(
      "desiredHoursPerWeek",
      sql.Decimal(5, 2),
      submission.position.desiredHoursPerWeek
    )
    .input(
      "payExpectation",
      sql.Decimal(10, 2),
      submission.position.payExpectation
    )
    .input(
      "workAuthorized",
      sql.Bit,
      submission.position.workAuthorized
    )
    .input(
      "sponsorshipRequired",
      sql.Bit,
      submission.position.sponsorshipRequired
    )
    .input(
      "essentialFunctionsAcknowledged",
      sql.Bit,
      submission.position.essentialFunctionsAcknowledged
    )
    .input(
      "accommodationRequested",
      sql.Bit,
      submission.position.accommodationRequested
    )
    .input(
      "accommodationNotes",
      sql.NVarChar(1000),
      submission.position.accommodationNotes
    )
    .input(
      "hasReliableTransportation",
      sql.Bit,
      submission.qualifications.hasReliableTransportation
    )
    .input(
      "hasValidDriverLicense",
      sql.Bit,
      submission.qualifications.hasValidDriverLicense
    )
    .input(
      "cprCertified",
      sql.Bit,
      submission.qualifications.cprCertified
    )
    .input(
      "cprExpirationDate",
      sql.NVarChar(10),
      submission.qualifications.cprExpirationDate
    )
    .input(
      "firstAidCertified",
      sql.Bit,
      submission.qualifications.firstAidCertified
    )
    .input(
      "firstAidExpirationDate",
      sql.NVarChar(10),
      submission.qualifications.firstAidExpirationDate
    )
    .input(
      "medicationCertified",
      sql.Bit,
      submission.qualifications.medicationCertified
    )
    .input(
      "medicationExpirationDate",
      sql.NVarChar(10),
      submission.qualifications
        .medicationCertificationExpirationDate
    )
    .input(
      "tbTestCurrent",
      sql.Bit,
      submission.qualifications.tbTestCurrent
    )
    .input(
      "tbTestExpirationDate",
      sql.NVarChar(10),
      submission.qualifications.tbTestExpirationDate
    )
    .input(
      "preferredShift",
      sql.NVarChar(50),
      submission.qualifications.preferredShift
    )
    .input(
      "availabilityNotes",
      sql.NVarChar(1000),
      submission.qualifications.availabilityNotes
    )
    .input(
      "skillsAndExperience",
      sql.NVarChar(sql.MAX),
      submission.qualifications.skillsAndExperience
    )
    .input(
      "additionalInformation",
      sql.NVarChar(sql.MAX),
      submission.qualifications.additionalInformation
    )
    .input(
      "hasNoPriorEmployment",
      sql.Bit,
      submission.hasNoPriorEmployment
    )
    .input(
      "certificationAccepted",
      sql.Bit,
      submission.certification.accepted
    )
    .input(
      "electronicSignatureName",
      sql.NVarChar(200),
      submission.certification.typedName
    )
    .input(
      "electronicSignatureIp",
      sql.NVarChar(64),
      sourceIp
    )
    .input(
      "electronicSignatureUserAgent",
      sql.NVarChar(512),
      userAgent
    )
    .input(
      "applicationFormVersion",
      sql.NVarChar(50),
      publicApplicationContractVersions.applicationFormVersion
    )
    .input(
      "certificationTextVersion",
      sql.NVarChar(50),
      publicApplicationContractVersions.certificationTextVersion
    )
    .query<ApplicationInsertRow>(`
      INSERT INTO dbo.employment_applications (
        applicant_first_name,
        applicant_middle_name,
        applicant_last_name,
        applicant_email,
        applicant_phone,
        address_line_1,
        address_line_2,
        city,
        state_code,
        postal_code,
        county,
        preferred_contact_method,
        desired_role,
        date_available,
        employment_type_preference,
        desired_hours_per_week,
        pay_expectation,
        work_authorized,
        sponsorship_required,
        essential_functions_acknowledged,
        accommodation_requested,
        accommodation_notes,
        has_reliable_transportation,
        has_valid_driver_license,
        cpr_certified,
        cpr_expiration_date,
        first_aid_certified,
        first_aid_expiration_date,
        medication_certified,
        medication_certification_expiration_date,
        tb_test_current,
        tb_test_expiration_date,
        preferred_shift,
        availability_notes,
        skills_and_experience,
        additional_information,
        has_no_prior_employment,
        applicant_certification_accepted,
        electronic_signature_name,
        electronic_signature_at_utc,
        electronic_signature_ip_address,
        electronic_signature_user_agent,
        submission_source,
        application_form_version,
        certification_text_version,
        status
      )
      OUTPUT
        INSERTED.application_id,
        INSERTED.status
      VALUES (
        @applicantFirstName,
        @applicantMiddleName,
        @applicantLastName,
        @applicantEmail,
        @applicantPhone,
        @addressLine1,
        @addressLine2,
        @city,
        @stateCode,
        @postalCode,
        @county,
        @preferredContactMethod,
        @desiredRole,
        CASE
          WHEN @dateAvailable IS NULL THEN NULL
          ELSE CONVERT(date, @dateAvailable, 23)
        END,
        @employmentTypePreference,
        @desiredHoursPerWeek,
        @payExpectation,
        @workAuthorized,
        @sponsorshipRequired,
        @essentialFunctionsAcknowledged,
        @accommodationRequested,
        @accommodationNotes,
        @hasReliableTransportation,
        @hasValidDriverLicense,
        @cprCertified,
        CASE
          WHEN @cprExpirationDate IS NULL THEN NULL
          ELSE CONVERT(date, @cprExpirationDate, 23)
        END,
        @firstAidCertified,
        CASE
          WHEN @firstAidExpirationDate IS NULL THEN NULL
          ELSE CONVERT(date, @firstAidExpirationDate, 23)
        END,
        @medicationCertified,
        CASE
          WHEN @medicationExpirationDate IS NULL THEN NULL
          ELSE CONVERT(date, @medicationExpirationDate, 23)
        END,
        @tbTestCurrent,
        CASE
          WHEN @tbTestExpirationDate IS NULL THEN NULL
          ELSE CONVERT(date, @tbTestExpirationDate, 23)
        END,
        @preferredShift,
        @availabilityNotes,
        @skillsAndExperience,
        @additionalInformation,
        @hasNoPriorEmployment,
        @certificationAccepted,
        @electronicSignatureName,
        SYSUTCDATETIME(),
        @electronicSignatureIp,
        @electronicSignatureUserAgent,
        N'public_web',
        @applicationFormVersion,
        @certificationTextVersion,
        N'submitted'
      );
    `);

  const row = result.recordset[0];

  if (!row) {
    throw new Error(
      "Public employment application insert did not return a row."
    );
  }

  return row;
}

async function insertAuditEvent(
  transaction: sql.Transaction,
  applicationId: string,
  status: string,
  sourceIp: string | null,
  userAgent: string | null,
  correlationId: string,
  submission: PublicEmploymentApplicationSubmission
): Promise<void> {
  const metadata = {
    source: "public_web",
    status,
    applicationFormVersion:
      publicApplicationContractVersions.applicationFormVersion,
    certificationTextVersion:
      publicApplicationContractVersions.certificationTextVersion,
    sectionCounts: {
      education: submission.education.length,
      employmentHistory: submission.employmentHistory.length,
      references: submission.references.length,
      availability: submission.availability.length,
      certifications: submission.certifications.length,
    },
    hasNoPriorEmployment: submission.hasNoPriorEmployment,
  };

  await new sql.Request(transaction)
    .input(
      "actorType",
      sql.NVarChar(50),
      "external_applicant"
    )
    .input(
      "action",
      sql.NVarChar(100),
      "employment_application.public_submitted"
    )
    .input(
      "entityType",
      sql.NVarChar(100),
      "employment_application"
    )
    .input(
      "entityId",
      sql.NVarChar(100),
      applicationId
    )
    .input(
      "sourceIp",
      sql.NVarChar(64),
      sourceIp
    )
    .input(
      "userAgent",
      sql.NVarChar(512),
      userAgent
    )
    .input(
      "correlationId",
      sql.NVarChar(100),
      correlationId
    )
    .input(
      "metadataJson",
      sql.NVarChar(sql.MAX),
      JSON.stringify(metadata)
    )
    .query(`
      INSERT INTO dbo.audit_events (
        actor_type,
        action,
        entity_type,
        entity_id,
        source_ip,
        user_agent,
        correlation_id,
        metadata_json
      )
      VALUES (
        @actorType,
        @action,
        @entityType,
        @entityId,
        @sourceIp,
        @userAgent,
        @correlationId,
        @metadataJson
      );
    `);
}

export async function publicEmploymentApplications(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(
    "Processing public POST /api/publicemploymentapplications request."
  );

  const contentType =
    request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    return {
      status: 415,
      jsonBody: {
        ok: false,
        error: "Content-Type must be application/json.",
      },
    };
  }

  const contentLength = getContentLength(request);

  if (
    contentLength !== null &&
    contentLength > maximumRequestBodyBytes
  ) {
    return {
      status: 413,
      jsonBody: {
        ok: false,
        error: "Request body is too large.",
      },
    };
  }

  let rawBody: unknown;

  try {
    rawBody = await readJsonBody(request);
  } catch (error) {
    return {
      status: 400,
      jsonBody: {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Request body must be valid JSON.",
      },
    };
  }

  let serializedBody: string;

  try {
    serializedBody = JSON.stringify(rawBody);
  } catch {
    return {
      status: 400,
      jsonBody: {
        ok: false,
        error: "Request body must be valid JSON.",
      },
    };
  }

  if (
    Buffer.byteLength(serializedBody, "utf8") >
    maximumRequestBodyBytes
  ) {
    return {
      status: 413,
      jsonBody: {
        ok: false,
        error: "Request body is too large.",
      },
    };
  }

  const requestId = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? (rawBody as Record<string,unknown>).requestId : null;
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) return { status: 400, jsonBody: { ok: false, error: "Reload the application before submitting; its request identity is missing." } };
  const submissionBody = { ...(rawBody as Record<string,unknown>) }; delete submissionBody.requestId;
  let submission: PublicEmploymentApplicationSubmission;

  try {
    submission = parsePublicEmploymentApplication(submissionBody);
  } catch (error) {
    return {
      status: 400,
      jsonBody: {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The employment application is invalid.",
      },
    };
  }

  const sourceIp = getSourceIp(request);
  const userAgent = getHeaderValue(
    request,
    "user-agent",
    512
  );

  let pool: sql.ConnectionPool;

  try {
    pool = await getSqlPool();
  } catch (error) {
    context.error(
      "Public employment application database connection failed.",
      error
    );

    return {
      status: 503,
      jsonBody: {
        ok: false,
        error:
          "The application service is temporarily unavailable. " +
          "Please try again.",
      },
    };
  }

  const transaction = new sql.Transaction(pool);

  let application: ApplicationInsertRow;
  let stage2Handoff: { invitationToken: string; invitationEmailMessage: Stage2InvitationEmailMessage };

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const payloadHash = createHash("sha256").update(JSON.stringify(submission)).digest();
    const prior = (await new sql.Request(transaction).input("request", sql.UniqueIdentifier, requestId).query<{ payloadHash: Buffer; applicationId: string; status: string }>(`SELECT r.payload_sha256 AS payloadHash,r.application_id AS applicationId,a.status FROM dbo.public_application_submission_receipts r WITH(UPDLOCK,HOLDLOCK) JOIN dbo.employment_applications a ON a.application_id=r.application_id WHERE r.request_id=@request;`)).recordset[0];
    if (prior) {
      await transaction.rollback();
      if (!Buffer.from(prior.payloadHash).equals(payloadHash)) return { status: 409, jsonBody: { ok: false, error: "This submission request was used for different answers. Your earlier application is retained; contact Example organization before submitting another." } };
      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: { ok: true, confirmationId: prior.applicationId, status: prior.status, message: "Your application was already received. Open your secure Stage 2 email link to continue.", reconciled: true } };
    }
    application = await insertApplication(
      transaction,
      submission,
      sourceIp,
      userAgent
    );

    await insertEducation(
      transaction,
      application.application_id,
      submission.education
    );

    await insertEmploymentHistory(
      transaction,
      application.application_id,
      submission.employmentHistory
    );

    await insertReferences(
      transaction,
      application.application_id,
      submission.references
    );

    await insertAvailability(
      transaction,
      application.application_id,
      submission.availability
    );

    await insertCertifications(
      transaction,
      application.application_id,
      submission.certifications
    );

    await insertAuditEvent(
      transaction,
      application.application_id,
      application.status,
      sourceIp,
      userAgent,
      context.invocationId,
      submission
    );

    await recordWorkflowNotificationEvent(new sql.Request(transaction), {
      kind: "application_submitted",
      entityId: application.application_id,
      transitionId: application.application_id,
      dedupeKey: `application_submitted:${application.application_id}:${application.application_id}`,
    });

    stage2Handoff = await createPublicSubmissionStage2Handoff(
      transaction,
      application.application_id,
      submission.applicant.email,
      context,
      sourceIp,
      userAgent
    );

    await new sql.Request(transaction).input("request", sql.UniqueIdentifier, requestId).input("hash", sql.VarBinary(32), payloadHash).input("application", sql.UniqueIdentifier, application.application_id).query(`INSERT dbo.public_application_submission_receipts(request_id,payload_sha256,application_id) VALUES(@request,@hash,@application);`);
    await transaction.commit();
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      context.error(
        "Public employment application rollback failed.",
        rollbackError
      );
    }

    context.error(
      "Public employment application submission failed.",
      error
    );

    return {
      status: 500,
      jsonBody: {
        ok: false,
        error:
          "We could not submit your application. " +
          "Please try again.",
      },
    };
  }

  const stage2Delivery = await deliverStage2InvitationAfterCommit(stage2Handoff.invitationEmailMessage);
  context.log("Public Stage 2 handoff created.", {
    applicationId: application.application_id,
    emailDeliveryStatus: stage2Delivery.status,
  });

  context.log(
    "Public employment application submitted successfully.",
    {
      applicationId: application.application_id,
      status: application.status,
    }
  );

  const confirmationMessage =
    createApplicantConfirmationEmailMessage({
      confirmationId: application.application_id,
      applicantFirstName:
        submission.applicant.firstName,
      applicantEmail: submission.applicant.email,
    });

  try {
    const queueResult =
      await enqueueApplicantConfirmationEmail(
        confirmationMessage
      );

    if (queueResult.status === "queued") {
      context.log(
        "Applicant confirmation email message queued.",
        {
          applicationId: application.application_id,
          messageId: queueResult.messageId,
          requestId: queueResult.requestId,
        }
      );
    } else {
      context.log(
        "Applicant confirmation email queueing is disabled.",
        {
          applicationId: application.application_id,
        }
      );
    }
  } catch (error) {
    context.error(
      "Applicant confirmation email queueing failed.",
      error,
      {
        applicationId: application.application_id,
      }
    );
  }

  return {
    status: 201,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    jsonBody: {
      ok: true,
      confirmationId: application.application_id,
      status: application.status,
      message:
        "Your application has been submitted successfully.",
      stage2: {
        invitationToken: stage2Handoff.invitationToken,
        expiresAtUtc: stage2Handoff.invitationEmailMessage.expiresAtUtc,
        emailDeliveryStatus: stage2Delivery.status,
      },
    },
  };
}

app.http("publicEmploymentApplications", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "publicemploymentapplications",
  handler: publicEmploymentApplications,
});
