import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist", "pages");
const files = ["index.html", "styles.css", "LICENSE", "THIRD_PARTY_DATA.md"];
const directories = ["src", "data", "assets"];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(output, file));
}
for (const directory of directories) {
  const source = path.join(root, directory);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(output, directory), { recursive: true });
}

const commit = String(process.env.GITHUB_SHA || "local").slice(0, 7);
const metaPath = path.join(output, "src", "meta.js");
const metaSource = fs.readFileSync(metaPath, "utf8").replace('commit: "local"', `commit: "${commit}"`);
fs.writeFileSync(metaPath, metaSource, "utf8");

fs.writeFileSync(path.join(output, ".nojekyll"), "", "utf8");
console.log(JSON.stringify({ output, files: files.length, directories: directories.length, commit }, null, 2));
