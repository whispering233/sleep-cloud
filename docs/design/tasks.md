# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片，一张卡必须能独立提交、独立验证、独立回滚；**完成后从本文件删除**（它不是历史记录）。
> 派活的硬约束、验收基线（`npm test` / `npm run typecheck` / `npm run lint:design`）与「一次只做一张卡」见 `../../AGENTS.md`「开发流程（本项目）」，发版顺序见 `build.md` §4.3。

## 卡 1：内容过滤词库（生成管线 + 两条路径分级）

### 为什么

今天词表 33 条、昵称与聊天共用一套。要把词库扩到约 24.1k（MIT 自有 15 类目），并让**昵称走窄词集**——昵称命中即无法入场，误伤代价是用户进不来。

### 产物

1. `tools/words/curated.txt`：把现有 `src/shared/blocked-words.ts` 的 33 条原样搬过来，一行一词，**人工维护**。
2. `tools/words/LICENSE-sensitive-lexicon.txt`：`konsheng/Sensitive-lexicon` 的 MIT 原文。
3. `tools/words/build-words.mjs`：从 `raw.githubusercontent.com/konsheng/Sensitive-lexicon/<SHA>/Vocabulary/<file>` 拉 **15 个类目文件**（SHA 与文件名列表都写成脚本常量），去空白行、按类目去重、合并 `curated.txt`，写 `src/shared/blocked-words.json`。只拉这 15 个文件，天然排除 `零时-Tencent.txt` 与 `网易前端过滤敏感词库.txt`（理由见 `config.md` §6）。
4. `src/shared/blocked-words.json`（**产物入库**）：`{ meta: { source, license, commit, generator, excluded }, categories: { 色情, 色情词库, 政治, 暴恐, 涉枪涉爆, 反动, 贪腐, 新思想启蒙, 非法网址, GFW, 民生, 补充, 其他, COVID, 广告 }, curated: [...] }`。
5. 删 `src/shared/blocked-words.ts`；`src/shared/content-filter.ts` 从 JSON 建两个词集：
   - **聊天 / 私聊** = 全部类目 + `curated`
   - **昵称** = 九类（色情、色情词库、政治、暴恐、涉枪涉爆、反动、贪腐、新思想启蒙、非法网址）+ `curated`，再减 `NICKNAME_FORGIVE` 10 条：`疫情 肺炎 中央 政府 武汉 总理 北京 兼职 招聘 网络`
   - `detect()` / `mask()` 签名与调用点不变。
6. 归一化补**全角转半角**（`0xFF01`–`0xFF5E` 减 `0xFEE0`，另 `　`→空格），放在剥除插入字符之后、小写之前。
7. `package.json` scripts 加 `"words": "node tools/words/build-words.mjs"`；`CHANGELOG.md` Unreleased 记一条（词库来源、许可、规模）。

### 验收

- `npm run words` 连跑两次 → `git diff --exit-code src/shared/blocked-words.json`（幂等）。
- JSON 总条数 ≥ 24,000、`curated` 恰 33 条、昵称词集 ⊂ 聊天词集。
- `src/shared/tests/content-filter.test.ts` 新增：昵称命中色情类词 → `detect` 非 null；`兼职`/`招聘`/`疫情`/`网络` → `detect` 为 null；`傻逼` 仍命中（curated）；`ＦＵＣＫ` 命中；`mask(x).length === x.length`。
- 原有测试全绿；`npm run typecheck` 绿。

### 不做

联系方式/引流正则、拼音词条（卡 2）、热更新、命中词落库审计。网络不可用就如实写「未能生成」，**不要手写 24k 词**。

## 卡 2：联系方式 / 引流打码 + 拼音词条

### 为什么

词库再大也只覆盖「骂人」，管不住「留个微信号」「扫码进群」这类把人从厅里带走的行为。

### 产物

1. `src/shared/content-filter.ts` 加 `CONTACT_PATTERNS`，命中一律走 `mask`（**打码，不拒绝**）：
   - 手机号：`1[3-9]` 开头的 11 位，允许**数字之间**有空格 / `-` / `_` / `.`；只剥数字之间的分隔符，其它字符是硬边界（防止 `床号 12345 明天 67890` 拼成假手机号）。
   - 邮箱：`[\w.+-]+@[\w-]+\.[\w.]+`。
   - URL / 域名：`https?://`、`www.`、以及（名）`.<常见 TLD>`。
   - 平台引流：`QQ` / `微信` / `vx` / `v信` / `企鹅` 后面跟 4 位以上数字或字母 → 整段打码。
2. `tools/words/curated.txt` 追加拼音全拼与高置信缩写（如 `shabi`、`caonima`、`fuckyou`）；**不加** `sb`/`nb`/`2b` 这类两字母缩写（误伤），不加数字谐音（`88` = 「拜拜」）。
3. 单测覆盖每类正则的正例与反例。

### 验收

- `mask('我的电话 138-1234-5678')` 的 11 位数字全成 `*`，长度不变。
- `mask('床号 12345 明天 67890')` 不变。
- `mask('3.14 和 2.71')` 不变。
- `mask('加 vx: abc1234')` 整段成星号。
- 原有测试全绿；`npm run typecheck` 绿。

### 不做

形近字 / 繁简归一（理由见 `backlog.md`）、换匹配引擎。
