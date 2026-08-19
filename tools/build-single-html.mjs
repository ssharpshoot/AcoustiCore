import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "dist");
const outputPath = path.join(outputDir, "AcoustiCore-影院配置助手.html");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8").replace(/^\uFEFF/, "");
}

function removeModuleSyntax(source) {
  return source
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?\s*/g, "")
    .replace(/^export\s+/gm, "");
}

function escapeClosingTag(source, tagName) {
  return source.replace(new RegExp(`</${tagName}`, "gi"), `<\\/${tagName}`);
}

const html = read("index.html");
const css = escapeClosingTag(read("styles.css"), "style");
const contactQrDataUrl = `data:image/png;base64,${fs.readFileSync(path.join(projectRoot, "assets/contact-qr.png")).toString("base64")}`;
const sources = [
  "data/subwoofer-catalog-v2.5.js",
  "src/meta.js",
  "src/calculations.js",
  "src/assessment.js",
  "src/catalog.js",
  "src/devices.js",
  "src/project-file.js",
  "src/ui-utils.js",
  "src/app.js",
];

const bundledJavaScript = sources
  .map((sourcePath) => `\n/* ${sourcePath} */\n${removeModuleSyntax(read(sourcePath))}`)
  .join("\n");
const safeJavaScript = escapeClosingTag(bundledJavaScript, "script");

const singleFileHtml = html
  .replace("./assets/contact-qr.png", contactQrDataUrl)
  .replace(
    /\s*<link\s+rel=["']stylesheet["']\s+href=["']\.\/styles\.css["']\s*\/?>/i,
    () => `\n  <style>\n${css}\n  </style>`,
  )
  .replace(
    /\s*<script\s+type=["']module["']\s+src=["']\.\/src\/app\.js["']\s*><\/script>/i,
    () => `\n  <script>\n(() => {\n"use strict";\n${safeJavaScript}\n})();\n  </script>`,
  )
  .replace(
    "</head>",
    "  <!-- Standalone build: styles, calculations, UI logic and the V2.5 catalog are embedded below. -->\n</head>",
  );

if (/\b(?:import|export)\s+[\{\w*]/.test(safeJavaScript)) {
  throw new Error("Standalone build still contains ES module syntax");
}
if (/<script\b[^>]*\bsrc=/i.test(singleFileHtml)
  || /<link\b[^>]*\bhref=(?!["']data:)/i.test(singleFileHtml)) {
  throw new Error("Standalone build still contains external link/script dependencies");
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, singleFileHtml, "utf8");

console.log(JSON.stringify({
  output: outputPath,
  bytes: Buffer.byteLength(singleFileHtml, "utf8"),
  embeddedSources: sources.length + 1,
}, null, 2));
