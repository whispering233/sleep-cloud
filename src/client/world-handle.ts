import type { WorldHandle } from './world/world';
import type { ZoomMode } from './zoom';

/**
 * 世界层 → DOM 界面的**唯一一根反向线**（动作行的「回我的床」、`GO` 跳床号、缩放档位）：世界层建起来时注册自己，
 * 界面层只调方法，不去 import 世界层——只 `import type` 才不会把 Phaser 拖进界面层的包
 * （世界层是懒加载块，入场层不该等它下载完）。
 */
let world: WorldHandle | undefined;
/** 最后一次请求的暂停态：世界层是懒加载块，注册可能晚于 App 的 effect。 */
let suspended = false;

export function setWorldHandle(handle: WorldHandle | undefined): void {
  world = handle;
  handle?.setSuspended(suspended);
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
 * 整屏页（入场层 / 说明面板）盖住世界时整帧停渲染。请求先记在模块级，世界层起来时再补上——
 * 入场层不该等它下载完，所以 App 的 effect 可能比世界层先跑。
 */
export function setWorldSuspended(next: boolean): void {
  suspended = next;
  world?.setSuspended(next);
}
