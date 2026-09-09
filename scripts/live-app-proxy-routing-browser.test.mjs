import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPlaywrightTransport,
  validateLiveViewport,
} from "./live-app-proxy-gate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const THEME_ID = "123456789012";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("pre-navigation route guard prevents forbidden and late browser requests from reaching servers", async () => {
  const crossOriginHits = [];
  const crossOriginUpgrades = [];
  const crossOriginServer = createServer((request, response) => {
    crossOriginHits.push(`${request.method} ${request.url}`);
    response.writeHead(204).end();
  });
  crossOriginServer.on("upgrade", (request, socket) => {
    crossOriginUpgrades.push(`${request.method} ${request.url}`);
    socket.destroy();
  });
  const crossOrigin = await listen(crossOriginServer);

  const sameOriginHits = [];
  const sameOriginServer = createServer((request, response) => {
    sameOriginHits.push(`${request.method} ${request.url}`);
    if (request.url?.startsWith("/?preview_theme_id=")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Route guard</title></head>
        <body><main><h1>Route guard fixture</h1></main><script>
          const settle = (value) => Promise.resolve(value).catch(() => {});
          settle(fetch('/forbidden-post', { method: 'POST' }));
          settle(fetch('/forbidden-put', { method: 'PUT' }));
          settle(fetch('/forbidden-delete', { method: 'DELETE' }));
          settle(fetch('${crossOrigin}/forbidden-cross-origin', { mode: 'no-cors' }));
          const blockedSocket = new WebSocket('${crossOrigin.replace("http://", "ws://")}/forbidden-websocket');
          blockedSocket.onerror = () => {};
          settle(fetch('/apps/reference-store/api/runs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: 'synthetic route guard', limit: 20 })
          }));
          const formSink = document.createElement('iframe');
          formSink.name = 'blocked-form-sink';
          formSink.hidden = true;
          document.body.append(formSink);
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/apps/reference-store/api/runs';
          form.target = formSink.name;
          document.body.append(form);
          form.submit();
          setTimeout(() => { navigator.sendBeacon('/forbidden-late', 'late'); }, 350);
        </script></body></html>`);
      return;
    }
    if (request.url === "/apps/reference-store/api/runs" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    response.writeHead(204).end();
  });
  const sameOrigin = await listen(sameOriginServer);

  try {
    for (const browser of ["chromium", "firefox", "webkit"]) {
      sameOriginHits.length = 0;
      crossOriginHits.length = 0;
      crossOriginUpgrades.length = 0;
      const config = {
        gateVersion: 2,
        browser,
        viewport: validateLiveViewport("desktop"),
        preview: {
          url: `${sameOrigin}/?preview_theme_id=${THEME_ID}`,
          origin: sameOrigin,
          shopDomain: "127.0.0.1",
          themeId: THEME_ID,
        },
      };
      const transport = await createPlaywrightTransport(config, { repositoryRoot: REPOSITORY_ROOT });
      await transport.safety([]);
      const finalSafety = await transport.close([]);

      assert.equal(sameOriginHits.filter((value) => value === "GET /?preview_theme_id=123456789012").length, 1,
        `${browser}: preview navigation must reach the fixture`);
      assert.equal(sameOriginHits.filter((value) => value === "POST /apps/reference-store/api/runs").length, 1,
        `${browser}: the one allowlisted BFF POST must reach the fixture`);
      for (const endpoint of ["/forbidden-post", "/forbidden-put", "/forbidden-delete", "/forbidden-late"]) {
        assert.equal(sameOriginHits.some((value) => value.endsWith(` ${endpoint}`)), false,
          `${browser}: ${endpoint} reached the server`);
      }
      assert.deepEqual(crossOriginHits, [], `${browser}: active cross-origin request reached the server`);
      assert.deepEqual(crossOriginUpgrades, [], `${browser}: cross-origin WebSocket reached the server`);
      assert.ok(finalSafety.blocked_browser_requests >= 7, `${browser}: blocked attempts were not counted`);
      assert.ok(finalSafety.browser_write_requests >= 4, `${browser}: forbidden writes were not counted`);
      assert.ok(finalSafety.cross_origin_api_requests >= 1, `${browser}: cross-origin attempt was not counted`);
    }
  } finally {
    await Promise.all([closeServer(sameOriginServer), closeServer(crossOriginServer)]);
  }
});
