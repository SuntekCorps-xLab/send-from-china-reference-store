(function () {
  "use strict";
  var root = document.querySelector("[data-wp-agent-drawer]");
  var runtime = window.WPShopifyRuntime;
  if (!root || !runtime || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";
  var drawer = root.querySelector(".wp-agent-drawer");
  var backdrop = root.querySelector(".wp-agent-backdrop");
  var input = root.querySelector("[data-agent-input]");
  var send = root.querySelector("[data-agent-send]");
  var transcript = root.querySelector("[data-agent-transcript]");
  var notice = root.querySelector("[data-agent-status]");
  var previousFocus;
  var busy = false;
  function availability() {
    input.disabled = busy || !runtime.canSearch();
    send.disabled = busy || !runtime.canSearch();
    root.querySelectorAll("[data-agent-starter]").forEach(function (button) { button.disabled = input.disabled; });
  }
  window.addEventListener("wp:runtime-status", availability);
  function open(brief, autoSend, trigger) {
    previousFocus = trigger || document.activeElement;
    drawer.hidden = false;
    backdrop.hidden = false;
    document.documentElement.classList.add("wp-agent-is-open");
    document.querySelectorAll("[data-open-agent-drawer]").forEach(function (node) { node.setAttribute("aria-expanded", "true"); });
    if (brief) input.value = String(brief).slice(0, 300);
    availability();
    (input.disabled ? root.querySelector("[data-runtime-doctor]") : input).focus();
    if (autoSend) runtime.status().then(function () { if (runtime.canSearch()) submit(); }).catch(function () {});
  }
  function close() {
    drawer.hidden = true;
    backdrop.hidden = true;
    document.documentElement.classList.remove("wp-agent-is-open");
    document.querySelectorAll("[data-open-agent-drawer]").forEach(function (node) { node.setAttribute("aria-expanded", "false"); });
    if (previousFocus) previousFocus.focus();
  }
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-open-agent-drawer]");
    if (trigger) { event.preventDefault(); open(trigger.dataset.agentBrief, trigger.dataset.agentAutoSend === "true", trigger); }
  });
  window.addEventListener("wp:open-agent", function (event) { open((event.detail || {}).brief, (event.detail || {}).autoSend); });
  root.querySelectorAll("[data-agent-close]").forEach(function (node) { node.addEventListener("click", close); });
  document.addEventListener("keydown", function (event) {
    if (drawer.hidden) return;
    if (event.key === "Escape") close();
    if (event.key !== "Tab") return;
    var nodes = Array.from(drawer.querySelectorAll("button:not([disabled]),textarea:not([disabled]),a[href]"))
      .filter(function (node) { return node.getClientRects().length > 0; });
    var first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  root.querySelector("[data-runtime-doctor]").addEventListener("click", async function () {
    var button = this;
    button.disabled = true;
    var result = root.querySelector("[data-runtime-doctor-result]");
    try {
      var value = await runtime.doctor();
      result.textContent = value.ok ? "Connection check passed. Catalog reads are available." : "Connection check failed. Review the credential state above.";
    } catch (error) { result.textContent = error.message; }
    finally { button.disabled = false; availability(); }
  });
  root.querySelector("[data-agent-form]").addEventListener("submit", function (event) { event.preventDefault(); submit(); });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  });
  root.querySelectorAll("[data-agent-starter]").forEach(function (button) {
    button.addEventListener("click", function () { input.value = button.dataset.agentStarter.slice(0, 300); submit(); });
  });
  function node(tag, text, className) {
    var item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function summary(search) {
    if (search.status === "degraded" || (search.search_scope && search.search_scope.degraded))
      return "Search is incomplete. These results do not establish that the catalog has no match.";
    if (search.status === "needs_clarification") return "Please refine the product description to continue.";
    if (search.status === "no_match") return "No matches in the checked catalog scope. Try a different product description.";
    return "Shopify catalog matches. Check the product page for current buying details.";
  }
  async function submit() {
    var query = input.value.trim();
    if (!query || query.length > 300 || busy || !runtime.canSearch()) return;
    busy = true; availability(); notice.hidden = true;
    transcript.setAttribute("aria-busy", "true");
    try {
      var receipt = await runtime.run(query);
      transcript.replaceChildren(node("p", query, "wp-agent-turn is-user"), node("p", summary(receipt.search), "wp-agent-turn-copy"));
      receipt.search.results.forEach(function (product) {
        var card = node("article", "", "wp-agent-product");
        if (product.image && /^https:\/\/cdn\.shopify\.com\//i.test(product.image)) {
          var image = node("img"); image.src = product.image; image.alt = product.title; image.loading = "lazy"; card.append(image);
        }
        var body = node("div", "", "wp-agent-product-body");
        body.append(node("h3", product.title), node("p", product.summary));
        if (product.price && Number.isFinite(product.price.amount) && /^[A-Z]{3}$/.test(product.price.currency)) {
          body.append(node("p", new Intl.NumberFormat(undefined, { style: "currency", currency: product.price.currency }).format(product.price.amount)));
        }
        var link = node("a", "View product"); link.href = runtime.productPath(product.product_url, product.handle);
        body.append(link); card.append(body); transcript.append(card);
      });
      if (receipt.search.relaxations.length) transcript.append(node("p", "Some requested conditions could not be verified. Review product details before choosing."));
      input.value = "";
    } catch (error) {
      transcript.replaceChildren();
      notice.textContent = error.message; notice.hidden = false;
    } finally { busy = false; availability(); transcript.setAttribute("aria-busy", "false"); }
  }
  availability();
})();