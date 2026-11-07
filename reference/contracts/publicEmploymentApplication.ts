import { normalizeJobTitle } from "./jobTitles";
import { normalizePhone } from "./phoneNumber";

export type PublicApplicationEducation = {
  educationType:
    | "high_school"
    | "college"
    | "vocational"
    | "certification_program"
    | "other";
  schoolName: string;
  schoolLocation: string | null;
  degreeOrProgram: string | null;
  yearsAttended: string | null;
  graduated: boolean | null;
};

export type PublicApplicationEmploymentHistory = {
  companyName: string;
  positionTitle: string | null;
  employerAddress: string | null;
  employerPhone: string | null;
  supervisorName: string | null;
  startDate: string | null;
  endDate: string | null;
  reasonForLeaving: string | null;
  salaryOrRate: string | null;
  responsibilities: string | null;
  mayContactStatus: "yes" | "no" | "later";
};

export type PublicApplicationReference = {
  fullName: string;
  relationship: string | null;
  yearsKnown: number | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export type PublicApplicationAvailability = {
  dayOfWeek:
    | "Monday"
    | "Tuesday"
    | "Wednesday"
    | "Thursday"
    | "Friday"
    | "Saturday"
    | "Sunday";
  available: boolean;
  firstShiftAvailable: boolean;
  secondShiftAvailable: boolean;
  thirdShiftAvailable: boolean;
  earliestStartTime: string | null;
  latestEndTime: string | null;
  preferredShift:
    | "day"
    | "evening"
    | "overnight"
    | "weekend"
    | "flexible"
    | "other"
    | null;
  notes: string | null;
};

export type PublicApplicationCertification = {
  certificationType:
    | "cpr"
    | "first_aid"
    | "medication_administration"
    | "tb_test"
    | "driver_license"
    | "training"
    | "other";
  certificationName: string;
  issuingOrganization: string | null;
  issuedDate: string | null;
  expirationDate: string | null;
  notes: string | null;
};

export type PublicEmploymentApplicationSubmission = {
  applicant: {
    firstName: string;
    middleName: string | null;
    lastName: string;
    email: string;
    phone: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    stateCode: string;
    postalCode: string;
    county: string | null;
    preferredContactMethod: "email" | "phone" | "text" | "no_preference";
  };

  position: {
    desiredRole: string;
    dateAvailable: string | null;
    employmentTypePreference:
      | "full_time"
      | "part_time"
      | "prn"
      | "either"
      | "other";
    desiredHoursPerWeek: number | null;
    payExpectation: number | null;
    workAuthorized: boolean;
    sponsorshipRequired: boolean | null;
    essentialFunctionsAcknowledged: boolean;
    accommodationRequested: boolean;
    accommodationNotes: string | null;
  };

  qualifications: {
    hasReliableTransportation: boolean;
    hasValidDriverLicense: boolean;
    cprCertified: boolean;
    cprExpirationDate: string | null;
    firstAidCertified: boolean;
    firstAidExpirationDate: string | null;
    medicationCertified: boolean;
    medicationCertificationExpirationDate: string | null;
    tbTestCurrent: boolean;
    tbTestExpirationDate: string | null;
    preferredShift:
      | "day"
      | "evening"
      | "overnight"
      | "weekend"
      | "flexible"
      | "other"
      | null;
    availabilityNotes: string | null;
    skillsAndExperience: string | null;
    additionalInformation: string | null;
  };

  hasNoPriorEmployment: boolean;
  education: PublicApplicationEducation[];
  employmentHistory: PublicApplicationEmploymentHistory[];
  references: PublicApplicationReference[];
  availability: PublicApplicationAvailability[];
  certifications: PublicApplicationCertification[];

  certification: {
    accepted: true;
    typedName: string;
  };
};

type JsonObject = Record<string, unknown>;

const applicationFormVersion = "stage1-v1";
const certificationTextVersion = "stage1-certification-v1";

const educationTypes = [
  "high_school",
  "college",
  "vocational",
  "certification_program",
  "other",
] as const;

const employmentTypes = [
  "full_time",
  "part_time",
  "prn",
  "either",
  "other",
] as const;

const contactMethods = [
  "email",
  "phone",
  "text",
  "no_preference",
] as const;

const shiftPreferences = [
  "day",
  "evening",
  "overnight",
  "weekend",
  "flexible",
  "other",
] as const;

const contactStatuses = ["yes", "no", "later"] as const;

const certificationTypes = [
  "cpr",
  "first_aid",
  "medication_administration",
  "tb_test",
  "driver_license",
  "training",
  "other",
] as const;

const daysOfWeek = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const publicApplicationContractVersions = {
  applicationFormVersion,
  certificationTextVersion,
} as const;

function isJsonObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function getObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return value;
}

