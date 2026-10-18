# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。

**顺序：D**（A、B、C 已落地）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。

---

## 卡 D · 表情行：切换键钉右 + emoji 去描边

依据：`../ui/DESIGN.md` 的 `emote-panel` 行。

范围：`src/client/components/ChatPanel.tsx`、`src/client/styles/app.css`、`src/client/emotes.ts`（上限注释）、`src/client/tests/emotes.test.ts`（若断言了类名则同步）。

- [ ] 展开态 `[emoji×5][…][😀]`：emoji 从左边起排，切换键用 `margin-inline-start: auto` 钉右（= 收起态发送键的位置）
- [ ] emoji 项类名 `.emote-item`：无描边、无底色，触击区仍 44×44
- [ ] 切换键类名 `.emote-toggle`：沿用描边胶囊（`.hud-action` 同规格）+ `aria-expanded`
- [ ] `EMOTE_SHORTCUTS` 加注释写死「最多 5 项」的上限理由（第 6 个就会顶到切换键）
- [ ] `npm test`、`npm run typecheck` 绿
- [ ] ui-verifier（393×852，收起 / 展开两张截图）：切换键位置一致、一眼分得清按钮与 emoji

---

下一批候选见 `backlog.md`；真机验收清单在 `build.md` §7（含本地怎么跑真 DPR 3、以及「本机 headless 无触摸面」这条环境限制）。
