# 运行、构建与部署

## 1. 形态

单个 Worker 同时承担两件事：

1. 提供前端静态资源（由平台的静态资源托管能力处理）
2. 提供 API 与 WebSocket 入口（Hono 路由），并把 WebSocket 转发给对应厅的房间服务实例

前端与后端**同源**，因此会话 cookie 自动随 WebSocket 握手发送，不需要令牌交换或跨域配置。

## 2. 本地开发

| 目的 | 命令 |
| :--- | :--- |
| 准备本机密钥（一次） | `cp .dev.vars.example .dev.vars`——会话签名密钥本机也要显式给，代码里没有任何回落 |
| 起完整站点（后端 + 房间服务 + SQLite + 静态资源） | `npm run build && npm run dev`——端口从 `127.0.0.1:8787` 起自动 +1 找空闲（**实际 URL 看终端输出**） |
| 前端热更新开发服务器（`/api` 代理到本 worktree 的后端端口，含 WebSocket） | `npm run dev:web`（vite 自身从 5173 起自动 +1；代理目标见下方「本地端口」） |
| 单元测试 | `npm test` |
| 类型检查 | `npm run typecheck` |
| 设计令牌校验 / 生成 | `npm run lint:design` / `npm run tokens` |
| 部署（应急：本机手工） | `npm run deploy`——**正常发版由推 tag 触发 CI 自动部署**，见 §4.4 |

| 目的 | 做法 |
| :--- | :--- |
| 起后端 + 房间服务 + SQLite | `npm run dev` 包一层平台的本地运行命令（`wrangler dev`），自动从 8787 起选空闲端口。本地即可获得完整的对象、SQLite 与 WebSocket 能力 |
| 起前端 | 前端开发服务器（`vite`），把 API 与 WebSocket 请求代理到本地运行的后端 |
| 双浏览器验证多人 | 同一台机器开两个浏览器配置文件（cookie 隔离），或一个正常窗口 + 一个隐私窗口 |
| 制造边界场景 | 本地把厅容量调小（改 `meta.bed_count`，档位见 `20-layout.md` §3.1 的级表），便于触发「厅满」「床位被占」 |
| **干净库**（出生点 / 认领 / 床号这类要看空厅的验收） | 先删掉 `.wrangler/state/v3/do/` 下的本地对象存储再起 `npm run dev`。**不删的后果**（实测）：本地库里有上次验收留下的未过期归属（`bed_no=0` 被上一次会话占着）→ 出生点直接跳到 1 号床、「躺上第一张床」这类用例做不成；另外还会重放旧厅标识留下的持久唤醒（日志里那几条「不认识的厅标识」） |

**本地端口**：`npm run dev` 先探测 `127.0.0.1:8787` 起第一个空闲端口，把它写进 `.wrangler/dev-port`，inspector 端口同法从「端口 + 1000」起探测；`npm run dev:web` 读这个文件决定代理目标（缺省 8787），所以**先起后端、再起前端**。后端换了端口要重启 `dev:web`——代理目标只在启动时读一次。多个 worktree 同一瞬间启动仍有毫秒级抢端口窗口，撞了重跑即得下一个端口。

**代理键必须是正则 `^/api(/|$)`**：写成 `'/api'` 是前缀匹配，会把客户端模块 `src/client/api.ts`（浏览器请求 `/api.ts`）也代理给后端；后端 SPA 回退返回 `index.html`，浏览器以 `text/html` 拒绝这个模块，`dev:web` 整页空白（前端一条业务代码都没跑到）。

**验证要点（人工）**：两个浏览器里的小人能否互相看见、走动是否平滑、躺下后另一侧是否立即看到、断网 60 秒后是否变成睡痕、重连是否回到原状态。

## 3. 构建

