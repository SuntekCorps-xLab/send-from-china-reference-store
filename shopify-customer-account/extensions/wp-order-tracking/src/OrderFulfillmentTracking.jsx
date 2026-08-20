/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchOrderTracking, formatShipmentStatus, trackingActionUrl, trackingForFulfillment } from "./tracking.js";

export default async () => {
  render(<OrderFulfillmentTracking />, document.body);
};

function OrderFulfillmentTracking() {
  const [fulfillment, setFulfillment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const orderId = shopify.order?.value?.id;
    const fulfillmentId = shopify.fulfillmentId?.value || shopify.fulfillmentId;
    fetchOrderTracking(orderId)
      .then(order => setFulfillment(trackingForFulfillment(order, fulfillmentId)))
      .catch(cause => setError(String(cause?.message || "Tracking is temporarily unavailable.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <s-spinner accessibilityLabel="Loading shipment tracking" />;
  if (error) return (
    <s-banner tone="warning" heading="Tracking unavailable">
      <s-text>{error}</s-text>
    </s-banner>
  );

  if (!fulfillment) return (
    <s-banner tone="warning" heading="Shipment not identified">
      <s-stack direction="block" gap="small-200">
        <s-text>This delivery card could not be matched to an authoritative Shopify fulfillment. No tracking number is shown.</s-text>
      </s-stack>
    </s-banner>
  );

  return (
    <s-stack direction="block" gap="base">
      <s-heading>Send From China tracking</s-heading>
      {fulfillment?.tracking?.length ? fulfillment.tracking.map((tracking, index) => {
        const actionUrl = trackingActionUrl(tracking.url);
        return (
          <s-stack key={`${tracking.company}-${tracking.number}-${index}`} direction="inline" gap="base" alignItems="center">
            <s-text>{tracking.company || "Carrier"}: <s-text type="strong">{tracking.number || "Tracking link ready"}</s-text></s-text>
            {actionUrl ? <s-button href={actionUrl}>Track shipment</s-button> : null}
          </s-stack>
        );
      }) : <s-text color="subdued">The carrier has not returned an authoritative tracking number yet.</s-text>}
      {fulfillment?.shipmentStatus ? <s-text color="subdued">Latest status: {formatShipmentStatus(fulfillment.shipmentStatus)}</s-text> : null}
      <s-text color="subdued">This order is authorized by your customer account. No separate account is required for the information shown here.</s-text>
    </s-stack>
  );
}
