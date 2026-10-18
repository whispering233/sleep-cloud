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
