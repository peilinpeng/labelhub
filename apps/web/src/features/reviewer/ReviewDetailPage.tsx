import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SchemaRenderer } from "@labelhub/schema-renderer";
import { RoutePath, Role } from "../../app/routes";
import { claimReview, decideReview, getReviewDetail } from "../../api/reviewer";
import { AIReviewPanel, Badge, Button, Card, Textarea } from "../../ui/primitives";
import type {
  LabelHubRuntimeContext,
  ReviewDecisionRequest,
  ReviewDetailResponse,
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
          setPatches(data.history.flatMap((item) => ("patches" in item && item.patches ? item.patches : [])));
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
          aiResult: detail.aiResult?.aiResult,
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

  const dimensions = useMemo(() => detail?.aiResult?.aiResult.dimensionScores ?? [], [detail]);

  const handleClaimReview = async () => {
    if (!submissionId) return;
    try {
      setClaiming(true);
      const submission = await claimReview(submissionId);
      setDetail((current) => (current ? { ...current, submission } : current));
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
      const base = {
        submissionId: submissionId as ReviewDecisionRequest["submissionId"],
        stage: "HUMAN_REVIEW" as const,
        comments: comments ? [{ message: comments }] : undefined,
        patches,
      };
      const request: ReviewDecisionRequest =
        decision === "PASS"
          ? { ...base, decision }
          : { ...base, decision, reason: comments || "需要人工复核" };
      await decideReview(submissionId, request);
      window.location.href = RoutePath.REVIEWER_QUEUE;
    } catch (e) {
      console.error("Failed to make decision:", e);
    } finally {
      setDeciding(false);
    }
  };

  if (loading) {
    return <Card className="state-panel">加载审核详情中...</Card>;
  }

  if (!detail) {
    return <Card className="state-panel danger-text">审核详情不存在</Card>;
  }

  return (
    <div className="review-layout">
      <Card className="soft-panel">
        <h3 className="soft-panel__title">审核队列</h3>
        <div className="soft-list">
          <div className="soft-list-item">
            <Badge tone="primary">当前</Badge>
            <h3 className="task-title">SUB · {detail.submission.id}</h3>
            <p className="page-subtitle">{detail.submission.status}</p>
          </div>
          <Link to={RoutePath.REVIEWER_QUEUE} className="lh-button">
            返回队列
          </Link>
        </div>
      </Card>

      <div className="page-stack">
        <div className="page-header">
          <div>
            <h2 className="page-title">{detail.submission.id} · {detail.task.title}</h2>
            <p className="page-subtitle">题目 {detail.item.id} · 当前角色 {role}</p>
          </div>
          <div className="page-actions">
            <Badge tone="warning">{detail.submission.status}</Badge>
            <Button onClick={handleClaimReview} disabled={claiming}>
              {claiming ? "领取中..." : "领取审核"}
            </Button>
          </div>
        </div>

        <Card className="inset-well">
          <h3 className="soft-panel__title">源数据</h3>
          <pre className="source-json">{JSON.stringify(detail.item.sourcePayload, null, 2)}</pre>
        </Card>

        {detail.aiResult ? (
          <AIReviewPanel title="AI 预审结果" badge={<Badge tone="primary">总分 {detail.aiResult.aiResult.totalScore}</Badge>}>
            <div className="form-stack">
              <p>{detail.aiResult.aiResult.summary}</p>
              {dimensions.map((dimension) => (
                <div className="score-row" key={dimension.key}>
                  <span>{dimension.key}</span>
                  <div className="score-bar">
                    <span style={{ width: `${dimension.score}%` }} />
                  </div>
                  <strong>{dimension.score}</strong>
                </div>
              ))}
            </div>
          </AIReviewPanel>
        ) : (
          <Card className="soft-panel">AI 预审结果暂未生成。</Card>
        )}

        <Card className="soft-panel">
          <div className="page-actions">
            <Button tone={mode === "REVIEW_READONLY" ? "primary" : "default"} onClick={() => setMode("REVIEW_READONLY")}>
              只读查看
            </Button>
            <Button tone={mode === "REVIEW_DIFF" ? "primary" : "default"} onClick={() => setMode("REVIEW_DIFF")}>
              修改对比
            </Button>
          </div>
          <div className="renderer-frame">
            <SchemaRenderer
              schema={detail.schema}
              context={runtimeContext}
              answers={detail.submission.answers}
              mode={mode}
              readonly={true}
              patches={mode === "REVIEW_DIFF" ? patches : undefined}
              onAnswersChange={() => undefined}
            />
          </div>
        </Card>

        <Card className="soft-panel">
          <label className="field-label">
            审核意见
            <Textarea
              placeholder="打回时必须填写；通过时可补充入库说明"
              value={comments}
              onChange={(event) => setComments(event.target.value)}
            />
          </label>
          <div className="decision-grid">
            <Button tone="danger" onClick={() => handleDecision("RETURN")} disabled={deciding}>
              打回
            </Button>
            <Button onClick={() => handleDecision("REJECT")} disabled={deciding}>
              拒绝
            </Button>
            <Button tone="success" onClick={() => handleDecision("PASS")} disabled={deciding}>
              通过入库
            </Button>
          </div>
        </Card>
      </div>

      <Card className="soft-panel">
        <h3 className="soft-panel__title">审计时间线</h3>
        <div className="timeline">
          {detail.history.map((item) => (
            <div className="timeline-item" key={item.id}>
              <strong>{item.actor.displayName} · {item.stage}</strong>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {detail.history.length === 0 ? (
            <div className="timeline-item">
              <strong>等待审核</strong>
              <span>暂无历史记录</span>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
