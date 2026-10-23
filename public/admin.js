const PAGE = 50;
/** 「封 IP 之前的连坐确认」最多反查 10 页（1000 条）：确认框只用量级，不值得把整张台账搬一遍。 */
const COUNT_PAGES = 10;

const loginForm = document.getElementById('login');
const tokenField = document.getElementById('tokenField');
const tokenInput = document.getElementById('token');
const logoutButton = document.getElementById('logout');
const statusLine = document.getElementById('status');
const sidebar = document.getElementById('sidebar');
const sections = document.getElementById('sections');
const statsStrip = document.getElementById('stats');

const ipFilter = document.getElementById('ipFilter');
const nameFilter = document.getElementById('nameFilter');
const userIdFilter = document.getElementById('userIdFilter');
const identityRows = document.getElementById('identities');
const identitiesPrev = document.getElementById('identitiesPrev');
const identitiesNext = document.getElementById('identitiesNext');

const blockForm = document.getElementById('blockForm');
const blockKind = document.getElementById('blockKind');
const blockValue = document.getElementById('blockValue');
const blockMinutes = document.getElementById('blockMinutes');
const blockReason = document.getElementById('blockReason');
const blockRows = document.getElementById('blocks');

const auditRows = document.getElementById('audit');
const auditPrev = document.getElementById('auditPrev');
const auditNext = document.getElementById('auditNext');

const reportRows = document.getElementById('reports');
const reportTargetRows = document.getElementById('reportTargets');
const reportsPrev = document.getElementById('reportsPrev');
const reportsNext = document.getElementById('reportsNext');

const feedbackRows = document.getElementById('feedback');
const feedbackPrev = document.getElementById('feedbackPrev');
const feedbackNext = document.getElementById('feedbackNext');

const drawer = document.getElementById('drawer');
const drawerTitle = document.getElementById('drawerTitle');
const drawerBody = document.getElementById('drawerBody');
const drawerClose = document.getElementById('drawerClose');
const toastLine = document.getElementById('toast');

/** 概览四条口径（`120-admin-console.md` §2）：顺序固定，数字在进视图与写操作后重拉。 */
const METRICS = [
  ['online', '在线'],
  ['ownedBeds', '有主床'],
  ['blocks', '封禁记录'],
  ['reports24h', '近 24 小时被举报'],
];

/** 每页的起始游标（第 0 页是 `null`）：上一页靠它回退，下一页靠响应里的 `next` 推进。 */
let identityCursors = [null];
let identityIndex = 0;
let auditCursors = [null];
let auditIndex = 0;
let reportCursors = [null];
let reportIndex = 0;
let feedbackCursors = [null];
let feedbackIndex = 0;

/**
 * 五个视图各自加载、各自翻页；切视图只重拉当前视图（`120-admin-console.md` §3）。
 * 反馈视图随卡 5 接入。
 */
const VIEWS = {
  identities: { section: document.getElementById('view-identities'), load: () => loadIdentities(identityIndex) },
  blocks: { section: document.getElementById('view-blocks'), load: loadBlocks },
  audit: { section: document.getElementById('view-audit'), load: () => loadAudit(auditIndex) },
  reports: { section: document.getElementById('view-reports'), load: loadReportsView },
  feedback: { section: document.getElementById('view-feedback'), load: () => loadFeedback(feedbackIndex) },
};

function currentView() {
  const name = location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(VIEWS, name) ? name : 'identities';
}

/** 未授权只有 401、超限 429：后台接口不套 `{code,msg,data}`，所以按 HTTP 状态码分支。 */
function say(text, bad) {
  statusLine.textContent = text;
  statusLine.dataset.tone = bad ? 'bad' : '';
}

let toastTimer;

/** 写操作的结果与错误：放一条短提示，不打乱 `#status` 的登录态文案。 */
function toast(text, bad) {
  toastLine.textContent = text;
  toastLine.dataset.tone = bad ? 'bad' : '';
  toastLine.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastLine.hidden = true;
  }, bad ? 8000 : 4000);
}

function showLoggedIn(loggedIn) {
  tokenField.hidden = loggedIn;
  loginForm.querySelector('button[type="submit"]').hidden = loggedIn;
  logoutButton.hidden = !loggedIn;
  sidebar.hidden = !loggedIn;
  sections.hidden = !loggedIn;
  if (!loggedIn) statsStrip.hidden = true;
  if (!loggedIn && drawer.open) drawer.close();
}

