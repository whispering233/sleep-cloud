# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。
> 契约与预算的唯一权威是 `100-log.md`：卡片里出现的字段名、阈值、闸门都必须与它逐字一致，不一致就改代码不改文档。

**派 subagent 一律带上这三条**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**（输出工具自己会截断，不要 `tail` / `grep` 过滤）；只做卡片里写的事，别顺手改别的；工具不可用就如实写「未能验证」并退出，不要硬凑结论。

---

## 卡 1 · 类型文本的源与交付形态：文档与缓存规则

**目的**：正文从「一个手写版本号的 JSON 包」改成「一条文本一个 `.txt`，编译期打包」。设计先落文档，代码由卡 2 收口。

改这些（**只改文档与 `_headers`，不碰 `src/`**）：

1. `50-slot-panel.md` §附：文本解析规则 1（不再有 `\n` 转义）与规则 6（校验搬到构建期）；抽签表删「数据不在内存 → `loading`」与「重试」两行；四态表收成两态（`ready` / `exhausted`）；「数据与缓存」整表重写成「数据与来源」；已知代价删「首屏要等一次网络请求」「换内容要发版」，补「正文跟主包一起下载」。
2. `config.md` §7 那一行：改成编译期打包、无版本号、字节跟着 `index` chunk。
3. `build.md` §3：产物表加一行「类型文本」；「场景数据」行里 `public/` 的清单去掉「类型文本数据包」；缓存规则三条改两条（`/assets/*`、`/audio/*`）；`/audio/*`、`/fun/*` 那条只剩 `/audio/*`。
4. `backlog.md`：39 行改写（现在是编译期打包）；54 行收窄成只剩音频，标题一并改。
5. `120-admin-console.md` §缓存行：去掉 `/fun/*`。
6. `AGENTS.md` 术语表「类型文本」、`README.md` 第 28 行：去掉静态包与版本号的说法。
7. `public/_headers`：删 `/fun/*` 段。

**验收**：`grep -rn 'public/fun\|type-texts.v1\|TEXT_PACK_VERSION\|/fun/' AGENTS.md README.md docs/ public/` 只剩本卡之后的正确说法；`npm run lint:design` 无新增问题。

## 卡 2 · 类型文本的源与交付形态：代码与测试

**目的**：落地卡 1 的口径。

1. **新建** `fun/joke/meta.ts`（`export const meta = { label: '冷笑话' }`）与 `fun/joke/j1.txt … j20.txt`——正文从 `public/fun/type-texts.v1.json` **原样搬**，**id 必须是 `j1…j20` 不许改名**（老用户的 `sc.read.seen` 靠它）。
2. **删除** `public/fun/` 整个目录。
3. `src/client/type-texts.ts`：删 `TYPE_PACK_VERSION` / `TYPE_PACK_URL` / `createTypeTextLoader` / `parseTypeTextPack` / `parseItems` / `isRecord` / `isShortString` / `schema` 概念；改成两个 **eager** `import.meta.glob`（`../../fun/*/meta.ts` 与 `../../fun/*/*.txt`，后者带 `{ query: '?raw', import: 'default' }`）在模块初始化时组装成 `TypeTextCategory[]`：分类 id = 文件夹名、`label` 取 `meta.ts`、条目 id = 文件名、**按路径排序**、正文 `trim()` 后丢掉空段。`paragraphsOf` / `poolOf` / `poolSize` / `drawNext` 一律不动。
4. `src/client/components/TypeTextPanel.tsx`：删 `pack` / `failed` / `attempt` 三个 state 与整个 async effect；删「取内容…」「内容没取到」「重试」三个分支；只留一次 `ensureReadItem`（**它有副作用，不能挪到渲染期**）。
5. `src/client/tests/type-texts.test.ts`：数据包断言改成**直接读 `fun/` 目录**（`node:fs`）——文件名 `[a-z0-9-]{1,32}`、每类非空且 ≤ `TYPE_TEXTS_PER_CATEGORY`、每条非空 / ≤ `TYPE_TEXT_MAX_LEN` / 段数 ≤ `TYPE_TEXT_MAX_PARAS`、`meta.label` 非空；删「懒加载」那两个用例（`createTypeTextLoader` 已不存在）。
6. `tsconfig.client.json`：`include` 加 `"fun"`。
7. `CHANGELOG.md`：`## [Unreleased]` → `### Changed` 补一条。

**硬约束**：一条命令一步，**不要管道 / 重定向 / `&&` / 多行内联脚本**；只做上面七件事；工具不可用就如实写「未能验证」并退出。

**验收**：`npm test`、`npm run typecheck` 全绿；`npm run build` 成功且 `dist/assets/` 里不再有 `type-texts` 文件；`grep -rn 'type-texts.v1\|TYPE_PACK' src/` 无输出。

---

## 暂不做

- **游戏代码搬 `public/`**：游戏 chunk 已在 `/assets/` 下、缓存策略相同；途中的另一个动机（加游戏不用碰 TS）已由「文件夹即注册」解决。今天没有需求方。
- `/audio/*` 搬进构建：已 immutable，搬过去缓存收益为零，只换来「删掉人工 `vN` 纪律」——理由与触发条件见 `backlog.md`。类型文本已走另一条路（编译期打包，见上两张卡）。
