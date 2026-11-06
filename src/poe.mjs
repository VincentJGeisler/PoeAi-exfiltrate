import { randomBytes } from "node:crypto";
import { sleep } from "./cdp.mjs";

const HASHES = {
  useMessageCacheQuery: "a8790737547cc2763301232480b0d5cd1b6b5beb1a1ec6ae6d025b44fff90984",
  ChatPageQuery: "d9e39b2a96f1750e22b765727f5d4bd1636701277cad351ae6f316545b2b44ea",
  ChatListPaginationQuery: "a294b112132f513a057b103d9dc2cc777c64a426850411fe9e7b1b822da2e087",
};

export class PoeSession {
  constructor(client, { minDelayMs = 1_000, listMinDelayMs = 10 } = {}) {
    this.client = client;
    this.minDelayMs = Math.max(1_000, minDelayMs);
    this.listMinDelayMs = Math.max(10, listMinDelayMs);
    this.headers = null;
    this.lastRequestAt = 0;
    client.onEvent((message) => {
      if (message.method !== "Network.requestWillBeSent") return;
      const request = message.params.request;
      if (!request.url.includes("/api/gql")) return;
      try {
        const body = JSON.parse(request.postData || "{}");
        if (body.queryName === "useMessageCacheQuery") this.headers = request.headers;
      } catch {}
    });
  }

  async captureHeaders() {
    if (this.headers) return;
    console.log("Capturing Poe's current session request settings (not saved to disk)...");
    await this.client.call("Page.navigate", { url: "https://poe.com/chats" });
    for (let elapsed = 0; elapsed < 60_000 && !this.headers; elapsed += 250) {
      await sleep(250);
    }
    if (!this.headers) {
      throw new Error("Could not observe a chat-list request. Log in, open /chats, and retry.");
    }
  }

  async waitForHuman(reason) {
    console.log(`\nPaused: ${reason}`);
    console.log("Use the visible browser to log in or complete any CAPTCHA/Cloudflare challenge.");
    console.log("The exporter will keep checking and will not bypass the challenge.");
    while (true) {
      await sleep(5000);
      try {
        const state = await this.client.evaluate(`JSON.stringify({
          url: location.href,
          title: document.title,
          challenge: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
          text: document.body?.innerText?.slice(0, 2000) || ""
        })`);
        const page = JSON.parse(state);
        const text = `${page.title}\n${page.text}`.toLowerCase();
        const blocked = page.challenge || /just a moment|captcha|verify you are human|needs to review the security/.test(text);
        const loggedOut = /poe\.com\/login/.test(page.url);
        if (!blocked && !loggedOut) {
          this.headers = null;
          await this.captureHeaders();
          console.log("Browser access looks ready. Resuming slowly.");
          return;
        }
      } catch {}
    }
  }

  async throttle(kind = "chat") {
    const minimum = kind === "chat" ? this.minDelayMs : this.listMinDelayMs;
    const range = kind === "chat" ? 2001 : 101;
    const jitterMs = Math.floor(Math.random() * range);
    const remaining = minimum + jitterMs - (Date.now() - this.lastRequestAt);
    if (remaining > 0) await sleep(remaining);
    this.lastRequestAt = Date.now();
  }