| 产物 | 说明 |
| :--- | :--- |
| 美术素材 | `npm run art` 从 `tools/art/masters/` 的母图重新生成 **构建输入**：图集 `src/client/assets/sprites/atlas.png` + `atlas.json`、逐帧坐标的 `src/client/styles/frames.css`；许可声明仍写 `public/sprites/LICENSE-*.txt`（供 `README.md` / `AGENTS.md` / `20-layout.md` 引用，`public/` 里不再有贴图）。**产物入库，不挂进 `npm run build`**（构建保持快且确定）；改素材或改映射规则后要重跑。三者的进构建方式不同、都因此落进 `/assets/*` 吃 §3 末尾那条 `immutable`：`atlas.png` 走 `?url` 拿内容哈希 URL；`atlas.json` 被**内联进 `world` chunk**（Phaser 的 `load.atlas()` 第三参接受对象，**不发 JSON 请求**）；`frames.css` 由 `index.html` 的**相对路径** `<link>` 引入（Vite 把它并进入口 CSS、随它一起带内容哈希）。母图有两种：`WheatCloudSleep` 的 5 张 PNG（床与小人），以及**猫与篝火**——它们是自绘 SVG，上游只提供一张 **1160×1072 的合成图 + 帧坐标 JSON**，已一次性栅格化为 `cat-sheet.png`（透明、已去掉纸底/注记/虚线格框）与 `cat-fire-out.png`（火苗屏掉后只留柴/灰/石圈），连同上游 JSON 一起存于 `tools/art/masters/`；**栅格化是离线发生的一次性步骤，`npm run art` 只读 PNG**（不引入 SVG 依赖） |
| 雨声素材 | `public/audio/` 里的两个 WAV（30 s 主循环 + 8 s 早播循环）是**加工后的产物，直接入库**（没有脚本管线）：源素材与完整的 `ffmpeg` 加工链写在 `public/audio/LICENSE-rain-and-thunders.txt`，换素材要重跑那条链并**同时改文件名里的版本号** |
| 类型文本 | 仓库根 `fun/<分类 id>/` 里**一条文本一个 `.txt`**，加每个分类一个 `meta.ts`（只放 `label`）：这是**作者形态，不在 `public/`**。`import.meta.glob` 的 eager + `?raw` 在构建时把正文读成字符串、并进 `index` chunk——**不发请求、没有版本号**（内容变 ⇒ chunk 哈希变），落进 `/assets/*` 吃下面那条 `immutable`；见 `50-slot-panel.md` §附 |
| 前端产物 | `npm run build` 产出到 `./dist`（在 `wrangler.jsonc` 的 `assets.directory` 中声明），交给平台托管。**分包固定为三块**（`vite.config.ts` 的 `rolldownOptions.output.codeSplitting`）：`index`（React + UI 层）、`world`（世界层，创建画布时动态导入）、`phaser`（引擎单独一块）。**引擎分块是为了缓存**：引擎 chunk 的 hash 只在升级 Phaser 时变化，业务代码改动不会让老用户重下引擎（否则两者同块，改任何一行界面代码都要重下 363 KB gzip）。构建末尾那条 `(!) Some chunks are larger than 500 kB` 是**引擎自己超线**（1374 kB），不是业务代码膨胀；**刻意不调 `chunkSizeWarningLimit`**，好让这条提示继续对业务代码生效。实测产物：`index` 308 kB / gzip 102 kB、`world` 30 kB / gzip 9 kB、`phaser` 1374 kB / gzip 357 kB |
| 设计令牌 | `docs/ui/DESIGN.md` 是唯一来源；`npm run tokens` 导出为 Tailwind v4 的 `@theme`（生成物不提交）。**样式里不写硬编码色值**，组件样式只引用令牌变量。**干净克隆后先跑一次 `npm run tokens`**：`typecheck` 与 `test` 都依赖生成物 `src/client/styles/tokens.json`，只有 `npm run build` 与 `npm run dev:web` 会自己先跑它 |
| 场景数据 | **没有场景文件**：床号 ↔ 位置、厅的区域、可走性由 `src/shared/layout.ts` 的纯函数现算（前端与厅服务共用同一份，见 `../design/20-layout.md` §4）。`public/` 只放**不需要经过构建**的文件：音频、后台页与隐私页、许可声明、`_headers` |
| 后端产物 | 由平台的构建链自动打包（含 Hono 与房间服务类），无需手工产物。CI 里是 `npm run build` + `npx wrangler deploy`，本机应急路径合成一条 `npm run deploy` |

**包体积约束**：平台单包上限 64 MiB（解压后）。Phaser + React + Hono 的量级远低于此。静态资源单文件上限 25 MiB、单版本文件数上限 20,000 个（前端资源远低于此）。

