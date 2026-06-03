import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ID } from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import { createTask } from "../../api/owner";
import { createLocalPublishedTask } from "../../mocks/local-task-store";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Input, Select, Textarea } from "../../ui/primitives";

interface OwnerNewTaskPageProps {
  role: Role;
}

type DistributionType = "FIRST_COME_FIRST_SERVED" | "ASSIGNMENT" | "QUOTA_CLAIM";
type ReviewPolicyType = "SINGLE_REVIEW" | "DOUBLE_REVIEW";

export default function OwnerNewTaskPage({ role }: OwnerNewTaskPageProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [quotaTotal, setQuotaTotal] = useState(100);
  const [distributionType, setDistributionType] = useState<DistributionType>("FIRST_COME_FIRST_SERVED");
  const [reviewPolicyType, setReviewPolicyType] = useState<ReviewPolicyType>("SINGLE_REVIEW");
  const [assigneeIdsInput, setAssigneeIdsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const publishTask = async () => {
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
      navigate(`/owner/tasks/${task.id}/designer`);
    } catch {
      const task = createLocalPublishedTask({
        title,
        description,
        quotaTotal,
        distributionType,
        reviewPolicyType,
        assigneeIds,
      });
      setNotice("后端暂不可用，已创建本地演示任务。");
      window.setTimeout(() => navigate(`/owner/tasks/${task.id}/designer`), 350);
    } finally {
      setLoading(false);
    }
  };

  const requestPublish = () => {
    if (!validateForm()) {
      return;
    }
    if (shouldSuppressConfirm(CONFIRM_KEYS.publish)) {
      void publishTask();
      return;
    }
    setPublishConfirmOpen(true);
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">新建任务</h2>
          <p className="page-subtitle">当前角色：{role}。填写任务基础信息，发布后进入模板配置。</p>
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
          <Badge tone="warning">离线模式</Badge>
          <p>{notice}</p>
        </Card>
      ) : null}

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
              placeholder="请输入任务说明、验收标准或标注背景"
            />
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
            <Button type="button" tone="primary" onClick={requestPublish} disabled={loading}>
              {loading ? "发布中..." : "发布任务"}
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={publishConfirmOpen}
        title="确认发布任务？"
        description="发布后，标注员将可以在任务市场领取该任务。"
        confirmText="发布任务"
        cancelText="取消"
        suppressLabel="本次会话不再提醒发布确认"
        onCancel={() => setPublishConfirmOpen(false)}
        onConfirm={(suppress) => {
          if (suppress) {
            suppressConfirmForSession(CONFIRM_KEYS.publish);
          }
          setPublishConfirmOpen(false);
          void publishTask();
        }}
      />
    </div>
  );
}
