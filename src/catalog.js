export const CUSTOM_STORAGE_KEY = "acousticore.custom-subwoofers.v1";

function compactText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeNumber(value, min, max, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return fallback;
  return number;
}

export function createCustomModel(input) {
  const brand = compactText(input.brand, 80);
  const model = compactText(input.model, 120);
  const wooferCount = safeNumber(input.wooferCount, 1, 16);
  const wooferSizeIn = safeNumber(input.wooferSizeIn, 4, 32);
  const type = compactText(input.type, 80);

  if (!brand || !model || !wooferCount || !wooferSizeIn || !type) {
    throw new Error("自定义型号缺少必填规格");
  }

  return {
    modelKey: `custom||${brand.toLowerCase()}||${model.toLowerCase()}`,
    brand,
    model,
    specs: {
      wooferCount,
      wooferSizeIn,
      type,
      discontinued: false,
      amplifierPower: safeNumber(input.amplifierPower, 0, 20000),
      officialResponse: compactText(input.officialResponse, 160) || null,
      manufacturerUrl: compactText(input.sourceUrl, 500) || null,
    },
    dataTier: "customSpec",
    primaryTestId: null,
    tests: [],
    verificationStatus: "local-custom-spec",
    reviewStatus: "not-measured",
  };
}

export function normalizeCustomImport(value) {
  const items = Array.isArray(value) ? value : value?.models;
  if (!Array.isArray(items)) throw new Error("JSON 中未找到型号数组");

  const normalized = items.map((item) => createCustomModel({
    brand: item.brand,
    model: item.model,
    wooferCount: item.specs?.wooferCount ?? item.wooferCount,
    wooferSizeIn: item.specs?.wooferSizeIn ?? item.wooferSizeIn,
    type: item.specs?.type ?? item.type,
    amplifierPower: item.specs?.amplifierPower ?? item.amplifierPower,
    officialResponse: item.specs?.officialResponse ?? item.officialResponse,
    sourceUrl: item.specs?.manufacturerUrl ?? item.sourceUrl,
  }));

  return [...new Map(normalized.map((item) => [item.modelKey, item])).values()];
}

export function loadCustomModels(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CUSTOM_STORAGE_KEY);
    return raw ? normalizeCustomImport(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveCustomModels(models, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    const normalized = normalizeCustomImport(models);
    storage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify({ version: 1, models: normalized }));
    return true;
  } catch {
    return false;
  }
}

export function searchModels(catalog, customModels, query, limit = 12) {
  const needle = compactText(query, 160).toLocaleLowerCase("zh-CN");
  const source = [...customModels, ...catalog];
  if (!needle) return source.filter((item) => item.primaryTestId).slice(0, limit);

  return source
    .filter((item) => `${item.brand} ${item.model}`.toLocaleLowerCase("zh-CN").includes(needle))
    .slice(0, limit);
}

export function getTestById(model, testId) {
  return model?.tests?.find((test) => test.testId === testId) ?? null;
}

export function getPrimaryTest(model) {
  return getTestById(model, model?.primaryTestId);
}

export function testsForStandard(model, standard) {
  return (model?.tests ?? []).filter((test) => test.standard === standard);
}

export function exportCustomModels(models) {
  return JSON.stringify({
    schema: "acousticore-custom-subwoofers",
    version: 1,
    exportedAt: new Date().toISOString(),
    models,
  }, null, 2);
}
