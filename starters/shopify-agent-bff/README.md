# Shopify Agent BFF starter

This starter is the smallest copyable path from a Shopify theme or custom
storefront to the repository's reviewed Storefront BFF. It keeps the Agent Core
tenant credential in a Worker secret and gives the browser only `/api/search`,
`/api/chat`, and `/api/catalog`.

## Run it inside this repository

1. Start the zero-account paired platform from the repository root:

   ```bash
   npm run demo:platform
   ```

2. Open the printed Reference Store URL. That path already exercises the same
   browser → BFF → Agent Core boundary without an account or production key.

3. Test this starter's import and browser adapter:

   ```bash
   npm --prefix starters/shopify-agent-bff test
   ```

## Adapt it for a reviewed deployment

- Keep [`src/index.js`](src/index.js) as the Worker entry point.
- Copy [`wrangler.toml.example`](wrangler.toml.example) to a private deployment
  configuration and replace only the example origins and Agent Core URL.
- Set `AGENT_CORE_TENANT_KEY` with `wrangler secret put`; never place it in
  Liquid, browser JavaScript, a theme setting, or Git.
- Use [`browser/search.mjs`](browser/search.mjs) from the storefront. It sends
  only a product query to the BFF and has no access to the tenant key.

This is a read-only discovery starter. Shopify remains authoritative for
variant, inventory, price, cart, checkout, order, and payment state. The
synthetic local path returns no real freight rate and performs no commerce
write.
