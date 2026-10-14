import { DurableObject } from 'cloudflare:workers';

import { findHall } from '../shared/hall-registry';
import type { HallConfig } from '../shared/hall-registry';
import type { Env } from '../worker/env';
import { BED_INDEX_SQL, BED_SEED_SQL, BED_TABLE_SQL } from './schema';
import { loadScene } from './scene';
import type { SceneGrid } from './scene';

/**
 * 大厅房间服务：一个厅一个实例（`idFromName(hallId)`），自带一份私有 SQLite。
 * **厅的边界就是数据库的边界**，所有权威状态在同址，读写都是本地操作。
 *
 * 单线程串行处理请求、消息与到期事件——因此 256 张床的分配天然不会撞车。
 */
export class Hall extends DurableObject<Env> {
  readonly hall: HallConfig;
  readonly grid: SceneGrid;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const hall = findHall(ctx.id.name ?? '');
    if (!hall) throw new Error(`厅不在注册表里：${ctx.id.name ?? '(无名)'}`);
    this.hall = hall;
    // 场景数据不一致属于配置错误，启动时就炸（见 docs/design/config.md §3）
    this.grid = loadScene(hall);
    this.initializeStorage();
  }

  /** 建表 + 补足床位行。首次冷启动写 256 行，之后每次启动都是空转（幂等）。 */
  private initializeStorage(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(BED_TABLE_SQL);
    for (const statement of BED_INDEX_SQL) sql.exec(statement);
    sql.exec(BED_SEED_SQL, this.hall.capacity - 1, Date.now());
  }

  /** 已被认领的床位数（**归属数**，不是在线人数）。 */
  async claimedBedCount(): Promise<number> {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM bed WHERE owner_user_id IS NOT NULL')
      .one();
    return row.n;
  }
}
