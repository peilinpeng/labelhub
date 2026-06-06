import type { ReviewPatch } from "@labelhub/contracts";

/**
 * 顶层字段 shallow diff，将 beforeAnswers 与 afterAnswers 比较，返回 patches 列表。
 * 只做顶层字段比较，值比较使用 JSON.stringify，不引入 schema-core，不生成 hash。
 */
export function computeReviewPatches(
  beforeAnswers: Record<string, unknown>,
  afterAnswers: Record<string, unknown>,
): ReviewPatch[] {
  const patches: ReviewPatch[] = [];
  const allKeys = new Set([
    ...Object.keys(beforeAnswers),
    ...Object.keys(afterAnswers),
  ]);

  for (const fieldName of allKeys) {
    const hasBefore = Object.prototype.hasOwnProperty.call(beforeAnswers, fieldName);
    const hasAfter = Object.prototype.hasOwnProperty.call(afterAnswers, fieldName);

    if (!hasBefore) {
      patches.push({
        fieldName,
        previousValue: undefined,
        nextValue: afterAnswers[fieldName],
        reason: "审核员新增字段",
      });
    } else if (!hasAfter) {
      patches.push({
        fieldName,
        previousValue: beforeAnswers[fieldName],
        nextValue: undefined,
        reason: "审核员删除字段",
      });
    } else if (JSON.stringify(beforeAnswers[fieldName]) !== JSON.stringify(afterAnswers[fieldName])) {
      patches.push({
        fieldName,
        previousValue: beforeAnswers[fieldName],
        nextValue: afterAnswers[fieldName],
        reason: "审核员修改字段值",
      });
    }
  }

  return patches;
}
