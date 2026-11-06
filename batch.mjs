import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
if (args.includes("--help")) {
  console.log("Usage: npm run batch -- [--min-batch 40] [--max-batch 60] [--pause-ms 30000] [exporter options]");
  process.exit(0);
}
const minimum = Math.max(1, Number(option("--min-batch", "40")) || 40);
const maximum = Math.max(minimum, Number(option("--max-batch", "60")) || 60);
const pauseMs = Math.max(0, Number(option("--pause-ms", "30000")) || 0);
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(option("--output", path.join(root, "exports")));
const forwarded = args.filter((arg, index) => {
  if (["--min-batch", "--max-batch", "--pause-ms"].includes(arg)) return false;
  return !["--min-batch", "--max-batch", "--pause-ms"].includes(args[index - 1]);
});
const run = (childArgs) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, childArgs, { stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Exporter stopped with exit code ${code}.`)));
});

while (true) {
  const size = minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  console.log(`\n===== Starting randomized batch of ${size} chats =====`);
  await run([path.join(root, "archiver.mjs"), "--limit", String(size), ...forwarded]);
  const catalog = JSON.parse(await readFile(path.join(output, "catalog.json"), "utf8"));
  if (catalog.complete) {
    console.log("\nReached the end of the account chat list; all discovered chats are exported.");
    break;
  }
  console.log(`\n===== Batch complete; waiting ${pauseMs / 1000} seconds =====`);
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
}
