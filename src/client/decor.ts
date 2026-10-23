/**
 * 我的预留位装饰（**客户端本地偏好**，见 `docs/design/80-reserve-decor.md` §4、
 * `docs/design/40-client-storage.md` §3 的 `sc.decor` 行）。
 *
 * 纯函数：偏好层（逐块白名单）、界面层（候选与文案）与世界层（`decor.<块> === '<id>'` 判据）
 * 共用这一份，谁都不自己写第二套候选表或中文名。服务端不知道这些存在。
 */

/**
 * 能摆装饰的块：**只有床头与床尾**。中间块还没有候选，于是既不进数据、也不进界面
 * （没有可选的东西，连「无装饰」都不必给，`80-reserve-decor.md` §4.1）。
 */
export type DecorBlock = 'head' | 'foot';

/**
 * 候选表的**唯一真源**：每块能摆什么、按什么顺序排，全由它定。
 *
 * 加一样装饰 = 这里给它那一块加一个 id + `DECOR_LABELS` 加一行中文名（世界层再加一个视图 +
 * 判据）：**存储层零改动**（新 id 立刻可存，老值里没有它就是该块默认），界面按表遍历所以自动多一行。
 * 同时把「每块最多摆一样」写成形状——同一块的候选互斥，换候选就是换掉这一块的内容（§1 规则 5）。
 */
export const DECOR_BLOCKS = {
  head: ['fire'],
  foot: ['cat'],
} as const;

/** 界面上块的先后：与 `reserveBlockOf` 的床头 → 床尾同序（数据表是对象，顺序要另给一份）。 */
export const DECOR_BLOCK_ORDER: readonly DecorBlock[] = ['head', 'foot'];

/** 所有候选 id 的并集（候选表摊平）：加一样装饰时它会自动长大，白名单不用逐个改。 */
export type DecorId = (typeof DECOR_BLOCKS)[DecorBlock][number];

/** 某一块能取的值 = **该块的**候选 ∪ `none`。跨块 id 在类型上就写不进去（`cat` 不能存进床头块）。 */
export type DecorValue<B extends DecorBlock> = (typeof DECOR_BLOCKS)[B][number] | 'none';

/**
 * 一整份选择：每块一个值。**形状就是互斥**——「同一块摆两样」写不出来，所以不需要校验去拦
 * （`40-client-storage.md` §3）。
 */
export type DecorPick = { [B in DecorBlock]: DecorValue<B> };

/** 默认 = 两样都在：与「选择」上线前的行为完全一致（`80-reserve-decor.md` §4.1）。 */
export const DEFAULT_DECOR: DecorPick = { head: 'fire', foot: 'cat' };

/** 每样装饰的中文名：`Record` 少一行就 typecheck 红，所以「加 id 忘加文案」不成立。 */
const DECOR_LABELS: Record<DecorId, string> = { fire: '篝火', cat: '猫' };

/** 每块的标题（齿轮浮层里那两个 12px 纯文字标题，`docs/ui/DESIGN.md` 的 `decor-picker` 行）。 */
const BLOCK_LABELS: Record<DecorBlock, string> = { head: '床头', foot: '床尾' };

/**
 * 「无装饰」的文案。它是**一等值**（记的是「我关了」，不是「没写过」），所以有一句自己的话，
 * 而不是靠「再点一次取消」这种隐性交互（§4.3）。
 */
export const NO_DECOR_LABEL = '无装饰';

/** 装饰 id → 中文名（界面文案的唯一来源）。 */
export function decorLabel(id: DecorId): string {
  return DECOR_LABELS[id];
}

/** 块 → 中文标题（「床头」/「床尾」）。 */
export function blockLabel(block: DecorBlock): string {
  return BLOCK_LABELS[block];
}

/** 浮层里的一项：值 + 它的文案（`none` 也在里面，文案是「无装饰」）。 */
export interface DecorOption<B extends DecorBlock> {
  id: DecorValue<B>;
  label: string;
}

/**
 * 某一块可选项：**候选表 + `none`，`none` 在末尾**（界面按它遍历，所以加一样装饰自动多一行）。
 * 顺带就是「界面永远摆不出一个不能存的值」的保证——两者同源。
 */
export function decorOptionsOf<B extends DecorBlock>(block: B): DecorOption<B>[] {
  const options: DecorOption<B>[] = [];
  for (const id of DECOR_BLOCKS[block]) options.push({ id, label: decorLabel(id) });
  options.push({ id: 'none', label: NO_DECOR_LABEL });
  return options;
}

/**
 * 存储层的**逐块白名单**：`value` 必须是**这一块**的候选或 `none`。
 *
 * 逐块而不是整键，是因为坏值的粒度就该是块（包被删了 / 搬到了别的块）——整键判废会让用户
 * 莫名丢掉另一块的选择（`40-client-storage.md` §3）。
 */
export function isDecorChoice<B extends DecorBlock>(block: B, value: unknown): value is DecorValue<B> {
  if (typeof value !== 'string') return false;
  for (const option of decorOptionsOf(block)) if (option.id === value) return true;
  return false;
}
