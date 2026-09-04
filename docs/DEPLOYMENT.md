# Deployment and rollback

## Storefront BFF

1. Copy `storefront-bff/wrangler.toml` and replace only the non-secret example
   origins with approved deployment values.
2. Store `AGENT_CORE_TENANT_KEY` with `wrangler secret put`; never add it to
   `wrangler.toml`, theme settings, or CI logs.
3. Run `npm ci && npm test` inside `storefront-bff/`.
4. Deploy the Worker and verify `GET /health` plus one synthetic chat request
   from the approved storefront origin.
5. Set **Storefront agent proxy URL** in the theme editor to the Worker URL.

Rollback by deploying the previous Worker version, then verify the health and
origin policy before restoring traffic.

## Theme

1. Run every verification command in `DEVELOPMENT.md`.
2. Pull the current remote theme into a separate release directory.
3. Overlay only the reviewed files from `shopify-theme/` and preserve remote
   `config/settings_data.json`.
4. Push to an unpublished theme and run desktop/mobile smoke tests.
5. Publish only after search, product, cart, agent handoff, and checkout-preview
   checks pass.

Set **Agent Core public URL** only when machine-readable agent pages should
advertise an MCP endpoint. The theme appends `/mcp`; do not use the BFF URL for
that setting.

Configure analytics through Shopify Customer Events or another reviewed consent
flow. The theme intentionally ships without a production measurement ID.

Rollback by republishing the previous theme ID. Do not overwrite the rollback
theme during the release.

## Customer Account extension

Link the approved Shopify app locally, review generated app configuration, run
the build, and deploy a version. Enable extension targets through Shopify's
account editor only after verification. Rollback by releasing the last known
good app version and restoring the prior editor configuration.

Repository CI never deploys or activates production assets.

For the first public release, complete and record every repository setting in
[`PUBLIC_RELEASE_CHECKLIST.md`](PUBLIC_RELEASE_CHECKLIST.md).
