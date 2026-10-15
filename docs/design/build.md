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
| 起完整站点（后端 + 房间服务 + SQLite + 静态资源） | `npm run build && npm run dev`（http://localhost:8787） |
| 前端热更新开发服务器（`/api` 代理到 8787，含 WebSocket） | `npm run dev:web`（http://localhost:5173） |
| 单元测试 | `npm test` |
| 类型检查 | `npm run typecheck` |
| 设计令牌校验 / 生成 | `npm run lint:design` / `npm run tokens` |
| 部署 | `npm run deploy` |

| 目的 | 做法 |
| :--- | :--- |
| 起后端 + 房间服务 + SQLite | 平台的本地运行命令（`wrangler dev`）。本地即可获得完整的对象、SQLite 与 WebSocket 能力 |
| 起前端 | 前端开发服务器（`vite`），把 API 与 WebSocket 请求代理到本地运行的后端 |
| 双浏览器验证多人 | 同一台机器开两个浏览器配置文件（cookie 隔离），或一个正常窗口 + 一个隐私窗口 |
| 制造边界场景 | 本地把厅容量调小（见 `config.md` §7），便于触发「厅满」「床位被占」 |

**验证要点（人工）**：两个浏览器里的小人能否互相看见、走动是否平滑、躺下后另一侧是否立即看到、断网 60 秒后是否变成睡痕、重连是否回到原状态。

## 3. 构建

| 产物 | 说明 |
| :--- | :--- |
| 美术素材 | `npm run art` 从 `tools/art/masters/` 的 5 张母图重新生成 `public/sprites/`（图集 + 许可）。**产物入库，不挂进 `npm run build`**（构建保持快且确定）；改素材或改映射规则后要重跑 |
| 前端产物 | `npm run build` 产出到 `./dist`（在 `wrangler.jsonc` 的 `assets.directory` 中声明），交给平台托管 |
| 设计令牌 | `docs/ui/DESIGN.md` 是唯一来源；`npm run tokens` 导出为 Tailwind v4 的 `@theme`（生成物不提交）。**样式里不写硬编码色值**，组件样式只引用令牌变量 |
| 场景数据 | **没有场景文件**：床号 ↔ 位置、厅的区域、可走性由 `src/shared/layout.ts` 的纯函数现算（前端与厅服务共用同一份，见 `../design/config.md` §7）。`public/` 只放素材 |
| 后端产物 | 由平台的构建链自动打包（含 Hono 与房间服务类），无需手工产物。`npm run deploy` 即是构建 + 上传 |

**包体积约束**：平台单包上限 64 MiB（解压后）。Phaser + React + Hono 的量级远低于此。静态资源单文件上限 25 MiB、单版本文件数上限 20,000 个（前端资源远低于此）。

## 4. 部署

| 步骤 | 说明 |
| :--- | :--- |
| 0. 登录 | 本机需先有平台账号凭据（`wrangler login`），凭据不写仓库 |
| 1. 注入密钥 | 会话签名密钥：`npx wrangler secret put SESSION_SECRET`（随便一串 32 字节以上的随机值）。**缺了它生产环境会 500**，不写仓库 |
| 2. 部署 | `npm run deploy` 同时更新 Worker 代码与静态资源 |
| 3. 冒烟检查 | `GET /api/health` 返回 `{"code":"0"}`；打开页面可见；再走完整循环：入场 → 走动 → 躺下 → 另一个客户端确认可见 |

### 4.1 生产配置（都在 `wrangler.jsonc` 里，别在面板上改）

| 项 | 值 | 为什么 |
| :--- | :--- | :--- |
| `workers_dev` | `false` | 面板上关掉它，但 `wrangler deploy` 会按配置重新打开——**配置才是权威**，所以写进文件 |
| `preview_urls` | `false` | 同上：版本预览 URL 也走 `workers.dev`，一起关掉 |
| `routes` | `[{ pattern: "sleep-cloud.<zone>", custom_domain: true }]` | 生产入口只有这一个域名（理由见 §4.2） |
| `observability` | `enabled: true` | 打开平台日志，生产出问题就靠它（`wrangler tail` 也能看） |

