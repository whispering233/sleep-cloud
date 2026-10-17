# sleep-cloud

一个跑在 Cloudflare 上的线上睡眠大厅。**浏览器打开即用，不需要下载、不需要注册。**

睡不着的人可以来这里躺下、走动、看看别人，也看看那些已经睡着的人。

> **线上入口：<https://sleep-cloud.whispering233.com>**（Worker 的生产入口是一条**路由**；`workers.dev` 与 Preview URLs 已关闭。路由带的 zone 名不写进仓库，配置方式见 [`docs/design/build.md`](docs/design/build.md) §4.2。）
>
> **当前状态：v0.0.3 已发布。** 单厅 + 床位自动伸缩（已用 75% 就提前长一档）、一间一床的厅（相邻行错位 + 每间一块预留位）、**点空床即搬的换床**（10 秒冷却）、**HUD 一条通栏分三段：显示性信息（在线 / 无主空床 / 延迟）/ 可点击（床号、`GO`）/ 设置齿轮（版本号）**、**世界内 8 秒聊天气泡**（无消息列表、无历史）、**入场可选形象**、困倦度驱动的氛围明暗、走到边缘看得见墙、无缩放、无昼夜、Phaser 4 世界层。**密集屏上的字看得清了**：世界里的文字按画布 DPR 栅格化、画布按设备像素 1:1 渲染（`MAX_DPR = 3`），气泡文字升到 `label` 档（13px），床号仍是 12px。测试、类型检查、设计令牌校验均全绿。**基线冒烟现 9 条**：前 8 条已在真机通过，本轮新增的「气泡字与面板字同屏对比」（A9）待真机复验；B 组专项实测（低亮度可辨性 / 低端机帧率 / 首次加载 / 桌面拖拽等）等真实用户反馈，清单见 [`docs/design/build.md`](docs/design/build.md) §7。

## 它是什么

```text
打开网页 → 匿名入场（昵称 + 18 岁自述 + 形象）→ 看见一屏的床位和别人
        → 走到一张空床边躺下（该床从此属于我）→ 睡着 / 睡不着躺着
        → 睡不着时起身走动、看别人、聊天
        → 关掉网页 → 床上留下「睡痕」，12 小时后消失
```

