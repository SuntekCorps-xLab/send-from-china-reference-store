function safeBffBase(value) {
  const url = new URL(String(value || ""), globalThis.location?.origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("bffBaseUrl must be a plain HTTP(S) origin.");
  }
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new TypeError("Non-loopback BFF URLs must use HTTPS.");
  }
  return url.href.replace(/\/$/u, "");
}

export async function searchThroughBff(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) throw new TypeError("query is required");
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const response = await fetchImpl(`${safeBffBase(options.bffBaseUrl)}/api/search`, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `HTTP_${response.status}`);
  return payload;
}
