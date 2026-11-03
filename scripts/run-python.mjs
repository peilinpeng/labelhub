import { spawnSync } from "node:child_process";

// Windows 使用已激活的 Python 环境；Unix 保留原有 python3 入口。
const interpreter = process.env.LABELHUB_PYTHON
  || (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(interpreter, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error("无法启动 Python；请激活 Python 3 环境或设置 LABELHUB_PYTHON 为解释器路径。");
}
process.exit(result.status ?? 1);
