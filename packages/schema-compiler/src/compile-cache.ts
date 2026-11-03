import type { LabelHubSchema } from "@labelhub/contracts";
import { stableStringify } from "@labelhub/schema-core";
import { buildDependencyGraph } from "./dependency-graph.ts";
import type { DependencyGraph } from "./dependency-graph.ts";
import { buildReactionPlan } from "./formily-reaction-visitor.ts";
import type { ReactionPlan } from "./formily-reaction-visitor.ts";

export interface CompiledSchema { graph: DependencyGraph; reactionPlan: ReactionPlan }

/** 完整内容键保证同 ID 的草稿变化也失效；副本隔离调用方写入。 */
export class SchemaCompileCache {
  private readonly entries = new Map<string, { result: CompiledSchema; bytes: number }>();
  private bytes = 0;
  constructor(private readonly maxEntries = 20, private readonly maxBytes = 8 * 1024 * 1024) {}
  compile(schema: LabelHubSchema): CompiledSchema {
    const key = stableStringify(schema);
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return structuredClone(hit.result);
    }
    const result = { graph: buildDependencyGraph(schema), reactionPlan: buildReactionPlan(schema) };
    const bytes = (key.length + JSON.stringify(result).length) * 2;
    if (this.maxEntries > 0 && bytes <= this.maxBytes) {
      while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.bytes -= this.entries.get(oldest)!.bytes;
        this.entries.delete(oldest);
      }
      this.entries.set(key, { result: structuredClone(result), bytes });
      this.bytes += bytes;
    }
    return result;
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
  get size(): number { return this.entries.size; }
}
const cache = new SchemaCompileCache();
export const compileSchema = (schema: LabelHubSchema): CompiledSchema => cache.compile(schema);
