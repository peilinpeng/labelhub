import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";

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
        status: "DRAFT" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        quota: { total: 100, completed: 0 },
        distributionStrategy: "ROUND_ROBIN",
        reviewPolicy: { type: "MAJORITY", threshold: 2 },
        ownerId: "usr_demo",
      };
      navigate(`/owner/tasks/${mockTask.id}/designer`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Link to={RoutePath.OWNER_TASKS} style={styles.backLink}>← 返回任务列表</Link>
        <h2 style={styles.title}>新建任务</h2>
        <span style={styles.role}>{role}</span>
      </div>

      <div style={styles.formContainer}>
        <div style={styles.formGroup}>
          <label style={styles.label}>任务名称 *</label>
          <input
            style={styles.input}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入任务名称"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>任务描述</label>
          <textarea
            style={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="请输入任务描述（可选）"
          />
        </div>

        <div style={styles.buttonGroup}>
          <button style={styles.cancelButton} onClick={() => navigate(RoutePath.OWNER_TASKS)}>
            取消
          </button>
          <button style={styles.createButton} onClick={handleCreate} disabled={loading}>
            {loading ? "创建中..." : "创建任务"}
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
  formContainer: {
    backgroundColor: "white",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    padding: "30px",
    maxWidth: "600px",
  },
  formGroup: {
    marginBottom: "20px",
  },
  label: {
    display: "block",
    marginBottom: "8px",
    fontWeight: "bold",
    color: "#333",
  },
  input: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ddd",
    borderRadius: "5px",
    fontSize: "1rem",
  },
  textarea: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ddd",
    borderRadius: "5px",
    fontSize: "1rem",
    minHeight: "100px",
    resize: "vertical",
  },
  buttonGroup: {
    display: "flex",
    gap: "15px",
    justifyContent: "flex-end",
  },
  cancelButton: {
    padding: "12px 24px",
    backgroundColor: "#f0f0f0",
    color: "#333",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  createButton: {
    padding: "12px 24px",
    backgroundColor: "#4a69bd",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
  },
};