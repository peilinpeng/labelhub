import { build } from "vite";

const mode = process.argv[2];
if (!['demo', 'production'].includes(mode)) {
  throw new Error('构建模式必须是 demo 或 production');
}
// 在加载 Vite 配置前设置环境变量，兼容 Windows 与 Unix shell。
process.env.VITE_ENABLE_MSW = String(mode === 'demo');
if (mode === 'demo') process.env.VITE_DEMO_MODE = 'true';
await build();
