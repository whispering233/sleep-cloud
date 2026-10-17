import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// 后端起始端口；被占就从 +1 起继续找（并行 worktree 各自落到不同端口）。
export const BASE_PORT = 8787;

const PORT_FILE = fileURLToPath(new URL('../../.wrangler/dev-port', import.meta.url));
const WRANGLER_DIR = fileURLToPath(new URL('../../.wrangler/', import.meta.url));

export function readDevPort() {
  try {
    const port = Number(readFileSync(PORT_FILE, 'utf8').trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function writeDevPort(port) {
  mkdirSync(WRANGLER_DIR, { recursive: true });
  writeFileSync(PORT_FILE, `${port}\n`);
}

function isBindable(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ port, host: '127.0.0.1' }, () => probe.close(() => resolve(true)));
  });
}

export async function findFreePort(start, tries = 100) {
  for (let port = start; port < start + tries; port += 1) {
    if (await isBindable(port)) return port;
  }
  throw new Error(`no free port in ${start}..${start + tries - 1}`);
}