**静态资源的缓存头由 `public/_headers` 给**（Workers 静态资源会解析构建产物根目录的这个文件，Vite 会把 `public/` 原样拷进 `dist/`）。现在有两条规则，值都是 `public, max-age=31536000, immutable`：`/assets/*`、`/audio/*`。平台默认头是 `public, max-age=0, must-revalidate` + `ETag`——那只保证「不重下」：字节留在用户磁盘上，但每次使用前都要发一次条件请求（服上回 `304`，无 body）。

**判据是内容寻址，不是改动频率。** `immutable` 的合法性只来自一条契约：**同一个 URL 的内容永不改变**（等价说法：内容变 ⇒ URL 必变）。

- `/assets/*`：由 Vite 的**内容哈希**保证。注意哈希派生自**内容**，与构建号 / 构建时间 / 构建次数无关——同一份字节在任何一次构建里都是同一个文件名。所以「重新部署」不会让用户重下没变过的产物；只有内容真的变了才换名字。
- `/audio/*`：靠**人工把文件名里的版本号 +1**（`rain-loop.v1.wav` → `v2`）。换素材必须改名，否则浏览器一年内不会再来问，症状是「改了内容用户看不到、且没有报错」。为什么没搬进构建去见 `backlog.md`（搬过去的缓存收益正好为零）。类型文本走过另一条路：源在 `fun/`、编译期打包进 `index` chunk，因此吃的是 `/assets/*` 那条内容哈希，没有版本号可写。

**故意不加的三类**：`/`（`index.html`）——它是**唯一的版本指针**，必须每次校验，否则新版本永远发现不了；`/admin*`、`/privacy.html`——运维面改动要立刻生效；固定名的许可文本——没有版本标识，加了就是把「永远不改它」赌在纪律上。美术素材全进 `/assets/*` 之后，`public/sprites/` 只剩那两份许可文本，所以那个前缀也不再需要单独规则。

**收益口径**：`immutable` 省的是**往返次数与失败点**，不是字节。未变的内容本来就只回 `304`（不重下），被淘汰或内容真变了则两种头都一样要重下。它也不防缓存淘汰。

**实测**（同一构建、393×852、暖缓存回访一次进厅，从服务端日志数请求）：静态资源请求 **7 → 0**（改前是 `frames.css` / `index.css` / `index.js` / `world.js` / `phaser.js` / `atlas.json` / `atlas.png`，其中图集 PNG 是 259 KB 的**全量重取**而不是 `304`）；总请求 12 → 5（剩下的全是 `/`、`api/me`、`api/ws`、`favicon`）。首次访问的静态文件 7 → 5（`atlas.json` 内联、`frames.css` 并进入口 CSS），读者不能指望这条数字随厅变大而变——静态资源本来就与厅规模无关。

## 4. 部署

**正常发版不在这台机器上部署**：推版本 tag 即触发 CI 自动部署（§4.4）。下面这一节是**应急路径**——CI 不可用、或要立刻在本机回滚/试探时才走。

| 步骤 | 说明 |
| :--- | :--- |
| 0. 登录 | 本机需先有平台账号凭据（`wrangler login`），凭据不写仓库 |
| 1. 注入密钥 | 会话签名密钥：`npx wrangler secret put SESSION_SECRET`（随便一串 32 字节以上的随机值）。**缺了它生产环境会 500**，不写仓库。后台令牌：`npx wrangler secret put ADMIN_TOKEN`（同样 32 字节以上随机值）——**缺了它后台接口一律 401**（不是 500），`/admin` 页面能打开但登不进去。轮换签名密钥时再加一把 `SESSION_SECRET_PREV`（上一把，**只用于验签**，见 `config.md` §4） |
| 2. 部署 | `npm run deploy` 同时更新 Worker 代码与静态资源 |
| 3. 冒烟检查 | `GET /api/health` 返回 `{"code":"0"}`；打开页面可见；再走完整循环：入场 → 走动 → 躺下 → 另一个客户端确认可见 |

### 4.1 生产配置（都在 `wrangler.jsonc` 里，别在面板上改）

