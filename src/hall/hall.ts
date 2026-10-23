import { DurableObject } from 'cloudflare:workers';

import {
  AUTO_SLEEP_MS,
  CHAT_MAX_LEN,
  FEEDBACK_MAX_LEN,
  GRACE_MS,
  HALL_ID,
  REPORT_EVIDENCE_MAX,
  REPORT_REASON_MAX_LEN,
  TICK_MS,
  UPSTREAM_RATE_PER_SEC,
} from '../shared/constants';
import type { MaskHits } from '../shared/content-filter';
import type { ErrorCode } from '../shared/error-code';
import { HALL_LEVELS, LAYOUT_VERSION, frontPointOf, isWalkable, levelIndexOfBedCount } from '../shared/layout';
import type { Point } from '../shared/layout';
import * as log from '../shared/log';
import type {
  DownstreamMessage,
  ErrorMessage,
  PongMessage,
  SnapshotMessage,
  UpstreamMessage,
  UpstreamType,
  WhisperMessage,
} from '../shared/protocol';
import type { Env } from '../worker/env';
import { ADMIN_HEADER, handleAdminRequest } from './admin';
import type { LiveConnection } from './admin';
import { checkLie } from './bed-rules';
import {
  clearBed,
  findOccupiedBedByOwner,
  findOwnedBed,
  listExpiredOwnerships,
  listOccupiedBeds,
  listOwnedBeds,
  listTraceBeds,
  outerRingBusy,
  putInBed,
  readBed,
  readMeta,
  releaseExpiredOwnerships,
  restoreBedOccupancy,
  setBedOccupancy,
  smallestClaimableBed,
  usedBedCount,
  writeBedCount,
  writeDailyWakeAt,
} from './bed-store';
import { chatVerdictFor } from './chat';
import {
  appearanceFromHeader,
  deriveDisplayState,
  guardIncoming,
  IDENTITY_HEADERS,
  personFromConnection,
  recoverForShrink,
  recoveredPosition,
  retarget,
} from './connection';
import type { ConnectionState } from './connection';
import { nextDailyWakeAt, previousDailyWakeAt, shouldSettleDaily } from './daily';
import { purgeExpiredFeedback, recordFeedback } from './feedback';
import { graceVerdict } from './grace';
import { isHallFull, nextLevelCapacity, previousLevelCapacity } from './level-rules';
import { advanceMover } from '../shared/movement';
import type { MoverState } from '../shared/movement';
import { findPath } from '../shared/pathfinding';
import { consumeUpstream } from './rate-limit';
import { purgeExpiredReports, recordReport } from './report';
import type { ReportEvidence } from './report';
import { blockStateOf, findIdentity, forgetStaleSources, purgeExpiredAudit, purgeExpiredBlocks, recordIdentity } from './risk';
import type { EntrySource } from './risk';
import {
  ADMIN_AUDIT_TABLE_SQL,
  BED_INDEX_SQL,
  BED_TABLE_SQL,
  BLOCK_TABLE_SQL,
  FEEDBACK_INDEX_SQL,
  FEEDBACK_TABLE_SQL,
  IDENTITY_INDEX_SQL,
  IDENTITY_TABLE_SQL,
  META_TABLE_SQL,
  REPORT_INDEX_SQL,
  REPORT_TABLE_SQL,
} from './schema';
import { createDueHeap } from './scheduler';
import type { DueEvent } from './scheduler';
import { buildSnapshot, onlineCountOf, splitLive } from './snapshot';
import type { OfflineOccupantRow } from './snapshot';

/** 一条位置条目（`pos.items` 的一个元素）：`[用户id, x, y]`，坐标是世界像素。 */
type PositionUpdate = [string, number, number];

/**
 * `tick` 的拍子（`100-log.md` §3：每 5 分钟一条）：**与位置节拍的 `TICK_MS` 不是一个量**，
 * 所以是另一条独立的内存循环，只在厅里有连接时存在。
 */
const TICK_LOG_MS = 5 * 60_000;

/**
 * 大厅房间服务：**一个厅一个实例**（`idFromName(HALL_ID)`），自带一份私有 SQLite。
 * **厅的边界就是数据库的边界**，所有权威状态在同址，读写都是本地操作。
 *
 * 布局（床位坐标、可行走性、区域尺寸）由共享的纯函数现算，**不存任何地方**（见 `docs/design/20-layout.md` §4）。
 * 连接使用平台的 WebSocket 休眠机制：连接期间对象可以休眠，附加数据（位置、状态）随连接存活。
 */
export class Hall extends DurableObject<Env> {
  /**
   * 移动者集合（内存工作集，不落库）：有未走完路径的人。
   * 它是内存循环的工作集，而「有移动者 ⇒ 有循环 ⇒ 对象无法休眠」保证它不会被驱逐（见 `10-hall-runtime.md` §5.3）。
   */
  private readonly movers = new Map<string, MoverState>();
  /**
   * 每个移动者的起步时刻（与 `movers` 同生共死）：推进量只从它起算，
   * 节拍已在跑时新起步的人不会被按「上一拍到现在」整段推进（见 `30-movement-sync.md` §5.2）。
   */
  private readonly moverStartedAt = new Map<string, number>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;

  /**
   * `tick` 事件的内存循环（与位置节拍那条**分开**）：`hello` 成功时起、最后一条连接关闭时清除。
   * 有循环对象就无法休眠，所以「没有连接时必须不存在」是硬要求（`AGENTS.md` 硬纪律 6）。
   */
  private tickLogTimer: ReturnType<typeof setInterval> | null = null;

  /**
  /**
   * 发言缓冲（**厅实例的内存**，驱逐即丢）：每人最近 `REPORT_EVIDENCE_MAX` 条自己发出的文本，
   * 只装**打码后的那一份**（与广播出去的逐字一致）。**不放连接附加数据**——附加数据要跨休眠存活，
   * 放它上面等于把聊天内容持久化了（见 `docs/design/10-hall-runtime.md` §10.1）。
   */
  private readonly speech = new Map<string, ReportEvidence[]>();

  /**
   * 到期事件堆（内存最小堆，见 `docs/design/10-hall-runtime.md` §4.4）。
   * 平台只给一个持久唤醒槽位，堆顶就是该写进槽位的时刻。
   */
  private readonly due = createDueHeap();

  /** 唤醒后是否已经从当前连接集合与床位状态重建过事件堆（第一个事件里才做，见 `ensureSchedule`） */
  private scheduled = false;

