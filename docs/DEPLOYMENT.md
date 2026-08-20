# Deployment and rollback

## Theme

1. Run every verification command in `DEVELOPMENT.md`.
2. Pull the current remote theme into a separate release directory.
3. Overlay only the reviewed files from `shopify-theme/` and preserve remote
   `config/settings_data.json`.
4. Push to an unpublished theme and run desktop/mobile smoke tests.
5. Publish only after search, product, cart, agent handoff, and checkout-preview
   checks pass.

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
