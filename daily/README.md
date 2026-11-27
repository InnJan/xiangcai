# 每日同题榜原型

需要 Node.js 24。可在仓库根目录用以下命令生成校验逻辑、跑测试和预览。

```sh
node daily/build-engine.mjs
node daily/test.mjs
node daily/preview.mjs
```

打开 [本地预览](http://127.0.0.1:8787/) 后选择「每日挑战」。本地成绩用内存 SQLite 保存，服务重启即清空。普通模式与每日同题模式分别计分。

- `build-engine.mjs` 从 `index.html` 提取物理和合成规则，生成供服务端使用的 `engine.mjs`。修改相关玩法后，重新生成并升级前后端的 `rulesVersion`。
- `worker.mjs` 提供 `GET /board`、`POST /start`、`POST /submit`。开局发放带签名的匿名身份和对局编号。结算由服务器复现投放、移除券和复活操作，校验后才写入成绩。
- 榜单按北京时间分日，保存同一匿名浏览器身份的最高分，只显示昵称和分数。重新安装浏览器或清理站点数据会生成新身份。
- 公开部署需要支持长局回放的 HTTPS 执行环境、数据库和至少 32 字符的随机 `HMAC_SECRET`。Cloudflare D1 要绑定为 `DB`，先应用 `schema.sql`。通过 `ALLOW_ORIGINS` 配置允许访问的游戏 HTTPS 源，再在网页中配置 `dailyApi`。当前主站的公开版本没有接上日榜。
- 测试中两万多帧的一次性回放耗时数百毫秒。Cloudflare Workers Free 的单次 HTTP 请求 CPU 上限为 10 毫秒，当前回放实现适合先在本地或具备相应 CPU 配额的服务验证。跨浏览器正式开放前还需用实际浏览器录制对局和复现结果。

## Supabase 部署准备

1. 在独立项目中依次执行 `daily/supabase.sql` 和 `daily/supabase-rules-v3.sql`。榜单表只给服务端角色开放。
2. 运行 `node daily/build-engine.mjs` 和 `node daily/build-supabase.mjs`。生成的 `daily/supabase-dist/index.js` 可作为 Edge Function `cilantro-board` 的单文件入口。
3. SQL 会生成独立的排行榜签名密钥，仅允许服务端读取。可以用 `CILANTRO_ALLOWED_ORIGINS` 覆盖默认允许的游戏域名；多个 origin 用空格分隔。
4. 对 `cilantro-board` 关闭平台 JWT 校验，允许匿名玩家领题。对局和提交仍由函数验证自签名令牌。服务端密钥不得写入网页。
5. 核对 `/board`、`/start` 和真实对局 `/submit` 在远端可用，再把网页的 `dailyApi` 指向该 Edge Function 的 HTTPS URL。首页按钮只在配置后显示。

规则版本 3 保留突击检查，将每第 11 次投放的吹偏幅度从 12 提至 110 个棋盘坐标单位（棋盘宽度四分之一），并将移除券奖励改为每满 2,000 分发一张。旧版对局仍按规则版本 2 回放，榜单按规则版本查询。

规则版本 4 采用按场面调整的出球。合出第 5 级前，投放物不会比棋盘上当前最大的角色更大。之后的抽取至少有 30% 机会来自第 1–4 级，同时按本局历史最高等级扩展较大角色的范围。每日挑战共用当天的随机序列，但出球大小随各自棋盘状态调整。版本 2 和 3 的对局仍使用原来的出球函数。