  async gql(queryName, variables) {
    const hash = HASHES[queryName];
    if (!hash) throw new Error(`No persisted-query hash is known for ${queryName}.`);
    for (let attempt = 0; ; attempt++) {
      await this.captureHeaders();
      const kind = queryName === "ChatPageQuery" ? "chat" : queryName === "ChatListPaginationQuery" ? "history" : "list";
      await this.throttle(kind);
      const headers = {
        ...this.headers,
        "Content-Type": "application/json",
        "poe-queryname": queryName,
        "poe-tag-id": randomBytes(16).toString("hex"),
      };
      const expression = `(async () => {
        const response = await fetch('/api/gql_POST', {
          method: 'POST',
          headers: ${JSON.stringify(headers)},
          body: JSON.stringify(${JSON.stringify({ queryName, variables, extensions: { hash } })}),
          signal: AbortSignal.timeout(60000)
        });
        const body = await response.text();
        return JSON.stringify({ status: response.status, body });
      })()`;
      let result;
      try {
        result = JSON.parse(await this.client.evaluate(expression));
      } catch (error) {
        if (!/Failed to fetch|NetworkError|network error|TimeoutError|AbortError/i.test(error.message)) throw error;
        await this.waitForHuman("The browser could not complete a network request.");
        continue;
      }
      this.lastRequestAt = Date.now();
      if (result.status === 403 || result.status === 429 || result.status >= 500) {
        await this.waitForHuman(`Poe returned HTTP ${result.status}.`);
        continue;
      }
      if (result.status !== 200) throw new Error(`Poe returned HTTP ${result.status}.`);
      const payload = JSON.parse(result.body);
      if (payload.errors?.length) {
        if (attempt >= 2) throw new Error(payload.errors.map((error) => error.message).join("; "));
        await sleep(this.minDelayMs);
        continue;
      }
      return payload.data;
    }
  }

  async listChats(limit = 0, exclude = () => false, { initialChats = [], after = null, onPage = null } = {}) {
    const scanned = new Map(initialChats.map((chat) => [chat.chatCode, chat]));
    const chats = new Map(initialChats.filter((chat) => !exclude(chat)).map((chat) => [chat.chatCode, chat]));
    let page = 0;
    do {
      const data = await this.gql("useMessageCacheQuery", {
        limit: 100,
        after,
        since: "0",
      });
      const connection = data?.recentMessages;
      if (!connection) throw new Error("Chat-list response did not contain recentMessages.");
      for (const edge of connection.edges || []) {
        const chat = edge.node?.chat;
        if (!chat?.chatCode) continue;
        scanned.set(chat.chatCode, chat);
        if (!exclude(chat)) chats.set(chat.chatCode, chat);
      }
      after = connection.pageInfo?.endCursor || null;
      if (onPage) await onPage([...scanned.values()], after);
      console.log(`Cataloged ${scanned.size} chats; found ${chats.size} unfinished chats.`);
      if (limit && chats.size >= limit) break;
      if (!after) break;
      page++;
      if (page > 10000) throw new Error("Chat-list pagination did not terminate.");
    } while (after);
    const result = [...chats.values()];
    return limit ? result.slice(0, limit) : result;
  }

  async getChat(chatCode) {
    const data = await this.gql("ChatPageQuery", { chatCode });
    const chat = data?.chatOfCode;
    if (!chat) throw new Error(`Chat ${chatCode} was not returned.`);
    const messages = new Map();
    for (const edge of chat.messagesConnection?.edges || []) {
      if (edge.node?.messageId) messages.set(edge.node.messageId, edge);
    }
    let pageInfo = chat.messagesConnection?.pageInfo;
    let pages = 0;
    while (pageInfo?.hasPreviousPage && pageInfo.startCursor) {
      const older = await this.gql("ChatListPaginationQuery", {
        count: 25,
        cursor: pageInfo.startCursor,
        id: chat.id,
      });
      const connection = older?.node?.messagesConnection;
      if (!connection) throw new Error(`Older-message response for ${chatCode} was incomplete.`);
      for (const edge of connection.edges || []) {
        if (edge.node?.messageId) messages.set(edge.node.messageId, edge);
      }
      pageInfo = connection.pageInfo;
      pages++;
      if (pages > 100000) throw new Error(`Message pagination did not terminate for ${chatCode}.`);
      console.log(`  Recovered ${messages.size} messages so far.`);
    }
    chat.messagesConnection.edges = [...messages.values()].sort(
      (left, right) => Number(left.node.messageId) - Number(right.node.messageId),
    );
    chat.messagesConnection.pageInfo = { ...pageInfo, hasPreviousPage: false };
    return chat;
  }
}
