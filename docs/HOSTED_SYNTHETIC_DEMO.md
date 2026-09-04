# Hosted synthetic storefront

The hosted demo is a deployment-disabled Cloudflare Worker candidate that
serves the same reviewed assets as `npm run demo`. It is deliberately useful
without an account and deliberately incapable of reaching Shopify, Agent Core,
or any other upstream service.

## Availability

No public URL is claimed by this source candidate. Add a URL here only after a
reviewer verifies the exact deployed commit, bundle digest, three-browser QA,
security headers, and zero external requests. Until then, use:

```bash
npm ci
npm run demo
```

Open <http://127.0.0.1:4173>. This is the exact public UI and synthetic
contract used by the hosted candidate.

## Closed public surface

The Worker serves the files under `demo/` and exactly three API routes:

- `GET /api/runtime/status`
- `GET /api/runtime/doctor`
- `POST /api/runs`

The routes use deterministic fixtures. They set no business cookie, retain no
query, expose no credential field, make no external request, and implement no
cart, checkout, order, payment, sourcing, shipping, or catalog write.

## Verify without deploying

```bash
npm ci
npm ci --prefix storefront-bff
npm run test:hosted-demo
npm run hosted:dry-run
npm run qa:shopify
npm run scan
```

`hosted:dry-run` writes an ignored bundle under `build/` and cannot deploy. The
checked-in `wrangler.toml` has both `workers_dev` and preview URLs disabled and
contains no route or credential.

## Deployment gate for an operator

Deployment is a separate, explicit action outside repository CI. Before adding
a URL to this document:

1. Record the exact commit, tree, generated bundle SHA-256, and Worker version.
2. Run Chromium, Firefox, and WebKit at desktop and mobile viewports.
3. Confirm zero serious/critical accessibility findings, horizontal overflow,
   console errors, cookies, cross-origin requests, or credential-like values.
4. Confirm every result remains labelled synthetic, illustrative,
   non-transactional, and not purchasable.
5. Keep the connected Shopify/App Proxy path on a different, reviewed BFF
   deployment. Do not add Shopify credentials or an upstream URL to this
   Worker.

Passing this gate proves only a hosted synthetic experience. It is not evidence
of Live Shopify integration.
