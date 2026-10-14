import { readFileSync } from 'node:fs';

const docsRoot = new URL('../../../docs/', import.meta.url);

/** 读取 `docs/` 下的文档（路径相对 `docs/`）。 */
export function readDoc(path: string): string {
  return readFileSync(new URL(path, docsRoot), 'utf8');
}

/**
 * 取出 `from`（含）到 `to`（不含）之间**第一个表格**的数据行，单元格已去空白。
 * 表头与 `| :--- |` 分隔行被丢弃。
 */
export function tableRows(text: string, from: string, to: string): string[][] {
  const start = text.indexOf(from);
  if (start < 0) throw new Error(`文档里找不到段落：${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  const section = text.slice(start, end);
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*:?-+/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .slice(1); // 去掉表头
}
