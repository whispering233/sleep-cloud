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

### Changed

### Fixed

### Removed