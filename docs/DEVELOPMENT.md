# Development and verification

Use Node.js 22 or later. Start from a clean checkout. `npm run demo` itself
needs no browser, but the complete `npm run verify` release gate does. From the
repository root, install the locked dependencies and Playwright browser engines:

```bash
npm ci --ignore-scripts
npm run browsers:install
```

The installer uses the browser revisions selected by the locked
`playwright-core@1.59.1` package. By default it uses Playwright's platform cache.
If you select another cache, use the same `PLAYWRIGHT_BROWSERS_PATH` for both
`npm run browsers:install` and the later verification command. The installer
only provisions local test executables; it does not contact Shopify, Agent Core,
a BFF, or a production host.

The complete gate also requires:

- an installed Chrome-family browser (Chrome, Chromium, Edge, or Brave), using
  `CHROME_PATH` when it is outside a standard system location; and
- the Playwright 1.59.1 Chromium, Firefox and WebKit engines in the cache selected by
  `PLAYWRIGHT_BROWSERS_PATH`, or their exact executable paths through
  `FIREFOX_PATH` and `WEBKIT_PATH`.

The Playwright installer does not replace the installed Chrome-family browser
used by the legacy drawer and account-workspace gates.

The verification commands never download a browser, silently substitute an
engine, or turn a missing runtime into a passing result.

```bash
node --test demo/tests/*.test.mjs storefront-bff/test/*.test.mjs
cd storefront-bff
npm ci
npm test
cd ..
cd shopify-customer-account
cp shopify.app.toml.example shopify.app.toml
npm ci
npm test
npm run check -- --no-color
cd ..
npx shopify theme check --path shopify-theme --fail-level error
node shopify-theme/tests/run-agent-drawer-browser-qa.mjs
node shopify-customer-account/tests/run-workspace-browser-qa.mjs
node scripts/scan-public.mjs .
```

For the fastest visual feedback, run `node demo/server.mjs` and open
`http://127.0.0.1:4173`. The demo is synthetic and has no external write path.

The generated `shopify.app.toml` is local state and is ignored. The legacy drawer/account browser QA
uses synthetic HTML and API fixtures. It must never target a production store,
create a checkout, or submit payment.

The Shopify app build compiles the active `wp-order-tracking` extension. Tests
also inspect the source-only `wp-account` and `wp-ask` adapters, but those
directories have no active extension manifests and are not deployable without
a separately implemented merchant API.

When changing a state transition, add assertions for success, empty, invalid,
unauthorized, unavailable-service, retry, and repeated-request behavior as
applicable.

For agent integration tests, pair this release with Agent Core `1.0.0` and
route public theme requests through `storefront-bff/`. Verify that the tenant
key appears only in the BFF-to-Agent-Core request. For sourcing, verify terminal
catalog miss, explicit confirmation, stable
idempotency on retry, the documented task lifecycle, paginated results, and the
absence of cart, checkout, order, and payment permission. Use synthetic data and
a controlled local profile only.

Run the optional cross-repository smoke test against a controlled deployment of
the sample Agent Core profile:

```bash
AGENT_CORE_BASE_URL=https://agent.example.invalid \
AGENT_CORE_TENANT_KEY=replace-with-a-test-tenant-key \
npm run smoke:integration
```

PowerShell users can set the same two process environment variables before
running `npm run smoke:integration`. The script performs public capability
discovery, then calls Agent Core only through the local BFF adapter. It verifies
structured criteria, a terminal catalog miss, server-side credential isolation,
and the distinction between a derived browse URL and verified purchase evidence.
It does not create a sourcing task or perform a commerce write and is not part
of the offline `npm run verify` command.

## Actual Liquid/App Proxy preview QA

Run `npm ci --ignore-scripts` at the repository root to install the locked
LiquidJS, Playwright client and axe dependencies, then run
`npm run browsers:install`. That command installs the Chromium, Firefox and
WebKit revisions selected by the locked `playwright-core@1.59.1` manifest. If
you set a custom cache, use the same `PLAYWRIGHT_BROWSERS_PATH` for installation
and QA. The installer only provisions local test executables; it does not
contact Shopify, Agent Core, a BFF, or a production host, and it does not replace
the installed Chrome-family browser needed by the legacy drawer and
account-workspace gates.

To keep the browser cache outside the checkout, set one user-cache path and
retain it in the same terminal for installation and QA. On POSIX shells:

```bash
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/wp-reference-store-playwright"
npm run browsers:install
npm run qa:liquid
```

On PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "wp-reference-store-playwright"
npm run browsers:install
npm run qa:liquid
```

The local Liquid release gate is `npm run qa:liquid`, also included in
`npm run verify`. If needed, select exact installed executables with
`CHROME_PATH`, `FIREFOX_PATH` or `WEBKIT_PATH`; no test command downloads a
browser. Missing or mismatched engines fail the gate.

The Liquid gate checks the resolved Playwright package against the repository
pin and checks Firefox/WebKit versions against that package's browser manifest.
It probes an isolated `about:blank` page in every requested engine before
starting the HTTP fixtures. Reports record the dependency source, executable
hashes, startup stage and browser versions. Each run keeps its report and PNGs
in `work/shopify-liquid-qa/runs/<run-id>/`; the root `report.json` is only the
latest-run copy and must not replace a retained acceptance report. Platform
revision overrides use Playwright's own resolved descriptor; Chromium evidence
identifies the actual headless-shell executable.

On Windows, `browserContext.newPage` with an undefined `_page` can occur when
an outer restricted execution environment prevents Firefox from launching its
content process. Set `DEBUG=pw:browser` for a local diagnostic run and look for
`Failed to launch tab subprocess` / `SpawnTarget`. This failure remains nonzero
and does not count as browser coverage. Run the same pinned command in an
authorized environment that permits normal browser subprocess creation, then
rerun the complete matrix. Do not disable Firefox's sandbox, retry until green,
substitute Chromium, or accept a partial report. No harness command changes
executor permissions automatically.

The suite renders the repository Liquid layout, sections and snippets with
local Shopify filter/data adapters, executes the actual browser assets, and
forwards signed proxy requests through the real BFF into an injected Core.
It uses a fresh isolated browser context, 1440x1000 and 390x844 viewports,
axe, request/response inspection and reduced-motion checks. Images and reports
are local ignored evidence under `work/shopify-liquid-qa/`. They contain
fixture data only. This is not Shopify's remote Liquid renderer or proof of
an installed app, staging deployment or authenticated development store.

The dedicated read-only mode does not load the legacy account/workspace
scripts. Native Shopify collection browsing remains available, while Agent
search depends on verified server status and sourcing is unavailable. To
exercise the prior public BFF integration deliberately, choose
`wp_runtime_mode=legacy_public`; there is no automatic fallback.
