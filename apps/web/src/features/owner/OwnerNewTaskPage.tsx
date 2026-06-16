import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ID } from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import { createTask } from "../../api/owner";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Input, Select, Textarea } from "../../ui/primitives";
import { markdownToDoc } from "../../ui/markdown";
import { TaskSetupStepper, type TaskSetupStep } from "./TaskSetupGuide";

interface OwnerNewTaskPageProps {
  role: Role;
}

type DistributionType = "FIRST_COME_FIRST_SERVED" | "ASSIGNMENT" | "QUOTA_CLAIM";
type ReviewPolicyType = "SINGLE_REVIEW" | "DOUBLE_REVIEW";

const newTaskSteps: TaskSetupStep[] = [
  {
    key: "basic",
    title: "基础信息",
    description: "填写任务名称、说明、配额与分发策略",
    state: "current",
  },
  {
    key: "data",
    title: "数据管理",
    description: "创建成功后先导入标注数据",
    state: "pending",
  },
  {
    key: "template",
    title: "模板配置",
    description: "基于数据字段搭建标注模板",
    state: "pending",
  },
  {
    key: "ai",
    title: "AI 预审配置",
    description: "保存质量检查规则或明确关闭",
    state: "pending",
  },
  {
    key: "publish",
    title: "发布任务",
    description: "完成发布前检查后开放领取",
    state: "pending",
  },
];

