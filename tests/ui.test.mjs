import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindRangePair, syncControlValue } from "../src/ui-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class MockControl extends EventTarget {
  constructor({ value, min, max }) {
    super();
    this.value = String(value);
    this.defaultValue = String(value);
    this.min = String(min);
    this.max = String(max);
  }
}

test("number and range controls synchronize in both directions and clamp boundaries", () => {
  const number = new MockControl({ value: 6, min: 2, max: 15 });
  const range = new MockControl({ value: 6, min: 2, max: 15 });
  const origins = [];
  bindRangePair(number, range, ({ origin }) => origins.push(origin));

  number.value = "16";
  number.dispatchEvent(new Event("input"));
  assert.equal(number.value, "15");
  assert.equal(range.value, "15");

  range.value = "3.5";
  range.dispatchEvent(new Event("input"));
  assert.equal(number.value, "3.5");
  assert.deepEqual(origins, ["number", "range"]);

  number.value = "-5";
  assert.equal(syncControlValue(number, range), 2);
});

test("experience cards include targets, tooltips and product-preset disclaimer", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const copy of ["日常电影", "沉浸影院", "高动态影院", "主声道 95 dB", "LFE 110 dB", "主声道 105 dB"]) {
    assert.match(html, new RegExp(copy));
  }
  assert.match(html, /role="tooltip"/);
  assert.match(html, /AcoustiCore 产品预设，不是行业统一标准/);
});

test("customer workflow exposes traceable project, device and assessment controls", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
  for (const id of [
    "projectName",
    "seatCount",
    "speakerDeviceSelect",
    "amplifierDeviceSelect",
    "subCapacityStatus",
    "seatConsistencyStatus",
    "exportProjectButton",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /role="combobox"/);
  assert.match(app, /aria-activedescendant/);
  assert.match(html, /不是 Dolby、THX 官方认证/);
});

test("legacy proxy is visibly bounded and fixed room-gain claims stay absent", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const calculations = fs.readFileSync(path.join(ROOT, "src", "calculations.js"), "utf8");
  assert.match(html, /旧规格公式暂定估算/);
  assert.match(html, /不可用于“达标”判断/);
  assert.doesNotMatch(calculations, /boundaryGain|roomGain|crossoverBonus/);
});
