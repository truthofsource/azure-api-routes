import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublicEmploymentApplication } from "./publicEmploymentApplication";

test("new applications omit sponsorship while legacy answers remain readable", () => {
  const raw = createValidSubmission();
  const position = raw.position as Record<string, unknown>;
  delete position.sponsorshipRequired;
  assert.equal(parsePublicEmploymentApplication(raw).position.sponsorshipRequired, null);
  position.sponsorshipRequired = true;
  assert.equal(parsePublicEmploymentApplication(raw).position.sponsorshipRequired, true);
});

function createValidSubmission(): Record<string, unknown> {
  const availability = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].map((dayOfWeek) => ({
    dayOfWeek,
    available: false,
    firstShiftAvailable: false,
    secondShiftAvailable: false,
    thirdShiftAvailable: false,
    earliestStartTime: null,
    latestEndTime: null,
    preferredShift: null,
    notes: null,
  }));

  return {
    applicant: {
      firstName: "Test",
      middleName: null,
      lastName: "Applicant",
      email: "TEST.APPLICANT@example.com",
      phone: "615-555-0100",
      addressLine1: "100 Test Avenue",
      addressLine2: null,
      city: "Old Hickory",
      stateCode: "tn",
      postalCode: "37138",
      county: "Davidson",
      preferredContactMethod: "email",
    },

    position: {
      desiredRole: "Caregiver",
      dateAvailable: "2026-08-01",
      employmentTypePreference: "prn",
      desiredHoursPerWeek: 24,
      payExpectation: null,
      workAuthorized: true,
      sponsorshipRequired: false,
      essentialFunctionsAcknowledged: true,
      accommodationRequested: false,
      accommodationNotes: null,
    },

    qualifications: {
      hasReliableTransportation: true,
      hasValidDriverLicense: true,
      cprCertified: false,
      cprExpirationDate: null,
      firstAidCertified: false,
      firstAidExpirationDate: null,
      medicationCertified: false,
      medicationCertificationExpirationDate: null,
      tbTestCurrent: false,
      tbTestExpirationDate: null,
      preferredShift: "flexible",
      availabilityNotes: null,
      skillsAndExperience: "Synthetic development test data.",
      additionalInformation: null,
    },

    hasNoPriorEmployment: true,

    education: [
      {
        educationType: "high_school",
        schoolName: "Synthetic High School",
        schoolLocation: "Nashville, TN",
        degreeOrProgram: "Diploma",
        yearsAttended: "2010-2014",
        graduated: true,
      },
    ],

    employmentHistory: [],

    references: [
      {
        fullName: "Reference One",
        relationship: "Supervisor",
        yearsKnown: 3,
        companyName: "Synthetic Company One",
        phone: "615-555-0101",
        email: "reference.one@example.com",
        address: null,
      },
    ],

    availability,

    certifications: [],

    certification: {
      accepted: true,
      typedName: "Test Applicant",
    },
  };
}

test("accepts and normalizes a valid Stage 1 application", () => {
  const parsed = parsePublicEmploymentApplication(
    createValidSubmission()
  );

  assert.equal(
    parsed.applicant.email,
    "test.applicant@example.com"
  );
  assert.equal(parsed.applicant.stateCode, "TN");
  assert.equal(parsed.position.employmentTypePreference, "prn");
  assert.equal(parsed.availability.length, 7);
  assert.equal(parsed.references.length, 1);
  assert.equal(parsed.certification.accepted, true);
});

test("accepts one to three references", () => {
  const missingReferenceSubmission = createValidSubmission();

  missingReferenceSubmission.references = [];

  assert.throws(
    () =>
      parsePublicEmploymentApplication(
        missingReferenceSubmission
      ),
    /references/
  );

  const threeReferenceSubmission = createValidSubmission();

  const threeReferences =
    threeReferenceSubmission.references as Array<
      Record<string, unknown>
    >;

  const firstReference = threeReferences[0];

  assert.ok(firstReference);

  threeReferences.push(
    {
      ...firstReference,
      fullName: "Reference Two",
      email: "reference.two@example.com",
    },
    {
      ...firstReference,
      fullName: "Reference Three",
      email: "reference.three@example.com",
    }
  );

  const parsedThreeReferenceSubmission =
    parsePublicEmploymentApplication(
      threeReferenceSubmission
    );

  assert.equal(
    parsedThreeReferenceSubmission.references.length,
    3
  );

  const tooManyReferenceSubmission =
    createValidSubmission();

  const tooManyReferences =
    tooManyReferenceSubmission.references as Array<
      Record<string, unknown>
    >;

  const originalReference = tooManyReferences[0];

  assert.ok(originalReference);

  tooManyReferences.push(
    {
      ...originalReference,
      fullName: "Reference Two",
      email: "reference.two@example.com",
    },
    {
      ...originalReference,
      fullName: "Reference Three",
      email: "reference.three@example.com",
    },
    {
      ...originalReference,
      fullName: "Reference Four",
      email: "reference.four@example.com",
    }
  );

  assert.throws(
    () =>
      parsePublicEmploymentApplication(
        tooManyReferenceSubmission
      ),
    /references/
  );
});

