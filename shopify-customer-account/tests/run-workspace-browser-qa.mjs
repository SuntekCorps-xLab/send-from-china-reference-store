import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const themeRoot = path.join(repoRoot, "shopify-theme");

if (process.argv.includes("--serve")) {
  const assets = await loadAssets();
  const port = Number.parseInt(process.env.WP_WORKSPACE_PREVIEW_PORT || "8798", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("WP_WORKSPACE_PREVIEW_PORT must be a valid TCP port");
  }
  const fixture = await startFixture(assets, port);
  console.log(`WP Workspace preview: ${fixture.origin}/workspace`);
  console.log("Local fixture only: no Shopify, private provider, or payment write is enabled.");
  await new Promise(resolve => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await fixture.close();
  process.exit(0);
}

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactDir = path.join(repoRoot, "shopify-customer-account", "qa-artifacts", "workspace");
const profileDir = await mkdtemp(path.join(os.tmpdir(), "wp-workspace-qa-"));
const assets = await loadAssets();
const fixture = await startFixture(assets);
const debugPort = await freePort();
const headful = process.env.WP_QA_HEADFUL === "1";
const rendererArgs = headful
  ? ["--window-position=-32000,-32000", "--window-size=800,600"]
  : [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-features=Vulkan,WebGPU",
    ];
const chrome = spawn(chromePath, [
  ...rendererArgs,
  "--disable-gpu-shader-disk-cache",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-allow-origins=*",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const chromeDiagnostics = [];
for (const stream of [chrome.stdout, chrome.stderr]) {
  stream?.on("data", chunk => {
    const message = String(chunk || "").trim();
    if (message) chromeDiagnostics.push(message);
  });
}
let client;

try {
  await mkdir(artifactDir, { recursive: true });
  const endpoint = await waitForPageEndpoint(debugPort);
  client = await connect(endpoint.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await installRuntimeErrorCapture(client);
  const results = [];
  const cases = [
    ["request-detail-desktop", runRequestDetailDesktopCase],
    ["request-editing-desktop", runRequestEditingDesktopCase],
    ["request-detail-mobile", runRequestDetailMobileCase],
  ];
  for (const [name, runCase] of cases) {
    console.log(`Running browser QA: ${name}`);
    results.push(await runCase(client, fixture));
  }
  console.log(JSON.stringify({ ok: true, cases: results }, null, 2));
} catch (error) {
  const diagnostics = chromeDiagnostics.slice(-8).join("\n");
  if (diagnostics) error.message = `${error.message}\nChrome diagnostics:\n${diagnostics}`;
  throw error;
} finally {
  client?.close();
  chrome.kill();
  await fixture.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

async function runRequestDetailDesktopCase(cdp, server) {
  await server.reset({ paidCreditsEnabled: true });
  await setViewport(cdp, 1440, 1000, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.ready === "complete"
      && page.activeConversationTitle === "Saved product brief"
      && page.products === 3;
  }).catch(async error => {
    const current = await pageState(cdp);
    throw new Error(`${error.message}; ready=${current.ready}; products=${current.products}; title=${current.activeConversationTitle}; errors=${current.runtimeErrors.join(" | ")}; text=${current.text.slice(0, 1200)}; requests=${server.requests().slice(-20).join(" | ")}`);
  });
  const state = await pageState(cdp);
  assert(state.sectionOrder.join(",") === "results,deeper,brief,edit,status,activity",
    `desktop: request-detail flow is out of order: ${state.sectionOrder.join(",")}`);
  assert(state.oldChatSurfaces === 0, "desktop: a retired chat/sidebar/composer surface is still present");
  assert(state.activityOpen === false, "desktop: request activity must start collapsed");
  assert(state.deeperVisible === true, "desktop: paid continuation is missing after initial results");
  assert(state.requestCards === 3, `desktop: expected exactly 3 initial matches, received ${state.requestCards}`);
  assert(state.text.includes("Unlock all 4 matches"), "desktop: full result unlock is missing");
  assert(state.text.includes("complete saved 1688 candidate pool"),
    "desktop: saved candidate-pool boundary is missing");
  assert(state.text.includes("Starter search credits"), "desktop: paid deeper-search offer is missing");
  const audit = await auditPage(cdp, 1440, [
    "Saved product brief",
    "What we are looking for",
    "Sourcing progress",
    "Review the complete result set",
    "Request activity",
  ]);
  const screenshot = await saveScreenshot(cdp, "desktop-request-detail-pass-1.png");
  return { name: "desktop-request-detail", viewport: "1440x1000", products: audit.products, screenshot };
}

async function runRequestEditingDesktopCase(cdp, server) {
  await server.reset({ paidCreditsEnabled: true, chatDelayMs: 250 });
  await setViewport(cdp, 1440, 1000, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).products === 3);

  await evaluate(cdp, `document.querySelector("[data-edit-requirements]").click()`);
  assert((await pageState(cdp)).requirementsDrawerOpen === false,
    "editing: ordinary brief refinement must stay in the saved conversation");
  const before = server.requests().filter(request => request === "POST /api/chat").length;
  await evaluate(cdp, `(() => {
    const input = document.querySelector("[data-chat-input]");
    input.value = "A compact wooden desk organizer under $30 shipped to the US";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", bubbles: true, cancelable: true,
    }));
  })()`);
  await waitFor(async () => server.requests().filter(request => request === "POST /api/chat").length === before + 1);
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.saveState === "Saved"
      && page.text.includes("Up to $30");
  });
  assert(server.requests().filter(request => request === "POST /api/chat").length === before + 1,
    "editing: Enter must save exactly once");

  await evaluate(cdp, `document.querySelector("[data-open-request-list]").click()`);
  await waitFor(async () => (await pageState(cdp)).requestDrawerOpen === true);
  await evaluate(cdp, `document.querySelector("[data-close-drawer]").click()`);
  await evaluate(cdp, `document.querySelector("[data-open-account]").click()`);
  await waitFor(async () => (await pageState(cdp)).accountDrawerOpen === true);
  const state = await pageState(cdp);
  assert(state.text.includes("Sign out"), "editing: account drawer does not expose sign out");
  assert(state.text.includes("Agent access"), "editing: advanced Agent access is missing from the account drawer");
  const audit = await auditPage(cdp, 1440, ["Customer ID", "Back to store", "Sign out", "Agent access"]);
  const screenshot = await saveScreenshot(cdp, "desktop-request-detail-pass-2.png");
  return { name: "desktop-request-editing", viewport: "1440x1000", products: audit.products, screenshot };
}

async function runRequestDetailMobileCase(cdp, server) {
  await server.reset({ paidCreditsEnabled: true });
  await setViewport(cdp, 390, 844, true);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.ready === "complete"
      && page.products === 3
      && page.activeConversationTitle === "Saved product brief";
  });
  const state = await pageState(cdp);
  assert(state.requestCards === 3, "mobile: free initial results are not limited to three");
  assert(state.oldChatSurfaces === 0, "mobile: retired chat UI leaked into request detail");
  assert(state.activityOpen === false, "mobile: request activity must start collapsed");
  const pageScreenshot = await saveScreenshot(cdp, "mobile-request-detail-pass-1.png");
  await evaluate(cdp, `document.querySelector("[data-edit-requirements]").click()`);
  assert((await pageState(cdp)).requirementsDrawerOpen === false,
    "mobile: ordinary brief refinement must stay in the saved conversation");
  const audit = await auditPage(cdp, 390, ["Saved product brief", "Review the complete result set"]);
  const screenshot = await saveScreenshot(cdp, "mobile-request-detail-pass-2.png");
  return { name: "mobile-request-detail", viewport: "390x844", products: audit.products, screenshots: [pageScreenshot, screenshot] };
}

