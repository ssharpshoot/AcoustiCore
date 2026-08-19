import { REQUIRED_FREQUENCIES, quantityGainDb } from "./calculations.js";

export const EVIDENCE_GRADES = Object.freeze({
  VERIFIED_MEASUREMENT: "verified_measurement",
  TRACEABLE_MEASUREMENT: "traceable_measurement",
  MANUFACTURER_SPEC: "manufacturer_spec",
  LEGACY_PROXY: "legacy_proxy",
});

export const ASSESSMENT_STATUSES = Object.freeze({
  SCREENING_PASS: "screening_pass",
  SCREENING_SHORTFALL: "screening_shortfall",
  PROVISIONAL: "provisional",
  INSUFFICIENT: "insufficient",
});

export const CALCULATION_MODEL_VERSION = "acousticore-screening-v2";
export const LEGACY_PROXY_VERSION = "legacy-size-power-v1";

const APPROVED_LICENSES = new Set(["approved", "licensed", "public-domain"]);
const APPROVED_REVIEWS = new Set(["approved", "manual-approved"]);
const SUPPORTED_STANDARDS = new Set(["CEA-2010-A", "CTA-2010-B", "CTA-2010-C"]);

function positive(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function evidenceGradeForTest(test) {
  if (!test) return EVIDENCE_GRADES.MANUFACTURER_SPEC;
  const completeBasis = SUPPORTED_STANDARDS.has(test.standard)
    && positive(test.basisDistanceM)
    && Boolean(test.measurementType)
    && Boolean(test.source);
  const sourceComplete = completeBasis && Boolean(test.sourceUrl);
  const governanceComplete = APPROVED_LICENSES.has(test.licenseStatus)
    && APPROVED_REVIEWS.has(test.reviewStatus);
  return sourceComplete && governanceComplete
    ? EVIDENCE_GRADES.VERIFIED_MEASUREMENT
    : EVIDENCE_GRADES.TRACEABLE_MEASUREMENT;
}

export function assessSubwooferCapacity({ capacity, targetDb, evidenceGrade }) {
  if (!capacity) {
    return {
      status: ASSESSMENT_STATUSES.INSUFFICIENT,
      label: "信息不足",
      weakestBand: null,
      completeBandSet: false,
    };
  }

  const bands = REQUIRED_FREQUENCIES
    .map((frequency) => ({ frequency, value: capacity.values[String(frequency)] }))
    .filter((item) => item.value);
  const completeBandSet = bands.length === REQUIRED_FREQUENCIES.length;
  const weakestBand = bands
    .map((item) => ({ ...item, gap: item.value.low - Number(targetDb) }))
    .sort((a, b) => a.gap - b.gap)[0] ?? null;

  if (evidenceGrade !== EVIDENCE_GRADES.VERIFIED_MEASUREMENT || !completeBandSet) {
    return {
      status: ASSESSMENT_STATUSES.PROVISIONAL,
      label: "暂定估算",
      weakestBand,
      completeBandSet,
    };
  }

  const passed = weakestBand && weakestBand.gap >= 0;
  return {
    status: passed ? ASSESSMENT_STATUSES.SCREENING_PASS : ASSESSMENT_STATUSES.SCREENING_SHORTFALL,
    label: passed ? "数据初筛通过" : "数据初筛存在缺口",
    weakestBand,
    completeBandSet,
  };
}

function enclosureBonus(type) {
  const normalized = String(type || "").toLowerCase();
  if (/倒相|导向|ported|vented/.test(normalized)) return 3;
  if (/被动|passive radiator/.test(normalized)) return 2.5;
  if (/推挽|push.?pull/.test(normalized)) return 1.5;
  return 0;
}

export function legacySubwooferProxy({
  wooferSizeIn,
  amplifierPowerWatts,
  enclosureType,
  quantity = 1,
  listeningDistanceMeters = 2,
}) {
  const size = positive(wooferSizeIn);
  const power = positive(amplifierPowerWatts);
  const distance = positive(listeningDistanceMeters, 2);
  if (!size || !power) return null;

  const baseEfficiency = 84 + (size - 12) * 0.66;
  const nominalAtOneMeter = baseEfficiency + enclosureBonus(enclosureType) + 10 * Math.log10(power);
  const nominal = nominalAtOneMeter - 20 * Math.log10(distance) + quantityGainDb(quantity);
  return {
    nominal,
    nominalAtOneMeter,
    evidenceGrade: EVIDENCE_GRADES.LEGACY_PROXY,
    status: ASSESSMENT_STATUSES.PROVISIONAL,
    modelVersion: LEGACY_PROXY_VERSION,
  };
}

export function axialRoomModes({ length, width, height, speedOfSound = 343 }) {
  const dimensions = { length: positive(length), width: positive(width), height: positive(height) };
  if (Object.values(dimensions).some((value) => !value)) return null;
  return Object.fromEntries(Object.entries(dimensions).map(([axis, dimension]) => [
    axis,
    [1, 2, 3].map((order) => ({ order, frequency: speedOfSound * order / (2 * dimension) })),
  ]));
}

export function seatConsistencyAssessment({ quantity = 1, seatCount = 1, openSpace = false }) {
  const subs = Math.max(1, Number(quantity) || 1);
  const seats = Math.max(1, Number(seatCount) || 1);
  if (seats === 1) {
    return {
      key: openSpace ? "warning" : "neutral",
      label: openSpace ? "开放空间仍需多点测量" : "单座位，一致性未评估",
      reason: "单一主位不能代表其他座位；摆位、相位和 EQ 仍需实测。",
    };
  }
  if (subs === 1) {
    return {
      key: "warning",
      label: "多座位一致性风险较高",
      reason: "建议至少预留两只低音炮的独立摆位、延时和电平调节能力；这是均匀性建议，不代表容量必然不足。",
    };
  }
  return {
    key: openSpace ? "warning" : "success",
    label: openSpace ? "具备多炮调校条件，开放空间需实测" : "具备多炮一致性调校条件",
    reason: "数量增加了摆位与调校自由度，但不能保证各座位自动一致。",
  };
}
