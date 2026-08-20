# Troubleshooting

## Search or the drawer says it is not configured

Set the approved public API base in theme settings. The repository intentionally
has no production default.

## Customer-account build cannot find app configuration

Copy `shopify.app.toml.example` to the ignored `shopify.app.toml` for an offline
build, or run `shopify app config link` for a development app you control.

## A product has no price or cannot be added

Treat the state as unknown or unavailable. Verify the selected variant and cart
response in Shopify; do not infer purchasability from a search result.

## Browser QA cannot find Chrome

Install a current Chrome/Chromium browser or set the supported executable path
used by the test harness. The test is fixture-only and should not be pointed at
a live shop.