async function runConversationInteractionCase(cdp, server) {
  await server.reset({ chatDelayMs: 350 });
  await setViewport(cdp, 1024, 900, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).suggestionButtons === 3);
  const initial = await pageState(cdp);
  assert(initial.suggestionPanels === 1, "conversation: only the latest assistant response may expose next steps");
  assert(initial.customSuggestionButtons === 0, "conversation: a fourth canned custom-response button leaked");

  const chatPostsBefore = server.requests().filter(request => request === "POST /api/chat").length;
  await evaluate(cdp, `(() => {
    document.querySelector("[data-new-conversation]").click();
    const input = document.querySelector("[data-chat-input]");
    input.value = "A quiet STEM toy for a 10-year-old under $30, shipped to the US";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
  })()`);
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.typingIndicators === 1 && page.suggestionButtons === 0;
  });
  assert(server.requests().filter(request => request === "POST /api/chat").length === chatPostsBefore + 1,
    "conversation: Enter did not send exactly one message");
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.typingIndicators === 0 && page.suggestionButtons === 3;
  });
  const completed = await pageState(cdp);
  assert(completed.suggestionPanels === 1, "conversation: stale messages kept interactive suggestions");
  assert(completed.customSuggestionButtons === 0, "conversation: free-form input must use the composer, not a fourth chip");
  assert(completed.text.includes("Or type your own response below."),
    "conversation: free-form follow-up guidance is missing");
  const audit = await auditPage(cdp, 1024, [
    "I saved the request",
    "Browse similar products",
    "Adjust the brief",
    "Start targeted sourcing",
  ]);
  const screenshot = await saveScreenshot(cdp, "desktop-conversation-interaction.png");
  return {
    name: "desktop-conversation-interaction",
    viewport: "1024x900",
    suggestions: audit.suggestionButtons,
    screenshot,
  };
}

async function runSavedRequestCase(cdp, server) {
  await server.reset();
  await setViewport(cdp, 1440, 1000, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.ready === "complete"
      && page.activeConversationTitle === "Saved product brief"
      && page.text.includes("free previews remain today");
  });
  const resultRequestsBefore = server.requests()
    .filter(request => request === "GET /api/tasks/task_saved/results?limit=20").length;
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent.includes("View 2 results"));
    if (!button) throw new Error("Result button missing");
    button.click();
  })()`);
  await waitFor(async () => {
    const page = await pageState(cdp);
    const resultRequestsAfter = server.requests()
      .filter(request => request === "GET /api/tasks/task_saved/results?limit=20").length;
    return resultRequestsAfter > resultRequestsBefore
      && page.products === 2
      && page.text.includes("Compact Modular Desk Organizer")
      && page.text.toLocaleLowerCase("en-US").includes("item price");
  }).catch(async error => {
    const current = await pageState(cdp);
    throw new Error(`${error.message}; products=${current.products}; title=${current.activeConversationTitle}; text=${current.text.slice(-1200)}; requests=${server.requests().slice(-20).join(" | ")}`);
  });
  const catalogCards = await pageState(cdp);
  assert(catalogCards.text.includes("Compact modular storage for a small desk."),
    "desktop: product recommendation is missing its concise description");
  assert(catalogCards.text.toLocaleLowerCase("en-US").includes("item price"),
    "desktop: product recommendation does not distinguish item price from landed cost");
  assert(catalogCards.text.includes("Shipping, duties, and taxes are confirmed at checkout."),
    "desktop: checkout cost boundary is missing from product recommendations");
  assert(catalogCards.text.includes("Add to cart"),
    "desktop: purchasable recommendation is missing its cart action");
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent.includes("Prepare this product"));
    if (!button) throw new Error("Preparation button missing");
    button.click();
  })()`);
  await waitFor(async () => (await pageState(cdp)).text.includes("Product preparation started"), 7000).catch(async error => {
    const current = await pageState(cdp);
    throw new Error(`${error.message}; text=${current.text.slice(-800)}; requests=${server.requests().slice(-12).join(" | ")}`);
  });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(async () => (await pageState(cdp)).text.includes("Product preparation started"));
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent.includes("View 2 results"));
    if (!button) throw new Error("Restored result button missing");
    button.click();
  })()`);
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.products === 2 && page.text.includes("Preparation: request received");
  });
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.text.includes("Your prepared product preview is ready")
      && page.text.includes("Preparation: ready in this conversation")
      && page.notice === "Your prepared product is ready in this conversation."
      && page.noticeTone === "success";
  }, 19000);
  const delivered = await pageState(cdp);
  assert(!delivered.messageBodies.includes("Your prepared product is ready in this conversation."),
    "desktop: terminal progress message remained beside the delivered result");
  assert(delivered.messageBodies.includes("Your prepared product preview is ready in this conversation."),
    "desktop: delivered preview message is missing");
  const audit = await auditPage(cdp, 1440, [
    "Made in China. Select and Deliver.",
    "Free",
    "Pilot access",
    "Saved product brief",
    "Your prepared product is ready in this conversation.",
    "Preparation: ready in this conversation",
    "Your prepared product preview is ready",
  ]);
  assert(!audit.text.includes("Product preparation started"), "desktop: stale preparation copy remained after completion");
  assert(!/(?:internal provider|private pipeline|JWT|paid search plan)/i.test(audit.text), "desktop: private implementation copy leaked");
  assert(audit.text.includes("no charge will be attempted"), "desktop: free pilot boundary is missing");
  const screenshot = await saveScreenshot(cdp, "desktop-saved-request.png");
  return { name: "desktop-saved-request", viewport: "1440x1000", products: audit.products, screenshot };
}

async function runAgentAccessCase(cdp, server) {
  await server.reset();
  await setViewport(cdp, 1024, 900, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).text.includes("No Agent keys yet."));
  await evaluate(cdp, `document.querySelector("[data-create-agent-key]").click()`);
  await waitFor(async () => (await pageState(cdp)).text.includes("fictional_agent_secret_shown_once_1234567890"));
  const created = await pageState(cdp);
  assert(created.text.includes("Copy this key now"), "agent: one-time disclosure boundary missing");
  assert(created.text.includes("wp_live_...fixture"), "agent: stored prefix missing");
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("[data-agent-keys] button")]
      .find(node => node.textContent.trim() === "Revoke");
    if (!button) throw new Error("Agent revoke button missing");
    button.click();
  })()`);
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.text.includes("Agent access revoked")
      && page.text.includes("No Agent keys yet.")
      && !page.text.includes("fictional_agent_secret_shown_once_1234567890");
  });
  const audit = await auditPage(cdp, 1024, [
    "Agent access",
    "Catalog search stays public",
    "Agent access revoked",
  ]);
  assert(!/(?:internal provider|private pipeline|JWT)/i.test(audit.text), "agent: private implementation copy leaked");
  const screenshot = await saveScreenshot(cdp, "desktop-agent-access.png");
  return { name: "desktop-agent-access", viewport: "1024x900", screenshot };
}

