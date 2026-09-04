import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../assets/wp-agent-drawer.js", import.meta.url), "utf8");

function loadClientId(crypto) {
  // Export the actual hoisted helper before the drawer's no-root early return.
  // No helper implementation is copied into this fixture.
  const context = vm.createContext({ window: { crypto }, document: { querySelector: () => null } });
  vm.runInContext(source.replace('"use strict";', '"use strict"; globalThis.testClientId = clientId;'), context);
  return context.testClientId;
}

test("drawer client IDs use randomUUID with the existing prefix and 32-character payload", () => {
  const crypto = {
    randomUUID() {
      assert.equal(this, crypto, "native Crypto methods retain their receiver");
      return "12345678-1234-4abc-8def-123456789abc";
    },
    getRandomValues() { assert.fail("randomUUID is preferred"); },
  };
  const clientId = loadClientId(crypto);
  for (const prefix of ["chat", "handoff", "pending", "msg"]) {
    assert.equal(clientId(prefix), `${prefix}_1234567812344abc8def123456789abc`);
  }
});

test("drawer client IDs use all 16 secure random bytes when randomUUID is unavailable", () => {
  const crypto = {
    getRandomValues(bytes) {
      assert.equal(this, crypto);
      assert.equal(Object.prototype.toString.call(bytes), "[object Uint8Array]");
      assert.equal(bytes.length, 16);
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 255]);
      return bytes;
    },
  };
  const clientId = loadClientId(crypto);
  assert.equal(clientId("chat"), "chat_000102030405060708090a0b0c0d0eff");
  assert.equal(clientId("handoff"), "handoff_000102030405060708090a0b0c0d0eff");
});

test("drawer client IDs fall back to secure bytes if randomUUID throws", () => {
  const clientId = loadClientId({
    randomUUID() { throw new Error("UUID unavailable"); },
    getRandomValues(bytes) { bytes.fill(0xa5); return bytes; },
  });
  assert.equal(clientId("chat"), `chat_${"a5".repeat(16)}`);
});

test("drawer client IDs request fresh secure randomness for each new ID", () => {
  let calls = 0;
  const clientId = loadClientId({ getRandomValues(bytes) { bytes.fill(++calls); return bytes; } });
  assert.equal(clientId("chat"), `chat_${"01".repeat(16)}`);
  assert.equal(clientId("chat"), `chat_${"02".repeat(16)}`);
  assert.equal(clientId("handoff"), `handoff_${"03".repeat(16)}`);
  assert.equal(calls, 3);
});

for (const [name, crypto] of [
  ["no Crypto object", undefined],
  ["no random methods", {}],
  ["non-callable random methods", { randomUUID: true, getRandomValues: true }],
  ["randomUUID throws and no secure fallback", { randomUUID() { throw new Error("UUID unavailable"); } }],
  ["getRandomValues throws", { getRandomValues() { throw new Error("CSPRNG unavailable"); } }],
  ["both secure methods throw", {
    randomUUID() { throw new Error("UUID unavailable"); },
    getRandomValues() { throw new Error("CSPRNG unavailable"); },
  }],
]) {
  test(`drawer client IDs fail closed with a user-facing error: ${name}`, () => {
    const clientId = loadClientId(crypto);
    for (const prefix of ["chat", "handoff", "pending", "msg"]) {
      assert.throws(() => clientId(prefix), /Secure random generation is unavailable/);
    }
  });
}
