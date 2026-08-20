# Development and verification

Use Node.js 22 or later. Start from a clean checkout.

```bash
cd shopify-customer-account
cp shopify.app.toml.example shopify.app.toml
npm ci
npm test
npm run check -- --no-color
cd ..
npx shopify theme check --path shopify-theme --fail-level error
node shopify-theme/tests/run-agent-drawer-browser-qa.mjs
node scripts/scan-public.mjs .
```

The generated `shopify.app.toml` is local state and is ignored. The browser QA
uses synthetic HTML and API fixtures. It must never target a production store,
create a checkout, or submit payment.

When changing a state transition, add assertions for success, empty, invalid,
unauthorized, unavailable-service, retry, and repeated-request behavior as
applicable.

