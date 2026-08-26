import {
  formatIllustrativePrice,
  runtimePresentation,
  sanitizeOptionalInspectorFields,
} from "./public-contract.mjs";

(() => {
  const scenarios = {
    catalog_match: {
      label: "Catalog match", labButton: "✅ Catalog match", queryButton: "🎁 Desk gift query",
      labStarter: "✅ Catalog match · practical gift under $40", queryStarter: "🎁 Sample query · practical desk gift under $40",
      prompt: "A practical desk gift under $40",
    },
    terminal_miss: {
      label: "Terminal miss", labButton: "🔎 Terminal miss", queryButton: "🧩 Unusual product query",
      labStarter: "🔎 Terminal miss · verify no silent sourcing", queryStarter: "🧩 Sample query · an unusual, tightly specified product",
      prompt: "A left-handed titanium curling stone with braille and solar heating",
    },
    needs_clarification: {
      label: "Needs detail", labButton: "💬 Needs detail", queryButton: "♻️ Sustainable gift query",
      labStarter: "💬 Needs detail · ask before claiming a match", queryStarter: "♻️ Sample query · a sustainable gift",
      prompt: "Find a sustainable gift",
    },
    degraded: {
      label: "Safe failure", labButton: "🛟 Safe failure", queryButton: "🏠 Small-space query",
      labStarter: "🛟 Safe failure · keep the boundary visible", queryStarter: "🏠 Sample query · options for a small apartment",
      prompt: "Options for a small apartment",
    },
  };

  const drawer = document.querySelector(".drawer");
  const backdrop = document.querySelector(".backdrop");
  const conversation = document.querySelector("[data-conversation]");
  const inspector = document.querySelector("[data-inspector]");
  const inspectorRequest = document.querySelector("[data-inspector-request]");
  const inspectorResponse = document.querySelector("[data-inspector-response]");
  const inspectorStatus = document.querySelector("[data-inspector-status]");
  const form = document.querySelector(".composer");
  const input = document.querySelector("#message");
  const sendButton = form.querySelector("button[type='submit'], button:not([type])");
  let selectedScenario = "catalog_match";
  let runtimeMode = "unknown";
  let lastFocus = null;

  function makeElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function safeText(value, fallback = "", maximum = 240) {
    return typeof value === "string" ? value.slice(0, maximum) : fallback;
  }

  function safeScenario(value) {
    return Object.hasOwn(scenarios, value) ? value : selectedScenario;
  }

  function sanitizeResponse(payload, httpStatus) {
    const source = payload && typeof payload === "object" ? payload : {};
    const boundaries = source.boundaries && typeof source.boundaries === "object" ? source.boundaries : {};
    return {
      ...sanitizeOptionalInspectorFields(source, httpStatus, Object.keys(scenarios)),
      mode: safeText(source.mode, "unknown", 40),
      data_source: safeText(source.data_source, "unknown", 80),
      live_agent_core: source.live_agent_core === true,
      reply: safeText(source.reply, "", 600),
      results: Array.isArray(source.results) ? source.results.slice(0, 8).map((item) => ({
        title: safeText(item?.title, "Untitled illustrative card", 120),
        price: formatIllustrativePrice(item),
        tag: safeText(item?.tag, "Synthetic fixture", 80),
        emoji: safeText(item?.emoji, "📦", 8),
        match_status: safeText(item?.match_status, "illustrative_only", 40),
        synthetic: item?.synthetic === true,
        illustrative: item?.illustrative === true || item?.match_status === "illustrative_only",
        purchasable: item?.purchasable === true,
        available: item?.available === true,
        shipping_rates: item?.shipping_rates === true,
      })) : [],
      trace: Array.isArray(source.trace) ? source.trace.slice(0, 8).map((step) => ({
        label: safeText(step?.label, "Contract step", 80),
        state: safeText(step?.state, "unknown", 24),
      })) : [],
      boundaries: {
        synthetic: source.synthetic === true || boundaries.synthetic === true,
        illustrative: source.illustrative === true || boundaries.illustrative === true,
        purchasable: source.purchasable === true || boundaries.purchasable === true,
        commerce_writes: source.commerce_writes === true || boundaries.commerce_writes === true,
        shipping_rates: source.shipping_rates === true || boundaries.shipping_rates === true,
      },
    };
  }

  function setInspector(requestBody, responseBody, status) {
    inspectorRequest.textContent = JSON.stringify(requestBody, null, 2);
    inspectorResponse.textContent = JSON.stringify(responseBody, null, 2);
    inspectorStatus.textContent = status;
    inspector.open = true;
  }

  function setScenario(name) {
    selectedScenario = safeScenario(name);
    document.querySelectorAll("[data-open-scenario]").forEach((button) => {
      const selected = button.dataset.openScenario === selectedScenario;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-scenario-label]").forEach((label) => {
      label.textContent = runtimeMode === "connected_local_sandbox"
        ? "Sample query"
        : scenarios[selectedScenario].label;
    });
  }

  function updateQueryModeCopy(connected) {
    document.querySelector("[data-query-mode-title]").textContent = connected ? "Sample queries" : "Scenario lab";
    document.querySelector("[data-query-mode-copy]").textContent = connected
      ? "The returned contract decides the journey"
      : "Pick a bounded contract state";
    document.querySelector("[data-query-intro-title]").textContent = connected
      ? "Try a sample query"
      : "Run a known contract state";
    document.querySelector("[data-query-intro-copy]").textContent = connected
      ? "Agent Core returns the actual contract state; no query triggers a purchase or sourcing task."
      : "These prompts select behavior; they do not trigger a purchase or sourcing task.";
    document.querySelector("[data-query-kind]").textContent = connected ? "Query" : "Scenario";
    document.querySelectorAll("[data-open-scenario]").forEach((button) => {
      button.textContent = connected
        ? scenarios[button.dataset.openScenario].queryButton
        : scenarios[button.dataset.openScenario].labButton;
    });
    document.querySelectorAll("[data-starter]").forEach((button) => {
      button.textContent = connected
        ? scenarios[button.dataset.scenario].queryStarter
        : scenarios[button.dataset.scenario].labStarter;
    });
    if (inspectorStatus.textContent.startsWith("Waiting for")) {
      inspectorStatus.textContent = connected ? "Waiting for a sample query" : "Waiting for a scenario";
      inspectorRequest.textContent = JSON.stringify(connected
        ? { messages: [] }
        : { messages: [], scenario: selectedScenario }, null, 2);
    }
    setScenario(selectedScenario);
  }

  function open(brief = "") {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.querySelectorAll("[data-open-agent]").forEach((button) => button.setAttribute("aria-expanded", "true"));
    if (brief) input.value = brief;
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    document.documentElement.style.overflow = "";
    document.querySelectorAll("[data-open-agent]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  }

  function insertBeforeInspector(element) {
    conversation.insertBefore(element, inspector);
  }

  function renderTrace(container, steps) {
    container.replaceChildren();
    steps.forEach((step) => {
      container.append(makeElement("span", step.state === "complete" ? "is-complete" : "", step.label));
    });
  }

  function renderResults(container, results, status) {
    if (!results.length) {
      const empty = makeElement("div", "result-empty");
      const emptyTitles = {
        no_match: "🔎 Terminal catalog miss",
        needs_clarification: "💬 More detail is required",
        degraded: "🛟 Service state is degraded",
        error: "🛟 Request stopped safely",
        sandbox_not_ready: "🛟 Connected sandbox is not ready",
      };
      empty.append(
        makeElement("strong", "", emptyTitles[status] || "No illustrative cards returned"),
        makeElement("span", "", "No sourcing task, cart, order, payment, or shipping request was started."),
      );
      container.append(empty);
      return;
    }

    const row = makeElement("div", "result-row");
    results.forEach((product) => {
      const card = makeElement("article", "result");
      card.append(
        makeElement("small", "", "🧬 SYNTHETIC · ILLUSTRATIVE"),
        makeElement("b", "", `${product.emoji} ${product.title}`),
        makeElement("span", "", product.tag),
        makeElement("strong", "", product.price),
      );
      const flags = makeElement("div", "result-flags");
      flags.append(
        makeElement("em", "", "NOT PURCHASABLE"),
        makeElement("em", "", "NO SHIPPING RATE"),
        makeElement("em", "", "NO WRITE"),
      );
      card.append(flags);
      row.append(card);
    });
    container.append(row);
  }

  function applyRuntimeStatus(payload) {
    const presentation = runtimePresentation(payload);
    const { mode, connected, verified } = presentation;
    runtimeMode = presentation.mode;
    const banner = document.querySelector(".runtime-banner");
    banner.dataset.mode = presentation.bannerMode;
    document.querySelector("[data-runtime-label]").textContent = presentation.runtimeLabel;
    document.querySelector("[data-drawer-mode]").textContent = presentation.drawerLabel;
    document.querySelector("[data-core-status]").textContent = presentation.coreLabel;
    updateQueryModeCopy(connected);
    document.querySelectorAll("[data-mode-option]").forEach((option) => {
      const active = option.dataset.modeOption === mode;
      option.classList.toggle("is-active", active);
      option.classList.toggle("is-unavailable", active && connected && !verified);
      if (active) option.setAttribute("aria-current", "true");
      else option.removeAttribute("aria-current");
    });
  }

  async function loadRuntimeStatus() {
    try {
      const response = await fetch("/api/status", { headers: { accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error("status_unavailable");
      applyRuntimeStatus(payload);
    } catch {
      document.querySelector("[data-runtime-label]").textContent = "Local runtime status unavailable";
      document.querySelector("[data-drawer-mode]").textContent = "LOCAL SERVICE UNAVAILABLE";
      document.querySelector("[data-core-status]").textContent = "Unavailable";
    }
  }

  document.querySelectorAll("[data-open-agent]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => open());
  });
  document.querySelectorAll("[data-close-agent]").forEach((button) => button.addEventListener("click", close));
  document.querySelectorAll("[data-open-scenario]").forEach((button) => button.addEventListener("click", () => {
    setScenario(button.dataset.openScenario);
    open(scenarios[selectedScenario].prompt);
  }));
  document.querySelectorAll("[data-starter]").forEach((button) => button.addEventListener("click", () => {
    setScenario(button.dataset.scenario);
    input.value = scenarios[selectedScenario].prompt;
    form.requestSubmit();
  }));
  document.querySelector("[data-catalog-search]").addEventListener("submit", (event) => {
    event.preventDefault();
    setScenario("catalog_match");
    open(event.currentTarget.querySelector("input").value.trim() || scenarios.catalog_match.prompt);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) close();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim().slice(0, 120);
    if (!message || sendButton.disabled) return;
    input.value = "";
    conversation.querySelector(".welcome")?.remove();

    const requestBody = { messages: [{ role: "user", content: message }] };
    if (runtimeMode === "synthetic_demo") requestBody.scenario = selectedScenario;
    setInspector(requestBody, { status: "waiting_for_browser_safe_response" }, "Request sent · sanitized view");

    const user = makeElement("article", "turn user", message);
    insertBeforeInspector(user);
    const pending = makeElement("article", "turn agent");
    pending.setAttribute("aria-busy", "true");
    pending.append(
      makeElement("small", "", "SEND FROM CHINA · SANDBOX"),
      makeElement("p", "", "Applying the demo boundary…"),
    );
    const trace = makeElement("div", "trace");
    trace.append(
      makeElement("span", "is-active", "Request"),
      makeElement("span", "", "Policy"),
      makeElement("span", "", "Result"),
    );
    pending.append(trace);
    insertBeforeInspector(pending);
    conversation.scrollTop = conversation.scrollHeight;
    sendButton.disabled = true;

    let failureStatus = "error";
    let failureError = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json();
      const safePayload = sanitizeResponse(payload, response.status);
      setInspector(requestBody, safePayload, "Allowlisted fields only");
      if (!response.ok) {
        failureError = safePayload.error;
        failureStatus = safePayload.error || safePayload.status || "error";
        throw new Error(failureStatus);
      }

      pending.querySelector("p").textContent = safePayload.reply || "The sandbox returned a browser-safe contract state.";
      renderTrace(trace, safePayload.trace);
      renderResults(pending, safePayload.results, safePayload.status);
    } catch {
      pending.querySelector("p").textContent = failureError
        ? `The sandbox stopped safely (${failureError}). No fallback result was invented and no external action was attempted.`
        : "The local demo service is unavailable. No fallback result was invented and no external action was attempted.";
      renderTrace(trace, [
        { label: "Request received", state: "complete" },
        { label: "Safe failure shown", state: "complete" },
      ]);
      renderResults(pending, [], failureStatus);
      if (inspectorStatus.textContent !== "Allowlisted fields only") {
        setInspector(requestBody, {
          status: "local_service_unavailable",
          illustrative: true,
          purchasable: false,
          shipping_rates: false,
          commerce_writes: false,
        }, "Safe failure · no raw payload");
      }
    } finally {
      pending.setAttribute("aria-busy", "false");
      sendButton.disabled = false;
      conversation.scrollTop = conversation.scrollHeight;
    }
  });

  drawer.setAttribute("aria-hidden", "true");
  setScenario(selectedScenario);
  loadRuntimeStatus();
})();
