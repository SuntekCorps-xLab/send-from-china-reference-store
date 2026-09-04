import { access } from "node:fs/promises";
import path from "node:path";

function unique(values, { caseInsensitive = false } = {}) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value) return false;
    const key = caseInsensitive ? value.toLowerCase() : value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function installedChromiumCandidates({ platform = process.platform, env = process.env } = {}) {
  const explicit = String(env.CHROME_PATH || "").trim();
  if (platform === "win32") {
    const programFiles = String(env.ProgramFiles || "C:\\Program Files");
    const programFilesX86 = String(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)");
    const localAppData = String(env.LOCALAPPDATA || "").trim();
    return unique([
      explicit,
      path.win32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.win32.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && path.win32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.win32.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.win32.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData && path.win32.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.win32.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.win32.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      localAppData && path.win32.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    ], { caseInsensitive: true });
  }
  if (platform === "darwin") {
    return unique([
      explicit,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ]);
  }
  return unique([
    explicit,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/brave-browser",
  ]);
}

export async function resolveInstalledChromiumPath(options = {}) {
  const candidates = installedChromiumCandidates(options);
  const canAccess = options.access || access;
  for (const candidate of candidates) {
    try {
      await canAccess(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(
    `Chrome-compatible browser was not found. Set CHROME_PATH to a Chrome, Chromium, Edge, or Brave executable. Checked: ${candidates.join(", ")}`,
  );
}
