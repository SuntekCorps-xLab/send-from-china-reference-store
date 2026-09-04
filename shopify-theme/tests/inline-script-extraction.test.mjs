import assert from "node:assert/strict";
import test from "node:test";

import { inlineClassicScripts } from "./helpers/inline-scripts.mjs";

test("script extraction recognizes case, attributes, and end-tag whitespace", () => {
  assert.deepEqual(inlineClassicScripts('<ScRiPt type="text/javascript">const ok = 1;</ScRiPt >'), ["const ok = 1;"]);
});
test("script extraction recognizes browser-tolerated closing attributes", () => {
  assert.deepEqual(inlineClassicScripts('<script>const ok = 1;</script data-extra="x">'), ["const ok = 1;"]);
});
test("script extraction preserves source with greater-than attributes and comparison", () => {
  assert.deepEqual(inlineClassicScripts('<script data-label="a > b">const ok = 1 < 2;</script>'), ["const ok = 1 < 2;"]);
});
test("script extraction ignores lookalike tags, external scripts, and JSON data", () => {
  assert.deepEqual(inlineClassicScripts('<scripture>fake</scripture><script src="/asset.js"></script><script type="application/json">{"a":1}</script>'), []);
});
test("script extraction does not truncate similar end-tag text inside JavaScript", () => {
  const body = 'const label = "</scripture>"; const ok = 1;';
  assert.deepEqual(inlineClassicScripts("<script>" + body + "</script>"), [body]);
});
test("script verification still fails invalid syntax without executing valid source", () => {
  const [invalid] = inlineClassicScripts("<script>const =;</script>");
  assert.throws(() => new Function(invalid), SyntaxError);
  const [body] = inlineClassicScripts("<script>globalThis.__storeExtractionExecuted = true;</script>");
  assert.doesNotThrow(() => new Function(body));
  assert.equal(globalThis.__storeExtractionExecuted, undefined);
});