async function post(path, body) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 受保护的数据接口统一走这里：401 = cookie 过期，退回登录态。 */
async function dataFetch(path, options) {
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    say('无法连接服务器。', true);
    return null;
  }
  if (res.status === 401) {
    showLoggedIn(false);
    say('登录已过期，请重新登录。', true);
    return null;
  }
  return res;
}

const fmtTime = (ms) => (ms === null || ms === undefined ? '—' : new Date(ms).toLocaleString());
const fmtUntil = (ms) => (ms === null || ms === undefined ? '永久' : new Date(ms).toLocaleString());

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function render(tbody, rows, build, columns) {
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = cell('暂无记录');
    td.colSpan = columns;
    td.className = 'empty';
    tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }
  tbody.replaceChildren(...rows.map(build));
}

function blockText(block) {
  if (!block) return '—';
  const until = block.untilAt === null ? '永久' : `到 ${new Date(block.untilAt).toLocaleString()}`;
  return `${block.kind} · ${until} · ${block.reason}`;
}

function identityRow(item) {
  const tr = document.createElement('tr');
  // 昵称在第二格，这一格只印 userId（`nickname: null` 让 partyText 只出 userId）。
  const id = document.createElement('td');
  id.append(partyLink({ userId: item.userId, nickname: null }));
  tr.append(
    id,
    cell(item.nickname ?? '—'),
    cell(fmtTime(item.lastSeenAt)),
    cell(item.lastIp ?? '—'),
    cell(item.lastCountry ?? '—'),
    cell(item.bedNo === null ? '—' : String(item.bedNo)),
    cell(item.online ? '是' : '—'),
    cell(blockText(item.block)),
  );
  return tr;
}

function feedbackRow(item) {
  const tr = document.createElement('tr');
  const submitter = document.createElement('td');
  submitter.append(partyLink({ userId: item.userId, nickname: item.nickname }));
  const body = document.createElement('td');
  body.className = 'feedback-body';
  body.textContent = item.text;
  tr.append(cell(fmtTime(item.createdAt)), submitter, body);
  return tr;
}

/** 黑名单 / 审计的「值」格（§5.3、§5.5）：`user` 行显示昵称并能点开抽屉；`ip` 行只是字面量（不编「该 IP 名下几个人」）。 */
function valueCell(item) {
  if (item.kind !== 'user') return cell(item.value);
  const td = document.createElement('td');
  td.append(partyLink({ userId: item.value, nickname: item.nickname }));
  return td;
}

function auditRow(item) {
  const tr = document.createElement('tr');
  tr.append(
    cell(fmtTime(item.at)),
    cell(item.action),
    cell(item.kind),
    valueCell(item),
    cell(fmtUntil(item.untilAt)),
    cell(item.reason ?? '—'),
    cell(item.actor),
  );
  return tr;
}

function blockRow(item) {
  const tr = document.createElement('tr');
  tr.append(
    cell(item.kind),
    valueCell(item),
    cell(fmtUntil(item.untilAt)),
    cell(item.reason),
    cell(fmtTime(item.createdAt)),
  );
  const action = document.createElement('td');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '解封';
  button.addEventListener('click', () => unblock(item.kind, item.value));
  action.append(button);
  tr.append(action);
  return tr;
}

const partyText = (party) => (party.nickname === null ? party.userId : `${party.nickname} · ${party.userId}`);

/** 台账详情只读（§5.2）：点举报里的当事人打开抽屉，封禁仍然只在黑名单那一处。 */
function openIdentity(userId, label) {
  drawerTitle.textContent = label;
  drawerBody.replaceChildren(htmlLine('读取中…'));
  if (!drawer.open) drawer.showModal();
  void loadIdentityDetail(userId);
}

