import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default async function setup() {
  const manifest = process.env.CONTROLLED_AI_MANIFEST;
  const python = process.env.LABELHUB_PYTHON;
  if (!manifest || !python || !process.env.CONTROLLED_MODEL_TOKEN) {
    throw new Error("请从仓库根使用 npm run e2e:ai 创建隔离栈；禁止直接指向现有后端。");
  }
  execFileSync(python, [fileURLToPath(new URL("../../../scripts/controlled_ai.py", import.meta.url)), "--verify", manifest], { stdio: "inherit" });
}
