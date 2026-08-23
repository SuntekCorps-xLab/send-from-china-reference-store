# Troubleshooting

## Search or the drawer says it is not configured

Deploy or run `storefront-bff/`, then set **Storefront agent proxy URL** in theme
settings. The repository intentionally has no production default. Do not point
the browser theme directly at a credentialed Agent Core instance.

## The BFF returns `service_not_configured`

Set `AGENT_CORE_BASE_URL` as a non-secret Worker variable and
`AGENT_CORE_TENANT_KEY` as a Worker secret. The checked-in
`agent-core.example.invalid` value deliberately fails closed.

## The BFF returns `origin_not_allowed`

Add the exact storefront origin, including scheme and without a path, to
`ALLOWED_ORIGINS`. Do not use a wildcard for a credentialed production bridge.

## Agent pages show no MCP endpoint

Set the separate **Agent Core public URL** theme setting. Agent pages link to
`/mcp`; buyer drawer traffic continues to use the BFF.

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
