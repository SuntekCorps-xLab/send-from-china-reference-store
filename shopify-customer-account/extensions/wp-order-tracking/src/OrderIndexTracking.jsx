/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<OrderIndexTracking />, document.body);
};

function OrderIndexTracking() {
  return (
    <s-banner heading="WP shipment tracking" tone="info">
      <s-stack direction="block" gap="base">
        <s-text>Open a shipped order to see its carrier, shipment status, and authoritative tracking number using this WP account.</s-text>
        <s-button href="https://example.invalid/apps/wp-account/workspace">Open sourcing workspace</s-button>
      </s-stack>
    </s-banner>
  );
}
