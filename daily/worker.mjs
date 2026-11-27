import { replay, rulesVersion, tickRate } from "./engine.mjs";

const utf8 = new TextEncoder();
const decoder = new TextDecoder();
const maxBody = 24 * 1024;
const hour = 3600000;

function dayAt(now) {
  return new Date(now + 8 * hour).toISOString().slice(0, 10);
}

function seedFor(day) {
  let hash = 2166136261;
  for (const char of day) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const to64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const from64 = s => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));

async function signingKey(secret) {
  return crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(value, key) {
  const payload = to64(utf8.encode(JSON.stringify(value)));
  const sig = await crypto.subtle.sign("HMAC", key, utf8.encode(payload));
  return payload + "." + to64(new Uint8Array(sig));
}

async function verify(token, key) {
  if (typeof token !== "string" || token.length > 768 || !/^[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const [payload, sig] = token.split(".");
    if (!await crypto.subtle.verify("HMAC", key, from64(sig), utf8.encode(payload))) return null;
    return JSON.parse(decoder.decode(from64(payload)));
  } catch {
    return null;
  }
}

class BadRequest extends Error {}
async function readJson(request) {
  if (!request.body || Number(request.headers.get("Content-Length")) > maxBody) throw new BadRequest("请求过大");
  const reader = request.body.getReader();
  let length = 0, buffer = "";
  const decode = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBody) {
      await reader.cancel();
      throw new BadRequest("请求过大");
    }
    buffer += decode.decode(value, { stream: true });
  }
  try {
    const value = JSON.parse(buffer + decode.decode());
    if (!value || Array.isArray(value) || typeof value !== "object") throw Error();
    return value;
  } catch {
    throw new BadRequest("请求格式不正确");
  }
}

function supportsRules(version) {
  return version === 2 || version === 3 || version === rulesVersion;
}

async function board(db, day, version) {
  const query = `SELECT name, score FROM (
    SELECT name, score, submitted,
      ROW_NUMBER() OVER (PARTITION BY player ORDER BY score DESC, submitted ASC, id ASC) AS best
    FROM entries WHERE day = ? AND rules_version = ?
  ) WHERE best = 1 ORDER BY score DESC, submitted ASC, name ASC LIMIT 25`;
  const { results } = await db.prepare(query).bind(day, version).all();
  return results;
}

function d1Store(db) {
  return {
    board: (day, version) => board(db, day, version),
    score: id => db.prepare("SELECT score FROM entries WHERE id = ?").bind(id).first(),
    submit: ({ id, player, day, name, score, submitted, rules_version }) =>
      db.prepare("INSERT INTO entries (id, player, day, name, score, submitted, rules_version) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
        .bind(id, player, day, name, score, submitted, rules_version).run(),
  };
}

export async function handleRequest(request, env, now = Date.now()) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOW_ORIGINS || "").split(/\s+/);
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" });
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowed.includes(origin)) return reply({ error: "这个网页地址未配置今日榜" }, 403);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  const url = new URL(request.url);
  const path = url.pathname;
  const day = dayAt(now);
  const store = env.STORE ?? d1Store(env.DB);
  try {
    if (request.method === "GET" && path === "/board") {
      const version = Number(url.searchParams.get("rulesVersion") ?? 2);
      if (!supportsRules(version)) return reply({ error: "请刷新游戏后再开始" }, 409);
      return reply({ day, rulesVersion: version, entries: await store.board(day, version) });
    }
    if (request.method !== "POST" || !["/start", "/submit"].includes(path)) return reply({ error: "接口不存在" }, 404);
    if (typeof env.HMAC_SECRET !== "string" || env.HMAC_SECRET.length < 32) return reply({ error: "今日榜暂未配置" }, 503);
    const key = await signingKey(env.HMAC_SECRET);
    const body = await readJson(request);
    if (path === "/start") {
      const version = body.rulesVersion;
      if (!supportsRules(version)) return reply({ error: "请刷新游戏后再开始" }, 409);
      const identity = await verify(body.player, key);
      const playerId = identity?.type === "player" ? identity.id : crypto.randomUUID();
      const player = await sign({ type: "player", id: playerId }, key);
      const seed = seedFor(day);
      const run = await sign({ type: "run", id: crypto.randomUUID(), player: playerId, day, seed, started: now, rulesVersion: version }, key);
      return reply({ day, seed, run, player, rulesVersion: version });
    }
    const run = await verify(body.run, key);
    if (run?.type !== "run" || !supportsRules(run.rulesVersion) || run.day !== day ||
        now < run.started || now - run.started > 2 * hour) {
      return reply({ error: "对局已过期，请重新开始" }, 409);
    }
    if (!Number.isSafeInteger(body.tick) || body.tick / tickRate * 1000 > now - run.started + 8000 ||
        !Number.isSafeInteger(body.score) || typeof body.name !== "string") {
      return reply({ error: "对局记录格式不正确" }, 422);
    }
    const name = body.name.trim().normalize("NFC");
    if (!name || name.length > 18 || /[\p{Cc}\p{Cf}]/u.test(name)) return reply({ error: "昵称须为 1–18 个可见字符" }, 422);

    const existing = await store.score(run.id);
    if (existing) return reply({ day, score: existing.score });
    const verified = replay(run.seed, body.actions, body.tick, run.rulesVersion);
    if (!verified || !verified.drops || verified.score !== body.score) {
      return reply({ error: "回放无法重现本局成绩" }, 422);
    }
    await store.submit({ id: run.id, player: run.player, day, name, score: verified.score, submitted: now, rules_version: run.rulesVersion });
    const submitted = await store.score(run.id);
    return reply({ day, score: submitted.score });
  } catch (error) {
    if (error instanceof BadRequest) return reply({ error: error.message }, 400);
    console.error(error);
    return reply({ error: "今日榜暂时不可用" }, 503);
  }
}

export default { fetch: (request, env) => handleRequest(request, env) };
