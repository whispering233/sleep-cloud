# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`60-interaction-shell.md`（本轮的总规格）、`50-slot-panel.md`、`../ui/DESIGN.md`、`../../AGENTS.md`（硬纪律 32–35）。

## 派活硬约束（每张卡都适用）

- **一条命令一步**：不要管道 / 重定向 / `&&` / 多行内联脚本（输出工具自己会截断，不要用 `tail` / `grep` 过滤）。
- 工具不可用就如实写「未能验证」并退出，**不要为了凑结论硬撑**。
- 一张卡一次 `git commit`；提交信息不带任务卡语义。
- **worker 不改 `docs/`**：设计已先落文档。卡里标注「要补 CHANGELOG」时，只补 `CHANGELOG.md` 的 `## [Unreleased]` 条目。
- 干净环境先跑一次 `npm run tokens`（typecheck 与 test 依赖生成物 `src/client/styles/tokens.*`）。
- 验收：`npm run typecheck` + `npm test` 必须全绿；改到界面壳层的卡另跑 `npm run e2e`（见 `test.md` §1 的 L2）。

---

## 卡 2：雨层画面（屏幕空间并行 Scene）

### 目标

天气 = 雨天时画布上出现细雨；无雨时 400 ms 内消失干净；雨不受世界缩放、可用视口、面板换位影响。

### 依据

`../ui/DESIGN.md` 的 `rain-layer`、`config.md` §4（粒子参数）、`00-master-design.md` §7。

### 改动

| 文件 | 要点 |
| :--- | :--- |
| `src/client/world/weather.ts` 🆕 | `WeatherScene`（`active: true`）：相机 `zoom = DPR`、运行时 `generateTexture` 生成 2×14 纹理、粒子发射器、按屏幕高算 `lifespan`、`rain` 变化时 400 ms 线性淡入淡出（走 `update`，不挂 tween / 定时器） |
| `src/client/world/world.ts` | `scene: [scene, new WeatherScene()]`——天气 Scene 在**后**（渲染在世界之上） |
| `CHANGELOG.md` | `### Added`：雨天画面 |

### 验收

- 先验第一条（不成立就停）：并行 Scene 在 `Scale.NONE` + 手动 `scale.resize` 下相机视口是否跟随画布——不跟随就会只铺左上角
- `npm run typecheck` + `npm test` 全绿（本卡预计不新增单测：Scene 里没有可独立成纯函数的东西）
- 模拟器（`ui-verifier`）：① 雨可见但不刺眼 ② 切无雨 400 ms 内无残留粒子 ③ `全厅` 与 `1×` 两档雨密度相同 ④ 打字态面板换位期间雨不动 ⑤ 同屏 60 fps
- 真机（降级可接受）：低亮度下能看出在下雨，但不至于把地板压暗

### 不做

地面涟漪 / 水花、`prefers-reduced-motion` 特化、雨随缩放变化、雨进 DOM。

---
