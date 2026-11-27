import { handleRequest } from "./worker.mjs";

export function supabaseStore(url, key, request = fetch) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  async function call(path, options = {}) {
    const response = await request(url + "/rest/v1/" + path, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error("Leaderboard database error " + response.status);
    return response.status === 204 || options.method === "POST" && path.startsWith("cilantro_daily_entries")
      ? null : response.json();
  }
  return {
    signingSecret: () => call("rpc/cilantro_daily_signing_key", { method: "POST", body: "{}" }),
    board: (day, version) => call("rpc/cilantro_daily_board_for_rules", {
      method: "POST", body: JSON.stringify({ p_day: day, p_version: version }),
    }),
    async score(id) {
      const rows = await call("cilantro_daily_entries?id=eq." + encodeURIComponent(id) + "&select=score&limit=1");
      return rows[0] ?? null;
    },
    submit: entry => call("cilantro_daily_entries", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(entry),
    }),
  };
}

export function supabaseHandler(env) {
  const prefix = "/cilantro-board";
  let signingSecret;
  return async request => {
    const url = new URL(request.url);
    const offset = url.pathname.indexOf(prefix + "/");
    if (offset >= 0) url.pathname = url.pathname.slice(offset + prefix.length);
    let config = env;
    const allowed = env.ALLOW_ORIGINS.split(/\s+/);
    const origin = request.headers.get("Origin");
    if (request.method === "POST" && ["/start", "/submit"].includes(url.pathname) &&
        (!origin || allowed.includes(origin))) {
      try {
        signingSecret ??= env.STORE.signingSecret();
        config = { ...env, HMAC_SECRET: await signingSecret };
      } catch {
        signingSecret = undefined;
      }
    }
    return handleRequest(new Request(url, request), config);
  };
}
