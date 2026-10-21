# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

### 本批次目标

插槽面板的第二个内容「类型文本」（`docs/design/50-slot-panel.md` §附）。设计文档已改完（`50-slot-panel.md`、`60-interaction-shell.md`、`40-client-storage.md`、`config.md`、`ui/DESIGN.md`、`backlog.md`），数据包 `public/fun/type-texts.v1.json` 与 `public/_headers` 的 `/fun/*` 规则已落地。**代码未跟上期间 `prefs.test.ts` 的镜像测试会红**（文档已登记 `sc.read.seen`），由卡 2 收口。

---

## 卡 1：类型文本纯函数 + 数据自检

### 范围

- 新建 `src/client/type-texts.ts`：`TYPE_PACK_VERSION`、`TYPE_PACK_URL = '/fun/type-texts.v' + TYPE_PACK_VERSION + '.json'`；`TypeTextItem` / `TypeTextCategory` 类型；`parseTypeTextPack(raw: unknown)`（校验 `schema === 1`、`categories` 非空；每类 `id` / `label` 非空且 ≤32 字符、`items` 数组；条目 `id` 非空 ≤32 且类内唯一、`text` trim 后非空、长度 ≤ `TYPE_TEXT_MAX_LEN`、段数 ≤ `TYPE_TEXT_MAX_PARAS`；**坏条目丢那一条**、坏分类丢那一类、整包形状坏返回 `[]`）；`paragraphsOf(text)`（`\n\n` 分段、段内单个 `\n` 保留、每段 trim、空段丢弃）；`drawNext({ items, seen, current, rand })`（池 = `items` 中 id 不在 `seen` 的；`current` 在池里且池长 > 1 时排除它；池空返回 `null`）；`loadTypeTextPack()`（`fetch(TYPE_PACK_URL)` + 模块级 promise 去重，**成功才缓存、失败不缓存**，`res.ok` 为假或 `json()` 抛都算失败）。
- 长度上限从 `src/shared/config.ts`（或项目既有的常量落点）取，**不在这两个模块里另写一份数字**：`TYPE_TEXT_MAX_LEN = 200`、`TYPE_TEXT_MAX_PARAS = 8`、`TYPE_TEXTS_PER_CATEGORY = 120`（`docs/design/config.md` §3）。
- 新建 `src/client/tests/type-texts.test.ts`：① 读 `public/fun/type-texts.v1.json` 自检——解析后**一条都没被丢**、条数 1..`TYPE_TEXTS_PER_CATEGORY`、id 唯一、`label` 非空；② 抽签不重复（连续抽到 `null` 为止，抽出的 id 集合 = items 集合）；③ `current` 排除规则（池长 ≥2 时不会抽回当前条；池长 1 时能抽回）；④ 1 条数据首次抽完后即池空；⑤ 坏条目（empty text / 超长 / 9 段 / id 重复）被丢而其余留下；⑥ `paragraphsOf`：两段、段内硬换行、空段丢弃、全空白返回 `[]`。

### 验收

`npm test`（只允许 `prefs.test.ts` 镜像测试红，理由见上）、`npm run typecheck`。不碰 UI、不碰 store。

---

## 卡 2：本地键 `sc.read.seen`

### 范围

- `src/client/prefs.ts`：注册 `sc.read.seen`，值形状 `{ v: 1, seen: Record<string, string[]>, current: Record<string, string> }`；白名单只收形状（分类 id 非空 ≤32、条目 id ≤32、每类 ≤ `TYPE_TEXTS_PER_CATEGORY`、非字符串/非对象一律判废回默认）；按既有键的写法导出读取/写入函数（`localStorage` 仍然只出现在这个模块）。
- `src/client/tests/prefs.test.ts`：补该键的正反用例（缺键回默认、超长分类 id 判废、非映射判废、多出来的字段不影响读取）。**镜像测试自动跟着文档走**，确认它转绿。

### 验收

`npm test` 全绿、`npm run typecheck`。不碰 UI。

