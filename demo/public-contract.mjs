export function formatIllustrativePrice(product) {
  const amount = product?.price;
  const currency = String(product?.currency || "").toUpperCase();
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return "No price claim";
  }
  return `Illustrative ${currency} ${amount.toFixed(2)}`;
}

export function sanitizeErrorCode(error) {
  const value = typeof error === "string" ? error : error?.code;
  const code = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : "";
}

export function sanitizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
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

export function runtimePresentation(payload) {
  const mode = payload?.mode;
  if (!["synthetic_demo", "connected_local_sandbox"].includes(mode)) throw new TypeError("invalid_runtime_status");
  const connected = mode === "connected_local_sandbox";
  if (!connected && (payload?.data_source !== "offline_fixtures"
    || payload?.live_agent_core !== false || payload?.synthetic !== true)) {
    throw new TypeError("invalid_runtime_status");
  }
  if (connected) {
    const allowedReadiness = new Set(["ready", "unavailable", "unverified", "authentication_failed"]);
    const booleanFields = ["configured", "reachable", "sandbox_identity_verified", "auth_verified", "verified", "live_agent_core"];
    const structurallyValid = payload?.configured === true
      && booleanFields.every((field) => typeof payload?.[field] === "boolean")
      && allowedReadiness.has(payload?.readiness)
      && payload.live_agent_core === payload.verified
      && (!payload.verified || (payload.reachable && payload.sandbox_identity_verified && payload.auth_verified));
    if (!structurallyValid) throw new TypeError("invalid_runtime_status");
  }

  const verified = connected && payload.verified === true;
  if (!connected) {
    return {
      mode,
      connected: false,
      verified: false,
      bannerMode: mode,
      runtimeLabel: "Simulated demo · zero-account fixtures",
      drawerLabel: "SIMULATED · OFFLINE FIXTURES",
      coreLabel: "Not connected",
    };
  }
  if (verified) {
    return {
      mode,
      connected: true,
      verified: true,
      bannerMode: mode,
      runtimeLabel: "Connected local sandbox · verified BFF path",
      drawerLabel: "CONNECTED · VERIFIED LOCAL SANDBOX",
      coreLabel: "Verified through BFF",
    };
  }
  const unavailable = payload.reachable === false;
  return {
    mode,
    connected: true,
    verified: false,
    bannerMode: "connected_unavailable",
    runtimeLabel: unavailable
      ? "Configured local sandbox · unavailable"
      : payload.readiness === "authentication_failed"
        ? "Configured local sandbox · authentication unverified"
        : "Configured local sandbox · identity unverified",
    drawerLabel: unavailable
      ? "CONFIGURED · AGENT CORE UNAVAILABLE"
      : "CONFIGURED · CONNECTION UNVERIFIED",
    coreLabel: unavailable ? "Configured, not reachable" : "Configured, not verified",
  };
}
