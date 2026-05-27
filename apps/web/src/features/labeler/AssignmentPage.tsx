import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { getAssignmentContext, saveDraft, submitAssignment, callLLMAssist } from "../../api/labeler";
import { SchemaRenderer } from "@labelhub/schema-renderer";
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
  const { taskId, itemId } = useParams<{ taskId: string; itemId: string }>();
  const [context, setContext] = useState<AssignmentContextResponse | null>(null);
  const [answers, setAnswers] = useState<AnswerPayload>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (taskId && itemId) {
          const data = await getAssignmentContext(taskId, itemId);
          setContext(data);
          setAnswers(data.draft?.answers ?? {});
        }
      } catch (e) {
        console.error("Failed to fetch assignment:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId, itemId]);

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
            id: "usr_labeler" as const,
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
    if (!taskId || !itemId) return;
    try {
      setSaving(true);
      await saveDraft(taskId, itemId, { answers, clientRevision: 0 });
      alert("草稿已保存");
    } catch (e) {
      console.error("Failed to save draft:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (submitAnswers: AnswerPayload, validation: ValidationResult) => {
    if (!taskId || !itemId) return;
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    try {
      await submitAssignment(taskId, itemId, { answers: submitAnswers });
      alert("提交成功");
      window.location.href = RoutePath.LABELER_TASKS;
    } catch (e) {
      console.error("Failed to submit:", e);
    }
  };

  const handleLLMAssist = async (
    _node: LLMAssistNode,
    _runtimeCtx: LabelHubRuntimeContext,
    _currentAnswers: AnswerPayload
  ): Promise<LLMRuntimeResponse> => {
    if (!taskId || !itemId) {
      return {
        output: { summary: "请先选择任务" },
        suggestedPatch: {},
        callId: "llm_demo",
      };
    }
    try {
      return await callLLMAssist(taskId, itemId);
    } catch (e) {
      return {
        output: { summary: "LLM 辅助暂时不可用" },
        suggestedPatch: {},
        callId: "llm_demo",
      };
    }
  };

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  if (!context) {
    return <div style={styles.error}>任务不存在</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to={RoutePath.LABELER_TASKS} style={styles.backLink}>← 返回任务市场</Link>
          <h2 style={styles.title}>标注工作台</h2>
          <span style={styles.role}>{role}</span>
        </div>
        <div style={styles.actions}>
          <button style={styles.saveButton} onClick={handleSaveDraft} disabled={saving}>
            {saving ? "保存中..." : "保存草稿"}
          </button>
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.sourcePanel}>
          <h3 style={styles.sourceTitle}>待标注内容</h3>
          <pre style={styles.sourceContent}>
            {JSON.stringify(context.item.sourcePayload, null, 2)}
          </pre>
        </div>

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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "20px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  backLink: {
    color: "#4caf50",
    textDecoration: "none",
    fontSize: "0.9rem",
  },
  title: {
    fontSize: "1.8rem",
    color: "#1a1a2e",
  },
  role: {
    backgroundColor: "#4caf50",
    color: "white",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  actions: {
    display: "flex",
    gap: "10px",
  },
  saveButton: {
    padding: "10px 20px",
    backgroundColor: "#3d3d5c",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  content: {
    backgroundColor: "white",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    padding: "20px",
  },
  sourcePanel: {
    marginBottom: "20px",
    padding: "15px",
    backgroundColor: "#f5f7fa",
    borderRadius: "8px",
  },
  sourceTitle: {
    fontSize: "1rem",
    marginBottom: "10px",
    color: "#666",
  },
  sourceContent: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    fontSize: "0.9rem",
    color: "#333",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "200px",
    fontSize: "1.2rem",
    color: "#666",
  },
  error: {
    backgroundColor: "#ffebee",
    color: "#c62828",
    padding: "15px",
    borderRadius: "5px",
  },
};