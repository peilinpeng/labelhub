import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { createTask } from "../../api/owner";
import { Button, Card, Input, Select, Textarea } from "../../ui/primitives";
import type { ID } from "@labelhub/contracts";

interface OwnerNewTaskPageProps {
  role: Role;
}

export default function OwnerNewTaskPage({ role }: OwnerNewTaskPageProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // 新增：三个必填字段的默认值，用户可直接提交
  const [quotaTotal, setQuotaTotal] = useState(100);
  const [distributionType, setDistributionType] = useState<
    "FIRST_COME_FIRST_SERVED" | "ASSIGNMENT" | "QUOTA_CLAIM"
  >("FIRST_COME_FIRST_SERVED");
  const [reviewPolicyType, setReviewPolicyType] = useState<
    "SINGLE_REVIEW" | "DOUBLE_REVIEW"
  >("SINGLE_REVIEW");
  const [assigneeIdsInput, setAssigneeIdsInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      alert("请输入任务名称");
      return;
    }
    if (quotaTotal < 1) {
      alert("配额总数不能小于 1");
      return;
    }
    const assigneeIds = assigneeIdsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as ID[];
    if (distributionType === "ASSIGNMENT" && assigneeIds.length === 0) {
      alert("指派模式下请至少填写一个用户 ID");
      return;
    }
    try {
      setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">新建任务</h2>
          <p className="page-subtitle">当前角色：{role}。第一步创建任务壳，随后进入模板搭建。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      <Card className="soft-panel">
        <div className="form-stack">
          <label className="field-label">
            任务名称 *
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="请输入任务名称" />
          </label>
          <label className="field-label">
            任务描述
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请输入任务说明、验收标准或标注背景"
            />
          </label>
          <label className="field-label">
            配额总数 *
            <Input
              type="number"
              min={1}
              value={quotaTotal}
              onChange={(e) => setQuotaTotal(Number(e.target.value))}
              placeholder="100"
            />
          </label>
          <label className="field-label">
            分发策略 *
            <Select
              value={distributionType}
              onChange={(e) =>
                setDistributionType(
                  e.target.value as "FIRST_COME_FIRST_SERVED" | "ASSIGNMENT" | "QUOTA_CLAIM"
                )
              }
            >
              <option value="FIRST_COME_FIRST_SERVED">先到先得</option>
              <option value="ASSIGNMENT">指派</option>
              <option value="QUOTA_CLAIM">配额抢单</option>
            </Select>
          </label>
          {distributionType === "ASSIGNMENT" && (
            <label className="field-label">
              指派用户 ID *
              <Input
                value={assigneeIdsInput}
                onChange={(e) => setAssigneeIdsInput(e.target.value)}
                placeholder="逗号分隔，如 usr_xxx,usr_yyy"
              />
            </label>
          )}
          <label className="field-label">
            审核策略 *
            <Select
              value={reviewPolicyType}
              onChange={(e) =>
                setReviewPolicyType(e.target.value as "SINGLE_REVIEW" | "DOUBLE_REVIEW")
              }
            >
              <option value="SINGLE_REVIEW">单轮审核</option>
              <option value="DOUBLE_REVIEW">双轮审核</option>
            </Select>
          </label>
          <div className="page-actions">
            <Button onClick={() => navigate(RoutePath.OWNER_TASKS)}>取消</Button>
            <Button tone="primary" onClick={handleCreate} disabled={loading}>
              {loading ? "创建中..." : "创建任务"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
