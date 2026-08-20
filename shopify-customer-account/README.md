# WP Customer Account

This Shopify app surface adds one authenticated workspace to the new customer
account:

- **WP Workspace**: customer-scoped order and tracking details, credit balance,
  saved conversations, sourcing tasks, governed product results, and revocable
  Agent keys.

Shopify Customer Accounts is the registration and sign-in system. WP does not
ask the buyer to create a second password: the first authenticated Workspace
request verifies Shopify's session token and creates an opaque WP profile for
that customer. The storefront may offer an anonymous catalog conversation,
while the signed-in Workspace is the canonical private surface for persistent
conversation history.

Every signed-in message carries a stable client message ID. A first-message
retry restores the conversation instead of creating a duplicate. Dynamic
sourcing tasks are linked to that conversation, and candidate batches plus
governance previews return to its message timeline. A different Shopify
customer cannot address the conversation by guessing its ID.

The same extension also adds a static tracking notice to the order list and a
tracking panel beneath each fulfillment. These surfaces read order history and
tracking information directly from Shopify's Customer Account API. They do not
send names, addresses, or raw order payloads to the WP Worker.

The extension never receives or stores card data. Credit packs will use normal
Shopify Checkout. The Worker grants credits only after a verified
`orders/paid` webhook matches a configured credit-product variant, and reverses
them only from a verified refund event.

The resulting customer flow is:

```text
Sign in / Create account (Shopify)
  -> WP Workspace profile bootstrap
  -> saved conversation
  -> optional Shopify credit checkout
  -> sourcing/governance task
  -> candidates and governed product preview in the same conversation
```

## Link the Shopify app

The repository deliberately excludes every store-specific
`shopify.app.*.toml` file because the live app association is local Shopify CLI
state. Link the workspace to the approved app, preserve the generated local
file, and compare its required scopes, webhook subscriptions, and app proxy
with `shopify.app.toml.example`. The example is a contract template, not a
deployable production identity. From this directory:

```powershell
shopify app config link
npm.cmd install
npm.cmd run dev
```

Choose the custom app installed on the main production store
(`<main-store>.myshopify.com`). The same app's Client ID and Secret must be
configured as Worker secrets so the Worker can verify Customer Account Session
Tokens. Never place the Secret in this directory; supply store-specific
identifiers through deployment configuration.

Before production deployment, request/approve:

1. Customer Account UI extension network access.
2. The `read_customers` scope and protected customer data access required for
   the signed customer GID (`sub`).
3. The `WP Workspace` full-page entry in the checkout and accounts editor.
4. Credit pack variant IDs and prices, then configure
   `WP_CREDIT_PRODUCTS_JSON` on the Worker.
5. `orders/paid` and `refunds/create` webhook subscriptions pointing to the
   Worker webhook routes.

The Workspace exposes a Checkout button only when an approved credit product is
configured and the explicit paid-credit switch is enabled. Without both, it
fails closed and reports paid top-up as unavailable. Credits are granted only
after the verified webhook flow described above; opening Checkout is not a
credit event.

Example non-secret configuration shape (the variant IDs must come from the
actual Shopify credit products):

```json
[
  {
    "shop": "<main-store>.myshopify.com",
    "plan_id": "focused",
    "title": "Focused search",
    "variant_id": "SHOPIFY_VARIANT_ID",
    "credits": 5
  }
]
```

Credit recognition is variant-ID-only. A matching SKU is deliberately not
accepted because SKUs are merchant-controlled and might be duplicated. It is
also shop-scoped; a Variant ID from another store cannot credit this account.

## Build verification

In an already linked development workspace, run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run check -- --no-color
```

For a clean source archive that deliberately has no private Shopify CLI state,
copy the sanitized contract template first. Do this only when
`shopify.app.toml` does not already exist:

```powershell
Copy-Item shopify.app.toml.example shopify.app.toml
npm.cmd ci
npm.cmd test
npm.cmd run check -- --no-color
```

The placeholder Client ID and `example.invalid` callback are intentionally not
a deployable app identity. Delete the generated local file after verification,
or replace it by running `shopify app config link` for an approved app. Never
commit it.

The commands run the unit and contract tests plus Shopify's official app build
for the tracking extension. A build does not deploy or add pages to the
customer-account editor. Worker routes and account-state implementation live
in `../governance-worker`; its README documents local verification and runtime
configuration.
