import { DurableObject } from 'cloudflare:workers';

import { findHall } from '../shared/hall-registry';
import type { HallConfig } from '../shared/hall-registry';
import type { ErrorCode } from '../shared/error-code';
import type { ErrorMessage, SnapshotMessage } from '../shared/protocol';
import type { Env } from '../worker/env';
import { appearanceFor, guardIncoming, IDENTITY_HEADERS } from './connection';
import type { ConnectionState } from './connection';
import { BED_INDEX_SQL, BED_SEED_SQL, BED_TABLE_SQL } from './schema';
import { loadScene } from './scene';
import type { SceneGrid } from './scene';
import { buildSnapshot, splitLive } from './snapshot';

/**
 * 大厅房间服务：一个厅一个实例（`idFromName(hallId)`），自带一份私有 SQLite。
 * **厅的边界就是数据库的边界**，所有权威状态在同址，读写都是本地操作。
 *
 * 连接使用平台的 WebSocket 休眠机制：连接期间对象可以休眠，附加数据（位置、状态）随连接存活。
 */
export class Hall extends DurableObject<Env> {
  readonly hall: HallConfig;
  readonly grid: SceneGrid;
  /** 入口格：目前取第一个可行走格（场景里就是左上角走道） */
  readonly entry: { x: number; y: number };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const hall = findHall(ctx.id.name ?? '');
    if (!hall) throw new Error(`厅不在注册表里：${ctx.id.name ?? '(无名)'}`);
    this.hall = hall;
    // 场景数据不一致属于配置错误，启动时就炸（见 docs/design/config.md §3）
    this.grid = loadScene(hall);
    this.entry = this.findEntry();
    this.initializeStorage();
  }

  /** 建表 + 补足床位行。首次冷启动写 256 行，之后每次启动都是空转（幂等）。 */
  private initializeStorage(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(BED_TABLE_SQL);
    for (const statement of BED_INDEX_SQL) sql.exec(statement);
    sql.exec(BED_SEED_SQL, this.hall.capacity - 1, Date.now());
  }

  private findEntry(): { x: number; y: number } {
    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        if (this.grid.isWalkable(x, y)) return { x, y };
      }
    }
    throw new Error(`场景没有可行走格：${this.hall.sceneGuid}`);
  }

  /** 已被认领的床位数（**归属数**，不是在线人数）。 */
  async claimedBedCount(): Promise<number> {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM bed WHERE owner_user_id IS NOT NULL')
      .one();
    return row.n;
  }

  /** WebSocket 升级由 Worker 转发进来（前置校验已在 Worker 完成）。 */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('这个入口只接受 WebSocket 升级', { status: 426 });
    }

    const userId = request.headers.get(IDENTITY_HEADERS.userId);
    const name = decodeName(request.headers.get(IDENTITY_HEADERS.name));
    if (!userId || !name) return new Response('缺少连接身份', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId,
      name,
      appearance: appearanceFor(userId),
      timezone: request.headers.get(IDENTITY_HEADERS.timezone) ?? '',
      x: this.entry.x,
      y: this.entry.y,
      state: 'roaming',
      ready: false,
    } satisfies ConnectionState);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const connection = readConnection(ws);
    if (!connection || typeof raw !== 'string') return;

    const verdict = guardIncoming(connection, raw, this.hall.sceneGuid);
    switch (verdict.kind) {
      case 'ignore':
      case 'business':
        // 走动、躺下等意图在后续卡片接上
        return;
      case 'reject':
        this.reject(ws, verdict.code);
        return;
      case 'hello': {
        const ready: ConnectionState = { ...connection, ready: true };
        ws.serializeAttachment(ready satisfies ConnectionState);
        this.touchLastSeen(ready.userId);
        ws.send(JSON.stringify(await this.snapshotFor(ws, ready)));
        return;
      }
    }
  }

  private reject(ws: WebSocket, code: ErrorCode): void {
    ws.send(JSON.stringify({ t: 'error', code } satisfies ErrorMessage));
    ws.close(1000, code);
  }

  /**
   * 每次连接建立时更新 `last_seen_at`（归属释放的依据）。
   * **不随心跳更新**——那是写放大；断开时的更新在宽限处理里做（避免每抖动一次写一行）。
   */
  private touchLastSeen(userId: string): void {
    this.ctx.storage.sql.exec('UPDATE bed SET last_seen_at = ? WHERE owner_user_id = ?', Date.now(), userId);
  }

  /** 全量快照：在线连接来自内存，**睡痕条目只能查库**（人已离线，内存里没有他）。 */
  private async snapshotFor(ws: WebSocket, me: ConnectionState): Promise<SnapshotMessage> {
    const { online, others } = splitLive(
      this.ctx.getWebSockets().map((other) => ({
        self: other === ws,
        connection: readConnection(other),
      })),
    );

    const sql = this.ctx.storage.sql;
    const ownedBeds = sql
      .exec<{ bed_no: number }>('SELECT bed_no FROM bed WHERE owner_user_id IS NOT NULL')
      .toArray()
      .map((row) => row.bed_no);

    // 走 state 索引取 trace 行（几十行量级），不是全表扫描后再过滤
    const traceRows = sql
      .exec<{ bed_no: number; owner_user_id: string; owner_name: string | null; owner_appearance: string | null }>(
        "SELECT bed_no, owner_user_id, owner_name, owner_appearance FROM bed WHERE state = 'trace'",
      )
      .toArray()
      .map((row) => ({
        bedNo: row.bed_no,
        userId: row.owner_user_id,
        name: row.owner_name,
        appearance: row.owner_appearance,
      }));

    return buildSnapshot({ hall: this.hall, serverTs: Date.now(), online, me, others, ownedBeds, traceRows });
  }
}

function readConnection(ws: WebSocket): ConnectionState | null {
  const attachment = ws.deserializeAttachment();
  return attachment ? (attachment as ConnectionState) : null;
}

function decodeName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
