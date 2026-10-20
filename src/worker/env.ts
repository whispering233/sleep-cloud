import type { Hall } from '../hall/hall';

/** Worker 的绑定与环境变量。 */
export interface Env {
  /**
   * 会话 cookie 的 HMAC 签名密钥。生产环境**必须**通过平台密钥存储注入：
   * 缺失时只有本机地址才会回落到开发密钥，其他情况直接失败（绝不静默使用可猜的密钥）。
   */
  SESSION_SECRET?: string;
  /**
   * 后台登录令牌（见 `docs/api/30-api-admin.md` §2.1）。**缺失时后台接口一律 401**，
   * 绝不回落到某个默认值。
   */
  ADMIN_TOKEN?: string;
  /** 厅的房间服务：一个厅一个实例（`getByName(hallId)`）。 */
  HALL: DurableObjectNamespace<Hall>;
}
