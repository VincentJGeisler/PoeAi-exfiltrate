import { launchBrowser } from "./src/browser.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

if (args.includes("--help")) {
  console.log("Usage: npm run launch -- [--browser PATH] [--profile DIR] [--endpoint URL] [--dry-run]");
} else {
  await launchBrowser({
    browser: option("--browser"),
    profile: option("--profile"),
    endpoint: option("--endpoint", "http://127.0.0.1:9222"),
    dryRun: args.includes("--dry-run"),
  });
}
