export const DEVICE_STORAGE_KEY = "acousticore.device-library.v1";

export const DEVICE_IMPORT_COLUMNS = Object.freeze([
  "deviceType",
  "brand",
  "model",
  "sensitivityDb",
  "sensitivityBasis",
  "impedanceOhm",
  "continuousPowerW",
  "peakPowerW",
  "maxSplDb",
  "frequencyRange",
  "recommendedCrossoverHz",
  "power8OhmW",
  "power4OhmW",
  "channelsDriven",
  "thdPercent",
  "bridgeMode",
  "sourceUrl",
  "verifiedAt",
  "reviewStatus",
]);

function compact(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function safeUrl(value) {
  const text = compact(value, 500);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function createDeviceRecord(input) {
  const deviceType = compact(input.deviceType, 20).toLowerCase();
  const brand = compact(input.brand, 80);
  const model = compact(input.model, 120);
  if (!['speaker', 'amplifier'].includes(deviceType) || !brand || !model) {
    throw new Error("设备记录必须包含类型、品牌和型号");
  }

  const record = {
    deviceId: compact(input.deviceId, 180) || `local-${deviceType}-${brand}-${model}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-"),
    deviceType,
    brand,
    model,
    sourceUrl: safeUrl(input.sourceUrl),
    verifiedAt: compact(input.verifiedAt, 20) || null,
    reviewStatus: ["approved", "local-draft", "needs-review"].includes(input.reviewStatus)
      ? input.reviewStatus
      : "local-draft",
  };

  if (deviceType === "speaker") {
    Object.assign(record, {
      sensitivityDb: optionalNumber(input.sensitivityDb, 60, 130),
      sensitivityBasis: input.sensitivityBasis === "2.83v" ? "2.83v" : "1w",
      impedanceOhm: optionalNumber(input.impedanceOhm, 1, 32),
      continuousPowerW: optionalNumber(input.continuousPowerW, 1, 10000),
      peakPowerW: optionalNumber(input.peakPowerW, 1, 30000),
      maxSplDb: optionalNumber(input.maxSplDb, 60, 150),
      frequencyRange: compact(input.frequencyRange, 120) || null,
      recommendedCrossoverHz: optionalNumber(input.recommendedCrossoverHz, 20, 300),
    });
  } else {
    Object.assign(record, {
      power8OhmW: optionalNumber(input.power8OhmW, 1, 10000),
      power4OhmW: optionalNumber(input.power4OhmW, 1, 20000),
      channelsDriven: optionalNumber(input.channelsDriven, 1, 64),
      thdPercent: optionalNumber(input.thdPercent, 0, 100),
      bridgeMode: compact(input.bridgeMode, 120) || null,
    });
  }
  return record;
}

export function normalizeDeviceImport(value) {
  const items = Array.isArray(value) ? value : value?.devices;
  if (!Array.isArray(items)) throw new Error("文件中未找到设备数组");
  const normalized = items.map(createDeviceRecord);
  return [...new Map(normalized.map((item) => [item.deviceId, item])).values()];
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseDeviceCsv(text) {
  const rows = parseCsvRows(String(text ?? "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一条设备记录");
  const headers = rows[0].map((value) => compact(value, 80));
  for (const required of ["deviceType", "brand", "model"]) {
    if (!headers.includes(required)) throw new Error(`CSV 缺少字段 ${required}`);
  }
  return normalizeDeviceImport(rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""]),
  )));
}

export function deviceCsvTemplate() {
  const speaker = ["speaker", "Example", "Cinema 8", 92, "2.83v", 8, 250, 500, 116, "55-20000 Hz", 80, "", "", "", "", "", "https://example.com", "2026-08-19", "needs-review"];
  const amplifier = ["amplifier", "Example", "Power 7", "", "", "", "", "", "", "", "", 150, 250, 7, 0.1, "No", "https://example.com", "2026-08-19", "needs-review"];
  return [DEVICE_IMPORT_COLUMNS, speaker, amplifier]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
}

export function loadDevices(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DEVICE_STORAGE_KEY);
    return raw ? normalizeDeviceImport(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveDevices(devices, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    const normalized = normalizeDeviceImport(devices);
    storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ schema: "acousticore-device-library", version: 1, devices: normalized }));
    return true;
  } catch {
    return false;
  }
}

export function devicesForMode(devices, deviceType, salesMode = false) {
  return devices.filter((device) => device.deviceType === deviceType
    && (salesMode || device.reviewStatus === "approved"));
}

export function exportDevices(devices) {
  return JSON.stringify({
    schema: "acousticore-device-library",
    version: 1,
    exportedAt: new Date().toISOString(),
    devices: normalizeDeviceImport(devices),
  }, null, 2);
}
