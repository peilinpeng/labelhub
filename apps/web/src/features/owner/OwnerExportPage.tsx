import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";

interface OwnerExportPageProps {
  role: Role;
}

export default function OwnerExportPage({ role }: OwnerExportPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [format, setFormat] = useState("json");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      alert(`导出成功！格式: ${format}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Link to={RoutePath.OWNER_TASKS} style={styles.backLink}>← 返回任务列表</Link>
        <h2 style={styles.title}>数据导出</h2>
        <span style={styles.role}>{role}</span>
      </div>

      <div style={styles.content}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>任务 ID: {taskId}</h3>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>导出格式</h3>
          <div style={styles.formatOptions}>
            <button
              style={{
                ...styles.formatButton,
                backgroundColor: format === "json" ? "#4a69bd" : "#f5f7fa",
                color: format === "json" ? "white" : "#333",
              }}
              onClick={() => setFormat("json")}
            >
              JSON
            </button>
            <button
              style={{
                ...styles.formatButton,
                backgroundColor: format === "csv" ? "#4a69bd" : "#f5f7fa",
                color: format === "csv" ? "white" : "#333",
              }}
              onClick={() => setFormat("csv")}
            >
              CSV
            </button>
            <button
              style={{
                ...styles.formatButton,
                backgroundColor: format === "parquet" ? "#4a69bd" : "#f5f7fa",
                color: format === "parquet" ? "white" : "#333",
              }}
              onClick={() => setFormat("parquet")}
            >
              Parquet
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>过滤条件</h3>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>状态过滤</label>
            <select
              style={styles.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="approved">已通过</option>
              <option value="returned">已退回</option>
              <option value="pending">待审核</option>
            </select>
          </div>

          <div style={styles.checkboxRow}>
            <input
              type="checkbox"
              id="includeMetadata"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              style={styles.checkbox}
            />
            <label htmlFor="includeMetadata" style={styles.checkboxLabel}>
              包含元数据（任务信息、审核记录等）
            </label>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>导出预览</h3>
          <div style={styles.previewPanel}>
            <pre style={styles.previewContent}>
{`{
  "taskId": "${taskId}",
  "exportTime": "${new Date().toISOString()}",
  "format": "${format}",
  "records": [
    {
      "itemId": "item_001",
      "sourcePayload": { ... },
      "answers": { ... },
      "status": "approved"
    }
  ]
}`}
            </pre>
          </div>
        </div>

        <div style={styles.buttonGroup}>
          <button style={styles.exportButton} onClick={handleExport} disabled={exporting}>
            {exporting ? "导出中..." : "开始导出"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "20px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  backLink: {
    color: "#4a69bd",
    textDecoration: "none",
    fontSize: "0.9rem",
  },
  title: {
    fontSize: "1.8rem",
    color: "#1a1a2e",
  },
  role: {
    backgroundColor: "#4a69bd",
    color: "white",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  content: {
    backgroundColor: "white",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    padding: "20px",
  },
  section: {
    marginBottom: "25px",
    paddingBottom: "20px",
    borderBottom: "1px solid #eee",
  },
  sectionTitle: {
    fontSize: "1.1rem",
    marginBottom: "15px",
    color: "#333",
  },
  formatOptions: {
    display: "flex",
    gap: "10px",
  },
  formatButton: {
    padding: "10px 25px",
    borderRadius: "5px",
    border: "none",
    cursor: "pointer",
    fontSize: "1rem",
  },
  formGroup: {
    marginBottom: "15px",
  },
  label: {
    display: "block",
    marginBottom: "8px",
    fontSize: "0.9rem",
    color: "#666",
  },
  select: {
    width: "200px",
    padding: "10px",
    border: "1px solid #ddd",
    borderRadius: "5px",
    fontSize: "0.9rem",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  checkbox: {
    width: "18px",
    height: "18px",
  },
  checkboxLabel: {
    fontSize: "0.9rem",
    color: "#333",
  },
  previewPanel: {
    backgroundColor: "#f5f7fa",
    borderRadius: "5px",
    padding: "15px",
    overflowX: "auto",
  },
  previewContent: {
    fontSize: "0.85rem",
    color: "#333",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  buttonGroup: {
    display: "flex",
    justifyContent: "flex-end",
  },
  exportButton: {
    padding: "12px 40px",
    backgroundColor: "#4caf50",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
};