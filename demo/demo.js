import {
  bffEndpointUrl,
  formatIllustrativePrice,
  formatVerifiedPrice,
  runtimePresentation,
  sanitizePublicErrorCode,
} from "./public-contract.mjs";
import {
  createRunStore,
  freezeRuntimeStatus,
} from "./run-store.mjs";

(() => {
  const drawer = document.querySelector(".drawer");
  const backdrop = document.querySelector(".backdrop");
  const workbenchResults = document.querySelector("[data-workbench-results]");
  const drawerResults = document.querySelector("[data-drawer-results]");
  const receipt = document.querySelector("[data-runs-receipt]");
  const runtimeBanner = document.querySelector(".runtime-banner");
  const runtimeStatusEndpoint = bffEndpointUrl(window.location, "runtime/status");
  const runEndpoint = bffEndpointUrl(window.location, "runs");
  let runtimeStatus = null;
  let lastFocus = null;

  function makeElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function resultEmpty(container, title, copy) {
    const empty = makeElement("section", "run-empty");
    empty.append(makeElement("strong", "", title), makeElement("p", "", copy));
    container.replaceChildren(empty);
  }

  function addFact(list, label, value) {
    const row = makeElement("div", "result-fact");
    row.append(makeElement("dt", "", label), makeElement("dd", "", value));
    list.append(row);
  }

  function renderProduct(product, live) {
    const card = makeElement("article", `result ${live ? "is-shopify" : "is-synthetic"}`);
    const provenance = makeElement(
      "small",
      "result-provenance",
      live ? "SHOPIFY VERIFIED · READ-ONLY" : "SYNTHETIC · ILLUSTRATIVE",
    );
    const heading = makeElement("h3", "", product.title);
    const summary = makeElement("p", "result-summary", product.summary || "No summary supplied.");
    const facts = makeElement("dl", "result-facts");
    if (live) {
      addFact(facts, "Shopify verified price", formatVerifiedPrice(product));
      addFact(facts, "Shopify availableForSale", String(product.available_for_sale));
      addFact(facts, "Verified at", product.shopify_verified_at);
      addFact(facts, "Product URL", product.product_url);
    } else {
      addFact(facts, "Illustrative price", formatIllustrativePrice(product));
      addFact(facts, "Availability", "Illustrative only · no Shopify availability claim");
      addFact(facts, "Product URL", "No verified Shopify product link");
    }
    const flags = makeElement("div", "result-flags");
    flags.append(
      makeElement("em", "", "NON-TRANSACTIONAL"),
      makeElement("em", "", "NOT PURCHASABLE"),
      makeElement("em", "", "WRITES DISABLED"),
      makeElement("em", "", "NO SHIPPING RATES"),
    );
    card.append(provenance, heading, summary, facts, flags);
    if (live) {
      const link = makeElement("a", "verified-product-link", "Open verified Shopify product");
      link.href = product.product_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    } else {
      card.append(makeElement("p", "synthetic-note", "Illustrative fixture; no live Shopify fact is asserted."));
    }
    return card;
  }

  function renderRun(container, run) {
    const live = run.runtime.mode === "shopify_read_only";
    const heading = makeElement("header", "run-result-heading");
    heading.append(
      makeElement("strong", "", live ? "Shopify read-only result" : "Synthetic result"),
      makeElement("span", "", `${run.search.status} · ${run.search.trace_id}`),
    );
    const boundary = makeElement(
      "p",
      "run-boundary",
      "Read-only result. No cart, checkout, order, payment, shipping quote, or inventory promise was created.",
    );
    const body = makeElement("div", "result-row");
    for (const product of run.search.results) body.append(renderProduct(product, live));
    if (!run.search.results.length) {
      body.append(makeElement(
        "p",
        "result-empty-copy",
        run.search.status === "needs_clarification"
          ? "More criteria are required. No result or fallback was invented."
          : run.search.status === "degraded"
            ? "Search is degraded. No fallback result was invented."
            : "The bounded search returned no match. No fallback result was invented.",
      ));
    }
    container.replaceChildren(heading, boundary, body);
  }

  function renderReceipt(run) {
    receipt.textContent = JSON.stringify(run, null, 2);
  }

  const runStore = createRunStore({
    renderWorkbench: (run) => renderRun(workbenchResults, run),
    renderDrawer: (run) => renderRun(drawerResults, run),
    renderReceipt,
  });

  function installDiagnostics() {
    const diagnostics = {};
    Object.defineProperties(diagnostics, {
      getActiveRun: {
        value: () => runStore.getActiveRun(),
        enumerable: true,
      },
      lastRenderIdentity: {
        get: () => runStore.getLastRenderIdentity(),
        enumerable: true,
      },
    });
    Object.defineProperty(window, "__referenceStoreDemo", {
      value: Object.freeze(diagnostics),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  }

  function updateRunControls(enabled) {
    document.querySelectorAll("[data-run-button]").forEach((button) => {
      button.disabled = !enabled;
    });
  }

  function applyRuntimeStatus(parsedPayload) {
    const runtime = freezeRuntimeStatus(parsedPayload);
    const presentation = runtimePresentation(runtime);
    runtimeStatus = runtime;
    runtimeBanner.dataset.mode = runtime.mode;
    runtimeBanner.dataset.connected = String(runtime.connected);
    runtimeBanner.dataset.runtimeReady = "true";
    setText("[data-runtime-label]", presentation.modeLabel);
    setText("[data-runtime-connection]", presentation.connectionLabel);
    setText("[data-runtime-checked]", presentation.checkedAtLabel);
    setText("[data-runtime-quota]", presentation.quotaLabel);
    setText("[data-runtime-writes]", presentation.writesLabel);
    setText("[data-drawer-mode]", presentation.drawerLabel);
    setText("[data-core-status]", presentation.coreLabel);
    setText("[data-authorization-status]", presentation.authorizationLabel);
    setText("[data-runtime-contract]", `${runtime.contract} ← ${runtime.source_contract}`);
    document.querySelectorAll("[data-mode-option]").forEach((option) => {
      const active = option.dataset.modeOption === runtime.mode;
      option.classList.toggle("is-active", active);
      option.classList.toggle("is-unavailable", active && !runtime.connected);
      if (active) option.setAttribute("aria-current", "true");
      else option.removeAttribute("aria-current");
    });
    updateRunControls(runtime.connected
      && runtime.capabilities.catalog_search
      && runtime.capabilities.search_contract_v2);
    return runtime;
  }

  function showRuntimeUnavailable() {
    runtimeStatus = null;
    runtimeBanner.dataset.mode = "unavailable";
    runtimeBanner.dataset.connected = "false";
    runtimeBanner.dataset.runtimeReady = "error";
    setText("[data-runtime-label]", "Runtime unavailable");
    setText("[data-runtime-connection]", "Not connected · no mode asserted");
    setText("[data-runtime-checked]", "Not verified");
    setText("[data-runtime-quota]", "Unavailable");
    setText("[data-runtime-writes]", "Writes disabled");
    setText("[data-drawer-mode]", "RUNTIME UNAVAILABLE · NO FALLBACK");
    setText("[data-core-status]", "Unavailable · no fallback");
    setText(
      "[data-authorization-status]",
      "Status could not be verified. Configure authorization only in the BFF environment or secret provider.",
    );
    updateRunControls(false);
  }

  async function responseJson(response) {
    try {
      return await response.json();
    } catch {
      throw new TypeError("invalid_bff_response");
    }
  }

  async function loadRuntimeStatus() {
    try {
      if (!runtimeStatusEndpoint) throw new TypeError("runtime_status_unavailable");
      const response = await fetch(runtimeStatusEndpoint, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
      const payload = await responseJson(response);
      if (!response.ok) throw new TypeError("runtime_status_unavailable");
      applyRuntimeStatus(payload);
    } catch {
      showRuntimeUnavailable();
    }
  }

  function setRunBusy(busy) {
    document.querySelectorAll("[data-run-button]").forEach((button) => {
      button.disabled = busy || !runtimeStatus?.connected;
    });
    document.querySelectorAll("[data-run-form]").forEach((form) => {
      form.setAttribute("aria-busy", String(busy));
    });
  }

  function setRunAlert(message = "") {
    document.querySelectorAll("[data-run-alert]").forEach((alert) => {
      alert.textContent = message;
      alert.hidden = !message;
    });
  }

  function renderRunFailure(code) {
    const copy = `The BFF stopped safely (${code}). No synthetic fallback or external action was attempted.`;
    setRunAlert(copy);
    if (!runStore.getActiveRun()) {
      resultEmpty(workbenchResults, "Read-only run unavailable", copy);
      resultEmpty(drawerResults, "Read-only run unavailable", copy);
    }
  }

  async function executeRun(query) {
    if (!runtimeStatus?.connected) {
      renderRunFailure("runtime_not_configured");
      return;
    }
    setRunBusy(true);
    setRunAlert("Running a bounded read-only search. Waiting for one closed BFF response.");
    if (!runStore.getActiveRun()) {
      resultEmpty(workbenchResults, "Running bounded search…", "Waiting for one closed BFF response.");
      resultEmpty(drawerResults, "Running bounded search…", "Waiting for the same closed BFF response.");
    }
    try {
      if (!runEndpoint) throw new TypeError("runtime_not_configured");
      const response = await fetch(runEndpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({ query }),
      });
      const payload = await responseJson(response);
      if (!response.ok) {
        if (payload?.runtime) applyRuntimeStatus(payload.runtime);
        else showRuntimeUnavailable();
        throw new TypeError(sanitizePublicErrorCode(payload?.error));
      }
      const run = runStore.setActiveRun(payload);
      setRunAlert();
      applyRuntimeStatus(run.runtime);
    } catch (error) {
      renderRunFailure(sanitizePublicErrorCode(error?.message));
    } finally {
      setRunBusy(false);
    }
  }

  function openDrawer(brief = "") {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.querySelectorAll("[data-open-agent]").forEach((button) => {
      button.setAttribute("aria-expanded", "true");
    });
    const input = drawer.querySelector("[data-run-query]");
    if (brief) input.value = brief;
    input.focus();
  }

  function closeDrawer() {
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    document.documentElement.style.overflow = "";
    document.querySelectorAll("[data-open-agent]").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  }

  document.querySelectorAll("[data-open-agent]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => openDrawer(button.dataset.query || ""));
  });
  document.querySelectorAll("[data-close-agent]").forEach((button) => {
    button.addEventListener("click", closeDrawer);
  });
  document.querySelectorAll("[data-run-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector("[data-run-query]");
      const query = input.value.trim().slice(0, 300);
      if (query) executeRun(query);
    });
  });
  document.querySelectorAll("[data-starter]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = drawer.querySelector("[data-run-query]");
      input.value = button.dataset.starter;
      drawer.querySelector("[data-run-form]").requestSubmit();
    });
  });
  document.querySelector("[data-catalog-search]").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = event.currentTarget.querySelector("input").value.trim();
    openDrawer(query || "A practical desk gift under $40");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) closeDrawer();
  });

  drawer.setAttribute("aria-hidden", "true");
  updateRunControls(false);
  installDiagnostics();
  loadRuntimeStatus();
})();
