# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`00-master-design.md`、`architecture.md`、`10-hall-runtime.md`、`20-layout.md`、`config.md`、`build.md`、`../db/schema.md`、`../api/`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律）。
> 下一批候选见 `backlog.md`。

- [ ] 卡 4：引用与镜像测试跟到 `20-layout.md`（**纯重指，零行为改动**）
  - **背景**：布局三块（级表、几何常量、布局契约）已从 `config.md` 搬进新文档 `20-layout.md`，`config.md` 重新编号为：§1 只有一个厅、§2 时间常量、§3 限制、§4 密钥、§5 内容过滤数据、§6 前端可见配置、§7 环境差异。文档侧已全部重指完毕（零残留）。**现在 `npm test` 有两个文件红，就是本卡要收的口**（预期状态，见 `AGENTS.md` 项目开发流程）：
    - `src/shared/tests/constants.test.ts` → `Error: 文档里找不到段落：## 4. 几何常量`
    - `src/shared/tests/layout.test.ts` → `Error: 文档里找不到段落：## 2. 级表`
  - **改（镜像测试）**：
    1. `src/shared/tests/constants.test.ts`：`docGeometry` 改读 `design/20-layout.md`，段落起止 `'## 2. 床位与格子规格'` → `'## 3. 级表与厅的边界'`；错误文案与注释里的路径同步。
    2. 新增 `docLimit(name)`（读 `config.md` §3 限制表：段落起止 `'## 3. 限制'` → `'## 4. 密钥'`），用它断言 `MAX_DPR`（原先是几何表里的 `docConstant('MAX_DPR')`，而 `MAX_DPR` 已移到 `config.md` §3）。其余限制断言维持字面量不动（不在本卡范围）。
    3. `src/shared/tests/layout.test.ts`：`docLevels` 改读 `design/20-layout.md` 段落 `'## 3. 级表与厅的边界'` → `'### 3.2 厅的边界'`；测试名与注释里的 `config.md §2` 改成新路径。**`readDoc('design/config.md')).toContain(LAYOUT_VERSION)` 那条不动**（布局版本号仍写在 `config.md` §1）。
  - **改（源码注释，共 22 处，按下面的对应关系重指）**：旧 §7（契约 / 街网 / 可走性）→ `docs/design/20-layout.md` §4；旧 §2 表内的取景范围 / 墙与边界 → `20-layout.md` §3.2；旧 §2 的级表 / 容量 → `20-layout.md` §3.1；旧 §4 几何常量 → `20-layout.md` §2；旧 §3 时间常量 → `docs/design/config.md` §2；旧 §8 内容过滤数据 → `config.md` §5；旧 §9 前端可见配置 → `config.md` §6；旧 §1 单厅 / 布局版本 → `config.md` §1（不变）。
    涉及文件：`src/hall/hall.ts:70`、`src/hall/connection.ts:13,136`、`src/hall/pathfinding.ts:19`、`src/hall/daily.ts:5`、`src/hall/tests/level-rules.test.ts:9`、`bed-rules.test.ts:7`、`bed-store.test.ts:28`、`src/client/world/rules.ts:160`、`src/client/components/EntryOverlay.tsx:21`、`src/shared/http-api.ts:25`、`src/shared/constants.ts:2,5,10`、`src/shared/blocked-words.ts:2`（**注意：该处现在写的 §6 是错的，它讲的是内容过滤数据 → 应为 `config.md` §5**）、`src/shared/layout.ts:2,16,48,94,203`、`src/shared/tests/layout.test.ts:513`。
  - **不做**：不改任何常量值、不改几何、不改协议、不改运行时行为；不顺手删/改其它注释。
  - **独立验收（≤5 条）**：① `npm test` 29/29 全绿（两个 FAIL 消失）、`npm run typecheck` 通过；② `grep -rn "config\.md" src/` 结果里指向 config.md 的只剩 §1 / §2 / §3 / §4 / §5 / §6（新编号），**没有 §7 及更大的章节号**；③ `grep -rn "20-layout.md" src/` 至少覆盖上表所有文件；④ `layout.test.ts` 的逐档一致断言仍然从文档读到 15 档（证明读对了段落、不是空表）；⑤ `git diff` 里除注释、文档路径与两处镜像测试外**没有任何逻辑改动**（用 `git diff -U0 | grep -v '^[-+]\s*\*' ` 之类的粗筛 + 人工过一眼）。