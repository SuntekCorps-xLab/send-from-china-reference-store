const CUSTOMER_ACCOUNT_API = "shopify://customer-account/api/2026-04/graphql.json";

const CUSTOMER_ORDERS_QUERY = `
  query WpCustomerOrders($first: Int!) {
    customer {
      orders(first: $first, reverse: true) {
        nodes {
          id
          name
          processedAt
          fulfillmentStatus
          statusPageUrl
          totalPrice { amount currencyCode }
          fulfillments(first: 20) {
            nodes {
              id
              status
              latestShipmentStatus
              estimatedDeliveryAt
              trackingInformation { company number url }
            }
          }
        }
      }
    }
  }
`;

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
          estimatedDeliveryAt
          trackingInformation { company number url }
        }
      }
    }
  }
`;

export async function fetchCustomerOrders(first = 20) {
  const data = await customerAccountQuery(CUSTOMER_ORDERS_QUERY, {
    first: Math.max(1, Math.min(50, Number(first) || 20)),
  });
  return normalizeOrders(data?.customer?.orders?.nodes || []);
}

export async function fetchOrderTracking(orderId) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(String(orderId || ""))) {
    throw new Error("A valid Shopify order is required.");
  }
  const data = await customerAccountQuery(ORDER_TRACKING_QUERY, { id: orderId });
  const orders = normalizeOrders(data?.order ? [data.order] : []);
  return orders[0] || null;
}

export function normalizeOrders(rows) {
  return (Array.isArray(rows) ? rows : []).map(order => {
    const fulfillments = (order?.fulfillments?.nodes || []).map(fulfillment => ({
      id: safeText(fulfillment?.id),
      status: safeText(fulfillment?.status),
      shipmentStatus: safeText(fulfillment?.latestShipmentStatus),
      estimatedDeliveryAt: safeText(fulfillment?.estimatedDeliveryAt),
      tracking: uniqueTracking(fulfillment?.trackingInformation),
    }));
    return {
      id: safeText(order?.id),
      name: safeText(order?.name),
      processedAt: safeText(order?.processedAt),
      fulfillmentStatus: safeText(order?.fulfillmentStatus),
      statusPageUrl: safeHttpsUrl(order?.statusPageUrl),
      total: normalizeMoney(order?.totalPrice),
      fulfillments,
      tracking: uniqueTracking(fulfillments.flatMap(fulfillment => fulfillment.tracking)),
    };
  }).filter(order => order.id && order.name);
}

export function trackingForFulfillment(order, fulfillmentId) {
  const id = safeText(fulfillmentId);
  return (order?.fulfillments || []).find(fulfillment => fulfillment.id === id) || null;
}

export function formatFulfillmentStatus(value) {
  const labels = {
    FULFILLED: "Fulfilled",
    IN_PROGRESS: "In progress",
    ON_HOLD: "On hold",
    OPEN: "Unfulfilled",
    PARTIALLY_FULFILLED: "Partially fulfilled",
    PENDING_FULFILLMENT: "In progress",
    RESTOCKED: "Unfulfilled",
    SCHEDULED: "Scheduled",
    UNFULFILLED: "Unfulfilled",
  };
  return labels[safeText(value)] || "Processing";
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
    // A generic login or storefront root is not an order-scoped tracking link.
    if ((url.pathname === "/" || url.pathname === "") && !url.search) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function customerAccountQuery(query, variables = {}) {
  const response = await fetch(CUSTOMER_ACCOUNT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || "Shopify order tracking is temporarily unavailable.");
  }
  return payload.data || {};
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

function normalizeMoney(value) {
  const amount = Number(value?.amount);
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currencyCode: safeText(value?.currencyCode),
  };
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
