import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";

interface OwnerAIPageProps {
  role: Role;
}

export default function OwnerAIPage({ role }: OwnerAIPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("gpt-4");
  const [threshold, setThreshold] = useState(0.8);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Link to={RoutePath.OWNER_TASKS} style={styles.backLink}>← 返回任务列表</Link>
        <h2 style={styles.title}>AI 配置</h2>
        <span style={styles.role}>{role}</span>
      </div>

      <div style={styles.content}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>任务 ID: {taskId}</h3>
        </div>

        <div style={styles.section}>
          <div style={styles.toggleRow}>
            <label style={styles.toggleLabel}>启用 AI 辅助</label>
            <button
              style={{
                ...styles.toggleButton,
                backgroundColor: enabled ? "#4a69bd" : "#ddd",
              }}
              onClick={() => setEnabled(!enabled)}
            >
              {enabled ? "开启" : "关闭"}
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>模型配置</h3>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>选择模型</label>
            <select
              style={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!enabled}
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>置信度阈值: {threshold}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              style={styles.slider}
              disabled={!enabled}
            />
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>输出绑定</h3>
          <p style={styles.description}>配置 AI 输出如何映射到标注字段</p>
          <div style={styles.outputBindingList}>
            <div style={styles.outputBindingItem}>
              <span style={styles.bindingField}>summary</span>
              <span style={styles.bindingArrow}>→</span>
              <span style={styles.bindingTarget}>$.answers.summary</span>
            </div>
          </div>
        </div>

        <div style={styles.buttonGroup}>
          <button style={styles.saveButton}>保存配置</button>
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
  toggleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleLabel: {
    fontSize: "1rem",
    color: "#333",
  },
  toggleButton: {
    padding: "8px 20px",
    borderRadius: "20px",
    border: "none",
    cursor: "pointer",
    color: "white",
    fontSize: "0.9rem",
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
    width: "100%",
    padding: "10px",
    border: "1px solid #ddd",
    borderRadius: "5px",
    fontSize: "0.9rem",
  },
  slider: {
    width: "100%",
    height: "6px",
    borderRadius: "3px",
    backgroundColor: "#ddd",
    outline: "none",
  },
  description: {
    fontSize: "0.9rem",
    color: "#666",
    marginBottom: "15px",
  },
  outputBindingList: {
    backgroundColor: "#f5f7fa",
    borderRadius: "5px",
    padding: "15px",
  },
  outputBindingItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  bindingField: {
    backgroundColor: "#4a69bd",
    color: "white",
    padding: "5px 10px",
    borderRadius: "3px",
    fontSize: "0.8rem",
  },
  bindingArrow: {
    color: "#999",
  },
  bindingTarget: {
    fontFamily: "monospace",
    fontSize: "0.8rem",
    color: "#666",
  },
  buttonGroup: {
    display: "flex",
    justifyContent: "flex-end",
  },
  saveButton: {
    padding: "12px 30px",
    backgroundColor: "#4a69bd",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
};