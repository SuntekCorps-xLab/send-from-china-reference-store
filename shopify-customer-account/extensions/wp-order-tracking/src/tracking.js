const CUSTOMER_ACCOUNT_API = "shopify://customer-account/api/2026-04/graphql.json";

const ORDER_TRACKING_QUERY = `
  query WpOrderTracking($id: ID!) {
    order(id: $id) {
      id
      name
      fulfillmentStatus
      fulfillments(first: 20) {
        nodes {
          id
          status
          latestShipmentStatus
          trackingInformation { company number url }
        }
      }
    }
  }
`;

export async function fetchOrderTracking(orderId) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(String(orderId || ""))) {
    throw new Error("A valid Shopify order is required.");
  }
  const response = await fetch(CUSTOMER_ACCOUNT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: ORDER_TRACKING_QUERY, variables: { id: orderId } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || "Shopify order tracking is temporarily unavailable.");
  }
  return normalizeOrder(payload.data?.order);
}

export function normalizeOrder(order) {
  if (!order?.id) return null;
  return {
    id: safeText(order.id),
    name: safeText(order.name),
    fulfillmentStatus: safeText(order.fulfillmentStatus),
    fulfillments: (order?.fulfillments?.nodes || []).map(fulfillment => ({
      id: safeText(fulfillment?.id),
      status: safeText(fulfillment?.status),
      shipmentStatus: safeText(fulfillment?.latestShipmentStatus),
      tracking: uniqueTracking(fulfillment?.trackingInformation),
    })),
  };
}

export function trackingForFulfillment(order, fulfillmentId) {
  const id = runtimeId(fulfillmentId);
  if (!id) return null;
  return (order?.fulfillments || []).find(fulfillment => fulfillment.id === id) || null;
}

export function formatShipmentStatus(value) {
  const label = safeText(value).toLowerCase().replaceAll("_", " ");
  return label ? label.replace(/^./, char => char.toUpperCase()) : "Shipment created";
}

export function trackingActionUrl(value) {
  const urlValue = safeHttpsUrl(value);
  if (!urlValue) return "";
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return host === "sfc.worldproducts.ai" ? "" : url.toString();
  } catch {
    return "";
  }
}

function uniqueTracking(rows) {
  const found = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const number = safeText(row?.number);
    const url = safeHttpsUrl(row?.url);
    const company = safeText(row?.company);
    if (!number && !url) continue;
    const key = `${company}|${number}|${url}`;
    if (!found.has(key)) found.set(key, { company, number, url });
  }
  return [...found.values()];
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeText(value) {
  return String(value || "").trim().slice(0, 500);
}

function runtimeId(value) {
  if (typeof value === "string") return safeText(value);
  return safeText(value?.value);
}