async function runAgentAccessUnavailableCase(cdp, server) {
  await server.reset({ agentKeysUnavailable: true });
  await setViewport(cdp, 1024, 900, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).text.includes("Agent access is temporarily unavailable"));
  const audit = await auditPage(cdp, 1024, [
    "Saved product brief",
    "Product requests",
    "Agent access is temporarily unavailable",
    "Your conversations and requests are unaffected",
  ]);
  const createDisabled = await evaluate(cdp, `document.querySelector("[data-create-agent-key]").disabled`);
  assert(createDisabled === true, "agent outage: create action must fail closed");
  assert(!audit.text.includes("WP Workspace is temporarily unavailable"), "agent outage blanked the primary workspace");
  await evaluate(cdp, `document.querySelector("[data-agent-keys]").scrollIntoView({block:"center"})`);
  const screenshot = await saveScreenshot(cdp, "desktop-agent-access-unavailable.png");
  return { name: "desktop-agent-access-unavailable", viewport: "1024x900", screenshot };
}

async function runPreviewLimitCase(cdp, server) {
  await server.reset({ previewRemaining: 0 });
  await setViewport(cdp, 1024, 900, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).text.includes("0 of 3 free previews remain today"));
  const taskPostsBefore = server.requests().filter(request => request === "POST /api/tasks").length;
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find(node => node.textContent.includes("Start targeted sourcing"));
    if (!button) throw new Error("Targeted sourcing action missing");
    button.click();
  })()`);
  await waitFor(async () => (await pageState(cdp)).dynamicIntakes === 1);
  assert(server.requests().filter(request => request === "POST /api/tasks").length === taskPostsBefore,
    "preview quota: opening targeted sourcing created a task before the brief was submitted");
  await evaluate(cdp, `(() => {
    const values = {
      "[data-dynamic-product]": "Compact walnut desk organizer",
      "[data-dynamic-requirements]": "Cable storage and no plastic",
      "[data-dynamic-budget]": "35",
      "[data-dynamic-quantity]": "2",
      "[data-dynamic-destination]": "US",
    };
    for (const [selector, value] of Object.entries(values)) {
      const input = document.querySelector(selector);
      if (!input) throw new Error("Missing targeted sourcing field: " + selector);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    document.querySelector(".wp-dynamic-intake-form").requestSubmit();
  })()`);
  await waitFor(async () => (await pageState(cdp)).text.includes("free targeted-search allowance is currently unavailable"));
  assert(server.requests().filter(request => request === "POST /api/tasks").length === taskPostsBefore,
    "preview quota: exhausted allowance created a new task");
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find(node => node.textContent.includes("View 2 results"));
    if (!button) throw new Error("Existing result button missing");
    button.click();
  })()`);
  await waitFor(async () => (await pageState(cdp)).products === 2);
  const audit = await auditPage(cdp, 1024, [
    "0 of 3 free previews remain today",
    "Saved product brief",
    "Product matches",
  ]);
  assert(audit.products === 2, "preview quota: historical results must remain accessible");
  const screenshot = await saveScreenshot(cdp, "desktop-preview-limit.png");
  return { name: "desktop-preview-limit", viewport: "1024x900", products: audit.products, screenshot };
}

