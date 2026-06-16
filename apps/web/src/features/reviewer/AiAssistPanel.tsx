import { useEffect, useMemo, useState } from "react";
import type {
  AiAssistActionType,
  AiAssistPatchOperation,
  AiAssistSuggestion,
  AiAssistSuggestionStatus,
} from "@labelhub/contracts";
import { Badge, Button, Card, Textarea } from "../../ui/primitives";
import { listAiAssistSuggestions, submitAiAssistAction } from "../../api/ai-assist";

interface AiAssistPanelProps {
  submissionId: string;
  /** 动作成功后通知父组件（用于刷新审计时间线 / 审核详情）。 */
  onActionApplied?: () => void;
}

const STATUS_LABELS: Record<AiAssistSuggestionStatus, string> = {
  PENDING: "待处理",
  ACCEPTED: "已采纳",
  EDIT_ACCEPTED: "编辑后采纳",
  DISMISSED: "已忽略",
  APPLY_FAILED: "应用失败",
};

const SEVERITY_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const FIELD_LABELS: Record<string, string> = {
  submission_material: "补充审核材料",
  answer: "标注答案",
  title: "标题",
  content: "内容",
  category: "分类",
  evidence: "证据说明",
  comment: "备注",
};

function statusTone(status: AiAssistSuggestionStatus): "default" | "primary" | "success" | "warning" | "danger" {
  switch (status) {
    case "ACCEPTED":
    case "EDIT_ACCEPTED":
      return "success";
    case "DISMISSED":
      return "default";
    case "APPLY_FAILED":
      return "danger";
    default:
      return "primary";
  }
}

