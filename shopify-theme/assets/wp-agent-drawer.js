(function () {
  "use strict";

  var root = document.querySelector("[data-wp-agent-drawer]");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  var drawer = root.querySelector(".wp-agent-drawer");
  var backdrop = root.querySelector(".wp-agent-backdrop");
  var conversationView = root.querySelector("[data-agent-conversation-view]");
  var historyView = root.querySelector("[data-agent-history-view]");
  var historyList = root.querySelector("[data-agent-history-list]");
  var historyNote = root.querySelector("[data-agent-history-note]");
  var transcript = root.querySelector("[data-agent-transcript]");
  var welcome = root.querySelector("[data-agent-welcome]");
  var form = root.querySelector("[data-agent-form]");
  var input = root.querySelector("[data-agent-input]");
  var send = root.querySelector("[data-agent-send]");
  var statusNode = root.querySelector("[data-agent-status]");
  var briefNode = root.querySelector("[data-agent-brief]");
  var briefSummary = root.querySelector("[data-agent-brief-summary]");
  var sourcingConfirm = root.querySelector("[data-agent-sourcing-confirm]");
  var sourcingFacts = root.querySelector("[data-agent-sourcing-facts]");
  var contextNode = root.querySelector("[data-agent-context]");
  var historyButton = root.querySelector("[data-agent-history]");
  var signedIn = root.dataset.signedIn === "true";
  var accountApi = String(root.dataset.accountApi || "/apps/wp-account").replace(/\/$/, "");
  var publicApi = String(root.dataset.publicApi || "").replace(/\/$/, "");
  var workspaceUrl = root.dataset.workspaceUrl || "/apps/wp-account/workspace";
  var loginUrl = root.dataset.loginUrl || "/customer_authentication/login";
  var previousFocus = null;
  var historyLoaded = false;
  var state = {
    busy: false,
    conversation: null,
    conversations: [],
    messages: [],
    publicMessages: [],
    criteria: {},
    sessionId: clientId("chat"),
    cursor: "",
    productContextUsed: false,
  };

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-open-agent-drawer]");
    if (!trigger) return;
    event.preventDefault();
    openDrawer(trigger.dataset.agentBrief || "", trigger.dataset.agentAutoSend === "true");
  });
  window.addEventListener("wp:open-agent", function (event) {
    var detail = event.detail || {};
    openDrawer(detail.brief || "", detail.autoSend === true);
  });
  root.querySelectorAll("[data-agent-close]").forEach(function (button) { button.addEventListener("click", closeDrawer); });
  historyButton.addEventListener("click", function () {
    if (!historyView.hidden) {
      showConversation();
      input.focus();
      return;
    }
    showHistory();
  });
  root.querySelector("[data-agent-new]").addEventListener("click", startNewConversation);
  root.querySelector("[data-agent-edit-brief]").addEventListener("click", function () { input.focus(); });
  root.querySelector("[data-agent-keep-chatting]").addEventListener("click", function () {
    sourcingConfirm.hidden = true;
    input.focus();
  });
  root.querySelector("[data-agent-start-sourcing]").addEventListener("click", startSourcing);
  root.querySelectorAll("[data-agent-starter]").forEach(function (button) {
    button.addEventListener("click", function () { input.value = button.dataset.agentStarter || ""; sendMessage(); });
  });
  form.addEventListener("submit", function (event) { event.preventDefault(); sendMessage(); });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  input.addEventListener("input", resizeInput);
  document.addEventListener("keydown", function (event) {
    if (drawer.hidden) return;
    if (event.key === "Escape") closeDrawer();
    if (event.key === "Tab") trapFocus(event);
  });

  renderProductContext();

  function openDrawer(brief, autoSend) {
    previousFocus = document.activeElement;
    drawer.hidden = false;
    backdrop.hidden = false;
    document.documentElement.classList.add("wp-agent-is-open");
    document.querySelectorAll("[data-open-agent-drawer]").forEach(function (trigger) { trigger.setAttribute("aria-expanded", "true"); });
    showConversation();
    if (brief) {
      input.value = String(brief).trim().slice(0, 1000);
      resizeInput();
      if (autoSend) window.setTimeout(sendMessage, 0);
    }
    window.setTimeout(function () { input.focus(); }, 0);
  }

  function closeDrawer() {
    drawer.hidden = true;
    backdrop.hidden = true;
    document.documentElement.classList.remove("wp-agent-is-open");
    document.querySelectorAll("[data-open-agent-drawer]").forEach(function (trigger) { trigger.setAttribute("aria-expanded", "false"); });
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  function showConversation() {
    historyView.hidden = true;
    conversationView.hidden = false;
    historyButton.setAttribute("aria-expanded", "false");
  }

  async function showHistory() {
    conversationView.hidden = true;
    historyView.hidden = false;
    historyButton.setAttribute("aria-expanded", "true");
    if (!signedIn) {
      historyList.replaceChildren();
      historyNote.textContent = "This conversation is private to this browser session. Sign in from the full Agent view to save briefs, requests, and prepared products.";
      return;
    }
    if (!historyLoaded) await loadHistory();
  }

  async function loadHistory() {
    historyList.replaceChildren(textNode("Loading saved conversations...", "wp-agent-history-note"));
    try {
      var page = await api(accountApi + "/conversations?limit=30");
      state.conversations = page.conversations || [];
      historyLoaded = true;
      renderHistory();
    } catch (error) {
      historyList.replaceChildren(textNode(error.message || "Saved conversations are temporarily unavailable.", "wp-agent-history-note"));
    }
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (!state.conversations.length) {
      historyList.appendChild(textNode("No saved conversations yet.", "wp-agent-history-note"));
      return;
    }
    state.conversations.forEach(function (conversation) {
      var button = element("button", { className: "wp-agent-history-item", type: "button" });
      button.appendChild(textNode(conversation.title || "Product request", "strong"));
      button.appendChild(textNode(conversation.updated_at ? formatDate(conversation.updated_at) : "Saved conversation", "span"));
      button.addEventListener("click", function () { openConversation(conversation.id); });
      historyList.appendChild(button);
    });
    historyNote.textContent = "Conversations, sourcing progress, and prepared products remain attached to your account.";
  }

  async function openConversation(id) {
    setBusy(true, "Opening conversation...");
    try {
      var page = await api(accountApi + "/conversations/" + encodeURIComponent(id));
      state.conversation = page.conversation || null;
      state.messages = page.messages || [];
      state.criteria = state.conversation && state.conversation.criteria || {};
      renderConversation();
      showConversation();
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function startNewConversation() {
    state.conversation = null;
    state.messages = [];
    state.publicMessages = [];
    state.criteria = {};
    state.cursor = "";
    state.sessionId = clientId("chat");
    state.productContextUsed = false;
    sourcingConfirm.hidden = true;
    renderConversation();
    showConversation();
    input.focus();
  }

  async function sendMessage(options) {
    var config = options || {};
    var value = String(config.message || input.value || "").trim();
    if (!value || state.busy) return;
    input.value = "";
    resizeInput();
    sourcingConfirm.hidden = true;
    clearStatus();
    var outgoing = contextualMessage(value);
    if (signedIn) {
      state.messages.push({ role: "user", content: value, message_key: clientId("pending"), payload: {} });
    } else {
      state.publicMessages.push({ role: "user", content: outgoing });
    }
    renderConversation();
    setBusy(true, "Searching the catalog and checking the brief...");
    try {
      if (signedIn) await sendAccountMessage(outgoing, config);
      else await sendPublicMessage(config);
      state.productContextUsed = true;
      renderConversation();
    } catch (error) {
      if (signedIn) state.messages.pop();
      else state.publicMessages.pop();
      input.value = value;
      resizeInput();
      renderConversation();
      showStatus(error.message || "The Shopping Agent is temporarily unavailable.", "error");
    } finally {
      setBusy(false);
      window.requestAnimationFrame(scrollToEnd);
    }
  }

  async function sendAccountMessage(value, config) {
    var response = await api(accountApi + "/chat", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: state.conversation && state.conversation.id || "",
        message_id: clientId("msg"),
        message: value,
        operation: config.operation || "chat",
        criteria: config.criteria || state.criteria || {},
        cursor: config.cursor || null,
        limit: 20,
      }),
    });
    var page = await api(accountApi + "/conversations/" + encodeURIComponent(response.conversation_id));
    state.conversation = page.conversation || null;
    state.messages = page.messages || [];
    state.criteria = state.conversation && state.conversation.criteria || {};
    historyLoaded = false;
  }

  async function sendPublicMessage(config) {
    if (!publicApi) throw new Error("The Shopping Agent API is not configured for this store.");
    var payload = await api(publicApi + "/api/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        messages: state.publicMessages.slice(-12),
        criteria: config.criteria || state.criteria || {},
        operation: config.operation || "chat",
        cursor: config.cursor || "",
        limit: 20,
      }),
    });
    state.sessionId = payload.session_id || state.sessionId;
    state.criteria = payload.criteria || state.criteria || {};
    state.cursor = payload.next_cursor || "";
    state.publicMessages.push({
      role: "assistant",
      content: payload.reply || payload.answer || "I could not find a confident catalog match.",
      payload: payload,
    });
  }

  function renderConversation() {
    var messages = signedIn ? state.messages : state.publicMessages;
    transcript.replaceChildren();
    welcome.hidden = messages.length > 0;
    if (!messages.length) transcript.appendChild(welcome);
    messages.forEach(function (message, index) {
      transcript.appendChild(renderTurn(message, index === messages.length - 1));
    });
    renderBrief();
    window.requestAnimationFrame(scrollToEnd);
  }

  function renderTurn(message, isLatest) {
    var payload = message.payload || {};
    var turn = element("article", { className: "wp-agent-turn" + (message.role === "user" ? " is-user" : "") });
    turn.appendChild(textNode(message.role === "user" ? "You" : "Send From China", "wp-agent-turn-label"));
    turn.appendChild(textNode(customerMessage(message.content), "wp-agent-turn-copy"));
    var results = preparedResults(payload.results);
    if (results.length) turn.appendChild(renderProducts(results));
    if (isLatest && message.role !== "user" && Array.isArray(payload.next_actions)) {
      turn.appendChild(renderActions(payload.next_actions.slice(0, 3), payload));
    }
    if (isLatest && message.role !== "user" && (payload.action === "sourcing" || payload.dynamic_request_recommended === true)) {
      showSourcingConfirmation();
    }
    return turn;
  }

  function renderProducts(results) {
    var grid = element("div", { className: "wp-agent-products" });
    results.slice(0, 3).forEach(function (result) { grid.appendChild(renderProduct(result)); });
    if (results.length > 3) {
      var more = element("details", { className: "wp-agent-products-more" });
      more.appendChild(textNode("View " + String(results.length - 3) + " more catalog matches", "summary"));
      var moreGrid = element("div", { className: "wp-agent-products" });
      results.slice(3).forEach(function (result) { moreGrid.appendChild(renderProduct(result)); });
      more.appendChild(moreGrid);
      grid.appendChild(more);
    }
    return grid;
  }

  function renderProduct(result) {
    var product = element("article", { className: "wp-agent-product" });
    var imageUrl = result.image || result.image_url || result.featured_image;
    var title = String(result.title || "Product");
    if (safeHttps(imageUrl)) product.appendChild(element("img", { src: imageUrl, alt: title }));
    var body = element("div", { className: "wp-agent-product-body" });
    body.appendChild(textNode(result.available === false ? "Check availability" : "Catalog match", "span"));
    body.appendChild(textNode(title, "h3"));
    var reason = plainText(result.why || result.summary || result.description || result.description_html || "Open the product page to review buying details.");
    body.appendChild(textNode(reason.slice(0, 180), "p"));
    var price = productPrice(result);
    if (price) body.appendChild(textNode(price, "wp-agent-product-price"));
    var url = result.product_url || result.url;
    if (safeHttps(url)) body.appendChild(link("View product", url));
    product.appendChild(body);
    return product;
  }

  function renderActions(actions, payload) {
    var panel = element("div", { className: "wp-agent-next-actions" });
    actions.forEach(function (action) {
      var button = element("button", { type: "button", text: action.label || action.message || "Continue" });
      button.addEventListener("click", function () {
        if (String(action.operation || "") === "dynamic_request") {
          showSourcingConfirmation();
          return;
        }
        sendMessage({
          message: action.message || action.label || "Continue",
          operation: action.operation || "chat",
          criteria: payload.criteria || state.criteria,
          cursor: payload.next_cursor || state.cursor,
        });
      });
      panel.appendChild(button);
    });
    return panel;
  }

  function renderBrief() {
    var criteria = state.criteria || {};
    var values = [criteria.use_case || criteria.category, criteria.price_max != null ? "up to $" + criteria.price_max : "", criteria.ship_to].filter(Boolean);
    briefNode.hidden = values.length === 0;
    briefSummary.textContent = values.join(" · ");
  }

  function showSourcingConfirmation() {
    sourcingFacts.replaceChildren();
    var criteria = state.criteria || {};
    var facts = [
      ["Request", criteria.use_case || criteria.category || latestUserText() || "Current shopping brief"],
      ["Budget", criteria.price_max != null ? "Up to $" + criteria.price_max : "Open"],
      ["Destination", criteria.ship_to || "Confirm on task page"],
      ["Initial results", "Up to 3 prepared matches"],
    ];
    facts.forEach(function (fact) {
      var row = element("div");
      row.appendChild(textNode(fact[0], "dt"));
      row.appendChild(textNode(fact[1], "dd"));
      sourcingFacts.appendChild(row);
    });
    sourcingConfirm.hidden = false;
  }

  function startSourcing() {
    var brief = latestUserText() || briefSummary.textContent || "Help me source a product";
    try { window.sessionStorage.setItem("sfc:pending-agent-brief", brief); } catch (_error) {}
    var target = new URL(workspaceUrl, window.location.origin);
    target.searchParams.set("brief", brief.slice(0, 1000));
    target.searchParams.set("handoff_id", clientId("handoff").replace(/-/g, ""));
    if (signedIn) {
      window.location.assign(target.href);
      return;
    }
    var login = new URL(loginUrl, window.location.origin);
    login.searchParams.set("return_to", target.pathname + target.search);
    window.location.assign(login.href);
  }

  function contextualMessage(value) {
    if (state.productContextUsed || !root.dataset.productTitle) return value;
    return "Regarding the current product, \"" + root.dataset.productTitle + "\" (" + root.dataset.productUrl + "): " + value;
  }

  function customerMessage(value) {
    return String(value || "").replace(/^Regarding the current product,\s*"[^"]+"\s*\([^)]*\):\s*/i, "");
  }

  function renderProductContext() {
    if (!root.dataset.productTitle) return;
    contextNode.hidden = false;
    root.querySelector("[data-agent-context-title]").textContent = root.dataset.productTitle;
    root.querySelector("[data-agent-context-price]").textContent = root.dataset.productPrice || "";
  }

  function latestUserText() {
    var messages = signedIn ? state.messages : state.publicMessages;
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index] && messages[index].role === "user") return customerMessage(messages[index].content);
    }
    return "";
  }

  function setBusy(value, message) {
    state.busy = Boolean(value);
    send.disabled = state.busy;
    input.disabled = state.busy;
    transcript.setAttribute("aria-busy", state.busy ? "true" : "false");
    var thinking = transcript.querySelector("[data-agent-thinking]");
    if (thinking) thinking.remove();
    if (state.busy) {
      var turn = element("article", { className: "wp-agent-turn is-thinking" });
      turn.dataset.agentThinking = "true";
      turn.appendChild(textNode("Send From China", "wp-agent-turn-label"));
      turn.appendChild(textNode(message || "Working...", "wp-agent-turn-copy"));
      transcript.appendChild(turn);
      scrollToEnd();
    }
  }

  function showStatus(message, tone) {
    statusNode.textContent = message || "Something went wrong.";
    statusNode.dataset.tone = tone || "error";
    statusNode.hidden = false;
  }

  function clearStatus() {
    statusNode.hidden = true;
    statusNode.textContent = "";
    delete statusNode.dataset.tone;
  }

  async function api(url, options) {
    var config = options || {};
    var response = await fetch(url, {
      method: config.method || "GET",
      credentials: signedIn && url.indexOf(accountApi) === 0 ? "same-origin" : "omit",
      headers: { "Accept": "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: config.body,
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(response.status === 429
        ? "The catalog is receiving a lot of requests. Please wait a moment and try again."
        : payload.message || payload.error || "The Shopping Agent is temporarily unavailable.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function preparedResults(results) {
    if (!Array.isArray(results)) return [];
    return results.filter(function (result) {
      return result && String(result.title || "").trim() && safeHttps(result.product_url || result.url);
    });
  }

  function productPrice(result) {
    var raw = result.price_usd != null ? result.price_usd : result.price;
    var amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return "";
    return (result.price_varies ? "From " : "") + "$" + amount.toFixed(2) + " " + (result.currency || "USD");
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(126, Math.max(46, input.scrollHeight)) + "px";
  }

  function trapFocus(event) {
    var focusable = Array.from(drawer.querySelectorAll("a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex='-1'])"))
      .filter(function (node) { return !node.hidden && node.getClientRects().length > 0; });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function scrollToEnd() { transcript.scrollTop = transcript.scrollHeight; }
  function safeHttps(value) { try { return new URL(String(value || "")).protocol === "https:"; } catch (_error) { return false; } }
  function plainText(value) { return new DOMParser().parseFromString(String(value || ""), "text/html").body.textContent || ""; }
  function formatDate(value) { var date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "Saved conversation" : date.toLocaleString(); }
  function clientId(prefix) { return prefix + "_" + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().replace(/-/g, "") : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  function link(label, href) { var output = element("a", { text: label, href: href }); return output; }
  function textNode(value, className) { return element(className === "strong" || className === "span" || className === "h3" || className === "p" || className === "summary" || className === "dt" || className === "dd" ? className : "p", { className: !["strong", "span", "h3", "p", "summary", "dt", "dd"].includes(className) ? className : "", text: value }); }
  function element(tag, options) {
    var output = document.createElement(tag);
    var values = options || {};
    if (values.className) output.className = values.className;
    if (values.text !== undefined) output.textContent = String(values.text);
    if (values.type) output.type = values.type;
    if (values.href) output.href = values.href;
    if (values.src) output.src = values.src;
    if (values.alt !== undefined) output.alt = values.alt;
    return output;
  }
})();