async function runPaidCreditsCase(cdp, server) {
  await server.reset({ paidCreditsEnabled: true });
  const configured = await fetch(`${server.origin}/api/summary`).then(response => response.json());
  assert(configured.payment?.enabled === true, "paid credits: fixture did not expose the enabled projection");
  await setViewport(cdp, 1024, 900, false);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace?commercial=enabled` });
  await waitFor(async () => (await pageState(cdp)).text.toLocaleLowerCase("en-US").includes("add credits")).catch(async error => {
    const current = await pageState(cdp);
    throw new Error(`${error.message}; text=${current.text.slice(0, 1000)}; requests=${server.requests().slice(-12).join(" | ")}`);
  });
  const audit = await auditPage(cdp, 1024, [
    "Add credits",
    "Starter search credits",
    "5 credits",
  ]);
  const checkoutHref = await evaluate(cdp, `document.querySelector(".wp-credit-plan")?.href || ""`);
  assert(checkoutHref === "https://fixture.myshopify.com/products/wp-search-credits",
    "paid credits: checkout must use the configured HTTPS Shopify product");
  const screenshot = await saveScreenshot(cdp, "desktop-paid-credits.png");
  return { name: "desktop-paid-credits", viewport: "1024x900", screenshot };
}

async function runNewConversationCase(cdp, server) {
  await server.reset();
  await setViewport(cdp, 390, 844, true);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).text.includes("free previews remain today"));
  await evaluate(cdp, `(() => {
    document.querySelector("[data-new-conversation]").click();
    const input = document.querySelector("[data-chat-input]");
    input.value = "A quiet STEM toy for a 10-year-old under $30, shipped to the US";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("[data-chat-form]").requestSubmit();
  })()`);
  await waitFor(async () => (await pageState(cdp)).text.includes("I saved the request"));
  const taskPostsBefore = server.requests().filter(request => request === "POST /api/tasks").length;
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Start targeted sourcing");
    if (!button) throw new Error("Targeted sourcing action missing");
    button.click();
  })()`);
  await waitFor(async () => (await pageState(cdp)).dynamicIntakes === 1);
  assert(server.requests().filter(request => request === "POST /api/tasks").length === taskPostsBefore,
    "new conversation: opening targeted sourcing created a task before the detailed brief");
  const chatPostsBeforeIntake = server.requests().filter(request => request === "POST /api/chat").length;
  await evaluate(cdp, `(() => {
    const values = {
      "[data-dynamic-product]": "Quiet STEM construction set for a 10-year-old",
      "[data-dynamic-requirements]": "Wooden construction set with no electronic sound",
      "[data-dynamic-budget]": "30",
      "[data-dynamic-quantity]": "2",
      "[data-dynamic-destination]": "United States",
    };
    for (const [selector, value] of Object.entries(values)) {
      const input = document.querySelector(selector);
      if (!input) throw new Error("Missing targeted sourcing field: " + selector);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    document.querySelector(".wp-dynamic-intake-form").requestSubmit();
  })()`);
  await waitFor(async () => {
    const page = await pageState(cdp);
    return page.text.includes("Request recorded") && page.text.includes("10 minutes");
  });
  assert(server.requests().filter(request => request === "POST /api/tasks").length === taskPostsBefore + 1,
    "new conversation: the completed brief did not create exactly one task");
  assert(server.requests().filter(request => request === "POST /api/chat").length === chatPostsBeforeIntake,
    "new conversation: targeted sourcing form leaked its brief into the chat endpoint");
  const audit = await auditPage(cdp, 390, [
    "A quiet STEM toy for a 10-year-old under $30, shipped to the US",
    "I saved the request",
    "Request recorded",
    "Usually ready within 10 minutes",
  ]);
  assert(audit.text.includes("free previews remain today"), "mobile: pilot quota is missing");
  assert(!/(?:internal provider|private pipeline|JWT|Add credits)/i.test(audit.text), "mobile: private or disabled commercial copy leaked");
  const screenshot = await saveScreenshot(cdp, "mobile-new-conversation.png");
  return { name: "mobile-new-conversation", viewport: "390x844", products: audit.products, screenshot };
}

async function runIncompleteBriefCase(cdp, server) {
  await server.reset();
  await setViewport(cdp, 390, 844, true);
  await cdp.send("Page.navigate", { url: `${server.origin}/workspace` });
  await waitFor(async () => (await pageState(cdp)).text.includes("free previews remain today"));
  await evaluate(cdp, `(() => {
    document.querySelector("[data-new-conversation]").click();
    const input = document.querySelector("[data-chat-input]");
    input.value = "A quiet STEM toy";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("[data-chat-form]").requestSubmit();
  })()`);
  await waitFor(async () => (await pageState(cdp)).text.includes("I saved the request"));
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Start targeted sourcing");
    if (!button) throw new Error("Targeted sourcing action missing");
    button.click();
  })()`);
  await waitFor(async () => (await pageState(cdp)).dynamicIntakes === 1);
  assert(!server.requests().some(request => request === "POST /api/tasks"),
    "incomplete brief: opening targeted sourcing created a task");
  await evaluate(cdp, `(() => {
    const values = {
      "[data-dynamic-product]": "Quiet wooden STEM building set for a five-year-old",
      "[data-dynamic-requirements]": "No electronic sound",
      "[data-dynamic-budget]": "40",
      "[data-dynamic-quantity]": "2",
    };
    for (const [selector, value] of Object.entries(values)) {
      const input = document.querySelector(selector);
      if (!input) throw new Error("Missing targeted sourcing field: " + selector);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    document.querySelector(".wp-dynamic-intake-form").requestSubmit();
  })()`);
  await waitFor(async () => (await pageState(cdp)).text.includes("Use a country name or ISO country code"));
  assert((await pageState(cdp)).dynamicIntakes === 1,
    "incomplete brief: the detailed intake disappeared before the missing destination was supplied");
  assert(!server.requests().some(request => request === "POST /api/tasks"),
    "incomplete brief: targeted sourcing must not create a task");
  const audit = await auditPage(cdp, 390, [
    "A quiet STEM toy",
    "Use a country name or ISO country code",
    "free previews remain today",
  ]);
  const screenshot = await saveScreenshot(cdp, "mobile-incomplete-brief.png");
  return { name: "mobile-incomplete-brief", viewport: "390x844", products: audit.products, screenshot };
}

async function auditPage(cdp, width, phrases) {
  const audit = await pageState(cdp);
  assert(audit.scrollWidth <= width + 1,
    `horizontal overflow ${audit.scrollWidth}/${width}: ${audit.overflowElements.join(" | ")}`);
  assert(audit.clippedControls.length === 0, `clipped controls: ${audit.clippedControls.join(", ")}`);
  assert(audit.runtimeErrors.length === 0, `uncaught browser errors: ${audit.runtimeErrors.join(" | ")}`);
  const normalizedText = audit.text.toLocaleLowerCase("en-US");
  for (const phrase of phrases) {
    assert(normalizedText.includes(phrase.toLocaleLowerCase("en-US")), `missing customer copy: ${phrase}`);
  }
  assert(!/[\p{Script=Han}]/u.test(audit.text), "customer-visible Chinese text leaked");
  assert(!/\b(?:SFC|ERiC)\b|World Products|Suntek services/.test(audit.text), "retired customer service branding leaked");
  return audit;
}

async function pageState(cdp) {
  return evaluate(cdp, `(() => {
    const text = document.body && document.body.innerText || "";
    const orderedSections = [
      ["brief", document.querySelector(".wp-request-brief")],
      ["edit", document.querySelector("[data-edit-requirements]")],
      ["status", document.querySelector(".wp-request-status")],
      ["results", document.querySelector("[data-results-section]")],
      ["deeper", document.querySelector("[data-deeper-search]")],
      ["activity", document.querySelector(".wp-request-activity")],
    ].filter(([, node]) => Boolean(node)).sort((left, right) => {
      if (left[1] === right[1]) return 0;
      return left[1].compareDocumentPosition(right[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    }).map(([key]) => key);
    const visible = node => Boolean(node)
      && !node.hidden
      && getComputedStyle(node).display !== "none"
      && getComputedStyle(node).visibility !== "hidden";
    const controls = [...document.querySelectorAll("button,a,textarea")].filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    return {
      ready: document.readyState,
      text,
      products: document.querySelectorAll(".wp-result-card").length,
      requestCards: document.querySelectorAll(".wp-result-card").length,
      sectionOrder: orderedSections,
      oldChatSurfaces: document.querySelectorAll(".wp-workspace-sidebar,.wp-workspace-chat,.wp-workspace-compose,.wp-message-avatar").length,
      activityOpen: Boolean(document.querySelector(".wp-request-activity")?.open),
      deeperVisible: visible(document.querySelector("[data-deeper-search]")),
      requirementsDrawerOpen: visible(document.querySelector("[data-requirements-drawer]")),
      requestDrawerOpen: visible(document.querySelector("[data-request-list-drawer]")),
      accountDrawerOpen: visible(document.querySelector("[data-account-drawer]")),
      saveState: document.querySelector("[data-save-state]")?.textContent.trim() || "",
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      clippedControls: controls.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        .map(node => node.textContent.trim()).filter(Boolean).slice(0, 10),
      runtimeErrors: Array.isArray(window.__wpQaErrors) ? window.__wpQaErrors.slice() : [],
      notice: document.querySelector("[data-workspace-notice]")?.textContent.trim() || "",
      noticeTone: document.querySelector("[data-workspace-notice]")?.dataset.tone || "",
      messageBodies: [...document.querySelectorAll(".wp-message-body")].map(node => node.textContent.trim()),
      typingIndicators: document.querySelectorAll(".wp-message.is-typing").length,
      suggestionPanels: document.querySelectorAll(".wp-message-suggestions").length,
      suggestionButtons: document.querySelectorAll(".wp-suggestion-button").length,
      customSuggestionButtons: document.querySelectorAll(".wp-suggestion-custom").length,
      dynamicIntakes: document.querySelectorAll(".wp-dynamic-intake").length,
      activeConversationTitle: document.querySelector("[data-conversation-title]")?.textContent.trim() || "",
      overflowElements: [document.documentElement, document.body, ...document.querySelectorAll("body *")].map(node => {
        const rect = node.getBoundingClientRect();
        const spillsRect = rect.left < -1 || rect.right > innerWidth + 1;
        const spillsContent = node.scrollWidth > node.clientWidth + 1 || node.scrollWidth > innerWidth + 1;
        if (rect.width <= 0 || rect.height <= 0 || (!spillsRect && !spillsContent)) return null;
        const id = node.id ? "#" + node.id : "";
        const classes = [...node.classList].slice(0, 3).map(name => "." + name).join("");
        return node.tagName.toLowerCase() + id + classes + " [" + Math.round(rect.left) + "," + Math.round(rect.right) + "; scroll " + node.scrollWidth + "/" + node.clientWidth + "]";
      }).filter(Boolean).slice(0, 12),
    };
  })()`);
}

async function installRuntimeErrorCapture(cdp) {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__wpQaErrors = [];
      addEventListener("error", event => {
        const message = event && (event.message || event.error && event.error.message);
        if (message) window.__wpQaErrors.push(String(message).slice(0, 500));
      });
      addEventListener("unhandledrejection", event => {
        const reason = event && event.reason;
        const message = reason && reason.message || reason;
        window.__wpQaErrors.push(String(message || "Unhandled promise rejection").slice(0, 500));
      });
    })();`,
  });
}

