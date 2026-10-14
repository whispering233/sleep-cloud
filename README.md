# sleep-cloud

一个跑在 Cloudflare 上的线上睡眠大厅。**浏览器打开即用，不需要下载、不需要注册。**

睡不着的人可以来这里躺下、走动、看看别人，也看看那些已经睡着的人。

> **当前状态：开发中。** 骨架已经可跑（`npm run dev`），大厅业务功能尚未实现。开发任务见 [`docs/design/tasks.md`](docs/design/tasks.md)。

## 它是什么

```
打开网页 → 匿名入场 → 看见厅里的床位和别人
        → 走到一张空床边躺下（该床从此属于我）→ 睡着 / 睡不着躺着
        → 睡不着时起身走动、看别人、聊天
        → 关掉网页 → 床上留下「睡痕」，第二天早上消失
```

- **宿舍式大厅**：一张大房间里排满床位，彼此可见。不是「私人房间 + 公共大厅」——单间模式下进来一个人也看不见，而「看见别人」正是这个产品要提供的东西。
- **一张床属于一个人**：第一次躺下即认领，30 天不出现才释放。空床很多，但「我的床位」是真实的私人物品。
- **躺下 ≠ 在线**：关掉页面后小人不会消失，而是变成更暗的**睡痕**留在床上，次日清晨消失。否则深夜进来的人会看到一个空荡荡的大厅。
- **睡着的人不需要位置**：他的位置就是他的床。因此大厅在没人在走动时几乎是零成本、零流量。

## 与已有产品的区别

| | 形态 | 门槛 |
| :--- | :--- | :--- |
| VR 睡眠房间（VRChat 等） | 多人躺在一起 | 需要头显 |
| 睡眠陪伴类网页产品 | 语音/文字房间 | 没有「每个人的床位」这个概念 |
| 桌面客户端开源实现（如 WheatCloudSleep） | 形态完全相同 | 需要下载可执行文件，且需自建服务器 |
| **本项目** | 同一形态 | **浏览器打开即用，服务端免运维** |

竞品与开源参考的完整调研见 [`docs/research/competitive-analysis.md`](docs/research/competitive-analysis.md)。

## 技术选型

| 层 | 选型 |
| :--- | :--- |
| 部署 | 单个 Cloudflare Worker + 静态资源托管（同源，会话 cookie 自动随 WebSocket 握手发送） |
| 后端入口 | Hono + TypeScript（自带 HMAC 签名 cookie） |
| 房间服务 | Durable Object，一个厅一个实例，自带一份私有 SQLite |
| 前端 | React + TypeScript + Vite + Tailwind（移动端优先） |
| 世界渲染 | PixiJS（独立画布，不参与前端框架的渲染循环） |

### 平台约束塑造了设计

本项目的大部分设计决定来自平台的几条规定事实：

- **单个房间服务是单线程的**，软上限约 1,000 请求/秒 → 广播必须批量合并
- **存在未完成的定时器时对象无法休眠，且持续计费** → 高频循环只能在「正在工作」期间存在
- **内存定时器不持久**（驱逐后回调不执行）→ 「必须在未来某时刻发生」的动作必须用持久唤醒
- **出站 WebSocket 消息不计费**，入站消息按 20:1 折算 → 「只发变化 + 批量合并」在计费上正好最省
- **唤醒时整表读取会放大行读取计费** → 按需读单行

免费额度下的容量推演与四条硬约束见 [`docs/design/architecture.md`](docs/design/architecture.md)。

## 文档

| 文档 | 内容 |
| :--- | :--- |
| [`docs/design/00-master-design.md`](docs/design/00-master-design.md) | 总体设计：核心循环、空间模型、状态机、在场与时间、交互、视觉、范围 |
| [`docs/design/architecture.md`](docs/design/architecture.md) | 架构：技术栈、分包、数据流、平台配额、安全边界 |
| [`docs/design/10-hall-runtime.md`](docs/design/10-hall-runtime.md) | 大厅运行时：唤醒与恢复、节拍、广播、定时机制、清理 |
| [`docs/design/config.md`](docs/design/config.md) | 配置：厅注册表、时间常量、限制 |
| [`docs/design/build.md`](docs/design/build.md) | 运行、构建、部署、额度监控 |
| [`docs/db/schema.md`](docs/db/schema.md) | 数据模型 |
| [`docs/api/`](docs/api/00-api-index.md) | HTTP 接口、WebSocket 协议、错误码 |
| [`docs/ui/DESIGN.md`](docs/ui/DESIGN.md) | 视觉令牌与组件规范 |
| [`docs/research/competitive-analysis.md`](docs/research/competitive-analysis.md) | 竞品与开源参考 |
| [`docs/design/backlog.md`](docs/design/backlog.md) | 已决定推迟的事项 |
| [`docs/design/tasks.md`](docs/design/tasks.md) | 当前任务卡片（临时） |
| [`AGENTS.md`](AGENTS.md) | 项目规则与硬纪律（开发者/agent 先读这个） |

## 参与开发

先读 [`AGENTS.md`](AGENTS.md)（硬纪律与术语）与 [`docs/design/tasks.md`](docs/design/tasks.md)（当前任务卡片）。

视觉令牌现在就可以校验：

```bash
npx @google/design.md lint docs/ui/DESIGN.md
npx @google/design.md export docs/ui/DESIGN.md --format css-tailwind
```

本地运行与部署：

```bash
npm install
npm run dev        # 本地起 Worker + 静态资源 + 房间服务（http://localhost:8787）
npm run typecheck
npm run deploy     # 部署（需先有平台账号凭据）
```

## 许可

[MIT](LICENSE)
