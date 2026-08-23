import assert from "node:assert/strict";
import test from "node:test";
import { createDemoServer } from "../server.mjs";

test("the zero-account demo serves the storefront and an interactive chat", async () => {
  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Find the right product from China/);

    const chat = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "gift under $40" }] }),
    });
    const payload = await chat.json();
    assert.equal(payload.results.length, 3);
    assert.match(payload.reply, /gift under \$40/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
