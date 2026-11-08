import { readFileSync } from "node:fs";
import type { AIAssistEngineInput } from "@labelhub/contracts";
import { runAIAssistEngine } from "../packages/schema-compiler/src/ai-workflow.ts";
try {
  const input = JSON.parse(readFileSync(0, "utf8")) as AIAssistEngineInput;
  process.stdout.write(JSON.stringify(runAIAssistEngine(input)));
} catch {
  process.stderr.write("AI 输入或输出未通过共享 Schema 校验\n");
  process.exitCode = 1;
}
