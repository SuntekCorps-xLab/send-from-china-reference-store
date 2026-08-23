# Operations

Monitor storefront response status, agent API availability, error rate,
latency, rate limiting, cart failures, and customer-account authorization
failures. Keep correlation identifiers free of customer content.

Monitor the storefront BFF separately from Agent Core. Track rejected origins,
invalid payloads, upstream 429s and `Retry-After`, upstream availability, and
response latency. Never log Authorization headers or raw customer messages.

If the agent API is unavailable, the catalog and Shopify cart must remain
usable and the drawer must show a bounded retry state. If price, inventory,
shipping, or purchasability cannot be verified, the UI must not invent it.

Monitor sourcing by terminal status and correlation identifier. A stuck active
status, duplicate task for one idempotency key, cross-customer task access, or a
result that becomes purchasable without a verified commerce URL is an incident.
Do not treat the paired Agent Core's synchronous in-memory preview as a
production durability or provider-health check.

For an incident, preserve the deployed theme/app versions and sanitized logs,
disable the affected integration if needed, roll back, then reproduce with
synthetic data. Never copy production customer payloads into an issue.
