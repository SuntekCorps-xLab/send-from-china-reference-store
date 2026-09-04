import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, version as esbuildVersion } from "esbuild";
import { chromium } from "playwright-core";
import { accountPreviewCases } from "./fixtures/account-preview-cases.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "shopify-customer-account/extensions/wp-account/src/AccountPage.jsx";
const helper = "shopify-customer-account/extensions/wp-account/src/description-preview.js";
const sourceDirectory = path.dirname(path.join(root, entry));
const outputDirectory = path.join(root, "artifacts", "account-preview");
const byteLimit = 64 * 1024;
await mkdir(outputDirectory, { recursive: true });
const componentSource = await readFile(path.join(root, entry), "utf8");
const helperSource = await readFile(path.join(root, helper));

const options = {
  absWorkingDir: root,
  bundle: true,
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  write: false,
  logLevel: "silent",
};

// This is the complete, unmodified shipping entry, including Shopify's runtime
// adapter. No dependency is externalized and no active extension manifest is made.
const shipping = await build({
  ...options,
  entryPoints: [entry],
  format: "esm",
  outfile: "artifacts/account-preview/account-page.js",
});
const shippingCode = shipping.outputFiles[0].contents;
await writeFile(path.join(outputDirectory, "account-page.js"), shippingCode);
await writeJson("account-page.meta.json", shipping.metafile);
const bundleEvidence = inspectBundle(shipping, {
  entry: /\/extensions\/wp-account\/src\/AccountPage\.jsx$/,
  preview: /\/extensions\/wp-account\/src\/description-preview\.js$/,
  parser: /\/node_modules\/parse5\/dist\/parser\/index\.js$/,
  entities: /\/node_modules\/entities\/dist\//,
  preact: /\/node_modules\/preact\//,
  shopify: /\/node_modules\/@shopify\/ui-extensions\//,
});
const compressed = gzipSync(shippingCode);
await writeFile(path.join(outputDirectory, "account-page.js.gz"), compressed);
assert.ok(compressed.length <= byteLimit,
  `AccountPage gzip bundle is ${compressed.length} bytes; limit is ${byteLimit}`);

