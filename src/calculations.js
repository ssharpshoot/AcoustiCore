export const EXPERIENCE_LEVELS = Object.freeze({
  daily: {
    label: "日常电影",
    mainTargetDb: 95,
    lfeTargetDb: 105,
  },
  immersive: {
    label: "沉浸影院",
    mainTargetDb: 100,
    lfeTargetDb: 110,
  },
  reference: {
    label: "高动态影院",
    mainTargetDb: 105,
    lfeTargetDb: 115,
  },
});

export const REQUIRED_FREQUENCIES = Object.freeze([20, 25, 31.5, 40, 50, 63]);

function finitePositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function roundDb(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function sensitivityAtOneWatt({ sensitivity, basis = "1w", impedance = 8 }) {
  const declared = Number(sensitivity);
  if (!Number.isFinite(declared)) return null;
  if (basis !== "2.83v") return declared;

  const load = finitePositive(impedance, 8);
  return declared + 10 * Math.log10(load / 8);
}

export function sensitivityForBasis({ sensitivityAt1W, basis = "1w", impedance = 8 }) {
  const normalized = Number(sensitivityAt1W);
  if (!Number.isFinite(normalized)) return null;
  if (basis !== "2.83v") return normalized;

  const load = finitePositive(impedance, 8);
  return normalized - 10 * Math.log10(load / 8);
}

export function mainChannelCapacity({
  sensitivity,
  sensitivityBasis = "1w",
  impedance = 8,
  powerWatts,
  distanceMeters,
  evidence = "traceable",
  speakerContinuousPowerWatts = null,
  speakerMaxSplDb = null,
}) {
  const sensitivity1W = sensitivityAtOneWatt({
    sensitivity,
    basis: sensitivityBasis,
    impedance,
  });
  const amplifierPower = finitePositive(powerWatts);
  const declaredSpeakerPower = Number(speakerContinuousPowerWatts);
  const powerLimited = Number.isFinite(declaredSpeakerPower) && declaredSpeakerPower > 0
    && amplifierPower > declaredSpeakerPower;
  const power = powerLimited ? declaredSpeakerPower : amplifierPower;
  const distance = finitePositive(distanceMeters);
  const electricalNominal = sensitivity1W + 10 * Math.log10(power) - 20 * Math.log10(distance);
  const declaredMaxSpl = Number(speakerMaxSplDb);
  const distanceAdjustedMaxSpl = Number.isFinite(declaredMaxSpl) && declaredMaxSpl > 0
    ? declaredMaxSpl - 20 * Math.log10(distance)
    : null;
  const maxSplLimited = Number.isFinite(distanceAdjustedMaxSpl) && electricalNominal > distanceAdjustedMaxSpl;
  const nominal = maxSplLimited ? distanceAdjustedMaxSpl : electricalNominal;
  const uncertainty = evidence === "traceable" ? 3 : 5;

  return {
    nominal,
    low: nominal - uncertainty,
    high: nominal + uncertainty,
    uncertainty,
    sensitivity1W,
    amplifierPower,
    effectivePowerWatts: power,
    electricalNominal,
    distanceAdjustedMaxSpl,
    powerLimited,
    maxSplLimited,
  };
}

export function requiredSensitivity({
  targetDb,
  powerWatts,
  distanceMeters,
  outputBasis = "1w",
  impedance = 8,
}) {
  const target = Number(targetDb);
  const power = finitePositive(powerWatts);
  const distance = finitePositive(distanceMeters);
  const requiredAt1W = target - 10 * Math.log10(power) + 20 * Math.log10(distance);

  return sensitivityForBasis({
    sensitivityAt1W: requiredAt1W,
    basis: outputBasis,
    impedance,
  });
}

export function requiredPower({
  targetDb,
  sensitivity,
  sensitivityBasis = "1w",
  impedance = 8,
  distanceMeters,
}) {
  const target = Number(targetDb);
  const sensitivity1W = sensitivityAtOneWatt({
    sensitivity,
    basis: sensitivityBasis,
    impedance,
  });
  const distance = finitePositive(distanceMeters);
  return 10 ** ((target - sensitivity1W + 20 * Math.log10(distance)) / 10);
}

export function describeCapacity(capacity, targetDb) {
  const target = Number(targetDb);
  const nominalGap = capacity.nominal - target;

  if (capacity.low >= target + 1) {
    return { key: "success", label: "理论余量较充足", gap: nominalGap };
  }
  if (capacity.low >= target - 1) {
    return { key: "success", label: "保守范围接近筛选阈值", gap: nominalGap };
  }
  if (capacity.high >= target) {
    return { key: "warning", label: "区间跨越筛选阈值，需核实", gap: nominalGap };
  }
  return { key: "danger", label: "理论余量不足", gap: nominalGap };
}

export function quantityGainDb(quantity) {
  return 10 * Math.log10(finitePositive(quantity));
}

export function subwooferCapacity({
  measurements,
  quantity = 1,
  listeningDistanceMeters = 2,
  measurementDistanceMeters = 2,
  uncertaintyDb = 4,
}) {
  if (!measurements || typeof measurements !== "object") return null;

  const distance = finitePositive(listeningDistanceMeters, 2);
  const measurementDistance = finitePositive(measurementDistanceMeters, 2);
  const distanceAdjustment = 20 * Math.log10(measurementDistance / distance);
  const quantityAdjustment = quantityGainDb(quantity);
  const values = {};

  for (const frequency of REQUIRED_FREQUENCIES) {
    const source = Number(measurements[String(frequency)] ?? measurements[frequency]);
    if (!Number.isFinite(source)) continue;
    const nominal = source + distanceAdjustment + quantityAdjustment;
    values[String(frequency)] = {
      nominal,
      low: nominal - uncertaintyDb,
      high: nominal + uncertaintyDb,
    };
  }

  return Object.keys(values).length
    ? {
        values,
        distanceAdjustment,
        quantityAdjustment,
        uncertaintyDb,
      }
    : null;
}

export function formatDbRange(capacity) {
  if (!capacity || !Number.isFinite(capacity.nominal)) return "暂无可比数据";
  return `约 ${roundDb(capacity.nominal)} dB，规划范围 ${roundDb(capacity.low)}–${roundDb(capacity.high)} dB`;
}
