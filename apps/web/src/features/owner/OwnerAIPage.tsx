import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Task } from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import { fetchTaskStats, listTasks, type TaskStats } from "../../api/owner";
import {
  createReviewConfig,
  getReviewConfig,
  updateReviewConfig,
  type ReviewConfigPayload,
} from "../../api/reviewer";
import { AIReviewPanel, Badge, Button, Card, Input, Select } from "../../ui/primitives";
import { buildTaskSetupSteps, TaskSetupStepper } from "./TaskSetupGuide";

interface OwnerAIPageProps {
  role: Role;
}

export default function OwnerAIPage({ role }: OwnerAIPageProps) {
  void role;
  const navigate = useNavigate();
  const { taskId: routeTaskId } = useParams<{ taskId: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState(routeTaskId ?? "");
  const [taskListLoading, setTaskListLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState("doubao-pro-32k");
  const [threshold, setThreshold] = useState(0.8);
  const [returnThreshold, setReturnThreshold] = useState(0.45);
  const [maxRetries, setMaxRetries] = useState(3);
  const [promptTemplate, setPromptTemplate] = useState(defaultPromptTemplate);
  const [dimensions, setDimensions] = useState(defaultDimensions);
  const [configId, setConfigId] = useState<string | null>(null);
  const [reviewFlowMode, setReviewFlowMode] = useState<
    "AI_THEN_HUMAN" | "AUTO_PASS_RETURN" | "HUMAN_REVIEW_ONLY"
  >("AI_THEN_HUMAN");
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ownerNotice, setOwnerNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setTaskListLoading(true);
        const availableTasks = await listTasks();
        if (cancelled) return;
        setTasks(availableTasks);
        setSelectedTaskId((current) => (routeTaskId ?? current) || availableTasks[0]?.id || "");
      } catch (error) {
        if (!cancelled) {
          setTasks([]);
          setOwnerNotice(error instanceof Error ? `任务列表加载失败：${error.message}` : "任务列表加载失败。");
        }
      } finally {
        if (!cancelled) setTaskListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeTaskId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selectedTaskId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setConfigId(null);
        setEnabled(true);
        setModel("doubao-pro-32k");
        setThreshold(0.8);
        setReturnThreshold(0.45);
        setMaxRetries(3);
        setReviewFlowMode("AI_THEN_HUMAN");
        setPromptTemplate(defaultPromptTemplate);
        setDimensions(defaultDimensions);
        const config = await getReviewConfig(selectedTaskId);
        if (cancelled) return;
        const thresholds = config.thresholds as ReviewConfigPayload["thresholds"] & {
          autoPass?: number;
          autoReturn?: number;
        };
        setConfigId(config.id);
        setEnabled(config.enabled);
        setModel(config.modelPolicyId);
        setPromptTemplate(config.promptTemplate);
        setDimensions(normalizeDimensions(config.dimensions));
        setThreshold(Number(thresholds.passScore ?? thresholds.autoPass ?? 0.8));
        setReturnThreshold(Number(thresholds.returnScore ?? thresholds.autoReturn ?? 0.45));
        setMaxRetries(config.maxRetries);
        // 回读审核流转策略；旧配置无 mode 字段时按最安全的「AI 预审后人工复核」兜底。
        setReviewFlowMode(config.conclusionMapping?.mode ?? "AI_THEN_HUMAN");
        setOwnerNotice(null);
      } catch (error) {
        if (!cancelled) {
          setConfigId(null);
          const message = error instanceof Error ? error.message : "";
          setOwnerNotice(
            message.includes("404") || message.includes("尚未配置")
              ? "该任务尚未配置 AI 预审，可填写下方规则后保存。"
              : `AI 预审配置读取失败：${message || "请稍后重试。"}`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    let cancelled = false;
    void fetchTaskStats(selectedTaskId)
      .then((stats) => {
        if (!cancelled) setTaskStats(stats);
      })
      .catch(() => {
        if (!cancelled) setTaskStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const payload = useMemo<ReviewConfigPayload>(() => ({
    enabled,
    modelPolicyId: model,
    promptTemplate,
    dimensions,
    thresholds: {
      passScore: threshold,
      returnScore: returnThreshold,
    },
    conclusionMapping: {
      passWhen: `totalScore >= ${threshold}`,
      returnWhen: `totalScore < ${returnThreshold}`,
      humanReviewOtherwise: true,
      // 把 owner 选择的流转策略真正持久化，后端 worker 据此门控是否允许 AI 自动通过/打回。
      mode: reviewFlowMode,
    },
    maxRetries,
  }), [dimensions, enabled, maxRetries, model, promptTemplate, returnThreshold, reviewFlowMode, threshold]);

  // 仅「高分自动通过，低分自动打回，中间转人工」策略下才启用自动通过/打回阈值；
  // 其余策略（AI 预审后人工复核 / 仅生成质检提示）AI 不参与自动流转，不展示阈值。
  const autoFlowEnabled = reviewFlowMode === "AUTO_PASS_RETURN";

  const weightSum = useMemo(() => dimensions.reduce((acc, d) => acc + d.weight, 0), [dimensions]);
  // 拖动与加载都已强制归一化为 1，这里作为保存前的安全闸门，避免万一保存出和≠1 的权重。
  const weightsValid = Math.abs(weightSum - 1) < 0.005;

  const saveSettings = async () => {
    if (!selectedTaskId) return;
    if (!weightsValid) {
      setDimensions((current) => normalizeWeights(current));
      setOwnerNotice("维度权重之和需为 1，已自动归一化，请确认后再次保存。");
      return;
    }
    try {
      setSaving(true);
      const saved = configId
        ? await updateReviewConfig(selectedTaskId, payload)
        : await createReviewConfig(selectedTaskId, payload);
      setConfigId(saved.id);
      setOwnerNotice("AI 预审配置已保存。标注员提交后会进入异步预审队列，预审结果再流转给审核员。");
    } catch (error) {
      setOwnerNotice(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const hasData = (taskStats?.datasetTotal ?? 0) > 0;
  const setupSteps = selectedTaskId
    ? buildTaskSetupSteps({
        taskId: selectedTaskId,
        currentStep: "ai",
        hasData,
        templateReady: Boolean(selectedTask?.activeSchemaVersionId),
        aiReady: Boolean(configId),
        dataMeta: taskStats ? `已导入 ${taskStats.datasetTotal} 条` : "数据状态待检查",
        templateMeta: selectedTask?.activeSchemaVersionId ? "已发布模板" : "待配置模板",
        aiMeta: configId ? (enabled ? "AI 预审已启用" : "已明确不启用 AI 预审") : "待保存配置",
      })
    : [];

  return (
    <div className="page-stack owner-ai-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">AI 预审配置</h2>
          <p className="page-subtitle">配置本任务在提交前或审核前需要执行的 AI 质量检查规则。保存后再回到发布前检查完成发布。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      {setupSteps.length > 0 ? <TaskSetupStepper steps={setupSteps} /> : null}

      <Card className="soft-panel">
        <label className="field-label">
          配置任务
          <Select
            value={selectedTaskId}
            disabled={taskListLoading || tasks.length === 0}
            onChange={(event) => {
              const nextTaskId = event.target.value;
              setSelectedTaskId(nextTaskId);
              navigate(`/owner/tasks/${nextTaskId}/ai-precheck`);
            }}
          >
            {tasks.length === 0 ? <option value="">暂无可配置任务</option> : null}
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </Select>
        </label>
        {!taskListLoading && tasks.length === 0 ? (
          <p className="page-subtitle">请先创建任务草稿，再为该任务配置 AI 预审规则。</p>
        ) : null}
      </Card>

      <div className="split-layout">
        <Card className="soft-panel owner-ai-settings-card">
          <div className="form-stack">
            <div className="page-actions">
              <Badge tone={enabled ? "success" : "warning"}>{enabled ? "已开启" : "未开启"}</Badge>
              <Badge tone="primary">{selectedTask?.title ?? "未选择任务"}</Badge>
              <Badge tone={configId ? "success" : "warning"}>{configId ? "已保存配置" : "待创建配置"}</Badge>
            </div>
            {loading ? <p className="page-subtitle">正在读取任务 AI 预审配置...</p> : null}
            <Button
              tone={enabled ? "success" : "primary"}
              disabled={!selectedTaskId}
              onClick={() => setEnabled((value) => !value)}
            >
              {enabled ? "关闭 AI 预审" : "开启 AI 预审"}
            </Button>
            <label className="field-label">
              模型
              <Select value={model} onChange={(event) => setModel(event.target.value)} disabled={!enabled}>
                {/* 兜底：后端保存的 modelPolicyId 若不在下列已知项中，仍按真实值展示，避免显示成旧模型或被保存覆盖 */}
                {!["mp_doubao_pro", "doubao-pro-32k", "gpt-4o", "gpt-4"].includes(model) ? (
                  <option value={model}>{model}（当前配置）</option>
                ) : null}
                <option value="mp_doubao_pro">Doubao Pro（mp_doubao_pro）</option>
                <option value="doubao-pro-32k">doubao-pro-32k</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4">GPT-4</option>
              </Select>
            </label>
            <label className="field-label">
              检查结果如何进入审核流
              <Select value={reviewFlowMode} onChange={(event) => setReviewFlowMode(event.target.value as typeof reviewFlowMode)} disabled={!enabled}>
                <option value="AI_THEN_HUMAN">AI 预审后进入人工复核</option>
                <option value="AUTO_PASS_RETURN">高分自动通过，低分自动打回，中间转人工</option>
                <option value="HUMAN_REVIEW_ONLY">只生成 AI 质检提示，由审核员决策</option>
              </Select>
              <small className="field-hint">该策略会随 ReviewConfig 保存并由后端预审 worker 执行：仅「高分自动通过…」允许 AI 自动通过/打回，其余策略下 AI 结论仅作参考、一律转人工复核。</small>
            </label>
            {autoFlowEnabled ? (
              <>
                <label className="field-label">
                  自动通过阈值：{threshold}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={threshold}
                    onChange={(event) => setThreshold(parseFloat(event.target.value))}
                    disabled={!enabled}
                  />
                </label>
                <label className="field-label">
                  自动打回阈值
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={returnThreshold}
                    onChange={(event) => setReturnThreshold(parseFloat(event.target.value))}
                    disabled={!enabled}
                  />
                </label>
              </>
            ) : (
              <p className="field-hint">
                当前策略不启用自动通过/打回，AI 结果仅作为人工审核参考。
              </p>
            )}
            <label className="field-label">
              失败重试次数
              <Input
                type="number"
                min="1"
                max="10"
                step="1"
                value={maxRetries}
                onChange={(event) => setMaxRetries(parseInt(event.target.value, 10))}
                disabled={!enabled}
              />
            </label>
            <label className="field-label">
              Prompt 模板
              <textarea
                className="owner-ai-prompt-input"
                value={promptTemplate}
                onChange={(event) => setPromptTemplate(event.target.value)}
                disabled={!enabled}
              />
            </label>
            <section className="owner-ai-dimensions" aria-label="维度评分">
              <div className="owner-ai-section-title">
                <strong>维度评分</strong>
                <span>拖动任一维度滑块，其余维度按原有比例自动缩放，权重之和始终为 1</span>
              </div>
              {dimensions.map((dimension, index) => (
                <div className="owner-ai-dimension-row" key={dimension.key}>
                  <div className="owner-ai-dimension-row__head">
                    <span className="owner-ai-dimension-row__label">{dimension.label}</span>
                    <span className="owner-ai-dimension-row__value">{dimension.weight.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    className="owner-ai-weight-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={dimension.weight}
                    disabled={!enabled}
                    aria-label={`${dimension.label} 权重`}
                    onChange={(event) => {
                      const next = parseFloat(event.target.value);
                      setDimensions((current) => redistributeWeights(current, index, next));
                    }}
                  />
                </div>
              ))}
              <div className="owner-ai-weight-sum">
                <span>权重总和</span>
                <strong>{weightSum.toFixed(2)}</strong>
              </div>
            </section>
            <div className="owner-ai-flow">
              <span>标注员提交</span>
              <span>异步队列</span>
              <span>AI 结构化评分</span>
              <span>审核员复核 / 终审</span>
              <span>通过入库 / 打回修改</span>
            </div>
            <Button tone="primary" onClick={() => void saveSettings()} disabled={saving || loading || !selectedTaskId}>
              {saving ? "保存中..." : "保存配置"}
            </Button>
            {ownerNotice ? (
              <Badge tone={ownerNotice.includes("失败") ? "danger" : ownerNotice.includes("尚未配置") ? "warning" : "success"}>
                {ownerNotice}
              </Badge>
            ) : null}
            {configId ? (
              <div className="owner-ai-next-actions">
                <Link to={`/owner/tasks/${selectedTaskId}/designer?publish=1`} className="lh-button lh-button--primary">
                  下一步：发布任务
                </Link>
              </div>
            ) : null}
          </div>
        </Card>

        <AIReviewPanel title="规则预览" badge={<Badge tone="primary">AI 自动预审</Badge>}>
          <div className="form-stack">
            <p>保存后，标注员每次提交都会进入异步预审队列，由 AI 按下方维度逐项评分。AI 只产出审核结论和评分，不会改写标注答案；重试耗尽或分数处于中间区间时，自动转人工审核兜底。</p>
            <div className="owner-ai-output-list" aria-label="AI 预审产出内容">
              <div><span>审核结论</span><strong>自动通过 / 自动打回 / 转人工复核</strong></div>
              <div><span>评分明细</span><strong>总分与各维度评分、评分理由</strong></div>
              <div><span>字段提示</span><strong>指出存在问题的字段与改进建议</strong></div>
              <div><span>审核摘要</span><strong>一句话结论与置信度</strong></div>
            </div>
            <div className="owner-ai-policy-list">
              {autoFlowEnabled ? (
                <>
                  <div><span>自动通过</span><strong>总分 ≥ {threshold}</strong></div>
                  <div><span>转人工</span><strong>{returnThreshold} ≤ 总分 &lt; {threshold}</strong></div>
                  <div><span>自动打回</span><strong>总分 &lt; {returnThreshold}</strong></div>
                </>
              ) : (
                <div><span>审核流转</span><strong>AI 结果仅作人工审核参考，不自动通过/打回</strong></div>
              )}
              <div><span>失败兜底</span><strong>重试 {maxRetries} 次后转人工</strong></div>
            </div>
          </div>
        </AIReviewPanel>
      </div>
    </div>
  );
}

const defaultDimensions: ReviewConfigPayload["dimensions"] = [
  { key: "factuality", label: "事实完整性", description: "事实表述是否完整、可核查", weight: 0.3, scoreRange: [0, 1] },
  { key: "category", label: "类别准确性", description: "类别选择是否符合内容", weight: 0.25, scoreRange: [0, 1] },
  { key: "evidence", label: "证据充分性", description: "是否提供来源、证据或复核说明", weight: 0.25, scoreRange: [0, 1] },
  { key: "format", label: "格式合规", description: "答案格式和必填项是否合规", weight: 0.2, scoreRange: [0, 1] },
];

// 默认模板必须用 Jinja 占位符注入【真实样本内容】，否则 worker 渲染后 LLM 收不到任何
// 题目/答案，会对所有样本盲评出相同分数。占位符对应 worker 的 _build_prompt_context：
// item.sourcePayload（导入的源数据）/ submission.answers（标注答案）/ dimensions（维度）。
// 模板任务无关（不写死 model_answer / response_a 等字段名），任意导入数据均可工作。
const defaultPromptTemplate = `你是 LabelHub 的 AI 预审 Agent。请基于下面这条样本的真实内容，对【标注答案】做质量预审。

【题目 / 源数据】
{{ item.sourcePayload }}

【标注答案】
{{ submission.answers }}

请对标注答案逐维度打分（每维 0-100 的整数），维度如下：
{% for d in dimensions %}- {{ d.key }}：{{ d.label }}
{% endfor %}
要求：
1. dimensionScores 中每项的 key 必须使用上面的英文维度 key（如 relevance / accuracy），不要用中文。
2. score 必须依据本样本的具体内容给出，不同样本应有不同分数；reason 用一句中文引用本样本的具体情况。
3. totalScore 取各维度的加权或平均（0-100）。
4. decision：质量明显合格→PASS；存在明显问题应退回→RETURN；把握不足→NEED_HUMAN_REVIEW。
5. summary 用一句中文总结，需引用本样本的具体内容；confidence 为你的把握（0-1）。
请通过 submit_ai_review_result 函数提交结构化结果。`;

function normalizeDimensions(value: ReviewConfigPayload["dimensions"]): ReviewConfigPayload["dimensions"] {
  const filled = value.length > 0 ? value.map((item) => ({
    ...item,
    description: item.description ?? "",
    scoreRange: item.scoreRange ?? [0, 1],
  })) : defaultDimensions;
  // 后端 / mock 返回的权重之和不一定为 1（当前 mock 示例为 0.9），加载后统一归一化为 1，
  // 不改变各维度的相对比例（不擅自变更业务含义）。
  return normalizeWeights(filled);
}

/**
 * 用「整数百分点 + 最大余数法」把一组权重按比例分配到 totalCents（默认 100），
 * 结果各项为整数百分点且严格求和为 totalCents，最后由小数部分最大者吸收 rounding error。
 * 原始和为 0 时平均分配。基于数组实现，对任意维度数量都成立。
 */
function distributeCents(weights: number[], totalCents: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((acc, w) => acc + w, 0);
  const raw = safe.map((w) => (sum > 0 ? (w / sum) * totalCents : totalCents / n));
  const floors = raw.map((v) => Math.floor(v));
  let remainder = totalCents - floors.reduce((acc, v) => acc + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder && k < n; k += 1) {
    floors[order[k].i] += 1;
  }
  remainder = 0;
  return floors;
}

/** 把权重数组整体归一化为和=1（两位小数精度），保持相对比例。 */
function normalizeWeights(
  dims: ReviewConfigPayload["dimensions"],
): ReviewConfigPayload["dimensions"] {
  if (dims.length === 0) return dims;
  const cents = distributeCents(dims.map((d) => d.weight), 100);
  return dims.map((d, i) => ({ ...d, weight: cents[i] / 100 }));
}

/**
 * 拖动第 index 个维度到 nextValue（钳制到 [0,1]）：该项取 nextValue，剩余 1-nextValue
 * 按其它维度的原有比例自动缩放；其它原始和为 0 时平均分配；最终严格求和为 1。
 */
function redistributeWeights(
  dims: ReviewConfigPayload["dimensions"],
  index: number,
  nextValue: number,
): ReviewConfigPayload["dimensions"] {
  if (dims.length <= 1) {
    return dims.map((d) => ({ ...d, weight: 1 }));
  }
  const nextCents = Math.min(100, Math.max(0, Math.round((Number.isFinite(nextValue) ? nextValue : 0) * 100)));
  const others = dims.map((d, i) => ({ d, i })).filter((x) => x.i !== index);
  const otherCents = distributeCents(others.map((x) => x.d.weight), 100 - nextCents);
  const result = dims.map((d) => ({ ...d }));
  result[index] = { ...result[index], weight: nextCents / 100 };
  others.forEach((x, k) => {
    result[x.i] = { ...result[x.i], weight: otherCents[k] / 100 };
  });
  return result;
}
