import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalonePath = path.join(projectRoot, "dist", "AcoustiCore-影院配置助手.html");

test("standalone HTML embeds styles, application logic and the catalog", () => {
  const html = fs.readFileSync(standalonePath, "utf8");
  assert.ok(Buffer.byteLength(html, "utf8") > 900_000);
  assert.match(html, /<style>[\s\S]*--accent:/);
  assert.match(html, /catalogVersion/);
  assert.match(html, /SUBWOOFER_CATALOG/);
  assert.match(html, /AcoustiCore 影院配置助手/);
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /<script\b[^>]*\btype=["']module["']/i);
  assert.match(html, /<img src="data:image\/png;base64,/);
});

test("embedded JavaScript is syntactically valid as a classic offline script", () => {
  const html = fs.readFileSync(standalonePath, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotMatch(scripts[0], /\bimport\s+\{/);
  assert.doesNotMatch(scripts[0], /^export\s+/m);
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: "AcoustiCore-standalone.js" }));
});
