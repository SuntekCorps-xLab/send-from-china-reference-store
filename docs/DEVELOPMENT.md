# Development and verification

Use Node.js 22 or later. Start from a clean checkout.

```bash
node --test demo/tests/*.test.mjs storefront-bff/test/*.test.mjs
cd storefront-bff
npm ci
npm test
cd ..
cd shopify-customer-account
cp shopify.app.toml.example shopify.app.toml
npm ci
npm test
npm run check -- --no-color
cd ..
npx shopify theme check --path shopify-theme --fail-level error
node shopify-theme/tests/run-agent-drawer-browser-qa.mjs
node shopify-customer-account/tests/run-workspace-browser-qa.mjs
node scripts/scan-public.mjs .
```

For the fastest visual feedback, run `node demo/server.mjs` and open
`http://127.0.0.1:4173`. The demo is synthetic and has no external write path.

The generated `shopify.app.toml` is local state and is ignored. The browser QA
uses synthetic HTML and API fixtures. It must never target a production store,
create a checkout, or submit payment.

The Shopify app build compiles the active `wp-order-tracking` extension. Tests
also inspect the source-only `wp-account` and `wp-ask` adapters, but those
directories have no active extension manifests and are not deployable without
a separately implemented merchant API.

When changing a state transition, add assertions for success, empty, invalid,
unauthorized, unavailable-service, retry, and repeated-request behavior as
applicable.

For agent integration tests, pair this release with Agent Core `1.0.0` and
route public theme requests through `storefront-bff/`. Verify that the tenant
key appears only in the BFF-to-Agent-Core request. For sourcing, verify terminal
catalog miss, explicit confirmation, stable
idempotency on retry, the documented task lifecycle, paginated results, and the
absence of cart, checkout, order, and payment permission. Use synthetic data and
a controlled local profile only.

Run the optional cross-repository smoke test against a controlled deployment of
the sample Agent Core profile:

```bash
AGENT_CORE_BASE_URL=https://agent.example.invalid \
AGENT_CORE_TENANT_KEY=replace-with-a-test-tenant-key \
npm run smoke:integration
```

PowerShell users can set the same two process environment variables before
running `npm run smoke:integration`. The script performs public capability
discovery, then calls Agent Core only through the local BFF adapter. It verifies
structured criteria, a terminal catalog miss, server-side credential isolation,
and the distinction between a derived browse URL and verified purchase evidence.
It does not create a sourcing task or perform a commerce write and is not part
of the offline `npm run verify` command.