// The browser fixture uses the real Preact renderer and actual component source.
// Only Shopify's host-specific side-effect adapter is omitted: plain browser DOM
// custom elements stand in for Shopify's host. This is synthetic sink validation,
// not proof of a live extension, App Proxy, account API, or protected operation.
const renderBundle = await build({
  ...options,
  format: "iife",
  outfile: "artifacts/account-preview/account-preview-render.js",
  stdin: {
    sourcefile: "account-preview-harness.jsx",
    resolveDir: sourceDirectory,
    loader: "jsx",
    contents: `
      import { h, render } from "preact";
      import { ConversationMessage, GovernanceRequest } from "account-preview-source";
      const components = { ConversationMessage, GovernanceRequest };
      globalThis.renderAccountPreview = (name, description) => {
        const preview = { title: "Synthetic preview", description_html: description };
        const props = name === "ConversationMessage"
          ? { message: { id: "synthetic-message", role: "assistant", payload: { preview } } }
          : { job: { id: "synthetic-job", state: "READY", result: preview } };
        render(h(components[name], props), document.getElementById("preview"));
      };
    `,
  },
  plugins: [{
    name: "synthetic-account-component-host",
    setup(builder) {
      builder.onResolve({ filter: /^account-preview-source$/ }, () => ({
        path: "AccountPage.jsx", namespace: "account-preview-source",
      }));
      builder.onLoad({ filter: /.*/, namespace: "account-preview-source" }, () => ({
        contents: `${componentSource}\nexport { ConversationMessage, GovernanceRequest };\n`,
        loader: "jsx",
        resolveDir: sourceDirectory,
      }));
      builder.onResolve({ filter: /^@shopify\/ui-extensions\/preact$/ }, () => ({
        path: "shopify-preact-host-adapter", namespace: "synthetic-host",
      }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic-host" }, () => ({
        contents: "export {};", loader: "js",
      }));
    },
  }],
});
await writeFile(path.join(outputDirectory, "account-preview-render.js"), renderBundle.outputFiles[0].contents);
await writeJson("account-preview-render.meta.json", renderBundle.metafile);
inspectBundle(renderBundle, {
  components: /account-preview-source:AccountPage\.jsx$/,
  preview: /\/extensions\/wp-account\/src\/description-preview\.js$/,
  parser: /\/node_modules\/parse5\/dist\/parser\/index\.js$/,
  entities: /\/node_modules\/entities\/dist\//,
  preact: /\/node_modules\/preact\//,
});

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const cases = [];
const requestAttempts = [];
const runtimeErrors = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", async route => {
    requestAttempts.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.setContent('<!doctype html><html><head><title>Synthetic account preview</title></head><body><main id="preview"></main></body></html>');
  await page.addScriptTag({ content: renderBundle.outputFiles[0].text });
  await page.evaluate(() => {
    globalThis.__accountPreviewExecuted = 0;
    globalThis.__unsafePreviewNodes = [];
    const unsafeSelector = "script,img,iframe,object,embed,svg,math,link,style";
    const record = node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches(unsafeSelector)) globalThis.__unsafePreviewNodes.push(node.localName);
      for (const child of node.querySelectorAll(unsafeSelector)) {
        globalThis.__unsafePreviewNodes.push(child.localName);
      }
    };
    new MutationObserver(records => {
      for (const recordItem of records) for (const node of recordItem.addedNodes) record(node);
    }).observe(document.getElementById("preview"), { childList: true, subtree: true });
  });
  for (const component of ["ConversationMessage", "GovernanceRequest"]) {
    for (const fixture of accountPreviewCases) {
      const result = await page.evaluate(async ({ component, description, expected }) => {
        globalThis.renderAccountPreview(component, description);
        // Allow mutation observers and accidentally introduced load handlers to run.
        await new Promise(resolve => setTimeout(resolve, 50));
        const matching = [...document.querySelectorAll("#preview s-text")]
          .filter(element => element.textContent === expected);
        return {
          descriptionMatches: matching.length,
          textNodeOnly: matching.length === 1 && [...matching[0].childNodes]
            .every(node => node.nodeType === Node.TEXT_NODE),
          unsafeNodes: [...globalThis.__unsafePreviewNodes],
          executed: globalThis.__accountPreviewExecuted,
          renderedText: document.getElementById("preview").textContent,
        };
      }, { component, description: fixture.description, expected: fixture.expected });
      const label = `${component}: ${fixture.name}`;
      assert.equal(result.descriptionMatches, 1, `${label}: expected description missing from s-text: ${result.renderedText}`);
      assert.equal(result.textNodeOnly, true, `${label}: description must contain text nodes only`);
      assert.deepEqual(result.unsafeNodes, [], `${label}: unexpected executable/resource DOM nodes`);
      assert.equal(result.executed, 0, `${label}: description executed script`);
      assert.deepEqual(requestAttempts, [], `${label}: unexpected network request`);
      assert.deepEqual(runtimeErrors, [], `${label}: browser runtime error`);
      cases.push({ component, fixture: fixture.name, textLength: fixture.expected.length, passed: true });
    }
  }
} finally {
  await browser.close();
}
assert.equal(await readFile(path.join(root, entry), "utf8"), componentSource,
  "AccountPage source changed during verification; rerun against a stable candidate");
assert.deepEqual(await readFile(path.join(root, helper)), helperSource,
  "Preview helper changed during verification; rerun against a stable candidate");

const report = {
  ok: true,
  scope: "synthetic; complete offline bundle and real Preact component text sinks; Shopify host adapter omitted only in render fixture",
  node: process.version,
  esbuild: esbuildVersion,
  entry,
  sourceSha256: sha256(componentSource),
  previewSha256: sha256(helperSource),
  bundleSha256: sha256(shippingCode),
  rawBytes: shippingCode.byteLength,
  gzipBytes: compressed.byteLength,
  gzipLimitBytes: byteLimit,
  externalImports: 0,
  includedModules: bundleEvidence,
  renderCases: cases,
  unexpectedDomNodes: 0,
  descriptionExecutions: 0,
  unexpectedNetworkRequests: requestAttempts.length,
  runtimeErrors: runtimeErrors.length,
};
await writeJson("report.json", report);
console.log(JSON.stringify(report, null, 2));

function inspectBundle(result, expectedModules) {
  for (const [name, input] of Object.entries(result.metafile.inputs)) {
    assert.ok(input.imports.every(item => !item.external), `${name}: external input import`);
  }
  const outputs = Object.values(result.metafile.outputs);
  assert.equal(outputs.length, 1, "A complete entry must produce one self-contained bundle");
  assert.equal(outputs[0].imports.length, 0, "Bundle must not import external code");
  const evidence = {};
  for (const [label, pattern] of Object.entries(expectedModules)) {
    const inputs = Object.entries(outputs[0].inputs)
      .filter(([name, details]) => pattern.test(`/${name.replaceAll("\\", "/")}`) && details.bytesInOutput > 0);
    assert.ok(inputs.length > 0, `${label}: expected module code is not in the bundle`);
    evidence[label] = inputs.map(([name, details]) => ({ path: name, bytesInOutput: details.bytesInOutput }));
  }
  return evidence;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(name, value) {
  await writeFile(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
}