async function saveScreenshot(cdp, name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const destination = path.join(artifactDir, name);
  await writeFile(destination, Buffer.from(result.data, "base64"));
  return path.relative(repoRoot, destination).replaceAll("\\", "/");
}

async function loadAssets() {
  const [workspaceJs, workspaceCss, shell] = await Promise.all([
    readFile(path.join(themeRoot, "assets", "wp-workspace.js"), "utf8"),
    readFile(path.join(themeRoot, "assets", "wp-workspace.css"), "utf8"),
    readFile(path.join(themeRoot, "snippets", "wp-shell.liquid"), "utf8"),
  ]);
  const shellCss = shell.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  return { workspaceJs, workspaceCss, shellCss };
}

function workspaceHtml(styles) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sourcing workspace QA</title><style>${styles.shellCss}\n${styles.workspaceCss}</style></head><body>
  <div class="wp-shell wp-workspace-page" data-wp-workspace data-api-base="/api" data-customer-logged-in="true" data-poll-interval="15000">
    <header class="wp-request-global-head"><a class="wp-request-back" href="#">Send From China</a><nav aria-label="Account navigation"><button type="button" data-open-request-list>Requests</button><a href="#">Orders</a><button type="button" data-open-account>Account</button></nav></header>
    <main class="wp-request-detail">
      <p class="wp-workspace-notice" data-workspace-notice hidden></p>
      <div class="wp-request-toolbar"><button class="wp-request-back-link" type="button" data-open-request-list>&larr; Sourcing requests</button><span class="wp-request-save-state" data-save-state>Saved</span></div>
      <header class="wp-request-title-row"><div><p class="wp-request-kicker">Custom sourcing request</p><h1 data-conversation-title>New product request</h1><p data-conversation-subtitle>Tell us what you need, then review prepared product matches.</p></div><span class="wp-request-status-badge" data-request-status>Draft</span></header>
      <div class="wp-request-layout"><div class="wp-request-main">
        <section class="wp-request-concierge" data-concierge-stage aria-labelledby="WPConciergeHeading"><div class="wp-request-section-head"><div><p class="wp-request-kicker">Product concierge</p><h2 id="WPConciergeHeading">Tell us what you are looking for</h2></div><span class="wp-concierge-state" data-concierge-state>Listening</span></div><div class="wp-concierge-thread" data-concierge-messages aria-live="polite"></div><form class="wp-concierge-composer" data-chat-form><label class="visually-hidden" for="WPWorkspaceMessage">Message Send From China</label><textarea id="WPWorkspaceMessage" data-chat-input maxlength="1000" placeholder="Describe the product, recipient, budget, destination, or use case" required></textarea><button type="submit" data-chat-send aria-label="Send message">&uarr;</button><p class="wp-concierge-composer-hint">Enter to send &middot; Shift + Enter for a new line</p></form></section>
        <section class="wp-request-results" data-results-section hidden aria-labelledby="WPResultsHeading"><div class="wp-request-section-head"><div><p class="wp-request-kicker">Prepared products</p><h2 id="WPResultsHeading">Products selected for this brief</h2></div><p data-results-summary>Results appear here when they are ready.</p></div><div data-results><p class="wp-workspace-empty">No prepared products yet.</p></div></section>
        <section class="wp-request-deeper" data-deeper-search hidden aria-labelledby="WPDeeperHeading"><div><p class="wp-request-kicker">Continue the search</p><h2 id="WPDeeperHeading">Review the complete result set</h2><p>The free preview highlights up to three prepared products. More source matches remain saved for an explicit continuation.</p></div><div class="wp-credit-plans" data-credit-plans></div></section>
      </div><aside class="wp-request-aside" aria-label="Request summary">
        <section class="wp-request-brief" aria-labelledby="WPBriefHeading"><div class="wp-request-section-head"><div><p class="wp-request-kicker">Your brief</p><h2 id="WPBriefHeading">What we are looking for</h2></div></div><dl class="wp-brief-facts" data-brief><div><dt>Request</dt><dd>Start by describing the product or problem to solve.</dd></div></dl><button class="wp-request-secondary-action" type="button" data-edit-requirements>Edit requirements</button><p class="wp-request-working" data-request-working hidden role="status">Updating your brief...</p></section>
        <section class="wp-request-status" aria-labelledby="WPStatusHeading"><div class="wp-request-section-head"><div><p class="wp-request-kicker">Status</p><h2 id="WPStatusHeading">Sourcing progress</h2></div></div><div class="wp-request-progress" data-request-progress><p class="wp-workspace-empty">No sourcing request has started.</p></div></section>
        <details class="wp-request-activity"><summary>Request activity</summary><div class="wp-request-activity-body"><div class="wp-request-activity-list" data-messages><p class="wp-workspace-empty">No activity yet.</p></div><div class="wp-request-list-compact" data-task-list></div></div></details>
      </aside></div>
    </main>
    <div class="wp-request-drawer-backdrop" data-drawer-backdrop hidden></div>
    <aside class="wp-request-drawer" data-request-list-drawer hidden aria-labelledby="WPRequestsDrawerHeading"><div class="wp-request-drawer-head"><div><p class="wp-request-kicker">Account</p><h2 id="WPRequestsDrawerHeading">Sourcing requests</h2></div><button type="button" data-close-drawer aria-label="Close requests">&times;</button></div><button class="wp-request-primary-action" type="button" data-new-conversation>New request</button><div class="wp-workspace-conversations" data-conversations><p class="wp-workspace-empty">Loading requests...</p></div></aside>
    <aside class="wp-request-drawer" data-account-drawer hidden aria-labelledby="WPAccountDrawerHeading"><div class="wp-request-drawer-head"><div><p class="wp-request-kicker">Your account</p><h2 id="WPAccountDrawerHeading">QA Customer</h2></div><button type="button" data-close-drawer aria-label="Close account">&times;</button></div><p data-account-id>Connecting your account...</p><div class="wp-account-drawer-actions"><a href="#">Back to store</a><a class="is-strong" href="#">Sign out</a></div><details class="wp-account-developer-tools"><summary>Agent access</summary><p>Create a revocable key for private requests and results.</p><button type="button" data-create-agent-key>Create Agent key</button><div class="wp-agent-token" data-agent-token hidden><strong>Copy this key now</strong><code data-agent-token-value></code><button type="button" data-copy-agent-key>Copy key</button><small>The full key will not be shown again.</small></div><div class="wp-agent-keys" data-agent-keys></div></details></aside>
    <aside class="wp-request-drawer wp-requirements-drawer" data-requirements-drawer hidden aria-labelledby="WPRequirementsHeading"><div class="wp-request-drawer-head"><div><p class="wp-request-kicker">Requirements</p><h2 id="WPRequirementsHeading">Edit your brief</h2></div><button type="button" data-close-drawer aria-label="Close requirements">&times;</button></div><p>Describe the product, recipient, budget, destination, quantity, or constraints. Your saved brief will update when you send it.</p><div data-dynamic-intake-host></div></aside>
  </div><script src="/wp-workspace.js"></script></body></html>`;
}

async function startFixture(assets, listenPort = 0) {
  let state = fixtureState();
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(request.url || "/", origin);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/workspace") return send(response, 200, workspaceHtml(assets), "text/html; charset=utf-8");
    if (url.pathname === "/wp-workspace.js") return send(response, 200, assets.workspaceJs, "text/javascript; charset=utf-8");
    if (url.pathname === "/api/reset" && request.method === "POST") { state = fixtureState(); return json(response, 200, { ok: true }); }
    if (!url.pathname.startsWith("/api/")) return json(response, 404, { error: "NOT_FOUND" });
    advancePreparation(state);
    const route = url.pathname.slice(4);
    if (route === "/summary") return json(response, 200, summary(state));
    if (route === "/conversations") return json(response, 200, { conversations: state.conversations.map(conversationSummary) });
    if (route === "/tasks") {
      if (request.method === "GET") return json(response, 200, { tasks: state.tasks });
      const body = await readJson(request);
      if (body.plan_id === "preview" && state.previewRemaining <= 0) {
        return json(response, 429, { error: "FREE_PREVIEW_DAILY_LIMIT", message: "Today's free preview limit has been reached." });
      }
      const task = makeTask(`task_${state.tasks.length + 1}`, body.conversation_id, body.query, "QUEUED", 0);
      state.tasks.unshift(task);
      if (body.plan_id === "preview") state.previewRemaining = Math.max(0, state.previewRemaining - 1);
      state.messages[body.conversation_id].push({
        role: "assistant",
        kind: "SOURCING_TASK_CREATED",
        content: "Your request has been recorded. Initial results are usually ready within 10 minutes and will return to this conversation.",
        payload: { task_id: task.id, status: "QUEUED", estimated_minutes: 10 },
        message_key: `task_${task.id}`,
      });
      return json(response, 201, { task });
    }
    if (route === "/agent-keys") {
      if (request.method === "GET") {
        if (state.agentKeysUnavailable) return json(response, 503, { error: "AGENT_ACCESS_UNAVAILABLE" });
        return json(response, 200, { keys: state.agentKeys });
      }
      if (request.method === "POST") {
        const key = {
          id: "key_fixture",
          label: "My Agent",
          prefix: "wp_live_...fixture",
          scopes: ["catalog:read", "sourcing:read", "sourcing:write"],
          created_at: new Date().toISOString(),
          revoked_at: null,
        };
        state.agentKeys = [key];
        return json(response, 201, {
          key,
          token: "wp_live_fixture_fictional_agent_secret_shown_once_1234567890",
        });
      }
    }
    const agentKeyMatch = route.match(/^\/agent-keys\/([^/]+)$/);
    if (agentKeyMatch && request.method === "DELETE") {
      state.agentKeys = state.agentKeys.map(key => key.id === decodeURIComponent(agentKeyMatch[1])
        ? { ...key, revoked_at: new Date().toISOString() }
        : key);
      return json(response, 200, { ok: true });
    }
    if (route === "/chat" && request.method === "POST") {
      const body = await readJson(request);
      if (state.chatDelayMs > 0) await new Promise(resolve => setTimeout(resolve, state.chatDelayMs));
      const id = body.conversation_id || "conv_new";
      if (!state.messages[id]) {
        const completeBrief = /shipp?ed to (?:the )?US/i.test(String(body.message || ""));
        state.conversations.unshift({
          id,
          title: "Quiet STEM toy",
          criteria: completeBrief
            ? { category: "STEM toy", use_case: "quiet learning", budget_max_usd: 30, recipient: "10-year-old", ship_to: "US" }
            : { category: "STEM toy", use_case: "quiet learning" },
          updated_at: new Date().toISOString(),
        });
        state.messages[id] = [];
      }
      const conversation = state.conversations.find(item => item.id === id);
      const messageText = String(body.message || "");
      if (conversation) {
        const criteria = { ...(conversation.criteria || {}) };
        if (/\b(?:ship(?:ped)?\s+to\s+(?:the\s+)?US|destination\s*(?:is|:)\s*(?:the\s+)?US)\b/i.test(messageText)) criteria.ship_to = "US";
        if (/\bwood(?:en)?\b/i.test(messageText)) criteria.materials = ["wood"];
        if (/\b(?:STEM|building|construction)\b/i.test(messageText)) criteria.category = "STEM building set";
        const price = messageText.match(/(?:under|below|budget(?:\s+of)?)[^\d]{0,8}\$?(\d+(?:\.\d+)?)/i);
        if (price) criteria.budget_max_usd = Number(price[1]);
        const quantity = messageText.match(/quantity\s+(\d+|one|two|three|four|five)/i);
        if (quantity) criteria.quantity = ({ one: 1, two: 2, three: 3, four: 4, five: 5 }[quantity[1].toLowerCase()] || Number(quantity[1]));
        conversation.criteria = criteria;
        conversation.updated_at = new Date().toISOString();
      }
      state.messages[id].push({ role: "user", content: body.message, message_key: body.message_id, payload: {} });
      state.messages[id].push({
        role: "assistant",
        content: "I saved the request. I will use the age, budget, and quiet STEM use case before showing products.",
        message_key: `reply_${body.message_id}`,
        payload: { next_actions: fixtureNextActions() },
      });
      return json(response, 200, { conversation_id: id });
    }
    const conversationMatch = route.match(/^\/conversations\/([^/]+)$/);
    if (conversationMatch) {
      const id = decodeURIComponent(conversationMatch[1]);
      const conversation = state.conversations.find(item => item.id === id);
      if (!conversation) return json(response, 404, { error: "PRODUCT_REQUEST_NOT_FOUND" });
      return json(response, 200, { conversation, messages: state.messages[id] || [], tasks: state.tasks.filter(task => task.conversation_id === id) });
    }
    const governanceMatch = route.match(/^\/tasks\/([^/]+)\/results\/([^/]+)\/governance$/);
    if (governanceMatch && request.method === "POST") {
      const taskId = decodeURIComponent(governanceMatch[1]);
      const candidateId = decodeURIComponent(governanceMatch[2]);
      if (!state.governance.some(job => job.candidate_id === candidateId)) {
        const governanceJobId = `prep_${candidateId}`;
        state.governance.push({ id: governanceJobId, conversation_id: taskId, candidate_id: candidateId, state: "QUEUED" });
        state.preparationReadyAt = Date.now() + 500;
        const task = state.tasks.find(item => item.id === taskId);
        if (task) state.messages[task.conversation_id].push({
          role: "assistant",
          kind: "GOVERNANCE_PROGRESS",
          content: "Product preparation started. Progress and the final result will return to this conversation.",
          message_key: `governance:${governanceJobId}:progress`,
          payload: { governance_job_id: governanceJobId, candidate_id: candidateId, state: "QUEUED" },
        });
      }
      return json(response, 201, { created: true });
    }
    const resultsMatch = route.match(/^\/tasks\/([^/]+)\/results$/);
    if (resultsMatch) {
      const task = state.tasks.find(item => item.id === decodeURIComponent(resultsMatch[1]));
      return json(response, 200, { task, results: task ? state.results : [] });
    }
    const taskGovernanceMatch = route.match(/^\/tasks\/([^/]+)\/governance$/);
    if (taskGovernanceMatch) return json(response, 200, { jobs: state.governance, messages: [] });
    return json(response, 404, { error: "NOT_FOUND" });
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(listenPort, "127.0.0.1", resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    reset: async (overrides = {}) => { state = { ...fixtureState(), ...overrides }; },
    requests: () => requests.slice(),
    close: () => new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); }),
  };
}

function fixtureState() {
  const conversation = {
    id: "conv_saved",
    title: "Saved product brief",
    criteria: { category: "desk organizer", use_case: "desktop storage", budget_max_usd: 35, ship_to: "US" },
    updated_at: "2026-08-14T03:30:00Z",
  };
  return {
    conversations: [conversation],
    messages: {
      conv_saved: [
        { role: "user", content: "I need a compact desk organizer under $35.", message_key: "msg_saved_user", payload: {} },
        { role: "assistant", content: "I saved the request and kept the budget and use case with this conversation.", message_key: "msg_saved_agent", payload: { next_actions: fixtureNextActions() } },
      ],
    },
    tasks: [makeTask("task_saved", conversation.id, "Compact desk organizer under $35", "COMPLETED", 4)],
    governance: [],
    agentKeys: [],
    agentKeysUnavailable: false,
    paidCreditsEnabled: false,
    previewRemaining: 2,
    chatDelayMs: 0,
    preparationReadyAt: 0,
    preparationDelivered: false,
    results: [
      { id: "product_1", title: "Compact Modular Desk Organizer", summary: "Modular trays keep pens, notes, and small accessories within reach on a compact desk.", why: "Fits the requested desktop storage use case and stays below the item-price budget.", price_usd: 24.9, currency: "USD", available: true, image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/fixture-organizer-1.jpg", add_to_cart_url: "https://sendfromchina.ai/cart/123456781:1", product_url: "https://sendfromchina.ai/products/compact-modular-desk-organizer", source_url: "", governance_status: "PUBLISHED" },
      { id: "product_2", title: "Wooden Desktop Storage Tray", summary: "A divided wooden tray for stationery, cables, and daily essentials.", why: "Offers the requested natural material with a small desktop footprint.", price_usd: 31.5, currency: "USD", available: true, image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/fixture-organizer-2.jpg", add_to_cart_url: "https://sendfromchina.ai/cart/123456782:1", product_url: "https://sendfromchina.ai/products/wooden-desktop-storage-tray", source_url: "", governance_status: "PUBLISHED" },
      { id: "product_3", title: "Stackable Pen and Accessory Caddy", summary: "Stackable compartments adapt to changing stationery and accessory storage needs.", why: "Adds flexible storage while remaining within the confirmed budget.", price_usd: 19.8, currency: "USD", available: true, image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/fixture-organizer-3.jpg", add_to_cart_url: "https://sendfromchina.ai/cart/123456783:1", product_url: "https://sendfromchina.ai/products/stackable-pen-accessory-caddy", source_url: "", governance_status: "PUBLISHED" },
      { id: "product_4", title: "Rotating Office Supply Organizer", summary: "A larger rotating organizer for shared workspaces and craft supplies.", why: "Relevant to the category, but intentionally held for the deeper-search continuation.", price_usd: 28.0, currency: "USD", available: true, image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/fixture-organizer-4.jpg", add_to_cart_url: "https://sendfromchina.ai/cart/123456784:1", product_url: "https://sendfromchina.ai/products/rotating-office-supply-organizer", source_url: "", governance_status: "PUBLISHED" },
    ],
  };
}

function fixtureNextActions() {
  return [
    { label: "Browse similar products", message: "Search the current brief", operation: "search" },
    { label: "Adjust the brief", message: "I want to refine one detail", operation: "chat" },
    { label: "Start targeted sourcing", message: "Start a targeted product request", operation: "dynamic_request" },
  ];
}

function advancePreparation(state) {
  if (!state.preparationReadyAt || state.preparationDelivered || Date.now() < state.preparationReadyAt) return;
  state.preparationDelivered = true;
  state.governance = state.governance.map(job => ({ ...job, state: "READY" }));
  const task = state.tasks.find(item => item.id === "task_saved");
  const conversationId = task?.conversation_id || "conv_saved";
  const progressMessage = state.messages[conversationId]?.find(message => (
    message.kind === "GOVERNANCE_PROGRESS"
    && message.payload?.governance_job_id === "prep_candidate_1"
  ));
  if (progressMessage) {
    progressMessage.content = "Your prepared product is ready in this conversation.";
    progressMessage.payload = { ...progressMessage.payload, state: "READY" };
  }
  state.messages[conversationId]?.push({
    role: "assistant",
    kind: "GOVERNANCE_RESULT",
    content: "Your prepared product preview is ready in this conversation.",
    message_key: "prep_candidate_1_ready",
    payload: {
      governance_job_id: "prep_candidate_1",
      candidate_id: "candidate_1",
      state: "READY",
      preview: {
        title: "Prepared Compact Modular Desk Organizer",
        description_html: "<p>Prepared English product content for review.</p>",
        images: [],
        disclaimer: "This content preview is not ready to buy until price, delivery, availability, safety, and publication checks finish.",
      },
    },
  });
}

function makeTask(id, conversationId, query, status = "COMPLETED", resultCount = 2) {
  return {
    id,
    conversation_id: conversationId,
    query,
    status,
    result_count: resultCount,
    plan_id: "preview",
    human_result_limit: 3,
    full_results_unlocked: false,
    full_results_unlock_credits: 5,
    created_at: "2026-08-14T03:31:00Z",
  };
}

function conversationSummary(item) {
  return { id: item.id, title: item.title, updated_at: item.updated_at };
}

function summary(state) {
  const payment = state.paidCreditsEnabled
    ? {
        enabled: true,
        reason: "",
        products: [{
          plan_id: "focused",
          title: "Starter search credits",
          credits: 5,
          checkout_url: "https://fixture.myshopify.com/products/wp-search-credits",
        }],
      }
    : { enabled: false, reason: "CREDIT_PRODUCTS_NOT_CONFIGURED", products: [] };
  return {
    account: { customer_id: "customer_fictional_browser_qa", shop: "fixture.myshopify.com" },
    credits: { available: 0, reserved: 0 },
    tasks: {
      total: state.tasks.length,
      active: state.tasks.filter(task => !["COMPLETED", "NO_MATCH", "FAILED", "CANCELLED"].includes(String(task.status || "").toUpperCase())).length,
      completed: state.tasks.filter(task => String(task.status || "").toUpperCase() === "COMPLETED").length,
    },
    plans: [{ id: "preview", credits: 0, scan_limit: 30, human_result_limit: 3 }],
    preview_access: {
      enabled: true,
      daily_limit: 3,
      used_today: 3 - state.previewRemaining,
      remaining_today: state.previewRemaining,
      resets_at: "2026-08-15T00:00:00.000Z",
    },
    payment,
    services: [{ service: "WP", linked: true, handoff_enabled: false, base_url: "https://example.invalid" }],
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(response, status, body, contentType) {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

function json(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

async function setViewport(cdp, width, height, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForPageEndpoint(port) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
    let intentionalClose = false;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const requestId = ++id;
        return new Promise((requestResolve, requestReject) => {
          pending.set(requestId, { resolve: requestResolve, reject: requestReject });
          socket.send(JSON.stringify({ id: requestId, method, params }));
        });
      },
      close() { intentionalClose = true; socket.close(); },
    }));
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else handler.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      for (const handler of pending.values()) {
        if (intentionalClose) handler.resolve({});
        else handler.reject(new Error("Chrome DevTools connection closed"));
      }
      pending.clear();
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitFor(check, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(60);
  }
  throw new Error("Browser condition timed out");
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
