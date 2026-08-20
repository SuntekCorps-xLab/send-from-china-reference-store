/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

const API = "https://example.invalid/api/account";
export default function extension() {
  render(<AskWpPage />, document.body);
}

function AskWpPage() {
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState({});
  const [products, setProducts] = useState([]);
  const [cursor, setCursor] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [nextActions, setNextActions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [conversationRevision, setConversationRevision] = useState(0);
  const [sessionId] = useState(newChatSessionId);

  async function send(options = {}) {
    const text = String(options.message || query).trim();
    if (!text || busy) return;
    const nextMessages = [...messages, { role: "user", content: text }].slice(-12);
    setMessages(nextMessages);
    setQuery("");
    setBusy(true);
    setError("");
    try {
      const payload = await accountFetch("/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: nextMessages,
          criteria: options.criteria || criteria,
          cursor: options.cursor || "",
          operation: options.operation || "chat",
          limit: 20,
          session_id: sessionId,
        }),
      });
      setMessages([...nextMessages, { role: "assistant", content: payload.reply || payload.answer || "" }].slice(-12));
      setCriteria(payload.criteria || criteria);
      setProducts(payload.results || []);
      setCursor(payload.next_cursor || "");
      setRequestQuery(payload.request_query || text);
      setNextActions((payload.next_actions || []).slice(0, 3));
      setConversationRevision(value => value + 1);
    } catch (cause) {
      setError(String(cause?.message || "The product concierge is temporarily unavailable."));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const payload = await accountFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ messages, criteria, cursor, operation: "more", limit: 20, session_id: sessionId }),
      });
      setProducts([...products, ...(payload.results || [])]);
      setCursor(payload.next_cursor || "");
    } catch (cause) {
      setError(String(cause?.message || "More products could not be loaded."));
    } finally {
      setBusy(false);
    }
  }

  async function createTask(planId) {
    setBusy(true);
    setError("");
    try {
      const payload = await accountFetch("/tasks", {
        method: "POST",
        body: JSON.stringify({
          query: requestQuery || latestUser(messages),
          criteria,
          plan_id: planId,
          idempotency_key: `account-chat:${sessionId}:${conversationRevision}:${planId}`,
        }),
      });
      setNotice(`Request ${payload.task.id} was created. Track it in your sourcing workspace.`);
    } catch (cause) {
      setError(String(cause?.message || "The product request could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <s-page heading="Product concierge" subheading="Made in China. Select and Deliver. We will clarify your brief and ask for confirmation before searching.">
      <s-button slot="primary-action" href="https://example.invalid/apps/wp-account/workspace">Open saved workspace</s-button>
      {error ? <s-banner tone="critical">{error}</s-banner> : null}
      {notice ? <s-banner tone="success">{notice}</s-banner> : null}

      <s-section heading="Conversation">
        <s-stack direction="block" gap="base">
          {messages.length ? messages.map((message, index) => (
            <s-banner key={`${message.role}-${index}`} tone={message.role === "user" ? "info" : "auto"}>
              <s-text type="strong">{message.role === "user" ? "You" : "Send From China"}</s-text>
              <s-text>{message.content}</s-text>
            </s-banner>
          )) : <s-text>Start with a product, use case, recipient, or problem you want to solve.</s-text>}
          {nextActions.length ? (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {nextActions.map((action, index) => (
                <s-button
                  key={`next-${index}`}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => send({
                    message: action.message || action.label || "Continue",
                    operation: action.operation || "chat",
                    criteria: action.criteria || criteria,
                    cursor: action.cursor || "",
                  })}
                >
                  {action.label || action.message || "Continue"}
                </s-button>
              ))}
              <s-button variant="secondary" disabled={busy} onClick={() => setQuery("")}>Ask something else</s-button>
            </s-stack>
          ) : null}
          <s-text-field
            label="What are you looking for?"
            value={query}
            onInput={event => setQuery(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === "Enter") send(); }}
          />
          <s-button onClick={send} loading={busy} disabled={!query.trim() || busy}>Send</s-button>
        </s-stack>
      </s-section>

      {products.length ? (
        <s-section heading="Matching products">
          <s-stack direction="block" gap="base">
            <s-text>Showing {products.length} governed catalog matches. Refine the conversation for a different set.</s-text>
            {products.map(product => (
              <s-stack key={product.handle || product.url} direction="inline" gap="base" alignItems="center">
                <s-text><s-text type="strong">{product.title}</s-text>{product.price_usd != null ? ` - $${Number(product.price_usd).toFixed(2)}` : ""}</s-text>
                <s-button href={product.url} variant="secondary">View</s-button>
              </s-stack>
            ))}
            {cursor ? <s-button variant="secondary" onClick={loadMore} loading={busy}>See more</s-button> : null}
            {criteria.category ? (
              <s-button variant="secondary" href={catalogBrowseUrl(criteria.category)}>
                Browse the full {criteria.category} catalog
              </s-button>
            ) : null}
            <s-text>Tell me what should change and I will refine the next set.</s-text>
          </s-stack>
        </s-section>
      ) : null}

      {requestQuery ? (
        <s-section heading="Start a targeted product request">
          <s-stack direction="block" gap="base">
            <s-text>Search a focused source pool when the existing catalog does not fit. The current pilot evaluates up to 30 candidates and returns up to three matches.</s-text>
            <s-button onClick={() => createTask("preview")} disabled={busy}>Free 30-candidate preview</s-button>
            <s-text color="subdued">Open your sourcing workspace to choose a free preview or an available credit plan.</s-text>
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

async function accountFetch(path, options = {}) {
  const token = await shopify.sessionToken.get();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || "WP request failed");
  return payload;
}

function latestUser(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index].content;
  }
  return "";
}

function catalogBrowseUrl(category) {
  return `https://example.invalid/search?q=${encodeURIComponent(String(category || ""))}`;
}

function newChatSessionId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `chat_${[...bytes].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}
