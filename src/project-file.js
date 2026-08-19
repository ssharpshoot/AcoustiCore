export const PROJECT_SCHEMA = "acousticore-project";
export const PROJECT_VERSION = 2;

function cleanText(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function createProjectFile(payload) {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: cleanText(payload.appVersion, 40),
    calculationModel: cleanText(payload.calculationModel, 80),
    project: {
      projectName: cleanText(payload.project?.projectName, 120),
      clientName: cleanText(payload.project?.clientName, 120),
      consultant: cleanText(payload.project?.consultant, 120),
      roomType: cleanText(payload.project?.roomType, 60) || "dedicated",
      openSpace: Boolean(payload.project?.openSpace),
      seatCount: Math.max(1, Math.min(30, finite(payload.project?.seatCount, 1))),
    },
    configuration: {
      experience: ["daily", "immersive", "reference"].includes(payload.configuration?.experience)
        ? payload.configuration.experience
        : "immersive",
      roomLength: finite(payload.configuration?.roomLength, 6),
      roomWidth: finite(payload.configuration?.roomWidth, 4),
      roomHeight: finite(payload.configuration?.roomHeight, 2.8),
      listeningDistance: finite(payload.configuration?.listeningDistance, 3.5),
      speakerSensitivity: finite(payload.configuration?.speakerSensitivity, 90),
      sensitivityBasis: payload.configuration?.sensitivityBasis === "2.83v" ? "2.83v" : "1w",
      speakerImpedance: finite(payload.configuration?.speakerImpedance, 8),
      speakerContinuousPower: finite(payload.configuration?.speakerContinuousPower, 0),
      speakerMaxSpl: finite(payload.configuration?.speakerMaxSpl, 0),
      amplifierPower: finite(payload.configuration?.amplifierPower, 200),
      powerEvidence: payload.configuration?.powerEvidence === "spec" ? "spec" : "traceable",
      speakerDeviceId: cleanText(payload.configuration?.speakerDeviceId, 180) || null,
      amplifierDeviceId: cleanText(payload.configuration?.amplifierDeviceId, 180) || null,
      subwooferModelKey: cleanText(payload.configuration?.subwooferModelKey, 240) || null,
      subwooferTestId: cleanText(payload.configuration?.subwooferTestId, 160) || null,
      subwooferQuantity: Math.max(1, Math.min(8, finite(payload.configuration?.subwooferQuantity, 1))),
      legacyProxyPower: finite(payload.configuration?.legacyProxyPower, 0),
      legacyProxyType: cleanText(payload.configuration?.legacyProxyType, 80) || "密闭式",
    },
    measurement: payload.measurement && typeof payload.measurement === "object"
      ? { status: cleanText(payload.measurement.status, 40) || "not-imported", rewReference: cleanText(payload.measurement.rewReference, 260) || null }
      : { status: "not-imported", rewReference: null },
    resources: {
      customModels: Array.isArray(payload.resources?.customModels) ? payload.resources.customModels : [],
      devices: Array.isArray(payload.resources?.devices) ? payload.resources.devices : [],
    },
  };
}

export function normalizeProjectFile(value) {
  if (!value || typeof value !== "object") throw new Error("项目文件格式无效");
  if (value.schema === PROJECT_SCHEMA && Number(value.version) === PROJECT_VERSION) return createProjectFile(value);
  if (Number(value.version) === 1 || !value.schema) {
    return createProjectFile({
      appVersion: value.appVersion,
      calculationModel: value.calculationModel,
      project: value.project ?? {},
      configuration: value.configuration ?? value,
      measurement: value.measurement,
      resources: value.resources,
    });
  }
  throw new Error(`不支持的项目文件版本：${value.version ?? "未知"}`);
}
