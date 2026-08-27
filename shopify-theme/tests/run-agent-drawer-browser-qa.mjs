import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const themeRoot = path.join(repoRoot, "shopify-theme");
const artifactDir = path.join(repoRoot, "qa-artifacts", "agent-drawer");
const chromePath = await resolveChromePath();
const [drawerJs, drawerCss] = await Promise.all([
  readFile(path.join(themeRoot, "assets", "wp-agent-drawer.js"), "utf8"),
  readFile(path.join(themeRoot, "assets", "wp-agent-drawer.css"), "utf8"),
]);

const fixtureServer = await startFixture();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "wp-agent-drawer-qa-"));
const debugPort = await freePort();
const chromeDiagnostics = [];
let chromeLaunchError;
const chrome = spawn(chromePath, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "--disable-features=Vulkan,WebGPU",
  "--disable-gpu-shader-disk-cache",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-allow-origins=*",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
chrome.once("error", error => { chromeLaunchError = error; });
for (const stream of [chrome.stdout, chrome.stderr]) {
  stream?.on("data", chunk => {
    const message = String(chunk || "").trim();
    if (message) chromeDiagnostics.push(message);
  });
}
let client;

try {
  await mkdir(artifactDir, { recursive: true });
  const endpoint = await waitForPageEndpoint(debugPort, chrome);
  client = await connect(endpoint.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const results = [];
  results.push(await runCase(client, { name: "desktop", width: 1440, height: 1000, mobile: false }));
  results.push(await runCase(client, { name: "mobile", width: 390, height: 844, mobile: true }));
  console.log(JSON.stringify({ ok: true, cases: results }, null, 2));
} catch (error) {
  const diagnostics = chromeDiagnostics.slice(-8).join("\n");
  if (diagnostics) error.message = `${error.message}\nChrome diagnostics:\n${diagnostics}`;
  throw error;
} finally {
  client?.close();
  chrome.kill();
  await fixtureServer.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

async function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    ...(process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ]),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(
    `Chrome or Chromium was not found. Set CHROME_PATH to a browser executable. Checked: ${candidates.join(", ")}`,
  );
}

async function runCase(cdp, scenario) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: scenario.width,
    height: scenario.height,
    deviceScaleFactor: 1,
    mobile: scenario.mobile,
    screenWidth: scenario.width,
    screenHeight: scenario.height,
  });
  await cdp.send("Page.navigate", { url: fixtureServer.origin });
  await waitFor(async () => evaluate(cdp, `document.readyState === "complete" && Boolean(document.querySelector("[data-wp-agent-drawer]"))`));
  await evaluate(cdp, `document.querySelector("[data-open-agent-drawer]").click()`);
  await evaluate(cdp, `(() => {
    const input = document.querySelector("[data-agent-input]");
    input.value = "Find a walnut desk organizer with cable management under $40";
    document.querySelector("[data-agent-form]").requestSubmit();
  })()`);
  await waitFor(async () => evaluate(cdp, `document.querySelectorAll(".wp-agent-product").length === 1 && document.querySelectorAll(".wp-agent-next-actions button").length === 3`));

  const beforeConfirm = await evaluate(cdp, auditExpression());
  assert(beforeConfirm.drawerVisible, `${scenario.name}: drawer did not open`);
  assert(beforeConfirm.productCards === 1, `${scenario.name}: real result card did not render`);
  assert(beforeConfirm.nextActions === 3, `${scenario.name}: expected three server next actions`);
  assert(beforeConfirm.requests.every(request => !request.includes("/tasks")), `${scenario.name}: drawer started a sourcing task without confirmation`);
  assert(beforeConfirm.scrollWidth <= scenario.width + 1, `${scenario.name}: horizontal overflow ${beforeConfirm.scrollWidth}/${scenario.width}`);
  if (scenario.mobile) assert(Math.abs(beforeConfirm.drawerWidth - scenario.width) <= 1, `${scenario.name}: drawer is not full width`);
  else assert(beforeConfirm.drawerWidth >= 560 && beforeConfirm.drawerWidth <= 600, `${scenario.name}: unexpected drawer width ${beforeConfirm.drawerWidth}`);

  await evaluate(cdp, `([...document.querySelectorAll(".wp-agent-next-actions button")].find(button => button.textContent.includes("Search beyond"))).click()`);
  await waitFor(async () => evaluate(cdp, `!document.querySelector("[data-agent-sourcing-confirm]").hidden`));
  const afterConfirm = await evaluate(cdp, auditExpression());
  assert(afterConfirm.confirmVisible, `${scenario.name}: sourcing confirmation did not appear`);
  assert(afterConfirm.requests.every(request => !request.includes("/tasks")), `${scenario.name}: confirmation view mutated sourcing state`);

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(artifactDir, `${scenario.name}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate(cdp, `document.querySelector("[data-agent-history]").click()`);
  assert(await evaluate(cdp, `!document.querySelector("[data-agent-history-view]").hidden`), `${scenario.name}: History view did not open`);
  await evaluate(cdp, `document.querySelector("[data-agent-history]").click()`);
  assert(await evaluate(cdp, `!document.querySelector("[data-agent-conversation-view]").hidden`), `${scenario.name}: History did not return to conversation`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await waitFor(async () => evaluate(cdp, `document.querySelector(".wp-agent-drawer").hidden`));

  return {
    name: scenario.name,
    viewport: `${scenario.width}x${scenario.height}`,
    drawer_width: beforeConfirm.drawerWidth,
    product_cards: beforeConfirm.productCards,
    next_actions: beforeConfirm.nextActions,
    sourcing_confirmed_before_navigation: true,
    no_task_mutation: true,
    screenshot: path.relative(repoRoot, screenshotPath).replaceAll("\\", "/"),
  };
}

function auditExpression() {
  return `(() => {
    const drawer = document.querySelector(".wp-agent-drawer");
    return {
      drawerVisible: !drawer.hidden,
      drawerWidth: Math.round(drawer.getBoundingClientRect().width),
      scrollWidth: document.documentElement.scrollWidth,
      productCards: document.querySelectorAll(".wp-agent-product").length,
      nextActions: document.querySelectorAll(".wp-agent-next-actions button").length,
      confirmVisible: !document.querySelector("[data-agent-sourcing-confirm]").hidden,
      requests: window.__requests.slice(),
    };
  })()`;
}

async function startFixture() {
  const server = http.createServer((request, response) => {
    if (request.url === "/wp-agent-drawer.js") return send(response, 200, drawerJs, "text/javascript; charset=utf-8");
    if (request.url === "/") return send(response, 200, fixtureHtml(), "text/html; charset=utf-8");
    send(response, 404, "Not found", "text/plain");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{--wp-mist:#f4f3ee;--wp-white:#fff;--wp-ink:#142b2f;--wp-slate:#667572;--wp-line:#d8deda;--wp-signal:#c64b1a;--wp-signal-dark:#9f3913;--wp-success:#1e6f55}*{box-sizing:border-box}body{margin:0;background:#f4f3ee;color:#142b2f;font-family:Arial,sans-serif}.fixture{min-height:100vh;padding:30px}.fixture button{min-height:42px;padding:8px 14px}${drawerCss}</style></head><body>
  <main class="fixture"><h1>Send From China catalog</h1><button type="button" data-open-agent-drawer aria-expanded="false">Ask Agent</button></main>
  <div class="wp-agent-layer" data-wp-agent-drawer data-signed-in="false" data-account-api="/apps/wp-account" data-public-api="https://wp.example" data-workspace-url="/workspace" data-login-url="/login">
    <button class="wp-agent-backdrop" type="button" data-agent-close hidden></button>
    <aside class="wp-agent-drawer" role="dialog" aria-modal="true" aria-labelledby="Title" hidden>
      <header class="wp-agent-drawer-head"><button class="wp-agent-head-action" type="button" data-agent-history aria-controls="History" aria-expanded="false"><span>History</span></button><div class="wp-agent-title"><span>Product concierge</span><strong id="Title">Shopping Agent</strong></div><div class="wp-agent-head-actions"><a class="wp-agent-head-icon" href="/workspace" data-agent-expand>↗</a><button class="wp-agent-head-icon" type="button" data-agent-close>×</button></div></header>
      <section class="wp-agent-history" id="History" data-agent-history-view hidden><div class="wp-agent-view-head"><div><span>Saved conversations</span><h2>Pick up where you left off.</h2></div><button type="button" data-agent-new>New conversation</button></div><div data-agent-history-list></div><p data-agent-history-note></p></section>
      <section class="wp-agent-conversation" data-agent-conversation-view><div class="wp-agent-context" data-agent-context hidden><strong data-agent-context-title></strong><small data-agent-context-price></small></div><div class="wp-agent-transcript" data-agent-transcript><div class="wp-agent-welcome" data-agent-welcome><span>Shopping guidance</span><h2>What would you like help finding?</h2><p>Search the live catalog first.</p><div class="wp-agent-starters"><button type="button" data-agent-starter="Find a gift">Find a gift</button></div></div></div><section class="wp-agent-brief" data-agent-brief hidden><div><span>Current brief</span><strong data-agent-brief-summary></strong></div><button type="button" data-agent-edit-brief>Edit</button></section><section class="wp-agent-sourcing-confirm" data-agent-sourcing-confirm hidden><span>Catalog search complete</span><h2>Search beyond the catalog?</h2><p>Start only after confirmation.</p><dl data-agent-sourcing-facts></dl><div class="wp-agent-confirm-actions"><button type="button" data-agent-start-sourcing>Start free sourcing preview</button><button type="button" data-agent-keep-chatting>Keep refining the brief</button></div></section><p data-agent-status hidden></p><form class="wp-agent-composer" data-agent-form><textarea data-agent-input></textarea><button type="submit" data-agent-send>↑</button><small>Enter to send</small></form></section>
    </aside>
  </div>
  <script>window.__requests=[];window.fetch=async function(url,options){window.__requests.push(String(url));return{ok:true,status:200,json:async()=>({session_id:"chat_qa",answer:"I found one catalog match and kept the brief focused.",criteria:{use_case:"walnut desk organizer",price_max:40,ship_to:"US"},results:[{title:"Walnut desktop organizer",image_url:"https://cdn.shopify.com/qa.jpg",product_url:"https://sendfromchina.ai/products/qa",price_usd:29.99,currency:"USD",available:true,why:"Wood construction with cable routing"}],next_actions:[{label:"Compare this product",message:"Compare this product",operation:"chat"},{label:"Refine the material",message:"Refine the material",operation:"chat"},{label:"Search beyond the catalog",message:"Start a custom request",operation:"dynamic_request"}]})}};</script><script src="/wp-agent-drawer.js"></script></body></html>`;
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForPageEndpoint(port, chromeProcess) {
  let lastError;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (chromeLaunchError) throw new Error(`Chrome failed to launch: ${chromeLaunchError.message}`);
    if (chromeProcess.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools became ready (exit ${chromeProcess.exitCode})`);
    }
    try {
      const page = await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`, { method: "PUT" }).then(response => response.json());
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || new Error("Chrome DevTools endpoint did not become ready");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const requestId = ++id;
        return new Promise((requestResolve, requestReject) => {
          pending.set(requestId, { resolve: requestResolve, reject: requestReject });
          socket.send(JSON.stringify({ id: requestId, method, params }));
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result || {});
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitFor(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error("Browser condition timed out");
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