| 项 | 值 | 为什么 |
| :--- | :--- | :--- |
| `workers_dev` | `false` | 面板上关掉它，但 `wrangler deploy` 会按配置重新打开——**配置才是权威**，所以写进文件 |
| `preview_urls` | `false` | 同上：版本预览 URL 也走 `workers.dev`，一起关掉 |
| `routes` | 见下方「生产入口」 | 生产入口是一条**路由**（不是自定义域名）。**入库的 `wrangler.jsonc` 里那两个值是占位符**（`__ENTRY_HOST__` / `__ENTRY_ZONE__`），CI 部署前用 Environment secret 替换（§4.4）；未入库的 `wrangler.local.jsonc` 存真实值，只给本机应急部署用（`--config` 它）。要点：pattern 的 hostname 是入口域名、`zone_name` 是它所属的 zone，**必须显式写**（不写报 10082） |
| `observability` | `enabled: true` + `logs.invocation_logs: false` | 自定义事件进平台日志（契约见 `100-log.md` §3）。**invocation log 关掉**：WebSocket 每帧都是一次 invocation，开着会把 20 万/天额度打满，而我们要看的字段它一个都没有。`wrangler tail` 仍能实时看 |

**典型症状：`wrangler` 报 `fetch failed`（或「Not logged in … the Cloudflare auth server could not be reached」）**
凭据没问题，是**每次连接都被 250 ms 的尝试超时杀掉**，三层原因叠在一起：

- 本机没有全局 IPv6 路由（`ip -6 route` 只有 `fe80::/64`），AAAA 候选一律 `ENETUNREACH`；
- Node 22 默认 `autoSelectFamily = true` → 走 `connect/multiple`，**每个候选地址只给 250 ms**，超时就销毁 socket 换下一个；
- 这台机器到 Cloudflare 的 TCP 握手要 **0.9–1.6 s**（`curl -w '%{time_connect}'` 0.89–0.98 s，`net.connect` 1.3–1.6 s），于是每个候选都在握手中途被杀 → `ETIMEDOUT` → undici 只报 `TypeError: fetch failed`（真实原因在 `cause` 里，日志不打印）。

`npm run deploy` **已内置**这两个开关（`package.json` 的 `deploy` 脚本）：

```text
NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first" wrangler deploy --config wrangler.local.jsonc
```

- `--no-network-family-autoselection`：退回单地址 `net.connect`，用操作系统的 TCP 超时，不再有 250 ms 上限；
- `--dns-result-order=ipv4first`：单地址模式下先选 IPv4，缺了它就会先撞 IPv6 的 `ENETUNREACH`。

两个缺一不可：只加 `ipv4first` 仍走 250 ms 多路复用（照样全部超时）；只加 `no-network-family-autoselection` 会先试 IPv6。**绕过脚本直接调 `wrangler` 的命令**（`npx wrangler whoami` / `tail` / `secret put`）不带这两个开关，需要时自己加。`curl` 不受影响：curl 的 happy-eyeballs 只是并行起下一个，不杀正在握手的那个。

**典型症状：`/admin` 登录一直 401**
`ADMIN_TOKEN` 没注入（或与输入的不是同一个）——缺它时后台**一律** 401，不回落任何默认值。`npx wrangler secret put ADMIN_TOKEN` 之后无需重新部署，下次请求就生效。

**典型症状：忘了注入 `SESSION_SECRET`**
`/api/me` 与 `/api/ws` 返回 500 `text/plain` 的 `Internal Server Error`，浏览器控制台只说
`Unexpected token 'I', "Internal S"... is not valid JSON`。原因：会话密钥缺失时直接报错（绝不静默使用可猜的密钥）。

### 4.2 生产入口：自定义域名或路由（默认的 `workers.dev` 不能用）

部署默认给出的 `*.workers.dev` 地址在部分网络里**整个域名的 SNI 被阻断**（本机实测：同一个 Cloudflare IP，SNI 换成 `cloudflare.com` 能握手，换成 `workers.dev` 系列直接收到 TCP RST）。

这条阻断**不能用 hosts 改 IP 绕过**：SNI 是 TLS 明文段，换哪个 IP 都会被同一个中间盒 RST。

| 现象 | 判定 |
| :--- | :--- |
| `curl -s https://<worker>.workers.dev/api/health` 返回 `Recv failure: Connection reset by peer`，而 `curl -s http://<worker>.workers.dev/api/health`（同域名、明文 80）返回 `{"code":"0"}` | 部署是好的，被挡的是 `*workers.dev` 的 SNI |

**生产入口是一条路由，不是一个自定义域名**（`wrangler deploy` 的输出会打印它）：pattern 是入口域名（对外公开的只是这个地址），`zone_name` 是它所属的 zone。

