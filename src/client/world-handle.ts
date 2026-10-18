import type { WorldHandle } from './world/world';

/**
 * 世界层 → DOM 界面的**唯一一根反向线**（动作行的「回我的床」与 `GO` 跳床号）：世界层建起来时注册自己，
 * 界面层只调方法，不去 import 世界层——只 `import type` 才不会把 Phaser 拖进界面层的包
 * （世界层是懒加载块，入场层不该等它下载完）。
 */
let world: WorldHandle | undefined;

export function setWorldHandle(handle: WorldHandle | undefined): void {
  world = handle;
}

/** 相机跳到我的床。世界层还没起来（入场层期间）时什么都不做。 */
export function focusMyBed(): void {
  world?.focusMyBed();
}

/** 相机跳到指定床（动作行的 `GO`），与 `sendHop(bedNo)` 配成一对。同样在世界层没起来时什么都不做。 */
export function focusBed(bedNo: number): void {
  world?.focusBed(bedNo);
}

/**
 * 拉开 / 收起整厅视角（动作行的「看全厅 / 回到 1×」）。
 * 它也是 WCAG 2.5.1 要的那个**单指入口**（多指手势必须有单指替代），所以不能只靠捏合。
 */
export function toggleOverview(): void {
  world?.toggleOverview();
}
