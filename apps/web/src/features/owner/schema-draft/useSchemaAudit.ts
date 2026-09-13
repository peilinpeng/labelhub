import { useEffect, useState } from "react";
import type { AuditEventRecord } from "@labelhub/contracts";
import { queryAuditEvents } from "../../../api/audit";

export function useSchemaAudit(taskId: string, versionRefreshKey: number) {
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAuditTimeline = async (): Promise<void> => {
    try {
      setAuditLoading(true);
      setAuditError(null);
      const response = await queryAuditEvents({ taskId, entityType: "SCHEMA", limit: 50 });
      setAuditEvents(response.events);
    } catch (error) {
      console.warn("Owner schema 审计日志加载失败", error);
      setAuditError("审计日志加载失败，请稍后刷新重试。");
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void loadAuditTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, versionRefreshKey]);

  return { auditError, auditEvents, auditLoading, loadAuditTimeline };
}
