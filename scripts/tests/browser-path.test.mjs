import assert from "node:assert/strict";
import test from "node:test";

import {
  installedChromiumCandidates,
  resolveInstalledChromiumPath,
} from "../browser-path.mjs";

test("an explicit CHROME_PATH is always the first candidate", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    assert.equal(installedChromiumCandidates({
      platform,
      env: { CHROME_PATH: "/controlled/browser" },
    })[0], "/controlled/browser");
  }
});

test("candidate lists cover common Chromium-family browsers on every supported OS", () => {
  const windows = installedChromiumCandidates({
    platform: "win32",
    env: {
      ProgramFiles: "C:\\Programs",
      "ProgramFiles(x86)": "C:\\Programs32",
      LOCALAPPDATA: "C:\\Local",
    },
  }).join("\n");
  assert.match(windows, /Google\\Chrome/u);
  assert.match(windows, /Microsoft\\Edge/u);
  assert.match(windows, /BraveSoftware/u);

  const mac = installedChromiumCandidates({ platform: "darwin", env: {} }).join("\n");
  assert.match(mac, /Google Chrome\.app/u);
  assert.match(mac, /Chromium\.app/u);
  assert.match(mac, /Microsoft Edge\.app/u);
  assert.match(mac, /Brave Browser\.app/u);

  const linux = installedChromiumCandidates({ platform: "linux", env: {} }).join("\n");
  assert.match(linux, /chromium/u);
  assert.match(linux, /microsoft-edge/u);
  assert.match(linux, /brave-browser/u);
});

test("resolution chooses the first accessible candidate and fails closed otherwise", async () => {
  const visited = [];
  const selected = await resolveInstalledChromiumPath({
    platform: "linux",
    env: { CHROME_PATH: "/explicit/missing" },
    access: async (candidate) => {
      visited.push(candidate);
      if (candidate !== "/usr/bin/chromium") {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
    },
  });
  assert.equal(selected, "/usr/bin/chromium");
  assert.deepEqual(visited.slice(0, 4), [
    "/explicit/missing",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ]);

  await assert.rejects(
    resolveInstalledChromiumPath({
      platform: "darwin",
      env: {},
      access: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    }),
    /Set CHROME_PATH/u,
  );
});
