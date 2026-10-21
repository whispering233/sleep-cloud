import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 每个用例一份全新的模块状态：闸门与聚合计数活在模块内存里（`100-log.md` §4.3）。 */
async function fresh() {
  vi.resetModules();
  const log = await import('../log');
  const write = vi.spyOn(console, 'log').mockImplementation(() => {});
  return { log, write };
}

function rowsOf(write: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return write.mock.calls.map((call) => call[0] as Record<string, unknown>);
}

const START = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('日志出口的字段白名单（§4.1）', () => {
  it('未知 ev 整条丢弃', async () => {
    const { log, write } = await fresh();
    log.ev('nope' as never, {});
    expect(write).not.toHaveBeenCalled();
  });

  it('字段表外的键与非标量值被丢弃，uid 与表内字段保留', async () => {
    const { log, write } = await fresh();
    log.ev('lie', { bed: 3, from: 'empty', uid: 'u1', typo: 'x' } as never);
    log.ev('tick', { online: 2, used: { nested: true } } as never);
    expect(rowsOf(write)).toEqual([
      { ev: 'lie', bed: 3, from: 'empty', uid: 'u1' },
      { ev: 'tick', online: 2 },
    ]);
  });
});

describe('日志出口永不抛（§4.2）', () => {
  it('console.log 抛异常也不向上抛', async () => {
    const { log, write } = await fresh();
    write.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => log.err({ where: 'http', code: '9001' })).not.toThrow();
    expect(() => log.ev('enter', { fresh: true, online: 1 })).not.toThrow();
  });
});

describe('闸门（§4.3）', () => {
  it('一分钟最多 30 条，超出只累加，5 分钟内最多一条 suppressed', async () => {
    const { log, write } = await fresh();

    for (let i = 0; i < 31; i += 1) log.err({ where: 'http', code: '9001' });
    let rows = rowsOf(write);
    expect(rows.filter((row) => row.ev === 'err')).toHaveLength(30);
    expect(rows.filter((row) => row.ev === 'suppressed')).toEqual([{ ev: 'suppressed', n: 1 }]);

    // 下一分钟窗口重开，但 suppressed 的 5 分钟窗口未到：超出部分只累加，不产出第二条
    vi.setSystemTime(new Date(START.getTime() + 120_000));
    for (let i = 0; i < 31; i += 1) log.err({ where: 'http', code: '9001' });
    rows = rowsOf(write);
    expect(rows.filter((row) => row.ev === 'err')).toHaveLength(60);
    expect(rows.filter((row) => row.ev === 'suppressed')).toHaveLength(1);

    // 5 分钟到点后的第一次调用把攒下的 1 条汇总出来
    vi.setSystemTime(new Date(START.getTime() + 5 * 60_000));
    log.err({ where: 'http', code: '9001' });
    rows = rowsOf(write);
    expect(rows.slice(-2).map((row) => row.ev)).toEqual(['err', 'suppressed']);
    expect(rows.at(-1)).toEqual({ ev: 'suppressed', n: 1 });
  });
});

describe('静默点聚合（§4.4）', () => {
  it('攒到 20 次写一条带 n 的 drop', async () => {
    const { log, write } = await fresh();
    for (let i = 0; i < 19; i += 1) log.drop({ kind: 'send' });
    expect(write).not.toHaveBeenCalled();

    log.drop({ kind: 'send' });
    expect(rowsOf(write)).toEqual([{ ev: 'drop', kind: 'send', n: 20 }]);
  });

  it('5 分钟边界结算一次', async () => {
    const { log, write } = await fresh();
    log.drop({ kind: 'skip' });
    expect(write).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(START.getTime() + 5 * 60_000));
    log.drop({ kind: 'skip' });
    expect(rowsOf(write)).toEqual([{ ev: 'drop', kind: 'skip', n: 2 }]);
  });
});