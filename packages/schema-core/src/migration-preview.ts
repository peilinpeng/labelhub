import type { LabelHubSchema, MigrationSubmissionInput, ValidationRule, LabelHubRuntimeContext } from "@labelhub/contracts";
import { createMigrationPlan, dryRunMigration, executeMigrationPlan } from "./migration.ts";
import type { CreateMigrationPlanOptions } from "./migration.ts";
import { collectFieldNodes } from "./traverse.ts";
import { normalizeAnswers } from "./normalization.ts";
import { validateAnswers } from "./validation.ts";
export interface MigrationBatchInput {
  oldSchema: LabelHubSchema; newSchema: LabelHubSchema;
  options: CreateMigrationPlanOptions; submissions: MigrationSubmissionInput[];
  contexts: Record<string, LabelHubRuntimeContext>;
}
function hasCustom(rules: ValidationRule[]): boolean {
  return rules.some((rule) => rule.type === "custom" || (rule.type === "conditional" && hasCustom(rule.rules)));
}
export function previewMigrationBatch(input: MigrationBatchInput) {
  const contextFor = (id: string): LabelHubRuntimeContext => {
    const context = input.contexts[id];
    if (!context) throw new Error("缺少提交的真实运行上下文");
    return context;
  };
  const plan = createMigrationPlan(input.oldSchema, input.newSchema, input.options);
  if (collectFieldNodes(input.newSchema).some((field) => hasCustom(field.validations ?? []))) {
    plan.executable = false;
    plan.blockingIssues.push("目标模板包含未注册的自定义校验，不能执行历史迁移。");
  }
  const report = dryRunMigration(plan, input.submissions, input.newSchema, { sampleLimit: 10, contextFactory: (submission) => contextFor(submission.submissionId) });
  const records = [];
  if (report.executable) {
    const execution = executeMigrationPlan(plan, input.submissions);
    for (const entry of execution.migratedSubmissions) {
      const context = { ...contextFor(entry.submissionId), answers: entry.answers };
      const normalized = normalizeAnswers(input.newSchema, entry.answers, context);
      const validation = validateAnswers(input.newSchema, normalized.answers, { ...context, answers: normalized.answers });
      if (normalized.errors.length || validation.errors.length) throw new Error("迁移产物校验失败");
      records.push({ submissionId: entry.submissionId, answers: normalized.answers, archivedAnswers: entry.archivedAnswers ?? {} });
    }
  }
  return { plan, report, records };
}
