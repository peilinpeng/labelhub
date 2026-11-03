// 后端只做管道传输与摘要，迁移规则来自共享内核。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { previewMigrationBatch } from "../packages/schema-core/src/migration-preview.ts";
import type { MigrationBatchInput } from "../packages/schema-core/src/migration-preview.ts";
import { stableStringify } from "../packages/schema-core/src/stable-hash.ts";
try {
  const input = JSON.parse(readFileSync(0, "utf8")) as MigrationBatchInput;
  const payload = previewMigrationBatch(input);
  const checksum = createHash("sha256").update(stableStringify({ input, payload })).digest("hex");
  process.stdout.write(JSON.stringify({ ...payload, checksum }));
} catch {
  process.stderr.write("迁移引擎无法处理输入\n");
  process.exitCode = 1;
}
