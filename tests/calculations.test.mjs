import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPERIENCE_LEVELS,
  mainChannelCapacity,
  quantityGainDb,
  requiredPower,
  requiredSensitivity,
  sensitivityAtOneWatt,
  subwooferCapacity,
} from "../src/calculations.js";
import {
  ASSESSMENT_STATUSES,
  EVIDENCE_GRADES,
  assessSubwooferCapacity,
  axialRoomModes,
  evidenceGradeForTest,
  legacySubwooferProxy,
  seatConsistencyAssessment,
} from "../src/assessment.js";

test("three experience presets use the approved peak targets", () => {
  assert.deepEqual(
    Object.values(EXPERIENCE_LEVELS).map(({ mainTargetDb, lfeTargetDb }) => [mainTargetDb, lfeTargetDb]),
    [[95, 105], [100, 110], [105, 115]],
  );
});

test("main capacity uses sensitivity, continuous power and distance only", () => {
  const result = mainChannelCapacity({
    sensitivity: 90,
    sensitivityBasis: "1w",
    impedance: 8,
    powerWatts: 200,
    distanceMeters: 3.5,
    evidence: "traceable",
  });
  assert.ok(Math.abs(result.nominal - 102.13) < 0.02);
  assert.equal(result.uncertainty, 3);
  assert.ok(Math.abs(result.low - 99.13) < 0.02);
});

test("2.83V sensitivity is normalized against the declared impedance", () => {
  assert.ok(Math.abs(sensitivityAtOneWatt({ sensitivity: 90, basis: "2.83v", impedance: 4 }) - 86.99) < 0.02);
  assert.equal(sensitivityAtOneWatt({ sensitivity: 90, basis: "2.83v", impedance: 8 }), 90);
});

test("required sensitivity and required power round-trip to the target", () => {
  const sensitivity = requiredSensitivity({ targetDb: 100, powerWatts: 200, distanceMeters: 3.5 });
  const power = requiredPower({ targetDb: 100, sensitivity, distanceMeters: 3.5 });
  assert.ok(Math.abs(power - 200) < 0.001);
});

test("subwoofer quantity uses conservative energy summation", () => {
  assert.ok(Math.abs(quantityGainDb(2) - 3.0103) < 0.001);
  assert.ok(Math.abs(quantityGainDb(4) - 6.0206) < 0.001);
  const result = subwooferCapacity({
    measurements: { 20: 96, 31.5: 103, 40: 108, 63: 112 },
    quantity: 2,
    listeningDistanceMeters: 2,
    measurementDistanceMeters: 2,
  });
  assert.ok(Math.abs(result.values["20"].nominal - 99.0103) < 0.001);
  assert.equal(result.uncertaintyDb, 4);
});

test("missing measurements never produce an absolute subwoofer capacity", () => {
  assert.equal(subwooferCapacity({ measurements: null, quantity: 4 }), null);
  assert.equal(subwooferCapacity({ measurements: {}, quantity: 4 }), null);
});

test("main capacity respects declared speaker power and maximum SPL limits", () => {
  const result = mainChannelCapacity({
    sensitivity: 90,
    powerWatts: 500,
    distanceMeters: 2,
    speakerContinuousPowerWatts: 100,
    speakerMaxSplDb: 108,
  });
  assert.equal(result.effectivePowerWatts, 100);
  assert.equal(result.powerLimited, true);
  assert.equal(result.maxSplLimited, true);
  assert.ok(Math.abs(result.nominal - (108 - 20 * Math.log10(2))) < 0.001);
});

test("only fully governed measurements can produce screening pass or shortfall", () => {
  const capacity = subwooferCapacity({
    measurements: { 20: 120, 25: 120, 31.5: 120, 40: 120, 50: 120, 63: 120 },
  });
  const traceable = assessSubwooferCapacity({
    capacity,
    targetDb: 110,
    evidenceGrade: EVIDENCE_GRADES.TRACEABLE_MEASUREMENT,
  });
  assert.equal(traceable.status, ASSESSMENT_STATUSES.PROVISIONAL);

  const verified = evidenceGradeForTest({
    standard: "CTA-2010-C",
    basisDistanceM: 2,
    measurementType: "peak",
    source: "Independent lab",
    sourceUrl: "https://example.com/test",
    licenseStatus: "approved",
    reviewStatus: "manual-approved",
  });
  assert.equal(verified, EVIDENCE_GRADES.VERIFIED_MEASUREMENT);
  assert.equal(assessSubwooferCapacity({ capacity, targetDb: 110, evidenceGrade: verified }).status, ASSESSMENT_STATUSES.SCREENING_PASS);
});

test("legacy size and power proxy is permanently provisional", () => {
  const result = legacySubwooferProxy({
    wooferSizeIn: 18,
    amplifierPowerWatts: 2000,
    enclosureType: "倒相式",
    quantity: 4,
    listeningDistanceMeters: 1,
  });
  assert.ok(result.nominal > 120);
  assert.equal(result.status, ASSESSMENT_STATUSES.PROVISIONAL);
  assert.equal(result.evidenceGrade, EVIDENCE_GRADES.LEGACY_PROXY);
});

test("room modes and seat consistency remain planning risk indicators", () => {
  const modes = axialRoomModes({ length: 6, width: 4, height: 2.8 });
  assert.ok(Math.abs(modes.length[0].frequency - 28.583) < 0.01);
  assert.equal(seatConsistencyAssessment({ quantity: 1, seatCount: 4 }).key, "warning");
  assert.match(seatConsistencyAssessment({ quantity: 2, seatCount: 4 }).label, /调校条件/);
});
