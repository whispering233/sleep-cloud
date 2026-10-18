/// <reference types="vite/client" />
// 上面的三斜线不是为了 `vite` 本身，而是为了 `./styles/app.css` 这类**副作用导入**的类型声明：
// 它只活在 `vite/client` 里，而「编辑器 / 语言服务」不一定按本文件的引擎配置（`tsconfig.client.json`）
// 解析 `src/client/**`，会把 CSS 导入报成「找不到模块」。写在这里就不依赖工程配置怎么被选中。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { startMoveProbe } from './move-probe';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// `?debug=1` 才启动位置同步探针（订阅 + 10s 定时器）：不带参数时一行代码都不跑
if (new URLSearchParams(location.search).get('debug') === '1') startMoveProbe();