- **一个大房间，一间一格**：**只有一个厅**，床位数随人来人往**自动伸缩**（117 ~ 9558，类似 `ArrayList` 扩容：不够才长，没人要了才缩）。一格 = 一条竖走道 + 一间房（一张床 + 一块留给装饰物的预留位），相邻行的床左右**错位**，所以看起来是交错排布而不是营房队列。第一次躺下即认领，30 天不出现才释放；空床很多，但「我的床位」是真实的私人物品。想换个位置？**点任意空床即搬**（旧床当场释放；10 秒冷却只是防止连着搬）。
- **没有缩放**：世界只有一个固定比例（素材 ×0.5）。找床靠**每张床上常显的床位编号** + 我的床暖色标记 + HUD 里的床号，而不是靠缩小看全厅。床号只编码「年龄」不编码方位，所以我的床不在视野里时 HUD 会给出 **8 方位箭头**，点那一条相机就跳回我的床。厅一大，走路就不够用了：HUD 上的 `GO` 可以**输入床号跳到任意床脚前**（瞬移 + 相机同时对准）。HUD 一条通栏分三段——**纯文字的显示性信息**（在线 / 还有多少床没人认领 / 延迟）、**描边胶囊的可点击项**（床号、`GO`）、最右的**设置齿轮**（点开只有一行版本号）。
- **聊天只发生在世界里**：说话的人头顶浮起一个气泡（**8 秒**后消失，同一个人后来的消息覆盖前一条、最多两行），私聊只出现在两个人头上；底部面板只留输入与动作——**没有消息列表、没有历史记录**。
- **没有昼夜**：用户白天起床之后没有场景可做，明暗换挡只会破坏「深夜陪伴」的语义。厅里只有**困倦度**（睡着 + 睡痕 占在厅人数）驱动的极轻微地板明暗，床与小人的颜色不变。
- **躺下 ≠ 在线**：关掉页面后小人不会消失，而是变成更暗的**睡痕**留在床上，12 小时后消失。否则深夜进来的人会看到一个空荡荡的大厅。
- **睡着的人不需要位置**：他的位置就是他的床。因此大厅在没人在走动时几乎是零成本、零流量。
- **美术来自开源实现**：素材取自 [`WheatCloudSleep`](https://github.com/WheatBox/WheatCloudSleep)（MIT, © 2022 WheatBox），构建期做两色渐变映射后使用，见「许可」。

## 与已有产品的区别

| | 形态 | 门槛 |
| :--- | :--- | :--- |
| VR 睡眠房间（VRChat 等） | 多人躺在一起 | 需要头显 |
| 睡眠陪伴类网页产品 | 语音/文字房间 | 没有「每个人的床位」这个概念 |
| 桌面客户端开源实现（WheatCloudSleep） | 形态完全相同 | 需要下载可执行文件，且需自建服务器 |
| **本项目** | 同一形态（并复用了它的美术） | **浏览器打开即用，服务端免运维** |

竞品与开源参考的完整调研见 [`docs/research/competitive-analysis.md`](docs/research/competitive-analysis.md)。

## 技术选型

| 层 | 选型 |
| :--- | :--- |
| 部署 | 单个 Cloudflare Worker + 静态资源托管（同源，会话 cookie 自动随 WebSocket 握手发送） |
| 后端入口 | Hono + TypeScript（自带 HMAC 签名 cookie） |
| 房间服务 | Durable Object，**整个应用只有一个实例**，自带一份私有 SQLite |
| 前端 | React + TypeScript + Vite + Tailwind（移动端优先） |
| 世界渲染 | **Phaser 4.2.1**（独立画布，`Scale.NONE`，无缩放；画布按 DPR ≤3 放大、**世界里的文字按同一个 DPR 栅格化**；地板是**三层程序化色块**（走道 / 房间地面 / 预留位），厅外那圈用**相机背景色**，所以推到边缘能看到「墙外的底 + 3px 墙带 + 地板」；床位与小人用**可视窗口 + 对象池**；聊天气泡程序化绘制；不用 Tilemap、不用物理引擎、不用位图字体） |
| 布局 | **共享纯函数**（`src/shared/layout.ts`）：床号 ↔ 位置、**床位区 / 地板区 / 取景范围**、可走性。几何程序化生成，**没有场景文件** |
| 开发助手技能 | `.agents/skills/` = Phaser 4 的 28 份技能文档（项目专用，供编码助手按需读取） |

### 平台约束塑造了设计

本项目的大部分设计决定来自平台的几条规定事实：

- **单个房间服务是单线程的**，软上限约 1,000 请求/秒 → 广播必须批量合并
- **存在未完成的定时器时对象无法休眠，且持续计费** → 高频循环只能在「正在工作」期间存在
- **内存定时器不持久**（驱逐后回调不执行）→ 「必须在未来某时刻发生」的动作必须用持久唤醒
- **云端计时不精确** → 推进量按实际经过时间计算，客户端按服务端时间戳插值
- **出站 WebSocket 消息不计费**，入站消息按 20:1 折算 → 「只发变化 + 批量合并」在计费上正好最省
- **唤醒时整表读取会放大行读取计费** → 按需读单行

免费额度下的容量推演与四条硬约束见 [`docs/design/architecture.md`](docs/design/architecture.md)。

## 文档

| 文档 | 内容 |
| :--- | :--- |
| [`docs/design/00-master-design.md`](docs/design/00-master-design.md) | 总体设计：核心循环、空间模型、状态机、时间与光照、交互、视觉、范围 |
| [`docs/design/architecture.md`](docs/design/architecture.md) | 架构：技术栈、分包、布局纯函数、数据流、平台配额、安全边界 |
| [`docs/design/10-hall-runtime.md`](docs/design/10-hall-runtime.md) | 大厅运行时：唤醒与恢复、三种时间机制、广播、宽限与睡痕、每日唤醒、级表升降级、出生点 |
| [`docs/design/20-layout.md`](docs/design/20-layout.md) | 布局：厅的空间模型、床位与格子规格、级表与厅的边界、布局契约与不变量 |
| [`docs/design/config.md`](docs/design/config.md) | 配置：时间常量、限制、密钥、内容过滤数据、前端可见配置 |
| [`docs/design/build.md`](docs/design/build.md) | 运行、构建、部署、额度监控、**真机验收清单** |
| [`docs/db/schema.md`](docs/db/schema.md) | 数据模型 |
| [`docs/api/`](docs/api/00-api-index.md) | HTTP 接口、WebSocket 协议、错误码 |
| [`docs/ui/DESIGN.md`](docs/ui/DESIGN.md) | 视觉令牌与组件规范（含构建期素材变体清单） |
| [`docs/research/competitive-analysis.md`](docs/research/competitive-analysis.md) | 竞品与开源参考 |
| [`docs/design/backlog.md`](docs/design/backlog.md) | 已决定推迟的事项 |
| [`docs/design/tasks.md`](docs/design/tasks.md) | 当前任务卡片（临时） |
| [`AGENTS.md`](AGENTS.md) | 项目规则与硬纪律（开发者/agent 先读这个） |

## 参与开发

先读 [`AGENTS.md`](AGENTS.md)（硬纪律与术语）与 [`docs/design/tasks.md`](docs/design/tasks.md)（当前任务卡片）。

本地运行（**干净克隆后先 `npm run tokens`**：`typecheck` 与 `test` 都依赖它的生成物）：

```bash
npm install
npm run tokens                 # 从 docs/ui/DESIGN.md 导出令牌（生成物不入库）
npm run build && npm run dev   # 完整站点（端口从 8787 起自动 +1，实际 URL 看终端）
npm run dev:web                # 前端热更新开发服务器（/api 代理到本 worktree 的后端端口）
npm test
npm run typecheck
npm run art                    # （可选）从 tools/art/masters/ 的母图重新生成图集
npm run deploy                 # 部署（需先有平台账号凭据；发版流程见 docs/design/build.md §4.3）
```

设计令牌的唯一来源是 `docs/ui/DESIGN.md`（`npm run tokens` 导出为 Tailwind 主题与画布用的 JSON）：

```bash
npm run lint:design   # 基线：0 error / 0 warning
```

## 许可

[MIT](LICENSE)

**美术素材**：`public/sprites/` 下的图集与贴图由 [`WheatCloudSleep`](https://github.com/WheatBox/WheatCloudSleep) 的 5 张母图（床与小人，在 `Art/Legacy/`）构建而成，同样以 **MIT** 授权（Copyright © 2022 WheatBox），许可声明随附于 `public/sprites/LICENSE-wheatcloudsleep.txt`。使用前请一并保留该声明。
