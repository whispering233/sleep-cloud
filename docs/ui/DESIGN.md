---
version: alpha
name: Sleep Cloud
description: 云上睡眠大厅的视觉系统：单色线稿 + 夜晚色调
colors:
  primary: "#0E1526"
  secondary: "#16203A"
  tertiary: "#F2B457"
  tertiary-day: "#AD740F"
  neutral: "#E6EAF2"
  neutral-muted: "#8A94AC"
  line: "#C9D2E6"
  trace: "#6E7996"
  claimed: "#5A6480"
  day-bg: "#F4F1EA"
  day-surface: "#FFFFFF"
  day-ink: "#22252B"
  day-ink-muted: "#646B78"
  day-line: "#2E3238"
  day-trace: "#6F6A61"
  day-claimed: "#8E897F"
  alert: "#E08A76"
  live: "#7FBFA8"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0em
  body:
    fontFamily: "ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0em
  input:
    fontFamily: "ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0em
  label:
    fontFamily: "ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.01em
  caption:
    fontFamily: "ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.01em
  numeric:
    fontFamily: "ui-monospace, 'SFMono-Regular', monospace"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.02em
rounded:
  sm: 4px
  md: 8px
  lg: 16px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
components:
  world-night:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.line}"
  world-day:
    backgroundColor: "{colors.day-bg}"
    textColor: "{colors.day-line}"
  bed-empty-hint:
    backgroundColor: "{colors.neutral-muted}"
  bed-occupied:
    backgroundColor: "{colors.line}"
  bed-occupied-day:
    backgroundColor: "{colors.day-line}"
  bed-claimed:
    backgroundColor: "{colors.claimed}"
  bed-claimed-day:
    backgroundColor: "{colors.day-claimed}"
  bed-trace:
    backgroundColor: "{colors.trace}"
  bed-trace-day:
    backgroundColor: "{colors.day-trace}"
  marker-own:
    backgroundColor: "{colors.tertiary}"
    rounded: "{rounded.full}"
  marker-own-day:
    backgroundColor: "{colors.tertiary-day}"
    rounded: "{rounded.full}"
  presence-dot:
    backgroundColor: "{colors.live}"
  name-bubble:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs}"
  chat-panel:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.neutral}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  chat-panel-day:
    backgroundColor: "{colors.day-surface}"
    textColor: "{colors.day-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  chat-message-own:
    textColor: "{colors.neutral}"
  chat-message-other:
    textColor: "{colors.neutral-muted}"
    padding: "{spacing.xs}"
  hud:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  hud-day:
    backgroundColor: "{colors.day-bg}"
    textColor: "{colors.day-ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  hud-numeric:
    textColor: "{colors.neutral-muted}"
    typography: "{typography.numeric}"
  primary-action:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "{spacing.md}"
    height: "44px"
  touch-target-min:
    height: "44px"
    width: "44px"
    rounded: "{rounded.full}"
  text-input:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.input}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    height: "44px"
  toast-recoverable:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.alert}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
  entry-overlay:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.title}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
---

# Sleep Cloud 视觉系统

## Brand & Style

一个**安静的、克制的、深夜色调的**睡眠大厅。视觉系统的唯一目标是：**让人在凌晨三点看着它的时候不觉得被刺激。**

- **气质**：安静、低刺激、有陪伴感。不是游戏，不是效率工具。
- **受众**：睡不着的人。他们在深夜使用，屏幕往往是周围唯一的光源。
- **情绪目标**：看到「有人和我一样醒着」；看到「有人在睡」。**不追求热闹、不追求成就、不追求效率。**
- **表现手法**：**单色线稿**为主，点缀极少量的暖色光。界面只有两种状态——夜晚与白天——由**大厅所属大区**的时区决定，而不是用户本地时间。
- **层级**：世界（画布）与界面（DOM）是两套渲染，但共用同一套令牌。世界用画布画线稿，界面用 DOM 画文字与控件。

## Colors

配色分两组：**夜晚**（默认，也是绝大多数使用时段）与**白天**。两者是同一套语义的两个取值，切换只看厅的时钟。

夜晚组：