**典型症状：忘了注入 `SESSION_SECRET`**
`/api/me` 与 `/api/ws` 返回 500 `text/plain` 的 `Internal Server Error`，浏览器控制台只说
`Unexpected token 'I', "Internal S"... is not valid JSON`。原因：会话密钥缺失时直接报错（绝不静默使用可猜的密钥）。

### 4.2 生产入口必须是自定义域名

部署默认给出的 `*.workers.dev` 地址在部分网络里**整个域名的 SNI 被阻断**（本机实测：同一个 Cloudflare IP，SNI 换成 `cloudflare.com` 能握手，换成 `workers.dev` 系列直接收到 TCP RST）。

这条阻断**不能用 hosts 改 IP 绕过**：SNI 是 TLS 明文段，换哪个 IP 都会被同一个中间盒 RST。

| 现象 | 判定 |
| :--- | :--- |
| `curl -s https://<worker>.workers.dev/api/health` 返回 `Recv failure: Connection reset by peer`，而 `curl -s http://<worker>.workers.dev/api/health`（同域名、明文 80）返回 `{"code":"0"}` | 部署是好的，被挡的是 `*workers.dev` 的 SNI |

**本项目的生产入口**：`sleep-cloud.<zone>`（自定义域名，已实测 HTTPS 正常：HTTP/2 200 + `server: cloudflare`，证书 SAN 含该名字）。根域 `<zone>` 不使用，也不挂 Worker。

**做法**：给 Worker 加一个自己域名的**自定义域名**（域名需在同账号下），SNI 就变成自己的域名：

```jsonc
"routes": [{ "pattern": "sleep.<你的域名>", "custom_domain": true }]
```

或走面板：Workers & Pages → 该 Worker → Settings → Domains & Routes → Add → Custom Domain。

HTTPS 也是必需项（不只是访问问题）：会话 cookie 在生产下带 `Secure`，本地 http 开发才不加。

**部署对已连接用户的影响**：平台在运行时更新时会给出宽限窗口，之后进程可能终止，已建立的连接会被关闭。对应到我们的设计：关闭即进入宽限期，睡痕逻辑照常生效，用户重连后恢复到他的床边或床上。**所以部署是安全的，不需要停服公告。**

## 5. 免费额度监控（第一版必看）

免费计划**任一维度超额会让该类操作直接失败**，因此上线后必须盯住四项：

| 维度 | 每日额度 | 观察方式 |
| :--- | :--- | :--- |
| 房间服务请求 | 100,000 / 天 | 平台用量面板 |
| 房间服务活跃时长 | 13,000 GB-s / 天 | 平台用量面板。**若接近上限，说明节拍或唤醒策略泄漏了** |
| SQLite 行读取 | 5,000,000 / 天 | 平台用量面板。**最容易被放大的一项**（唤醒时整表加载是典型泄漏） |
| SQLite 行写入 | 100,000 / 天 | 平台用量面板 |
| 外层 Worker 请求 | 100,000 / 天 | 静态资源请求不计入，实际压力很小 |

**判断泄漏的三个信号**：

1. 活跃时长随在线人数线性增长，而不是只在有人走动时增长
2. 行读取量随「唤醒次数 × 512」增长（说明在整表加载）
3. 无人在线时段仍有活跃时长消耗（说明有常驻节拍）

## 6. 升级路径

| 触发条件 | 动作 |
| :--- | :--- |
| 免费额度长期打满 | 升级到付费计划（最低 $5/月），额度提升到百万级请求/月 |
| 单厅经常接近容量上限 | 在厅注册表加新厅（手动），不是自动扩容 |
| 需要跨厅统计/看板 | 引入 D1，用**读写分离**方式：厅仍是权威，D1 只接收异步投影（见 `architecture.md`） |