test("rejects unsupported Stage 2 applicant fields", () => {
  const submission = createValidSubmission();
  const applicant = submission.applicant as Record<string, unknown>;

  applicant.dateOfBirth = "1990-01-01";

  assert.throws(
    () => parsePublicEmploymentApplication(submission),
    /applicant contains unsupported field\(s\): dateOfBirth/
  );
});

test("requires employment history when no-prior-employment is false", () => {
  const submission = createValidSubmission();

  submission.hasNoPriorEmployment = false;

  assert.throws(
    () => parsePublicEmploymentApplication(submission),
    /At least one employmentHistory entry is required/
  );
});

test("rejects duplicate availability days", () => {
  const submission = createValidSubmission();
  const availability = submission.availability as Array<
    Record<string, unknown>
  >;

  availability[6].dayOfWeek = "Monday";

  assert.throws(
    () => parsePublicEmploymentApplication(submission),
    /duplicate days/
  );
});

test("requires applicant certification acceptance", () => {
  const submission = createValidSubmission();
  const certification = submission.certification as Record<
    string,
    unknown
  >;

  certification.accepted = false;

  assert.throws(
    () => parsePublicEmploymentApplication(submission),
    /certification.accepted must be true/
  );
});

test("rejects a populated honeypot field", () => {
  const submission = createValidSubmission();

  submission.website = "https://spam.example";

  assert.throws(
    () => parsePublicEmploymentApplication(submission),
    /application could not be accepted/
  );
});

for (const phone of [undefined, null, "", "   "]) {
  test(`requires a phone even when email is preferred (${String(phone)})`, () => {
    const submission = createValidSubmission();
    const applicant = submission.applicant as Record<string, unknown>;
    applicant.preferredContactMethod = "email";
    applicant.phone = phone;
    assert.throws(() => parsePublicEmploymentApplication(submission), /applicant.phone/);
  });
}

test("requires the Apply acknowledgments and conditional accommodation details", () => {
  const withoutAcknowledgment = createValidSubmission();
  (withoutAcknowledgment.position as Record<string, unknown>).essentialFunctionsAcknowledged = false;
  assert.throws(() => parsePublicEmploymentApplication(withoutAcknowledgment), /essentialFunctionsAcknowledged/);

  const withoutAccommodationDetails = createValidSubmission();
  (withoutAccommodationDetails.position as Record<string, unknown>).accommodationRequested = true;
  (withoutAccommodationDetails.position as Record<string, unknown>).accommodationNotes = null;
  assert.throws(() => parsePublicEmploymentApplication(withoutAccommodationDetails), /accommodationNotes/);
});

test("availability may be omitted, empty or partially recorded without inventing days", () => {
  const submission = createValidSubmission();
  const days = submission.availability as Array<Record<string, unknown>>;
  for (const value of [undefined, null, [], [days[0]]]) {
    submission.availability = value;
    assert.deepEqual(parsePublicEmploymentApplication(submission).availability.map(day => day.dayOfWeek),
      Array.isArray(value) ? value.map(day => day.dayOfWeek) : []);
  }
});


test("retired prior-ESI questions are not required or returned, including older clients", () => {
  const body = createValidSubmission();
  const position = body.position as Record<string, unknown>;
  for (const legacy of [{}, { workedForEsiBefore: true, previousEsiDetails: null }, { workedForEsiBefore: null, previousEsiDetails: 'Old answer' }]) {
    const parsed = parsePublicEmploymentApplication({ ...body, position: { ...position, ...legacy } });
    assert.equal(Object.hasOwn(parsed.position, 'workedForEsiBefore'), false);
    assert.equal(Object.hasOwn(parsed.position, 'previousEsiDetails'), false);
  }
});