- **Primary（`primary`）**：深蓝黑，整个大厅的夜空底色。不纯黑——纯黑会让线稿显得刺眼，也更容易暴露 OLED 屏的色阶断层。
- **Secondary（`secondary`）**：比底色亮一档，用于浮在夜空上的界面：聊天面板、输入框、提示条。
- **Tertiary（`tertiary`）**：暖灯黄。**全系统唯一允许出现的暖色**，只用于**小标记**（自己的小人脚下、自己的床位角落）与床头灯光晕。**不得用于整张床的轮廓**：它在冷底上比亮线更抢眼，会把「谁的床」排到「有人在睡」前面。
- **Tertiary Day（`tertiary-day`）**：暖灯黄的白天版本（暗琥珀）。原暖色在浅底上只有 1.63:1，几乎不可见；标记必须两个模式下都看得见
- **Neutral（`neutral`）**：接近白的冷灰。线稿与正文的墨色。
- **Neutral Muted（`neutral-muted`）**：次要文字、HUD、别人说的话、空床的提示轮廓。
- **Line（`line`）**：床上**有活人**的轮廓、场景结构线。轮廓梯次里最强的一档。
- **Trace（`trace`）**：**睡痕**的小人名字与轮廓。明显低于活人一档——睡痕是「留在这里的痕迹」，不是「在场的活人」。
- **Claimed（`claimed`）**：**有主但空着的床**。轮廓梯次里最弱的一档，只表达「这里是某个人的位置」。

**轮廓梯次必须单调且可辨**（WCAG 1.4.11 对图形对象要求 3:1）。在夜晚底色 `#0E1526` 上的实测对比度：

| 档 | token | 值 | 对比度 |
| :--- | :--- | :--- | :--- |
| 床上有人 | `line` | `#C9D2E6` | 12.0:1 |
| 睡痕 | `trace` | `#6E7996` | 4.2:1 |
| 有主空床 | `claimed` | `#5A6480` | 3.1:1 |

白天三档同构（底 `#F4F1EA`）：`day-line` 11.4:1 > `day-trace` 4.8:1 > `day-claimed` 3.1:1。

> 这三个数字是用 WCAG 相对亮度公式算出来的，**未经目视校准**；真机低亮度下的可辨性属于实测项（卡 9）。

> 历史坑：最早的 `claimed` 取 `#3E4760`（1.97:1），设计意图是「最弱的一档」，但实际在夜里几乎看不见——「满厅淡轮廓 = 床位认领得差不多了」这个效果就不成立。**弱不等于不可见。**

白天组（同一套语义的反白版本）：

- **Day BG（`day-bg`）**、**Day Surface（`day-surface`）**、**Day Ink（`day-ink`）**、**Day Ink Muted（`day-ink-muted`）**、**Day Line（`day-line`）**、**Day Trace（`day-trace`）**、**Day Claimed（`day-claimed`）**、**Day Tertiary（`tertiary-day`）**。
- **换昼夜只换配色，不重画任何资源。**

状态色：

- **Alert（`alert`）**：可恢复错误的提示色。刻意选偏暖的低饱和红，避免在深夜里变成红色警报灯。
- **Live（`live`）**：表示「有人在线」的正向状态，只用于极小面积的点缀。

**配色纪律**：暖色总面积应小于屏幕的 5%。点睛色一旦变多，深夜的克制感立刻消失。

**昼夜的边界**：按厅时区，`06:00–18:00` 用白天组，其余时间用夜晚组。世界画布与界面共用这一条判断——厅是共享空间，物理上只能有一片天空。

## Typography

- 中文优先的系统字体栈。**不引入外部字体文件**——深夜加载字体造成的闪烁与延迟与产品气质相悖，且中文字体体积成本极高。
- `title`：厅名、入场层标题。
- `body`：聊天消息正文、说明文字。
- `label`：按钮与控件标签。
- `caption`：HUD 的辅助信息（大区名、床号、在线人数）。
- `numeric`：数字类信息（在线人数、床位号、计时）。用等宽字体避免数字跳动。

正文字号不低于 15px，深夜里不能太小。

## Layout & Spacing

**移动端优先。** 先在竖屏窄幅下定稿，再向上适配桌面——而不是先做桌面然后“适配手机”。主场景是一个人躺在床上、单手拿手机、竖屏、可能弱网、随时会锁屏。

断点（三个阶段就够，不要更多）：

