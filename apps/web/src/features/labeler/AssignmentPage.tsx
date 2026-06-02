import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SchemaRenderer } from "@labelhub/schema-renderer";
import { RoutePath, Role } from "../../app/routes";
import { callLLMAssist, getAssignmentContext, saveDraft } from "../../api/labeler";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { AIReviewPanel, Badge, Button, Card } from "../../ui/primitives";
import { submitDemoAssignment } from "../../mocks/demo-workflow-store";
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

export default function AssignmentPage({ role: _role }: AssignmentPageProps) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const [context, setContext] = useState<AssignmentContextResponse | null>(null);
  const [answers, setAnswers] = useState<AnswerPayload>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [pendingSubmitAnswers, setPendingSubmitAnswers] = useState<AnswerPayload | null>(null);
  const itemNav = Array.from({ length: 20 }, (_, index) => {
    const status = index === 2 ? "Current" : index < 2 ? "Submitted" : index === 5 ? "Returned" : "Draft";
    return {
      id: `item_${String(index + 1).padStart(3, "0")}`,
      label: `#${String(index + 1).padStart(3, "0")}`,
      status,
    };
  });

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
    requestDemoSubmit(submitAnswers);
  };

  const confirmDemoSubmit = (submitAnswers: AnswerPayload = answers) => {
    submitDemoAssignment(submitAnswers);
    setSubmitNotice("提交成功，已进入 Reviewer 审核队列。");
    window.setTimeout(() => navigate(RoutePath.REVIEWER_QUEUE), 650);
  };

  const requestDemoSubmit = (submitAnswers: AnswerPayload = answers) => {
    if (shouldSuppressConfirm(CONFIRM_KEYS.submit)) {
      confirmDemoSubmit(submitAnswers);
      return;
    }
    setPendingSubmitAnswers(submitAnswers);
    setSubmitConfirmOpen(true);
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
    <div className="labeler-workbench page-stack">
      <div className="page-header labeler-workbench-header">
        <div>
          <Badge tone="primary">LABELING</Badge>
          <h2 className="page-title">标注工作台</h2>
          <p className="page-subtitle">查看任务数据，依据动态 Schema 完成标注并提交</p>
          <div className="labeler-header-meta">
            <span>{context.task.title}</span>
            <span>Item 3 / 20</span>
            <Badge tone={saving ? "warning" : "success"}>{saving ? "保存中" : "草稿已保存"}</Badge>
          </div>
        </div>
        <div className="labeler-workbench-actions">
          <Button onClick={handleSaveDraft} disabled={saving}>
            {saving ? "保存中..." : "保存草稿"}
          </Button>
          <Button tone="primary" onClick={() => requestDemoSubmit()}>
            提交标注
          </Button>
        </div>
      </div>

      <div className="labeler-workbench-layout">
        <Card className="labeler-side-panel labeler-item-panel">
          <div className="labeler-panel-heading">
            <div>
              <h3>Item 导航</h3>
              <p>当前任务进度</p>
            </div>
            <Badge tone="primary">3 / 20</Badge>
          </div>
          <div className="labeler-progress-summary">
            <div className="soft-progress soft-progress--wide" aria-label="标注进度">
              <span className="soft-progress__bar" />
            </div>
            <span>已完成 10%</span>
          </div>
          <div className="labeler-item-list">
            {itemNav.map((item) => (
              <button
                className={[
                  "labeler-item-row",
                  item.status === "Current" ? "labeler-item-row--current" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
                type="button"
              >
                <span>{item.label}</span>
                <Badge
                  tone={
                    item.status === "Submitted"
                      ? "success"
                      : item.status === "Returned"
                        ? "danger"
                        : item.status === "Current"
                          ? "primary"
                          : "warning"
                  }
                >
                  {item.status}
                </Badge>
              </button>
            ))}
          </div>
          <div className="labeler-nav-actions">
            <Button>上一题</Button>
            <Button>下一题</Button>
          </div>
        </Card>

        <main className="labeler-main-workspace">
          {context.lastReturnReason ? (
            <Card className="labeler-return-card">
              <Badge tone="warning">上一轮被打回</Badge>
              <p>{context.lastReturnReason.comments?.[0]?.message ?? "请根据审核意见修订后重新提交。"}</p>
            </Card>
          ) : null}

          {submitNotice ? (
            <Card className="labeler-return-card">
              <Badge tone="success">提交成功</Badge>
              <p>{submitNotice}</p>
            </Card>
          ) : null}

          <Card className="labeler-source-card">
            <div className="labeler-card-heading">
              <div>
                <h3>原始数据</h3>
                <p>{context.item.id}</p>
              </div>
              <Badge tone="primary">Source</Badge>
            </div>
            <div className="labeler-source-content">
              <pre className="source-json">{JSON.stringify(context.item.sourcePayload, null, 2)}</pre>
            </div>
          </Card>

          <Card className="labeler-form-card">
            <div className="labeler-card-heading">
              <div>
                <h3>标注表单</h3>
                <p>SchemaRenderer LABELING mode</p>
              </div>
              <Badge tone={errors.length > 0 ? "warning" : "success"}>
                {errors.length > 0 ? `${errors.length} 个问题` : "可填写"}
              </Badge>
            </div>
            <div className="renderer-frame labeler-renderer-frame labeler-schema-renderer-surface">
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
            </div>
            <div className="labeler-bottom-actions">
              <Button>上一题</Button>
              <Button>下一题</Button>
              <Button onClick={handleSaveDraft} disabled={saving}>
                保存草稿
              </Button>
              <Button tone="primary" onClick={() => requestDemoSubmit()}>
                提交标注
              </Button>
            </div>
          </Card>
        </main>

        <aside className="labeler-side-panel labeler-assist-panel">
          <Card className="labeler-assist-card">
            <div className="labeler-card-heading">
              <div>
                <h3>任务说明</h3>
                <p>标注规则、质量要求、示例</p>
              </div>
            </div>
            <div className="labeler-rule-list">
              <div>
                <strong>标注规则</strong>
                <span>阅读原始内容后按 Schema 字段完成判断。</span>
              </div>
              <div>
                <strong>质量要求</strong>
                <span>理由需可追溯，避免空泛描述。</span>
              </div>
              <div>
                <strong>示例</strong>
                <span>优先关注标题、事实一致性与来源可信度。</span>
              </div>
            </div>
          </Card>

          <AIReviewPanel title="LLM Assist" badge={<Badge tone="primary">辅助</Badge>} className="labeler-llm-panel">
            <p>可用于生成建议、解释规则、辅助判断。最终答案仍由标注员确认。</p>
            <div className="labeler-assist-actions">
              <Button>生成建议</Button>
              <Button>解释规则</Button>
            </div>
          </AIReviewPanel>

          <Card className="labeler-assist-card">
            <div className="labeler-card-heading">
              <div>
                <h3>校验摘要</h3>
                <p>提交前检查</p>
              </div>
              <Badge tone={errors.length > 0 ? "warning" : "success"}>
                {errors.length > 0 ? "待修正" : "无阻塞"}
              </Badge>
            </div>
            <div className="labeler-check-list">
              <div>
                <span className="schema-check-dot schema-check-dot--done" />
                <strong>必填字段</strong>
                <Badge tone="success">已检查</Badge>
              </div>
              <div>
                <span className={errors.length > 0 ? "schema-check-dot" : "schema-check-dot schema-check-dot--done"} />
                <strong>格式问题</strong>
                <Badge tone={errors.length > 0 ? "warning" : "success"}>{errors.length}</Badge>
              </div>
              <div>
                <span className="schema-check-dot" />
                <strong>提交前检查</strong>
                <Badge tone="warning">待提交</Badge>
              </div>
            </div>
          </Card>

          <Link to={RoutePath.LABELER_TASKS} className="lh-button">
            返回任务市场
          </Link>
        </aside>
      </div>

      <ConfirmDialog
        open={submitConfirmOpen}
        title="确认提交标注？"
        description="提交后将进入 AI 预审与人工审核流程。"
        confirmText="提交标注"
        cancelText="继续编辑"
        suppressLabel="本次会话不再提醒提交确认"
        onCancel={() => {
          setSubmitConfirmOpen(false);
          setPendingSubmitAnswers(null);
        }}
        onConfirm={(suppress) => {
          if (suppress) {
            suppressConfirmForSession(CONFIRM_KEYS.submit);
          }
          setSubmitConfirmOpen(false);
          confirmDemoSubmit(pendingSubmitAnswers ?? answers);
          setPendingSubmitAnswers(null);
        }}
      />
    </div>
  );
}
