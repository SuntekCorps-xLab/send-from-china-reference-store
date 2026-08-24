(function () {
  "use strict";

  var root = document.querySelector("[data-wp-workspace]");
  if (!root || root.dataset.customerLoggedIn !== "true") return;

  var apiBase = String(root.dataset.apiBase || "/apps/wp-account").replace(/\/$/, "");
  var pollInterval = Math.min(60000, Math.max(10000, Number(root.dataset.pollInterval || 15000)));
  var defaultComposerPlaceholder = "Describe the product, recipient, budget, destination, or use case";
  var handoff = readHandoff();
  var state = {
    summary: null,
    conversations: [],
    conversation: null,
    messages: [],
    conversationTasks: [],
    tasks: [],
    selectedTask: null,
    results: [],
    resultCursor: "",
    governanceJobs: [],
    agentKeys: [],
    agentKeysAvailable: true,
    agentToken: "",
    agentTokenKeyId: "",
    busy: false,
    chatBusy: false,
    dynamicIntake: null,
    polling: false,
    pollTicks: 0,
    autoStartingConversationId: "",
  };

  var nodes = {
    notice: root.querySelector("[data-workspace-notice]"),
    accountId: root.querySelector("[data-account-id]"),
    requestProgress: root.querySelector("[data-request-progress]"),
    requestStatus: root.querySelector("[data-request-status]"),
    saveState: root.querySelector("[data-save-state]"),
    brief: root.querySelector("[data-brief]"),
    guidance: root.querySelector("[data-guidance]"),
    guidanceCopy: root.querySelector("[data-guidance-copy]"),
    guidanceActions: root.querySelector("[data-guidance-actions]"),
    working: root.querySelector("[data-request-working]"),
    conversations: root.querySelector("[data-conversations]"),
    plans: root.querySelector("[data-credit-plans]"),
    deeperSearch: root.querySelector("[data-deeper-search]"),
    agentKeys: root.querySelector("[data-agent-keys]"),
    agentToken: root.querySelector("[data-agent-token]"),
    agentTokenValue: root.querySelector("[data-agent-token-value]"),
    createAgentKey: root.querySelector("[data-create-agent-key]"),
    copyAgentKey: root.querySelector("[data-copy-agent-key]"),
    conversationTitle: root.querySelector("[data-conversation-title]"),
    conversationSubtitle: root.querySelector("[data-conversation-subtitle]"),
    messages: root.querySelector("[data-messages]"),
    conciergeMessages: root.querySelector("[data-concierge-messages]"),
    conciergeState: root.querySelector("[data-concierge-state]"),
    form: root.querySelector("[data-chat-form]"),
    input: root.querySelector("[data-chat-input]"),
    send: root.querySelector("[data-chat-send]"),
    taskList: root.querySelector("[data-task-list]"),
    results: root.querySelector("[data-results]"),
    resultsSection: root.querySelector("[data-results-section]"),
    resultsSummary: root.querySelector("[data-results-summary]"),
    newConversation: root.querySelector("[data-new-conversation]"),
    editRequirements: root.querySelector("[data-edit-requirements]"),
    dynamicIntakeHost: root.querySelector("[data-dynamic-intake-host]"),
    structuredSections: root.querySelectorAll("[data-request-structured]"),
    requestDrawer: root.querySelector("[data-request-list-drawer]"),
    accountDrawer: root.querySelector("[data-account-drawer]"),
    requirementsDrawer: root.querySelector("[data-requirements-drawer]"),
    drawerBackdrop: root.querySelector("[data-drawer-backdrop]"),
  };

  if (nodes.form) nodes.form.addEventListener("submit", function (event) {
    event.preventDefault();
    submitComposer();
  });
  if (nodes.input) nodes.input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
    }
  });
  if (nodes.input) nodes.input.addEventListener("input", resizeComposer);
  if (nodes.newConversation) nodes.newConversation.addEventListener("click", function () {
    startConversation();
    closeDrawers();
    var concierge = root.querySelector("[data-concierge-stage]");
    if (concierge) concierge.scrollIntoView({ behavior: "smooth", block: "start" });
    if (nodes.input) window.setTimeout(function () { nodes.input.focus(); }, 250);
  });
  if (nodes.editRequirements) nodes.editRequirements.addEventListener("click", function () {
    closeDrawers();
    var concierge = root.querySelector("[data-concierge-stage]");
    if (concierge) concierge.scrollIntoView({ behavior: "smooth", block: "start" });
    if (nodes.input) window.setTimeout(function () { nodes.input.focus(); }, 250);
  });
  root.querySelectorAll("[data-open-request-list]").forEach(function (button) {
    button.addEventListener("click", function () { openDrawer(nodes.requestDrawer); });
  });
  root.querySelectorAll("[data-open-account]").forEach(function (button) {
    button.addEventListener("click", function () { openDrawer(nodes.accountDrawer); });
  });
  root.querySelectorAll("[data-close-drawer]").forEach(function (button) {
    button.addEventListener("click", closeDrawers);
  });
  if (nodes.drawerBackdrop) nodes.drawerBackdrop.addEventListener("click", closeDrawers);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeDrawers();
  });
  if (nodes.createAgentKey) nodes.createAgentKey.addEventListener("click", createAgentKey);
  if (nodes.copyAgentKey) nodes.copyAgentKey.addEventListener("click", copyAgentKey);

  initialize();

  async function initialize() {
    setBusy(true);
    clearNotice();
    try {
      var pages = await Promise.all([
        api("/summary"),
        api("/conversations?limit=30"),
        api("/tasks?limit=20"),
        api("/agent-keys").catch(function () { return { keys: [], unavailable: true }; }),
      ]);
      state.summary = pages[0];
      state.conversations = pages[1].conversations || [];
      state.tasks = pages[2].tasks || [];
      state.agentKeys = pages[3].keys || [];
      state.agentKeysAvailable = pages[3].unavailable !== true;
      renderOverview();
      if (handoff.brief) {
        startConversation(handoff.brief);
        showNotice(handoff.plan
          ? "Your shopping brief is ready. Send it to save this conversation; our concierge will confirm the brief before searching."
          : "Your shopping brief is ready. Send it to save this conversation and start with the free catalog search.", "success");
      } else if (state.conversations.length) {
        await openConversation(state.conversations[0].id);
      } else {
        startConversation();
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
      startPolling();
    }
  }

  async function refreshOverview() {
    var pages = await Promise.all([
      api("/summary"),
      api("/conversations?limit=30"),
      api("/tasks?limit=20"),
    ]);
    state.summary = pages[0];
    state.conversations = pages[1].conversations || [];
    state.tasks = pages[2].tasks || [];
    renderOverview();
  }

  function openDrawer(drawer) {
    if (!drawer) return;
    closeDrawers();
    drawer.hidden = false;
    if (nodes.drawerBackdrop) nodes.drawerBackdrop.hidden = false;
    document.documentElement.classList.add("wp-request-drawer-open");
    var focusTarget = drawer.querySelector("textarea, input, button, a");
    if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 0);
  }

  function closeDrawers() {
    [nodes.requestDrawer, nodes.accountDrawer, nodes.requirementsDrawer].forEach(function (drawer) {
      if (drawer) drawer.hidden = true;
    });
    if (nodes.drawerBackdrop) nodes.drawerBackdrop.hidden = true;
    document.documentElement.classList.remove("wp-request-drawer-open");
  }

  function renderOverview() {
    var summary = state.summary || {};
    var accountId = summary.account && summary.account.customer_id;
    if (nodes.accountId) nodes.accountId.textContent = accountId ? "Customer ID " + compactId(accountId) : "Shopify account connected";
    renderRequestProgress();
    renderConversations();
    renderCreditPlans();
    renderAgentKeys();
    renderTaskList();
    renderSaveState();
  }

  function renderConversations() {
    if (!nodes.conversations) return;
    nodes.conversations.replaceChildren();
    if (!state.conversations.length) {
      nodes.conversations.appendChild(emptyText("Your first message creates a private saved conversation."));
      return;
    }
    state.conversations.forEach(function (item) {
      var button = element("button", {
        className: "wp-conversation-link" + (state.conversation && state.conversation.id === item.id ? " is-active" : ""),
        type: "button",
      });
      button.appendChild(element("strong", { text: item.title || "Product search" }));
      button.appendChild(element("span", { text: formatDate(item.updated_at) }));
      button.addEventListener("click", function () { openConversation(item.id); });
      nodes.conversations.appendChild(button);
    });
  }

  function renderRequestProgress() {
    if (!nodes.requestProgress) return;
    nodes.requestProgress.replaceChildren();
    var task = selectedRequestTask();
    var availableResults = requestResults();
    var progress = !task && availableResults.length
      ? requestStageInfo("RESULTS_READY")
      : requestStageInfo(task && task.status);
    var labels = ["Brief received", "Searching and preparing", "Products ready"];
    var currentIndex = progress.index >= 3 ? 2 : progress.index;
    var list = element("ol", { className: "wp-request-progress-steps" });
    labels.forEach(function (label, index) {
      var item = element("li", {
        className: index < currentIndex ? "is-complete" : index === currentIndex ? "is-current" : "",
      });
      item.appendChild(element("span", {
        className: "wp-request-progress-marker",
        text: index < currentIndex ? "" : String(index + 1),
        ariaLabel: index < currentIndex ? "Complete" : "Step " + String(index + 1),
      }));
      var copy = element("div");
      copy.appendChild(element("strong", { text: label }));
      if (index === currentIndex) copy.appendChild(element("small", { text: progress.detail }));
      item.appendChild(copy);
      list.appendChild(item);
    });
    nodes.requestProgress.appendChild(list);
    if (nodes.requestStatus) {
      nodes.requestStatus.textContent = task ? progress.label : state.conversation ? "Brief saved" : "Draft";
      nodes.requestStatus.className = "wp-request-status-badge" + (progress.isError ? " is-error" : "");
    }
  }

  function selectedRequestTask() {
    if (state.selectedTask) return state.selectedTask;
    var conversationTasks = Array.isArray(state.conversationTasks) ? state.conversationTasks : [];
    if (conversationTasks.length) return conversationTasks.slice().sort(byNewest)[0];
    return null;
  }

  function byNewest(left, right) {
    return new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0);
  }

  function requestStageInfo(status) {
    var value = String(status || "QUEUED").toUpperCase();
    var stages = {
      QUEUED: { index: 0, label: "Brief received", detail: "Your requirements are saved.", isActive: true },
      SOURCING: { index: 1, label: "Finding candidates", detail: "Candidate search in progress", isActive: true },
      REVIEW_REQUIRED: { index: 1, label: "Reviewing candidates", detail: "Candidate review in progress", isActive: true },
      GOVERNING: { index: 2, label: "Preparing products", detail: "Product details are being prepared", isActive: true },
      SHOPIFY_DRAFT: { index: 2, label: "Preparing products", detail: "The product page is being prepared", isActive: true },
      RESULTS_READY: { index: 3, label: "Results ready", detail: "Prepared products are shown in this conversation", isActive: false },
      WP_RESULT_READY: { index: 3, label: "Results ready", detail: "Prepared products are shown in this conversation", isActive: false },
      COMPLETED: { index: 3, label: "Delivered", detail: "Results returned to your conversation", isActive: false },
      MESSAGE_DELIVERED: { index: 3, label: "Delivered", detail: "Results returned to your conversation", isActive: false },
      PARTIAL_SUCCESS: { index: 3, label: "Partial results ready", detail: "Available results returned; some items need review", isActive: false },
      NO_MATCH: { index: 3, label: "No match yet", detail: "Adjust the brief or try another request", isActive: false, isError: true },
      FAILED: { index: 2, label: "Needs attention", detail: "This request could not be completed", isActive: false, isError: true },
      FAILED_RETRYABLE: { index: 2, label: "Retrying preparation", detail: "A temporary issue is being retried", isActive: true },
      FAILED_FINAL: { index: 2, label: "Needs attention", detail: "This request could not be completed", isActive: false, isError: true },
      UNKNOWN_OUTCOME: { index: 2, label: "Confirming progress", detail: "The request is being reconciled before any retry", isActive: true },
      CANCELLED: { index: 0, label: "Cancelled", detail: "This request was cancelled", isActive: false, isError: true },
    };
    return stages[value] || { index: 1, label: taskStatusLabel(value), detail: "The request is moving through sourcing.", isActive: true };
  }

  function renderCreditPlans() {
    if (!nodes.plans) return;
    nodes.plans.replaceChildren();
    var payment = state.summary && state.summary.payment || {};
    var products = payment.products || [];
    var available = Math.max(0, Number(state.summary && state.summary.credits && state.summary.credits.available || 0));
    var creditSummary = element("div", { className: "wp-credit-summary" });
    creditSummary.appendChild(element("span", { text: "Available balance" }));
    creditSummary.appendChild(element("strong", { text: String(available) + (available === 1 ? " sourcing credit" : " sourcing credits") }));
    nodes.plans.appendChild(creditSummary);
    var task = selectedRequestTask();
    var candidateCount = Math.max(0, Number(task && task.result_count || 0));
    var selectedCount = Math.max(0, Number(task && task.selected_result_count || 0));
    var preparedCount = Math.max(0, Number(task && task.prepared_result_count || task && task.published_count || 0));
    var remainingCount = Math.max(0, Number(task && task.remaining_result_count !== undefined
      ? task.remaining_result_count
      : candidateCount - Number(task && task.human_result_limit || 3)));
    var creditsPerProduct = Math.max(1, Number(task && task.result_preparation_credits_per_product
      || task && task.full_results_unlock_credits || 1));
    if (task && candidateCount > 0) {
      nodes.plans.appendChild(element("p", {
        className: "wp-credit-pool-summary",
        text: String(candidateCount) + " verified matches · "
          + String(selectedCount) + " selected · "
          + String(preparedCount) + " ready · "
          + String(remainingCount) + " available to prepare",
      }));
    }
    var unlockable = Boolean(task
      && remainingCount > 0
      && creditsPerProduct > 0);
    if (unlockable) {
      var affordableCount = Math.floor(available / creditsPerProduct);
      var initialQuantity = Math.max(1, Math.min(remainingCount, affordableCount || 1, 10));
      var unlock = element("div", { className: "wp-credit-unlock" });
      var unlockCopy = element("span", { className: "wp-credit-plan-copy" });
      unlockCopy.appendChild(element("strong", { text: "Prepare more products" }));
      unlockCopy.appendChild(element("small", {
        text: String(creditsPerProduct) + (creditsPerProduct === 1 ? " credit" : " credits")
          + " per product · private image cleanup, translation, and a buyable WP card",
      }));
      var unlockControls = element("div", { className: "wp-credit-unlock-controls" });
      var quantityLabel = element("label", { className: "wp-credit-quantity" });
      quantityLabel.appendChild(element("span", { text: "Quantity" }));
      var quantityInput = element("input", {
        type: "number",
        min: 1,
        max: remainingCount,
        step: 1,
        value: initialQuantity,
        ariaLabel: "Number of additional products to prepare",
      });
      quantityLabel.appendChild(quantityInput);
      var unlockButton = element("button", {
        className: "wp-credit-unlock-button",
        type: "button",
        ariaLabel: "Prepare selected WP product previews",
      });
      function selectedQuantity() {
        var value = Math.floor(Number(quantityInput.value || 1));
        return Math.max(1, Math.min(remainingCount, Number.isFinite(value) ? value : 1));
      }
      function updateUnlockAction() {
        var quantity = selectedQuantity();
        var totalCredits = quantity * creditsPerProduct;
        unlockButton.disabled = state.busy || available < totalCredits;
        unlockButton.textContent = available >= totalCredits
          ? "Prepare " + String(quantity) + " · " + String(totalCredits) + (totalCredits === 1 ? " credit" : " credits")
          : "Need " + String(totalCredits) + " credits";
      }
      quantityInput.addEventListener("input", updateUnlockAction);
      quantityInput.addEventListener("change", function () {
        quantityInput.value = String(selectedQuantity());
        updateUnlockAction();
      });
      unlockButton.addEventListener("click", function () { unlockFullResults(selectedQuantity()); });
      updateUnlockAction();
      unlock.appendChild(unlockCopy);
      unlockControls.appendChild(quantityLabel);
      unlockControls.appendChild(unlockButton);
      unlock.appendChild(unlockControls);
      nodes.plans.appendChild(unlock);
    }
    if (!payment.enabled || !products.length) {
      if (!unlockable || available < creditsPerProduct) {
        nodes.plans.appendChild(emptyText("Credit checkout is not available right now. Your private candidate pool remains saved."));
      }
      return;
    }
    products.forEach(function (product) {
      if (!safeHttps(product.checkout_url)) return;
      var link = element("a", {
        className: "wp-credit-plan",
        href: product.checkout_url,
        "aria-label": "Buy " + String(Number(product.credits || 0)) + " search credits",
      });
      var planCopy = element("span", { className: "wp-credit-plan-copy" });
      planCopy.appendChild(element("strong", { text: product.title || product.plan_id || "Search credits" }));
      planCopy.appendChild(element("small", { text: "Secure Shopify checkout" }));
      var planAction = element("span", { className: "wp-credit-plan-action" });
      planAction.appendChild(element("b", { text: String(Number(product.credits || 0)) + " credits" }));
      planAction.appendChild(element("small", { text: "Buy credits \u2192" }));
      link.appendChild(planCopy);
      link.appendChild(planAction);
      nodes.plans.appendChild(link);
    });
  }

  function renderSaveState() {
    if (!nodes.saveState) return;
    nodes.saveState.textContent = state.chatBusy ? "Saving..." : state.conversation ? "Saved" : "Not saved";
  }

  function renderAgentKeys() {
    if (!nodes.agentKeys) return;
    nodes.agentKeys.replaceChildren();
    if (nodes.createAgentKey) nodes.createAgentKey.disabled = state.busy || !state.agentKeysAvailable;
    if (!state.agentKeysAvailable) {
      nodes.agentKeys.appendChild(emptyText("Agent access is temporarily unavailable. Your conversations and requests are unaffected."));
      return;
    }
    var active = state.agentKeys.filter(function (key) { return !key.revoked_at; });
    if (!active.length) {
      nodes.agentKeys.appendChild(emptyText("No Agent keys yet."));
      return;
    }
    active.forEach(function (key) {
      var row = element("div", { className: "wp-agent-key" });
      var identity = element("div", { className: "wp-agent-key-identity" });
      identity.appendChild(element("strong", { text: key.label || "My Agent" }));
      identity.appendChild(element("code", { text: key.prefix || "Agent key" }));
      row.appendChild(identity);
      var revoke = element("button", { type: "button", text: "Revoke" });
      revoke.addEventListener("click", function () { revokeAgentKey(key.id); });
      row.appendChild(revoke);
      nodes.agentKeys.appendChild(row);
    });
  }

  async function createAgentKey() {
    if (state.busy) return;
    setBusy(true);
    clearNotice();
    try {
      var response = await api("/agent-keys", {
        method: "POST",
        body: JSON.stringify({ label: "My Agent" }),
      });
      state.agentToken = String(response.token || "");
      state.agentTokenKeyId = response.key && response.key.id || "";
      if (!response.key || !state.agentToken) throw new Error("WP Agent access could not be created.");
      state.agentKeysAvailable = true;
      state.agentKeys = [response.key].concat(state.agentKeys.filter(function (key) { return key.id !== response.key.id; }));
      renderAgentKeys();
      if (nodes.agentToken && nodes.agentTokenValue && state.agentToken) {
        nodes.agentTokenValue.textContent = state.agentToken;
        nodes.agentToken.hidden = false;
      }
      showNotice("Agent access created. Copy the key now; only its prefix will be kept on this page.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function copyAgentKey() {
    if (!state.agentToken) return;
    try {
      await navigator.clipboard.writeText(state.agentToken);
      showNotice("Agent key copied. Store it in the Agent's secret manager.", "success");
    } catch (_error) {
      showNotice("Select and copy the Agent key shown above. It will not be shown again after this page closes.");
    }
  }

  async function revokeAgentKey(keyId) {
    if (!keyId || state.busy) return;
    setBusy(true);
    clearNotice();
    try {
      await api("/agent-keys/" + encodeURIComponent(keyId), { method: "DELETE" });
      state.agentKeys = state.agentKeys.map(function (key) {
        return key.id === keyId ? Object.assign({}, key, { revoked_at: new Date().toISOString() }) : key;
      });
      if (state.agentTokenKeyId === keyId) {
        state.agentToken = "";
        state.agentTokenKeyId = "";
        if (nodes.agentTokenValue) nodes.agentTokenValue.textContent = "";
        if (nodes.agentToken) nodes.agentToken.hidden = true;
      }
      renderAgentKeys();
      showNotice("Agent access revoked.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function startConversation(prefill) {
    leaveDynamicIntake(false);
    state.conversation = null;
    state.messages = [];
    state.conversationTasks = [];
    state.selectedTask = null;
    state.results = [];
    state.governanceJobs = [];
    if (nodes.input) nodes.input.value = typeof prefill === "string" ? prefill : "";
    clearNotice();
    renderConversations();
    renderConversation();
    if (nodes.input && nodes.input.value) nodes.input.setSelectionRange(nodes.input.value.length, nodes.input.value.length);
  }

  async function openConversation(id) {
    if (!id) return;
    leaveDynamicIntake(false);
    setBusy(true);
    clearNotice();
    try {
      var page = await api("/conversations/" + encodeURIComponent(id));
      state.conversation = page.conversation || null;
      state.messages = page.messages || [];
      state.conversationTasks = page.tasks || [];
      state.selectedTask = state.conversationTasks.length ? state.conversationTasks.slice().sort(byNewest)[0] : null;
      state.results = [];
      state.governanceJobs = [];
      if (state.selectedTask) {
        var taskPages = await Promise.all([
          api("/tasks/" + encodeURIComponent(state.selectedTask.id) + "/results?limit=20"),
          api("/tasks/" + encodeURIComponent(state.selectedTask.id) + "/governance?limit=20"),
        ]).catch(function () { return null; });
        if (taskPages) {
          state.selectedTask = taskPages[0].task || state.selectedTask;
          state.results = taskPages[0].results || [];
          state.resultCursor = taskPages[0].next_cursor || "";
          state.governanceJobs = taskPages[1].jobs || [];
        }
      }
      renderConversations();
      renderConversation();
      scheduleAutomaticSourcing();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function renderConversation() {
    if (nodes.conversationTitle) nodes.conversationTitle.textContent = state.conversation ? state.conversation.title : "New product request";
    if (nodes.conversationSubtitle) nodes.conversationSubtitle.textContent = state.conversation
      ? "Review the brief, progress, and prepared products in one place."
      : "Describe the product or problem to solve. We will turn it into a clear sourcing brief.";
    nodes.structuredSections.forEach(function (section) {
      section.hidden = !state.conversation;
    });
    renderBrief();
    renderConcierge();
    renderGuidance();
    renderActivity();
    renderDynamicIntake();
    renderRequestProgress();
    renderSaveState();
    renderResults();
  }

  function renderConcierge() {
    if (!nodes.conciergeMessages) return;
    nodes.conciergeMessages.replaceChildren();
    var messages = customerVisibleMessages(state.messages);
    if (!messages.length) {
      nodes.conciergeMessages.appendChild(messageCard({
        role: "assistant",
        content: "Hi, I am your product concierge. Tell me what you need and I will ask only the useful follow-up questions before searching.",
        payload: {
          language: "en",
          next_actions: [
            { label: "Find a product under $30", message: "I need a product under $30" },
            { label: "Source a gift", message: "Help me source a gift" },
            { label: "Find something not in the catalog", message: "I need something that may not be in the catalog" }
          ]
        }
      }, true));
    } else {
      messages.forEach(function (message, index) {
        nodes.conciergeMessages.appendChild(messageCard(message, index === messages.length - 1 && message.role !== "user"));
      });
    }
    var fallbackResults = conversationTaskResults(messages);
    if (fallbackResults.length) {
      nodes.conciergeMessages.appendChild(messageCard({
        role: "assistant",
        content: fallbackResults.length === 3
          ? "Three prepared products are ready for your brief."
          : String(fallbackResults.length) + " prepared product" + (fallbackResults.length === 1 ? " is" : "s are") + " ready for your brief.",
        payload: { results: fallbackResults },
      }, false));
    }
    if (state.chatBusy) nodes.conciergeMessages.appendChild(typingCard(latestUserMessage() && latestUserMessage().content || ""));
    if (nodes.conciergeState) nodes.conciergeState.textContent = state.chatBusy ? "Replying" : state.selectedTask ? "Brief confirmed" : "Listening";
    window.requestAnimationFrame(function () { nodes.conciergeMessages.scrollTop = nodes.conciergeMessages.scrollHeight; });
  }

  function renderBrief() {
    if (!nodes.brief) return;
    nodes.brief.replaceChildren();
    var criteria = state.conversation && state.conversation.criteria || {};
    var latest = latestUserMessage();
    var budget = criteria.price_max;
    if (budget == null) budget = criteria.budget_max_usd;
    if (budget == null) budget = criteria.max_price;
    var facts = [
      ["Request", criteria.use_case || criteria.category || latest && latest.content || "Not specified yet"],
      ["Budget", budget != null ? "Up to $" + String(budget) : "Open"],
      ["Destination", criteria.ship_to || "Not specified"],
      ["Quantity", criteria.quantity ? String(criteria.quantity) : "Not specified"],
      ["Requirements", briefRequirements(criteria)],
    ];
    facts.forEach(function (fact) {
      var row = element("div");
      row.appendChild(element("dt", { text: fact[0] }));
      row.appendChild(element("dd", { text: fact[1] }));
      nodes.brief.appendChild(row);
    });
  }

  function briefRequirements(criteria) {
    var values = [];
    if (Array.isArray(criteria.must_have)) values = values.concat(criteria.must_have);
    if (Array.isArray(criteria.keywords)) values = values.concat(criteria.keywords);
    return Array.from(new Set(values.filter(Boolean).map(String))).slice(0, 6).join(", ") || "No additional constraints";
  }

  function latestAssistantMessage() {
    var messages = customerVisibleMessages(state.messages);
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index] && messages[index].role !== "user") return messages[index];
    }
    return null;
  }

  function renderGuidance() {
    if (!nodes.guidance || !nodes.guidanceCopy || !nodes.guidanceActions) return;
    var message = latestAssistantMessage();
    var actions = message && message.payload && Array.isArray(message.payload.next_actions)
      ? message.payload.next_actions.slice(0, 3) : [];
    if (!message || (!message.content && !actions.length)) {
      nodes.guidance.hidden = true;
      return;
    }
    nodes.guidance.hidden = false;
    var resultCount = isGovernanceResultMessage(message)
      ? preparedResults(message.payload && message.payload.results).length : 0;
    nodes.guidanceCopy.textContent = resultCount
      ? "Prepared products are ready in this conversation. Open one or choose how to continue."
      : conciseStatus(message.content || "Choose the next step for this request.");
    nodes.guidanceActions.replaceChildren();
    actions.forEach(function (action) {
      var button = element("button", {
        type: "button",
        text: action.label || action.message || "Continue",
        disabled: state.chatBusy,
      });
      button.addEventListener("click", function () { handleNextAction(action, message.payload || {}); });
      nodes.guidanceActions.appendChild(button);
    });
  }

  function renderActivity() {
    if (!nodes.messages) return;
    nodes.messages.replaceChildren();
    var messages = customerVisibleMessages(state.messages);
    if (!messages.length) {
      nodes.messages.appendChild(emptyText("No activity yet."));
      return;
    }
    messages.forEach(function (message) {
      var row = element("div", { className: "wp-request-activity-row" });
      row.appendChild(element("strong", { text: message.role === "user" ? "Requirements updated" : "Sourcing update" }));
      row.appendChild(element("p", { text: plainText(message.content || "").replace(/\s+/g, " ").trim().slice(0, 280) }));
      if (message.created_at) row.appendChild(element("time", { text: formatDate(message.created_at) }));
      nodes.messages.appendChild(row);
    });
  }

  function renderDynamicIntake() {
    if (!nodes.dynamicIntakeHost) return;
    nodes.dynamicIntakeHost.replaceChildren();
    if (state.dynamicIntake && state.dynamicIntake.active) {
      nodes.dynamicIntakeHost.appendChild(dynamicIntakeCardV2(state.dynamicIntake));
    }
  }

  function messageCard(message, interactive) {
    var payload = message.payload || {};
    var language = messageLanguage(message, payload);
    var governanceResult = isGovernanceResultMessage(message);
    var catalogResults = governanceResult ? [] : preparedResults(payload.results);
    var wrapper = element("article", {
      className: "wp-message" + (message.role === "user" ? " is-user" : ""),
    });
    var identity = element("div", { className: "wp-message-identity" });
    identity.appendChild(element("div", {
      className: "wp-message-meta",
      text: message.role === "user" ? (language === "zh" ? "你" : "You") : "Send From China",
    }));
    wrapper.appendChild(identity);
    wrapper.appendChild(element("div", {
      className: "wp-message-body",
      text: catalogResults.length
        ? (state.selectedTask
          ? "Your brief is confirmed. Targeted sourcing is preparing three closely matched products."
          : "Your brief is confirmed. Targeted sourcing is starting now.")
        : message.content || "",
    }));
    var messageResults = governanceResult ? preparedResults(payload.results) : [];
    if (messageResults.length) {
      var grid = element("div", { className: "wp-result-grid" });
      messageResults.slice(0, 20).forEach(function (result) {
        var card = resultCard(result, false, language);
        if (card) grid.appendChild(card);
      });
      wrapper.appendChild(grid);
    }
    if (payload.preview) {
      var preview = previewCard(payload.preview);
      if (preview) wrapper.appendChild(preview);
    }
    if (interactive && (!state.selectedTask || governanceResult) && Array.isArray(payload.next_actions) && payload.next_actions.length) {
      wrapper.appendChild(nextActionPanel(payload));
    }
    return wrapper;
  }

  function nextActionPanel(payload) {
    var panel = element("div", { className: "wp-message-suggestions" });
    var language = String(payload.language || "").toLowerCase() === "zh" ? "zh" : "en";
    var choices = element("div", { className: "wp-message-suggestion-list" });
    choices.setAttribute("aria-label", language === "zh" ? "建议的下一步" : "Suggested next steps");
    payload.next_actions.slice(0, 3).forEach(function (action, actionIndex) {
      var button = element("button", {
        className: "wp-suggestion-button" + (actionIndex === 0 ? " is-primary" : "") + (action.operation === "dynamic_request" ? " is-dynamic" : ""),
        type: "button",
        text: action.label || action.message || "Continue",
        disabled: state.chatBusy,
      });
      button.addEventListener("click", function () { handleNextAction(action, payload); });
      choices.appendChild(button);
    });
    panel.appendChild(choices);
    panel.appendChild(element("p", {
      className: "wp-message-suggestions-hint",
      text: language === "zh" ? "也可以在下方直接输入你自己的想法。" : "Or type your own response below.",
    }));
    return panel;
  }

  function handleNextAction(action, payload) {
    var operation = String(action.operation || "chat");
    if (operation === "dynamic_request") {
      beginDynamicRequest(payload);
      return;
    }
    sendMessage({
      message: action.message || action.label || "Continue",
      operation: operation,
      criteria: payload.criteria || state.conversation && state.conversation.criteria || {},
      cursor: payload.next_cursor || null,
    });
  }

  function customerVisibleMessages(messages) {
    var deliveredJobs = new Set((messages || []).filter(function (message) {
      return message && message.kind === "GOVERNANCE_RESULT";
    }).map(function (message) {
      return String(message.payload && message.payload.governance_job_id || "");
    }).filter(Boolean));
    return (messages || []).filter(function (message) {
      if (!message || message.kind !== "GOVERNANCE_PROGRESS") return true;
      var governanceJobId = String(message.payload && message.payload.governance_job_id || "");
      return !governanceJobId || !deliveredJobs.has(governanceJobId);
    });
  }

  function conversationTaskResults(messages) {
    var rendered = new Set();
    (messages || []).filter(isGovernanceResultMessage).forEach(function (message) {
      preparedResults(message && message.payload && message.payload.results).forEach(function (result) {
        rendered.add(resultIdentity(result));
      });
    });
    var limit = Math.max(3, Number(state.selectedTask && state.selectedTask.human_result_limit || 3));
    return requestResults().slice(0, limit).filter(function (result) {
      return !rendered.has(resultIdentity(result));
    });
  }

  function resultIdentity(result) {
    return String(result && (result.product_url || result.url || result.id || result.handle || result.title) || "").trim();
  }

  function submitComposer() {
    sendMessage();
  }

  async function sendMessage(options) {
    var config = options || {};
    var message = String(config.message || nodes.input && nodes.input.value || "").trim();
    if (!message || state.busy || state.chatBusy) return false;
    var previous = message;
    if (nodes.input) nodes.input.value = "";
    resizeComposer();
    var optimisticKey = clientId("pending");
    state.messages.push({
      role: "user",
      content: message,
      message_key: optimisticKey,
      payload: {},
    });
    renderConversation();
    setChatBusy(true);
    if (nodes.working) {
      nodes.working.textContent = "Updating your brief...";
      nodes.working.hidden = false;
    }
    clearNotice();
    try {
      var response = await api("/chat", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: state.conversation && state.conversation.id || "",
          message_id: handoff.brief && !state.conversation
            ? handoffMessageId(handoff.id)
            : clientId("msg"),
          message: message,
          operation: config.operation || "chat",
          criteria: config.criteria || state.conversation && state.conversation.criteria || {},
          cursor: config.cursor || null,
          limit: 20,
        }),
      });
      var pages = await Promise.all([
        api("/conversations/" + encodeURIComponent(response.conversation_id)),
        api("/summary"),
        api("/conversations?limit=30"),
        api("/tasks?limit=20"),
      ]);
      state.conversation = pages[0].conversation || null;
      state.messages = pages[0].messages || [];
      state.conversationTasks = pages[0].tasks || [];
      state.summary = pages[1];
      state.conversations = pages[2].conversations || [];
      state.tasks = pages[3].tasks || [];
      renderOverview();
      renderConversation();
      closeDrawers();
      scheduleAutomaticSourcing();
      if (handoff.brief) clearHandoff();
      return true;
    } catch (error) {
      state.messages = state.messages.filter(function (item) { return item.message_key !== optimisticKey; });
      renderConversation();
      if (nodes.input) nodes.input.value = previous;
      resizeComposer();
      showError(error);
      return false;
    } finally {
      setChatBusy(false);
      if (nodes.working) nodes.working.hidden = true;
    }
  }

  function typingCard(prompt) {
    var language = hasHan(prompt) ? "zh" : "en";
    var wrapper = element("article", { className: "wp-message is-typing" });
    wrapper.setAttribute("role", "status");
    wrapper.setAttribute("aria-live", "polite");
    var identity = element("div", { className: "wp-message-identity" });
    identity.appendChild(element("div", { className: "wp-message-meta", text: "Send From China" }));
    wrapper.appendChild(identity);
    var body = element("div", { className: "wp-message-body" });
    body.setAttribute("aria-label", language === "zh" ? "商品助手正在回复" : "Your product concierge is replying");
    body.appendChild(element("span", { text: language === "zh" ? "正在整理" : "Thinking" }));
    var dots = element("span", { className: "wp-typing-dots" });
    for (var index = 0; index < 3; index += 1) dots.appendChild(element("span", { className: "wp-typing-dot" }));
    body.appendChild(dots);
    wrapper.appendChild(body);
    return wrapper;
  }

  function resizeComposer() {
    if (!nodes.input) return;
    nodes.input.style.height = "auto";
    nodes.input.style.height = Math.min(150, Math.max(50, nodes.input.scrollHeight)) + "px";
  }

  function scrollConversationToEnd() {
    if (!nodes.messages) return;
    nodes.messages.scrollTop = nodes.messages.scrollHeight;
  }

  function renderTaskActions() {
    renderSaveState();
  }

  function beginDynamicRequest(payload) {
    if (!state.conversation) {
      showNotice("Save the conversation before starting targeted sourcing.", "warning");
      return;
    }
    var language = "en";
    var criteria = state.conversation && state.conversation.criteria || {};
    var keywords = Array.isArray(criteria.keywords) ? criteria.keywords.filter(Boolean) : [];
    state.dynamicIntake = {
      active: true,
      submitting: false,
      conversationId: state.conversation.id,
      language: language,
      requestKey: clientId("intake"),
      errors: {},
      fields: {
        product: String(criteria.use_case || criteria.category || keywords.slice(0, 3).join(", ") || ""),
        requirements: "",
        budget: criteria.price_max == null ? "" : String(criteria.price_max),
        quantity: String(Math.max(1, Number(criteria.quantity || 1))),
        destination: String(criteria.ship_to || ""),
      },
    };
    clearNotice();
    renderConversation();
    openDrawer(nodes.requirementsDrawer);
    var productInput = nodes.dynamicIntakeHost && nodes.dynamicIntakeHost.querySelector("[data-dynamic-product]");
    if (productInput) productInput.focus();
  }

  function dynamicIntakeCard(intake) {
    var language = intake.language === "zh" ? "zh" : "en";
    var card = element("article", { className: "wp-dynamic-intake" });
    var heading = element("div", { className: "wp-dynamic-intake-heading" });
    heading.appendChild(element("span", { className: "wp-message-avatar", text: "S" }));
    var copy = element("div");
    copy.appendChild(element("p", {
      className: "wp-dynamic-intake-kicker",
      text: language === "zh" ? "定向找货" : "Targeted sourcing",
    }));
    copy.appendChild(element("h3", {
      text: language === "zh" ? "提交定向找货需求" : "Submit a targeted product request",
    }));
    heading.appendChild(copy);
    card.appendChild(heading);
    card.appendChild(element("p", {
      className: "wp-dynamic-intake-copy",
      text: language === "zh"
        ? "在这里补全需求，不会把表单内容重复发送到聊天中。"
        : "Complete the brief here. Its form fields will not be repeated as a chat message.",
    }));

    var form = element("form", { className: "wp-dynamic-intake-form" });
    form.noValidate = true;
    form.appendChild(dynamicIntakeField(intake, {
      key: "product",
      wide: true,
      required: true,
      multiline: true,
      dataName: "dynamicProduct",
      label: language === "zh" ? "具体商品或使用场景" : "Product or use case",
      placeholder: language === "zh" ? "例如：适合小户型客厅的红色真皮双人沙发" : "For example: a compact red leather loveseat for a small living room",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "requirements",
      wide: true,
      multiline: true,
      dataName: "dynamicRequirements",
      label: language === "zh" ? "必要功能、材质及排除项" : "Must-haves, materials, and exclusions",
      placeholder: language === "zh" ? "写明尺寸、材质、颜色或不能接受的条件" : "Include size, material, color, or anything you do not want",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "budget",
      inputType: "number",
      min: "0",
      step: "0.01",
      dataName: "dynamicBudget",
      label: language === "zh" ? "最高预算（美元，可选）" : "Maximum budget (USD, optional)",
      placeholder: "200",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "quantity",
      inputType: "number",
      min: "1",
      step: "1",
      dataName: "dynamicQuantity",
      label: language === "zh" ? "数量" : "Quantity",
      placeholder: "1",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "destination",
      required: true,
      wide: true,
      dataName: "dynamicDestination",
      label: language === "zh" ? "收货国家" : "Destination country",
      placeholder: language === "zh" ? "例如：美国或 US" : "For example: United States or US",
    }));
    if (intake.errors && intake.errors.form) {
      form.appendChild(element("p", { className: "wp-dynamic-intake-error", text: intake.errors.form }));
    }
    card.appendChild(element("p", {
      className: "wp-dynamic-intake-timing",
      text: language === "zh"
        ? "通常会在 10 分钟内返回首批结果；进度和结果会回到当前对话。"
        : "Initial prepared matches normally return within 10 minutes. Progress and results stay with this request.",
    }));
    var actions = element("div", { className: "wp-dynamic-intake-actions" });
    var submit = element("button", {
      className: "wp-dynamic-intake-submit",
      type: "submit",
      text: intake.submitting
        ? (language === "zh" ? "正在记录..." : "Recording request...")
        : (language === "zh" ? "提交定向找货" : "Submit targeted request"),
      disabled: Boolean(intake.submitting),
    });
    submit.dataset.dynamicSubmit = "true";
    actions.appendChild(submit);
    var cancel = element("button", {
      className: "wp-dynamic-intake-cancel",
      type: "button",
      text: language === "zh" ? "继续浏览现有商品" : "Keep browsing the catalog",
    });
    cancel.addEventListener("click", function () { leaveDynamicIntake(true); });
    actions.appendChild(cancel);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitDynamicBrief();
    });
    card.appendChild(form);
    return card;
  }

  function dynamicIntakeField(intake, options) {
    var field = element("label", {
      className: "wp-dynamic-field" + (options.wide ? " is-wide" : ""),
    });
    field.appendChild(element("span", {
      text: options.label + (options.required ? " *" : ""),
    }));
    var control = element(options.multiline ? "textarea" : "input", {
      type: options.multiline ? undefined : (options.inputType || "text"),
      value: intake.fields[options.key] || "",
      placeholder: options.placeholder || "",
      min: options.min,
      step: options.step,
      rows: options.multiline ? 3 : undefined,
      required: options.required,
    });
    control.dataset[options.dataName] = "true";
    control.addEventListener("input", function () {
      intake.fields[options.key] = control.value;
      if (intake.errors) delete intake.errors[options.key];
    });
    field.appendChild(control);
    if (intake.errors && intake.errors[options.key]) {
      field.appendChild(element("small", { className: "wp-dynamic-field-error", text: intake.errors[options.key] }));
    }
    return field;
  }

  function dynamicIntakeCardV2(intake) {
    var card = element("section", { className: "wp-dynamic-intake" });
    card.appendChild(element("p", { className: "wp-request-kicker", text: "Targeted sourcing" }));
    card.appendChild(element("h3", { text: "Complete the sourcing brief" }));
    card.appendChild(element("p", {
      className: "wp-dynamic-intake-copy",
      text: "Give us enough detail to source three closely matched products. Initial prepared results normally return to this request within 10 minutes.",
    }));
    var form = element("form", { className: "wp-dynamic-intake-form" });
    form.noValidate = true;
    form.appendChild(dynamicIntakeField(intake, {
      key: "product", wide: true, required: true, multiline: true, dataName: "dynamicProduct",
      label: "Product or use case", placeholder: "For example: a compact red leather loveseat for a small living room",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "requirements", wide: true, multiline: true, dataName: "dynamicRequirements",
      label: "Must-haves, materials, and exclusions", placeholder: "Include size, material, color, or anything you do not want",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "budget", inputType: "number", min: "0", step: "0.01", dataName: "dynamicBudget",
      label: "Maximum budget (USD, optional)", placeholder: "200",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "quantity", inputType: "number", min: "1", step: "1", dataName: "dynamicQuantity",
      label: "Quantity", placeholder: "1",
    }));
    form.appendChild(dynamicIntakeField(intake, {
      key: "destination", required: true, wide: true, dataName: "dynamicDestination",
      label: "Destination country", placeholder: "For example: United States or US",
    }));
    if (intake.errors && intake.errors.form) {
      form.appendChild(element("p", { className: "wp-dynamic-intake-error", text: intake.errors.form }));
    }
    var actions = element("div", { className: "wp-dynamic-intake-actions" });
    var submit = element("button", {
      className: "wp-dynamic-intake-submit", type: "submit",
      text: intake.submitting ? "Saving request..." : "Start targeted sourcing",
      disabled: Boolean(intake.submitting),
    });
    submit.dataset.dynamicSubmit = "true";
    actions.appendChild(submit);
    var cancel = element("button", { className: "wp-dynamic-intake-cancel", type: "button", text: "Cancel" });
    cancel.addEventListener("click", function () { leaveDynamicIntake(true); closeDrawers(); });
    actions.appendChild(cancel);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitDynamicBrief();
    });
    card.appendChild(form);
    return card;
  }

  function leaveDynamicIntake(render) {
    state.dynamicIntake = null;
    if (render !== false && nodes.messages) renderConversation();
  }

  async function submitDynamicBrief() {
    var intake = state.dynamicIntake;
    if (!intake || intake.submitting || state.busy || state.chatBusy) return;
    var fields = intake.fields || {};
    var product = String(fields.product || "").trim();
    var destination = normalizeDestination(fields.destination);
    intake.errors = {};
    if (product.length < (intake.language === "zh" ? 4 : 8)) {
      intake.errors.product = intake.language === "zh" ? "请写明具体商品或使用场景。" : "Describe the product or use case more specifically.";
    }
    if (!destination) {
      intake.errors.destination = intake.language === "zh" ? "请输入国家名称或国家代码。" : "Use a country name or ISO country code.";
    }
    if (intake.errors.product) intake.errors.product = "Describe the product or use case more specifically.";
    if (intake.errors.destination) intake.errors.destination = "Use a country name or ISO country code.";
    if (Object.keys(intake.errors).length) {
      renderConversation();
      var invalid = nodes.dynamicIntakeHost && nodes.dynamicIntakeHost.querySelector(".wp-dynamic-field-error");
      if (invalid && invalid.parentElement) invalid.parentElement.querySelector("input, textarea").focus();
      return;
    }
    intake.submitting = true;
    renderConversation();
    var criteria = dynamicRequestCriteria(fields, destination);
    var query = dynamicRequestQuery(fields, criteria);
    var queued = await queueDynamicRequest(query, intake.language, criteria, intake.requestKey);
    if (!queued) {
      intake.submitting = false;
      state.dynamicIntake = intake;
      renderConversation();
      return;
    }
    leaveDynamicIntake(false);
    renderConversation();
    closeDrawers();
  }

  async function queueDynamicRequest(query, language, criteria, requestKey) {
    var plans = state.summary && state.summary.plans || [];
    var payment = state.summary && state.summary.payment || {};
    var credits = Number(state.summary && state.summary.credits && state.summary.credits.available || 0);
    var preview = state.summary && state.summary.preview_access || {};
    var remainingPreview = Number(preview.remaining_today);
    var previewAvailable = preview.enabled !== false
      && (!Number.isFinite(remainingPreview) || remainingPreview > 0);
    var plan = plans.find(function (item) {
      return item.id === "preview" && previewAvailable;
    });
    if (!plan && payment.enabled) {
      plan = plans.find(function (item) { return Number(item.credits || 0) <= credits; });
    }
    if (!plan) {
      showNotice(language === "zh"
        ? (payment.enabled ? "请先购买找货额度，再启动这个任务。" : "今天的免费找货额度暂不可用；完整需求已保存在当前对话。")
        : (payment.enabled ? "Add search credits to start this targeted product request." : "The free targeted-search allowance is currently unavailable. Your conversation remains saved."), "warning");
      return false;
    }
    return createTask(plan, query, {
      criteria: criteria,
      idempotencySeed: requestKey,
      language: language,
    });
  }

  function dynamicRequestCriteria(fields, destination) {
    var current = state.conversation && state.conversation.criteria || {};
    var criteria = Object.assign({}, current);
    var product = String(fields.product || "").trim();
    var requirements = String(fields.requirements || "").trim();
    var budget = Number(fields.budget);
    var quantity = Math.max(1, Math.floor(Number(fields.quantity || 1)));
    criteria.use_case = product;
    criteria.ship_to = destination;
    criteria.quantity = Number.isFinite(quantity) ? quantity : 1;
    if (String(fields.budget || "").trim() && Number.isFinite(budget) && budget > 0) criteria.price_max = budget;
    if (requirements) criteria.must_have = [requirements];
    criteria.keywords = Array.from(new Set((Array.isArray(criteria.keywords) ? criteria.keywords : []).concat([product]))).slice(0, 8);
    return criteria;
  }

  function dynamicRequestQuery(fields, criteria) {
    var parts = ["Product request: " + String(fields.product || "").trim()];
    if (String(fields.requirements || "").trim()) parts.push("Requirements: " + String(fields.requirements).trim());
    if (criteria.price_max != null) parts.push("Maximum budget USD: " + criteria.price_max);
    parts.push("Quantity: " + String(criteria.quantity || 1));
    parts.push("Ship to: " + String(criteria.ship_to || ""));
    return parts.join("\n").slice(0, 1000);
  }

  function normalizeDestination(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var upper = raw.toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
    var countries = {
      "UNITED STATES": "US", USA: "US", US: "US",
      "UNITED KINGDOM": "GB", UK: "GB", GB: "GB",
      CANADA: "CA", CA: "CA", AUSTRALIA: "AU", AU: "AU",
      GERMANY: "DE", DE: "DE", FRANCE: "FR", FR: "FR",
      ITALY: "IT", IT: "IT", SPAIN: "ES", ES: "ES",
      JAPAN: "JP", JP: "JP", "SOUTH KOREA": "KR", KOREA: "KR", KR: "KR",
      SINGAPORE: "SG", SG: "SG", "HONG KONG": "HK", HK: "HK",
    };
    if (countries[upper]) return countries[upper];
    if (/^[A-Z]{2,3}$/.test(upper)) return upper;
    return "";
  }

  async function createTask(plan, queryOverride, options) {
    var config = options || {};
    var latest = latestUserMessage();
    if (!state.conversation || (!latest && !queryOverride)) {
      showNotice("Tell the product concierge what you need before starting a targeted product request.");
      return false;
    }
    setBusy(true);
    clearNotice();
    try {
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          query: String(queryOverride || latest.content || "").slice(0, 1000),
          criteria: config.criteria || state.conversation.criteria || {},
          plan_id: plan.id,
          conversation_id: state.conversation.id,
          idempotency_key: taskKey(state.conversation.id, config.idempotencySeed || latest && latest.message_key || clientId("task"), plan.id),
        }),
      });
      await Promise.all([openConversation(state.conversation.id), refreshOverview()]);
      showNotice(config.language === "zh"
        ? "需求已记录，首批结果通常会在 10 分钟内返回，并直接回到当前对话。"
        : "Request recorded. Three prepared matches normally return here within 10 minutes.", "success");
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function renderTaskList() {
    if (!nodes.taskList) return;
    nodes.taskList.replaceChildren();
    var visibleTasks = state.conversation ? state.conversationTasks : state.tasks;
    if (!visibleTasks.length) {
      nodes.taskList.appendChild(emptyText("No product requests yet."));
      return;
    }
    visibleTasks.forEach(function (task) {
      var row = element("div", { className: "wp-task-row" });
      row.appendChild(element("strong", { text: task.query || "Product request" }));
      row.appendChild(element("span", { text: taskStatusLabel(task.status) }));
      var resultCount = Math.max(0, Number(task.result_count || 0));
      if (resultCount > 0) {
        var open = element("button", { type: "button", text: "View " + String(resultCount) + " results" });
        open.addEventListener("click", function () { openTask(task); });
        row.appendChild(open);
      } else {
        var terminalWithoutResults = ["NO_MATCH", "FAILED", "CANCELLED"].includes(String(task.status || "").toUpperCase());
        row.appendChild(element("span", {
          className: "wp-task-waiting",
          text: terminalWithoutResults ? "No results" : "Expected within 10 minutes",
        }));
      }
      nodes.taskList.appendChild(row);
    });
  }

  async function openTask(task) {
    setBusy(true);
    clearNotice();
    try {
      var pages = await Promise.all([
        api("/tasks/" + encodeURIComponent(task.id) + "/results?limit=20"),
        api("/tasks/" + encodeURIComponent(task.id) + "/governance?limit=20"),
      ]);
      state.selectedTask = pages[0].task || task;
      state.results = pages[0].results || [];
      state.resultCursor = pages[0].next_cursor || "";
      state.governanceJobs = pages[1].jobs || [];
      renderResults();
      if (nodes.conciergeMessages) nodes.conciergeMessages.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function unlockFullResults(quantity) {
    var task = selectedRequestTask();
    if (!task || state.busy) return;
    var requestedQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    setBusy(true);
    clearNotice();
    try {
      var unlocked = await api("/tasks/" + encodeURIComponent(task.id) + "/results/unlock", {
        method: "POST",
        body: JSON.stringify({
          quantity: requestedQuantity,
          idempotency_key: clientId("prepare"),
        }),
      });
      await Promise.all([openTask(task), refreshOverview()]);
      var selected = Math.max(0, Number(unlocked && unlocked.quantity_selected || 0));
      var charged = Math.max(0, Number(unlocked && unlocked.credits_charged || 0));
      showNotice(String(selected) + " product" + (selected === 1 ? " is" : "s are")
        + " being prepared for " + String(charged) + (charged === 1 ? " credit." : " credits."), "success");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreResults() {
    if (!state.selectedTask || !state.resultCursor || state.busy) return;
    setBusy(true);
    try {
      var page = await api("/tasks/" + encodeURIComponent(state.selectedTask.id)
        + "/results?limit=20&cursor=" + encodeURIComponent(state.resultCursor));
      state.selectedTask = page.task || state.selectedTask;
      state.results = state.results.concat(page.results || []);
      state.resultCursor = page.next_cursor || "";
      renderResults();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function renderResults() {
    if (!nodes.results) return;
    nodes.results.replaceChildren();
    var allResults = requestResults();
    var paid = isPaidRequest(state.selectedTask);
    var visibleLimit = Math.max(3, Number(state.selectedTask && state.selectedTask.human_result_limit || 3));
    var visibleResults = allResults.slice(0, visibleLimit);
    if (nodes.resultsSection) nodes.resultsSection.hidden = !paid;
    if (nodes.deeperSearch) nodes.deeperSearch.hidden = !state.selectedTask
      || Number(state.selectedTask.remaining_result_count !== undefined
        ? state.selectedTask.remaining_result_count
        : Number(state.selectedTask.result_count || 0) - visibleLimit) <= 0;
    renderCreditPlans();
    if (nodes.resultsSummary) {
      nodes.resultsSummary.textContent = visibleResults.length
        ? (paid
          ? String(visibleResults.length) + " prepared products in this deeper search."
          : visibleResults.length === 3
            ? "Three products selected for your brief."
            : String(visibleResults.length) + " initial " + (visibleResults.length === 1 ? "match" : "matches") + " selected for your brief.")
        : "Results appear here when they are ready.";
    }
    if (!visibleResults.length) {
      nodes.results.appendChild(emptyText("The request is saved. Results will appear here as they are delivered."));
      if (nodes.deeperSearch) nodes.deeperSearch.hidden = true;
      return;
    }
    var grid = element("div", { className: "wp-result-grid" });
    visibleResults.forEach(function (result) {
      var card = resultCard(result);
      if (card) grid.appendChild(card);
    });
    nodes.results.appendChild(grid);
    if (paid && state.resultCursor) {
      var more = element("button", { className: "wp-request-secondary-action", type: "button", text: "Load 20 more" });
      more.addEventListener("click", loadMoreResults);
      nodes.results.appendChild(more);
    }
  }

  function requestResults() {
    if (state.selectedTask && Array.isArray(state.results) && state.results.length) return preparedResults(state.results);
    for (var index = state.messages.length - 1; index >= 0; index -= 1) {
      if (!isGovernanceResultMessage(state.messages[index])) continue;
      var payloadResults = state.messages[index].payload && state.messages[index].payload.results;
      if (Array.isArray(payloadResults) && payloadResults.length) return preparedResults(payloadResults);
    }
    return [];
  }

  function isGovernanceResultMessage(message) {
    return Boolean(message && String(message.kind || "").toUpperCase() === "GOVERNANCE_RESULT");
  }

  function scheduleAutomaticSourcing() {
    if (!automaticSourcingBrief()) return;
    window.setTimeout(startAutomaticSourcing, 0);
  }

  function automaticSourcingBrief() {
    if (!state.conversation || state.selectedTask || state.conversationTasks.length) return null;
    if (state.autoStartingConversationId === state.conversation.id) return null;
    var assistant = latestAssistantMessage();
    var payload = assistant && assistant.payload || {};
    if (String(payload.action || "").toLowerCase() !== "results" || !preparedResults(payload.results).length) return null;
    var latest = latestUserMessage();
    var createdAt = new Date(latest && latest.created_at || 0).getTime();
    if (!createdAt || Date.now() - createdAt > 2 * 60 * 60 * 1000) return null;
    var criteria = state.conversation.criteria || {};
    var keywords = Array.isArray(criteria.keywords) ? criteria.keywords.filter(Boolean) : [];
    var product = String(criteria.use_case || criteria.category || keywords.slice(0, 3).join(", ") || "").trim();
    var destination = normalizeDestination(criteria.ship_to);
    if (product.length < 4 || !destination) return null;
    return {
      conversationId: state.conversation.id,
      language: messageLanguage(latest, latest && latest.payload || {}),
      requestKey: "automatic:" + String(latest.message_key || latest.id || state.conversation.id),
      fields: {
        product: product,
        requirements: Array.isArray(criteria.must_have) ? criteria.must_have.filter(Boolean).join(", ") : "",
        budget: criteria.price_max == null ? "" : String(criteria.price_max),
        quantity: String(Math.max(1, Number(criteria.quantity || 1))),
        destination: destination,
      },
    };
  }

  async function startAutomaticSourcing() {
    var brief = automaticSourcingBrief();
    if (!brief) return;
    state.autoStartingConversationId = brief.conversationId;
    showNotice("Your brief is confirmed. Targeted sourcing is starting now.", "success");
    var criteria = dynamicRequestCriteria(brief.fields, brief.fields.destination);
    var query = dynamicRequestQuery(brief.fields, criteria);
    await queueDynamicRequest(query, brief.language, criteria, brief.requestKey);
    state.autoStartingConversationId = "";
  }

  function preparedResults(results) {
    if (!Array.isArray(results)) return [];
    return results.filter(function (result) {
      if (!result || typeof result !== "object") return false;
      var title = String(result.title || "").trim();
      var imageUrl = result.image || result.image_url || result.featured_image;
      var productUrl = result.product_url || result.url;
      return Boolean(title && safeHttps(imageUrl) && safeHttps(productUrl));
    });
  }

  function isPaidRequest(task) {
    if (!task) return false;
    if (Number(task.unlocked_result_count || 0) > 0) return true;
    if (task.full_results_unlocked === true) return true;
    var plan = String(task.plan_id || task.credit_plan || "").toLowerCase();
    return Boolean(plan && plan !== "preview" && plan !== "free") || Number(task.credit_cost || 0) > 0;
  }

  function resultCard(result) {
    if (!result || typeof result !== "object") return null;
    var title = String(result.title || "").trim();
    var imageUrl = result.image || result.image_url || result.featured_image;
    var productLink = result.product_url || result.url;
    if (!title || !safeHttps(imageUrl) || !safeHttps(productLink)) return null;
    var card = element("article", { className: "wp-result-card" });
    var image = element("img", { src: imageUrl, alt: title });
    image.loading = "lazy";
    card.appendChild(image);
    var body = element("div", { className: "wp-result-card-body" });
    body.appendChild(element("span", {
      className: "wp-result-card-kicker",
      text: "Selected for your brief",
    }));
    body.appendChild(element("h3", { text: title }));
    var summary = plainText(result.summary || result.description || result.description_html || result.why || "")
      .replace(/\s+/g, " ").trim().slice(0, 220);
    body.appendChild(element("p", {
      className: "wp-result-card-summary",
      text: summary || "Open the product page to review specifications, options, and availability.",
    }));
    if (result.why && summary !== plainText(result.why).replace(/\s+/g, " ").trim().slice(0, 220)) {
      body.appendChild(element("p", {
        className: "wp-result-card-reason",
        text: "Why it fits: " + plainText(result.why).replace(/\s+/g, " ").trim().slice(0, 160),
      }));
    }
    if (result.price_usd !== null && result.price_usd !== undefined && Number.isFinite(Number(result.price_usd))) {
      body.appendChild(element("span", {
        className: "wp-result-card-price-label",
        text: "Item price",
      }));
      body.appendChild(element("p", { className: "wp-result-card-price", text: "$" + Number(result.price_usd).toFixed(2) + " " + (result.currency || "USD") }));
    }
    if (result.available === true) {
      body.appendChild(element("p", {
        className: "wp-result-card-availability",
        text: "Available to add to cart",
      }));
    } else if (result.available === false) {
      body.appendChild(element("p", {
        className: "wp-result-card-availability is-unavailable",
        text: "Currently unavailable",
      }));
    }
    body.appendChild(element("p", {
      className: "wp-result-card-total-note",
      text: "Shipping, duties, and taxes are confirmed before payment.",
    }));
    var actions = element("div", { className: "wp-result-card-actions" });
    if (safeHttps(result.add_to_cart_url) && result.available !== false) {
      var addToCart = linkButton("Add to cart", result.add_to_cart_url);
      addToCart.className = "is-primary";
      actions.appendChild(addToCart);
    }
    if (safeHttps(productLink)) {
      var viewProduct = linkButton("View product", productLink);
      viewProduct.className = "is-secondary";
      actions.appendChild(viewProduct);
    }
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  async function startGovernance(result) {
    if (!state.selectedTask) return;
    setBusy(true);
    clearNotice();
    try {
      await api("/tasks/" + encodeURIComponent(state.selectedTask.id)
        + "/results/" + encodeURIComponent(result.id) + "/governance", {
        method: "POST",
        body: JSON.stringify({ content_version: "retail-en-v1" }),
      });
      await openTask(state.selectedTask);
      showNotice("Product preparation started. Progress and the final result will return to this conversation.", "success");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function startPolling() {
    if (root.dataset.pollingStarted === "true") return;
    root.dataset.pollingStarted = "true";
    window.setInterval(pollLiveState, pollInterval);
  }

  function hasLiveWork() {
    var taskLive = state.tasks.some(function (task) {
      return !["RESULTS_READY", "COMPLETED", "NO_MATCH", "FAILED", "CANCELLED"].includes(String(task.status || "").toUpperCase());
    });
    var preparationLive = state.governanceJobs.some(function (job) {
      return !["READY", "PARTIAL_READY", "FAILED", "CANCELLED"].includes(String(job.state || "").toUpperCase());
    });
    return taskLive || preparationLive;
  }

  async function pollLiveState() {
    if (document.hidden || state.busy || state.chatBusy || state.polling) return;
    state.pollTicks += 1;
    if (!hasLiveWork() && state.pollTicks % 4 !== 0) return;
    state.polling = true;
    var conversationId = state.conversation && state.conversation.id;
    var taskId = state.selectedTask && state.selectedTask.id;
    var previousGovernanceJobs = state.governanceJobs.slice();
    try {
      var requests = [
        api("/summary"),
        api("/conversations?limit=30"),
        api("/tasks?limit=20"),
      ];
      if (conversationId) requests.push(api("/conversations/" + encodeURIComponent(conversationId)));
      if (taskId) {
        requests.push(api("/tasks/" + encodeURIComponent(taskId) + "/results?limit=20"));
        requests.push(api("/tasks/" + encodeURIComponent(taskId) + "/governance?limit=20"));
      }
      var pages = await Promise.all(requests);
      state.summary = pages[0];
      state.conversations = pages[1].conversations || [];
      state.tasks = pages[2].tasks || [];
      var cursor = 3;
      if (conversationId) {
        var conversationPage = pages[cursor];
        cursor += 1;
        state.conversation = conversationPage.conversation || state.conversation;
        state.messages = conversationPage.messages || [];
        state.conversationTasks = conversationPage.tasks || [];
      }
      if (taskId) {
        var resultsPage = pages[cursor];
        var governancePage = pages[cursor + 1];
        state.selectedTask = resultsPage.task || state.selectedTask;
        state.results = resultsPage.results || [];
        state.resultCursor = resultsPage.next_cursor || "";
        state.governanceJobs = governancePage.jobs || [];
        showGovernanceTransitionNotice(previousGovernanceJobs, state.governanceJobs);
      }
      renderOverview();
      if (conversationId) renderConversation();
      if (taskId) renderResults();
    } catch (_error) {
      // Poll failures are transient. Explicit customer actions still surface errors.
    } finally {
      state.polling = false;
    }
  }

  function showGovernanceTransitionNotice(previousJobs, nextJobs) {
    var previous = new Map(previousJobs.map(function (job) {
      return [job.id, String(job.state || "").toUpperCase()];
    }));
    for (var index = 0; index < nextJobs.length; index += 1) {
      var job = nextJobs[index];
      var before = previous.get(job.id);
      var after = String(job.state || "").toUpperCase();
      if (!before || before === after) continue;
      if (after === "READY") {
        showNotice("Your prepared product is ready in this conversation.", "success");
        return;
      }
      if (after === "PARTIAL_READY") {
        showNotice("A partial product preview is ready in this conversation.", "warning");
        return;
      }
      if (after === "FAILED") {
        showNotice("Product preparation needs attention. The request remains saved in this conversation.", "warning");
        return;
      }
    }
  }

  function previewCard(preview) {
    var title = String(preview && preview.title || "").trim();
    var image = Array.isArray(preview && preview.images) ? preview.images.find(safeHttps) : "";
    var productUrl = safeHttps(preview && preview.product_url) ? preview.product_url : "";
    var rawPrice = preview && preview.price_usd != null ? preview.price_usd : preview && preview.price;
    var price = Number(rawPrice);
    if (!title || !image || !productUrl || preview.purchasable !== true || !Number.isFinite(price) || price <= 0) {
      return null;
    }
    var card = element("div", { className: "wp-result-card wp-preview-card" });
    card.appendChild(element("img", { src: image, alt: title }));
    var body = element("div", { className: "wp-result-card-body" });
    body.appendChild(element("h4", { text: title }));
    if (preview.description_html) body.appendChild(element("p", { text: plainText(preview.description_html).slice(0, 360) }));
    body.appendChild(element("p", {
      className: "wp-result-price",
      text: "$" + price.toFixed(2) + " " + (preview.currency || "USD"),
    }));
    var actions = element("div", { className: "wp-result-actions" });
    actions.appendChild(element("a", {
      className: "wp-primary-action",
      href: productUrl,
      text: "Open product",
    }));
    if (safeHttps(preview.add_to_cart_url)) {
      actions.appendChild(element("a", {
        className: "wp-secondary-action",
        href: preview.add_to_cart_url,
        text: "Add to cart",
      }));
    }
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  async function api(path, options) {
    var config = options || {};
    var response = await fetch(apiBase + path, {
      method: config.method || "GET",
      credentials: "same-origin",
      headers: Object.assign({ "Accept": "application/json", "Content-Type": "application/json" }, config.headers || {}),
      body: config.body,
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(payload.message || payload.error || "Your sourcing workspace is temporarily unavailable.");
      error.code = payload.error || "WORKSPACE_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    root.toggleAttribute("data-wp-loading", state.busy);
    if (nodes.send) nodes.send.disabled = state.busy || state.chatBusy;
    if (nodes.input) nodes.input.disabled = state.busy || state.chatBusy;
    if (nodes.createAgentKey) nodes.createAgentKey.disabled = state.busy || !state.agentKeysAvailable;
    if (state.summary) renderTaskActions();
    if (state.selectedTask) renderResults();
  }

  function setChatBusy(value) {
    state.chatBusy = Boolean(value);
    root.toggleAttribute("data-wp-chat-loading", state.chatBusy);
    if (nodes.send) nodes.send.disabled = state.busy || state.chatBusy;
    if (nodes.input) {
      nodes.input.disabled = state.busy;
      nodes.input.setAttribute("aria-busy", state.chatBusy ? "true" : "false");
    }
    root.querySelectorAll(".wp-suggestion-button").forEach(function (button) {
      button.disabled = state.chatBusy;
    });
    renderConcierge();
    renderTaskActions();
  }

  function showError(error) {
    var message = error && error.message || "Your sourcing workspace is temporarily unavailable.";
    if (error && error.status === 401) message = "Your Shopify sign-in expired. Sign in again, then reopen your sourcing workspace.";
    showNotice(message, "error");
  }

  function showNotice(message, tone) {
    if (!nodes.notice) return;
    nodes.notice.textContent = message;
    nodes.notice.dataset.tone = tone || "error";
    nodes.notice.hidden = false;
  }

  function clearNotice() {
    if (!nodes.notice) return;
    nodes.notice.hidden = true;
    nodes.notice.textContent = "";
    delete nodes.notice.dataset.tone;
  }

  function latestUserMessage() {
    for (var index = state.messages.length - 1; index >= 0; index -= 1) {
      if (state.messages[index].role === "user") return state.messages[index];
    }
    return null;
  }

  function taskKey(conversationId, messageKey, planId) {
    return ("chat:" + String(conversationId).slice(-48) + ":" + String(messageKey).slice(-48) + ":" + planId).slice(0, 128);
  }

  function readHandoff() {
    var params = new URLSearchParams(window.location.search);
    var brief = String(params.get("brief") || "").trim().slice(0, 1000);
    var id = String(params.get("handoff_id") || "").trim();
    if (!/^handoff_[A-Za-z0-9]{12,80}$/.test(id)) id = "";
    var plan = String(params.get("credit_plan") || "").trim();
    if (!["focused", "extended", "deep"].includes(plan)) plan = "";
    return { brief: brief, id: id, plan: plan };
  }

  function clearHandoff() {
    handoff = { brief: "", id: "", plan: "" };
    var url = new URL(window.location.href);
    ["brief", "handoff_id", "credit_plan"].forEach(function (key) { url.searchParams.delete(key); });
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function handoffMessageId(value) {
    return value ? "msg_" + value : clientId("msg");
  }

  function taskStatusLabel(value) {
    var labels = {
      QUEUED: "Request received",
      SOURCING: "Finding products",
      REVIEW_REQUIRED: "Reviewing candidates",
      GOVERNING: "Checking product details",
      SHOPIFY_DRAFT: "Preparing product page",
      RESULTS_READY: "Matches ready",
      WP_RESULT_READY: "Matches ready",
      COMPLETED: "Matches delivered",
      MESSAGE_DELIVERED: "Matches delivered",
      PARTIAL_SUCCESS: "Partial matches ready",
      NO_MATCH: "No match yet",
      FAILED: "Needs attention",
      FAILED_RETRYABLE: "Retrying",
      FAILED_FINAL: "Needs attention",
      UNKNOWN_OUTCOME: "Confirming progress",
      CANCELLED: "Cancelled",
    };
    return labels[String(value || "").toUpperCase()] || "In progress";
  }

  function preparationStatusLabel(value) {
    var labels = {
      QUEUED: "request received",
      SUBMITTING: "starting",
      SUBMITTED: "request accepted",
      PROCESSING: "preparing and checking the product",
      READY: "ready in this conversation",
      PARTIAL_READY: "partial preview ready",
      FAILED: "needs attention",
      CONFIRMING: "confirming request",
    };
    return labels[String(value || "").toUpperCase()] || "in progress";
  }

  function preparationActionLabel(value) {
    var labels = {
      READY: "Preview ready",
      PARTIAL_READY: "Partial preview ready",
      FAILED: "Preparation needs attention",
    };
    return labels[String(value || "").toUpperCase()] || "Preparing product";
  }

  function clientId(prefix) {
    if (window.crypto && window.crypto.randomUUID) return prefix + "_" + window.crypto.randomUUID();
    return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 14);
  }

  function element(tag, options) {
    var output = document.createElement(tag);
    var values = options || {};
    if (values.className) output.className = values.className;
    if (values.text !== undefined) output.textContent = String(values.text);
    if (values.type) output.type = values.type;
    if (values.href) output.href = values.href;
    if (values.src) output.src = values.src;
    if (values.alt !== undefined) output.alt = values.alt;
    if (values.disabled !== undefined) output.disabled = Boolean(values.disabled);
    if (values.value !== undefined) output.value = String(values.value);
    if (values.placeholder !== undefined) output.placeholder = String(values.placeholder);
    if (values.min !== undefined) output.min = String(values.min);
    if (values.max !== undefined) output.max = String(values.max);
    if (values.step !== undefined) output.step = String(values.step);
    if (values.rows !== undefined) output.rows = Number(values.rows);
    if (values.required !== undefined) output.required = Boolean(values.required);
    if (values.ariaLabel !== undefined) output.setAttribute("aria-label", String(values.ariaLabel));
    return output;
  }

  function emptyText(value) {
    return element("p", { className: "wp-workspace-empty", text: value });
  }

  function linkButton(label, href) {
    return element("a", { text: label, href: href });
  }

  function safeHttps(value) {
    try { return new URL(String(value || "")).protocol === "https:"; } catch (_error) { return false; }
  }

  function hasHan(value) {
    return /[\u3400-\u9fff]/.test(String(value || ""));
  }

  function messageLanguage(message, payload) {
    if (String(payload && payload.language || "").toLowerCase() === "zh") return "zh";
    return hasHan(message && message.content) ? "zh" : "en";
  }

  function workspaceLanguage() {
    for (var index = state.messages.length - 1; index >= 0; index -= 1) {
      var message = state.messages[index];
      if (message && message.role === "user") return messageLanguage(message, message.payload || {});
    }
    return hasHan(state.selectedTask && state.selectedTask.query) ? "zh" : "en";
  }

  function plainText(html) {
    return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || "";
  }

  function conciseStatus(value) {
    var text = plainText(value).replace(/\s+/g, " ").trim();
    if (!text) return "Your request is saved.";
    if (text.length <= 220) return text;
    var shortened = text.slice(0, 220);
    var boundary = shortened.lastIndexOf(" ");
    return shortened.slice(0, boundary > 150 ? boundary : 220).replace(/[,:;\s]+$/, "") + ".";
  }

  function compactId(value) {
    var text = String(value || "");
    return text.length > 18 ? text.slice(0, 8) + "..." + text.slice(-6) : text;
  }

  function formatDate(value) {
    var date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }
})();
