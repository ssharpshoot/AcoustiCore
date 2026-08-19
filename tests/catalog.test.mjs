import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG_META, SUBWOOFER_CATALOG } from "../data/subwoofer-catalog-v2.5.js";
import {
  createCustomModel,
  getPrimaryTest,
  normalizeCustomImport,
  saveCustomModels,
  testsForStandard,
} from "../src/catalog.js";

test("catalog preserves source counts and the 93-model review queue", () => {
  assert.equal(CATALOG_META.sourceRecordCount, 2224);
  assert.equal(CATALOG_META.modelCount, 2032);
  assert.equal(CATALOG_META.multiTestReviewCount, 93);
  assert.ok(CATALOG_META.specOnlyModelCount > 0);
});

test("every customer primary record is unique and references an existing test", () => {
  for (const model of SUBWOOFER_CATALOG) {
    if (!model.primaryTestId) continue;
    assert.equal(model.tests.filter((test) => test.testId === model.primaryTestId).length, 1, model.modelKey);
  }
});

test("unconfirmed configuration differences are blocked from customer defaults", () => {
  const blocked = SUBWOOFER_CATALOG.filter((model) => model.reviewStatus === "manual-confirmation-required");
  assert.ok(blocked.length > 0);
  assert.ok(blocked.every((model) => model.primaryTestId === null));
});

test("every multi-record review item stays blocked until manual approval", () => {
  const reviewItems = SUBWOOFER_CATALOG.filter((model) => model.reviewStatus === "manual-confirmation-required");
  assert.ok(reviewItems.length > 0);
  assert.ok(reviewItems.every((model) => model.primaryTestId === null));
  assert.ok(reviewItems.every((model) => model.reviewStatus === "manual-confirmation-required"));
  assert.equal(SUBWOOFER_CATALOG.some((model) => model.reviewStatus === "auto-suggested"), false);
});

test("measurement records carry governance fields and supported standards", () => {
  const supported = new Set(["CEA-2010-A", "CTA-2010-B", "CTA-2010-C"]);
  for (const model of SUBWOOFER_CATALOG) {
    for (const record of model.tests) {
      assert.ok(supported.has(record.standard), record.testId);
      assert.ok("sourceUrl" in record, record.testId);
      assert.ok("licenseStatus" in record, record.testId);
      assert.ok("reviewStatus" in record, record.testId);
    }
  }
});

test("different standards stay in separate comparison sets", () => {
  const multiStandard = SUBWOOFER_CATALOG.find((model) => new Set(model.tests.map((test) => test.standard)).size > 1);
  assert.ok(multiStandard);
  const cea = testsForStandard(multiStandard, "CEA-2010-A");
  const cta = testsForStandard(multiStandard, "CTA-2010-B");
  assert.ok(cea.length > 0 && cta.length > 0);
  assert.ok(cea.every((test) => test.standard === "CEA-2010-A"));
  assert.ok(cta.every((test) => test.standard === "CTA-2010-B"));
});

test("spec-only models have no absolute primary measurement", () => {
  const specOnly = SUBWOOFER_CATALOG.find((model) => model.dataTier === "specOnly");
  assert.ok(specOnly);
  assert.equal(specOnly.primaryTestId, null);
  assert.equal(getPrimaryTest(specOnly), null);
});

test("custom models remain local spec-only records through import/export normalization", () => {
  const model = createCustomModel({
    brand: "Local Brand",
    model: "Room Sub 12",
    wooferCount: 1,
    wooferSizeIn: 12,
    type: "密闭式",
  });
  assert.equal(model.dataTier, "customSpec");
  assert.equal(model.primaryTestId, null);
  assert.deepEqual(normalizeCustomImport({ models: [model, model] }), [model]);
});

test("custom models remain usable when a file browser blocks local storage", () => {
  const blockedStorage = { setItem() { throw new Error("blocked"); } };
  assert.equal(saveCustomModels([], blockedStorage), false);
  assert.equal(saveCustomModels([], null), false);
});
