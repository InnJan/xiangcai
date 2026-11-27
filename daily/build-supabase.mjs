import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const files = ["engine.mjs", "worker.mjs", "supabase.mjs"];
const parts = files.map(file => readFileSync(new URL(file, import.meta.url), "utf8")
  .replace(/^import [^\n]+\n/gm, "")
  .replace(/^export \{ [^\n]+\};\n/gm, "")
  .replace(/^export default [^\n]+\n/gm, "")
  .replace(/^export (?=(async )?function )/gm, ""));
const entry = `
const projectUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!projectUrl || !serviceKey) throw new Error("Missing leaderboard configuration");
Deno.serve(supabaseHandler({
  ALLOW_ORIGINS: Deno.env.get("CILANTRO_ALLOWED_ORIGINS") ||
    "https://xiangcai.yinjinghang.com http://xiangcai.yinjinghang.com",
  STORE: supabaseStore(projectUrl, serviceKey)
}));
`;
const out = new URL("supabase-dist/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("index.js", out), parts.join("\n") + entry);
