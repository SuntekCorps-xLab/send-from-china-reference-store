# Operations

Monitor storefront response status, agent API availability, error rate,
latency, rate limiting, cart failures, and customer-account authorization
failures. Keep correlation identifiers free of customer content.

If the agent API is unavailable, the catalog and Shopify cart must remain
usable and the drawer must show a bounded retry state. If price, inventory,
shipping, or purchasability cannot be verified, the UI must not invent it.

For an incident, preserve the deployed theme/app versions and sanitized logs,
disable the affected integration if needed, roll back, then reproduce with
synthetic data. Never copy production customer payloads into an issue.