async function loadIdentityDetail(userId) {
  const res = await dataFetch(`/api/admin/identities/${encodeURIComponent(userId)}`);
  if (!res) {
    drawerBody.replaceChildren(htmlLine('读取失败。'));
    return;
  }
  if (res.status === 404) {
    drawerBody.replaceChildren(htmlLine('查不到这个身份'));
    return;
  }
  if (res.status !== 200) {
    drawerBody.replaceChildren(htmlLine(`台账详情读取失败（${res.status}）。`));
    return;
  }
  const data = await res.json();
  const lines = [
    `用户：${data.userId}`,
    `最近出现：${fmtTime(data.lastSeenAt)}`,
    `IP：${data.lastIp ?? '—'} · 国家：${data.lastCountry ?? '—'}`,
    `床号：${data.bedNo === null ? '—' : data.bedNo} · 在线：${data.online ? '是' : '—'}`,
    `封禁：${blockText(data.block)}`,
    `同网络的其他身份（${data.ipHistory.length}）：`,
    ...data.ipHistory.map(
      (peer) => `　${peer.userId} · 最近 ${fmtTime(peer.lastSeenAt)} · ${blockText(peer.block)}`,
    ),
    `该身份的审计（${data.audit.length}）：`,
    ...data.audit.map(
      (entry) =>
        `　${fmtTime(entry.at)} ${entry.action} ${entry.kind} ${entry.value} ` +
        `${entry.untilAt === null ? '' : `到 ${fmtTime(entry.untilAt)} `}${entry.reason ?? ''}`,
    ),
  ];
  drawerBody.replaceChildren(...lines.map((line) => htmlLine(line)));
}

function htmlLine(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div;
}

function partyLink(party) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link';
  button.textContent = partyText(party);
  button.addEventListener('click', () => openIdentity(party.userId, partyText(party)));
  return button;
}

function reportRow(item) {
  const tr = document.createElement('tr');
  const reporter = document.createElement('td');
  reporter.append(partyLink(item.reporter));
  const target = document.createElement('td');
  target.append(partyLink(item.target));
  const evidence = document.createElement('td');
  evidence.append(
    ...(item.evidence.length === 0
      ? [htmlLine('—')]
      : item.evidence.map((entry) => htmlLine(`${fmtTime(entry.at)} ${entry.text}`))),
  );
  tr.append(
    cell(fmtTime(item.lastAt)),
    cell(String(item.count)),
    reporter,
    target,
    cell(item.reason),
    evidence,
  );
  return tr;
}

