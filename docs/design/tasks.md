# 开发任务卡片清单（临时）

> 规则：按端到端垂直切片；一张卡必须能独立提交、独立验证、独立回滚。**完成后从本文件删除**（它不是历史记录）。
> 依据：`../ui/DESIGN.md`「世界相机」（缩放的唯一来源）、`00-master-design.md` §7、`20-layout.md` §1/§2、`config.md` §3、`architecture.md`（取舍表）、`build.md` §7 B15-B17、`../../AGENTS.md` 硬纪律 19。
> 下一批候选见 `backlog.md`。

## 卡 1｜相机拉远（代码已落地，待独立验证）

**范围（已实现）**

- `src/shared/constants.ts`：`ZOOM_MIN = 0.175`、`ZOOM_TEXT_MIN = 0.5`。
- `src/client/world/rules.ts`：`clampZoom`（纯函数）+ 单测；`bedLook` 增一个 `number`（床号是否画）。
- `src/client/world/world.ts`：`zoom` 场景字段（相机 zoom = DPR × 它）、`setZoom` / `applyZoom`、**insets 与跟随速度按 `1 / Z` 换算**、双指捏合（锚在两指中点、`getWorldPoint` 校正滚屏）、**手势出现过第二根手指就不算轻点**、`Z < ZOOM_TEXT_MIN` 时文字与小细节退役、标记 `setScale(1 / Z)`、进厅/重连回 1×。
- `src/client/world/views.ts`：床角标记与人脚下暖点改成「画在原点 + `setPosition` 摆位」（这样 `setScale` 只放大不挪位）；`numberOn` 守卫。
- **卡 1 必须与卡 2 同批部署**（WCAG 2.5.1：多指手势必须有单指替代）。

**验收**

1. 双指捏合能连续拉远到 `0.175` 并回到 `1×`，**不能再放大**（超过 1× 被夹住）。
2. 单指拖拽平移与轻点（点地面走 / 点人选中 / 点自己回中）与改动前一致。
3. **捏合收尾不会误发一次走路**（两指抬起时间不同也不行）。
4. 拉远后相机夹取正确：推到厅边缘能看到「墙外一圈底 + 墙带 + 地板」；拉远后「点自己回中」与 HUD 方位字形仍正确（人物不落在聊天面板下面）。
5. `Z = 0.175` 下第 1 级整厅全部进屏；**看不到**任何床号 / 名字 / 气泡；**我的床与我的人那两颗暖点仍看得见**、标记位置不漂。
6. 回到 `1×` 后文字全部回来。
7. 旋屏保持当前比例；进厅 / 重连回 `1×`。

## 卡 2｜HUD 的单指入口

**范围**

- `src/client/store.ts` + `src/client/hud-view.ts`：`overview: boolean`（= 相机已在下限）与写入口；世界层**只在布尔值翻转时**写（像 `bedDirection` 那样，逐帧写会把 HUD 拖进 React 的渲染循环）。
- `src/client/world-handle.ts` + `world.ts`：一次性的相机命令（不在下限 → 拉到下限；否则 → 回 `1×`）。
- `src/client/components/Hud.tsx`：可点击组加第三颗胶囊，文案随状态：「看全厅」/「回到 1×」。

**验收**

1. 393×852 下三颗胶囊都装得下、触摸目标 ≥44px；显示组折行后 HUD 仍 ≤2 行，世界取景不被压住。
2. 点「看全厅」→ 相机拉到下限、文案变「回到 1×」；再点 → 回 `1×`。
3. 捏合到下限时按钮文案也跟着变（两个入口操作同一个状态）。
4. 单测：`hudViewOf` 的 `overview` 与 `sameHudView`。