function assertKnownFields(
  body: JsonObject,
  allowedFields: readonly string[],
  path: string
): void {
  const allowed = new Set(allowedFields);
  const unknownFields = Object.keys(body).filter(
    (fieldName) => !allowed.has(fieldName)
  );

  if (unknownFields.length > 0) {
    throw new Error(
      `${path} contains unsupported field(s): ${unknownFields.join(", ")}.`
    );
  }
}

function getRequiredString(
  body: JsonObject,
  fieldName: string,
  maxLength: number,
  path: string
): string {
  const value = body[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path}.${fieldName} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(
      `${path}.${fieldName} must be ${maxLength} characters or less.`
    );
  }

  return trimmed;
}

function getOptionalString(
  body: JsonObject,
  fieldName: string,
  maxLength: number,
  path: string
): string | null {
  const value = body[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${path}.${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new Error(
      `${path}.${fieldName} must be ${maxLength} characters or less.`
    );
  }

  return trimmed;
}

function getRequiredBoolean(
  body: JsonObject,
  fieldName: string,
  path: string
): boolean {
  const value = body[fieldName];

  if (typeof value !== "boolean") {
    throw new Error(`${path}.${fieldName} must be true or false.`);
  }

  return value;
}

function getOptionalBoolean(
  body: JsonObject,
  fieldName: string,
  path: string
): boolean | null {
  const value = body[fieldName];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${path}.${fieldName} must be true, false, or null.`);
  }

  return value;
}

function getOptionalNumber(
  body: JsonObject,
  fieldName: string,
  minimum: number,
  maximum: number,
  path: string
): number | null {
  const value = body[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${path}.${fieldName} must be between ${minimum} and ${maximum}.`
    );
  }

  return value;
}

function getOptionalInteger(
  body: JsonObject,
  fieldName: string,
  minimum: number,
  maximum: number,
  path: string
): number | null {
  const value = getOptionalNumber(
    body,
    fieldName,
    minimum,
    maximum,
    path
  );

  if (value !== null && !Number.isInteger(value)) {
    throw new Error(`${path}.${fieldName} must be a whole number.`);
  }

  return value;
}

function getRequiredEnum<T extends string>(
  body: JsonObject,
  fieldName: string,
  values: readonly T[],
  path: string
): T {
  const value = body[fieldName];

  if (
    typeof value !== "string" ||
    !values.includes(value as T)
  ) {
    throw new Error(
      `${path}.${fieldName} must be one of: ${values.join(", ")}.`
    );
  }

  return value as T;
}

function getOptionalEnum<T extends string>(
  body: JsonObject,
  fieldName: string,
  values: readonly T[],
  path: string
): T | null {
  const value = body[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "string" ||
    !values.includes(value as T)
  ) {
    throw new Error(
      `${path}.${fieldName} must be one of: ${values.join(", ")}.`
    );
  }

  return value as T;
}

function getArray(
  body: JsonObject,
  fieldName: string,
  minimumLength: number,
  maximumLength: number,
  path: string
): unknown[] {
  const value = body[fieldName];

  if (!Array.isArray(value)) {
    throw new Error(`${path}.${fieldName} must be an array.`);
  }

  if (
    value.length < minimumLength ||
    value.length > maximumLength
  ) {
    throw new Error(
      `${path}.${fieldName} must contain between ` +
        `${minimumLength} and ${maximumLength} item(s).`
    );
  }

  return value;
}

