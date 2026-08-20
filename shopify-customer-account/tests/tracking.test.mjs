import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFulfillmentStatus,
  normalizeOrders,
  trackingActionUrl,
  trackingForFulfillment,
} from "../extensions/wp-account/src/tracking.js";

test("normalizes and deduplicates authoritative tracking only", () => {
  const [order] = normalizeOrders([{
    id: "gid://shopify/Order/1001",
    name: "#1001",
    fulfillmentStatus: "FULFILLED",
    statusPageUrl: "https://example.test/order/1001",
    fulfillments: { nodes: [{
      id: "gid://shopify/Fulfillment/2001",
      latestShipmentStatus: "IN_TRANSIT",
      trackingInformation: [
        { company: "SFC", number: "TEST-TRACK-001", url: "https://example.test/track/1" },
        { company: "SFC", number: "TEST-TRACK-001", url: "https://example.test/track/1" },
        { company: "Unsafe", number: "", url: "javascript:alert(1)" },
      ],
    }] },
  }]);

  assert.equal(order.tracking.length, 1);
  assert.equal(order.tracking[0].number, "TEST-TRACK-001");
  assert.equal(trackingForFulfillment(order, "gid://shopify/Fulfillment/2001").shipmentStatus, "IN_TRANSIT");
});

test("keeps orders without tracking visible without inventing a number", () => {
  const [order] = normalizeOrders([{
    id: "gid://shopify/Order/1018",
    name: "#1018",
    fulfillmentStatus: "UNFULFILLED",
    fulfillments: { nodes: [] },
  }]);

  assert.deepEqual(order.tracking, []);
  assert.equal(formatFulfillmentStatus(order.fulfillmentStatus), "Unfulfilled");
});

test("rejects non-https tracking links", () => {
  const [order] = normalizeOrders([{
    id: "gid://shopify/Order/1002",
    name: "#1002",
    fulfillments: { nodes: [{
      id: "gid://shopify/Fulfillment/2002",
      trackingInformation: [{ company: "Test", number: "TEST-002", url: "http://example.test/track" }],
    }] },
  }]);

  assert.equal(order.tracking[0].url, "");
});

test("does not treat the generic SFC storefront as an order-scoped tracking link", () => {
  assert.equal(trackingActionUrl("https://sfc.worldproducts.ai"), "");
  assert.equal(trackingActionUrl("https://sfc.worldproducts.ai/#SfcTracking"), "");
  assert.equal(trackingActionUrl("https://carrier.example.test/track/TEST-003"), "https://carrier.example.test/track/TEST-003");
});
