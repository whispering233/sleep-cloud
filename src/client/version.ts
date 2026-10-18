/**
 * 构建期注入的版本号（`vite.config.ts` 的 `define`，取自 `package.json` 的 `version`）。
 *
 * **声明写在模块内部，而不是仓库根的全局 `.d.ts`**：全局声明只在「文件被某个 tsconfig 收录」时可见，
 * 而 `src/client/**` 只被 `tsconfig.client.json` 收录；编辑器 / TS 语言服务只自动加载 `tsconfig.json`，
 * 于是全局声明在那里漏掉、把 `__APP_VERSION__` 报成未定义。放进模块后，任何工程形态都能编译。
 *
 * 客户端**不** `import` `package.json`——那会把整个文件打进产物，而我们只要一个字符串。
 */
declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;
