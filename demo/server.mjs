import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const products = [
  { title: "Walnut desk organizer", price: "$29", tag: "Natural wood", emoji: "🪵" },
  { title: "Compact reading light", price: "$34", tag: "Small spaces", emoji: "💡" },
  { title: "Ceramic pour-over set", price: "$42", tag: "Gift ready", emoji: "☕" },
];

export function createDemoServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/chat") {
      let body = "";
      for await (const chunk of request) body += chunk;
      let query = "product";
      try {
        const payload = JSON.parse(body || "{}");
        query = String(payload?.messages?.at(-1)?.content || query).slice(0, 120);
      } catch {}
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({
        reply: `I treated “${query}” as a catalog-first request. Here are three governed demo matches; open a product to review real variants, price, and availability.`,
        results: products,
      }));
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
