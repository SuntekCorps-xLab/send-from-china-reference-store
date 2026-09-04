# Repository guide for coding agents

## Scope

This repository is a public reference storefront. Keep examples runnable without
production infrastructure and keep the customer-facing experience honest.

## Non-negotiable boundaries

- Never commit credentials, production hosts, merchant exports, customer data,
  order data, or captured production responses.
- Browser code must never receive an Agent Core tenant key. Put authenticated
  Agent Core calls behind `storefront-bff/` or another merchant-controlled BFF.
- Shopify remains the source of truth for variants, cart, checkout, customer
  identity, and payment.
- Do not invent price, availability, product totals, or sourcing progress.
- Keep example domains under `example.invalid` and example keys visibly fake.
- Do not change pinned GitHub Action SHAs without a dedicated dependency review.

## Where to make changes

- Storefront interaction: `shopify-theme/sections/lm-*`,
  `shopify-theme/snippets/wp-*`, and `shopify-theme/assets/wp-*`.
- Customer account surfaces: `shopify-customer-account/extensions/`.
- Browser-to-Agent Core adapter: `storefront-bff/`.
- Zero-account preview: `demo/`.

## Required checks

Run the checks relevant to the changed surface and always run the public safety
scan before opening a pull request:

```bash
node --test storefront-bff/test/*.test.mjs demo/tests/*.test.mjs
node --test shopify-theme/tests/*.test.mjs
node shopify-theme/tests/run-agent-drawer-browser-qa.mjs
node scripts/scan-public.mjs .
```
