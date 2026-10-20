/**
 * 风控与台账（见 `docs/design/70-privacy-risk.md` §5、`docs/db/schema.md` §4）。
 *
 * 两条纪律：
 * 1. **封禁判定只有一处**（`blockStateOf`），`/api/me` 与 `hello` 共用——多开一个判定点就是多一条唤醒路径，
 *    也会随时间漂移成两个结论；
 * 2. **是否生效是读取时推导**（`until_at > now`），不挂定时器、不写清理任务。
 */

/** 封禁维度：`user` 与 `ip` 两个都真封，命中任一即拒（见 §5.1）。 */
export type BlockKind = 'user' | 'ip';

/**
 * 来源（L3）：**只入台账与封禁判定，永不下发给用户**（见 §2）。
 * `ip` 缺失 = 本地开发拿不到 `CF-Connecting-IP` → 只跳过 ip 维度，user 维度照判。
 */
export interface EntrySource {
  userId: string;
  ip?: string | null;
  country?: string | null;
  uaHash?: string | null;
}

/** 命中封禁的那一条：`untilAt` 为 `null` = 永久。**不带 `reason`**——原因只进审计，不下发给被封者。 */
export interface BlockHit {
  kind: BlockKind;
  untilAt: number | null;
}

/** 同一次判定，但保留 `value` / `reason`：后台台账要显示「封了哪个值、因为什么」。 */
export interface BlockDetail extends BlockHit {
  value: string;
  reason: string;
}

/** 一条维度的索引命中（`(kind, value)` 联合主键就是判定路径，最多两次命中）。 */
function activeBlock(sql: SqlStorage, kind: BlockKind, value: string, now: number): BlockDetail | null {
  const row = sql
    .exec<{ until_at: number | null; reason: string }>(
      'SELECT until_at, reason FROM block WHERE kind = ? AND value = ? AND (until_at IS NULL OR until_at > ?)',
      kind,
      value,
      now,
    )
    .toArray()[0];
  return row ? { kind, value, untilAt: row.until_at, reason: row.reason } : null;
}

/** 更严的那条：永久 > 到期更晚。平手保持先查到的 user 维。 */
function stricter(candidate: BlockHit, current: BlockHit | null): boolean {
  if (current === null) return true;
  if (current.untilAt === null) return false;
  return candidate.untilAt === null || candidate.untilAt > current.untilAt;
}

/**
 * 命中封禁的那一条（**判定只有这一份实现**，见 §5.2）：两种维度任一命中取**更严**的那条——
 * 否则「IP 永久封 + 这张网里某人只封一天」会按轻的那条显示成「还有 1 分钟」。
 * 带 `value` / `reason` 的那一版给后台台账用（它要显示「封了哪个值、因为什么」）。
 */
export function blockDetailOf(sql: SqlStorage, source: EntrySource, now: number): BlockDetail | null {
  const hits = [activeBlock(sql, 'user', source.userId, now)];
  if (source.ip) hits.push(activeBlock(sql, 'ip', source.ip, now));
  return hits.reduce<BlockDetail | null>(
    (strictest, hit) => (hit && stricter(hit, strictest) ? hit : strictest),
    null,
  );
}

/** 封禁判定（`/api/me` 与 `hello` 共用这一处）：只给维度与到期时刻。 */
export function blockStateOf(sql: SqlStorage, source: EntrySource, now: number): BlockHit | null {
  const hit = blockDetailOf(sql, source, now);
  return hit && { kind: hit.kind, untilAt: hit.untilAt };
}

/**
 * 入场台账：`first_seen_at` 只在第一次写，其余四项每次刷新。
 * 来源缺失时写 `null`——与「90 天留存期被清空」是同一种空值语义（见 `docs/db/schema.md` §4.1）。
 */
export function recordIdentity(sql: SqlStorage, source: EntrySource, now: number): void {
  sql.exec(
    `INSERT INTO identity (user_id, first_seen_at, last_seen_at, last_ip, last_country, ua_hash)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       last_ip = excluded.last_ip,
       last_country = excluded.last_country,
       ua_hash = excluded.ua_hash`,
    source.userId,
    now,
    now,
    source.ip ?? null,
    source.country ?? null,
    source.uaHash ?? null,
  );
}

/** 黑名单的一行（`untilAt` 为 `null` = 永久）。 */
export interface BlockRecord {
  kind: BlockKind;
  value: string;
  untilAt: number | null;
  reason: string;
  createdAt: number;
}

