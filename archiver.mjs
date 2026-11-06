import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, sleep } from "./src/cdp.mjs";
import { PoeSession } from "./src/poe.mjs";
import { Exporter } from "./src/exporter.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
if (args.includes("--help")) {
  console.log("Usage: npm start -- [--limit N] [--output DIR] [--endpoint URL] [--delay MS] [--refresh] [--reindex]");
  process.exit(0);
}
const limit = Math.max(0, Number(option("--limit", "0")) || 0);
const delay = Math.max(1_000, Number(option("--delay", "1000")) || 1_000);
const output = path.resolve(option("--output", path.join(path.dirname(fileURLToPath(import.meta.url)), "exports")));

const client = await CdpClient.connect(option("--endpoint", "http://127.0.0.1:9222"));
const poe = new PoeSession(client, { minDelayMs: delay });
const exporter = new Exporter(output);
await exporter.init();

try {
  console.log(`Export directory: ${output}`);
  console.log(`Delays: chat list/history 10-110ms; opening chats ${delay / 1000}-${delay / 1000 + 2}s; media up to 3 concurrent downloads.`);
  const catalog = args.includes("--reindex") ? null : exporter.catalog;
  if (catalog) console.log(`Resuming from the saved catalog of ${catalog.chats.length} chats.`);
  const chats = catalog?.complete
    ? (args.includes("--refresh") ? catalog.chats.slice(0, limit || catalog.chats.length) : [])
    : await poe.listChats(
    limit,
    (chat) => !args.includes("--refresh") && exporter.isComplete(chat.chatCode),
    {
      initialChats: catalog?.chats || [],
      after: catalog?.nextCursor || null,
      onPage: (scanned, nextCursor) => exporter.saveCatalog(scanned, nextCursor),
    },
  );
  console.log(`Selected ${chats.length} unfinished chats. Catalog progress is saved after every page.`);
  for (const [index, item] of chats.entries()) {
    if (!args.includes("--refresh") && exporter.isComplete(item.chatCode)) {
      console.log(`[${index + 1}/${chats.length}] Skipping completed ${item.title || item.chatCode}`);
      continue;
    }
    console.log(`[${index + 1}/${chats.length}] Exporting ${item.title || item.chatCode}`);
    const chat = await poe.getChat(item.chatCode);
    const { directory, record } = await exporter.saveChat(chat);
    console.log(`  Saved ${record.messageCount} messages.`);
    if (chat.messagesConnection?.pageInfo?.hasPreviousPage) {
      console.log("  Older-message pagination support is not yet confirmed; this chat is marked partial.");
    }
    await exporter.downloadMedia(directory, record);
  }
  console.log("Selected export finished. Check index.json for per-chat status.");
} finally {
  client.close();
}
