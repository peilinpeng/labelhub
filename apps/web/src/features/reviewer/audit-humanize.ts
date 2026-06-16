// 审计事件 / 角色 / 阶段 / 决策的人话化映射。
// Reviewer 审计时间线与 Owner 质量中心共用，确保任何界面都不暴露原始 event code。

// 事件类型 / 领域动作 → 中文。覆盖 AuditEventType 与 AuditAction（auditLogs.action）。
const EVENT_LABELS: Record<string, string> = {
  // AI Assist
  AI_ASSIST_TRIGGERED: "AI 辅助已触发",
  AI_ASSIST_SHOWN: "AI 建议已展示",
  AI_ASSIST_ACCEPTED: "AI 建议已采纳",
  AI_ASSIST_EDITED: "AI 建议编辑后采纳",
  AI_ASSIST_EDITED_ACCEPTED: "AI 建议编辑后采纳",
  AI_ASSIST_DISMISSED: "AI 建议已忽略",
  AI_ASSIST_PATCH_APPLIED: "AI 修订已应用",
  AI_ASSIST_PATCH_FAILED: "AI 修订应用失败",
  // 人工审核
  REVIEW_STARTED: "审核开始",
  REVIEW_CLAIMED: "领取审核",
  REVIEW_SUBMITTED: "审核已提交",
  REVIEW_DIFF_GENERATED: "生成修订对比",
  REVIEW_DEEP_DIFF_GENERATED: "生成深度修订对比",
  REVIEW_PATCH_APPLIED: "审核修订已应用",
  REVIEW_RETURNED: "打回修改",
  REVIEW_ACCEPTED: "审核通过",
  REVIEW_REJECTED: "审核拒绝",
  FINAL_REVIEW_REQUESTED: "进入终审",
  // AI 预审
  AI_REVIEW_ENQUEUED: "AI 预审排队",
  AI_REVIEW_STARTED: "AI 预审开始",
  AI_REVIEW_SUCCEEDED: "AI 预审完成",
  AI_REVIEW_FAILED: "AI 预审失败",
  AI_REVIEW_FAILED_TO_HUMAN: "AI 预审转人工",
  AI_REVIEW_TRIGGERED: "AI 预审触发",
  AI_REVIEW_OUTPUT_GENERATED: "AI 预审输出生成",
  AI_REVIEW_GENERATED: "AI 预审结果生成",
  AI_REVIEW_CONFIRMED_BY_REVIEWER: "AI 预审被采纳",
  AI_REVIEW_REJECTED_BY_REVIEWER: "AI 预审被否决",
  // 标注 / 提交
  ASSIGNMENT_CLAIMED: "领取任务",
  ASSIGNMENT_EXPIRED: "任务领取过期",
  DRAFT_SAVED: "草稿已保存",
  SUBMISSION_CREATED: "提交已创建",
  SUBMISSION_UPDATED: "提交已更新",
  LABELING_SESSION_SUMMARY: "标注会话小结",
  FORM_ABANDONED: "标注未完成离开",
  LABELER_RISK_SIGNAL_GENERATED: "标注风险信号",
  LABELER_TRUST_LEVEL_CHANGED: "标注员信任等级变化",
  // 提交状态（少数场景下作为标签出现）
  AI_PASSED: "AI 预审通过",
  NEEDS_HUMAN_REVIEW: "待人工审核",
  // 导出 / 护照
  EXPORT_CREATED: "导出已创建",
  EXPORT_STARTED: "导出开始",
  EXPORT_SUCCEEDED: "导出完成",
  EXPORT_FAILED: "导出失败",
  EXPORT_GENERATED: "数据导出生成",
  EXPORT_WARNING_RECORDED: "导出质量警告",
  DATA_QUALITY_PASSPORT_GENERATED: "数据质量护照生成",
  // 模板治理
  SCHEMA_DRAFT_SAVED: "模板草稿已保存",
  SCHEMA_VERSION_PUBLISHED: "模板版本已发布",
  SCHEMA_PUBLISH_REQUESTED: "模板发布申请",
  SCHEMA_COMPATIBILITY_CHECKED: "模板兼容性检查",
  SCHEMA_PUBLISH_BLOCKED: "模板发布被阻断",
  SCHEMA_PUBLISH_FAILED: "模板发布失败",
  // 任务生命周期
  TASK_CREATED: "任务已创建",
  TASK_PUBLISHED: "任务已发布",
  DATASET_IMPORTED: "数据集已导入",
};

export function auditEventLabel(code: string | undefined | null): string {
  if (!code) return "审计记录";
  return EVENT_LABELS[code] ?? "审计记录";
}

// actor role → 人话；未识别回退「系统」。
const ROLE_LABELS: Record<string, string> = {
  OWNER: "任务负责人",
  REVIEWER: "审核员",
  LABELER: "标注员",
  SYSTEM: "系统",
  ADMIN: "管理员",
};

export function actorRoleLabel(role: string | undefined | null): string {
  if (!role) return "系统";
  return ROLE_LABELS[role] ?? "系统";
}

// 审核阶段
const STAGE_LABELS: Record<string, string> = {
  AI_PRECHECK: "AI 预审",
  HUMAN_REVIEW: "人工审核",
  FINAL_REVIEW: "终审",
};

export function reviewStageLabel(stage: string | undefined | null): string {
  if (!stage) return "审核";
  return STAGE_LABELS[stage] ?? "审核";
}

// 审核决策
const DECISION_LABELS: Record<string, string> = {
  PASS: "通过",
  RETURN: "打回",
  REJECT: "拒绝",
  NEED_HUMAN_REVIEW: "转人工",
};

export function reviewDecisionLabel(decision: string | undefined | null): string {
  if (!decision) return "—";
  return DECISION_LABELS[decision] ?? "—";
}