**路由与 zone 不以明文入库**：入库的配置只放占位符 `__ENTRY_HOST__` / `__ENTRY_ZONE__`（CI 用 Environment secret 替换，见 §4.4）。真实值不进仓库：本机未入库的 `wrangler.local.jsonc` 里（`.gitignore` 兜住），`npm run deploy` 已改成 `wrangler deploy --config wrangler.local.jsonc`。另一处是 GitHub 的 `production` environment secret。自己部署时照抄那个文件的模板：

```jsonc
"routes": [{ "pattern": "<你的入口域名>/*", "zone_name": "<该入口域名所在的 zone>" }]
```

**注意：`zone_name` 必须显式写**：不写 wrangler 推断不出来，报 `Can't infer zone from route, please specify zone for "…" [code: 10082]`。

**踩过的三种写法（省下一次 530）**：

| 写法 | 实测结果 |
| :--- | :--- |
| `{ pattern: "<入口域名>/*" }`（不写 zone） | `Can't infer zone from route, please specify zone for "…" [code: 10082]`。**更麻烦的是这是「部分更新且不回滚」**：当场把当时那条自定义域名摘掉，那个域名随后连续 **530**；修法是改回能通过 trigger 同步的写法再 `deploy` 一次 |
| `{ …, zone_name: "<写成了另一个 zone>" }` | `Could not find zone for <写错的那个>. Make sure the domain is set up to be proxied by Cloudflare.`——那个 zone 不在本账号里（实测 `GET /zones?name=<它>` 返回空） |
| `{ pattern: "<入口域名>/*", zone_name: "<入口域名真正所属的 zone>" }` | **通过**：`Deployed <Worker 名> triggers → <入口域名>/* (zone name: <那个 zone>)` |

入口域名与它所属 zone 的**根域**都不挂 Worker。

**别把本机网络的假象当成生产故障**：实测本机到入口域名（及其 zone）会间歇性超时、Chromium 还可能报 `net::ERR_CERT_COMMON_NAME_INVALID`，而同一时刻 `curl` 能拿到 HTTP/2 200、`openssl s_client` 拿到的证书 `CN`/SAN 完全正确。排查顺序：先用 `curl -sI` 与 `openssl s_client -servername <域名>` 分开确认「证书对不对」与「响应通不通」，再怀疑应用。

**做法（两种，都是让 SNI 变成自己的域名）**：

**自定义域名**（域名所在 zone 必须在同账号下）：

```jsonc
"routes": [{ "pattern": "sleep.<你的域名>", "custom_domain": true }]
```

**路由**（本项目用的这种：zone 在本账号、pattern 的 hostname 可以是另一个名字）：

```jsonc
"routes": [{ "pattern": "<入口域名>/*", "zone_name": "<入口域名所属的 zone>" }]
```

或走面板：Workers & Pages → 该 Worker → Settings → Domains & Routes → Add。

HTTPS 也是必需项（不只是访问问题）：会话 cookie 在生产下带 `Secure`，本地 http 开发才不加。

**部署对已连接用户的影响**：平台在运行时更新时会给出宽限窗口，之后进程可能终止，已建立的连接会被关闭。对应到我们的设计：关闭即进入宽限期，睡痕逻辑照常生效，用户重连后恢复到他的床边或床上。**所以部署是安全的，不需要停服公告。**

### 4.3 发版（Release）

一次发版 = 版本号 + CHANGELOG + 提交 + 推 tag（部署与 Release 由 CI 完成），**顺序固定**：

| 步骤 | 动作 |
| :--- | :--- |
| 1 | 改 `package.json` 的 `version`；把 `CHANGELOG.md` 的 `## [Unreleased]` 内容归到 `## [vX.Y.Z] - <日期>` 之下，并留一个空的 `[Unreleased]` 段；**同时把这一版「最近更新」写进 `src/client/about.json`**（`90-about-panel.md` §4） |
| 2 | 发布前基线三条都要零失败：`npm test`、`npm run typecheck`、`npm run lint:design`（CI 会再跑一遍，见 §4.4） |
| 3 | `git commit`（版本号 + CHANGELOG + 本轮其它改动）→ `git push origin main` |
| 4 | `git tag vX.Y.Z` → `git push origin vX.Y.Z`。**推完这一步就没有手工动作了**：CI 依次跑质量门 → 部署 → `/api/health` 冒烟 → 建 GitHub Release（§4.4） |
| 5 | 全绿即完成；任一环红了的失败形态与恢复见 §4.4 |

