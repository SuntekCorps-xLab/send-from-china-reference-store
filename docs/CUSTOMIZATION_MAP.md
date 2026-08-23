# Customization map

The repository includes a complete Shopify theme so it can be installed and
checked as a theme. You do not need to read every inherited section to
understand the reference implementation.

## Start with these files

| Goal | Files |
| --- | --- |
| Store shell and navigation | `shopify-theme/snippets/wp-shell*.liquid` |
| Home, search, collection, product, and cart | `shopify-theme/sections/lm-*-chat.liquid` |
| Machine-readable agent views | `shopify-theme/sections/lm-*-agent.liquid` |
| Shopping Agent drawer | `shopify-theme/snippets/wp-agent-drawer.liquid`, `shopify-theme/assets/wp-agent-drawer.*` |
| Saved workspace | `shopify-theme/assets/wp-workspace.js`, `shopify-customer-account/extensions/` |
| Browser-safe Agent Core adapter | `storefront-bff/src/index.js` |
| Zero-account experience demo | `demo/` |
| Contract and browser QA | `shopify-theme/tests/`, `storefront-bff/test/`, `demo/tests/` |

## Theme naming

- `lm-*` files implement the full-page reference storefront surfaces.
- `wp-*` files implement shared shell, agent, workspace, and integration pieces.
- Other theme files provide the standard Shopify installable theme surface.

## Safe first changes

Brand colors and typography are centralized in `wp-shell.liquid` and the
surface-level section styles. Preserve semantic states, focus behavior, reduced
motion, truthful price/availability fallbacks, and the server-side credential
boundary when restyling.