| 阶段 | 宽度 | 主要形态 |
| :--- | :--- | :--- |
| 窄（主战场） | < 640px | 竖屏手机。世界全屏；聊天面板贴底常驻；HUD 收到顶部两角 |
| 中 | 640–1024px | 手机横屏 / 平板。聊天仍贴底，但宽度受限不被拉伸到全宽 |
| 宽 | > 1024px | 桌面。聊天靠右或靠下，世界居中，视野变宽 |

布局规则：

- **世界是全屏的**：画布铺满视口，界面浮在它之上。
- **界面占据边缘，不占据中心**：聊天在底部，HUD 在角上。**视野中央永远留给大厅本身**——那是产品要展示的东西。
- **聊天是常驻的**，不是弹出层、不是二级菜单。它是核心动作。窄屏下也常驻（显示最近几条 + 输入框），可以向上展开，不能收进菜单。
- 间距用 4 的倍数：`xs` 4px、`sm` 8px、`md` 12px、`lg` 16px。
- 触摸目标不小于 `touch-target-min`（44×44px）。主要操作与输入框高度用 44px。
- 考虑安全区：刘海屏顶部与手势条底部需要内边距（页面需声明覆盖到安全区，才能读取对应的内边距环境值）。
- 输入框聚焦时不得被软键盘遮挡（面板整体上移，而不是缩小世界）。

移动端的三个硬约束：

1. **输入框字号不得小于 16px**（故单独定义了 `input` 字号）。窄屏浏览器会在聚焦字号偏小的输入框时**自动缩放整个页面**，缩放后页面位置错乱且不会自动恢复。
2. **不做 hover 依赖**。手机没有鼠标悬停；任何“悬停才显示”的信息在手机上等于不存在。
3. **不禁止用户缩放页面**（禁用缩放是无障碍反问）。靠字号与布局避免误触缩放，而不是靠禁用它。

## Elevation & Depth

**不制造深度感。** 这是一片平铺的夜色，不是有层次的界面。

- 不用阴影表达层级。层级用**亮度差**（`primary` 与 `secondary`）和**边框**表达。
- 浮层（错误提示）用底色加边框，不用投影。
- 世界本身没有阴影：床位、小人、装饰都是平铺线稿，靠**绘制顺序（按 y 排序）**解决遮挡，不靠阴影或加粗描边。

## Shapes

- **线稿是等宽的**：小人、床、装饰、场景结构用同一线宽，靠形态区分，不靠粗细。
- 圆角只出现在界面控件上：`sm` 用于小标记与 HUD，`md` 用于面板与输入框，`lg` 用于入场层，`full` 用于主要操作按钮。
- 小人造型使用**圆头 + 点眼 + 简化四肢**的线稿形态；躺下时以「被子盖住身体、只露脸」表达。这是整套视觉里辨识度最高的一笔，不要改。

## Components

| 组件 | 要点 |
| :--- | :--- |
| `world-night` / `world-day` | 世界画布的昼夜两组取值。铺满视口，只画场景、床位、小人、表情，**不渲染任何文字界面** |
| `bed-occupied` / `bed-trace` / `bed-claimed`（及各自白天版本） | **轮廓只回答两个问题**（完整真值表见下）。`bed-empty-hint` 是「可躺的空床」被点中时的瞬时反馈色 |
| `marker-own` | **属于我的标记**：自己的小人脚下、自己的床位角落共用（一处概念、两处落地）。它与轮廓正交——所以暖灯色不需要参与轮廓梯次排序 |

**床位轮廓真值表**（不得把两个维度合并成一个「床位状态」）：

| 情形 | 轮廓 | `marker-own` | 名字 |
| :--- | :--- | :--- | :--- |
| 无主空床 | 不画 | 无 | 不画 |
| 别人的床，空着 | `claimed` | 无 | 不画 |
| 我的床，空着（我在厅里走动） | `claimed` | **有** | 不画 |
| 别人的床，有人在睡 | `line` | 无 | 画 |
| 别人的床，睡痕 | `trace` | 无 | 画，更暗 |
| 我的床（我自己躺着） | `line` | **有** | **不画**（我知道我是谁） |

三条配套约束：

