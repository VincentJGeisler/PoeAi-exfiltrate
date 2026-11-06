import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const browserCandidates = () => {
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((root) => [
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Chromium", "Application", "chrome.exe"),
    ]);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return ["microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
};

export const findBrowser = (explicitPath) => {
  if (explicitPath) {
    if (!existsSync(explicitPath)) throw new Error(`Browser executable not found: ${explicitPath}`);
    return explicitPath;
  }
  for (const candidate of browserCandidates()) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
    } else {
      const result = spawnSync("which", [candidate], { encoding: "utf8" });
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    }
  }
  throw new Error("No Edge, Chrome, or Chromium installation found. Pass --browser /path/to/browser.");
};

export const endpointIsReady = async (endpoint) => {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
};

export const launchBrowser = async ({ browser, profile, endpoint, dryRun = false }) => {
  const url = new URL(endpoint);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("The browser debugging endpoint must use a loopback address.");
  }
  if (await endpointIsReady(endpoint)) {
    console.log(`Browser debugging endpoint is already available at ${endpoint}.`);
    return;
  }
  const executable = findBrowser(browser);
  const profileDirectory = path.resolve(profile || path.join(homedir(), ".poe-archiver", "browser-profile"));
  const args = [
    `--remote-debugging-port=${url.port || "9222"}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://poe.com/chats",
  ];
  console.log(`Browser: ${executable}`);
  console.log(`Profile: ${profileDirectory}`);
  console.log(`Endpoint: ${endpoint}`);
  if (dryRun) {
    console.log("Dry run: browser was not launched.");
    return;
  }
  await mkdir(profileDirectory, { recursive: true });
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await endpointIsReady(endpoint)) {
      console.log("Browser launched. Log into Poe in that window, then run npm start.");
      return;
    }
  }
  throw new Error("The browser started but its debugging endpoint did not become available.");
};
