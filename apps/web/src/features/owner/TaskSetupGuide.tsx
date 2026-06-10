import { Link } from "react-router-dom";
import { Badge, Card } from "../../ui/primitives";

export type TaskSetupStepKey = "basic" | "data" | "template" | "ai" | "publish";
export type TaskSetupStepState = "done" | "current" | "pending" | "error";

export interface TaskSetupStep {
  key: TaskSetupStepKey;
  title: string;
  description: string;
  state: TaskSetupStepState;
  href?: string;
  actionLabel?: string;
  meta?: string;
}

export interface ReadinessItem {
  key: string;
  label: string;
  state: "done" | "error" | "pending";
  detail: string;
  href?: string;
  actionLabel?: string;
}

const stepOrder: TaskSetupStepKey[] = ["basic", "data", "template", "ai", "publish"];

const stepCopy: Record<TaskSetupStepKey, { title: string; description: string; actionLabel: string }> = {
  basic: { title: "基础信息", description: "任务名称、说明、配额与分发策略", actionLabel: "查看基础信息" },
  data: { title: "数据管理", description: "导入本任务需要标注的数据", actionLabel: "去导入数据" },
  template: { title: "模板配置", description: "配置字段、校验规则与联动逻辑", actionLabel: "去配置模板" },
  ai: { title: "AI 预审配置", description: "配置质量检查规则或明确关闭", actionLabel: "去配置 AI 预审" },
  publish: { title: "发布任务", description: "完成发布前检查并开放领取", actionLabel: "去发布任务" },
};

export function buildTaskSetupSteps({
  taskId,
  currentStep,
  basicReady = true,
  hasData,
  templateReady,
  aiReady,
  distributionReady = true,
  dataMeta,
  templateMeta,
  aiMeta,
}: {
  taskId: string;
  currentStep: TaskSetupStepKey;
  basicReady?: boolean;
  hasData: boolean;
  templateReady: boolean;
  aiReady: boolean;
  distributionReady?: boolean;
  dataMeta?: string;
  templateMeta?: string;
  aiMeta?: string;
}): TaskSetupStep[] {
  const completion: Record<TaskSetupStepKey, boolean> = {
    basic: basicReady,
    data: hasData,
    template: templateReady,
    ai: aiReady,
    publish: basicReady && hasData && templateReady && aiReady && distributionReady,
  };
  const currentIndex = stepOrder.indexOf(currentStep);

  return stepOrder.map((key) => {
    const index = stepOrder.indexOf(key);
    const base = stepCopy[key];
    const isDone = completion[key];
    const state: TaskSetupStepState = isDone
      ? "done"
      : currentStep === key
        ? "current"
        : index < currentIndex
          ? "error"
          : "pending";

    const step: TaskSetupStep = {
      key,
      title: base.title,
      description: base.description,
      state,
      actionLabel: base.actionLabel,
      href: routeForStep(taskId, key),
    };

    if (key === "data" && dataMeta) step.meta = dataMeta;
    if (key === "template" && templateMeta) step.meta = templateMeta;
    if (key === "ai" && aiMeta) step.meta = aiMeta;
    if (key === "publish" && !distributionReady) {
      step.meta = "分发设置待确认";
      if (!isDone && currentStep !== key) step.state = "error";
    }
    return step;
  });
}

export function TaskSetupStepper({ steps }: { steps: TaskSetupStep[] }) {
  return (
    <Card className="owner-setup-stepper" aria-label="任务配置流程">
      <div className="owner-setup-stepper__head">
        <div>
          <span>任务配置流程</span>
          <h3>从数据到发布的完整准备</h3>
        </div>
      </div>
      <ol className="owner-setup-steps">
        {steps.map((step, index) => {
          const body = (
            <>
              <span className="owner-setup-step__index">{index + 1}</span>
              <span className="owner-setup-step__body">
                <strong>{step.title}</strong>
                <small>{step.meta ?? step.description}</small>
              </span>
              <Badge tone={badgeTone(step.state)}>{stateLabel(step.state)}</Badge>
            </>
          );
          return (
            <li className={`owner-setup-step owner-setup-step--${step.state}`} key={step.key}>
              {step.href ? (
                <Link to={step.href} aria-label={step.actionLabel ?? step.title}>
                  {body}
                </Link>
              ) : (
                <div>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function PublishReadinessPanel({
  items,
  title = "发布前检查",
  description = "发布前会先检查任务配置完整性，缺失项需要回到对应步骤补齐。",
}: {
  items: ReadinessItem[];
  title?: string;
  description?: string;
}) {
  return (
    <Card className="owner-readiness-panel">
      <div className="owner-readiness-panel__head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="owner-readiness-list">
        {items.map((item) => (
          <div className={`owner-readiness-item owner-readiness-item--${item.state}`} key={item.key}>
            <div>
              <Badge tone={item.state === "done" ? "success" : item.state === "error" ? "warning" : "default"}>
                {item.state === "done" ? "已完成" : item.state === "error" ? "待完成" : "待检查"}
              </Badge>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            {item.state !== "done" && item.href ? (
              <Link to={item.href} className="lh-button">
                {item.actionLabel ?? "去完成"}
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function routeForStep(taskId: string, key: TaskSetupStepKey): string | undefined {
  if (!taskId) return undefined;
  if (key === "basic") return `/owner/tasks/${taskId}`;
  if (key === "data") return `/owner/tasks/${taskId}/data`;
  if (key === "template") return `/owner/tasks/${taskId}/designer`;
  if (key === "ai") return `/owner/tasks/${taskId}/ai-precheck`;
  return `/owner/tasks/${taskId}/designer`;
}

function badgeTone(state: TaskSetupStepState): "success" | "primary" | "warning" | "default" {
  if (state === "done") return "success";
  if (state === "current") return "primary";
  if (state === "error") return "warning";
  return "default";
}

function stateLabel(state: TaskSetupStepState): string {
  if (state === "done") return "已完成";
  if (state === "current") return "当前步骤";
  if (state === "error") return "有错误";
  return "待完成";
}
