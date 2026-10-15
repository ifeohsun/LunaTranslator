// Sets the app version across release manifests. Usage: node scripts/set-version.mjs v1.2.3
import { readFileSync, writeFileSync } from "node:fs";

const raw = process.argv[2] ?? "";
const version = raw.replace(/^v/, "");

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`set-version: invalid version "${raw}" (expected e.g. v1.2.3)`);
  process.exit(1);
}

const edits = [
  ["package.json", /"version": "[^"]*"/, `"version": "${version}"`],
  ["src-tauri/tauri.conf.json", /"version": "[^"]*"/, `"version": "${version}"`],
  ["src-tauri/Cargo.toml", /^version = "[^"]*"/m, `version = "${version}"`],
  ["src-tauri/Cargo.lock", /(name = "moon-translator"\r?\nversion = ")[^"]*/, `$1${version}`],
  ["installer/Cargo.toml", /^version = "[^"]*"/m, `version = "${version}"`],
  ["installer/Cargo.lock", /(name = "moontranslator_installer"\r?\nversion = ")[^"]*/, `$1${version}`],
];

for (const [file, pattern, replacement] of edits) {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) {
    console.error(`set-version: version pattern not found in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(pattern, replacement));
  console.log(`set ${file} -> ${version}`);
}