function getOptionalDate(
  body: JsonObject,
  fieldName: string,
  path: string
): string | null {
  const value = getOptionalString(body, fieldName, 10, path);

  if (value === null) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${path}.${fieldName} must use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${path}.${fieldName} must be a valid date.`);
  }

  return value;
}

function getOptionalTime(
  body: JsonObject,
  fieldName: string,
  path: string
): string | null {
  const value = getOptionalString(body, fieldName, 5, path);

  if (value === null) {
    return null;
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${path}.${fieldName} must use 24-hour HH:MM.`);
  }

  return value;
}

function validateEmail(value: string, path: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error(`${path} must be a valid email address.`);
  }

  return normalized;
}

function parseEducation(value: unknown, index: number) {
  const path = `education[${index}]`;
  const body = getObject(value, path);

  assertKnownFields(
    body,
    [
      "educationType",
      "schoolName",
      "schoolLocation",
      "degreeOrProgram",
      "yearsAttended",
      "graduated",
    ],
    path
  );

  return {
    educationType: getRequiredEnum(
      body,
      "educationType",
      educationTypes,
      path
    ),
    schoolName: getRequiredString(body, "schoolName", 200, path),
    schoolLocation: getOptionalString(
      body,
      "schoolLocation",
      200,
      path
    ),
    degreeOrProgram: getOptionalString(
      body,
      "degreeOrProgram",
      200,
      path
    ),
    yearsAttended: getOptionalString(
      body,
      "yearsAttended",
      50,
      path
    ),
    graduated: getOptionalBoolean(body, "graduated", path),
  };
}

function parseEmploymentHistory(value: unknown, index: number) {
  const path = `employmentHistory[${index}]`;
  const body = getObject(value, path);

  assertKnownFields(
    body,
    [
      "companyName",
      "positionTitle",
      "employerAddress",
      "employerPhone",
      "supervisorName",
      "startDate",
      "endDate",
      "reasonForLeaving",
      "salaryOrRate",
      "responsibilities",
      "mayContactStatus",
    ],
    path
  );

  const startDate = getOptionalDate(body, "startDate", path);
  const endDate = getOptionalDate(body, "endDate", path);

  if (
    startDate !== null &&
    endDate !== null &&
    endDate < startDate
  ) {
    throw new Error(
      `${path}.endDate cannot be earlier than startDate.`
    );
  }

  return {
    companyName: getRequiredString(body, "companyName", 200, path),
    positionTitle: getOptionalString(
      body,
      "positionTitle",
      200,
      path
    ),
    employerAddress: getOptionalString(
      body,
      "employerAddress",
      300,
      path
    ),
    employerPhone: normalizePhone(getOptionalString(
      body,
      "employerPhone",
      50,
      path
    ) ?? "") || null,
    supervisorName: getOptionalString(
      body,
      "supervisorName",
      200,
      path
    ),
    startDate,
    endDate,
    reasonForLeaving: getOptionalString(
      body,
      "reasonForLeaving",
      1000,
      path
    ),
    salaryOrRate: getOptionalString(
      body,
      "salaryOrRate",
      100,
      path
    ),
    responsibilities: getOptionalString(
      body,
      "responsibilities",
      2000,
      path
    ),
    mayContactStatus: getRequiredEnum(
      body,
      "mayContactStatus",
      contactStatuses,
      path
    ),
  };
}

function parseReference(value: unknown, index: number) {
  const path = `references[${index}]`;
  const body = getObject(value, path);

  assertKnownFields(
    body,
    [
      "fullName",
      "relationship",
      "yearsKnown",
      "companyName",
      "phone",
      "email",
      "address",
    ],
    path
  );

  const email = getOptionalString(body, "email", 320, path);

  return {
    fullName: getRequiredString(body, "fullName", 200, path),
    relationship: getOptionalString(
      body,
      "relationship",
      100,
      path
    ),
    yearsKnown: getOptionalInteger(
      body,
      "yearsKnown",
      0,
      100,
      path
    ),
    companyName: getOptionalString(
      body,
      "companyName",
      200,
      path
    ),
    phone: normalizePhone(getOptionalString(body, "phone", 50, path) ?? "") || null,
    email:
      email === null
        ? null
        : validateEmail(email, `${path}.email`),
    address: getOptionalString(body, "address", 300, path),
  };
}

