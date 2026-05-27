import { useEffect, useState } from "react";
import { Role } from "../../app/routes";
import { listMarketplaceTasks, claimTask } from "../../api/labeler";
import type { Task, ClaimTaskResponse } from "@labelhub/contracts";

interface LabelerWorkspaceProps {
  role: Role;
}

export default function LabelerWorkspace({ role }: LabelerWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listMarketplaceTasks();
        setTasks(data);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleClaimTask = async (taskId: string) => {
    try {
      setClaimingTaskId(taskId);
      const response: ClaimTaskResponse = await claimTask(taskId, {});
      window.location.href = `/labeler/workspace/${taskId}/${response.context.item.id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClaimingTaskId(null);
    }
  };

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  if (error) {
    return <div style={styles.error}>错误: {error}</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>任务市场</h2>
        <span style={styles.role}>{role}</span>
      </div>

      <div style={styles.taskGrid}>
        {tasks.map((task) => (
          <div key={task.id} style={styles.taskCard}>
            <h3 style={styles.taskTitle}>{task.title}</h3>
            <p style={styles.taskDesc}>{task.description}</p>
            <div style={styles.taskMeta}>
              <span style={styles.status}>{task.status}</span>
              {task.quota && (
                <span style={styles.quota}>配额: {task.quota.total}</span>
              )}
            </div>
            <button
              style={styles.button}
              onClick={() => handleClaimTask(task.id)}
              disabled={claimingTaskId === task.id}
            >
              {claimingTaskId === task.id ? "领取中..." : "领取任务"}
            </button>
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <div style={styles.empty}>
          <p>暂无可领取的任务</p>
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
  title: {
    fontSize: "1.8rem",
    color: "#1a1a2e",
  },
  role: {
    backgroundColor: "#4caf50",
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
  quota: {
    color: "#999",
    fontSize: "0.8rem",
  },
  button: {
    width: "100%",
    padding: "12px",
    backgroundColor: "#4caf50",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "1rem",
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
};