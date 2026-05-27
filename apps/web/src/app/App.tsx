import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RoutePath, Role } from "./routes";
import OwnerWorkspace from "../features/owner/OwnerWorkspace";
import OwnerSchemaPage from "../features/owner/OwnerSchemaPage";
import OwnerAIPage from "../features/owner/OwnerAIPage";
import OwnerExportPage from "../features/owner/OwnerExportPage";
import OwnerNewTaskPage from "../features/owner/OwnerNewTaskPage";
import LabelerWorkspace from "../features/labeler/LabelerWorkspace";
import AssignmentPage from "../features/labeler/AssignmentPage";
import ReviewerWorkspace from "../features/reviewer/ReviewerWorkspace";
import ReviewDetailPage from "../features/reviewer/ReviewDetailPage";

function RoleSelector({ onSelect }: { onSelect: (role: Role) => void }) {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>LabelHub 数据标注平台</h1>
      <p style={styles.subtitle}>选择您的角色</p>
      <div style={styles.buttonContainer}>
        <button style={styles.button} onClick={() => onSelect("OWNER")}>
          👑 任务所有者
        </button>
        <button style={styles.button} onClick={() => onSelect("LABELER")}>
          ✏️ 标注员
        </button>
        <button style={styles.button} onClick={() => onSelect("REVIEWER")}>
          🔍 审核员
        </button>
      </div>
    </div>
  );
}

function App() {
  const [role, setRole] = useState<Role | null>(null);

  if (role === null) {
    return <RoleSelector onSelect={setRole} />;
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f7fa" }}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.headerTitle}>LabelHub</h1>
          <div style={styles.headerRight}>
            <span style={styles.roleBadge}>{role}</span>
            <button style={styles.switchButton} onClick={() => setRole(null)}>
              切换角色
            </button>
          </div>
        </div>
      </header>
      <main style={styles.main}>
        <Routes>
          <Route path={RoutePath.HOME} element={<Navigate to={`/${role.toLowerCase()}/tasks`} />} />
          
          <Route path={RoutePath.OWNER_TASKS} element={<OwnerWorkspace role={role} />} />
          <Route path={RoutePath.OWNER_TASKS_NEW} element={<OwnerNewTaskPage role={role} />} />
          <Route path={RoutePath.OWNER_TASKS_DESIGNER} element={<OwnerSchemaPage role={role} />} />
          <Route path={RoutePath.OWNER_TASKS_AI_CONFIG} element={<OwnerAIPage role={role} />} />
          <Route path={RoutePath.OWNER_TASKS_EXPORT} element={<OwnerExportPage role={role} />} />
          
          <Route path={RoutePath.LABELER_TASKS} element={<LabelerWorkspace role={role} />} />
          <Route path={RoutePath.LABELER_WORKSPACE} element={<AssignmentPage role={role} />} />
          
          <Route path={RoutePath.REVIEWER_QUEUE} element={<ReviewerWorkspace role={role} />} />
          <Route path={RoutePath.REVIEWER_SUBMISSIONS} element={<ReviewDetailPage role={role} />} />
          
          <Route path="*" element={<Navigate to={`/${role.toLowerCase()}/tasks`} />} />
        </Routes>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: "20px",
    backgroundColor: "#f5f7fa",
  },
  title: {
    fontSize: "2.5rem",
    color: "#1a1a2e",
    marginBottom: "10px",
  },
  subtitle: {
    fontSize: "1.2rem",
    color: "#666",
    marginBottom: "40px",
  },
  buttonContainer: {
    display: "flex",
    gap: "20px",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  button: {
    padding: "15px 40px",
    fontSize: "1.1rem",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    backgroundColor: "#4a69bd",
    color: "white",
    transition: "all 0.3s ease",
    minWidth: "180px",
  },
  header: {
    backgroundColor: "#1a1a2e",
    color: "white",
    padding: "15px 20px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  },
  headerContent: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    maxWidth: "1400px",
    margin: "0 auto",
  },
  headerTitle: {
    fontSize: "1.5rem",
    fontWeight: "bold",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  roleBadge: {
    backgroundColor: "#4a69bd",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  switchButton: {
    backgroundColor: "#3d3d5c",
    color: "white",
    border: "none",
    padding: "8px 16px",
    borderRadius: "5px",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  main: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "20px",
  },
};

export default App;