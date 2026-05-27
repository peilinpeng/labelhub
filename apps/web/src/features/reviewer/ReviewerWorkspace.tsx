import { useEffect, useState } from "react";
import { Role } from "../../app/routes";
import { listReviewQueue } from "../../api/reviewer";
import type { Submission } from "@labelhub/contracts";

interface ReviewerWorkspaceProps {
  role: Role;
}

export default function ReviewerWorkspace({ role }: ReviewerWorkspaceProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listReviewQueue();
        setSubmissions(data);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleViewDetail = (submissionId: string) => {
    window.location.href = `/reviewer/submissions/${submissionId}`;
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
        <h2 style={styles.title}>审核队列</h2>
        <span style={styles.role}>{role}</span>
      </div>

      <div style={styles.submissionList}>
        {submissions.map((submission) => (
          <div key={submission.id} style={styles.submissionCard}>
            <div style={styles.submissionHeader}>
              <div>
                <h3 style={styles.submissionTitle}>提交 #{submission.attemptNo}</h3>
                <span style={styles.status}>{submission.status}</span>
              </div>
              <span style={styles.date}>{submission.createdAt}</span>
            </div>
            <div style={styles.submissionMeta}>
              <span style={styles.metaItem}>任务: {submission.taskId}</span>
              <span style={styles.metaItem}>标注员: {submission.labelerId}</span>
            </div>
            <button style={styles.button} onClick={() => handleViewDetail(submission.id)}>
              查看详情
            </button>
          </div>
        ))}
      </div>

      {submissions.length === 0 && (
        <div style={styles.empty}>
          <p>暂无待审核的提交</p>
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
    backgroundColor: "#ff9800",
    color: "white",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  submissionList: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
  },
  submissionCard: {
    backgroundColor: "white",
    padding: "20px",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  submissionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "10px",
  },
  submissionTitle: {
    fontSize: "1.1rem",
    marginBottom: "5px",
    color: "#1a1a2e",
  },
  status: {
    backgroundColor: "#fff3e0",
    color: "#e65100",
    padding: "3px 10px",
    borderRadius: "4px",
    fontSize: "0.8rem",
  },
  date: {
    color: "#999",
    fontSize: "0.8rem",
  },
  submissionMeta: {
    display: "flex",
    gap: "20px",
    marginBottom: "15px",
  },
  metaItem: {
    color: "#666",
    fontSize: "0.9rem",
  },
  button: {
    padding: "10px 20px",
    backgroundColor: "#ff9800",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
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
};