interface RawBlockRow {
  [key: string]: string | number | null;
  kind: string;
  value: string;
  until_at: number | null;
  reason: string;
  created_at: number;
}

/** 封禁 / 改判：联合主键决定覆盖，`created_at` 随覆盖刷新（台账按它倒序）。 */
export function upsertBlock(
  sql: SqlStorage,
  block: { kind: BlockKind; value: string; untilAt: number | null; reason: string },
  now: number,
): void {
  sql.exec(
    `INSERT INTO block (kind, value, until_at, reason, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, value) DO UPDATE SET
       until_at = excluded.until_at,
       reason = excluded.reason,
       created_at = excluded.created_at`,
    block.kind,
    block.value,
    block.untilAt,
    block.reason,
    now,
  );
}

/** 解封：返回是否真的删掉了一行（解封是幂等动作，重复点不该报错）。 */
export function removeBlock(sql: SqlStorage, kind: BlockKind, value: string): boolean {
  return sql.exec('DELETE FROM block WHERE kind = ? AND value = ?', kind, value).rowsWritten > 0;
}

/** 黑名单全表，按写入时刻倒序：行数由运维动作决定，与用户规模无关。 */
export function listBlocks(sql: SqlStorage): BlockRecord[] {
  return sql
    .exec<RawBlockRow>('SELECT kind, value, until_at, reason, created_at FROM block ORDER BY created_at DESC')
    .toArray()
    .map((row) => ({
      kind: row.kind as BlockKind,
      value: row.value,
      untilAt: row.until_at,
      reason: row.reason,
      createdAt: row.created_at,
    }));
}

/** 一条审计（只写不改）。 */
export interface AuditRecord {
  id: number;
  at: number;
  action: 'block' | 'unblock';
  kind: BlockKind;
  value: string;
  untilAt: number | null;
  reason: string | null;
  actor: string;
}

export interface AuditEntry {
  action: 'block' | 'unblock';
  kind: BlockKind;
  value: string;
  untilAt: number | null;
  reason?: string | null;
}

interface RawAuditRow {
  [key: string]: string | number | null;
  id: number;
  at: number;
  action: string;
  kind: string;
  value: string;
  until_at: number | null;
  reason: string | null;
  actor: string;
}

/** 写审计。`actor` 首版恒为 `admin`：只有一个令牌，没有账号表（见 `docs/api/30-api-admin.md` §1）。 */
export function writeAudit(sql: SqlStorage, entry: AuditEntry, now: number): void {
  sql.exec(
    'INSERT INTO admin_audit (at, action, kind, value, until_at, reason, actor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    now,
    entry.action,
    entry.kind,
    entry.value,
    entry.untilAt,
    entry.reason ?? null,
    'admin',
  );
}

function toAudit(row: RawAuditRow): AuditRecord {
  return {
    id: row.id,
    at: row.at,
    action: row.action as AuditRecord['action'],
    kind: row.kind as BlockKind,
    value: row.value,
    untilAt: row.until_at,
    reason: row.reason,
    actor: row.actor,
  };
}

/**
 * 审计倒序取一页（自增主键就是分页排序键，见 `docs/api/30-api-admin.md` §4）：
 * `before` 为上一页末尾那一行的 `id`；缺省即从头开始。
 */
export function listAudit(sql: SqlStorage, limit: number, before?: number): AuditRecord[] {
  const rows =
    before === undefined
      ? sql
          .exec<RawAuditRow>(
            'SELECT id, at, action, kind, value, until_at, reason, actor FROM admin_audit ORDER BY id DESC LIMIT ?',
            limit,
          )
          .toArray()
      : sql
          .exec<RawAuditRow>(
            'SELECT id, at, action, kind, value, until_at, reason, actor FROM admin_audit WHERE id < ? ORDER BY id DESC LIMIT ?',
            before,
            limit,
          )
          .toArray();
  return rows.map(toAudit);
}

/** 某个作用对象的审计（身份详情页用：`kind = 'user'`、`value = userId`）。 */
export function listAuditFor(sql: SqlStorage, kind: BlockKind, value: string, limit: number): AuditRecord[] {
  return sql
    .exec<RawAuditRow>(
      `SELECT id, at, action, kind, value, until_at, reason, actor FROM admin_audit
        WHERE kind = ? AND value = ? ORDER BY id DESC LIMIT ?`,
      kind,
      value,
      limit,
    )
    .toArray()
    .map(toAudit);
}

