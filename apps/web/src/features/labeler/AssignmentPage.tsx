import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SchemaRenderer } from "@labelhub/schema-renderer";
import { RoutePath, Role } from "../../app/routes";
import { callLLMAssist, getAssignmentContext, saveDraft, submitAssignment } from "../../api/labeler";
import { Badge, Button, Card } from "../../ui/primitives";
import type {
  AnswerPayload,
  AssignmentContextResponse,
  LabelHubRuntimeContext,
  LLMAssistNode,
  LLMRuntimeResponse,
  ValidationError,
  ValidationResult,
} from "@labelhub/contracts";

interface AssignmentPageProps {
  role: Role;
}

export default function AssignmentPage({ role }: AssignmentPageProps) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [context, setContext] = useState<AssignmentContextResponse | null>(null);
  const [answers, setAnswers] = useState<AnswerPayload>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (assignmentId) {
          const data = await getAssignmentContext(assignmentId);
          setContext(data);
          setAnswers(data.draft?.answers ?? {});
        }
      } catch (e) {
        console.error("Failed to fetch assignment:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [assignmentId]);

  const runtimeContext: LabelHubRuntimeContext = context
    ? {
        task: {
          id: context.task.id,
          title: context.task.title,
          status: context.task.status,
          activeSchemaVersionId: context.schemaVersionId,
        },
        schema: {
          schemaId: context.schema.schemaId,
          schemaVersionId: context.schemaVersionId,
          schemaVersionNo: context.schema.schemaVersionNo,
          contractVersion: "1.1",
        },
        item: {
          id: context.item.id,
          sourcePayload: context.item.sourcePayload,
        },
        answers,
        system: {
          actor: {
            id: "usr_labeler",
            role: "LABELER",
            displayName: "标注员",
          },
          role: "LABELER",
          now: new Date().toISOString(),
        },
      }
    : {
        task: { id: "task_empty", title: "", status: "DRAFT", activeSchemaVersionId: "sv_empty" },
        schema: { schemaId: "schema_empty", schemaVersionId: "sv_empty", schemaVersionNo: 1, contractVersion: "1.1" },
        item: { id: "item_empty", sourcePayload: {} },
        answers: {},
        system: {
          actor: { id: "usr_empty", role: "LABELER", displayName: "" },
          role: "LABELER",
          now: new Date().toISOString(),
        },
      };

  const handleSaveDraft = async () => {
    if (!assignmentId) return;
    try {
      setSaving(true);
      await saveDraft(assignmentId, { answers, clientRevision: 0 });
    } catch (e) {
      console.error("Failed to save draft:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (submitAnswers: AnswerPayload, validation: ValidationResult) => {
    if (!assignmentId) return;
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    try {
      await submitAssignment(assignmentId, { answers: submitAnswers });
      window.location.href = RoutePath.LABELER_TASKS;
    } catch (e) {
      console.error("Failed to submit:", e);
    }
  };

  const handleLLMAssist = async (
    node: LLMAssistNode,
    _runtimeCtx: LabelHubRuntimeContext,
    currentAnswers: AnswerPayload,
  ): Promise<LLMRuntimeResponse> => {
    if (!assignmentId) {
      return { output: { summary: "请先选择任务" }, suggestedPatch: {}, callId: "llm_demo" };
    }
    try {
      return await callLLMAssist(assignmentId, { nodeId: node.id, answers: currentAnswers });
    } catch {
      return { output: { summary: "LLM 辅助暂时不可用" }, suggestedPatch: {}, callId: "llm_demo" };
    }
  };

  if (loading) {
    return <Card className="state-panel">加载标注工作台中...</Card>;
  }

  if (!context) {
    return <Card className="state-panel danger-text">任务不存在</Card>;
  }

  return (
    <div className="workspace-layout">
      <Card className="soft-panel">
        <h3 className="soft-panel__title">题目导航</h3>
        <div className="soft-list">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="soft-list-item">
              #{String(index + 1).padStart(3, "0")} {index === 0 ? "进行中" : index < 3 ? "已提交" : "待标"}
            </div>
          ))}
        </div>
      </Card>

      <div className="page-stack">
        <div className="page-header">
          <div>
            <h2 className="page-title">{context.task.title}</h2>
            <p className="page-subtitle">Assignment {context.assignment.id} · 当前角色 {role}</p>
          </div>
          <div className="page-actions">
            <Link to={RoutePath.LABELER_TASKS} className="lh-button">
              返回市场
            </Link>
            <Button onClick={handleSaveDraft} disabled={saving}>
              {saving ? "保存中..." : "保存草稿"}
            </Button>
          </div>
        </div>

        {context.lastReturnReason ? (
          <Card className="soft-panel">
            <Badge tone="warning">上一轮被打回</Badge>
            <p className="page-subtitle">
              {context.lastReturnReason.comments?.[0]?.message ?? "请根据审核意见修订后重新提交。"}
            </p>
          </Card>
        ) : null}

        <Card className="inset-well">
          <h3 className="soft-panel__title">原始内容</h3>
          <pre className="source-json">{JSON.stringify(context.item.sourcePayload, null, 2)}</pre>
        </Card>

        <Card className="renderer-frame">
          <SchemaRenderer
            schema={context.schema}
            context={runtimeContext}
            answers={answers}
            mode="LABELING"
            readonly={false}
            errors={errors}
            onAnswersChange={setAnswers}
            onSubmit={handleSubmit}
            onLLMAssist={handleLLMAssist}
          />
        </Card>
      </div>

      <Card className="soft-panel">
        <h3 className="soft-panel__title">我的贡献</h3>
        <div className="kpi-grid compact-kpis">
          <Badge tone="primary">已提交 62</Badge>
          <Badge tone="success">通过 54</Badge>
          <Badge tone="danger">打回 5</Badge>
        </div>
        <div className="timeline flow-spaced">
          <div className="timeline-item">
            <strong>李雷 · 提交</strong>
            <span>05-16 14:22</span>
          </div>
          <div className="timeline-item">
            <strong>AI 预审 · 打回</strong>
            <span>05-16 14:22</span>
          </div>
          <div className="timeline-item">
            <strong>当前 · 修改中</strong>
            <span>本题草稿</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
