/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchCustomerOrders, formatFulfillmentStatus, trackingActionUrl } from "./tracking.js";

const API = "https://example.invalid/api/account";

export default async () => {
  render(<AccountPage />, document.body);
};

function AccountPage() {
  const [summary, setSummary] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationTasks, setConversationTasks] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState("");
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState([]);
  const [resultCursor, setResultCursor] = useState("");
  const [governance, setGovernance] = useState({ jobs: [], messages: [] });
  const [governanceCursor, setGovernanceCursor] = useState("");
  const [governanceBusy, setGovernanceBusy] = useState("");
  const [keys, setKeys] = useState([]);
  const [newToken, setNewToken] = useState("");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initialize().catch(fail);
    refreshOrders().catch(failOrders);
  }, []);

  useEffect(() => {
    if (!selected || !hasPendingGovernance(governance.jobs)) return undefined;
    const timer = setInterval(() => {
      refreshGovernance(selected.id).catch(fail);
    }, 15_000);
    return () => clearInterval(timer);
  }, [selected?.id, governance.jobs.map(job => `${job.id}:${job.state}`).join("|")]);

  async function initialize() {
    setLoading(true);
    const overview = await refreshOverview();
    if (overview.conversations.length) {
      await openConversation(overview.conversations[0].id);
    }
    setLoading(false);
  }

  async function refreshOverview() {
    const [summaryPage, conversationPage, taskPage, keyPage] = await Promise.all([
      accountFetch("/summary"),
      accountFetch("/conversations?limit=30"),
      accountFetch("/tasks?limit=20"),
      accountFetch("/agent-keys"),
    ]);
    const nextConversations = conversationPage.conversations || [];
    setSummary(summaryPage);
    setConversations(nextConversations);
    setTasks(taskPage.tasks || []);
    setKeys(keyPage.keys || []);
    return { conversations: nextConversations };
  }

  async function openConversation(id) {
    const page = await accountFetch(`/conversations/${encodeURIComponent(id)}`);
    setConversation(page.conversation || null);
    setMessages(page.messages || []);
    setConversationTasks(page.tasks || []);
  }

  function newConversation() {
    setConversation(null);
    setMessages([]);
    setConversationTasks([]);
    setChatInput("");
    setError("");
  }

  async function sendChat(options = {}) {
    const content = String(options.message || chatInput).trim();
    if (!content || chatBusy) return;
    setChatBusy(true);
    setError("");
    setChatInput("");
    try {
      const response = await accountFetch("/chat", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversation?.id || "",
          message_id: newClientMessageId(),
          message: content,
          operation: options.operation || "chat",
          criteria: options.criteria || conversation?.criteria || {},
          cursor: options.cursor || null,
          limit: 20,
        }),
      });
      await openConversation(response.conversation_id);
      await refreshOverview();
    } catch (cause) {
      setChatInput(content);
      fail(cause);
      await refreshOverview().catch(() => {});
    } finally {
      setChatBusy(false);
    }
  }

  async function createSourcingTask(planId) {
    if (!conversation || taskBusy) return;
    const latest = latestUserMessage(messages);
    if (!latest) {
      setError("Tell the product concierge what you need before starting a deeper search.");
      return;
    }
    setTaskBusy(planId);
    setError("");
    try {
      await accountFetch("/tasks", {
        method: "POST",
        body: JSON.stringify({
          query: conversation.title === latest.content
            ? latest.content
            : `${conversation.title}. ${latest.content}`,
          criteria: conversation.criteria || {},
          plan_id: planId,
          conversation_id: conversation.id,
          idempotency_key: taskIdempotencyKey(conversation.id, latest.message_key, planId),
        }),
      });
      await Promise.all([openConversation(conversation.id), refreshOverview()]);
    } catch (cause) {
      fail(cause);
    } finally {
      setTaskBusy("");
    }
  }

  async function refreshOrders() {
    setOrdersLoading(true);
    setOrdersError("");
    try {
      setOrders(await fetchCustomerOrders(20));
    } finally {
      setOrdersLoading(false);
    }
  }

  async function openTask(task) {
    setSelected(task);
    setResults([]);
    setResultCursor("");
    setGovernance({ jobs: [], messages: [] });
    setGovernanceCursor("");
    const [page, governancePage] = await Promise.all([
      accountFetch(`/tasks/${encodeURIComponent(task.id)}/results?limit=20`),
      accountFetch(`/tasks/${encodeURIComponent(task.id)}/governance?limit=20`),
    ]);
    setSelected(page.task || task);
    setResults(page.results || []);
    setResultCursor(page.next_cursor || "");
    setGovernance({ jobs: governancePage.jobs || [], messages: governancePage.messages || [] });
    setGovernanceCursor(governancePage.next_cursor || "");
  }

  async function refreshGovernance(taskId = selected?.id) {
    if (!taskId) return;
    const page = await accountFetch(`/tasks/${encodeURIComponent(taskId)}/governance?limit=20`);
    setGovernance({ jobs: page.jobs || [], messages: page.messages || [] });
    setGovernanceCursor(page.next_cursor || "");
    if (conversation?.id) await openConversation(conversation.id);
  }

  async function startGovernance(result) {
    if (!selected || governanceBusy) return;
    setGovernanceBusy(result.id);
    setError("");
    try {
      await accountFetch(
        `/tasks/${encodeURIComponent(selected.id)}/results/${encodeURIComponent(result.id)}/governance`,
        {
          method: "POST",
          body: JSON.stringify({ content_version: "amazon-us-en-v1" }),
        },
      );
      await refreshGovernance(selected.id);
    } catch (cause) {
      fail(cause);
    } finally {
      setGovernanceBusy("");
    }
  }

  async function loadMoreResults() {
    if (!selected || !resultCursor) return;
    const page = await accountFetch(
      `/tasks/${encodeURIComponent(selected.id)}/results?limit=20&cursor=${encodeURIComponent(resultCursor)}`,
    );
    setSelected(page.task || selected);
    setResults(current => [...current, ...(page.results || [])]);
    setResultCursor(page.next_cursor || "");
  }

  async function unlockFullResults() {
    if (!selected || taskBusy) return;
    setTaskBusy("unlock-results");
    setError("");
    try {
      await accountFetch(`/tasks/${encodeURIComponent(selected.id)}/results/unlock`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await Promise.all([openTask(selected), refreshOverview()]);
    } catch (cause) {
      fail(cause);
    } finally {
      setTaskBusy("");
    }
  }

  async function loadMoreGovernance() {
    if (!selected || !governanceCursor) return;
    const page = await accountFetch(
      `/tasks/${encodeURIComponent(selected.id)}/governance?limit=20&cursor=${encodeURIComponent(governanceCursor)}`,
    );
    setGovernance(current => ({
      jobs: [...current.jobs, ...(page.jobs || [])],
      messages: [...current.messages, ...(page.messages || [])],
    }));
    setGovernanceCursor(page.next_cursor || "");
  }

  async function createKey() {
    setNewToken("");
    const response = await accountFetch("/agent-keys", {
      method: "POST",
      body: JSON.stringify({ label: "My shopping agent" }),
    });
    setNewToken(response.token || "");
    await refreshOverview();
  }

  async function revokeKey(id) {
    await accountFetch(`/agent-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshOverview();
  }

  function fail(cause) {
    setError(String(cause?.message || "The sourcing workspace is temporarily unavailable."));
    setLoading(false);
  }

  function failOrders(cause) {
    setOrdersError(String(cause?.message || "Order tracking is temporarily unavailable."));
    setOrdersLoading(false);
  }

  if (loading) {
    return (
      <s-page heading="Sourcing workspace">
        <s-section><s-spinner accessibilityLabel="Loading sourcing workspace" /></s-section>
      </s-page>
    );
  }

  const availableCredits = Number(summary?.credits?.available || 0);
  const paidCreditsEnabled = Boolean(summary?.payment?.enabled);
  const plans = (summary?.plans || []).filter(plan => plan.id === "preview" || paidCreditsEnabled);
  const paymentProducts = summary?.payment?.products || [];
  const visibleMessages = visibleConversationMessages(messages);

  return (
    <s-page heading="My sourcing workspace" subheading="Made in China. Select and Deliver. One account for conversations, product requests, orders, and Agent access.">
      <s-button slot="primary-action" href="https://example.invalid">Browse catalog</s-button>
      {error ? <s-banner tone="critical" heading="Workspace notice">{error}</s-banner> : null}

      <s-section heading="Your Send From China account">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone="success">Account active</s-badge>
            {paidCreditsEnabled ? (
              <s-text><s-text type="strong">{availableCredits}</s-text> search credits available</s-text>
            ) : (
              <s-text><s-text type="strong">Free preview</s-text> pilot access</s-text>
            )}
            <s-text>{summary?.tasks?.active || 0} active product requests</s-text>
          </s-stack>
          <s-text color="subdued">WP account ID: {summary?.account?.santai_customer_id || "Initializing"}</s-text>
          {paidCreditsEnabled ? (
            <s-stack direction="block" gap="small-200">
              <s-heading>Add credits with Shopify Checkout</s-heading>
              {paymentProducts.map(product => (
                <s-stack key={`${product.plan_id}-${product.checkout_url}`} direction="inline" gap="base" alignItems="center">
                  <s-text>{product.title || product.plan_id} - {product.credits || 0} search credits</s-text>
                  <s-button href={product.checkout_url}>Add credits</s-button>
                </s-stack>
              ))}
            </s-stack>
          ) : (
            <s-banner tone="info" heading="Credit checkout is being configured">
              Free conversation and the 30-candidate preview remain available. Paid credit buttons appear only after approved Shopify service-product variants are configured.
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Conversations">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={newConversation}>New conversation</s-button>
            <s-button variant="secondary" onClick={() => refreshOverview().catch(fail)}>Refresh</s-button>
          </s-stack>
          {conversations.length ? conversations.map(item => (
            <s-stack key={item.id} direction="inline" gap="base" alignItems="center">
              <s-button variant={conversation?.id === item.id ? "primary" : "secondary"} onClick={() => openConversation(item.id).catch(fail)}>
                {item.title}
              </s-button>
              <s-text color="subdued">{formatDate(item.updated_at)}</s-text>
            </s-stack>
          )) : <s-text>Your first message will create a private, saved conversation.</s-text>}
        </s-stack>
      </s-section>

      <s-section heading={conversation?.title || "Product concierge"}>
        <s-stack direction="block" gap="base">
          <s-text>Describe the product, recipient, use case, budget, quantity, and destination. We will clarify the brief and ask for confirmation before returning up to 20 products.</s-text>
          {visibleMessages.length ? visibleMessages.map(message => (
            <ConversationMessage
              key={message.id}
              message={message}
              busy={chatBusy}
              onAction={(action, payload) => sendChat({
                message: action.message || action.label || "Continue",
                operation: action.operation || "chat",
                criteria: payload.criteria || conversation?.criteria || {},
                cursor: payload.next_cursor || null,
              })}
              onCustom={() => setChatInput("")}
            />
          )) : (
            <s-text color="subdued">This conversation is empty. Start with what you are trying to buy or solve.</s-text>
          )}
          {chatBusy ? <s-spinner accessibilityLabel="The product concierge is replying" /> : null}
          <s-text-field
            label="Message"
            value={chatInput}
            placeholder="What are you looking for?"
            onInput={event => setChatInput(event.currentTarget.value)}
            disabled={chatBusy}
          />
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={sendChat} loading={chatBusy} disabled={!chatInput.trim() || chatBusy}>Send</s-button>
            {conversation?.criteria && Object.keys(conversation.criteria).length ? (
              <s-text color="subdued">Saved criteria: {criteriaSummary(conversation.criteria)}</s-text>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      {conversation ? (
        <s-section heading="Start a targeted product request">
          <s-stack direction="block" gap="base">
            <s-text>Start a saved product search after the conversation captures what you need. Matches and product-preparation updates return to this same conversation.</s-text>
            <s-stack direction="inline" gap="base" alignItems="center">
              {plans.map(plan => (
                <s-button
                  key={plan.id}
                  variant={plan.id === "preview" ? "primary" : "secondary"}
                  onClick={() => createSourcingTask(plan.id)}
                  loading={taskBusy === plan.id}
                  disabled={Boolean(taskBusy) || (plan.credits > 0 && availableCredits < plan.credits)}
                >
                  {planLabel(plan)}
                </s-button>
              ))}
            </s-stack>
            {plans.some(plan => plan.credits > availableCredits) && !paidCreditsEnabled ? (
              <s-text color="subdued">Paid searches stay disabled until approved credit products are configured.</s-text>
            ) : null}
            {conversationTasks.map(task => (
              <s-stack key={task.id} direction="inline" gap="base" alignItems="center">
                <s-badge tone={taskTone(task.status)}>{task.status}</s-badge>
                <s-text>{task.plan_id} - {task.result_count} results - {task.published_count} ready to buy</s-text>
                <s-button variant="secondary" onClick={() => openTask(task)}>Open request</s-button>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Order tracking">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>Your customer account shows your orders, carrier, shipment status, and authoritative tracking number.</s-text>
            <s-button variant="secondary" onClick={() => refreshOrders().catch(failOrders)}>Refresh orders</s-button>
          </s-stack>
          {ordersLoading ? <s-spinner accessibilityLabel="Loading order tracking" /> : null}
          {ordersError ? <s-banner tone="warning" heading="Tracking unavailable">{ordersError}</s-banner> : null}
          {!ordersLoading && !ordersError && !orders.length ? <s-text>No orders are available for this account yet.</s-text> : null}
          {orders.map(order => (
            <s-stack key={order.id} direction="block" gap="small-200">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-heading>{order.name}</s-heading>
                <s-badge tone={order.tracking.length ? "success" : "info"}>{formatFulfillmentStatus(order.fulfillmentStatus)}</s-badge>
                {order.statusPageUrl ? <s-button variant="secondary" href={order.statusPageUrl}>Order details</s-button> : null}
              </s-stack>
              {order.tracking.length ? order.tracking.map((tracking, index) => {
                const actionUrl = trackingActionUrl(tracking.url);
                return (
                  <s-stack key={`${tracking.company}-${tracking.number}-${index}`} direction="inline" gap="base" alignItems="center">
                    <s-text>{tracking.company || "Carrier"}: <s-text type="strong">{tracking.number || "Tracking link ready"}</s-text></s-text>
                    {actionUrl ? <s-button href={actionUrl}>Track shipment</s-button> : null}
                  </s-stack>
                );
              }) : <s-text color="subdued">Awaiting an authoritative carrier tracking number. No placeholder number is shown.</s-text>}
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="All product requests">
        <s-stack direction="block" gap="base">
          {tasks.length ? tasks.map(task => (
            <s-stack key={task.id} direction="inline" gap="base" alignItems="center">
              <s-text><s-text type="strong">{task.query}</s-text> - {task.status} - {task.published_count} purchasable</s-text>
              <s-button variant="secondary" onClick={() => openTask(task)}>View results</s-button>
            </s-stack>
          )) : <s-text>No dynamic product requests yet.</s-text>}
        </s-stack>
      </s-section>

      {selected ? (
        <s-section heading={`Results for ${selected.query}`}>
          <s-stack direction="block" gap="base">
            <s-text>{selected.result_count} product matches - {selected.published_count} ready to buy</s-text>
            {!selected.full_results_unlocked && selected.result_count > selected.human_result_limit ? (
              <s-banner tone="info" heading="More private matches are ready for preparation">
                <s-stack direction="block" gap="small-200">
                  <s-text>Use {selected.full_results_unlock_credits} WP Credits to prepare up to 3 more WP product cards with image cleanup and translated details.</s-text>
                  <s-button
                    onClick={unlockFullResults}
                    loading={taskBusy === "unlock-results"}
                    disabled={Boolean(taskBusy) || availableCredits < selected.full_results_unlock_credits}
                  >
                    Prepare 3 more products
                  </s-button>
                  {availableCredits < selected.full_results_unlock_credits ? <s-text color="subdued">Add credits above to unlock these results.</s-text> : null}
                </s-stack>
              </s-banner>
            ) : null}
            {results.length ? results.map(result => (
              <ProductResult key={result.id} result={result}>
                {result.governance_status === "CANDIDATE" ? (
                  <s-button
                    onClick={() => startGovernance(result)}
                    loading={governanceBusy === result.id}
                    disabled={Boolean(governanceBusy) || Boolean(governanceForCandidate(governance.jobs, result.id))}
                  >
                    {governanceForCandidate(governance.jobs, result.id)
                      ? governanceActionLabel(governanceForCandidate(governance.jobs, result.id).state)
                      : "Prepare this product"}
                  </s-button>
                ) : null}
                {result.governance_status === "GOVERNED" ? <s-badge tone="info">Product page processing</s-badge> : null}
              </ProductResult>
            )) : <s-text>No product matches have been delivered yet.</s-text>}
            {resultCursor ? <s-button variant="secondary" onClick={loadMoreResults}>Load 20 more</s-button> : null}
            {governance.jobs.length ? (
              <s-stack direction="block" gap="base">
                <s-heading>Product preparation requests</s-heading>
                <s-button variant="secondary" onClick={() => refreshGovernance().catch(fail)}>Refresh request status</s-button>
                {governance.jobs.map(job => <GovernanceRequest key={job.id} job={job} />)}
                {governanceCursor ? <s-button variant="secondary" onClick={loadMoreGovernance}>Load 20 more preparation requests</s-button> : null}
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Developer and Agent access">
        <s-stack direction="block" gap="base">
          <s-text>Create a revocable key so your own Agent can submit product requests and page through structured results.</s-text>
          <s-button onClick={createKey}>Create Agent key</s-button>
          {newToken ? (
            <s-banner tone="warning" heading="Copy this key now">
              <s-text>{newToken}</s-text>
              <s-text>It will not be shown again.</s-text>
            </s-banner>
          ) : null}
          {keys.map(key => (
            <s-stack key={key.id} direction="inline" gap="base" alignItems="center">
              <s-text>{key.label} - {key.prefix}{key.revoked_at ? " - revoked" : ""}</s-text>
              {!key.revoked_at ? <s-button variant="secondary" tone="critical" onClick={() => revokeKey(key.id)}>Revoke</s-button> : null}
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function ConversationMessage({ message, busy = false, onAction, onCustom }) {
  const payload = message.payload || {};
  const preview = payload.preview || {};
  return (
    <s-stack direction="block" gap="small-200">
      <s-text color="subdued">{message.role === "user" ? "You" : "Send From China"}</s-text>
      {message.content ? <s-text>{message.content}</s-text> : null}
      {payload.status ? <s-badge tone={taskTone(payload.status)}>{payload.status}</s-badge> : null}
      {payload.results?.length ? (
        <s-stack direction="block" gap="base">
          {payload.results.map(result => <ProductResult key={`${message.id}-${result.id || result.product_url}`} result={result} />)}
        </s-stack>
      ) : null}
      {preview.title || preview.images?.length ? (
        <s-stack direction="block" gap="small-200">
          {preview.images?.length ? (
            <s-stack direction="inline" gap="small-200">
              {preview.images.slice(0, 4).map(image => (
                <s-box key={image} inlineSize="96px" blockSize="96px" overflow="hidden" borderRadius="base">
                  <s-image src={image} alt={preview.title || "Governed product"} inlineSize="fill" aspectRatio="1/1" objectFit="cover" />
                </s-box>
              ))}
            </s-stack>
          ) : null}
          {preview.title ? <s-heading>{preview.title}</s-heading> : null}
          {preview.description_html ? <s-text>{descriptionPreview(preview.description_html)}</s-text> : null}
          {preview.source_url ? <s-button variant="secondary" href={preview.source_url}>View source</s-button> : null}
          <s-text color="subdued">{preview.disclaimer || "This preview is still being prepared. Price, delivery, availability, and publication checks must finish before purchase."}</s-text>
        </s-stack>
      ) : null}
      {message.role !== "user" && payload.next_actions?.length ? (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {payload.next_actions.slice(0, 3).map((action, index) => (
            <s-button
              key={`${message.id}-next-${index}`}
              variant="secondary"
              disabled={busy}
              onClick={() => onAction?.(action, payload)}
            >
              {action.label || action.message || "Continue"}
            </s-button>
          ))}
          <s-button variant="secondary" disabled={busy} onClick={() => onCustom?.()}>Ask something else</s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

function visibleConversationMessages(messages) {
  const deliveredJobs = new Set((messages || [])
    .filter(message => message?.kind === "GOVERNANCE_RESULT")
    .map(message => String(message?.payload?.governance_job_id || ""))
    .filter(Boolean));
  return (messages || []).filter(message => {
    if (message?.kind !== "GOVERNANCE_PROGRESS") return true;
    const governanceJobId = String(message?.payload?.governance_job_id || "");
    return !governanceJobId || !deliveredJobs.has(governanceJobId);
  });
}

function ProductResult({ result, children = null }) {
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {result.image ? (
        <s-box inlineSize="72px" blockSize="72px" overflow="hidden" borderRadius="base">
          <s-image src={result.image} alt={result.title || "Product image"} inlineSize="fill" aspectRatio="1/1" objectFit="cover" />
        </s-box>
      ) : null}
      <s-text>
        <s-text type="strong">{result.title || `Candidate ${result.id || ""}`}</s-text>
        {result.price_usd != null ? ` - $${Number(result.price_usd).toFixed(2)}` : ""}
      </s-text>
      {result.product_url ? <s-button href={result.product_url}>Open product</s-button> : null}
      {children}
    </s-stack>
  );
}

function GovernanceRequest({ job }) {
  const preview = job.result || {};
  const partial = job.state === "PARTIAL_READY";
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-badge tone={governanceTone(job.state)}>{formatGovernanceState(job.state)}</s-badge>
        {job.source_url ? <s-button href={job.source_url} variant="secondary">View source</s-button> : null}
      </s-stack>
      {job.state === "SUBMITTED" ? (
        <s-banner tone="info" heading="Product preparation started">
          We received this request. It remains attached to this conversation and will update here as preparation progresses.
        </s-banner>
      ) : null}
      <s-stack direction="inline" gap="small-200">
        {governanceTimeline(job.state).map(step => (
          <s-badge key={step.state} tone={step.done ? "success" : step.current ? "info" : "neutral"}>
            {step.label}
          </s-badge>
        ))}
      </s-stack>
      {job.state === "CONFIRMING" ? (
        <s-banner tone="warning" heading="Submission needs review">
          We could not verify whether the preparation request was accepted. To prevent a duplicate request, we will reconcile it before trying again.
        </s-banner>
      ) : null}
      {partial ? <s-banner tone="warning">The preview is partial. Missing fields are not invented.</s-banner> : null}
      {job.error ? <s-banner tone={job.state === "FAILED" ? "critical" : "warning"}>{job.error}</s-banner> : null}
      {preview.images?.length ? (
        <s-stack direction="inline" gap="small-200">
          {preview.images.slice(0, 4).map(image => (
            <s-box key={image} inlineSize="96px" blockSize="96px" overflow="hidden" borderRadius="base">
              <s-image src={image} alt={preview.title || "Governed content preview"} inlineSize="fill" aspectRatio="1/1" objectFit="cover" />
            </s-box>
          ))}
        </s-stack>
      ) : null}
      {preview.title ? <s-heading>{preview.title}</s-heading> : null}
      {preview.description_html ? <s-text>{descriptionPreview(preview.description_html)}</s-text> : null}
      {preview.errors?.length ? <s-text color="subdued">Preparation notes: {preview.errors.join("; ")}</s-text> : null}
      <s-text color="subdued">{preview.disclaimer || "This preview is still being prepared. Price, delivery, availability, and publication checks must finish before purchase."}</s-text>
    </s-stack>
  );
}

function governanceActionLabel(value) {
  const labels = {
    READY: "Preview ready",
    PARTIAL_READY: "Partial preview ready",
    FAILED: "Preparation needs attention",
  };
  return labels[String(value || "").toUpperCase()] || "Preparing product";
}

function governanceForCandidate(jobs, candidateId) {
  return (jobs || []).find(job => job.candidate_id === candidateId) || null;
}

function hasPendingGovernance(jobs) {
  return (jobs || []).some(job => ![
    "READY", "PARTIAL_READY", "FAILED", "CONFIRMING",
  ].includes(job.state));
}

function governanceTimeline(currentState) {
  const stages = [
    { state: "REQUEST_ACCEPTED", label: "Request accepted", states: ["QUEUED", "SUBMITTING", "SUBMITTED"] },
    { state: "PRODUCT_PREPARATION", label: "Preparing and checking", states: ["PROCESSING"] },
    { state: "WP_RESULT", label: "Ready in your workspace", states: ["READY", "PARTIAL_READY"] },
  ];
  const index = stages.findIndex(stage => stage.states.includes(currentState));
  return stages.map((stage, step) => ({
    state: stage.state,
    label: stage.label,
    done: index >= 0 && step < index,
    current: index === step,
  }));
}

function formatGovernanceState(state) {
  const labels = {
    QUEUED: "Request queued",
    SUBMITTING: "Starting request",
    SUBMITTED: "Request accepted",
    PROCESSING: "Preparing and checking product",
    READY: "Ready in your workspace",
    PARTIAL_READY: "Partial preview ready",
    FAILED: "Preparation could not finish",
    CONFIRMING: "Submission under review",
  };
  return labels[state] || "Request in progress";
}

function governanceTone(state) {
  if (state === "READY") return "success";
  if (state === "FAILED") return "critical";
  if (["PARTIAL_READY", "CONFIRMING"].includes(state)) return "warning";
  return "info";
}

function taskTone(status) {
  if (["COMPLETED", "RESULTS_READY"].includes(status)) return "success";
  if (["FAILED", "NO_MATCH", "CANCELLED"].includes(status)) return "critical";
  return "info";
}

function descriptionPreview(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 800);
}

function criteriaSummary(criteria = {}) {
  return Object.entries(criteria)
    .filter(([, value]) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length))
    .slice(0, 8)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("; ");
}

function planLabel(plan) {
  if (plan.id === "preview") return `Free preview - scan ${plan.scan_limit}`;
  return `${plan.credits} credits - scan up to ${plan.scan_limit}`;
}

function latestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index];
  }
  return null;
}

function taskIdempotencyKey(conversationId, messageKey, planId) {
  const conversationPart = String(conversationId || "").slice(-48);
  const messagePart = String(messageKey || "").slice(-48);
  return `chat:${conversationPart}:${messagePart}:${planId}`.slice(0, 128);
}

function newClientMessageId() {
  if (globalThis.crypto?.randomUUID) return `msg_${globalThis.crypto.randomUUID()}`;
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function formatDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

async function accountFetch(path, options = {}) {
  const token = await shopify.sessionToken.get();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || "Account request failed");
  return payload;
}
