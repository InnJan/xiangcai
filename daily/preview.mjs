import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleRequest } from "./worker.mjs";

const origin = "http://127.0.0.1:8787";
const database = new DatabaseSync(":memory:");
database.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const env = {
  HMAC_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  ALLOW_ORIGINS: origin,
  DB: {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => statement.get(...args),
            all: async () => ({ results: statement.all(...args) }),
            run: async () => statement.run(...args),
          };
        },
      };
    },
  },
};
const localPage = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  .replace(/^const dailyApi = "[^"]*";$/m, 'const dailyApi = "/api";');
const maxBytes = 24 * 1024;

createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (url.pathname === "/" && incoming.method === "GET") {
      outgoing.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      outgoing.end(localPage);
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      outgoing.writeHead(404).end();
      return;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > maxBytes) {
        outgoing.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    url.pathname = url.pathname.slice(4);
    const response = await handleRequest(new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    }), env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(8787, "127.0.0.1", () => console.log("每日挑战本地试玩 " + origin));
