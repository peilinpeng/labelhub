import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Select } from "../../ui/primitives";
import { getDemoWorkflowState } from "../../mocks/demo-workflow-store";
import { submissionsMock } from "../../mocks/data/submissions.mock";
import { tasksMock } from "../../mocks/data/tasks.mock";

interface OwnerExportPageProps {
  role: Role;
}

export default function OwnerExportPage({ role }: OwnerExportPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const task = tasksMock.find((item) => item.id === taskId);
  const demoState = getDemoWorkflowState();
  const approvedCount =
    submissionsMock.filter((submission) => submission.taskId === taskId && submission.status === "ACCEPTED").length +
    (taskId === "task_news_quality" && demoState.submissionStatus === "ACCEPTED" ? 1 : 0);
  const [format, setFormat] = useState("JSONL");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ACCEPTED");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);

  const confirmExport = async () => {
    try {
      setExporting(true);
      await new Promise((resolve) => setTimeout(resolve, 900));
      setExportNotice("导出任务已生成，可在导出中心下载。");
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () => {
    if (shouldSuppressConfirm(CONFIRM_KEYS.export)) {
      void confirmExport();
      return;
    }
    setExportConfirmOpen(true);
  };

  if (!task) {
    return <Card className="state-panel danger-text">任务不存在：{taskId}</Card>;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">导出中心</h2>
          <p className="page-subtitle">当前角色：{role}。导出 {task.title} 的审核通过数据。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      <div className="split-layout">
        <Card className="soft-panel">
          <div className="form-stack">
            <Badge tone="primary">任务 {taskId}</Badge>
            <h3 className="soft-panel__title">{task.title}</h3>
            <div className="soft-grid">
              {["JSONL", "CSV", "EXCEL"].map((item) => (
                <button className="schema-field-item" key={item} type="button" onClick={() => setFormat(item)}>
                  <span className="schema-field-item__icon">{item.slice(0, 3)}</span>
                  <span>
                    <strong>{item}</strong>
                    <small>{format === item ? "当前选择" : "可导出格式"}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="inset-well">
              <div className="meta-line">
                <span>taskId: {taskId}</span>
                <span>approved count: {approvedCount}</span>
              </div>
            </div>
            <label className="field-label">
              导出格式
              <Select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="JSON">JSON</option>
                <option value="JSONL">JSONL</option>
                <option value="CSV">CSV</option>
                <option value="EXCEL">EXCEL</option>
              </Select>
            </label>
            <label className="field-label">
              状态过滤
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="ACCEPTED">已通过</option>
                <option value="RETURNED">已退回</option>
                <option value="SUBMITTED">已提交</option>
              </Select>
            </label>
            <label className="field-label">
              <span>
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(event) => setIncludeMetadata(event.target.checked)}
                />{" "}
                包含审核记录和任务元数据
              </span>
            </label>
            <Button tone="success" onClick={handleExport} disabled={exporting}>
              {exporting ? "导出中..." : "开始导出"}
            </Button>
            {exportNotice ? <Badge tone="success">{exportNotice}</Badge> : null}
          </div>
        </Card>

        <Card className="soft-panel">
          <h3 className="soft-panel__title">导出预览</h3>
          <div className="inset-well">
            <pre className="source-json">{`{
  "taskId": "${taskId}",
  "format": "${format}",
  "filter": "${statusFilter}",
  "includeMetadata": ${includeMetadata},
  "records": [
    {
      "itemId": "item_001",
      "sourcePayload": { "...": "..." },
      "answers": { "...": "..." }
    }
  ]
}`}</pre>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={exportConfirmOpen}
        title="确认导出数据？"
        description="将导出当前任务中已审核通过的数据。"
        confirmText="导出"
        cancelText="取消"
        suppressLabel="本次会话不再提醒导出确认"
        onCancel={() => setExportConfirmOpen(false)}
        onConfirm={(suppress) => {
          if (suppress) {
            suppressConfirmForSession(CONFIRM_KEYS.export);
          }
          setExportConfirmOpen(false);
          void confirmExport();
        }}
      />
    </div>
  );
}
