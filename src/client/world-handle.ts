import type { WorldHandle } from './world/world';
import type { ZoomMode } from './zoom';

/**
 * 世界层 → DOM 界面的**唯一一根反向线**（动作行的「回我的床」、`GO` 跳床号、缩放档位）：世界层建起来时注册自己，
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
 * 设世界缩放档位（齿轮浮层的「缩放」二级选出来的）。它是 WCAG 2.5.1 要的那个**单指入口**
 * （多指手势必须有单指替代，而且捏合没有可发现性），所以不能只靠捏合。
 */
export function setZoomMode(mode: ZoomMode): void {
  world?.setZoomMode(mode);
}

/**
 * 让位（游戏页开着时）：停掉世界层的渲染循环。**位置与状态一个字节都不改**，人还站在厅里。
 * 世界层还没起来时什么都不做（同上面几条）。
 */
export function pauseWorld(): void {
  world?.pause();
}

/** 回到大厅时恢复渲染循环（`wake(true)`，不吃暂停期间累积的 `delta`）。 */
export function resumeWorld(): void {
  world?.resume();
}
