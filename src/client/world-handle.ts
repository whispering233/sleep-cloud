import type { WorldHandle } from './world/world';

/**
 * 世界层 → DOM 界面的**唯一一根反向线**（HUD 的「跳到我的床」）：世界层建起来时注册自己，
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