---

## 卡 3：`reading` 会话 + 「!」入口 + 面板内容

### 范围

- `src/client/composer.ts`：`ComposerState` 加 `'reading'`；新增进入事件（如 `'read'`）；`focus-in` 在 `reading` 下降到 `typing`；其余事件（`exit` / `lost-focus` / `offline`）照旧直落 `idle`。`src/client/tests/composer.test.ts` 补转移。
- `src/client/store.ts`：加阅读状态——当前条（按分类的 map，形状与本地键一致，一期只有 `joke`）与 `setComposer('reading')` 的入口；**退出到 `idle` 时不清当前条**（`50-slot-panel.md` §附「抽签」）。
- `src/client/components/ActionRow.tsx`：空闲态的齿轮**左侧**加 44×44 描边胶囊「!」（可见文字 `!`、`aria-label="随机阅读"`、`key="read"`、`onPointerDown` 里 `preventDefault()`，组内间距 8px），点击 = 进 `reading`；非空闲态不出现（那一格是「收起」）。
- 新建 `src/client/components/TypeTextPanel.tsx`：四态（`loading` / `ready` / `exhausted` / `error`）版面、正文用 `paragraphsOf` 渲染每段一个 `<p>`、按钮钉右下角（随机 = 描边胶囊 + 内联循环箭头 SVG、`aria-label="随机一条"`；抽干后换成「再看一遍」；取数据失败给「重试」）；打开面板时**有当前条就原样显示、没有才抽一条**；分类名只作面板内容的 `aria-label`。按钮同样 `onPointerDown` preventDefault。
- `src/client/components/ChatPanel.tsx`：插槽内容从三选一改四选一（`report` / `reading` / 其余 = 快捷用语）。
- `src/client/styles/app.css`：正文与按钮行样式（`var()` 用生成后的 token；`text-indent: 2em`、`white-space: pre-line`、正文自己滚、按钮行不参与滚动）。**样式不写在行内 style，也不塞进单行 className。**
- 单测：抽签交互的状态推导（首次打开抽、有当前条不抽、退出保留、再看一遍后换一条）——把它写成纯函数再测，别测 DOM。

### 验收

`npm test`、`npm run typecheck`、`npm run lint:design`；`npm run build` 通过。不写 e2e。

---

## 卡 4：端到端 + 模拟器验证（派 `ui-verifier`）

### 检查条目（上限 12 条，分两次跑，避免超时）
1. 空闲态动作行：齿轮左侧有「!」，44×44，点它面板当场打开（不依赖网络回来）。
2. 面板显示一条冷笑话，正文两段时首行缩进、段间有空行。
3. 点「随机」换一条，且不重复出现已抽过的。
4. 退出（「收起」/ 点面板空白）后重新打开 `!`：**还是刚才那条**。
5. 点「再看一遍」后：回到可抽状态且不是刚才那条。
6. 把数据包请求模拟失败（DevTools 断网）→ 出现「重试」；恢复后点重试能取到内容。
7. 打字态点「!」不出现（那一格是「收起」）；从 `reading` 点输入框 → 变打字态、快捷用语回来。
8. 刷新页面后打开 `!`：仍是原来那条（`sc.read.seen` 的 `current` 生效），且不会抽到已读过的。
9. 393×852 下动作行不换行、不溢出；360 与 320 各测一次，记录是否溢出。
10. 控制台无报错、`/fun/type-texts.v1.json` 命中 immutable 缓存（第二次从内存/磁盘缓存取）。
11. 明暗三档下正文与小按钮仍可读（对比度观感）。
12. 触摸：所有按钮不需要 hover、点击有反馈。

### 环境

响应式与触摸默认走宿主 Android 模拟器；起不来说明改用桌面手机视口并在结论里写明。

---

### 硬约束（派活时原文带上）

一条命令一步，**不要**管道、重定向、`&&`、多行内联脚本；工具不可用就如实写「未能验证」并退出，不要为了凑结论硬撑。
