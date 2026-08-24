import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const products = [
  { title: "Walnut desk organizer", price: "$29", tag: "Natural wood", emoji: "🪵", match_status: "illustrative_only" },
  { title: "Compact reading light", price: "$34", tag: "Small spaces", emoji: "💡", match_status: "illustrative_only" },
  { title: "Ceramic pour-over set", price: "$42", tag: "Gift ready", emoji: "☕", match_status: "illustrative_only" },
];

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createDemoServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, {
        ok: true,
        mode: "synthetic_demo",
        live_agent_core: false,
        commerce_writes: false,
        shipping_rates: false,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      let body = "";
      for await (const chunk of request) body += chunk;
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        sendJson(response, { error: "invalid_json" }, 400);
        return;
      }
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const query = String([...messages].reverse().find((message) => message?.role === "user")?.content || "").trim().slice(0, 120);
      if (!query) {
        sendJson(response, { error: "invalid_messages" }, 400);
        return;
      }
      sendJson(response, {
        reply: `Demo mode recorded “${query}”. These cards illustrate the governed result UI; they were not evaluated as catalog matches.`,
        results: products,
        mode: "synthetic_demo",
        live_agent_core: false,
        trace: [
          { label: "Request received", state: "complete" },
          { label: "Demo boundary applied", state: "complete" },
          { label: "Illustrative cards rendered", state: "complete" },
        ],
      });
      return;
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) {
      response.writeHead(404).end();
      return;
    }
    try {
      const file = await readFile(path.join(root, relative));
      response.writeHead(200, { "content-type": types[path.extname(relative)] || "application/octet-stream" });
      response.end(file);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DEMO_PORT || 4173);
  createDemoServer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`Reference store demo: http://127.0.0.1:${port}\n`);
  });
}
