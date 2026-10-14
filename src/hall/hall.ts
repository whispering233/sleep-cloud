import { DurableObject } from 'cloudflare:workers';

import { findHall } from '../shared/hall-registry';
import type { HallConfig } from '../shared/hall-registry';
import type { ErrorCode } from '../shared/error-code';
import type { DownstreamMessage, ErrorMessage, Facing, SnapshotMessage, UpstreamMessage } from '../shared/protocol';
import type { Env } from '../worker/env';
import { AUTO_SLEEP_MS, GRACE_MS, MOVE_MS_PER_TILE, TICK_MS } from '../shared/constants';
import { appearanceFor, deriveDisplayState, guardIncoming, IDENTITY_HEADERS, personFromConnection } from './connection';
import type { ConnectionState } from './connection';
import { lieVerdictFor } from './bed-rules';
import { clearBed, findTraceBed, listOccupiedBeds, putInBed, readBed, restoreBedOccupancy, setBedOccupancy } from './bed-store';
import { graceVerdict } from './grace';
import type { GraceSession } from './grace';
import { advanceMover } from './movement';
import type { MoverState } from './movement';
import { findPath } from './pathfinding';
import type { Tile } from './pathfinding';
import { BED_INDEX_SQL, BED_SEED_SQL, BED_TABLE_SQL } from './schema';
import { loadScene } from './scene';
import type { SceneGrid } from './scene';
import { createDueHeap } from './scheduler';
import type { DueEvent } from './scheduler';
import { buildSnapshot, splitLive } from './snapshot';
import type { OfflineOccupantRow } from './snapshot';

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

  /**
   * 宽限中的会话（只放内存）：关连接那一刻把位置与目标整份抄下来，期内重连用它恢复。
   * 记录丢了只影响「重连时位置还在」这条尽力而为的优化——床上的人由床位行推导兜底
   * （`state` + `last_seen_at` + 无活连接），所以睡痕不会漏。
   */
  private readonly grace = new Map<string, GraceSession>();

  /**
   * 到期事件堆（内存最小堆，见 `docs/design/10-hall-runtime.md` §4.4）。
   * 平台只给一个持久唤醒槽位，堆顶就是该写进槽位的时刻。
   */
  private readonly due = createDueHeap();

  /** 唤醒后是否已经从当前连接集合与床位状态重建过事件堆（第一个事件里才做，见 `ensureSchedule`） */
  private scheduled = false;

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
      lastInputAt: Date.now(),
      ready: false,
    } satisfies ConnectionState);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const connection = readConnection(ws);
    if (!connection || typeof raw !== 'string') return;
    this.ensureSchedule();

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
        const graced = this.takeGrace(connection.userId);
        const ready: ConnectionState = { ...this.resumeSession(connection, graced), ready: true };
        // 一个人同时只保留最新的一条连接（同一个人开两个标签页时，旧的会被顶掉）
        this.replaceOlderConnections(ws, ready.userId);
        ws.serializeAttachment(ready satisfies ConnectionState);
        this.touchLastSeen(ready.userId);
        // 宽限恢复可能带回没走完的路径（没有移动者时不会起循环）
        this.startTicking();
        // 宽限记录用掉了（或压根没在宽限里）；在床上的人重新排上「自动睡着」
        this.due.remove('grace', ready.userId);
        this.armAutoSleep(ready);
        ws.send(JSON.stringify(await this.snapshotFor(ws, ready)));
        // 入厅广播：只发给**别人**（自己在自己的快照里，people 里不放自己）
        this.broadcastExcept(ws, { t: 'join', ...personFromConnection(ready) });
        return;
      }
    }
  }

  /**
   * 同一个用户同时只保留最新的一条连接。
   *
   * 一个人 = 一张床 = 一份状态，两条连接会各自带一份附加数据：不顶掉旧的话，
   * 旧连接上残留的目标会被重建回移动者集合（已经躺下的人又被推着走），
   * `people` 里也会出现同一个 id 的两条条目。
   */
  private replaceOlderConnections(keep: WebSocket, userId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === keep) continue;
      const connection = readConnection(ws);
      if (connection?.userId !== userId) continue;
      this.stopWalking(userId);
      ws.close(1000, 'replaced');
    }
  }

  /** 取走宽限记录（有则删掉并返回）：宽限期内重连用它恢复原位置与原状态。 */
  private takeGrace(userId: string): GraceSession | undefined {
    const record = this.grace.get(userId);
    if (record) this.grace.delete(userId);
    // 过期的记录不能用：对象可能很久没有活动，没谁来触发清理
    return record && record.expiresAt > Date.now() ? record : undefined;
  }

  /**
   * 握手时的状态恢复（见 `docs/design/10-hall-runtime.md` §11）：
   * 宽限期内 → 原位置、原路径、原床位（对外表现为无变化，因此不广播）；
   * 宽限已过、而那张床还留着我的睡痕 → 回到床上（清醒）；
   * 否则从头开始（入口、漫游）。
   */
  private resumeSession(connection: ConnectionState, graced: GraceSession | undefined): ConnectionState {
    if (graced) return graced.connection;

    const bedNo = findTraceBed(this.ctx.storage.sql, connection.userId);
    if (bedNo === undefined) return connection;

    const now = Date.now();
    restoreBedOccupancy(this.ctx.storage.sql, {
      bedNo,
      name: connection.name,
      appearance: connection.appearance,
      timezone: connection.timezone,
      now,
    });
    const position = this.grid.bedPosition(bedNo) ?? { x: connection.x, y: connection.y };
    const lying: ConnectionState = {
      ...connection,
      state: 'lying',
      bedNo,
      x: position.x,
      y: position.y,
      lastInputAt: now,
    };
    // 自己这条连接还没握手完成（收不到广播），但别人得知道睡痕醒了
    this.broadcastState(lying);
    return lying;
  }

  private reject(ws: WebSocket, code: ErrorCode): void {
    ws.send(JSON.stringify({ t: 'error', code } satisfies ErrorMessage));
    ws.close(1000, code);
  }

  /** 静默类错误：只回错误码，不断开，也不提示（客户端点了墙面属于正常误触）。 */
  private sendError(ws: WebSocket, code: ErrorCode): void {
    ws.send(JSON.stringify({ t: 'error', code } satisfies ErrorMessage));
  }

  /** 上行只表达意图；每条意图都会刷新「最后输入时刻」（自动睡着由它推导）。 */
  private handleIntent(ws: WebSocket, connection: ConnectionState, message: UpstreamMessage): void {
    const now = Date.now();
    const fresh: ConnectionState = { ...connection, lastInputAt: now };
    this.writeConnection(ws, fresh);
    this.armAutoSleep(fresh); // 输入刷新了「自动睡着」的到期时刻
    this.refreshDerivedStates();

    switch (message.t) {
      case 'walk': {
        const x = Number(message.x);
        const y = Number(message.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.grid.isWalkable(x, y)) {
          this.sendError(ws, '3006');
          return;
        }
        // 在床上点地面 = 起身 + 走过去（一条命令完成，少点一次）
        const standing = this.standUp(ws, fresh);
        this.startWalking(ws, standing, { x, y });
        return;
      }
      case 'lie': {
        const bedNo = Number(message.bedNo);
        const verdict = lieVerdictFor({
          bedNo,
          capacity: this.hall.capacity,
          inBed: fresh.state !== 'roaming',
          userId: fresh.userId,
          bed: Number.isInteger(bedNo) ? readBed(this.ctx.storage.sql, bedNo) : undefined,
        });
        if (!verdict.ok) {
          this.sendError(ws, verdict.code);
          return;
        }
        this.approachBed(ws, fresh, bedNo);
        return;
      }
      case 'rise':
        if (fresh.state === 'roaming') this.sendError(ws, '3005');
        else this.standUp(ws, fresh);
        return;
      case 'sleep':
        if (fresh.state !== 'lying') {
          this.sendError(ws, fresh.state === 'roaming' ? '3005' : '3004');
          return;
        }
        this.fallAsleep(ws, fresh);
        return;
      case 'chat':
      case 'whisper':
      case 'emote':
        // 睡着时说话或发表情：**自动醒**后处理，不报错（消息本身在后续卡片接上）
        if (fresh.state === 'asleep') this.wakeUp(ws, fresh);
        return;
      default:
        return;
    }
  }

  /**
   * 走到床边再躺下（复合意图）：站在床边就直接躺，否则把「到达后动作」挂在路径上。
   */
  private approachBed(ws: WebSocket, connection: ConnectionState, bedNo: number): void {
    const spot = this.standSpotFor(bedNo, { x: connection.x, y: connection.y });
    if (!spot) {
      this.sendError(ws, '3006'); // 床四周没有可站的格（配置问题）
      return;
    }

    if (spot.x === connection.x && spot.y === connection.y) {
      this.lieDown(ws, connection, bedNo);
      return;
    }

    const path = findPath(this.grid, { x: connection.x, y: connection.y }, spot);
    if (!path || path.length === 0) {
      this.sendError(ws, '3006');
      return;
    }

    this.movers.set(connection.userId, {
      mover: { x: connection.x, y: connection.y, path, legElapsedMs: 0 },
      facing: facingFrom(connection.x, connection.y, path[0] as Tile),
    });
    this.writeConnection(ws, { ...connection, target: spot, arrivalAction: 'lie', arrivalBedNo: bedNo });
    this.startTicking();
  }

  /** 床四周最近的、可达的站立格（床格本身不可行走）。 */
  private standSpotFor(bedNo: number, from: Tile): Tile | undefined {
    const position = this.grid.bedPosition(bedNo);
    if (!position) return undefined;

    let best: { tile: Tile; length: number } | undefined;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Array<[number, number]>) {
      const tile = { x: position.x + dx, y: position.y + dy };
      if (!this.grid.isWalkable(tile.x, tile.y)) continue;
      const path = findPath(this.grid, from, tile);
      if (!path) continue;
      if (!best || path.length < best.length) best = { tile, length: path.length };
    }
    return best?.tile;
  }

  /** 真的躺下：再次校验（走路期间床可能被别人占了），写库，然后**先发归属再发占用**。 */
  private lieDown(ws: WebSocket, connection: ConnectionState, bedNo: number): void {
    const now = Date.now();
    const verdict = lieVerdictFor({
      bedNo,
      capacity: this.hall.capacity,
      inBed: connection.state !== 'roaming',
      userId: connection.userId,
      bed: readBed(this.ctx.storage.sql, bedNo),
    });
    if (!verdict.ok) {
      this.sendError(ws, verdict.code);
      return;
    }

    putInBed(this.ctx.storage.sql, {
      bedNo,
      userId: connection.userId,
      name: connection.name,
      appearance: connection.appearance,
      timezone: connection.timezone,
      now,
      claiming: verdict.claiming,
    });

    const lying: ConnectionState = {
      ...connection,
      state: 'lying',
      bedNo,
      target: undefined,
      arrivalAction: undefined,
      arrivalBedNo: undefined,
      lastInputAt: now,
    };
    this.writeConnection(ws, lying);
    this.armAutoSleep(lying);

    // 顺序有讲究：先归属后占用，否则客户端会短暂渲染出「床有人、但不在归属表里」
    if (verdict.claiming) this.broadcast({ t: 'bed', bedNo, owned: true });
    this.broadcastState(lying);
  }

  /** 起身：释放占用、**保留归属**，站在床边。 */
  private standUp(ws: WebSocket, connection: ConnectionState): ConnectionState {
    if (connection.state === 'roaming') return connection;

    const now = Date.now();
    if (connection.bedNo !== undefined) clearBed(this.ctx.storage.sql, connection.bedNo, now);
    const roaming: ConnectionState = { ...connection, state: 'roaming', bedNo: undefined, lastInputAt: now };
    this.writeConnection(ws, roaming);
    this.armAutoSleep(roaming);
    this.broadcastState(roaming);
    return roaming;
  }

  /** 手动睡着。 */
  private fallAsleep(ws: WebSocket, connection: ConnectionState): void {
    const now = Date.now();
    if (connection.bedNo !== undefined) setBedOccupancy(this.ctx.storage.sql, connection.bedNo, 'asleep', now);
    const asleep: ConnectionState = { ...connection, state: 'asleep', lastInputAt: now };
    this.writeConnection(ws, asleep);
    this.armAutoSleep(asleep);
    this.broadcastState(asleep);
  }

  /** 睡着时说话：先醒过来（清醒度是「在床上」的一个维度，位置不变）。 */
  private wakeUp(ws: WebSocket, connection: ConnectionState): void {
    const now = Date.now();
    if (connection.bedNo !== undefined) setBedOccupancy(this.ctx.storage.sql, connection.bedNo, 'lying', now);
    const awake: ConnectionState = { ...connection, state: 'lying', lastInputAt: now };
    this.writeConnection(ws, awake);
    this.armAutoSleep(awake);
    this.broadcastState(awake);
  }

  /** 某人的显示态变化：发给所有人（**包括本人**——自己的 `me` 也要跟着变）。 */
  private broadcastState(connection: ConnectionState): void {
    this.broadcast({ t: 'state', id: connection.userId, ...placementOf(connection) });
  }

  /**
   * 读取时推导：把已经该睡着的人翻过去（正确性来自推导，定时器只负责及时通知，见 §4.3）。
   * 这里顺手把库里的占用状态也跟上——推导出来的事实同样要落库。
   */
  private refreshDerivedStates(): void {
    const now = Date.now();
    let changed = false;
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready) continue;
      const derived = deriveDisplayState(connection, now, AUTO_SLEEP_MS);
      if (derived === connection.state) continue;

      const next: ConnectionState = { ...connection, state: derived };
      this.writeConnection(ws, next);
      // 已经睡着的人不需要「自动睡着」到期事件了
      if (derived === 'asleep') this.due.remove('autosleep', connection.userId);
      if (next.bedNo !== undefined) setBedOccupancy(this.ctx.storage.sql, next.bedNo, derived === 'asleep' ? 'asleep' : 'lying', now);
      this.broadcastState(next);
      changed = true;
    }
    if (changed) this.syncAlarm();
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
    this.ensureMovers();
    if (this.movers.size === 0) return; // 没有移动者就不该有循环（有循环对象就无法休眠）
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
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
    this.refreshDerivedStates();
    const elapsed = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;

    const updates: Array<[string, number, number, Facing]> = [];
    const arrived: Array<{ ws: WebSocket; connection: ConnectionState }> = [];

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
        this.movers.delete(userId);
        if (connection) arrived.push({ ws, connection: { ...connection, target: undefined } });
      }
    }

    // 顺序：**位置先于状态**。同一个节拍里最后一步的位置要排在「我躺下了」前面，
    // 否则客户端会先看到状态变化、再收到一条对已经躺下的人的位置更新。
    if (updates.length > 0) {
      this.broadcast({ t: 'pos', ts: now, items: updates });
    }
    for (const item of arrived) {
      if (item.connection.arrivalAction === 'lie' && item.connection.arrivalBedNo !== undefined) {
        this.lieDown(item.ws, item.connection, item.connection.arrivalBedNo);
      } else {
        this.writeConnection(item.ws, item.connection);
      }
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

  /** 除了某个连接之外的所有在线者（入厅广播用：自己不需要收到自己的 join）。 */
  private broadcastExcept(except: WebSocket, message: DownstreamMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if (readConnection(ws)?.ready) ws.send(payload);
    }
  }

  /**
   * 按用户标识找**活着的**连接（`except` 用于「除这条之外还有没有」，比如刚关掉的那一条自己）。
   * 平台的 `getWebSockets()` 在关闭事件里仍会列出这条正在关闭的连接，不排除它就会把自己也算成在线。
   */
  private socketOf(userId: string, except?: WebSocket): WebSocket | undefined {
    return this.ctx
      .getWebSockets()
      .find(
        (ws) =>
          ws !== except && readConnection(ws)?.userId === userId && readConnection(ws)?.ready === true,
      );
  }

  private writeConnection(ws: WebSocket, connection: ConnectionState): void {
    ws.serializeAttachment(connection satisfies ConnectionState);
  }

  /**
   * 每次连接建立时更新 `last_seen_at`（归属释放的依据，也是宽限推导的「最后在线时刻」）。
   * **不随心跳更新**——那是写放大；断开时的更新在宽限处理里做（避免每抖动一次写一行）。
   * 时刻由调用方给：关连接时它必须与写进事件堆的那个时刻**完全一致**，否则闹钟会早响几毫秒。
   */
  private touchLastSeen(userId: string, now = Date.now()): void {
    this.ctx.storage.sql.exec('UPDATE bed SET last_seen_at = ? WHERE owner_user_id = ?', now, userId);
  }

  /**
   * 断线：**同一步**完成四件事——移出移动者集合、（在地上则）立刻广播 `leave`、
   * 把位置与移动目标搬进宽限记录、起宽限计时（见 `docs/design/10-hall-runtime.md` §6）。
   *
   * **在地上的人不等宽限**：他没有床位行这种持久真相，而宽限记录在对象休眠时就没了，
   * 所以「延后消失」这件事根本兑现不了；宽限对他只买「期内重连、位置还在」这个尽力而为的优化。
   * 在床上的人相反：不发 `leave`，等宽限到期后由床位行推导转成睡痕。
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const connection = readConnection(ws);
    if (!connection?.ready) return;
    this.ensureSchedule();
    // 被新连接顶掉的旧连接：状态已经归新会话了，这里再动就会把新会话的路径删掉
    if (this.socketOf(connection.userId, ws)) return;

    const now = Date.now();
    this.stopWalking(connection.userId);
    this.due.remove('autosleep', connection.userId); // 人已经不在线，「该不该睡着」不再适用于他
    if (connection.bedNo === undefined) {
      this.broadcast({ t: 'leave', id: connection.userId });
    } else {
      // 在床上：不发 leave，等宽限到期后由床位行推导转成睡痕
      this.due.upsert({ kind: 'grace', userId: connection.userId, at: now + GRACE_MS });
    }
    this.grace.set(connection.userId, { connection, expiresAt: now + GRACE_MS });
    this.touchLastSeen(connection.userId, now); // 与事件时刻同源：推导算出来的到期时刻与堆里的一致
    this.syncAlarm();
  }

  /**
   * 宽限到期处理，**两条来源**（见 `docs/design/10-hall-runtime.md` §4.3）：
   * 内存记录（丢了只影响重连时的位置恢复）与床位行推导（丢了就会漏掉睡痕，因此它是权威）。
   *
   * 返回仍在宽限期内、人已离线的床上占用者——他们还得留在别人的 `people` 里（睡痕还没到）。
   */
  private expireGrace(): OfflineOccupantRow[] {
    const now = Date.now();
    const live = this.liveUserIds();
    const waiting: OfflineOccupantRow[] = [];

    for (const row of listOccupiedBeds(this.ctx.storage.sql)) {
      const verdict = graceVerdict(row, live, now);
      if (verdict === 'online') continue;
      if (verdict === 'waiting') {
        waiting.push({
          bedNo: row.bedNo,
          state: row.state,
          userId: row.ownerUserId,
          name: row.ownerName,
          appearance: row.ownerAppearance,
        });
        // 推导同时负责排期：认准这个到期时刻（时刻与关连接时写的一致，因此不会多写一次槽位）
        if (row.lastSeenAt !== null) {
          this.due.upsert({ kind: 'grace', userId: row.ownerUserId, at: row.lastSeenAt + GRACE_MS });
        }
        continue;
      }
      this.markTrace(row.bedNo, row.ownerUserId); // 在床上 → 睡痕，**不发 leave**
    }

    // 宽限记录只买「重连时位置还在」：到期的**不需要广播任何东西**——在地上的人一断线就发过 `leave` 了，
    // 在床上的人由上面的床位行推导处理。这里只负责把它丢掉。
    for (const [userId, record] of [...this.grace]) {
      if (live.has(userId) || record.expiresAt <= now) this.grace.delete(userId);
    }

    return waiting;
  }

  /** 变成睡痕：库里记上，再广播显示态（名字与轮廓由客户端按 `trace` 变暗）。 */
  private markTrace(bedNo: number, userId: string): void {
    setBedOccupancy(this.ctx.storage.sql, bedNo, 'trace', Date.now());
    this.broadcast({ t: 'state', id: userId, state: 'trace', bedNo });
  }

  /** 在线的用户标识（只算握过手的连接）：问「这个人还在不在线」用。 */
  private liveUserIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (connection?.ready) ids.add(connection.userId);
    }
    return ids;
  }

  /** 躺在床上的人有个「自动睡着」到期事件；其余人没有（已睡着、已起身、已离线都不需要它）。 */
  private autoSleepEvent(connection: ConnectionState): DueEvent | null {
    return connection.state === 'lying'
      ? { kind: 'autosleep', userId: connection.userId, at: connection.lastInputAt + AUTO_SLEEP_MS }
      : null;
  }

  /** 让某人的「自动睡着」事件与他的当前状态一致（每次输入都会把它顺延）。 */
  private armAutoSleep(connection: ConnectionState): void {
    const event = this.autoSleepEvent(connection);
    if (event) this.due.upsert(event);
    else this.due.remove('autosleep', connection.userId);
    this.syncAlarm();
  }

  /**
   * 唤醒后重建到期事件堆，并与平台上已有的槽位对账（见 `10-hall-runtime.md` §3 步 4）。
   *
   * **不能在构造函数里做**：对象被唤醒时构造函数先于 `alarm()` 运行，那时写槽位会把平台刚排好的
   * 下一次唤醒盖掉。所以放在第一个事件里（每个事件入口都调用，但只真正执行一次）。
   * 已经过期的条目直接丢掉——到期事件只是通知手段，该做的事每个入口都会按推导扫一遍（§4.3）。
   */
  private ensureSchedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    this.due.clear();
    const live = this.liveUserIds();
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready) continue;
      const event = this.autoSleepEvent(connection);
      if (event) this.due.upsert(event);
    }
    // 床上但人已离线的人：宽限到期必须发生（上一个实例可能已经把内存里的宽限记录丢了）
    for (const row of listOccupiedBeds(this.ctx.storage.sql)) {
      if (live.has(row.ownerUserId)) continue;
      this.due.upsert({
        kind: 'grace',
        userId: row.ownerUserId,
        at: (row.lastSeenAt ?? Date.now()) + GRACE_MS,
      });
    }
    // 重建出来的事件可能已经过期（对象睡过了头）→ 当场执行，而不是丢掉
    this.runDueEvents();
    // 重建可能给堆里填了未来事件（而槽位可能是空的或停在上一个实例的时刻）→ 与平台对账
    this.syncAlarm();
  }

  /** 弹出所有到期事件并执行。到期事件只是扳机，真正的判定仍是推导（§4.3），所以按类型各扫一遍。 */
  private runDueEvents(): void {
    const due = this.due.drainDue(Date.now());
    if (due.some((event) => event.kind === 'grace')) this.expireGrace();
    if (due.some((event) => event.kind === 'autosleep')) this.refreshDerivedStates();
  }

  /**
   * 与平台槽位对账：堆顶变了才写（每次 `setAlarm()` 都是一行写入，重复写等于自己给自己涨费用）。
   * **不 await**：及时性不是正确性（§4.3），慢一拍不影响任何状态；失败只留日志。
   */
  private syncAlarm(): void {
    void this.armAlarm().catch((error) => console.error('唤醒槽位对账失败：', error));
  }

  private async armAlarm(): Promise<void> {
    const next = this.due.peek()?.at ?? null;
    const existing = await this.ctx.storage.getAlarm();
    if (next === null) {
      if (existing !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (existing === next) return;
    await this.ctx.storage.setAlarm(next);
  }

  /**
   * 到期事件处理器（见 `10-hall-runtime.md` §4.4）：弹出到期事件 → 按类型各扫一遍推导 → 对账下一个槽位。
   * 处理器内不残留任何内存定时器（位置节拍只在有移动者时存在，见 §4.5）。
   */
  async alarm(): Promise<void> {
    this.ensureSchedule(); // 唤醒后重建事件堆（重建出来的过期事件当场执行）
    this.runDueEvents(); // 兜住刚跨过阈值的那几个（重建与本行之间可能刚好到点）
    await this.armAlarm();
  }

  /** 全量快照：在线连接来自内存，**睡痕与宽限中的床上离线者只能查库**（人已离线，内存里没有他）。 */
  private async snapshotFor(ws: WebSocket, me: ConnectionState): Promise<SnapshotMessage> {
    this.refreshDerivedStates();
    // 顺手把到期的宽限处理掉（睡痕与 leave 都要及时发出），并取回还在宽限里的床上离线者
    const offlineOccupants = this.expireGrace();
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
      offlineOccupants,
      traceRows,
    });
  }
}

function readConnection(ws: WebSocket): ConnectionState | null {
  const attachment = ws.deserializeAttachment();
  return attachment ? (attachment as ConnectionState) : null;
}

/** 连接状态 → 协议里的「人在哪」（在床上带床号，否则带坐标）。 */
function placementOf(connection: ConnectionState): { state: 'roaming'; x: number; y: number } | { state: 'lying' | 'asleep'; bedNo: number } {
  return connection.state === 'roaming' || connection.bedNo === undefined
    ? { state: 'roaming', x: connection.x, y: connection.y }
    : { state: connection.state, bedNo: connection.bedNo };
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
