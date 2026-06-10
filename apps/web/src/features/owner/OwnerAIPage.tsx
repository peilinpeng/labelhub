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
  const [triggerTiming, setTriggerTiming] = useState("AFTER_SUBMIT");
  const [reviewFlowMode, setReviewFlowMode] = useState("AI_THEN_HUMAN");
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
    },
    maxRetries,
  }), [dimensions, enabled, maxRetries, model, promptTemplate, returnThreshold, threshold]);

  const saveSettings = async () => {
    if (!selectedTaskId) return;
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
                <option value="doubao-pro-32k">doubao-pro-32k</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4">GPT-4</option>
              </Select>
            </label>
            <label className="field-label">
              检查触发时机
              <Select value={triggerTiming} onChange={(event) => setTriggerTiming(event.target.value)} disabled={!enabled}>
                <option value="AFTER_SUBMIT">提交后进入预审队列</option>
                <option value="BEFORE_HUMAN_REVIEW">审核前自动预审</option>
              </Select>
              <small className="field-hint">当前后端按任务 ReviewConfig 执行预审；此处用于明确本任务的流程说明，不写入未支持的 contracts 字段。</small>
            </label>
            <label className="field-label">
              检查结果如何进入审核流
              <Select value={reviewFlowMode} onChange={(event) => setReviewFlowMode(event.target.value)} disabled={!enabled}>
                <option value="AI_THEN_HUMAN">AI 预审后进入人工复核</option>
                <option value="AUTO_PASS_RETURN">高分自动通过，低分自动打回，中间转人工</option>
                <option value="HUMAN_REVIEW_ONLY">只生成 AI 质检提示，由审核员决策</option>
              </Select>
            </label>
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
                <span>AI 会逐维度给出评分和理由，各维度权重之和建议为 1</span>
              </div>
              {dimensions.map((dimension, index) => (
                <label className="owner-ai-dimension-row" key={dimension.key}>
                  <span>{dimension.label}</span>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dimension.weight}
                    disabled={!enabled}
                    onChange={(event) => {
                      const weight = parseFloat(event.target.value);
                      setDimensions((current) => current.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, weight } : item
                      )));
                    }}
                  />
                </label>
              ))}
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
                <Link to={`/owner/tasks/${selectedTaskId}/designer`} className="lh-button lh-button--primary">
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
              <div><span>自动通过</span><strong>总分 ≥ {threshold}</strong></div>
              <div><span>转人工</span><strong>{returnThreshold} ≤ 总分 &lt; {threshold}</strong></div>
              <div><span>自动打回</span><strong>总分 &lt; {returnThreshold}</strong></div>
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

const defaultPromptTemplate = `你是 LabelHub 的 AI 预审 Agent。
请基于题目内容、标注答案和当前 schema 输出结构化审核结果。
必须使用 function_calling JSON 结构返回 decision、totalScore、dimensionScores、fieldIssues、summary、confidence。
不要直接修改标注答案；需要人工处理时返回 NEED_HUMAN_REVIEW。`;

function normalizeDimensions(value: ReviewConfigPayload["dimensions"]): ReviewConfigPayload["dimensions"] {
  return value.length > 0 ? value.map((item) => ({
    ...item,
    description: item.description ?? "",
    scoreRange: item.scoreRange ?? [0, 1],
  })) : defaultDimensions;
}
