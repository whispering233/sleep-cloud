/**
 * 构建期注入的全局量（`vite.config.ts` 的 `define`）：`package.json` 的 `version`。
 *
 * 放在 `src/` 根而不是 `src/client/`：前端 tsconfig 与根 tsconfig 都显式包含它，
 * 否则编辑器（按根 tsconfig 解析 `src/client/*`）会把 `__APP_VERSION__` 报成未定义。
 * 客户端**不** `import` `package.json`——那会把整个文件打进产物，而我们只要一个字符串。
 */
declare const __APP_VERSION__: string;
