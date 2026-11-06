import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const slug = (value) => String(value || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chat";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const timestamp = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const milliseconds = number > 1e17 ? number / 1e6 : number > 1e14 ? number / 1e3 : number > 1e11 ? number : number * 1000;
  return new Date(milliseconds).toISOString();
};
const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
};
const writeFileAtomic = async (file, content) => {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, file);
};

export class Exporter {
  constructor(outputRoot) {
    this.outputRoot = outputRoot;
    this.indexFile = path.join(outputRoot, "index.json");
    this.catalogFile = path.join(outputRoot, "catalog.json");
  }

  async init() {
    await mkdir(this.outputRoot, { recursive: true });
    this.index = await readJson(this.indexFile, { schemaVersion: 1, chats: {} });
    this.catalog = await readJson(this.catalogFile, null);
  }

  async saveCatalog(chats, nextCursor) {
    this.catalog = { schemaVersion: 1, chats, nextCursor, complete: nextCursor === null };
    await writeFileAtomic(this.catalogFile, JSON.stringify(this.catalog, null, 2));
  }

  async saveIndex() {
    await writeFileAtomic(this.indexFile, JSON.stringify(this.index, null, 2));
  }

  isComplete(chatCode) {
    return this.index.chats[chatCode]?.status === "complete";
  }

  async saveChat(chat) {
    const chatCode = chat.chatCode;
    const directory = path.join(this.outputRoot, `${chatCode}-${slug(chat.title)}`);
    await mkdir(directory, { recursive: true });
    const messages = chat.messagesConnection?.edges?.map((edge) => edge.node) || [];
    const record = {
      schemaVersion: 1,
      title: chat.title,
      chatId: chat.chatId,
      chatCode,
      url: `https://poe.com/chat/${chatCode}`,
      createdAt: timestamp(chat.creationTime),
      messageCount: messages.length,
      messages,
    };
    await writeFileAtomic(path.join(directory, "chat.json"), JSON.stringify(record, null, 2));
    await writeFileAtomic(path.join(directory, "chat.md"), this.markdown(record));
    await writeFileAtomic(path.join(directory, "chat.html"), this.html(record));
    this.index.chats[chatCode] = {
      title: chat.title,
      directory: path.basename(directory),
      messageCount: messages.length,
      status: chat.messagesConnection?.pageInfo?.hasPreviousPage ? "partial-older-messages" : "metadata-downloaded",
    };
    await this.saveIndex();
    return { directory, record };
  }

  async downloadMedia(directory, record) {
    const mediaDirectory = path.join(directory, "media");
    const seen = new Set();
    const attachments = [];
    for (const message of record.messages) {
      for (const attachment of message.attachments || []) {
        if (!attachment.url || seen.has(attachment.url)) continue;
        seen.add(attachment.url);
        attachments.push(attachment);
      }
    }
    const downloaded = new Array(attachments.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < attachments.length) {
        const index = nextIndex++;
        const attachment = attachments[index];
        const filename = `${attachment.attachmentId || index + 1}-${slug(path.basename(attachment.name || "attachment"))}`;
        const destination = path.join(mediaDirectory, filename);
        await mkdir(mediaDirectory, { recursive: true });
        const response = await fetch(attachment.url, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok || !response.body) {
          throw new Error(`Media download failed with HTTP ${response.status}: ${attachment.name || attachment.url}`);
        }
        await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
        downloaded[index] = { name: attachment.name, file: `media/${filename}`, sourceUrl: attachment.url };
        console.log(`    Downloaded ${attachment.name || filename}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, attachments.length) }, worker));
    await writeFileAtomic(path.join(directory, "media.json"), JSON.stringify(downloaded, null, 2));
    this.index.chats[record.chatCode].status = "complete";
    this.index.chats[record.chatCode].mediaCount = downloaded.length;
    await this.saveIndex();
    const completed = Object.values(this.index.chats).filter((chat) => chat.status === "complete");
    const messages = completed.reduce((total, chat) => total + chat.messageCount, 0);
    const media = completed.reduce((total, chat) => total + (chat.mediaCount || 0), 0);
    console.log(`  Progress: ${completed.length} chats complete | ${messages} messages | ${media} media files`);
  }

  markdown(record) {
    const parts = [`# ${record.title}`, "", `Source: ${record.url}`, ""];
    for (const message of record.messages) {
      const author = message.bot?.displayName || message.bot?.handle || message.authorUser?.handle || message.authorNickname || "unknown";
      parts.push(`## ${author}`, "");
      if (timestamp(message.creationTime)) parts.push(`*${timestamp(message.creationTime)}*`, "");
      parts.push(message.text || "", "");
      for (const attachment of message.attachments || []) {
        parts.push(`- Attachment: ${attachment.name || "file"} (${attachment.url})`);
      }
      parts.push("");
    }
    return parts.join("\n");
  }

  html(record) {
    const messages = record.messages.map((message) => {
      const author = message.bot?.displayName || message.bot?.handle || message.authorUser?.handle || message.authorNickname || "unknown";
      const attachments = (message.attachments || []).map((attachment) => `<li><a href="${escapeHtml(attachment.url)}">${escapeHtml(attachment.name || "Attachment")}</a></li>`).join("");
      return `<article><h2>${escapeHtml(author)}</h2><time>${escapeHtml(timestamp(message.creationTime) || "")}</time><pre>${escapeHtml(message.text || "")}</pre><ul>${attachments}</ul></article>`;
    }).join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(record.title)}</title><style>body{font:16px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem}article{border-top:1px solid #ccc;padding:1rem 0}pre{white-space:pre-wrap;font:inherit}time{color:#666}</style></head><body><h1>${escapeHtml(record.title)}</h1><p><a href="${escapeHtml(record.url)}">Original chat</a></p>${messages}</body></html>`;
  }
}
