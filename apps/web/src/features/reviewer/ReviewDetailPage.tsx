import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { getReviewDetail, claimReview, decideReview } from "../../api/reviewer";
import { SchemaRenderer } from "@labelhub/schema-renderer";
import type {
  LabelHubRuntimeContext,
  ReviewDetailResponse,
  ReviewDecisionRequest,
  ReviewPatch,
} from "@labelhub/contracts";

interface ReviewDetailPageProps {
  role: Role;
}

export default function ReviewDetailPage({ role }: ReviewDetailPageProps) {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [mode, setMode] = useState<"REVIEW_READONLY" | "REVIEW_DIFF">("REVIEW_READONLY");
  const [patches, setPatches] = useState<ReviewPatch[]>([]);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (submissionId) {
          const data = await getReviewDetail(submissionId);
          setDetail(data);
          setPatches([]);
        }
      } catch (e) {
        console.error("Failed to fetch review detail:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId]);

  const runtimeContext: LabelHubRuntimeContext = detail
    ? {
        task: {
          id: detail.task.id,
          title: detail.task.title,
          status: detail.task.status,
          activeSchemaVersionId: detail.schemaVersionId,
        },
        schema: {
          schemaId: detail.schema.schemaId,
          schemaVersionId: detail.schemaVersionId,
          schemaVersionNo: detail.schema.schemaVersionNo,
          contractVersion: "1.1",
        },
        item: {
          id: detail.item.id,
          sourcePayload: detail.item.sourcePayload,
        },
        answers: detail.submission.answers,
        review: {
          patches,
        },
        system: {
          actor: {
            id: "usr_reviewer",
            role: "REVIEWER",
            displayName: "审核员",
          },
          role: "REVIEWER",
          now: new Date().toISOString(),
        },
      }
    : {
        task: { id: "task_empty", title: "", status: "DRAFT", activeSchemaVersionId: "sv_empty" },
        schema: { schemaId: "schema_empty", schemaVersionId: "sv_empty", schemaVersionNo: 1, contractVersion: "1.1" },
        item: { id: "item_empty", sourcePayload: {} },
        answers: {},
        system: {
          actor: { id: "usr_empty", role: "REVIEWER", displayName: "" },
          role: "REVIEWER",
          now: new Date().toISOString(),
        },
      };

  const handleClaimReview = async () => {
    if (!submissionId) return;
    try {
      setClaiming(true);
      await claimReview(submissionId);
      alert("已领取审核");
      window.location.reload();
    } catch (e) {
      console.error("Failed to claim review:", e);
    } finally {
      setClaiming(false);
    }
  };

  const handleDecision = async (decision: "PASS" | "RETURN" | "REJECT") => {
    if (!submissionId) return;
    try {
      setDeciding(true);
      const request: ReviewDecisionRequest = {
        submissionId: submissionId as ReviewDecisionRequest["submissionId"],
        decision,
        stage: "HUMAN_REVIEW",
        comments: comments ? [{ message: comments }] : undefined,
        reason: decision === "RETURN" ? "需要修改" : undefined,
      };
      await decideReview(submissionId, request);
      alert(`审核已${decision === "PASS" ? "通过" : decision === "RETURN" ? "退回" : "拒绝"}`);
      window.location.href = RoutePath.REVIEWER_QUEUE;
    } catch (e) {
      console.error("Failed to make decision:", e);
    } finally {
      setDeciding(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  if (!detail) {
    return <div style={styles.error}>审核详情不存在</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to={RoutePath.REVIEWER_QUEUE} style={styles.backLink}>← 返回</Link>
          <h2 style={styles.title}>审核详情</h2>
          <span style={styles.role}>{role}</span>
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.infoPanel}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>提交状态:</span>
            <span style={styles.infoValue}>{detail.submission.status}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>任务:</span>
            <span style={styles.infoValue}>{detail.task.title}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>标注员:</span>
            <span style={styles.infoValue}>{detail.submission.labelerId}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>提交时间:</span>
            <span style={styles.infoValue}>{detail.submission.createdAt}</span>
          </div>
        </div>

        <div style={styles.sourcePanel}>
          <h3 style={styles.panelTitle}>源数据</h3>
          <pre style={styles.sourceContent}>
            {JSON.stringify(detail.item.sourcePayload, null, 2)}
          </pre>
        </div>

        <div style={styles.modeSelector}>
          <button
            style={{
              ...styles.modeButton,
              backgroundColor: mode === "REVIEW_READONLY" ? "#ff9800" : "#ddd",
              color: mode === "REVIEW_READONLY" ? "white" : "#333",
            }}
            onClick={() => setMode("REVIEW_READONLY")}
          >
            只读查看
          </button>
          <button
            style={{
              ...styles.modeButton,
              backgroundColor: mode === "REVIEW_DIFF" ? "#ff9800" : "#ddd",
              color: mode === "REVIEW_DIFF" ? "white" : "#333",
            }}
            onClick={() => setMode("REVIEW_DIFF")}
          >
            修改对比
          </button>
        </div>

        <SchemaRenderer
          schema={detail.schema}
          context={runtimeContext}
          answers={detail.submission.answers}
          mode={mode}
          readonly={true}
          patches={mode === "REVIEW_DIFF" ? patches : undefined}
          onAnswersChange={() => undefined}
        />

        {detail.aiResult && (
          <div style={styles.aiResultPanel}>
            <h3 style={styles.panelTitle}>AI 预审结果</h3>
            <div style={styles.aiScore}>
              <span style={styles.aiLabel}>得分:</span>
              <span style={styles.aiValue}>{detail.aiResult.aiResult.totalScore}</span>
            </div>
            <div style={styles.aiSummary}>
              <span style={styles.aiLabel}>结论:</span>
              <span style={styles.aiValue}>{detail.aiResult.aiResult.summary}</span>
            </div>
          </div>
        )}

        <div style={styles.decisionPanel}>
          <textarea
            style={styles.commentsInput}
            placeholder="输入审核意见（可选）"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
          <div style={styles.decisionButtons}>
            {detail.submission.status === "AI_PASSED" || detail.submission.status === "NEEDS_HUMAN_REVIEW" ? (
              <button style={styles.claimButton} onClick={handleClaimReview} disabled={claiming}>
                {claiming ? "领取中..." : "领取审核"}
              </button>
            ) : (
              <>
                <button style={styles.passButton} onClick={() => handleDecision("PASS")} disabled={deciding}>
                  {deciding ? "处理中..." : "通过"}
                </button>
                <button style={styles.returnButton} onClick={() => handleDecision("RETURN")} disabled={deciding}>
                  {deciding ? "处理中..." : "退回修改"}
                </button>
                <button style={styles.rejectButton} onClick={() => handleDecision("REJECT")} disabled={deciding}>
                  {deciding ? "处理中..." : "拒绝"}
                </button>
              </>
            )}
          </div>
        </div>
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
    color: "#ff9800",
    textDecoration: "none",
    fontSize: "0.9rem",
  },
  title: {
    fontSize: "1.8rem",
    color: "#1a1a2e",
  },
  role: {
    backgroundColor: "#ff9800",
    color: "white",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  content: {
    backgroundColor: "white",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    padding: "20px",
  },
  infoPanel: {
    marginBottom: "20px",
    padding: "15px",
    backgroundColor: "#f5f7fa",
    borderRadius: "8px",
  },
  infoRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "8px",
  },
  infoLabel: {
    color: "#666",
    fontSize: "0.9rem",
    fontWeight: "bold",
  },
  infoValue: {
    color: "#333",
    fontSize: "0.9rem",
  },
  sourcePanel: {
    marginBottom: "20px",
    padding: "15px",
    backgroundColor: "#f5f7fa",
    borderRadius: "8px",
  },
  panelTitle: {
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
  modeSelector: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
  },
  modeButton: {
    padding: "10px 20px",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  aiResultPanel: {
    marginBottom: "20px",
    padding: "15px",
    backgroundColor: "#e3f2fd",
    borderRadius: "8px",
  },
  aiScore: {
    display: "flex",
    gap: "10px",
    marginBottom: "10px",
  },
  aiLabel: {
    color: "#1976d2",
    fontSize: "0.9rem",
    fontWeight: "bold",
  },
  aiValue: {
    color: "#1565c0",
    fontSize: "0.9rem",
  },
  aiSummary: {
    display: "flex",
    gap: "10px",
  },
  decisionPanel: {
    marginTop: "20px",
    padding: "20px",
    backgroundColor: "#f5f7fa",
    borderRadius: "8px",
  },
  commentsInput: {
    width: "100%",
    height: "80px",
    padding: "10px",
    marginBottom: "15px",
    border: "1px solid #ddd",
    borderRadius: "5px",
    fontSize: "0.9rem",
    resize: "vertical",
  },
  decisionButtons: {
    display: "flex",
    gap: "15px",
  },
  claimButton: {
    flex: 1,
    padding: "12px",
    backgroundColor: "#ff9800",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  passButton: {
    flex: 1,
    padding: "12px",
    backgroundColor: "#4caf50",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  returnButton: {
    flex: 1,
    padding: "12px",
    backgroundColor: "#ff9800",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  rejectButton: {
    flex: 1,
    padding: "12px",
    backgroundColor: "#f44336",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
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