function severityTone(severity: string): "default" | "warning" | "danger" {
  if (severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warning";
  return "default";
}

function formatValue(value: unknown, fieldName?: string): string {
  if (value === undefined || value === null || value === "") return "（空）";
  if (fieldName === "submission_material" && typeof value === "string") {
    return "建议补充本次审核所需的题目内容、标注结果和审核依据，再进行复核。";
  }
  if (Array.isArray(value)) return value.length > 0 ? value.map((item) => String(item)).join("、") : "（空）";
  if (typeof value === "object") return "已填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  return humanizeAiText(String(value));
}

export function AiAssistPanel({ submissionId, onActionApplied }: AiAssistPanelProps) {
  const [suggestions, setSuggestions] = useState<AiAssistSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await listAiAssistSuggestions(submissionId);
        if (!cancelled) {
          setSuggestions(result);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setLoadError("AI 建议加载失败，请稍后重试。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  const pendingCount = useMemo(
    () => suggestions.filter((item) => item.status === "PENDING").length,
    [suggestions],
  );

  const applyAction = async (
    suggestion: AiAssistSuggestion,
    action: AiAssistActionType,
    editedPatch?: AiAssistPatchOperation[],
  ) => {
    if (suggestion.status !== "PENDING") return; // 不能重复采纳/处理
    setPendingId(suggestion.id);
    setActionError(null);
    try {
      const response = await submitAiAssistAction(submissionId, suggestion.id, {
        action,
        editedPatch: editedPatch ?? null,
      });
      setSuggestions((current) =>
        current.map((item) => (item.id === suggestion.id ? response.suggestion : item)),
      );
      setEditingId(null);
      onActionApplied?.();
    } catch {
      setActionError("操作失败，请稍后重试");
    } finally {
      setPendingId(null);
    }
  };

  const startEdit = (suggestion: AiAssistSuggestion) => {
    const draft: Record<string, string> = {};
    for (const op of suggestion.structuredPatch ?? []) {
      draft[op.fieldName] = formatValue(op.nextValue, op.fieldName);
    }
    setEditDraft(draft);
    setEditingId(suggestion.id);
    setActionError(null);
  };

  const confirmEdit = (suggestion: AiAssistSuggestion) => {
    const editedPatch: AiAssistPatchOperation[] = (suggestion.structuredPatch ?? []).map((op) => ({
      fieldName: op.fieldName,
      previousValue: op.previousValue,
      nextValue: editDraft[op.fieldName] ?? "",
    }));
    void applyAction(suggestion, "edit_accept", editedPatch);
  };

  return (
    <Card className="review-ai-assist">
      <div className="review-ai-assist__head">
        <div>
          <span className="review-ai-assist__eyebrow">AI Assist</span>
          <h3>AI 建议一键采纳</h3>
          <p>审核员可一键采纳、编辑后采纳或忽略 AI 给出的字段级修订建议。</p>
        </div>
        <Badge tone={pendingCount > 0 ? "primary" : "default"}>待处理 {pendingCount}</Badge>
      </div>

      {actionError ? (
        <div className="review-ai-assist__error" role="alert">{actionError}</div>
      ) : null}

      {loading ? (
        <div className="empty-state">加载 AI 建议中...</div>
      ) : loadError ? (
        <div className="empty-state">{loadError}</div>
      ) : suggestions.length === 0 ? (
        <div className="empty-state">该提交暂无 AI 建议。AI 预审给出字段级建议后，这里会显示可采纳项。</div>
      ) : (
        <ul className="review-ai-assist__list">
          {suggestions.map((suggestion) => {
            const isPending = suggestion.status === "PENDING";
            const isBusy = pendingId === suggestion.id;
            const isEditing = editingId === suggestion.id;
            const patch = suggestion.structuredPatch ?? [];
            const canEditAccept = patch.length > 0;
            return (
              <li className="review-ai-assist__item" key={suggestion.id}>
                <div className="review-ai-assist__item-head">
                  <div className="review-ai-assist__tags">
                    <Badge tone={severityTone(suggestion.severity)}>
                      严重度 {SEVERITY_LABELS[suggestion.severity] ?? suggestion.severity}
                    </Badge>
                    {typeof suggestion.confidence === "number" ? (
                      <Badge tone="default">置信度 {Math.round(suggestion.confidence * 100)}%</Badge>
                    ) : null}
                  </div>
                  <Badge tone={statusTone(suggestion.status)}>{STATUS_LABELS[suggestion.status]}</Badge>
                </div>

                <p className="review-ai-assist__summary">{humanizeAiText(suggestion.summary)}</p>

                {patch.length > 0 ? (
                  <div className="review-ai-assist__diff">
                    {patch.map((op) => (
                      <div className="review-ai-assist__diff-row" key={op.fieldName}>
                        <span className="review-ai-assist__diff-field" title={`字段：${op.fieldName}`}>{fieldLabel(op.fieldName)}</span>
                        <span className="review-ai-assist__prev">{formatValue(op.previousValue, op.fieldName)}</span>
                        <em className="review-ai-assist__arrow" aria-hidden="true">→</em>
                        {isEditing ? (
                          <Textarea
                            className="review-ai-assist__edit"
                            rows={2}
                            value={editDraft[op.fieldName] ?? ""}
                            onChange={(event) =>
                              setEditDraft((current) => ({ ...current, [op.fieldName]: event.target.value }))
                            }
                          />
                        ) : (
                          <span className="review-ai-assist__next">{formatValue(op.nextValue, op.fieldName)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="review-ai-assist__notice">该建议无字段级改动，可直接采纳或忽略。</div>
                )}

                {isPending ? (
                  isEditing ? (
                    <div className="review-ai-assist__actions">
                      <Button className="review-ai-assist__btn" disabled={isBusy} onClick={() => confirmEdit(suggestion)}>
                        确认采纳
                      </Button>
                      <Button className="review-ai-assist__btn" tone="ghost" disabled={isBusy} onClick={() => setEditingId(null)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="review-ai-assist__actions">
                      <Button className="review-ai-assist__btn" disabled={isBusy} onClick={() => void applyAction(suggestion, "accept")}>
                        一键采纳
                      </Button>
                      <Button className="review-ai-assist__btn" tone="ghost" disabled={isBusy || !canEditAccept} onClick={() => startEdit(suggestion)}>
                        编辑后采纳
                      </Button>
                      <Button
                        className="review-ai-assist__btn review-ai-assist__btn--dismiss"
                        tone="ghost"
                        disabled={isBusy}
                        onClick={() => void applyAction(suggestion, "dismiss")}
                      >
                        忽略建议
                      </Button>
                    </div>
                  )
                ) : (
                  <div className="review-ai-assist__resolved">
                    {suggestion.status === "APPLY_FAILED"
                      ? "该建议已记录采纳，但修订未能应用到本提交。"
                      : `已处理：${STATUS_LABELS[suggestion.status]}`}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeAiText(text?: string): string {
  if (!text) return "";
  return text
    .replace(/补充完整本次标注审核所需的全部基础材料[^。]*。?/g, "建议补充本次审核所需的题目内容、标注结果和审核依据，再进行复核。")
    .replace(/缺少具体的题目内容、标注答案和对应schema的详细信息，无法进行自动维度评分。/g, "提交内容较少，AI 无法判断答案是否符合题目要求，建议人工复核。")
    .replace(/目标标注schema/g, "目标标注规则")
    .replace(/标注schema/g, "标注规则")
    .replace(/schema/g, "表单规则")
    .replace(/自动维度评分/g, "自动评分")
    .replace(/自动预审打分/g, "自动评分");
}
