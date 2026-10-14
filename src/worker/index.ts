import app from './app';

// 房间服务类必须从入口模块导出，平台才能按 `migrations` 注册它
export { Hall } from '../hall/hall';

export default app;
