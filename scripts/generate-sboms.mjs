import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "artifacts", "sbom");
const npmCli = String(process.env.npm_execpath || "").trim();
const targets = [
  ["reference-store", root],
  ["storefront-bff", resolve(root, "storefront-bff")],
  ["customer-account", resolve(root, "shopify-customer-account")],
];

await mkdir(outputDirectory, { recursive: true });
for (const [name, cwd] of targets) {
  const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmCli
    ? [npmCli, "sbom", "--sbom-format", "cyclonedx", "--package-lock-only"]
    : ["sbom", "--sbom-format", "cyclonedx", "--package-lock-only"];
  const raw = execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell: !npmCli && process.platform === "win32",
  });
  const sbom = JSON.parse(raw);
  if (sbom.bomFormat !== "CycloneDX" || !String(sbom.specVersion || "")) {
    throw new Error(`${name} did not produce a CycloneDX SBOM`);
  }
  await writeFile(resolve(outputDirectory, `${name}.cdx.json`), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
}

console.log(`Generated ${targets.length} CycloneDX SBOMs in artifacts/sbom/.`);
