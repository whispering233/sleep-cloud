import { DurableObject } from 'cloudflare:workers';

import { findHall } from '../shared/hall-registry';
import type { HallConfig } from '../shared/hall-registry';
import type { ErrorCode } from '../shared/error-code';
import type { DownstreamMessage, ErrorMessage, Facing, SnapshotMessage, UpstreamMessage } from '../shared/protocol';
import type { Env } from '../worker/env';
import { MOVE_MS_PER_TILE, TICK_MS } from '../shared/constants';
import { appearanceFor, guardIncoming, IDENTITY_HEADERS } from './connection';
import type { ConnectionState } from './connection';
import { advanceMover } from './movement';
import type { MoverState } from './movement';
import { findPath } from './pathfinding';
import type { Tile } from './pathfinding';
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

  /**
   * 移动者集合（内存工作集，不落库）：有未走完路径的人。
   * 它是内存循环的工作集，而「有移动者 ⇒ 有循环 ⇒ 对象无法休眠」保证它不会被驱逐（见 `10-hall-runtime.md` §5.3）。
   */
  private readonly movers = new Map<string, { mover: MoverState; facing: Facing }>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;

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
        return;
      case 'business':
        this.handleIntent(ws, connection, verdict.message);
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

  /** 静默类错误：只回错误码，不断开，也不提示（客户端点了墙面属于正常误触）。 */
  private sendError(ws: WebSocket, code: ErrorCode): void {
    ws.send(JSON.stringify({ t: 'error', code } satisfies ErrorMessage));
  }

  /** 上行只表达意图；这里分派到各自的处理函数（躺下/起身在后续卡片接上）。 */
  private handleIntent(ws: WebSocket, connection: ConnectionState, message: UpstreamMessage): void {
    if (message.t === 'walk') {
      const x = Number(message.x);
      const y = Number(message.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !this.grid.isWalkable(x, y)) {
        this.sendError(ws, '3006');
        return;
      }
      this.startWalking(ws, connection, { x, y });
    }
  }

  /** 「我要去这一格」：新意图覆盖当前路径；目标为当前格则原地不动。 */
  private startWalking(ws: WebSocket, connection: ConnectionState, target: Tile): void {
    if (connection.x === target.x && connection.y === target.y) {
      this.stopWalking(connection.userId);
      this.writeConnection(ws, { ...connection, target: undefined });
      return;
    }

    const path = findPath(this.grid, { x: connection.x, y: connection.y }, target);
    if (!path || path.length === 0) {
      this.sendError(ws, '3006');
      return;
    }

    this.movers.set(connection.userId, {
      mover: { x: connection.x, y: connection.y, path, legElapsedMs: 0 },
      facing: facingFrom(connection.x, connection.y, path[0] as Tile),
    });
    this.writeConnection(ws, { ...connection, target });
    this.startTicking();
  }

  private stopWalking(userId: string): void {
    this.movers.delete(userId);
    if (this.movers.size === 0) this.stopTicking();
  }

  /**
   * 内存循环：只在有移动者时存在，集合空了立即清除。
   * 忘记清除会让对象整夜不休眠、整夜计费——这是本项目最容易泄漏成本的地方。
   */
  private startTicking(): void {
    if (this.tickTimer !== null) return;
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.ensureMovers();
  }

  private stopTicking(): void {
    if (this.tickTimer === null) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /** 对象被驱逐后重建工作集：附加数据里还有目标的，重新算一次路径（BFS 是确定性的）。 */
  private ensureMovers(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready || !connection.target) continue;
      if (this.movers.has(connection.userId)) continue;

      const path = findPath(this.grid, { x: connection.x, y: connection.y }, connection.target);
      if (!path || path.length === 0) {
        this.writeConnection(ws, { ...connection, target: undefined });
        continue;
      }
      this.movers.set(connection.userId, {
        mover: { x: connection.x, y: connection.y, path, legElapsedMs: 0 },
        facing: facingFrom(connection.x, connection.y, path[0] as Tile),
      });
    }
  }

  /** 一个节拍：按**实际经过的时间**推进所有移动者，然后把变化合并成一条广播。 */
  private tick(): void {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;

    const updates: Array<[string, number, number, Facing]> = [];
    for (const [userId, entry] of [...this.movers]) {
      const ws = this.socketOf(userId);
      if (!ws) {
        this.movers.delete(userId); // 断线：close 里已删，这里兜底
        continue;
      }

      const { mover } = entry;
      const previousX = mover.x;
      const previousY = mover.y;
      const result = advanceMover(mover, elapsed, MOVE_MS_PER_TILE);

      if (result.moved) {
        entry.facing = facingFrom(previousX, previousY, mover);
        updates.push([userId, mover.x, mover.y, entry.facing]);
        const connection = readConnection(ws);
        if (connection) this.writeConnection(ws, { ...connection, x: mover.x, y: mover.y });
      }

      if (result.arrived) {
        const connection = readConnection(ws);
        if (connection) this.writeConnection(ws, { ...connection, target: undefined });
        this.movers.delete(userId);
      }
    }

    if (updates.length > 0) {
      this.broadcast({ t: 'pos', ts: now, items: updates });
    }
    if (this.movers.size === 0) this.stopTicking();
  }

  /** 出站消息不计费，但要克制：只在有人真的移动时才发，且一批一条。 */
  private broadcast(message: DownstreamMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (readConnection(ws)?.ready) ws.send(payload);
    }
  }

  private socketOf(userId: string): WebSocket | undefined {
    return this.ctx
      .getWebSockets()
      .find((ws) => readConnection(ws)?.userId === userId && readConnection(ws)?.ready === true);
  }

  private writeConnection(ws: WebSocket, connection: ConnectionState): void {
    ws.serializeAttachment(connection satisfies ConnectionState);
  }

  /**
   * 每次连接建立时更新 `last_seen_at`（归属释放的依据）。
   * **不随心跳更新**——那是写放大；断开时的更新在宽限处理里做（避免每抖动一次写一行）。
   */
  private touchLastSeen(userId: string): void {
    this.ctx.storage.sql.exec('UPDATE bed SET last_seen_at = ? WHERE owner_user_id = ?', Date.now(), userId);
  }

  /**
   * 断线：从移动者集合同步移除（三个移除来源之一：路径走完 / 断线 / 被新意图取代）。
   * 位置与目标是连接附加数据上的东西，连接销毁后就读不到了——宽限会话的抄写在后续卡片接上。
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const connection = readConnection(ws);
    if (!connection) return;
    this.stopWalking(connection.userId);
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

    // 我自己的床（归属）：走唯一索引取一行——客户端走路时也要知道哪张床是我的
    const myOwnedBedNo = sql
      .exec<{ bed_no: number }>('SELECT bed_no FROM bed WHERE owner_user_id = ?', me.userId)
      .toArray()[0]?.bed_no ?? null;

    return buildSnapshot({
      hall: this.hall,
      serverTs: Date.now(),
      online,
      me,
      myOwnedBedNo,
      others,
      ownedBeds,
      traceRows,
    });
  }
}

function readConnection(ws: WebSocket): ConnectionState | null {
  const attachment = ws.deserializeAttachment();
  return attachment ? (attachment as ConnectionState) : null;
}

/** 朝向：0 下 / 1 左 / 2 上 / 3 右（与 `docs/api/20-api-ws.md` §3.1 一致）。 */
function facingFrom(fromX: number, fromY: number, to: Tile): Facing {
  if (to.x > fromX) return 3;
  if (to.x < fromX) return 1;
  if (to.y > fromY) return 0;
  return 2;
}

function decodeName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