/** 这条封禁是否已经存在（`created: false` = 覆盖了既有的一条，见 §5.3）。 */
export function hasBlock(sql: SqlStorage, kind: BlockKind, value: string): boolean {
  return sql.exec('SELECT 1 FROM block WHERE kind = ? AND value = ?', kind, value).toArray().length > 0;
}

/** 一条身份（`identity` 是**来源的载体，不是用户档案**，见 `docs/db/schema.md` §4.1）。 */
export interface IdentityRecord {
  userId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastIp: string | null;
  lastCountry: string | null;
  uaHash: string | null;
}

interface RawIdentityRow {
  [key: string]: string | number | null;
  user_id: string;
  first_seen_at: number;
  last_seen_at: number;
  last_ip: string | null;
  last_country: string | null;
  ua_hash: string | null;
}

function toIdentity(row: RawIdentityRow): IdentityRecord {
  return {
    userId: row.user_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    lastCountry: row.last_country,
    uaHash: row.ua_hash,
  };
}

/**
 * 台账一页：`last_seen_at DESC, user_id DESC`。**复合游标**是必须的——只按时刻分页会漏掉
 * 同一毫秒的那些行（见 `docs/api/30-api-admin.md` §4）。`ip` 与游标可以同时给。
 */
export function listIdentities(
  sql: SqlStorage,
  query: { limit: number; ip?: string; before?: number; beforeId?: string },
): IdentityRecord[] {
  // 两个游标值要么都给、要么都不给：只给一个时无法定位「从哪里接着看」
  const cursor =
    query.before !== undefined && query.beforeId !== undefined
      ? { before: query.before, beforeId: query.beforeId }
      : { before: null, beforeId: null };
  const ip = query.ip ?? null;
  return sql
    .exec<RawIdentityRow>(
      `SELECT user_id, first_seen_at, last_seen_at, last_ip, last_country, ua_hash FROM identity
        WHERE (? IS NULL OR last_ip = ?)
          AND (? IS NULL OR last_seen_at < ? OR (last_seen_at = ? AND user_id < ?))
        ORDER BY last_seen_at DESC, user_id DESC LIMIT ?`,
      ip,
      ip,
      cursor.before,
      cursor.before,
      cursor.before,
      cursor.beforeId,
      query.limit,
    )
    .toArray()
    .map(toIdentity);
}

/** 单个身份：不存在 → `undefined`（后台要能区分「查错了」与「没有这个人」）。 */
export function findIdentity(sql: SqlStorage, userId: string): IdentityRecord | undefined {
  const row = sql
    .exec<RawIdentityRow>(
      'SELECT user_id, first_seen_at, last_seen_at, last_ip, last_country, ua_hash FROM identity WHERE user_id = ?',
      userId,
    )
    .toArray()[0];
  return row ? toIdentity(row) : undefined;
}

/** 与某个 IP 同一网络的**其他**身份：清 cookie 换身份的唯一可见线索（§5.2）。 */
// shortcut: 同一条网络下的身份量级为几百，按时间排序取前 N 即可；真到万级再谈分页
export function listIpPeers(
  sql: SqlStorage,
  ip: string,
  excludeUserId: string,
  limit: number,
): IdentityRecord[] {
  return sql
    .exec<RawIdentityRow>(
      `SELECT user_id, first_seen_at, last_seen_at, last_ip, last_country, ua_hash FROM identity
        WHERE last_ip = ? AND user_id <> ? ORDER BY last_seen_at DESC, user_id DESC LIMIT ?`,
      ip,
      excludeUserId,
      limit,
    )
    .toArray()
    .map(toIdentity);
}

/**
 * 一个封禁值下记录过的身份数（`affected.identities`）：`user` 维度 0/1，`ip` 维度按 `last_ip` 数行。
 * 封 IP 时操作者靠它判断自己是不是在封一片人（§5.3）。
 */
export function countIdentitiesFor(sql: SqlStorage, kind: BlockKind, value: string): number {
  const rows =
    kind === 'ip'
      ? sql
          .exec<{ n: number }>('SELECT COUNT(*) AS n FROM identity WHERE last_ip = ?', value)
          .toArray()
      : sql
          .exec<{ n: number }>('SELECT COUNT(*) AS n FROM identity WHERE user_id = ?', value)
          .toArray();
  return rows[0]?.n ?? 0;
}
