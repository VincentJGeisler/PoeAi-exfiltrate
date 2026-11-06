import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
if (args.includes("--help")) {
  console.log("Usage: npm run validate -- [--output DIR]");
  process.exit(0);
}
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(option("--output", path.join(root, "exports")));
const index = JSON.parse(await readFile(path.join(output, "index.json"), "utf8"));
let catalog = null;
try {
  catalog = JSON.parse(await readFile(path.join(output, "catalog.json"), "utf8"));
} catch {}
const problems = [];
const emptyMedia = [];
let messages = 0;
let media = 0;
let complete = 0;

for (const [code, item] of Object.entries(index.chats)) {
  const directory = path.join(output, item.directory);
  try {
    const chat = JSON.parse(await readFile(path.join(directory, "chat.json"), "utf8"));
    const files = JSON.parse(await readFile(path.join(directory, "media.json"), "utf8"));
    if (chat.chatCode !== code) problems.push(`${code}: chat code mismatch`);
    if (chat.messages.length !== item.messageCount) problems.push(`${code}: message count mismatch`);
    const ids = chat.messages.map((message) => message.messageId);
    if (new Set(ids).size !== ids.length) problems.push(`${code}: duplicate message IDs`);
    if (ids.some((id, position) => position && Number(id) < Number(ids[position - 1]))) problems.push(`${code}: messages out of order`);
    const expected = new Set(chat.messages.flatMap((message) => message.attachments || []).filter((attachment) => attachment.url).map((attachment) => attachment.url));
    const actual = new Set(files.map((file) => file.sourceUrl));
    for (const url of expected) if (!actual.has(url)) problems.push(`${code}: missing attachment record`);
    if (expected.size !== files.length) problems.push(`${code}: attachment/media count mismatch`);
    for (const file of files) {
      const filename = path.join(directory, file.file);
      if (!existsSync(filename)) problems.push(`${code}: missing media ${file.file}`);
      else if ((await stat(filename)).size === 0) emptyMedia.push(`${code}: ${file.file}`);
    }
    for (const name of ["chat.md", "chat.html"]) {
      const filename = path.join(directory, name);
      if (!existsSync(filename) || (await stat(filename)).size === 0) problems.push(`${code}: missing/empty ${name}`);
    }
    if (item.status !== "complete") problems.push(`${code}: status ${item.status}`);
    else complete++;
    messages += chat.messages.length;
    media += files.length;
  } catch (error) {
    problems.push(`${code}: ${error.message}`);
  }
}

if (catalog) {
  const missing = catalog.chats.filter((chat) => !index.chats[chat.chatCode]).map((chat) => chat.chatCode);
  if (missing.length) problems.push(`Catalog chats absent from index: ${missing.join(",")}`);
  if (!catalog.complete) problems.push("Catalog scan is incomplete");
}

console.log(JSON.stringify({
  catalogComplete: catalog?.complete ?? null,
  catalogedChats: catalog?.chats?.length ?? null,
  indexedChats: Object.keys(index.chats).length,
  complete,
  messages,
  media,
  emptyMedia,
  problemCount: problems.length,
  problems,
}, null, 2));
if (problems.length) process.exitCode = 1;