**「改 `about.json`」为什么挂在这一步**：说明面板的自动弹出判据是正文的内容指纹（`90-about-panel.md` §3），**忘了改正文 = 装上新版的人什么都看不到，而且没有任何症状**（字没变 → 指纹不变 → 不弹）。这是本项目唯一一条没有测试兜底的发版纪律，只能靠这一步。

**顺序为什么从「部署在 tag 之前」改成「tag 触发一切」**：标签仍是公开且难撤的产物，但「有没有发布」的判据从「tag 是否存在」换成「Release 是否存在」——Release 只在部署与冒烟都通过后才建，所以部署失败时仓库里仍不会出现「标了发布但没上线」的版本。代价是 tag 会先存在（可删可重推），恢复方式是修好后**只重跑失败的 job**（`verify` 红要改代码，那一步只能删 tag 重推，见 §4.4），不一定要删 tag。

**多账号的机器先切账号**：`gh auth status` 看当前是谁，`gh auth switch` 选对推送 `origin` 与建 Release 的那个账号（`gh` 与 `wrangler` 是两套凭据，平台侧用 `npx wrangler whoami` 核对）。

### 4.4 CI 自动部署（正常发版路径）

推一个版本 tag 就是一次发版。`.github/workflows/release.yml` 里三个 job 串行，任一环失败即停：

带后缀的预发布 tag（`vX.Y.Z-ci` 这类）**只部署、不建 Release**：版本一致性只比对基版本 `X.Y.Z`（与 `package.json` 的 `version`、`CHANGELOG.md` 的 `## [vX.Y.Z]` 段对齐），`release` job 因 `if` 跳过。它的用途是验证部署链路本身。

| job | 做什么 | 失败后 |
| :--- | :--- | :--- |
| `verify` | `npm ci` → `npm run tokens`（`typecheck` 与 `test` 依赖它生成的 `src/client/styles/tokens.*`）→ `npm test` → `npm run typecheck` → `npm run lint:design` → **版本一致性**：标签去掉 `v` 必须等于 `package.json` 的 `version`，且 `CHANGELOG.md` 里存在 `## [vX.Y.Z]` 那一段 | 不部署、不建 Release |
| `deploy` | `npm ci` → `npm run build`（`assets.directory` 指向 `dist/`，而 deploy 跑在另一台 runner 上，拿不到 verify 的产物）→ 把两个占位符换成真实值 → `npx wrangler deploy` → `GET /api/health`（失败重试 3 次、间隔 10 s） | 不建 Release |
| `release` | 用 `CHANGELOG.md` 里那一段正文建 GitHub Release | — |

版本一致性放在 `verify` 而不是等 `release` 报错：那段对不上时 `release` 一定失败，排到它后面就成了「已上线但没 Release」。

**凭据全在 GitHub 的 `production` environment 里**（只有 `deploy` job 声明 `environment: production`，所以只有它读得到）。仓库级 secret 一个都不放。写入后原文读不回来，只能覆盖或删除；外部 fork 的 PR 默认拿不到。

| 名字 | 种类 | 内容 |
| :--- | :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | secret | 平台 API Token，**按单个 Worker 授权**（2026-09-15 起的 per-Worker 角色，不要用旧的账号级 `Workers Scripts:Edit`）：策略一 = `Developer Platform → Individual Workers`，scope 选本项目的 Worker，勾 `Metadata Read-only` + `Content Read-only` + `Editor`（`Admin` 多一个删除能力，不给）；策略二 = zone 级 `Workers Routes:Edit`，限入口域名所属的那一个 zone；策略三 = `Zone:Read`，限同一个 zone。**两条幂区权限不能省**：per-Worker 角色管不到路由，wrangler 在 triggers 阶段会调 `GET /zones?name=…` 与 `/zones/:zone/workers/routes`。第三条不是可选项：没有她 `zone_name` 反查直接报错——而那一步发生在**新代码上传之后**（见本节末尾的失败形态）。`Editor` 不包含「新建 Worker」，本仓库的 Worker 已存在，够用 |
| `CLOUDFLARE_ACCOUNT_ID` | secret | 账号 ID。token 属于多账号时必须显式给，否则 wrangler 报「more than one account」 |
| `ENTRY_HOST` | secret | 入口域名的 hostname（不带 `/*`） |
| `ENTRY_ZONE` | secret | 入口域名所属的 zone |

