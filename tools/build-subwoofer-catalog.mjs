import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = "C:\\Users\\13568\\Documents\\Codex\\2026-08-04\\referenced-chatgpt-conversation-this-is-an\\outputs\\低音炮对比数据库V2.5完整包\\低音炮对比数据库V2.5工程\\data\\data.js";
const SOURCE_PATH = path.resolve(process.argv[2] || DEFAULT_SOURCE);
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const OUTPUT_PATH = path.join(DATA_DIR, "subwoofer-catalog-v2.5.js");
const REVIEW_PATH = path.join(DATA_DIR, "primary-test-review.json");

const FREQUENCIES = [
  ["20", "f20"],
  ["25", "f25"],
  ["31.5", "f31_5"],
  ["40", "f40"],
  ["50", "f50"],
  ["63", "f63"],
];

const SOURCE_PRIORITY = [
  "brent butterworth",
  "erins audio corner",
  "erin's audio corner",
  "audioholics",
  "data-bass",
];

function readSourceData() {
  const raw = fs.readFileSync(SOURCE_PATH, "utf8").replace(/^\uFEFF/, "").trim();
  const jsonText = raw
    .replace(/^window\.SUBWOOFER_DATA\s*=\s*/, "")
    .replace(/;\s*$/, "");
  const value = JSON.parse(jsonText);
  const records = Array.isArray(value) ? value : value?.records;
  if (!Array.isArray(records)) throw new Error("V2.5 source does not contain a records array");
  return { records, sourceMeta: value?.meta ?? null };
}