  /** 当前床位数（`meta.bed_count`）：升降级与命中判定每次都要用，缓存一份，写回时同步失效 */
  private bedCountCache: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.id.name !== HALL_ID) throw new Error(`不认识的厅标识：${ctx.id.name ?? '(无名)'}（只有一个厅）`);
    this.initializeStorage();
  }

  /** 建表（幂等）。**不预建任何床位行**：无行 = 无主空床，行只在认领/占用时诞生。 */
  private initializeStorage(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(BED_TABLE_SQL);
    for (const statement of BED_INDEX_SQL) sql.exec(statement);
    sql.exec(META_TABLE_SQL);
    sql.exec(IDENTITY_TABLE_SQL);
    try {
      // 已部署的库不会被 `CREATE TABLE IF NOT EXISTS` 改动：新列得在表后面补一次。
      // 重复加列是一种错误（`duplicate column name`），真语法错也会被这里吞掉——靠单测钉住列真的可读可写。
      sql.exec('ALTER TABLE identity ADD COLUMN nickname TEXT');
    } catch {
      // 列已经在了
    }
    for (const statement of IDENTITY_INDEX_SQL) sql.exec(statement);
    sql.exec(BLOCK_TABLE_SQL);
    sql.exec(ADMIN_AUDIT_TABLE_SQL);
    sql.exec(REPORT_TABLE_SQL);
    for (const statement of REPORT_INDEX_SQL) sql.exec(statement);
    sql.exec(FEEDBACK_TABLE_SQL);
    for (const statement of FEEDBACK_INDEX_SQL) sql.exec(statement);
  }

  /** 当前床位数（读 `meta` + 内存缓存）。 */
  private bedCount(): number {
    return (this.bedCountCache ??= readMeta(this.ctx.storage.sql).bedCount);
  }

  /**
   * 已用床数（有主或有占用）：“还有没有可认领的床”就是「已用床数 < 本档容量」。
   * 与出生点同一个谓词、同一次全表读（`10-hall-runtime.md` §8）。
   */
  private usedBeds(now: number): number {
    return usedBedCount(this.ctx.storage.sql, now);
  }

  /** 「有没有可认领的床」＝**已用床数 < 本档容量**：无行 = 无主空床，过期归属也算无主。 */
  private hasClaimableBed(now: number): boolean {
    return this.usedBeds(now) < this.bedCount();
  }

  /**
   * 入场前的判定（见 `docs/api/10-api-http.md`、`docs/design/70-privacy-risk.md` §5.2）：
   * 「厅满」与「封禁」合并成**同一次调用**——这是入场前唯一的判定点，多开一处就会漂成两个结论。
   * `blocked` 为 `null` = 没被封；命中时 `untilAt` 为 `null` = 永久。
   */
  async entryStatus(
    source: EntrySource,
  ): Promise<{ bedCount: number; full: boolean; blocked: { untilAt: number | null } | null }> {
    const bedCount = this.bedCount();
    const now = Date.now();
    const blocked = blockStateOf(this.ctx.storage.sql, source, now);
    return {
      bedCount,
      full: isHallFull(bedCount, this.hasClaimableBed(now)),
      blocked: blocked && { untilAt: blocked.untilAt },
    };
  }

  /** WebSocket 升级由 Worker 转发进来（前置校验已在 Worker 完成）。 */
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      // 后台数据接口：只有 Worker 会带这个内部头。没有它的 `/admin/*` 一律 404——
      // 客户端本来就到不了厅对象，这里是显式拒绝而不是默认放行。
      //
      // **第二道闸的强度全在路径前缀上**（头值 `'1'` 是公开常量）：真正的边界是「只有已鉴权的转发
      // 才会把 `/api/admin/*` 改写成 `/admin/*` 并注入这个头」。因此**任何将来的新转发路由都必须
      // 先过 Worker 鉴权再改写路径**，否则这道闸等于全开（见 `docs/api/30-api-admin.md` §1）。
      if (url.pathname.startsWith('/admin/')) {
        if (request.headers.get(ADMIN_HEADER) !== '1') return new Response('没有这个入口', { status: 404 });
        return handleAdminRequest(request, url, { sql: this.ctx.storage.sql, live: this.liveConnections() });
      }

      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('这个入口只接受 WebSocket 升级', { status: 426 });
      }

      const userId = request.headers.get(IDENTITY_HEADERS.userId);
      const name = decodeName(request.headers.get(IDENTITY_HEADERS.name));
      if (!userId || !name) return new Response('缺少连接身份', { status: 400 });
      const appearance = appearanceFromHeader(request.headers.get(IDENTITY_HEADERS.appearance), userId);
      // 来源三项由 Worker 依据平台信息写入，客户端伪造的同名头在 Worker 那边已被覆盖或删除
      const ip = request.headers.get(IDENTITY_HEADERS.ip) ?? undefined;
      const country = request.headers.get(IDENTITY_HEADERS.country) ?? undefined;
      const uaHash = request.headers.get(IDENTITY_HEADERS.uaHash) ?? undefined;

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        userId,
        name,
        appearance,
        ip,
        country,
        uaHash,
        // 位置在握手时定（出生点 / 宽限恢复 / 从睡痕醒来都要查库），这里先给一个合法的占位点
        x: frontPointOf(0)?.x ?? 0,
        y: frontPointOf(0)?.y ?? 0,
        state: 'roaming',
        lastInputAt: Date.now(),
        ready: false,
      } satisfies ConnectionState);

      return new Response(null, { status: 101, webSocket: client });
    } catch (error) {
      // 只多一条 `err`，然后**照旧抛**：失败形态由 Worker 的 `onError` 决定（那里会回 9001 的 JSON），
      // 换成在这里回一个自己的 500，客户端拿到的就从 JSON 变成 text/plain（见 `src/worker/app.ts`）。
      log.err({ where: 'do-fetch', code: '9001' });
      throw error;
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      const connection = readConnection(ws);
      if (!connection || typeof raw !== 'string') return;
      this.ensureSchedule();

      const verdict = guardIncoming(connection, raw, LAYOUT_VERSION);
      switch (verdict.kind) {
        case 'ignore':
          return;
        case 'business':
          this.handleIntent(ws, connection, verdict.message);
          return;
        case 'reject':
          this.reject(ws, verdict.code, 'hello');
          return;
        case 'hello': {
          // **封禁判定排在最前**：先拒，再谈升级与宽限恢复——否则被封的人会因为一次握手让厅多长一级、
          // 或多写几行床位状态（见 `docs/api/20-api-ws.md` §2）。
          const now = Date.now();
          const blocked = blockStateOf(this.ctx.storage.sql, connection, now);
          if (blocked) {
            // 封禁命中有「某个人」做主语，所以挂 `uid`（`100-log.md` §3；连接里读得到就挂）；永久封禁的到期时刻写 0
            log.ev('block', { uid: connection.userId, until: blocked.untilAt ?? 0, by: 'auto' });
            this.reject(ws, '5002', 'hello', blocked.untilAt);
            return;
          }
          // 入场前判定升级：已用率到阈值就先长一档，新来的人有床可躺（`10-hall-runtime.md` §8）
          this.growIfNeeded();
          const resumed = this.resumeSession(connection);
          if (!resumed) {
            this.reject(ws, '2002', 'hello'); // 触顶且无空床：不入场
            return;
          }
          // 成功入场才记账：厅满被拒的人没有入场，不该在台账里留下「最近一见」。
          // 返回值是「这次是不是新身份」——`enter{fresh}` 就取它，不为判定再读一次台账
          const fresh = recordIdentity(
            this.ctx.storage.sql,
            {
              userId: connection.userId,
              // 走到这里昵称已经过入场层校验：台账里的那一份是运维认人的快照（见 `docs/db/schema.md` §4.1）
              nickname: connection.name,
              ip: connection.ip,
              country: connection.country,
              uaHash: connection.uaHash,
            },
            now,
          );

          const ready: ConnectionState = { ...resumed, ready: true };
          // 一个人同时只保留最新的一条连接（同一个人开两个标签页时，旧的会被顶掉）
          this.replaceOlderConnections(ws, ready.userId);
          ws.serializeAttachment(ready satisfies ConnectionState);
          this.touchLastSeen(ready.userId);
          // 唤醒后可能有别人在途（这条循环不只为我自己起）
          this.startTicking();
          // 厅里有人了 → `tick` 那条循环开始跑（最后一条连接关闭时清除，见 `stopTickLogging`）
          this.startTickLogging();
          // 行已恢复（或压根没在床上）；在床上的人重新排上「自动睡着」
          this.due.remove('grace', ready.userId);
          this.armAutoSleep(ready);
          log.ev('enter', { uid: ready.userId, fresh, online: this.onlineCount() });
          // 快照只序列化这一次：同一个字符串既发出去、也拿它自己的长度记 `snapshot{bytes}`
          // （大厅的快照很大，为取长度再 `JSON.stringify` 一遍等于白写一次整个报文）
          const snapshot = await this.snapshotFor(ws, ready);
          const payload = JSON.stringify(snapshot);
          log.ev('snapshot', {
            bytes: payload.length,
            people: snapshot.people.length,
            beds: snapshot.hall.bedCount,
          });
          this.send(ws, payload);
          // 入厅广播：只发给**别人**（自己在自己的快照里，people 里不放自己）。
          // 此刻新连接已经 ready，所以人数算上他自己
          this.broadcastExcept(ws, { t: 'join', ...personFromConnection(ready), online: this.onlineCount() });
          return;
        }
      }
    } catch {
      // 这一条消息里抛了：只留一条 `err`，不向平台抛（原来也是平台吞掉的）。
      // 连接不主动断：静默丢弃这一条意图，比主动断线更接近原行为。
      log.err({ where: 'ws-message', code: '9001' });
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

  /**
   * 握手时的状态恢复与出生点（见 `docs/design/10-hall-runtime.md` §9、§13）：
   * 床位行还占着（**行是唯一权威**，不论隔了多久）→ 行上的状态原样还原、位置退回床边；
   * 行本来是睡痕（别人画的是暗的）→ 先恢复占用，再推一条「我醒了」（其余情况不广播：别人画面本来没变）；
   * 已有**未过期归属**的床 → 站在自己床脚前的横走道（跨厅走不动，人先落在自己的位置，见 §9 步 0）；
   * 否则出现在「编号最小的可认领床」前方走道。整厅没有可认领的床（且已触顶）→ 不入场。
   */
  private resumeSession(connection: ConnectionState): ConnectionState | undefined {
    const now = Date.now();
    const occupied = findOccupiedBedByOwner(this.ctx.storage.sql, connection.userId, now);
    if (occupied !== undefined) {
      const position = frontPointOf(occupied.bedNo) ?? { x: connection.x, y: connection.y };
      if (occupied.state === 'trace') {
        // 睡痕 = 人已离线超宽限：清洗为睡着的还原，归属与 `sleep_started_at` 不动（`docs/db/schema.md` §7）
        restoreBedOccupancy(this.ctx.storage.sql, {
          bedNo: occupied.bedNo,
          name: connection.name,
          appearance: connection.appearance,
          now,
        });
      }
      const resumed: ConnectionState = {
        ...connection,
        state: occupied.state === 'trace' ? 'asleep' : occupied.state,
        bedNo: occupied.bedNo,
        x: position.x,
        y: position.y,
        lastInputAt: now,
      };
      // 睡痕行要推一条「我醒了」（别人那边本来画的是暗的）；`lying` / `asleep` 行对外无变化，不广播
      if (occupied.state === 'trace') this.broadcastState(resumed);
      return resumed;
    }

    // 步 0：已有归属的人直接落在自己床边（不占床、不碰睡痕、不写床位行——只是站位）
    const owned = findOwnedBed(this.ctx.storage.sql, connection.userId, now);
    if (owned !== undefined) {
      const home = frontPointOf(owned.bedNo) ?? { x: connection.x, y: connection.y };
      return { ...connection, x: home.x, y: home.y, state: 'roaming', bedNo: undefined, lastInputAt: now };
    }

    const spawn = this.spawnPoint(now);
    return spawn ? { ...connection, x: spawn.x, y: spawn.y, lastInputAt: now } : undefined;
  }

  /** 出生点：编号最小的可认领床的**前方走道**；没有可认领的床时先升级再取（§9）。 */
  private spawnPoint(now: number): Point | undefined {
    const sql = this.ctx.storage.sql;
    const claimable = smallestClaimableBed(sql, this.bedCount(), now);
    if (claimable !== undefined) return frontPointOf(claimable);

    if (!this.growIfNeeded()) return undefined; // 触顶且无床可认领：不入场（`2002`）
    const grown = smallestClaimableBed(sql, this.bedCount(), now);
    return grown === undefined ? undefined : frontPointOf(grown);
  }

  /**
   * 入场前的升级判定（见 `10-hall-runtime.md` §8）：**已用率 ≥ 75%** 且未触顶 →
   * 取下一级容量写进 `meta.bed_count` 并广播 `resize`。**不写任何床位行**（新外圈全是无主空床）。
   * 返回是否真的升了一级。
   */
  private growIfNeeded(): boolean {
    const bedCount = this.bedCount();
    const next = nextLevelCapacity(bedCount, this.usedBeds(Date.now()));
    if (next === undefined) return false;

    writeBedCount(this.ctx.storage.sql, next);
    this.bedCountCache = next;
    this.broadcast({ t: 'resize', bedCount: next });
    return true;
  }

  /**
   * 标记某种拒绝：回错误码再断开（`2003` / `2004` / `2002` / `5002`）。
   * 封禁必须用**带语义的 close**（`1008` + `blocked`）：客户端据此停止重连，否则被封的人会
   * 每 15 秒撞一次入场判定（见 `docs/design/70-privacy-risk.md` §5.3）。其余保持 `1000` + 码。
   * `intent` 只进日志（`reject{code,intent}`）：下行报文一个字节都不变。
   */
  private reject(ws: WebSocket, code: ErrorCode, intent: UpstreamType, untilAt?: number | null): void {
    log.ev('reject', { code, intent });
    this.send(ws, JSON.stringify({ t: 'error', code, untilAt } satisfies ErrorMessage));
    if (code === '5002') ws.close(1008, 'blocked');
    else ws.close(1000, code);
  }

  /** 静默类错误：只回错误码，不断开，也不提示（客户端点了墙面属于正常误触）。 */
  private sendError(ws: WebSocket, code: ErrorCode, intent: UpstreamType): void {
    log.ev('reject', { code, intent });
    this.send(ws, JSON.stringify({ t: 'error', code } satisfies ErrorMessage));
  }

  /** 上行只表达意图；每条意图都会刷新「最后输入时刻」（自动睡着由它推导）。 */
  private handleIntent(ws: WebSocket, connection: ConnectionState, message: UpstreamMessage): void {
    const now = Date.now();
    const gate = consumeUpstream({ window: connection.rate, now, limit: UPSTREAM_RATE_PER_SEC });
    // 被拒意图的统一出口：`code` 进下行报文，`intent` 只进日志（`reject{code,intent}`，见 `100-log.md` §3）
    const fail = (code: ErrorCode): void => this.sendError(ws, code, message.t);

    // `ping` **不是输入**：只吃限流窗口，不刷新 `lastInputAt`（否则躺在床上的人切一次屏就把
    // 自动睡着推后 5 分钟），也不写任何业务状态。被限流时**静默丢弃**（不回 `4002`：
    // 探活失败不该变成用户可见的错误）。见 `docs/api/20-api-ws.md` §3 / §7。
    if (message.t === 'ping') {
      if (!gate.allowed) {
        log.drop({ kind: 'limit' });
        return;
      }
      this.writeConnection(ws, { ...connection, rate: gate.window });
      this.send(ws, JSON.stringify({ t: 'pong', ts: now } satisfies PongMessage));
      return;
    }

    // `act` 只声明「我在看哪一页」：**与 `state` 正交**，不进任何业务判定（不刷新 `lastInputAt`、
    // 不碰自动睡着、不改归属与占用），所以不能走下面那条「先写 fresh」的通用路径。
    // 被限流、或值不是 `hall` / `game` 时**静默丢弃**（不回错误码、不断线）。见 `140-games-page.md` §6。
    if (message.t === 'act') {
      if (!gate.allowed) {
        log.drop({ kind: 'limit' });
        return;
      }
      if (message.act !== 'hall' && message.act !== 'game') return;
      const declared: ConnectionState = { ...connection, rate: gate.window };
      if (message.act === 'game') declared.act = 'game';
      else delete declared.act;
      this.writeConnection(ws, declared);
      // 变化复用一条 `state` 报文（整条人重发），发给所有人**包括本人**（`docs/api/20-api-ws.md` §4.4）
      this.broadcast({ t: 'state', ...personFromConnection(declared), online: this.onlineCount() });
      return;
    }

    if (!gate.allowed) {
      // 被限流：不写附件（省一次写入），也不刷新任何状态。`report` / `feedback` 超额**静默丢弃**
      // （`docs/api/20-api-ws.md` §7）：客户端已经本地置灰防连点，回一个 `4002` 只会多一次可见噪音。
      log.drop({ kind: 'limit' });
      if (message.t !== 'report' && message.t !== 'feedback') fail('4002');
      return;
    }
    const fresh: ConnectionState = { ...connection, lastInputAt: now, rate: gate.window };
    this.writeConnection(ws, fresh);
    this.armAutoSleep(fresh); // 输入刷新了「自动睡着」的到期时刻
    this.refreshDerivedStates();

    switch (message.t) {
      case 'walk': {
        const target = { x: Number(message.x), y: Number(message.y) };
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !isWalkable(target.x, target.y, this.bedCount())) {
          // 目标点不在街网上 → 静默丢弃，**不吸附**（吸附会让「点床躺下」与「点地面走动」的判定出现意外）
          fail('3006');
          return;
        }
        // 在床上点地面 = 起身 + 走过去（一条命令完成，少点一次）
        const standing = this.standUp(ws, fresh);
        this.startWalking(ws, this.recoverPosition(ws, standing), target);
        return;
      }
      case 'hop': {
        // 不带床号 = 我自己那张床（动作行那条）；带床号时**只看床号，不看归属与占用**——跳到别人床脚站着是合法的
        const bedNo =
          message.bedNo === undefined
            ? findOwnedBed(this.ctx.storage.sql, fresh.userId, now)?.bedNo
            : Number(message.bedNo);
        // 没带床号、我也没有归属：静默忽略（动作行那一条在没有床时本来就不显示）
        if (bedNo === undefined) return;
        // 床号越界：静默类错误（客户端已按 `bedCount` 先拦一道并给可见提示，这条只是兜底）
        if (!Number.isInteger(bedNo) || bedNo < 0 || bedNo >= this.bedCount()) {
          fail('3001');
          return;
        }
        const spot = frontPointOf(bedNo);
        // 床号没有几何（布局版本对不上）：静默忽略，不回错误码、不广播
        if (!spot) return;
        // 在床上先起身（保留归属，同「点地面」那条）；不在床上则原样返回
        const standing = this.standUp(ws, fresh);
        this.stopWalking(fresh.userId); // 不进移动者集合、不起节拍循环
        const hopped: ConnectionState = { ...retarget(standing, undefined), x: spot.x, y: spot.y };
        this.writeConnection(ws, hopped);
        this.sendPositions([[fresh.userId, spot.x, spot.y]]);
        return;
      }
      case 'lie': {
        const bedNo = Number(message.bedNo);
        const inBed = fresh.state !== 'roaming';
        const verdict = checkLie({
          bedNo,
          bedCount: this.bedCount(),
          inBed,
          // 在床上时「我正躺着的那张」：点它什么都不做（`3004`），点别的床是换床
          currentBedNo: inBed ? fresh.bedNo : undefined,
          userId: fresh.userId,
          bed: Number.isInteger(bedNo) ? readBed(this.ctx.storage.sql, bedNo, now) : undefined,
          owned: findOwnedBed(this.ctx.storage.sql, fresh.userId, now),
          now,
        });
        if (!verdict.ok) {
          // 判定不通过时**绝不站起来**：不为一个会失败的动作产生副作用
          fail(verdict.code);
          return;
        }
        // 在床上点别的床 = 起身 + 走过去 + 躺下（同「点地面」那条，一条命令完成三件事）
        const standing = this.standUp(ws, fresh);
        this.approachBed(ws, standing, bedNo);
        return;
      }
      case 'rise':
        if (fresh.state === 'roaming') fail('3005');
        else this.standUp(ws, fresh);
        return;
      case 'sleep':
        if (fresh.state !== 'lying') {
          fail(fresh.state === 'roaming' ? '3005' : '3004');
          return;
        }
        this.fallAsleep(ws, fresh);
        return;
      case 'chat': {
        // 睡着时说话：**自动醒**后处理，不报错
        if (fresh.state === 'asleep') this.wakeUp(ws, fresh);
        const verdict = chatVerdictFor(message.text, CHAT_MAX_LEN);
        if (!verdict.ok) {
          fail(verdict.code);
          return;
        }
        // 发给所有人（**含发送者本人**）：客户端靠这一条显示自己的消息，不做本地乐观回显
        const ts = Date.now();
        this.rememberSpeech(fresh.userId, verdict.text, ts);
        this.broadcast({ t: 'chat', id: fresh.userId, text: verdict.text, ts });
        this.logChat(fresh.userId, verdict.text, verdict.hits, false);
        return;
      }
      case 'whisper': {
        // 睡着时私聊：**自动醒**后处理，与聊天一致
        if (fresh.state === 'asleep') this.wakeUp(ws, fresh);
        // 文本规则与全局聊天完全相同，区别只在投递范围
        const verdict = chatVerdictFor(message.text, CHAT_MAX_LEN);
        if (!verdict.ok) {
          fail(verdict.code);
          return;
        }
        const toId = String(message.toId);
        const target = this.socketOf(toId);
        if (!target) {
          // 对方不在厅：静默类错误，发送者拿不到任何反馈（见 `docs/api/20-api-ws.md` §4.8）
          fail('2005');
          return;
        }
        // 发送者与接收者收到**同一条 payload**；第三人一条都收不到，所以不走 broadcast
        const ts = Date.now();
        const payload = JSON.stringify({
          t: 'whisper',
          fromId: fresh.userId,
          toId,
          text: verdict.text,
          ts,
        } satisfies WhisperMessage);
        this.send(ws, payload);
        if (target !== ws) this.send(target, payload);
        // 只说**送达成功**的那句：对方不在厅的私聊没发出去，那话也就没进过任何人的屏幕
        this.rememberSpeech(fresh.userId, verdict.text, ts);
        this.logChat(fresh.userId, verdict.text, verdict.hits, true);
        return;
      }
      case 'report': {
        // 校验顺序照 `docs/api/20-api-ws.md` §4.9：先事由（空 → `4003`、超长 → `4001`），再看对象
        const reason = typeof message.reason === 'string' ? message.reason.trim() : '';
        if (!reason) {
          fail('4003');
          return;
        }
        if ([...reason].length > REPORT_REASON_MAX_LEN) {
          fail('4001');
          return;
        }
        // `toId` 只能来自当前选中：服务端验不了「选中」，只验它是个别人；**不要求在线**
        const toId = typeof message.toId === 'string' ? message.toId : '';
        if (!toId || toId === fresh.userId) {
          fail('4003');
          return;
        }
        // 目标必须是**真实存在过的身份**（`identity` 有一行）：否则随便填个字符串就能无上限地刷行，
        // 一次写入就是一次计费。不要求在线——刚说完就下线正是最该记下来的时候。
        if (!findIdentity(this.ctx.storage.sql, toId)) {
          fail('4003');
          return;
        }
        const result = recordReport(
          this.ctx.storage.sql,
          {
            reporterUserId: fresh.userId,
            targetUserId: toId,
            reason,
            // 证据 = 被举报人最近 ≤10 条自己发过的文本（已是打码后的那份）；没说过就是空数组
            evidence: this.speech.get(toId) ?? [],
          },
          now,
        );
        // `dup` = 这一条是 24 小时内重复举报（并进了已存在的那一行），直接取落库的返回值，不为判定再查一次
        log.ev('report', { uid: fresh.userId, target: toId, dup: result === 'merged' });
        // `5003` 是唯一「成功用 error 报文回」的例外（否则用户会被骗「已收到」）。它**不是拒绝**，
        // 所以不走 `sendError`——那样会在 `reject` 里记一条假拒绝（`100-log.md` §3）。
        this.send(ws, JSON.stringify({ t: 'error', code: '5003' } satisfies ErrorMessage));
        return;
      }
      case 'feedback': {
        // 校验顺序：空 → `4003`、超长 → `4001`、配额 → `4004`（`docs/api/20-api-ws.md` §4.10）。
        // 三条都可见：用户要知道是「没写」「太长」还是「今天不能再发」。
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (!text) {
          fail('4003');
          return;
        }
        if ([...text].length > FEEDBACK_MAX_LEN) {
          fail('4001');
          return;
        }
        if (recordFeedback(this.ctx.storage.sql, fresh.userId, text, now) === 'quota') {
          fail('4004');
          return;
        }
        // `5004` 与 `5003` 同类：成功用 `error` 报文回，客户端据此退场并确认；**不进 `reject`**。
        this.send(ws, JSON.stringify({ t: 'error', code: '5004' } satisfies ErrorMessage));
        return;
      }
      default:
        return;
    }
  }

  /** 记一句他自己说的话（打码后的那份）进发言缓冲；满了挤掉最旧的一条。 */
  private rememberSpeech(userId: string, text: string, at: number): void {
    const recent = this.speech.get(userId) ?? [];
    recent.push({ text, at });
    if (recent.length > REPORT_EVIDENCE_MAX) recent.splice(0, recent.length - REPORT_EVIDENCE_MAX);
    this.speech.set(userId, recent);
  }

  /**
   * 发出成功的聊天（`100-log.md` §3）：`chat{len,dm}` 一条——`len` 是**实际下发的那份打码后文本**的字符数
   * （UTF-16 码元会按代理对拆开，所以用 `[...text].length`），**文本本身不进日志**；
   * 打码命中的类目各一条 `censor{kind,n}`（两类都命中就是两条，`n` 是各类目自己的字符数，同一趟打码里数出来的）。
   */
  private logChat(userId: string, text: string, hits: MaskHits, dm: boolean): void {
    log.ev('chat', { uid: userId, len: [...text].length, dm });
    if (hits.word > 0) log.ev('censor', { uid: userId, kind: 'word', n: hits.word });
    if (hits.contact > 0) log.ev('censor', { uid: userId, kind: 'contact', n: hits.contact });
  }

  /**
   * 位置恢复（全厅）：降级把墙矩形收回来之后，旧外圈落在**墙外**，所以广播 `resize` **之前**
   * 必须对每一条活着连接跑一遍（见 `docs/design/10-hall-runtime.md` §8）。两件事一起做：
   *
   * 1. 把位置拉回街网（`recoverForShrink`）；
   * 2. **清掉他正在走的那条路径**（附件里的 `target` 与内存里的移动者）——那条路径按旧几何算，
   *    留着就会把他带出墙外。
   *
   * 位置变了的人随同一条 `pos` 广播出去：否则客户端会一直把他画在墙外的旧位置上。
   */
  private recoverEveryone(): void {
    const bedCount = this.bedCount();
    const updates: PositionUpdate[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready) continue;
      this.stopWalking(connection.userId);
      const recovered = recoverForShrink(connection, bedCount);
      const moved = recovered.x !== connection.x || recovered.y !== connection.y;
      // 站位没动、也没在走的人不用重写附件（附件写入是要花的钱）
      if (moved || connection.target !== undefined) this.writeConnection(ws, recovered);
      if (moved) updates.push([connection.userId, recovered.x, recovered.y]);
    }
    this.sendPositions(updates);
  }

  /**
   * 位置恢复（单条）：降级会把区域收小，落在旧外圈的旧位置就变成街网之外了。
   * 这不是对「意图」的吸附（那是被禁止的），而是把权威位置拉回街上，否则这个人再也走不动。
   */
  private recoverPosition(ws: WebSocket, connection: ConnectionState): ConnectionState {
    const next = recoveredPosition(connection, this.bedCount());
    if (next !== connection) this.writeConnection(ws, next);
    return next;
  }

  /**
   * 走到床边再躺下（复合意图）：站在床边就直接躺，否则把「到达后动作」挂在路径上。
   * 床边的站位是**床脚前那条横走道的中心点**（`frontPointOf`，与出生点同一个点）。
   */
  private approachBed(ws: WebSocket, connection: ConnectionState, bedNo: number): void {
    const spot = frontPointOf(bedNo);
    if (!spot) {
      this.sendError(ws, '3001', 'lie'); // 床号没有几何：布局版本对不上或床号越界
      return;
    }

    if (connection.x === spot.x && connection.y === spot.y) {
      this.lieDown(ws, connection, bedNo);
      return;
    }

    const path = findPath({ x: connection.x, y: connection.y }, spot, this.bedCount());
    if (!path || path.length === 0) {
      this.sendError(ws, '3006', 'lie');
      return;
    }

    this.startMover(connection.userId, { x: connection.x, y: connection.y, path });
    this.writeConnection(ws, { ...connection, target: spot, arrivalAction: 'lie', arrivalBedNo: bedNo });
    this.startTicking();
    // 走路开始（复合意图）：与 `startWalking` 一样立即补发起点
    this.sendPositions([this.updateOf(connection.userId)]);
  }

  /**
   * 真的躺下：再次校验（走路期间床可能被别人占了），写库，然后**先释放旧床、再认领新床、最后发占用**。
   */
  private lieDown(ws: WebSocket, connection: ConnectionState, bedNo: number): void {
    const now = Date.now();
    const verdict = checkLie({
      bedNo,
      bedCount: this.bedCount(),
      inBed: connection.state !== 'roaming',
      currentBedNo: connection.state !== 'roaming' ? connection.bedNo : undefined,
      userId: connection.userId,
      bed: readBed(this.ctx.storage.sql, bedNo, now),
      owned: findOwnedBed(this.ctx.storage.sql, connection.userId, now),
      now,
    });
    if (!verdict.ok) {
      this.sendError(ws, verdict.code, 'lie');
      return;
    }

    putInBed(this.ctx.storage.sql, {
      bedNo,
      userId: connection.userId,
      name: connection.name,
      appearance: connection.appearance,
      now,
      claiming: verdict.claiming,
    });

    const standing = frontPointOf(bedNo) ?? { x: connection.x, y: connection.y };
    const lying: ConnectionState = {
      ...connection,
      state: 'lying',
      bedNo,
      x: standing.x,
      y: standing.y,
      target: undefined,
      arrivalAction: undefined,
      arrivalBedNo: undefined,
      lastInputAt: now,
    };
    this.writeConnection(ws, lying);
    this.armAutoSleep(lying);
    // `from`：从别的床换过来（释放了旧归属）还是首次躺下（`100-log.md` §3）
    log.ev('lie', {
      uid: connection.userId,
      bed: bedNo,
      from: verdict.releasingBedNo === undefined ? 'empty' : 'swap',
    });

    // 顺序有讲究（`api/20-api-ws.md` §4.5）：先释放旧床、再认领新床，否则客户端会瞬时持有两张有主床；
    // 归属两条都在占用（`state`）之前，否则会短暂渲染出「床有人、但不在归属表里」
    if (verdict.releasingBedNo !== undefined) this.broadcast({ t: 'bed', bedNo: verdict.releasingBedNo, owned: false });
    if (verdict.claiming) this.broadcast({ t: 'bed', bedNo, owned: true });
    this.broadcastState(lying);
  }

  /** 起身：释放占用、**保留归属**，站在床边。 */
  private standUp(ws: WebSocket, connection: ConnectionState): ConnectionState {
    if (connection.state === 'roaming') return connection;

    const now = Date.now();
    if (connection.bedNo !== undefined) {
      // `dwellMs` 的来源就是这一次清掉的 `sleep_started_at`（见 `bed-store.clearBed`）
      const startedAt = clearBed(this.ctx.storage.sql, connection.bedNo, now);
      // 算不出时长就不写这一条（行里没有起点），不编一个 0
      if (startedAt !== undefined) {
        log.ev('wake', { uid: connection.userId, bed: connection.bedNo, dwellMs: now - startedAt });
      }
    }
    const roaming: ConnectionState = { ...connection, state: 'roaming', bedNo: undefined, lastInputAt: now };
    this.writeConnection(ws, roaming);
    this.armAutoSleep(roaming);
    this.broadcastState(roaming);
    return roaming;
  }

  /** 手动睡着。 */
  private fallAsleep(ws: WebSocket, connection: ConnectionState): void {
    const now = Date.now();
    if (connection.bedNo !== undefined) {
      setBedOccupancy(this.ctx.storage.sql, connection.bedNo, 'asleep', now);
      log.ev('sleep', { uid: connection.userId, bed: connection.bedNo, auto: false });
    }
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
    this.broadcast({
      t: 'state',
      id: connection.userId,
      ...placementOf(connection),
      online: this.onlineCount(),
    });
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
      if (next.bedNo !== undefined) {
        setBedOccupancy(this.ctx.storage.sql, next.bedNo, derived === 'asleep' ? 'asleep' : 'lying', now);
        // 自动睡着（没有手动点「睡着」）：与 `fallAsleep` 同一种事实，只有 `auto` 不同
        if (derived === 'asleep') log.ev('sleep', { uid: connection.userId, bed: next.bedNo, auto: true });
      }
      this.broadcastState(next);
      changed = true;
    }
    if (changed) this.syncAlarm();
  }

  /**
   * 「我要去这个世界像素点」：新意图覆盖当前路径（到达后动作一并清掉）；目标就是当前点时视为原地不动。
   */
  private startWalking(ws: WebSocket, connection: ConnectionState, target: Point): void {
    const from = { x: connection.x, y: connection.y };
    const path = findPath(from, target, this.bedCount());
    if (!path) {
      this.sendError(ws, '3006', 'walk');
      return;
    }

    if (path.length === 0) {
      // 走路就地结束：立即补发当前位置，客户端手上不会留着跨度几十秒的陈旧窗口
      this.stopWalking(connection.userId);
      this.writeConnection(ws, retarget(connection, undefined));
      this.sendPositions([[connection.userId, from.x, from.y]]);
      return;
    }

    this.startMover(connection.userId, { x: from.x, y: from.y, path });
    this.writeConnection(ws, retarget(connection, target));
    this.startTicking();
    // 走路开始：立即补发起点（客户端据此开一个新鲜的插值窗口，起步那一帧因此不瞬移）
    this.sendPositions([this.updateOf(connection.userId)]);
  }

  /** 移动者此刻的位置条目（世界像素）。**调用方保证这个人在移动者集合里**。 */
  private updateOf(userId: string): PositionUpdate {
    const mover = this.movers.get(userId) as MoverState;
    return [userId, mover.x, mover.y];
  }

  /**
   * 登记一个移动者：起步时刻取此刻。被驱逐后重建工作集也走这里，所以重建按「现在起步」算，
   * 不会把他昏过去那段时间补成位移。
   */
  private startMover(userId: string, mover: MoverState): void {
    this.movers.set(userId, mover);
    this.moverStartedAt.set(userId, Date.now());
  }

  /** 移出移动者集合：位置状态与起步时刻一起丢，不留到下一趟。 */
  private dropMover(userId: string): void {
    this.movers.delete(userId);
    this.moverStartedAt.delete(userId);
  }

  private stopWalking(userId: string): MoverState | undefined {
    const mover = this.movers.get(userId);
    this.dropMover(userId);
    if (this.movers.size === 0) this.stopTicking();
    return mover;
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

  /**
   * `tick` 事件的内存循环（`100-log.md` §3）：**只在这个厅有连接时存在**。
   * 它与位置节拍是两回事（拍子 `TICK_LOG_MS` 而不是 `TICK_MS`），所以是独立的一条——
   * 但「没有连接就不该有循环」是同一条硬纪律（`AGENTS.md` 硬纪律 6：忘记清除会让对象整夜不休眠）。
   */
  private startTickLogging(): void {
    if (this.tickLogTimer !== null) return;
    this.tickLogTimer = setInterval(() => this.logTick(), TICK_LOG_MS);
  }

  private stopTickLogging(): void {
    if (this.tickLogTimer === null) return;
    clearInterval(this.tickLogTimer);
    this.tickLogTimer = null;
  }

  /**
   * 一条 `tick`：四个数都取**已经用到的量**，不为日志多读一次（`100-log.md` §5：288 条/天，
   * 唯一的新增读是这一次 `COUNT`）。`level` 从同一个 `bedCount` 推，不另读 `meta`。
   */
  private logTick(): void {
    try {
      const beds = this.bedCount();
      log.ev('tick', {
        online: this.onlineCount(),
        used: this.usedBeds(Date.now()),
        beds,
        level: levelIndexOfBedCount(beds),
      });
    } catch {
      // 埋点永不打断内存循环（§1）：丢这一条日志可以，让定时器回调抛出去不行
    }
  }

  /** 对象被驱逐后重建工作集：附加数据里还有目标的，重新算一次路径（街网寻路是确定性的）。 */
  private ensureMovers(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready || !connection.target) continue;
      if (this.movers.has(connection.userId)) continue;

      const path = findPath({ x: connection.x, y: connection.y }, connection.target, this.bedCount());
      if (!path || path.length === 0) {
        this.writeConnection(ws, { ...connection, target: undefined });
        continue;
      }
      this.startMover(connection.userId, { x: connection.x, y: connection.y, path });
    }
  }

  /**
   * 一个节拍：按**实际经过的时间**推进所有移动者，然后把**所有移动者此刻的精确位置**合并成一条广播。
   *
   * 「每拍必发」而不是「变了才发」：位置是连续的像素量，只在格号变化时发会让批次间隔随速度与节拍
   * 抖动（实测 202/305/203ms），客户端据此算出的插值窗口跨度跟着变，表现为单帧补跳（见 §4.7）。
   * 无人走动则没有节拍、也就没有消息（对象才能休眠）。
   */
  private tick(): void {
    const now = Date.now();
    this.refreshDerivedStates();
    const previousTickAt = this.lastTickAt;
    this.lastTickAt = now;

    const updates: PositionUpdate[] = [];
    const arrived: Array<{ ws: WebSocket; connection: ConnectionState }> = [];

    for (const [userId, mover] of [...this.movers]) {
      const ws = this.socketOf(userId);
      if (!ws) {
        this.dropMover(userId); // 断线：close 里已删，这里兜底
        continue;
      }

      // 推进量只从「上一拍」与「本人起步时刻」中较晚的那个起算：新起步的人不补走一拍
      const since = Math.max(previousTickAt, this.moverStartedAt.get(userId) ?? previousTickAt);
      const result = advanceMover(mover, now - since);
      if (result.moved) {
        const connection = readConnection(ws);
        if (connection) this.writeConnection(ws, { ...connection, x: mover.x, y: mover.y });
      }

      updates.push([userId, mover.x, mover.y]);

      if (result.arrived) {
        const connection = readConnection(ws);
        this.dropMover(userId);
        // 到达：本拍的这一条位置就是端点（与所有人合并成同一条）
        if (connection) arrived.push({ ws, connection: { ...connection, target: undefined } });
      }
    }

    // 顺序：**位置先于状态**。同一个节拍里最后一步的位置要排在「我躺下了」前面，
    // 否则客户端会先看到状态变化、再收到一条对已经躺下的人的位置更新。
    this.sendPositions(updates, now);
    for (const item of arrived) {
      if (item.connection.arrivalAction === 'lie' && item.connection.arrivalBedNo !== undefined) {
        this.lieDown(item.ws, item.connection, item.connection.arrivalBedNo);
      } else {
        this.writeConnection(item.ws, item.connection);
      }
    }

    if (this.movers.size === 0) this.stopTicking();
  }

  /**
   * 一批位置：一拍一条（已合并）。无人走动时**不调用**（没有节拍也就没有消息，对象才能休眠）。
   *
   * `ts` 是本批对应的服务端时刻（推进就是按它算的），客户端按它插值。
   */
  private sendPositions(items: PositionUpdate[], ts = Date.now()): void {
    if (items.length === 0) return;
    this.broadcast({ t: 'pos', ts, items });
  }

  /**
   * 所有出站消息的唯一出口：连接已经关掉就丢掉这一条。
   *
   * 附加数据里的 `ready` **不足以**说明 socket 还能发：平台摘掉连接之前 `readyState` 就已经是 CLOSED，
   * 这时 `send()` 会抛。任其冒出就是「一个死连接打断整次广播」——排在他后面的连接一条都收不到。
   */
  private send(ws: WebSocket, payload: string): void {
    if (ws.readyState !== 1 /* OPEN */) {
      // 已经关掉的连接不算「发送失败」，按 `skip` 单独攒（见 `docs/design/100-log.md` §3）
      log.drop({ kind: 'skip' });
      return;
    }
    try {
      ws.send(payload);
    } catch {
      // 刚好在检查与发送之间关掉：忽略。广播的语义是「能发的照发」，不是「发不出去就整条失败」。
      log.drop({ kind: 'send' });
    }
  }

  /** 出站消息不计费，但要克制：只在有人真的移动时才发，且一批一条。 */
  private broadcast(message: DownstreamMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (readConnection(ws)?.ready) this.send(ws, payload);
    }
  }

  /** 除了某个连接之外的所有在线者（入厅广播用：自己不需要收到自己的 join）。 */
  private broadcastExcept(except: WebSocket, message: DownstreamMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if (readConnection(ws)?.ready) this.send(ws, payload);
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
   * 写 `last_seen_at`、起宽限计时（见 `docs/design/10-hall-runtime.md` §6）。
   *
   * **在地上的人不等宽限**：他没有床位行这种持久真相，而内存里也不存任何关于他的东西，
   * 所以「延后消失」这件事根本兑现不了。在床上的人相反：不发 `leave`，宽限到期由床位行推导转成睡痕。
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      const connection = readConnection(ws);
      if (!connection?.ready) return;
      // 最后一条连接也走了 → `tick` 那条循环必须当场消失（硬纪律 6：有循环对象就无法休眠）。
      // 放在**所有会抛的调用之前**：下面任何一行抛了（catch 只留一条 `err`）都不会把它漏下。
      // 被顶掉的旧连接由下面那一行返回、不走到这里，那时新连接还活着，循环该留着。
      if (!this.hasOtherLiveConnection(ws)) this.stopTickLogging();
      this.ensureSchedule();
      // 被新连接顶掉的旧连接：状态已经归新会话了，这里再动就会把新会话的路径删掉
      if (this.socketOf(connection.userId, ws)) return;

      const now = Date.now();
      this.stopWalking(connection.userId);
      this.due.remove('autosleep', connection.userId); // 人已经不在线，「该不该睡着」不再适用于他
      if (connection.bedNo === undefined) {
        // 走路被断线打断：先把端点补发给别人，再说他走了（顺序反了的话，那条位置会落在一个已经删掉的人身上）
        this.sendPositions([[connection.userId, connection.x, connection.y]]);
        // 要排除**正在关闭的这一条**：平台在关闭事件里仍会把它列在 `getWebSockets()` 里，
        // 不排除就会把自己也算成在线
        this.broadcast({ t: 'leave', id: connection.userId, online: this.onlineCount(ws) });
      } else {
        // 在床上：不发 leave，等宽限到期后由床位行推导转成睡痕
        this.due.upsert({ kind: 'grace', userId: connection.userId, at: now + GRACE_MS });
      }
      this.touchLastSeen(connection.userId, now); // 与事件时刻同源：推导算出来的到期时刻与堆里的一致
      this.syncAlarm();
    } catch {
      // 关连接的收尾抛了：只留一条 `err`，不向平台抛（原来也是平台吞掉的）。
      log.err({ where: 'ws-close', code: '9001' });
    }
  }

  /**
   * 宽限到期处理（见 `docs/design/10-hall-runtime.md` §4.3）：判据只有床位行推导
   * （`state` + `last_seen_at` + 有没有活连接）——它丢了就会漏掉睡痕，因此它是权威。
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
      // 宽限到期时刻就是 `lastSeenAt + 宽限期`（`graceVerdict` 只在非空时判 `expired`）；
      // 兜底用 `now`——写成 `now + 宽限期` 会让那一行记下一件还没发生的事
      const tracedAt = row.lastSeenAt === null ? now : row.lastSeenAt + GRACE_MS;
      this.markTrace(row.bedNo, row.ownerUserId, tracedAt); // 在床上 → 睡痕，**不发 leave**
    }

    return waiting;
  }

  /**
   * 变成睡痕：库里记上，再广播显示态（名字与轮廓由客户端按 `trace` 变暗）。
   *
   * `updated_at` 写的是**宽限到期的时刻**（`last_seen_at + 宽限期`），不是「发现它的时刻」——它已经不是
   * 任何判据了，但存下来能让行表达「这件事本该何时发生」。
   */
  private markTrace(bedNo: number, userId: string, tracedAt: number): void {
    setBedOccupancy(this.ctx.storage.sql, bedNo, 'trace', tracedAt);
    // 床上的人断线不广播任何东西，人数降下来就发生在这一条上（宽限到期转睡痕）
    this.broadcast({ t: 'state', id: userId, state: 'trace', bedNo, online: this.onlineCount() });
  }

  /**
   * 除了这一条（正在关闭的）之外，还有没有已握手的连接：`tick` 循环的存在条件。
   * 关闭事件里平台仍会把这一条列在 `getWebSockets()` 里，不排除它就会把循环留住。
   */
  private hasOtherLiveConnection(closing: WebSocket): boolean {
    return this.ctx
      .getWebSockets()
      .some((ws) => ws !== closing && readConnection(ws)?.ready === true);
  }

  /**
   * 在线人数：**按人去重**的已握手连接数（与快照同一份实现）。`except` 用于排除正在关闭的那条连接
   * （`webSocketClose` 里平台还会列出它）。只数内存里的连接，不查库、不做整表读。
   */
  private onlineCount(except?: WebSocket): number {
    return onlineCountOf(
      this.ctx
        .getWebSockets()
        .filter((ws) => ws !== except)
        .map((ws) => ({ connection: readConnection(ws) })),
    );
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

  /** 后台踢连接用的投影：只放已握手的连接（在线口径与 `onlineCount` 一致）。 */
  private liveConnections(): LiveConnection[] {
    const live: LiveConnection[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready) continue;
      live.push({
        userId: connection.userId,
        ip: connection.ip ?? null,
        // **先发到达到期时刻，再关**：客户端只在收到 `5002` 报文时才知道该显示多久
        // （`src/client/ws.ts` 的 `case 'error'`）。少了这一步，被踢的人只能看到
        // 「你暂时无法进入」而拿不到倒计时——与刷新后被拦那一段的文案不一致。
        // 发送本身走唯一的出站出口（死连接只丢这一条），所以 `close` 一定跑得到。
        close: (untilAt) => {
          this.send(ws, JSON.stringify({ t: 'error', code: '5002', untilAt } satisfies ErrorMessage));
          ws.close(1008, 'blocked');
        },
      });
    }
    return live;
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

  /** 排下一个每日唤醒（UTC 20:00）。每次执行完都要重排：`alarm()` 末尾的对账靠堆顶把槽位写到明天。 */
  private armDailyWake(): void {
    this.due.upsert({ kind: 'daily', userId: '', at: nextDailyWakeAt(Date.now()) });
  }

  /**
   * 重建堆时的每日唤醒（见 `10-hall-runtime.md` §7）：**只有当越过的那个 20:00 还没结算过**（堆只在内存里，
   * 而 20:00 唤醒的是新实例）才排那个时刻当场补跑；已经结算过就排下一个边界。
   * 不这么分的话，对象每次重建都会补跑一次，缩级会变成「每个对象生命周期一次」。
   */
  private armDailyWakeCatchUp(): void {
    const now = Date.now();
    const settled = shouldSettleDaily(now, readMeta(this.ctx.storage.sql).dailyWakeAt);
    this.due.upsert({ kind: 'daily', userId: '', at: settled ? previousDailyWakeAt(now) : nextDailyWakeAt(now) });
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
    // 每日唤醒是唯一「丢了就真的漏掉」的一个（对象可能整夜休眠）→ 重建时排最近一个 20:00 以便补跑
    this.armDailyWakeCatchUp();
    for (const ws of this.ctx.getWebSockets()) {
      const connection = readConnection(ws);
      if (!connection?.ready) continue;
      const event = this.autoSleepEvent(connection);
      if (event) this.due.upsert(event);
    }
    // 床上但人已离线的人：宽限到期必须发生（行是权威——实例换了、内存丢了都不影响）
    const live = this.liveUserIds();
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
    if (due.some((event) => event.kind === 'daily')) this.runDailyWake();
  }

  /**
   * 每日唤醒（UTC 20:00，见 `10-hall-runtime.md` §7）：归属释放 + 缩级评估 + 留存清理，
   * 然后把**结算过的边界写回** `meta.daily_wake_at`（即使这一轮什么都没做也要写，
   * 否则同一个 20:00 会被反复补跑）。
   *
   * 六条留存清理（来源与昵称 90 天 / 到期封禁 30 天 / 审计 1 年 / 举报证据 90 天 / 举报行 90 天 /
   * 反馈 90 天，见 `70-privacy-risk.md` §7）搭在这里而**不新开唤醒**：
   * 它们和归属释放一样是「必须发生」而非「能算出来」的事，合在一处发生；顺序无关，且都不写床位行、不广播。
   */
  private runDailyWake(): void {
    const now = Date.now();
    const sql = this.ctx.storage.sql;

    // 归属释放：先取出主体（要逐床广播 bed），再一条 UPDATE 清掉
    const released = listExpiredOwnerships(sql, now);
    releaseExpiredOwnerships(sql, now);
    for (const { bedNo } of released) this.broadcast({ t: 'bed', bedNo, owned: false });

    // 结算前后的级容量：`from` 在缩级之前读（读一次就进缓存，缩级那条路径不会再多读一次）
    const bedCountFrom = this.bedCount();
    this.shrinkIfOuterRingEmpty(now);
    const bedCountTo = this.bedCount();

    forgetStaleSources(sql, now);
    purgeExpiredBlocks(sql, now);
    purgeExpiredAudit(sql, now);
    purgeExpiredReports(sql, now);
    purgeExpiredFeedback(sql, now);
    // 发言缓冲是厅的内存量（不是持久状态）：每日清一次，别让不再说话的人一直占着
    this.speech.clear();

    writeDailyWakeAt(sql, previousDailyWakeAt(now));
    this.armDailyWake();

    // 结算一条：`wakes` / `traces` 都从这一轮已取到的 `released` 里数（不为它再读一遍表）
    log.ev('settle', {
      wakes: released.length,
      traces: released.filter((bed) => bed.state === 'trace').length,
      from: bedCountFrom,
      to: bedCountTo,
      ms: Date.now() - now,
    });
  }

  /**
   * 缩级评估（见 `10-hall-runtime.md` §8）：**已用率 < 50%** 且最外那一圈床**全部无主且无占用**（含睡痕）→
   * 取下 `meta.bed_count`、广播 `resize`。**不写任何床位行**。
   * 一天只跳一档：跳档需要「这一圈真的没人要了」的判断，实时判定会在人数波动时来回跳。
   */
  private shrinkIfOuterRingEmpty(now: number): void {
    const sql = this.ctx.storage.sql;
    const bedCount = this.bedCount();
    const index = levelIndexOfBedCount(bedCount);
    if (index === 0) return; // 已经是最小档

    // 外圈 = 上一档容量到当前容量之间的那些床号（`cellOf` 的编号顺序保证它们就是最后建成的那一圈）
    const lower = (HALL_LEVELS[index - 1] as (typeof HALL_LEVELS)[number]).capacity;
    const previous = previousLevelCapacity(bedCount, this.usedBeds(now), outerRingBusy(sql, lower, bedCount, now));
    if (previous === undefined) return; // 外圈还有主或有占用，或已用率不低于 50%

    writeBedCount(sql, previous);
    this.bedCountCache = previous;
    this.recoverEveryone(); // 墙跟着收回 → 先把旧外圈的人拉回街网，再广播
    this.broadcast({ t: 'resize', bedCount: previous });
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
    try {
      this.ensureSchedule(); // 唤醒后重建事件堆（重建出来的过期事件当场执行）
      this.runDueEvents(); // 兜住刚跨过阈值的那几个（重建与本行之间可能刚好到点）
      await this.armAlarm();
    } catch (error) {
      // **照旧抛**：平台的「至少一次执行」靠异常退避重试（起始 2 秒、最多 6 次），吞掉就把唤醒降成「最多一次」
      // （见 `docs/design/10-hall-runtime.md` §4.4）。日志只负责留证据，不替平台重试。
      log.err({ where: 'alarm', code: '9001' });
      throw error;
    }
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
      me.userId,
    );

    const now = Date.now();
    const sql = this.ctx.storage.sql;
    return buildSnapshot({
      layoutVersion: LAYOUT_VERSION,
      serverTs: now,
      bedCount: this.bedCount(),
      online,
      me,
      myOwnedBedNo: findOwnedBed(sql, me.userId, now)?.bedNo ?? null,
      others,
      // 走 state 索引取 trace 行（睡痕没有 TTL，没有时间过滤；几十行量级，不是全表扫描）
      traceRows: listTraceBeds(sql),
      ownedBeds: listOwnedBeds(sql, now),
      offlineOccupants,
    });
  }
}

function readConnection(ws: WebSocket): ConnectionState | null {
  const attachment = ws.deserializeAttachment();
  return attachment ? (attachment as ConnectionState) : null;
}

/** 连接状态 → 协议里的「人在哪」（在床上带床号，否则带世界像素坐标）。 */
function placementOf(
  connection: ConnectionState,
): { state: 'roaming'; x: number; y: number } | { state: 'lying' | 'asleep'; bedNo: number } {
  return connection.state === 'roaming' || connection.bedNo === undefined
    ? { state: 'roaming', x: connection.x, y: connection.y }
    : { state: connection.state, bedNo: connection.bedNo };
}

function decodeName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}