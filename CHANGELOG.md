# Changelog

本文件记录项目的所有显著变动。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

版本头可带一行主题后缀（`## [vX.Y.Z] - <日期> — <主题>`）。正文只写条目：标准节（`### Added` / `### Changed` / `### Fixed` …）加少量说明节（`### Note`、`### 过渡注意`、`### Breaking`），**不写引用块摘要段**——它只会重述条目，并夹带回归证据（测试计数 / 取证过程）这类不进本文件的内容。本文件同时是 `release.yml` 建 GitHub Release 的正文来源，升级 / 迁移提醒要写进条目或说明节。

## [Unreleased]

### Added

- 项目骨架：单个 Worker 同时托管前端静态资源（平台免费且不计请求额度）与 `/api/*` 接口
- `GET /api/health`：部署冒烟检查用的健康检查接口
- 本地开发、类型检查与部署命令（`npm run dev` / `npm run typecheck` / `npm run deploy`）
- 共享契约层：错误码表、大厅协议的上下行消息类型、配置常量、场景数据类型；单元测试比对 `docs/api/error-code.md` 与 `docs/api/20-api-ws.md`，文档与代码不会静默漂移
- 场景数据格式（`docs/design/config.md`）与协议枚举值（表情、外观、朝向）写入文档
- 前端工程：Vite + React + TypeScript + Tailwind v4，产物由同一 Worker 托管；三档响应式布局骨架（窄 / 中 / 宽）、安全区内边距、44px 触摸目标、输入框字号不低于 16px
- 设计令牌管线：`docs/ui/DESIGN.md` 为唯一来源，`npm run tokens` 导出 Tailwind 主题；组件样式只引用令牌变量，不写硬编码色值
- 内容过滤模块：敏感词表 + 干扰字符 / 空白 / 零宽字符 / 大小写归一化，提供「检测」（昵称命中即拒）与「打码」（聊天命中替换为等长 `*` 后照常放行）两个入口
- 匿名会话：`GET /api/me` 签发 HMAC 签名 cookie（HttpOnly、SameSite=Lax、每次响应刷新有效期），无注册步骤；验签失败当作新会话并返回 `1001`
- 厅注册表（亚洲 / 欧洲 / 美洲三个厅）成为唯一人工维护的配置，并有单测保证它与 `docs/design/config.md` 逐条一致
- 大厅房间服务（每厅一个实例，自带一份私有 SQLite）：床位表与三个索引按 `docs/db/schema.md` 建好，并且幂等补满 256 行床位（重启不重写）；场景数据在启动时自检（床号、坐标、床位数）
- 场景数据：三个厅各一份手写 JSON（35×35 格、256 张床、床位四周都是走道），同一份文件同时供服务端推导可行走网格与客户端渲染
- 单元测试：床位表 DDL 与 `docs/db/schema.md` 逐字段对齐；每张床都紧邻走道、可行走格连通
- 入场流程（DOM 界面 + 四个接口）：18 岁自述、昵称（命中敏感词或长度越界给可恢复提示且不写入会话）、上报本地时区、大区列表与切换；每次进厅前都出现，会话已完善时呈现为「预填 + 一键继续」

### Changed

### Fixed

### Removed