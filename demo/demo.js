(() => {
  const drawer = document.querySelector(".drawer");
  const backdrop = document.querySelector(".backdrop");
  const conversation = document.querySelector("[data-conversation]");
  const form = document.querySelector(".composer");
  const input = document.querySelector("#message");

  function open(brief = "") {
    drawer.hidden = false;
    backdrop.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if (brief) input.value = brief;
    setTimeout(() => input.focus(), 0);
  }
  function close() {
    drawer.hidden = true;
    backdrop.hidden = true;
    document.documentElement.style.overflow = "";
  }
  document.querySelectorAll("[data-open-agent]").forEach((button) => button.addEventListener("click", () => open()));
  document.querySelectorAll("[data-close-agent]").forEach((button) => button.addEventListener("click", close));
  document.querySelectorAll("[data-starter]").forEach((button) => button.addEventListener("click", () => {
    input.value = button.textContent;
    form.requestSubmit();
  }));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !drawer.hidden) close(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    conversation.querySelector(".welcome")?.remove();
    const user = document.createElement("article");
    user.className = "turn user";
    user.textContent = message;
    conversation.append(user);
    const pending = document.createElement("article");
    pending.className = "turn agent";
    pending.innerHTML = "<small>SEND FROM CHINA · DEMO</small><p>Applying the demo boundary…</p><div class=\"trace\"><span class=\"is-active\">Request</span><span>Policy</span><span>Cards</span></div>";
    conversation.append(pending);
    conversation.scrollTop = conversation.scrollHeight;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: message }] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "request_failed");
      pending.querySelector("p").textContent = payload.reply;
      const trace = pending.querySelector(".trace");
      trace.innerHTML = "";
      payload.trace.forEach((step) => {
        const item = document.createElement("span");
        item.className = step.state === "complete" ? "is-complete" : "";
        item.textContent = step.label;
        trace.append(item);
      });
      const row = document.createElement("div");
      row.className = "result-row";
      payload.results.forEach((product) => {
        const card = document.createElement("div");
        card.className = "result";
        card.innerHTML = `<small>ILLUSTRATIVE</small><b>${product.emoji} ${product.title}</b><span>${product.tag}</span><strong>${product.price}</strong>`;
        row.append(card);
      });
      pending.append(row);
    } catch {
      pending.querySelector("p").textContent = "The local demo service is unavailable. Restart it with node demo/server.mjs.";
    }
    conversation.scrollTop = conversation.scrollHeight;
  });
})();
