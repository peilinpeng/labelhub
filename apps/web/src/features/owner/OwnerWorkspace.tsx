import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { listTasks } from "../../api/owner";
import type { Task } from "@labelhub/contracts";

interface OwnerWorkspaceProps {
  role: Role;
}

export default function OwnerWorkspace({ role }: OwnerWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listTasks();
        setTasks(data);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  if (error) {
    return <div style={styles.error}>错误: {error}</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>任务管理</h2>
        <div style={styles.headerRight}>
          <Link to={RoutePath.OWNER_TASKS_NEW} style={styles.newButton}>
            + 新建任务
          </Link>
          <span style={styles.role}>{role}</span>
        </div>
      </div>

      <div style={styles.taskGrid}>
        {tasks.map((task) => (
          <div key={task.id} style={styles.taskCard}>
            <h3 style={styles.taskTitle}>{task.title}</h3>
            <p style={styles.taskDesc}>{task.description}</p>
            <div style={styles.taskMeta}>
              <span style={styles.status}>{task.status}</span>
              <span style={styles.date}>{task.createdAt}</span>
            </div>
            <div style={styles.actions}>
              <Link
                to={`/owner/tasks/${task.id}/designer`}
                style={styles.button}
              >
                设计模板
              </Link>
              <Link
                to={`/owner/tasks/${task.id}/ai-config`}
                style={styles.button}
              >
                AI配置
              </Link>
              <Link
                to={`/owner/tasks/${task.id}/export`}
                style={styles.button}
              >
                导出
              </Link>
            </div>
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <div style={styles.empty}>
          <p>暂无任务</p>
          <Link to={RoutePath.OWNER_TASKS_NEW} style={styles.emptyLink}>
            立即创建第一个任务
          </Link>
        </div>
      )}
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
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  title: {
    fontSize: "1.8rem",
    color: "#1a1a2e",
  },
  newButton: {
    backgroundColor: "#4a69bd",
    color: "white",
    padding: "8px 20px",
    borderRadius: "5px",
    textDecoration: "none",
    fontSize: "0.9rem",
  },
  role: {
    backgroundColor: "#4a69bd",
    color: "white",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  taskGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "20px",
  },
  taskCard: {
    backgroundColor: "white",
    padding: "20px",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  taskTitle: {
    fontSize: "1.2rem",
    marginBottom: "10px",
    color: "#1a1a2e",
  },
  taskDesc: {
    color: "#666",
    marginBottom: "15px",
    lineHeight: "1.5",
  },
  taskMeta: {
    display: "flex",
    gap: "15px",
    marginBottom: "15px",
  },
  status: {
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
    padding: "3px 10px",
    borderRadius: "4px",
    fontSize: "0.8rem",
  },
  date: {
    color: "#999",
    fontSize: "0.8rem",
  },
  actions: {
    display: "flex",
    gap: "10px",
  },
  button: {
    flex: 1,
    textAlign: "center",
    padding: "10px",
    backgroundColor: "#4a69bd",
    color: "white",
    borderRadius: "5px",
    textDecoration: "none",
    fontSize: "0.9rem",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "200px",
    fontSize: "1.2rem",
    color: "#666",
  },
  error: {
    backgroundColor: "#ffebee",
    color: "#c62828",
    padding: "15px",
    borderRadius: "5px",
  },
  empty: {
    textAlign: "center",
    padding: "50px",
    color: "#999",
  },
  emptyLink: {
    display: "block",
    marginTop: "15px",
    color: "#4a69bd",
    textDecoration: "none",
  },
};