function parseAvailability(value: unknown, index: number) {
  const path = `availability[${index}]`;
  const body = getObject(value, path);

  assertKnownFields(
    body,
    [
      "dayOfWeek",
      "available",
      "firstShiftAvailable",
      "secondShiftAvailable",
      "thirdShiftAvailable",
      "earliestStartTime",
      "latestEndTime",
      "preferredShift",
      "notes",
    ],
    path
  );

  const available = getRequiredBoolean(body, "available", path);
  const firstShiftAvailable = getRequiredBoolean(
    body,
    "firstShiftAvailable",
    path
  );
  const secondShiftAvailable = getRequiredBoolean(
    body,
    "secondShiftAvailable",
    path
  );
  const thirdShiftAvailable = getRequiredBoolean(
    body,
    "thirdShiftAvailable",
    path
  );

  const earliestStartTime = getOptionalTime(
    body,
    "earliestStartTime",
    path
  );
  const latestEndTime = getOptionalTime(
    body,
    "latestEndTime",
    path
  );

  if (
    !available &&
    (
      firstShiftAvailable ||
      secondShiftAvailable ||
      thirdShiftAvailable ||
      earliestStartTime !== null ||
      latestEndTime !== null
    )
  ) {
    throw new Error(
      `${path} cannot include shifts or times when available is false.`
    );
  }

  return {
    dayOfWeek: getRequiredEnum(
      body,
      "dayOfWeek",
      daysOfWeek,
      path
    ),
    available,
    firstShiftAvailable,
    secondShiftAvailable,
    thirdShiftAvailable,
    earliestStartTime,
    latestEndTime,
    preferredShift: getOptionalEnum(
      body,
      "preferredShift",
      shiftPreferences,
      path
    ),
    notes: getOptionalString(body, "notes", 500, path),
  };
}

function parseCertification(value: unknown, index: number) {
  const path = `certifications[${index}]`;
  const body = getObject(value, path);

  assertKnownFields(
    body,
    [
      "certificationType",
      "certificationName",
      "issuingOrganization",
      "issuedDate",
      "expirationDate",
      "notes",
    ],
    path
  );

  const issuedDate = getOptionalDate(body, "issuedDate", path);
  const expirationDate = getOptionalDate(
    body,
    "expirationDate",
    path
  );

  if (
    issuedDate !== null &&
    expirationDate !== null &&
    expirationDate < issuedDate
  ) {
    throw new Error(
      `${path}.expirationDate cannot be earlier than issuedDate.`
    );
  }

  return {
    certificationType: getRequiredEnum(
      body,
      "certificationType",
      certificationTypes,
      path
    ),
    certificationName: getRequiredString(
      body,
      "certificationName",
      200,
      path
    ),
    issuingOrganization: getOptionalString(
      body,
      "issuingOrganization",
      200,
      path
    ),
    issuedDate,
    expirationDate,
    notes: getOptionalString(body, "notes", 500, path),
  };
}

