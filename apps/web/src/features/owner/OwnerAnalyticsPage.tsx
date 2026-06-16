import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Task } from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import {
  fetchAnalyticsDashboard,
  listTasks,
  type AnalyticsAiCostRow,
  type AnalyticsDashboard,
  type AnalyticsLabelerRow,
} from "../../api/owner";
import { Badge, Card, Select } from "../../ui/primitives";

interface OwnerAnalyticsPageProps {
  role: Role;
}

// 后端 purpose → 审核员/负责人能看懂的中文，绝不展示裸英文字段名。
const PURPOSE_LABELS: Record<AnalyticsAiCostRow["purpose"], string> = {
  AI_REVIEW: "AI 预审",
  LLM_ASSIST: "标注辅助",
  SCHEMA_GENERATION: "模板生成",
};

function percent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function score(value: number | null | undefined): string {
  return value == null ? "—" : `${value} 分`;
}

function latency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${ms} 毫秒`;
}

function tokens(n: number): string {
  return n.toLocaleString("en-US");
}

export default function OwnerAnalyticsPage({ role }: OwnerAnalyticsPageProps) {
  void role;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string>("");
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listTasks();
        if (!cancelled) setTasks(list);
      } catch {
        if (!cancelled) setTasks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchAnalyticsDashboard(taskId || undefined);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err.message : "看板数据加载失败，请稍后重试。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  return (
    <div className="page-stack owner-analytics-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">绩效看板</h2>
          <p className="page-subtitle">
            汇总 AI 调用成本、标注员表现，以及 AI 预审与人工审核的一致程度，辅助你判断投入产出。
          </p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      <Card className="owner-analytics-toolbar">
        <label className="field-label owner-analytics-toolbar__field">
          统计范围
          <Select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            <option value="">全部任务</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
        </label>
        <span className="owner-analytics-toolbar__hint">
          数据实时统计自提交、审核与 AI 调用记录，仅供参考。
        </span>
      </Card>

      {loading ? (
        <Card className="state-panel">加载看板数据中...</Card>
      ) : error ? (
        <Card className="state-panel danger-text">{error}</Card>
      ) : data ? (
        <>
          <AiCostSection data={data} />
          <LabelerSection rows={data.labelers} />
          <AiQualitySection quality={data.aiQuality} />
        </>
      ) : null}
    </div>
  );
}

function AiCostSection({ data }: { data: AnalyticsDashboard }) {
  const { aiCost } = data;
  const scoped = data.scope.taskId != null;
  return (
    <Card className="owner-analytics-card">
      <div className="owner-analytics-card__head">
        <h3>AI 使用成本</h3>
        <span>统计三处 AI 调用的次数、消耗与稳定性</span>
      </div>

      {aiCost.totalCalls === 0 ? (
        <div className="owner-analytics-empty">当前范围内暂无 AI 调用记录。</div>
      ) : (
        <>
          <div className="owner-analytics-metric-row">
            <div className="owner-analytics-metric">
              <span>总调用次数</span>
              <strong>{aiCost.totalCalls.toLocaleString("en-US")}</strong>
            </div>
            <div className="owner-analytics-metric">
              <span>总消耗 Token</span>
              <strong>{tokens(aiCost.totalTokens)}</strong>
            </div>
          </div>

          <div className="owner-analytics-table-wrap">
            <table className="owner-analytics-table">
              <thead>
                <tr>
                  <th>AI 用途</th>
                  <th>调用次数</th>
                  <th>消耗 Token</th>
                  <th>平均耗时</th>
                  <th>失败率</th>
                </tr>
              </thead>
              <tbody>
                {aiCost.byPurpose.map((row) => (
                  <tr key={row.purpose}>
                    <td>
                      <span className="owner-analytics-cell-main">{PURPOSE_LABELS[row.purpose]}</span>
                      {scoped && row.scope === "global" ? (
                        <span className="owner-analytics-tag">全部任务</span>
                      ) : null}
                    </td>
                    <td>{row.calls.toLocaleString("en-US")}</td>
                    <td>{tokens(row.totalTokens)}</td>
                    <td>{latency(row.avgLatencyMs)}</td>
                    <td>{percent(row.failureRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scoped ? (
            <p className="owner-analytics-note">
              说明：「模板生成」按全部任务统计，暂不按单个任务拆分。
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function LabelerSection({ rows }: { rows: AnalyticsLabelerRow[] }) {
  return (
    <Card className="owner-analytics-card">
      <div className="owner-analytics-card__head">
        <h3>标注员表现</h3>
        <span>客观完成情况，未做综合评级或排名</span>
      </div>

      {rows.length === 0 ? (
        <div className="owner-analytics-empty">当前范围内暂无标注提交。</div>
      ) : (
        <div className="owner-analytics-table-wrap">
          <table className="owner-analytics-table">
            <thead>
              <tr>
                <th>标注员</th>
                <th>提交数</th>
                <th>通过率</th>
                <th>打回率</th>
                <th>审核中</th>
                <th>AI 维度均分</th>
                <th>被修订字段</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.labelerId}>
                  <td>
                    <span className="owner-analytics-cell-main" title={row.displayName}>
                      {row.displayName}
                    </span>
                  </td>
                  <td>{row.submitted}</td>
                  <td>{percent(row.acceptRate)}</td>
                  <td>{percent(row.returnRate)}</td>
                  <td>{row.inReview}</td>
                  <td>{score(row.avgAiScore)}</td>
                  <td>{row.reviewerPatchedFields}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AiQualitySection({ quality }: { quality: AnalyticsDashboard["aiQuality"] }) {
  const raw = quality.byRawDecision || {};
  return (
    <Card className="owner-analytics-card">
      <div className="owner-analytics-card__head">
        <h3>AI-人工一致率</h3>
        <span>AI 预审结论与人工最终结论的吻合程度</span>
      </div>

      {quality.evaluated === 0 ? (
        <div className="owner-analytics-empty">
          暂无足够数据计算一致率。需要同时具备 AI 预审结论和人工最终结论的提交。
        </div>
      ) : (
        <div className="owner-analytics-metric-row">
          <div className="owner-analytics-metric owner-analytics-metric--accent">
            <span>AI-人工一致率</span>
            <strong>{percent(quality.agreementRate)}</strong>
            <em>基于 {quality.evaluated} 条可对比提交</em>
          </div>
          <div className="owner-analytics-metric">
            <span>一致 / 可对比</span>
            <strong>{quality.agreements} / {quality.evaluated}</strong>
          </div>
          <div className="owner-analytics-metric">
            <span>转人工率</span>
            <strong>{percent(quality.humanReviewRate)}</strong>
            <em>AI 主动交由人工判断的占比</em>
          </div>
        </div>
      )}

      {quality.aiRawTotal > 0 ? (
        <div className="owner-analytics-chips">
          <Badge tone="success">建议通过 {raw.PASS ?? 0}</Badge>
          <Badge tone="danger">建议打回 {raw.RETURN ?? 0}</Badge>
          <Badge tone="warning">建议转人工 {raw.NEED_HUMAN_REVIEW ?? 0}</Badge>
        </div>
      ) : null}
    </Card>
  );
}
