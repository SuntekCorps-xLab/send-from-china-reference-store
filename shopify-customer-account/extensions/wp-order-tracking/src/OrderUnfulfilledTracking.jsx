/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<OrderUnfulfilledTracking />, document.body);
};

function OrderUnfulfilledTracking() {
  const orderName = String(shopify.order?.value?.name || "this order").slice(0, 100);

  return (
    <s-banner tone="info" heading="Send From China shipment tracking">
      <s-stack direction="block" gap="small-200">
        <s-text>{orderName} is still being prepared. An authoritative carrier and tracking number will appear here after fulfillment confirms shipment.</s-text>
        <s-text color="subdued">Placeholder tracking numbers are never displayed.</s-text>
      </s-stack>
    </s-banner>
  );
}