/** 按被举报人（§5.7）：无分页（响应里没有 `next`），一次读完全部折叠行。 */
async function loadReportTargets() {
  const res = await dataFetch('/api/admin/reports/targets');
  if (!res) return;
  if (res.status !== 200) {
    say(`按被举报人读取失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  render(reportTargetRows, data.items, reportTargetRow, 5);
}

function reportTargetRow(item) {
  const tr = document.createElement('tr');
  const target = document.createElement('td');
  target.append(partyLink(item.target));
  tr.append(
    target,
    cell(String(item.count)),
    cell(String(item.reporters)),
    cell(fmtTime(item.lastAt)),
    cell(item.reason),
  );
  return tr;
}

async function loadReportsView() {
  await Promise.all([loadReports(reportIndex), loadReportTargets()]);
}

async function loadReports(index) {
  const cursor = reportCursors[index] ?? null;
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (cursor) params.set('before', String(cursor.before));

  const res = await dataFetch(`/api/admin/reports?${params.toString()}`);
  if (!res) return;
  if (res.status !== 200) {
    say(`举报读取失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  reportIndex = index;
  if (data.next) reportCursors[index + 1] = data.next;
  reportsPrev.disabled = index === 0;
  reportsNext.disabled = !data.next;
  render(reportRows, data.items, reportRow, 6);
}

/** 反馈列表（`120-admin-console.md` §2.1）：按 `id` 倒序、只读；正文保留换行，提交者按 `partyText` 规则印「昵称 · userId」并能点开抽屉。 */
async function loadFeedback(index) {
  const cursor = feedbackCursors[index] ?? null;
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (cursor) params.set('before', String(cursor.before));

  const res = await dataFetch(`/api/admin/feedback?${params.toString()}`);
  if (!res) return;
  if (res.status !== 200) {
    say(`反馈读取失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  feedbackIndex = index;
  if (data.next) feedbackCursors[index + 1] = data.next;
  feedbackPrev.disabled = index === 0;
  feedbackNext.disabled = !data.next;
  render(feedbackRows, data.items, feedbackRow, 3);
}

async function loadIdentities(index) {
  const cursor = identityCursors[index] ?? null;
  const params = new URLSearchParams({ limit: String(PAGE) });
  const ip = ipFilter.value.trim();
  if (ip) params.set('ip', ip);
  const name = nameFilter.value.trim();
  if (name) params.set('name', name);
  const userId = userIdFilter.value.trim();
  if (userId) params.set('userId', userId);
  if (cursor) {
    params.set('before', String(cursor.before));
    params.set('beforeId', cursor.beforeId);
  }

  const res = await dataFetch(`/api/admin/identities?${params.toString()}`);
  if (!res) return;
  if (res.status !== 200) {
    say(`台账读取失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  identityIndex = index;
  if (data.next) identityCursors[index + 1] = data.next;
  identitiesPrev.disabled = index === 0;
  identitiesNext.disabled = !data.next;
  render(identityRows, data.items, identityRow, 8);
}

async function loadBlocks() {
  const res = await dataFetch('/api/admin/blocks');
  if (!res) return;
  if (res.status !== 200) {
    say(`黑名单读取失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  render(blockRows, data.items, blockRow, 6);
}

async function loadAudit(index) {
  const cursor = auditCursors[index] ?? null;
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (cursor) params.set('before', String(cursor.before));

  const res = await dataFetch(`/api/admin/audit?${params.toString()}`);
  if (!res) return;
  if (res.status !== 200) {
    say(`审计读取失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  auditIndex = index;
  if (data.next) auditCursors[index + 1] = data.next;
  auditPrev.disabled = index === 0;
  auditNext.disabled = !data.next;
  render(auditRows, data.items, auditRow, 7);
}

/** 概览：与当前视图并发拉，失败静默保持隐藏（不把假 0 当事实）。 */
async function loadStats() {
  const res = await dataFetch('/api/admin/stats');
  if (!res || !res.ok) return;
  let stats;
  try {
    stats = await res.json();
  } catch {
    return;
  }
  statsStrip.replaceChildren(
    ...METRICS.map(([key, label]) => {
      const card = document.createElement('div');
      card.className = 'metric';
      const value = document.createElement('strong');
      value.textContent = typeof stats[key] === 'number' ? String(stats[key]) : '—';
      const caption = document.createElement('span');
      caption.textContent = label;
      card.append(value, caption);
      return card;
    }),
  );
  statsStrip.hidden = false;
}

/** 写操作之后重置三个游标、重读黑名单与概览：其他视图下次进入会重拉。 */
async function refreshAfterWrite() {
  identityCursors = [null];
  auditCursors = [null];
  reportCursors = [null];
  await Promise.all([loadBlocks(), loadStats()]);
}

/** 封 IP 之前先按该 IP 反查计数：`affected` 要等封完才知道，而连坐不能一键静默发生。 */
async function countIdentitiesByIp(ip) {
  let count = 0;
  let cursor = null;
  for (let page = 0; page < COUNT_PAGES; page += 1) {
    const params = new URLSearchParams({ ip, limit: '100' });
    if (cursor) {
      params.set('before', String(cursor.before));
      params.set('beforeId', cursor.beforeId);
    }
    const res = await dataFetch(`/api/admin/identities?${params.toString()}`);
    if (!res || res.status !== 200) return null;
    const data = await res.json();
    count += data.items.length;
    if (!data.next) return { count, capped: false };
    cursor = data.next;
  }
  return { count, capped: true };
}

async function unblock(kind, value) {
  const res = await dataFetch(`/api/admin/blocks/${kind}/${encodeURIComponent(value)}`, { method: 'DELETE' });
  if (!res) return;
  if (res.status !== 200) {
    toast(`解封失败（${res.status}）。`, true);
    return;
  }
  const data = await res.json();
  toast(data.removed ? `已解封 ${kind} ${value}。` : `${kind} ${value} 本来就不在黑名单里（审计已记）。`);
  await refreshAfterWrite();
}

blockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const kind = blockKind.value;
  const value = blockValue.value.trim();
  const reason = blockReason.value.trim();
  const minutes = blockMinutes.value.trim();
  if (!value || !reason) {
    say('值和原因都必须填。', true);
    return;
  }
  // 只收整数分钟：`0.5` 会被 `Date.now() + 30000` 读成「封 30 秒」，与输入框的含义不符
  if (minutes && !(Number.isInteger(Number(minutes)) && Number(minutes) > 0)) {
    say('时长要么留空（永久），要么填大于 0 的整数分钟。', true);
    return;
  }

  let affectedText = `即将封禁身份 ${value}`;
  if (kind === 'ip') {
    const counted = await countIdentitiesByIp(value);
    if (!counted) {
      say('反查失败，未提交。', true);
      return;
    }
    const n = counted.capped ? `${counted.count}+` : String(counted.count);
    affectedText = `即将封禁 IP ${value}：这个 IP 名下记录过 ${n} 个身份`;
  }
  const untilText = minutes ? `${minutes} 分钟后到期` : '永久';
  if (!confirm(`${affectedText}。\n时长：${untilText}\n原因：${reason}\n\n继续？`)) return;

  const untilAt = minutes ? Date.now() + Number(minutes) * 60_000 : null;
  const res = await dataFetch('/api/admin/blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, value, untilAt, reason }),
  });
  if (!res) return;
  if (res.status !== 200) {
    toast(`封禁失败（${res.status}）：参数非法？`, true);
    return;
  }
  const data = await res.json();
  toast(
    `已封禁 ${data.block.kind} ${data.block.value}（${data.created ? '新增' : '覆盖既有'}） · ` +
      `影响身份 ${data.affected.identities} · 在线 ${data.affected.online}`,
  );
  blockForm.reset();
  await refreshAfterWrite();
});

document.getElementById('ipSearch').addEventListener('click', () => {
  identityCursors = [null];
  void loadIdentities(0);
});
document.getElementById('ipClear').addEventListener('click', () => {
  ipFilter.value = '';
  nameFilter.value = '';
  userIdFilter.value = '';
  identityCursors = [null];
  void loadIdentities(0);
});
identitiesPrev.addEventListener('click', () => void loadIdentities(identityIndex - 1));
identitiesNext.addEventListener('click', () => void loadIdentities(identityIndex + 1));
auditPrev.addEventListener('click', () => void loadAudit(auditIndex - 1));
auditNext.addEventListener('click', () => void loadAudit(auditIndex + 1));
reportsPrev.addEventListener('click', () => void loadReports(reportIndex - 1));
reportsNext.addEventListener('click', () => void loadReports(reportIndex + 1));
drawerClose.addEventListener('click', () => drawer.close());
// `showModal()` 只给 Esc；点遮罩时事件目标是 dialog 本身，不接这一条就关不掉（见 `120-admin-console.md` §5）。
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) drawer.close();
});

