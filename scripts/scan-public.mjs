import { readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const ROOT = resolve(process.argv[2] || ".");
const EXCLUDED = new Set([".git", "node_modules", "build", "coverage", "dist", ".shopify"]);
const FORBIDDEN_NAMES = new Set([".env", ".dev.vars", "settings_data.json"]);
const PATTERNS = [
  ["private key", /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/i],
  ["credential token", /\b(?:glpat-|glft-|ghp_|github_pat_|shpat_|shpss_|shptka_|xox[baprs]-)[A-Za-z0-9._-]{10,}/i],
  ["model API key", /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/im],
  ["authorization value", /authorization\s*[:=]\s*["']?(?:bearer|basic)\s+[A-Za-z0-9+/=._-]{8,}/i],
  ["cloud access key", /\bAKIA[A-Z0-9]{16}\b/],
  ["company host", /gitlab\.suntekcorps\.com|rwlb\.rds\.aliyuncs\.com/i],
  ["company network", /\b(?:10\.204\.|47\.237\.)/],
  ["developer path", /(?:[A-Za-z]:[\\/]Users[\\/]STGF|\/Users\/STGF)/i],
  ["production worker default", /https:\/\/wp-(?:governance|sfc-carrier)\.htfu\.workers\.dev/i],
  ["legacy production storefront", /https:\/\/landmarks\.builders/i],
  ["legacy production storefront", /(?:^|\/\/)(?:sfc\.)?worldproducts\.ai/i],
  ["private integration marker", /\b(?:PIPO|StoryLab|DCD)\b|1688(?:\.com|\s+(?:candidate|source|supplier|catalog))|amazon-us-en-v1|AI Vision Pipeline|santai_customer_id|\bstc_/i],
  ["analytics measurement ID", /\bG-(?!X{8,}\b)[A-Z0-9]{8,}\b/],
];

async function filesUnder(path) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${relative(ROOT, child)}`);
    if (entry.isDirectory()) output.push(...await filesUnder(child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

const findings = [];
for (const file of await filesUnder(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (rel === "scripts/scan-public.mjs") continue;
  if (FORBIDDEN_NAMES.has(basename(file))) findings.push(`${rel}: forbidden local configuration`);
  const data = await readFile(file);
  if (data.subarray(0, 8192).includes(0)) continue;
  const text = data.toString("utf8");
  for (const [label, pattern] of PATTERNS) {
    if (pattern.test(text)) findings.push(`${rel}: ${label}`);
  }
}

if (findings.length) {
  for (const finding of findings) console.error(`BLOCKED: ${finding}`);
  process.exit(1);
}
console.log("PASS: public repository safety scan");
