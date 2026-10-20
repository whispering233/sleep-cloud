import type { Hall } from '../hall/hall';

/** Worker 的绑定与环境变量。 */
export interface Env {
  /**
   * 会话 cookie 的 HMAC 签名密钥。生产环境**必须**通过平台密钥存储注入：
   * **任何环境缺失都直接失败**（绝不静默使用可猜的密钥）。
   */
  SESSION_SECRET?: string;
  /**
   * 上一把签名密钥，**只用于验签**（密钥环，见 `docs/design/config.md` §4）：轮换时把旧密钥放这里，
   * 旧 cookie 验签通过后重签成 `SESSION_SECRET`。正常时为空。
   */
  SESSION_SECRET_PREV?: string;
  /**
   * 后台登录令牌（见 `docs/api/30-api-admin.md` §2.1）。**缺失时后台接口一律 401**，
   * 绝不回落到某个默认值。
   */
  ADMIN_TOKEN?: string;
  /** 厅的房间服务：一个厅一个实例（`getByName(hallId)`）。 */
  HALL: DurableObjectNamespace<Hall>;
}