**为什么不用 `wrangler-action`**：wrangler 已锁在 `devDependencies`，`npx wrangler deploy` 用的就是 `package-lock.json` 定的那个版本，与本地逐字相同；第三方 action 自己装的 wrangler 版本不一定一致，而这类差异最难查。

**为什么 CI 不带那两个 `NODE_OPTIONS` 开关**：它们是本机网络（IPv6 无路由 + happy-eyeballs 250 ms 超时）的对策，runner 上没有这个形态。

**`wrangler.local.jsonc` 与 CI 并存**：本地 `npm run deploy` 保留为应急路径，它吃真实路由、不碰占位符。**不要在本地裸跑 `wrangler deploy`**——它会先把代码传上去，再在 triggers 阶段把占位符当路由去解析。

**没有 dry-run 通道，`--dry-run` 也不算**：它在上传前就返回，验不到 token 权限与 zone 解析，只证明配置能被接受。

**已验证（2026-10-21，预发布 tag `v0.0.7-ci`）**：`verify` 28 s、`deploy` 24 s 全绿，`release` 因 `-` 后缀跳过。`wrangler deploy` 输出 `Uploaded <Worker 名> (5.33 sec)` → `Deployed <Worker 名> triggers (1.63 sec)` → 冒烟一次通过；线上 `GET /api/health` 仍为 `{"code":"0",…}`。所以 per-Worker `Editor` 这条路实测可用。

失败形态分两段，别弄混：

| 失败发生在 | 现象 | 恢复 |
| :--- | :--- | :--- |
| 上传**之前**（token 缺 per-Worker `Editor`、`npm run build` 红） | tag 已存在、未上线、无 Release | 只重跑 `deploy` job（上传幂等） |
| 上传**之后**（triggers 阶段：`Zone:Read` 缺失、10082、路由被别的 Worker 占用） | **代码已上线、无 Release** | 先补权限，再只重跑 `deploy` job |
| `verify`（含版本一致性） | 一个都没部署 | **删 tag 重推**：`git push origin :vX.Y.Z`，修好提交后再打同名 tag 推上去；重跑同一个 job 只会同因再红 |

重跑整个工作流会连 `release` 一起重跑，而 Release 已存在时会失败——那种情况删掉 Release 再推同名的新 tag 重来。

## 5. 免费额度监控（第一版必看）

免费计划**任一维度超额会让该类操作直接失败**，因此上线后必须盯住五项：

| 维度 | 每日额度 | 观察方式 |
| :--- | :--- | :--- |
| 房间服务请求 | 100,000 / 天 | 平台用量面板 |
| 房间服务活跃时长 | 13,000 GB-s / 天 | 平台用量面板。**若接近上限，说明节拍或唤醒策略泄漏了** |
| SQLite 行读取 | 5,000,000 / 天 | 平台用量面板。**最容易被放大的一项**（唤醒时整表加载是典型泄漏） |
| SQLite 行写入 | 100,000 / 天 | 平台用量面板 |
| 外层 Worker 请求 | 100,000 / 天 | 静态资源请求不计入，实际压力很小 |
| 日志事件 | 200,000 / 天 | 平台 Observability → Events。预算与打满的先兆见 `100-log.md` §5 |

**判断泄漏的三个信号**：

1. 活跃时长随在线人数线性增长，而不是只在有人走动时增长
2. 行读取量随「唤醒次数 × 512」增长（说明在整表加载）
3. 无人在线时段仍有活跃时长消耗（说明有常驻节拍）

## 6. 升级路径

| 触发条件 | 动作 |
| :--- | :--- |
| 免费额度长期打满 | 升级到付费计划（最低 $5/月），额度提升到百万级请求/月 |
| 单厅经常接近容量上限 | 在厅注册表加新厅（手动），不是自动扩容 |
| 运营数据（人数 / 共处时长 / 拒绝分布 / 快照体积） | **不引新存储**：所有事件经单一出口写进平台日志，用 Observability 的 Query Builder 聚合，配方见 `100-log.md` §6 |
| 需要跨保留期的长期趋势（月报、次留） | 厅内 SQLite 加一张按日聚合表（`100-log.md` §8）；仍不需要 D1 |
| 需要跨部署/换机器的历史 | 才引入 D1，用**读写分离**方式：厅仍是权威，D1 只接收异步投影（见 `architecture.md`） |