export default function OwnerNewTaskPage({ role }: OwnerNewTaskPageProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState("");
  const [quotaTotal, setQuotaTotal] = useState(100);
  const [deadlineLocal, setDeadlineLocal] = useState("");
  const [distributionType, setDistributionType] = useState<DistributionType>("FIRST_COME_FIRST_SERVED");
  const [reviewPolicyType, setReviewPolicyType] = useState<ReviewPolicyType>("SINGLE_REVIEW");
  const [assigneeIdsInput, setAssigneeIdsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "danger">("danger");

  const getAssigneeIds = (): ID[] =>
    assigneeIdsInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean) as ID[];

  const validateForm = (): boolean => {
    if (!title.trim()) {
      setFormError("请输入任务名称。");
      return false;
    }
    if (quotaTotal < 1) {
      setFormError("配额总数不能小于 1。");
      return false;
    }
    if (distributionType === "ASSIGNMENT" && getAssigneeIds().length === 0) {
      setFormError("指派模式下请至少填写一个用户 ID。");
      return false;
    }
    setFormError(null);
    return true;
  };

  const createDraftTask = async () => {
    if (!validateForm()) {
      return;
    }

    const assigneeIds = getAssigneeIds();
    try {
      setLoading(true);
      setNotice(null);
      const task = await createTask({
        title: title.trim(),
        description: description.trim(),
        deadlineAt: deadlineLocal ? new Date(deadlineLocal).toISOString() : undefined,
        instructionRichText: instruction.trim() ? markdownToDoc(instruction) : undefined,
        quota: { total: quotaTotal },
        distributionStrategy:
          distributionType === "FIRST_COME_FIRST_SERVED"
            ? { type: "FIRST_COME_FIRST_SERVED" as const }
            : distributionType === "ASSIGNMENT"
              ? { type: "ASSIGNMENT" as const, assigneeIds }
              : { type: "QUOTA_CLAIM" as const, claimBatchSize: 10 },
        reviewPolicy:
          reviewPolicyType === "SINGLE_REVIEW"
            ? { type: "SINGLE_REVIEW" }
            : { type: "DOUBLE_REVIEW", requireFinalReview: true },
      });
      // 不在本页发布任务，只创建草稿；必须用 createTask 真实返回的 id 跳转，
      // 缺少 id 时不跳转到 undefined 路径、不回 home，停留当前页并提示。
      if (!task.id) {
        setNoticeTone("danger");
        setNotice("任务已创建但缺少任务 ID，无法进入数据管理，请刷新任务列表后重试。");
        return;
      }
      setNoticeTone("success");
      setNotice("任务草稿已创建，正在打开数据管理。");
      navigate(`/owner/tasks/${task.id}/data`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务创建失败，请检查后端服务。";
      setNoticeTone("danger");
      setNotice(`任务创建失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const requestCreateDraft = () => {
    if (!validateForm()) {
      return;
    }
    if (shouldSuppressConfirm(CONFIRM_KEYS.publish)) {
      void createDraftTask();
      return;
    }
    setPublishConfirmOpen(true);
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">新建任务</h2>
          <p className="page-subtitle">当前角色：{role}。请先填写任务基础信息；创建成功后会进入数据管理，再继续配置模板、AI 预审和发布检查。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      {formError ? (
        <Card className="labeler-return-card">
          <Badge tone="danger">校验失败</Badge>
          <p>{formError}</p>
        </Card>
      ) : null}

      {notice ? (
        <Card className="labeler-return-card">
          <Badge tone={noticeTone}>{noticeTone === "success" ? "已创建" : "创建失败"}</Badge>
          <p>{notice}</p>
        </Card>
      ) : null}

      <TaskSetupStepper steps={newTaskSteps} />

      <Card className="soft-panel">
        <div className="form-stack">
          <label className="field-label">
            任务名称 *
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="请输入任务名称" />
          </label>
          <label className="field-label">
            任务描述
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="一句话简介，显示在任务列表"
            />
          </label>
          <label className="field-label">
            标注员说明（支持 Markdown）
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：评级标准、样例、注意事项"
            />
            <small className="field-hint">这段说明会展示给标注员，用于解释标注标准、样例和注意事项。</small>
          </label>
          <label className="field-label">
            配额总数 *
            <Input
              type="number"
              min={1}
              value={quotaTotal}
              onChange={(event) => setQuotaTotal(Number(event.target.value))}
              placeholder="100"
            />
          </label>
          <label className="field-label">
            截止时间
            <Input
              type="datetime-local"
              value={deadlineLocal}
              onChange={(event) => setDeadlineLocal(event.target.value)}
            />
            <small className="field-hint">可选。到期后标注员将不能继续领取新题。</small>
          </label>
          <label className="field-label">
            分发策略 *
            <Select
              value={distributionType}
              onChange={(event) => setDistributionType(event.target.value as DistributionType)}
            >
              <option value="FIRST_COME_FIRST_SERVED">先到先得</option>
              <option value="ASSIGNMENT">指派</option>
              <option value="QUOTA_CLAIM">配额抢单</option>
            </Select>
          </label>
          {distributionType === "ASSIGNMENT" ? (
            <label className="field-label">
              指派用户 ID *
              <Input
                value={assigneeIdsInput}
                onChange={(event) => setAssigneeIdsInput(event.target.value)}
                placeholder="逗号分隔，如 usr_xxx, usr_yyy"
              />
            </label>
          ) : null}
          <label className="field-label">
            审核策略 *
            <Select
              value={reviewPolicyType}
              onChange={(event) => setReviewPolicyType(event.target.value as ReviewPolicyType)}
            >
              <option value="SINGLE_REVIEW">单轮审核</option>
              <option value="DOUBLE_REVIEW">双轮审核</option>
            </Select>
          </label>
          <div className="page-actions">
            <Button type="button" onClick={() => navigate(RoutePath.OWNER_TASKS)}>
              取消
            </Button>
            <Button type="button" tone="primary" onClick={requestCreateDraft} disabled={loading}>
              {loading ? "创建中..." : "创建任务并导入数据"}
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={publishConfirmOpen}
        title="确认创建任务草稿？"
        description="将创建任务草稿并进入数据管理。请先导入本任务需要标注的数据，再继续配置模板、AI 预审和发布检查。"
        confirmText="创建草稿"
        cancelText="取消"
        suppressLabel="本次会话不再提醒创建确认"
        onCancel={() => setPublishConfirmOpen(false)}
        onConfirm={(suppress) => {
          if (suppress) {
            suppressConfirmForSession(CONFIRM_KEYS.publish);
          }
          setPublishConfirmOpen(false);
          void createDraftTask();
        }}
      />
    </div>
  );
}
