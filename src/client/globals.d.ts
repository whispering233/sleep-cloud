/**
 * 构建期注入的全局量（`vite.config.ts` 的 `define`）。客户端不读 `package.json`——
 * 声明在这里，`tsconfig.client.json` 的 `include` 覆盖 `src/client`，前端代码才有类型。
 */
declare const __APP_VERSION__: string;