function compactMeasurements(values) {
  const result = {};
  for (const [frequency, key] of FREQUENCIES) {
    const raw = values?.[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const number = Number(raw);
    if (Number.isFinite(number)) result[frequency] = number;
  }
  return result;
}

function pointCount(test) {
  return Object.keys(test.measurements).length;
}

function sourcePriority(source) {
  const normalized = String(source || "").toLowerCase();
  const index = SOURCE_PRIORITY.findIndex((name) => normalized.includes(name));
  return index === -1 ? 0 : SOURCE_PRIORITY.length - index;
}

function compareTests(a, b) {
  return pointCount(b) - pointCount(a)
    || sourcePriority(b.source) - sourcePriority(a.source)
    || a.testId.localeCompare(b.testId);
}

function makeTestGovernance() {
  return {
    testedAt: null,
    licenseStatus: "unreviewed",
    reviewStatus: "imported-unreviewed",
    reviewedBy: null,
  };
}

function makeTests(record) {
  const tests = [];
  const ceaMeasurements = compactMeasurements(record.cea2mPeak);
  if (Object.keys(ceaMeasurements).length) {
    tests.push({
      testId: `cea-a-${record.id}`,
      standard: "CEA-2010-A",
      testMode: String(record.testVersion || "标准测试").trim() || "标准测试",
      source: String(record.ceaSource || "来源待补").trim(),
      sourceUrl: null,
      basisDistanceM: 2,
      measurementType: "peak",
      measurements: ceaMeasurements,
      verificationStatus: record.ceaSource ? "source-attributed" : "source-missing",
      ...makeTestGovernance(),
    });
  }

  const ctaMeasurements = compactMeasurements(record.ctaB?.values);
  if (record.ctaBAvailable && Object.keys(ctaMeasurements).length) {
    tests.push({
      testId: `cta-b-${record.id}`,
      standard: "CTA-2010-B",
      testMode: String(record.ctaB?.version || "原表测试模式").trim(),
      source: String(record.ctaB?.source || record.ceaSource || "来源待补").trim(),
      sourceUrl: null,
      basisDistanceM: 2,
      measurementType: "source-normalized",
      measurements: ctaMeasurements,
      verificationStatus: "standard-separated",
      ...makeTestGovernance(),
    });
  }

  const ctaCMeasurements = compactMeasurements(record.ctaC?.values);
  if ((record.ctaCAvailable || record.ctaC) && Object.keys(ctaCMeasurements).length) {
    tests.push({
      testId: `cta-c-${record.id}`,
      standard: "CTA-2010-C",
      testMode: String(record.ctaC?.version || "原表测试模式").trim(),
      source: String(record.ctaC?.source || record.ceaSource || "来源待补").trim(),
      sourceUrl: record.ctaC?.sourceUrl || null,
      basisDistanceM: Number(record.ctaC?.basisDistanceM) || 2,
      measurementType: String(record.ctaC?.measurementType || "source-normalized"),
      measurements: ctaCMeasurements,
      verificationStatus: "standard-separated",
      ...makeTestGovernance(),
    });
  }
  return tests;
}

function modelSpecs(records) {
  const ranked = [...records].sort((a, b) => {
    const aScore = Number(!a.discontinued) * 5 + Number(Boolean(a.wooferCount)) + Number(Boolean(a.wooferSizeIn)) + Number(Boolean(a.type));
    const bScore = Number(!b.discontinued) * 5 + Number(Boolean(b.wooferCount)) + Number(Boolean(b.wooferSizeIn)) + Number(Boolean(b.type));
    return bScore - aScore;
  });
  const record = ranked[0];
  return {
    wooferCount: Number(record.wooferCount) || null,
    wooferSizeIn: Number(record.wooferSizeIn) || null,
    wooferText: record.wooferText || null,
    type: record.type || "未标注",
    discontinued: records.every((item) => Boolean(item.discontinued)),
    manufacturerUrl: record.manufacturerUrl || null,
  };
}

function choosePrimary(tests) {
  if (!tests.length) return {
    primaryTestId: null,
    suggestedTestId: null,
    reviewStatus: "not-measured",
    requiresReview: false,
    reason: "没有 CEA/CTA 多频点实测",
  };

  const preferredStandard = tests.some((test) => test.standard === "CEA-2010-A")
    ? "CEA-2010-A"
    : tests[0].standard;
  const candidates = tests.filter((test) => test.standard === preferredStandard).sort(compareTests);
  const suggestedTestId = candidates[0].testId;

  if (candidates.length === 1) {
    return {
      primaryTestId: suggestedTestId,
      suggestedTestId,
      reviewStatus: "single-record",
      requiresReview: false,
      reason: "只有一条同口径实测记录",
    };
  }

  const modes = new Set(candidates.map((test) => test.testMode.toLowerCase()));
  const hasConfigurationDifference = modes.size > 1;
  return {
    primaryTestId: null,
    suggestedTestId,
    reviewStatus: "manual-confirmation-required",
    requiresReview: true,
    reason: hasConfigurationDifference
      ? "同型号存在不同测试模式或硬件配置，默认值需人工确认"
      : "同型号存在多条同模式记录，建议值只供人工复核，不自动成为客户主记录",
  };
}

function buildCatalog(records) {
  const groups = new Map();
  for (const record of records) {
    const key = String(record.modelKey || `${record.brand}||${record.model}`)
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const catalog = [];
  const reviewQueue = [];
  for (const [, group] of groups) {
    const tests = group.flatMap(makeTests);
    const selection = choosePrimary(tests);
    const first = group[0];
    const modelKey = `${first.brand}||${first.model}`;
    const item = {
      modelKey,
      brand: first.brand,
      model: first.model,
      specs: modelSpecs(group),
      dataTier: tests.length ? "measured" : "specOnly",
      primaryTestId: selection.primaryTestId,
      tests,
      verificationStatus: tests.length ? "catalog-imported" : "spec-only",
      reviewStatus: selection.reviewStatus,
    };
    catalog.push(item);

    const preferredStandard = tests.some((test) => test.standard === "CEA-2010-A") ? "CEA-2010-A" : tests[0]?.standard;
    const comparableTestCount = tests.filter((test) => test.standard === preferredStandard).length;
    if (group.length > 1 && comparableTestCount > 1) {
      reviewQueue.push({
        modelKey,
        brand: first.brand,
        model: first.model,
        suggestedTestId: selection.suggestedTestId,
        currentPrimaryTestId: selection.primaryTestId,
        requiresReview: selection.requiresReview,
        reason: selection.reason,
        tests: tests.map((test) => ({
          testId: test.testId,
          standard: test.standard,
          testMode: test.testMode,
          source: test.source,
          pointCount: pointCount(test),
        })),
      });
    }
  }

  catalog.sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`, "en"));
  reviewQueue.sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`, "en"));
  return { catalog, reviewQueue };
}

const { records, sourceMeta } = readSourceData();
const { catalog, reviewQueue } = buildCatalog(records);
const meta = {
  schemaVersion: "2.0.0",
  catalogVersion: "2.5-acousticore-v3.1",
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(SOURCE_PATH),
  sourceRecordCount: records.length,
  sourceGeneratedAt: sourceMeta?.generatedAt ?? null,
  modelCount: catalog.length,
  measuredModelCount: catalog.filter((item) => item.dataTier === "measured").length,
  specOnlyModelCount: catalog.filter((item) => item.dataTier === "specOnly").length,
  multiTestReviewCount: reviewQueue.length,
  separatedStandardCount: catalog.filter((item) => new Set(item.tests.map((test) => test.standard)).size > 1).length,
  blockedPrimaryCount: catalog.filter((item) => item.dataTier === "measured" && !item.primaryTestId).length,
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(
  OUTPUT_PATH,
  `// Generated by tools/build-subwoofer-catalog.mjs. Do not hand edit.\nexport const CATALOG_META = ${JSON.stringify(meta, null, 2)};\nexport const SUBWOOFER_CATALOG = ${JSON.stringify(catalog)};\n`,
  "utf8",
);
fs.writeFileSync(
  REVIEW_PATH,
  JSON.stringify({ meta, reviewQueue }, null, 2),
  "utf8",
);

console.log(JSON.stringify({ output: OUTPUT_PATH, review: REVIEW_PATH, ...meta }, null, 2));