export function parsePublicEmploymentApplication(
  value: unknown
): PublicEmploymentApplicationSubmission {
  const body = getObject(value, "request");

  assertKnownFields(
    body,
    [
      "applicant",
      "position",
      "qualifications",
      "hasNoPriorEmployment",
      "education",
      "employmentHistory",
      "references",
      "availability",
      "certifications",
      "certification",
      "website",
    ],
    "request"
  );

  const honeypot = getOptionalString(
    body,
    "website",
    200,
    "request"
  );

  if (honeypot !== null) {
    throw new Error("The application could not be accepted.");
  }

  const applicant = getObject(body.applicant, "applicant");

  assertKnownFields(
    applicant,
    [
      "firstName",
      "middleName",
      "lastName",
      "email",
      "phone",
      "addressLine1",
      "addressLine2",
      "city",
      "stateCode",
      "postalCode",
      "county",
      "preferredContactMethod",
    ],
    "applicant"
  );

  const applicantEmail = validateEmail(
    getRequiredString(applicant, "email", 320, "applicant"),
    "applicant.email"
  );

  const applicantPhone = getRequiredString(
    applicant,
    "phone",
    50,
    "applicant"
  );

  const preferredContactMethod = getRequiredEnum(
    applicant,
    "preferredContactMethod",
    contactMethods,
    "applicant"
  );

  if (applicantPhone === null && (preferredContactMethod === "phone" || preferredContactMethod === "text")) {
    throw new Error("applicant.phone is required for phone or text contact.");
  }

  const stateCode = getRequiredString(
    applicant,
    "stateCode",
    2,
    "applicant"
  ).toUpperCase();

  if (!/^[A-Z]{2}$/.test(stateCode)) {
    throw new Error(
      "applicant.stateCode must be a two-letter state code."
    );
  }

  const postalCode = getRequiredString(
    applicant,
    "postalCode",
    20,
    "applicant"
  );

  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new Error(
      "applicant.postalCode must be a valid ZIP or ZIP+4 code."
    );
  }

  const position = getObject(body.position, "position");
  const desiredRole = getRequiredString(position, "desiredRole", 100, "position");
  if (!normalizeJobTitle(desiredRole)) throw new Error("position.desiredRole must be Caregiver / Direct Support Professional, Supervisor or Administrator.");

  assertKnownFields(
    position,
    [
      "desiredRole",
      "dateAvailable",
      "employmentTypePreference",
      "desiredHoursPerWeek",
      "payExpectation",
      "workedForEsiBefore",
      "previousEsiDetails",
      "workAuthorized",
      "sponsorshipRequired",
      "essentialFunctionsAcknowledged",
      "accommodationRequested",
      "accommodationNotes",
    ],
    "position"
  );

  // Retired prior-ESI keys are accepted from older clients but are not collected.
  if (!getRequiredBoolean(position, "essentialFunctionsAcknowledged", "position")) {
    throw new Error("position.essentialFunctionsAcknowledged must be accepted to submit the application.");
  }
  if (getRequiredBoolean(position, "accommodationRequested", "position") &&
      getOptionalString(position, "accommodationNotes", 1000, "position") === null) {
    throw new Error("position.accommodationNotes is required when accommodationRequested is true.");
  }

  const qualifications = getObject(
    body.qualifications,
    "qualifications"
  );

  assertKnownFields(
    qualifications,
    [
      "hasReliableTransportation",
      "hasValidDriverLicense",
      "cprCertified",
      "cprExpirationDate",
      "firstAidCertified",
      "firstAidExpirationDate",
      "medicationCertified",
      "medicationCertificationExpirationDate",
      "tbTestCurrent",
      "tbTestExpirationDate",
      "preferredShift",
      "availabilityNotes",
      "skillsAndExperience",
      "additionalInformation",
    ],
    "qualifications"
  );

  const hasNoPriorEmployment = getRequiredBoolean(
    body,
    "hasNoPriorEmployment",
    "request"
  );

  const education = getArray(
    body,
    "education",
    1,
    10,
    "request"
  ).map(parseEducation);

  const employmentHistory = getArray(
    body,
    "employmentHistory",
    0,
    10,
    "request"
  ).map(parseEmploymentHistory);

  if (hasNoPriorEmployment && employmentHistory.length > 0) {
    throw new Error(
      "employmentHistory must be empty when " +
        "hasNoPriorEmployment is true."
    );
  }

  if (!hasNoPriorEmployment && employmentHistory.length === 0) {
    throw new Error(
      "At least one employmentHistory entry is required unless " +
        "hasNoPriorEmployment is true."
    );
  }

  const references = getArray(
    body,
    "references",
    1,
    3,
    "request"
  ).map(parseReference);

  const availability = getArray(
    { ...body, availability: body.availability ?? [] },
    "availability",
    0,
    7,
    "request"
  ).map(parseAvailability);

  const submittedDays = new Set(
    availability.map((entry) => entry.dayOfWeek)
  );

  if (
    submittedDays.size !== availability.length
  ) {
    throw new Error(
      "availability must not contain duplicate days."
    );
  }

  const certifications = getArray(
    body,
    "certifications",
    0,
    20,
    "request"
  ).map(parseCertification);

  const certification = getObject(
    body.certification,
    "certification"
  );

  assertKnownFields(
    certification,
    ["accepted", "typedName"],
    "certification"
  );

  const accepted = getRequiredBoolean(
    certification,
    "accepted",
    "certification"
  );

  if (!accepted) {
    throw new Error(
      "certification.accepted must be true to submit the application."
    );
  }

  return {
    applicant: {
      firstName: getRequiredString(
        applicant,
        "firstName",
        100,
        "applicant"
      ),
      middleName: getOptionalString(
        applicant,
        "middleName",
        100,
        "applicant"
      ),
      lastName: getRequiredString(
        applicant,
        "lastName",
        100,
        "applicant"
      ),
      email: applicantEmail,
      phone: applicantPhone === null ? null : normalizePhone(applicantPhone),
      addressLine1: getRequiredString(
        applicant,
        "addressLine1",
        200,
        "applicant"
      ),
      addressLine2: getOptionalString(
        applicant,
        "addressLine2",
        200,
        "applicant"
      ),
      city: getRequiredString(
        applicant,
        "city",
        100,
        "applicant"
      ),
      stateCode,
      postalCode,
      county: getOptionalString(
        applicant,
        "county",
        100,
        "applicant"
      ),
      preferredContactMethod,
    },

    position: {
      desiredRole,
      dateAvailable: getOptionalDate(
        position,
        "dateAvailable",
        "position"
      ),
      employmentTypePreference: getRequiredEnum(
        position,
        "employmentTypePreference",
        employmentTypes,
        "position"
      ),
      desiredHoursPerWeek: getOptionalNumber(
        position,
        "desiredHoursPerWeek",
        0,
        168,
        "position"
      ),
      payExpectation: getOptionalNumber(
        position,
        "payExpectation",
        0,
        1000,
        "position"
      ),
      workAuthorized: getRequiredBoolean(
        position,
        "workAuthorized",
        "position"
      ),
      sponsorshipRequired: getOptionalBoolean(
        position,
        "sponsorshipRequired",
        "position"
      ),
      essentialFunctionsAcknowledged: getRequiredBoolean(
        position,
        "essentialFunctionsAcknowledged",
        "position"
      ),
      accommodationRequested: getRequiredBoolean(
        position,
        "accommodationRequested",
        "position"
      ),
      accommodationNotes: getOptionalString(
        position,
        "accommodationNotes",
        1000,
        "position"
      ),
    },

    qualifications: {
      hasReliableTransportation: getRequiredBoolean(
        qualifications,
        "hasReliableTransportation",
        "qualifications"
      ),
      hasValidDriverLicense: getRequiredBoolean(
        qualifications,
        "hasValidDriverLicense",
        "qualifications"
      ),
      cprCertified: getRequiredBoolean(
        qualifications,
        "cprCertified",
        "qualifications"
      ),
      cprExpirationDate: getOptionalDate(
        qualifications,
        "cprExpirationDate",
        "qualifications"
      ),
      firstAidCertified: getRequiredBoolean(
        qualifications,
        "firstAidCertified",
        "qualifications"
      ),
      firstAidExpirationDate: getOptionalDate(
        qualifications,
        "firstAidExpirationDate",
        "qualifications"
      ),
      medicationCertified: getRequiredBoolean(
        qualifications,
        "medicationCertified",
        "qualifications"
      ),
      medicationCertificationExpirationDate: getOptionalDate(
        qualifications,
        "medicationCertificationExpirationDate",
        "qualifications"
      ),
      tbTestCurrent: getRequiredBoolean(
        qualifications,
        "tbTestCurrent",
        "qualifications"
      ),
      tbTestExpirationDate: getOptionalDate(
        qualifications,
        "tbTestExpirationDate",
        "qualifications"
      ),
      preferredShift: getOptionalEnum(
        qualifications,
        "preferredShift",
        shiftPreferences,
        "qualifications"
      ),
      availabilityNotes: getOptionalString(
        qualifications,
        "availabilityNotes",
        1000,
        "qualifications"
      ),
      skillsAndExperience: getOptionalString(
        qualifications,
        "skillsAndExperience",
        4000,
        "qualifications"
      ),
      additionalInformation: getOptionalString(
        qualifications,
        "additionalInformation",
        4000,
        "qualifications"
      ),
    },

    hasNoPriorEmployment,
    education,
    employmentHistory,
    references,
    availability,
    certifications,

    certification: {
      accepted: true,
      typedName: getRequiredString(
        certification,
        "typedName",
        200,
        "certification"
      ),
    },
  };
}
