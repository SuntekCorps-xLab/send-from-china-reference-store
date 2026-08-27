import { readFile } from "node:fs/promises";

export const DATASET_SCHEMA_VERSION = "send-from-china-paired-e2e-dataset/v0";
export const DATASET_PROVENANCE = "public_synthetic";

export const ACTIONS = Object.freeze([
  "capability_discovery",
  "sandbox_status",
  "http_v2_results",
  "http_v2_no_match",
  "http_v2_needs_clarification",
  "http_v2_degraded",
  "mcp_discovery",
  "mcp_search",
  "bff_chat_results",
  "bff_chat_no_match",
  "bff_search_results",
  "bff_search_no_match",
  "origin_rejection",
  "authentication_rejection",
  "credential_isolation",
  "purchase_link_separation",
  "cursor_pagination",
  "cursor_refine_rejection",
  "agent_core_no_write",
  "storefront_no_write",
]);

const CATEGORIES = new Set(["capability", "http", "mcp", "bff", "security", "boundary"]);
const EXECUTION_PATHS = new Set(["paired_loopback", "in_process_bff_synthetic_state"]);
const CASE_ID = /^paired_v0_[0-9]{2}_[a-z0-9_]+$/u;
const SAFE_LABEL = /^[a-z0-9_]+$/u;

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function validateDataset(dataset) {
  const topLevelKeys = ["schema_version", "dataset_version", "provenance", "description", "journeys"];
  if (!exactKeys(dataset, topLevelKeys)) throw new TypeError("paired dataset has unexpected top-level fields");
  if (dataset.schema_version !== DATASET_SCHEMA_VERSION) throw new TypeError("paired dataset schema version is unsupported");
  if (!/^paired-e2e-v0\.[0-9]+\.[0-9]+$/u.test(dataset.dataset_version)) {
    throw new TypeError("paired dataset version is invalid");
  }
  if (dataset.provenance !== DATASET_PROVENANCE) throw new TypeError("paired dataset must be public synthetic data");
  if (typeof dataset.description !== "string" || dataset.description.length < 20 || dataset.description.length > 500) {
    throw new TypeError("paired dataset description is invalid");
  }
  if (!Array.isArray(dataset.journeys) || dataset.journeys.length !== 20) {
    throw new TypeError("paired dataset must contain exactly 20 journeys");
  }

  const journeyKeys = [
    "case_id", "title", "category", "action", "execution_path", "fixture", "expected_status",
  ];
  const caseIds = new Set();
  const actions = new Set();
  for (const journey of dataset.journeys) {
    if (!exactKeys(journey, journeyKeys)) throw new TypeError("paired journey has unexpected fields");
    if (!CASE_ID.test(journey.case_id) || caseIds.has(journey.case_id)) {
      throw new TypeError("paired journey case IDs must be safe and unique");
    }
    if (typeof journey.title !== "string" || journey.title.length < 5 || journey.title.length > 120) {
      throw new TypeError(`paired journey ${journey.case_id} has an invalid title`);
    }
    if (!CATEGORIES.has(journey.category)) throw new TypeError(`paired journey ${journey.case_id} has an invalid category`);
    if (!ACTIONS.includes(journey.action) || actions.has(journey.action)) {
      throw new TypeError("paired dataset must include each release action exactly once");
    }
    if (!EXECUTION_PATHS.has(journey.execution_path)) {
      throw new TypeError(`paired journey ${journey.case_id} has an invalid execution path`);
    }
    if (!SAFE_LABEL.test(journey.fixture) || !SAFE_LABEL.test(journey.expected_status)) {
      throw new TypeError(`paired journey ${journey.case_id} has an invalid fixture or status label`);
    }
    caseIds.add(journey.case_id);
    actions.add(journey.action);
  }
  if (ACTIONS.some((action) => !actions.has(action))) throw new TypeError("paired dataset action coverage is incomplete");
  return dataset;
}

export async function loadDataset(url = new URL("./journeys.json", import.meta.url)) {
  const bytes = await readFile(url);
  const dataset = validateDataset(JSON.parse(bytes.toString("utf8")));
  return { bytes, dataset };
}
