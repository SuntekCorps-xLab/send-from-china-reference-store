import { validateRuntimeStatus } from "./run-store.mjs";

const BFF_ENDPOINTS = new Set(["runtime/status", "runs"]);

const PUBLIC_ERRORS = new Set([
  "app_proxy_authentication_failed",
  "app_proxy_timestamp_expired",
  "authentication_failed",
  "credential_missing",
  "deployment_not_configured",
  "invalid_request",
  "invalid_shopify_product_url",
  "invalid_upstream_content_type",
  "invalid_upstream_contract",
  "local_binding_required",
  "not_found",
  "origin_not_allowed",
  "permission_required",
  "quota_exceeded",
  "request_too_large",
  "runtime_mode_mismatch",
  "runtime_not_configured",
  "service_unavailable",
  "upstream_contract_unavailable",
  "upstream_redirect_rejected",
  "upstream_response_too_large",
  "upstream_timeout",
]);

const CONNECTION_LABELS = Object.freeze({
  authentication_failed: "Not connected · authentication failed",
  credential_missing: "Not connected · credentials missing",
  permission_required: "Not connected · permission required",
  quota_exceeded: "Not connected · quota exceeded",
  service_unavailable: "Not connected · service unavailable",
});

export function formatIllustrativePrice(product) {
  const amount = typeof product?.price === "object" ? product.price.amount : product?.price;
  const currency = String(
    (typeof product?.price === "object" ? product.price.currency : product?.currency) || "",
  ).toUpperCase();
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0
    || !/^[A-Z]{3}$/u.test(currency)) return "No illustrative price claim";
  return `Illustrative ${currency} ${amount.toFixed(2)}`;
}

export function formatVerifiedPrice(product) {
  const amount = product?.price?.amount;
  const currency = product?.price?.currency;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0
    || typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency)) {
    return "No Shopify price claim";
  }
  return `Shopify verified ${currency} ${amount.toFixed(2)}`;
}

export function sanitizeErrorCode(error) {
  const value = typeof error === "string" ? error : error?.code;
  const code = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/u.test(code) ? code : "";
}

export function sanitizePublicErrorCode(error) {
  const code = sanitizeErrorCode(error);
  return PUBLIC_ERRORS.has(code) ? code : "service_unavailable";
}

export function sanitizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function bffEndpointUrl(locationValue, endpoint) {
  if (!BFF_ENDPOINTS.has(endpoint)) return "";
  try {
    const origin = new URL(String(locationValue?.origin || ""));
    const pathname = String(locationValue?.pathname || "");
    if (!/^https?:$/u.test(origin.protocol) || origin.username || origin.password
      || origin.pathname !== "/" || origin.search || origin.hash
      || !pathname.startsWith("/") || pathname.startsWith("//")
      || /[\\\u0000-\u001f]/u.test(pathname) || /%(?:2f|5c)/iu.test(pathname)) return "";
    let basePath;
    if (pathname.endsWith("/")) basePath = pathname;
    else if (/\.[a-z0-9]{1,12}$/iu.test(pathname.split("/").at(-1) || "")) {
      basePath = pathname.slice(0, pathname.lastIndexOf("/") + 1);
    } else basePath = `${pathname}/`;
    const url = new URL(`${basePath}api/${endpoint}`, origin.origin);
    return url.origin === origin.origin ? url.href : "";
  } catch {
    return "";
  }
}

export function sanitizeOptionalInspectorFields(source, httpStatus, validScenarios = []) {
  const input = source && typeof source === "object" ? source : {};
  const fields = {};
  const statusCode = sanitizeHttpStatus(httpStatus);
  const error = sanitizeErrorCode(input.error);
  const scenario = typeof input.scenario === "string" && validScenarios.includes(input.scenario)
    ? input.scenario
    : "";
  const status = typeof input.status === "string" ? input.status.trim().slice(0, 60) : "";
  if (statusCode !== null) fields.http_status = statusCode;
  if (error) fields.error = error;
  if (scenario) fields.scenario = scenario;
  if (status) fields.status = status;
  return fields;
}

export function runtimePresentation(runtime) {
  validateRuntimeStatus(runtime);
  const synthetic = runtime.mode === "synthetic_local_sandbox";
  const modeLabel = synthetic ? "Synthetic" : "Shopify read-only";
  const connectionLabel = synthetic
    ? "Connected · offline fixtures"
    : (runtime.connected ? "Connected · Shopify verified" : CONNECTION_LABELS[runtime.credential_state]);
  const authorizationLabel = synthetic
    ? "No Shopify authorization is used in synthetic mode."
    : (runtime.connected
      ? "Server-held Shopify authorization verified."
      : "Authorization is incomplete. Configure it only in the BFF environment or secret provider.");
  return Object.freeze({
    mode: runtime.mode,
    synthetic,
    connected: runtime.connected,
    modeLabel,
    connectionLabel,
    runtimeLabel: `${modeLabel} · ${connectionLabel}`,
    drawerLabel: synthetic
      ? "SYNTHETIC · READ-ONLY FIXTURES"
      : `SHOPIFY READ-ONLY · ${runtime.connected ? "CONNECTED" : "NOT CONNECTED"}`,
    coreLabel: connectionLabel,
    authorizationLabel,
    checkedAtLabel: runtime.checked_at,
    quotaLabel: `${runtime.quota.remaining}/${runtime.quota.limit} remaining · ${runtime.quota.window_seconds}s window · ${runtime.quota.concurrency_limit} concurrent`,
    writesLabel: "Writes disabled",
  });
}
