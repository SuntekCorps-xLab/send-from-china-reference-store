import { MANAGED_CATALOG_MODE, canonicalManagedProductUrl } from "./managed-public-catalog.js";

const MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_RECEIVER_TIMEOUT_MS = 1_000;
export const SOURCE_HANDOFF_PATH = "/api/source-handoff";
export const SOURCE_HANDOFF_CONTRACT = "reference-store-source-handoff/v1";
const SOURCES = new Set(["curated_catalog", "broader_public_catalog"]);
const CONSENT = new Set(["granted", "denied", "unknown"]);
const RECEIVER_RESULTS = new Set(["accepted", "already_attributed", "invalid_token", "expired_token"]);

export class SourceHandoffPublicError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "SourceHandoffPublicError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new SourceHandoffPublicError(code, status);
}

async function readInput(request) {
  const type = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const declared = Number(request.headers.get("content-length") || 0);
  if (type !== "application/json" || (declared && (!Number.isSafeInteger(declared) || declared > MAX_BODY_BYTES))) {
    fail(declared > MAX_BODY_BYTES ? "request_too_large" : "invalid_request", declared > MAX_BODY_BYTES ? 413 : 400);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) fail("request_too_large", 413);
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail("invalid_request", 400); }
  const allowed = new Set(["product_handle", "product_url", "source", "consent", "source_token"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))) fail("invalid_request", 400);
  return value;
}

function output(status, productUrl, source, attributionRecorded = false) {
  return Object.freeze({
    contract: SOURCE_HANDOFF_CONTRACT,
    status,
    source,
    product_url: productUrl,
    purchase_allowed: true,
    attribution_recorded: attributionRecorded,
    checkout_created: false,
  });
}

export async function handleSourceHandoff(request, env) {
  if (request.method !== "POST") fail("not_found", 404);
  if (String(env?.BFF_RUNTIME_MODE || "").trim() !== MANAGED_CATALOG_MODE) {
    fail("runtime_mode_mismatch", 400);
  }
  const input = await readInput(request);
  const handle = String(input.product_handle || "").trim().toLowerCase();
  const source = String(input.source || "");
  const consent = String(input.consent || "");
  const productUrl = canonicalManagedProductUrl(input.product_url, handle, env?.STOREFRONT_ORIGIN);
  if (!productUrl || !SOURCES.has(source) || !CONSENT.has(consent)) fail("invalid_request", 400);
  if (consent !== "granted") return output("privacy_no_tracking", productUrl, source);
  const token = String(input.source_token || "").trim();
  if (!/^[A-Za-z0-9_-]{24,160}$/u.test(token)) return output("invalid_token", productUrl, source);
  const receiver = env?.SOURCE_HANDOFF_RECEIVER;
  if (String(env?.SOURCE_HANDOFF_ENABLED || "").trim() !== "true"
    || !receiver || typeof receiver.receive !== "function") {
    return output("receiver_disabled", productUrl, source);
  }
  let result;
  const configuredTimeout = Number(env?.SOURCE_HANDOFF_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout >= 100 && configuredTimeout <= 5_000
    ? configuredTimeout : DEFAULT_RECEIVER_TIMEOUT_MS;
  const controller = new AbortController();
  let timer;
  try {
    result = await Promise.race([
      receiver.receive(Object.freeze({
        token,
        source,
        product_handle: handle,
        product_url: productUrl,
        signal: controller.signal,
      })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("receiver_timeout"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    return output("receiver_unavailable", productUrl, source);
  } finally {
    clearTimeout(timer);
  }
  const status = String(result?.status || "");
  if (!RECEIVER_RESULTS.has(status)) return output("receiver_unavailable", productUrl, source);
  return output(status, productUrl, source, status === "accepted");
}
