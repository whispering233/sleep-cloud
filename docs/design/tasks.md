# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- 文档已先改好（`docs/` 是规格来源）：**worker 不改 `docs/`**，只在卡里注明「已落地」时补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。

---

## 卡 1：缩放档位持久化（本地存储的第一处消费者）

**规格来源**（已先改好，worker 不改 `docs/`）：`40-client-storage.md`（§2 键协议 + §3 键登记表）、`config.md` §3 的 `ZOOM_TIERS` 行与 §6、`../ui/DESIGN.md` 的「世界相机」缩放行。`backlog.md` 的「记住缩放档位」已随之删除。

**要实现的行为**：用户从缩放档位胶囊里**显式选**一档（`全厅` / `0.5×` / `0.75×` / `1×`）→ 整页重载后档位还在（世界确实在那个比例）。`自由缩放` 与该模式下的连续比例**不持久化**（重载回 `1×`）。

**改动范围**

- 新增 `src/client/prefs.ts`：`PREFS` 注册表（键名 `sc.zoom.mode`）+ `readPref` / `writePref`（`try`/`catch` 边界；storage 可注入以便单测；**没有 `localStorage` 的环境一律读默认、写丢弃**）
- `src/client/store.ts`：`zoomMode` 初值 = 持久值 ?? `{kind:'free'}`
- `src/client/world/world.ts`：`alignCamera` 里的 `if (!reconnected) this.setZoom(1)` → 按 `getState().zoomMode` 取（`fixed` 用 `mode.z`，否则 `1`），并同步那行注释；**重连分支不动**
- 用户改档位的路径写键（含切回 `自由缩放` —— 写入路径只一条）
- `src/client/zoom.ts` 顶部注释（「会话内、不持久化」→ 新语义）
- 新增 `src/client/tests/prefs.test.ts`（假 storage，5 条）：无键 → 默认 / 坏 JSON → 默认**且删键** / `v` 不符 → 默认**且删键** / 非法 `mode` → 默认**且删键** / 写抛错 → 静默且内存值仍生效
- `CHANGELOG.md` 的 `## [Unreleased]` 加一条（用户可见行为变化；**不写任务卡语义**）

**不许动**：`docs/`（已先改好）、协议与下行字段、服务端任何文件、`ZOOM_TIERS` 的数值、`store.zoomMode` 的类型。

**验证**

- worker 自测：`npm run typecheck`、`npm test`
- 独立验证（`ui-verifier`，**手机视口**，清单 ≤4 项）：①选 `0.75×` → 刷新 → 胶囊仍显示 `0.75×` 且世界比例确实是 `0.75×` ②选「自由缩放」→ 刷新 → 显示 `自由缩放` ③手写非法值 `{"v":1,"mode":"9x"}` → 刷新 → 回 `自由缩放`、不报错、不崩 ④在「自由缩放」下捏合到约 `0.5×` → 刷新 → 回 `1×`（连续比例不持久化）

真机验收清单在 `build.md` §7，两项待验：**走到床边 → 躺下的站立等待 ≈ RTT**（`30-movement-sync.md` §3.9）、**`?debug=1` 下走一趟 `regressPx max` 必须为 0**（§6.2）。