- **睡痕的小人整体降低不透明度**（不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色）
- **轮廓不影响可点击性**：命中区域是床的占位区（无主床不画轮廓但它可以点）
- **`marker-own` 有最小屏幕尺寸下限**：缩小时不得消失，否则「找不到我的床」
| `chat-panel` / `chat-panel-day` | 常驻底部的聊天面板。自己的消息用 `neutral`，别人的用 `neutral-muted` |
| `chat-message-own` / `chat-message-other` | 消息条目。系统提示（有人离开等）用 `caption` 与 `neutral-muted` |
| `hud` / `hud-day` / `hud-numeric` | 角落的极简信息：大区名、自己床号、在线人数、当前昼夜 |
| `entry-overlay` | 入场层：昵称输入 + 18 岁自述 + 大区选择，一次走完 |
| `primary-action` / `text-input` | 入场与聊天输入的主要操作与输入框 |
| `toast-recoverable` | **只对可恢复错误显示**（床位被占、名字不能用、消息过长）。静默类错误不显示 |
| `presence-dot` | 「有人在线」的极小面积点缀 |
| `name-bubble` | **选中某个人时弹出的唯一名字气泡**（见下） |
| `marker-own` | **属于我的标记**：自己的小人脚下 + 自己的床位角落共用同一颗暖灯色小点 |

### 名字什么时候出现

名字是身份信息，不是陪伴信息。**「看到有人和我一样醒着」靠的是看到人本身。**

| 对象 | 名字 | 理由 |
| :--- | :--- | :--- |
| 躺在床上的人（含睡痕） | **始终显示**，画在床位上 | 床的位置稳定，标签不会飘；而「这是谁的位置」本身就是产品要表达的 |
| 漫游中的人（站着/走动） | **默认不显示**；被选中时显示唯一一个名字气泡 | 一百个人就是一百个随风飘的标签，画面会立刻变吵 |
| 自己 | **一律不画**（地上与床上都不画），靠 `marker-own` 识别 | 我知道我是谁。而且地上不画、床上却画是不对称的 |

**选中态是一个概念、服务两件事**：点中某个小人（或床上的人）→ 弹出名字气泡 **且** 成为私聊目标。同一时刻只显示一个气泡，点地面则取消选中并走动。

**表情**是世界内的气泡，不需要界面组件。

## Do's and Don'ts

**Do**

- 把视野中央留给大厅本身，界面只占边缘。
- 用亮度差与边框表达层级，不用阴影。
- 睡痕必须一眼可辨——它比在线者暗得多，这是「这里曾有人睡过」的全部表达。
- 昼夜切换只换配色令牌，不动任何资源。
- 把床位的**归属**与**占用**当成两个独立维度推导，不要合并成一个「床位状态」。
- 占用一旦成立就接管轮廓颜色（有人睡 > 谁的床）：`line` > `trace` > `claimed` > 不画。
- **「是我的」靠一个独立的小标记**，不要用轮廓颜色表达（轮廓梯次只有三档，插入暖色会打乱排序）。
- 有主但空的床只画淡轮廓、**不写名字**；名字只出现在床上有人的时候。
- 暖色只用在床头灯与自己的床位标记上。

**Don't**

- 不要用高饱和像素风或鲜艳渐变。那会让一个失眠大厅变吵闹（调研中已排除像素风方案）。
- 不要用红色警报类配色做错误提示。
- 不要把聊天藏进弹出层或二级菜单。
- 不要让地上的小人常显名字（一百个飘动的标签会把大厅变成名单）。
- 不要在渲染聊天消息时临时去查人名（对方离开后那行名字会变空）——追加时就固化。
- 不要把暖灯色用于整张床的轮廓（它在冷底上比亮线更抢眼，会颠倒「有人睡 > 谁的床」的优先级）。
- 不要让轮廓梯次的相邻两档靠得太近（弱不等于不可见，也不等于分不清）。
- 不要给睡着的人做逐帧呼吸动画——用整体透明度或轻微缩放的低频变化代替（256 个睡着的人逐帧动画会吃掉手机 CPU）。
- 不要引入外部字体文件。
- 不要在画布里渲染文字界面，也不要在 DOM 里重画世界。
- 不要给 256 张床都写名字（那是名单，不是大厅）：文字只出现在有人的床上。
- 不要先做桌面再“适配”手机（顺序反了会付出双倍布局返工）。
- 不要把重要信息做成“悬停才显示”——手机上不存在悬停。
- 不要让输入框字号低于 16px（会触发窄屏浏览器的页面自动缩放）。
- 不要禁用用户缩放页面。
- 不要按设备像素比 1 渲染画布（窄屏高密度屏上会糊），也不要无上限地按比值渲染（低端机扛不住）。