function showView(name) {
  for (const [key, view] of Object.entries(VIEWS)) {
    view.section.hidden = key !== name;
    const link = document.querySelector(`nav a[href="#${key}"]`);
    if (!link) continue;
    if (key === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function renderView() {
  const name = currentView();
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  showView(name);
  // 概览与当前视图并发：统计失败不该把列表也挡在门外（`loadStats` 自己吞掉错误）。
  await Promise.all([VIEWS[name].load(), loadStats()]);
}

async function enterApp() {
  showLoggedIn(true);
  await renderView();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const res = await post('/api/admin/login', { token: tokenInput.value });
    if (res.status === 200) {
      tokenInput.value = '';
      identityCursors = [null];
      auditCursors = [null];
      reportCursors = [null];
      feedbackCursors = [null];
      say('已登录。');
      await enterApp();
    } else if (res.status === 429) {
      say('尝试次数过多，请等一分钟再试。', true);
    } else {
      say('令牌不对。', true);
    }
  } catch {
    say('请求失败，请检查网络。', true);
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  await post('/api/admin/logout');
  showLoggedIn(false);
  identityRows.replaceChildren();
  blockRows.replaceChildren();
  auditRows.replaceChildren();
  reportRows.replaceChildren();
  reportTargetRows.replaceChildren();
  feedbackRows.replaceChildren();
  say('已登出。');
});

window.addEventListener('hashchange', () => {
  if (sections.hidden) return;
  void renderView();
});

/** 刷新后还登着吗：受保护的 `/api/admin/me` 是最好的判据（cookie 未过期就 200）。 */
async function syncState() {
  try {
    const res = await fetch('/api/admin/me', { credentials: 'same-origin' });
    if (res.status === 200) {
      say('已登录。');
      await enterApp();
    } else {
      showLoggedIn(false);
    }
  } catch {
    showLoggedIn(false);
    say('无法连接服务器。', true);
  }
}

syncState();
