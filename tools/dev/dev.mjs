import { spawn } from 'node:child_process';
import { BASE_PORT, findFreePort, writeDevPort } from './dev-port.mjs';

const port = await findFreePort(BASE_PORT);
// wrangler 的 inspector 默认也抢 9229；按主端口偏移再探测，避免并行 worktree 撞车。
const inspectorPort = await findFreePort(port + 1000);
writeDevPort(port);

const child = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(port), '--inspector-port', String(inspectorPort)],
  { stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
