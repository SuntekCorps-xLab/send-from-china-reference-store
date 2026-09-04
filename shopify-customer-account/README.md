# Shopify Customer Account surfaces

This directory deliberately separates one installable extension from two
source-only adapter examples. A clean build must not imply that an account
backend is included when it is not.

## Shipped extension

`extensions/wp-order-tracking/` is the only extension with an active Shopify
manifest. It reads the signed-in customer's orders and fulfillment tracking
from Shopify's Customer Account API. It does not send names, addresses, raw
orders, or payment data to Agent Core.

The tracking surface:

- keeps fulfillments and tracking numbers scoped to their Shopify order;
- accepts only HTTPS action URLs;
- suppresses generic storefront or login roots that are not order-scoped;
- leaves missing tracking information unknown instead of inventing a number.

## Source-only adapters

`extensions/wp-account/` and `extensions/wp-ask/` are UI adapter examples for a
saved workspace and authenticated request flow. They intentionally have no
active `shopify.extension.toml`, are not included in the default Shopify app
build, and use non-routable `example.invalid` endpoints.

This repository does **not** include the merchant API required by those
adapters. Before activating either example, implement a merchant-controlled
service that:

1. verifies every Shopify Customer Account session token;
2. binds records to both the shop and customer subject;
3. rejects cross-customer conversation, task, result, and key identifiers;
4. applies durable idempotency to every write;
5. validates webhook authenticity before granting or reversing any credit;
6. keeps Agent Core credentials and merchant secrets out of browser code;
7. documents retention, deletion, audit logging, abuse controls, and incident
   response.

Treat the adapter code as a contract and UX reference, not as proof that these
server-side controls exist.

## Build verification

Requirements: Node.js 22+ and Shopify CLI through the locked development
dependency.

For a clean checkout, create the ignored, non-deployable test configuration:

```bash
cp shopify.app.toml.example shopify.app.toml
npm ci
npm test
npm run check -- --no-color
```

PowerShell:

```powershell
Copy-Item shopify.app.toml.example shopify.app.toml
npm.cmd ci
npm.cmd test
npm.cmd run check -- --no-color
```

The build compiles `wp-order-tracking`. Tests also check safety contracts in the
source-only adapters and the storefront workspace, but they do not turn those
examples into deployable extensions or supply their backend.

From the repository root, `npm run verify:account-preview` bundles the complete
source-only `wp-account` entry with its locked dependencies and checks the
gzip-compressed 64 KiB size limit. It also renders the two actual preview
components with synthetic input in Chromium and checks their text-only output.
Install both root and customer-account locked dependencies first. The local
check needs the pinned Playwright Chromium engine, or an explicit `CHROME_PATH`.
Bundle metadata and synthetic verification receipts go to ignored
`artifacts/account-preview/`. This check does not activate the adapter or prove
a Shopify-hosted runtime, account backend, App Proxy, or protected operation.

`shopify.app.toml.example` contains a placeholder client ID and
`example.invalid` URLs. It cannot identify or deploy to a real app. Delete the
generated local file after verification, or replace it with configuration
created by `shopify app config link` for a development app you control. Never
commit the generated file or an app secret.

## Activating an adapter

Activation is an integration project, not a file rename. Create a new extension
manifest through Shopify CLI, point the adapter at your reviewed merchant API,
request only the required scopes and network access, and verify the complete
flow in a development store. Keep deployment and activation outside pull-request
automation.
