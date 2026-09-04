(() => {
  const root = document.querySelector("[data-product-discovery-home]");
  const catalogCards = [...(root?.querySelectorAll(".sfc-product") || [])];
  let readableCards = 0;
  catalogCards.forEach((card) => {
    const hasCustomerVisibleCjk = /[\u3400-\u9fff]/u.test(card.textContent || "");
    if (hasCustomerVisibleCjk || readableCards >= 8) {
      card.remove();
      return;
    }
    readableCards += 1;
  });

  const finder = root?.querySelector("[data-home-finder]");
  if (!finder) return;

  const modeButtons = [...finder.querySelectorAll("[data-finder-mode]")];
  const form = finder.querySelector("[data-finder-form]");
  const input = finder.querySelector("[data-finder-input]");
  const label = finder.querySelector("[data-finder-label]");
  const submit = finder.querySelector("[data-finder-submit]");
  const note = finder.querySelector("[data-finder-note]");
  if (!modeButtons.length || !form || !input || !label || !submit || !note) return;

  let mode = "search";
  const copy = {
    search: {
      label: "What are you looking for?",
      placeholder: "Product, material, category, or use case",
      button: "Search",
      note: "Browse the closest catalog matches. Search is free and does not use sourcing credits.",
    },
    agent: {
      label: "Describe the outcome you need",
      placeholder: "Use case, budget, preferences, and destination if known",
      button: "Ask Agent",
      note: "The Agent is free to use. Sign in is required to save the brief, conversation, and results.",
    },
  };

  const setMode = (nextMode, focus = false) => {
    mode = nextMode === "agent" ? "agent" : "search";
    modeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.finderMode === mode));
    });
    label.textContent = copy[mode].label;
    input.placeholder = copy[mode].placeholder;
    input.setAttribute("aria-label", copy[mode].label);
    submit.textContent = copy[mode].button;
    note.textContent = copy[mode].note;
    if (focus) input.focus();
  };

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.finderMode, true));
  });

  form.addEventListener("submit", (event) => {
    if (mode !== "agent") return;
    event.preventDefault();
    const brief = input.value.trim();
    if (!brief) {
      input.focus();
      return;
    }

    window.dispatchEvent(new CustomEvent("wp:open-agent", {
      detail: { brief, autoSend: true },
    }));
  });

  if (window.WPShopifyRuntime) {
    copy.agent.note = "Check the Shopify connection to search. Custom sourcing is unavailable in read-only mode.";
    window.addEventListener("wp:runtime-status", (event) => {
      copy.agent.button = event.detail.ready ? "Ask Agent" : "Agent unavailable";
      if (mode === "agent") submit.textContent = copy.agent.button;
      copy.agent.note = event.detail.message + " Custom sourcing is unavailable in read-only mode.";
      if (mode === "agent") note.textContent = copy.agent.note;
    });
  }
  setMode("search");
})();
