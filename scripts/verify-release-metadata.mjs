import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const [packageText, lockText, readme, changelog, checklist, hostedConfig] = await Promise.all([
  read("package.json"),
  read("package-lock.json"),
  read("README.md"),
  read("CHANGELOG.md"),
  read("docs/PUBLIC_RELEASE_CHECKLIST.md"),
  read("hosted-demo/wrangler.toml"),
]);
const packageJson = JSON.parse(packageText);
const lock = JSON.parse(lockText);
const version = packageJson.version;
const escapedVersion = version.replaceAll(".", "\\.");

assert.match(version, /^\d+\.\d+\.\d+$/u);
assert.equal(lock.version, version);
assert.equal(lock.packages?.[""]?.version, version);
assert.match(changelog, new RegExp(`^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`, "mu"));
assert.match(readme, new RegExp("Release candidate version: \\*\\*`" + escapedVersion + "`\\*\\*", "u"));
assert.match(readme, /img\.shields\.io\/github\/v\/release\/SuntekCorps-xLab\/send-from-china-reference-store/u);
assert.match(checklist, new RegExp("`v" + escapedVersion + "`", "u"));
assert.match(hostedConfig, /^workers_dev = false$/mu);
assert.match(hostedConfig, /^preview_urls = false$/mu);
assert.doesNotMatch(hostedConfig, /^routes?\s*=/mu);
process.stdout.write(`PASS: Reference Store ${version} release metadata is internally aligned.\n`);
