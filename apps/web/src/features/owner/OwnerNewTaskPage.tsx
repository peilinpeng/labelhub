import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { Button, Card, Input, Textarea } from "../../ui/primitives";

interface OwnerNewTaskPageProps {
  role: Role;
}

export default function OwnerNewTaskPage({ role }: OwnerNewTaskPageProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      alert("请输入任务名称");
      return;
    }
    try {
      setLoading(true);
      const mockTask = {
        id: `task_${Date.now()}`,
        title,
        description,
      };
      navigate(`/owner/tasks/${mockTask.id}/designer`);
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
