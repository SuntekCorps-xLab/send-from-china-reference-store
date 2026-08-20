import assert from "node:assert/strict";
import test from "node:test";

import {
  formatShipmentStatus,
  normalizeOrder,
  trackingActionUrl,
  trackingForFulfillment,
} from "../extensions/wp-order-tracking/src/tracking.js";

test("keeps multiple fulfillments and their tracking numbers scoped", () => {
  const order = normalizeOrder({
    id: "gid://shopify/Order/1001",
    name: "#1001",
    fulfillments: { nodes: [
      {
        id: "gid://shopify/Fulfillment/2001",
        latestShipmentStatus: "IN_TRANSIT",
        trackingInformation: [
          { company: "SFC", number: "TEST-A", url: "https://example.test/a" },
          { company: "SFC", number: "TEST-A", url: "https://example.test/a" },
        ],
      },
      {
        id: "gid://shopify/Fulfillment/2002",
        latestShipmentStatus: "CONFIRMED",
        trackingInformation: [
          { company: "SFC", number: "TEST-B", url: "https://example.test/b" },
        ],
      },
    ] },
  });

  assert.equal(order.fulfillments.length, 2);
  assert.equal(trackingForFulfillment(order, "gid://shopify/Fulfillment/2001").tracking.length, 1);
  assert.equal(trackingForFulfillment(order, { value: "gid://shopify/Fulfillment/2002" }).tracking[0].number, "TEST-B");
});

test("fails closed when fulfillment scope is absent or unknown", () => {
  const order = normalizeOrder({
    id: "gid://shopify/Order/1018",
    name: "#1018",
    fulfillments: { nodes: [{ id: "gid://shopify/Fulfillment/2018", trackingInformation: [] }] },
  });

  assert.equal(trackingForFulfillment(order, ""), null);
  assert.equal(trackingForFulfillment(order, "gid://shopify/Fulfillment/9999"), null);
  assert.deepEqual(order.fulfillments[0].tracking, []);
});

test("drops unsafe tracking URLs without dropping an authoritative number", () => {
  const order = normalizeOrder({
    id: "gid://shopify/Order/1002",
    name: "#1002",
    fulfillments: { nodes: [{
      id: "gid://shopify/Fulfillment/2002",
      trackingInformation: [{ company: "Test", number: "TEST-002", url: "javascript:alert(1)" }],
    }] },
  });

  assert.equal(order.fulfillments[0].tracking[0].number, "TEST-002");
  assert.equal(order.fulfillments[0].tracking[0].url, "");
  assert.equal(formatShipmentStatus("OUT_FOR_DELIVERY"), "Out for delivery");
});

test("keeps a tracking number visible while suppressing a generic SFC login link", () => {
  const order = normalizeOrder({
    id: "gid://shopify/Order/1003",
    name: "#1003",
    fulfillments: { nodes: [{
      id: "gid://shopify/Fulfillment/2003",
      trackingInformation: [{ company: "SFC", number: "TEST-003", url: "https://sfc.worldproducts.ai" }],
    }] },
  });

  assert.equal(order.fulfillments[0].tracking[0].number, "TEST-003");
  assert.equal(trackingActionUrl(order.fulfillments[0].tracking[0].url), "");
});
