import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { Badge, Button, Card, Select } from "../../ui/primitives";

interface OwnerExportPageProps {
  role: Role;
}

export default function OwnerExportPage({ role }: OwnerExportPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [format, setFormat] = useState("JSONL");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ACCEPTED");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      await new Promise((resolve) => setTimeout(resolve, 900));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">导出中心</h2>
          <p className="page-subtitle">当前角色：{role}。导出配置暂用页面状态展示，后续接入 export workflow。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      <div className="split-layout">
        <Card className="soft-panel">
          <div className="form-stack">
            <Badge tone="primary">任务 {taskId}</Badge>
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
    </div>
  );
}
