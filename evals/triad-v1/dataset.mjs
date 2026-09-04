import { readFile } from "node:fs/promises";

export const DATASET_SCHEMA_VERSION = "send-from-china-triad-e2e-dataset/v1";
export const DATASET_VERSION = "triad-e2e-v1.0.0";
export const DATASET_PROVENANCE = "public_synthetic";
export const EXPECTED_MINI_SHA = "66528615e57886829ed695727e85e08b0cea3c90";
export const EXPECTED_AGENT_CORE_SHA = "b527e8a43c8ffe580c7412837c86198230ef252c";

const CASE_ID = /^triad_v1_[0-9]{2}_[a-z0-9_]+$/u;
const SAFE_LABEL = /^[a-z0-9_]+$/u;
const STATUSES = new Set(["results", "no_match"]);

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function validateDataset(dataset) {
  const topLevelKeys = [
    "schema_version",
    "dataset_version",
    "provenance",
    "expected_mini_sha",
    "expected_agent_core_sha",
    "description",
    "journeys",
  ];
  if (!exactKeys(dataset, topLevelKeys)) throw new TypeError("triad dataset has unexpected top-level fields");
  if (dataset.schema_version !== DATASET_SCHEMA_VERSION) throw new TypeError("triad dataset schema is unsupported");
  if (dataset.dataset_version !== DATASET_VERSION) throw new TypeError("triad dataset version is unsupported");
  if (dataset.provenance !== DATASET_PROVENANCE) throw new TypeError("triad dataset must be public synthetic data");
  if (dataset.expected_mini_sha !== EXPECTED_MINI_SHA) throw new TypeError("triad dataset Mini SHA is not the release lock");
  if (dataset.expected_agent_core_sha !== EXPECTED_AGENT_CORE_SHA) {
    throw new TypeError("triad dataset Agent Core SHA is not the contract lock");
  }
  if (typeof dataset.description !== "string" || dataset.description.length < 30 || dataset.description.length > 500) {
    throw new TypeError("triad dataset description is invalid");
  }
  if (!Array.isArray(dataset.journeys) || dataset.journeys.length !== 20) {
    throw new TypeError("triad dataset must contain exactly 20 journeys");
  }

  const journeyKeys = ["case_id", "fixture", "expected_status", "limit"];
  const caseIds = new Set();
  const fixtures = new Set();
  for (const journey of dataset.journeys) {
    if (!exactKeys(journey, journeyKeys)) throw new TypeError("triad journey has unexpected fields");
    if (!CASE_ID.test(journey.case_id) || caseIds.has(journey.case_id)) {
      throw new TypeError("triad case IDs must be safe and unique");
    }
    if (!SAFE_LABEL.test(journey.fixture) || fixtures.has(journey.fixture)) {
      throw new TypeError("triad fixture labels must be safe and unique");
    }
    if (!STATUSES.has(journey.expected_status)) throw new TypeError("triad expected status is invalid");
    if (!Number.isInteger(journey.limit) || journey.limit < 1 || journey.limit > 5) {
      throw new TypeError("triad journey limit must be an integer from one through five");
    }
    caseIds.add(journey.case_id);
    fixtures.add(journey.fixture);
  }

  const resultCount = dataset.journeys.filter((journey) => journey.expected_status === "results").length;
  const missCount = dataset.journeys.filter((journey) => journey.expected_status === "no_match").length;
  if (resultCount !== 10 || missCount !== 10) {
    throw new TypeError("triad dataset must contain ten result and ten terminal-miss journeys");
  }
  return dataset;
}

export async function loadDataset(url = new URL("./journeys.json", import.meta.url)) {
  const bytes = await readFile(url);
  return { bytes, dataset: validateDataset(JSON.parse(bytes.toString("utf8"))) };
}
