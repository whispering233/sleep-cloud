import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 读取 `docs/` 下的文档（路径相对 `docs/`；测试从仓库根目录跑）。 */
export function readDoc(path: string): string {
  return readFileSync(join(process.cwd(), 'docs', path), 'utf8');
}

/**
 * 取出 `from`（含）到 `to`（不含）之间**第 `tableIndex` 个表格**的数据行，单元格已去空白。
 * 表头与 `| :--- |` 分隔行被丢弃。
 */
export function tableRows(text: string, from: string, to: string, tableIndex = 0): string[][] {
  const start = text.indexOf(from);
  if (start < 0) throw new Error(`文档里找不到段落：${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  const lines = text.slice(start, end).split('\n');

  // 连续的表行构成一个表格；非表行结束当前表格
  const tables: string[][][] = [];
  let current: string[][] | null = null;
  for (const line of lines) {
    if (line.startsWith('|')) {
      current ??= [];
      current.push(
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);

  const table = tables[tableIndex];
  if (!table) throw new Error(`段落里找不到第 ${tableIndex} 个表格：${from}`);
  return table.filter((row) => !/^:?-+:?$/.test(row[0] ?? '')).slice(1); // 去分隔行与表头
}
