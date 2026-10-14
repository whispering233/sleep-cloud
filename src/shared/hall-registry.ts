/**
 * 厅注册表（见 `docs/design/config.md` §1）：**唯一需要人工维护的配置**。
 * 满员时在这里加一条（例如 `asia-2`），部署即生效；不做自动扩厅。
 *
 * `id` 用作房间服务实例名与会话里的归属标识，**一旦上线不可更改**。
 */
export interface HallConfig {
  id: string;
  name: string;
  /** 厅固定时区（IANA 名称），决定厅的昼夜与每日清理时刻 */
  timezone: string;
  /** 场景标识，客户端与服务端必须一致 */
  sceneGuid: string;
  /** 床位数，必须与场景数据里的床位数相等 */
  capacity: number;
}

export const HALLS: readonly [HallConfig, ...HallConfig[]] = [
  { id: 'asia-1', name: '亚洲厅', timezone: 'Asia/Shanghai', sceneGuid: 'dorm-asia-01', capacity: 256 },
  { id: 'europe-1', name: '欧洲厅', timezone: 'Europe/Berlin', sceneGuid: 'dorm-europe-01', capacity: 256 },
  { id: 'america-1', name: '美洲厅', timezone: 'America/New_York', sceneGuid: 'dorm-america-01', capacity: 256 },
];

export function findHall(hallId: string): HallConfig | undefined {
  return HALLS.find((hall) => hall.id === hallId);
}
