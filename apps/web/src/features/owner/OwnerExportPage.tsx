import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createExportJob, listExportJobs } from "../../api/owner";
import { RoutePath, Role } from "../../app/routes";
import { getDemoWorkflowState } from "../../mocks/demo-workflow-store";
import { submissionsMock } from "../../mocks/data/submissions.mock";
import { tasksMock } from "../../mocks/data/tasks.mock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Input, Select } from "../../ui/primitives";
import type { ID } from "@labelhub/contracts";

interface OwnerExportPageProps {
  role: Role;
}

type ExportFormat = "JSON" | "JSONL" | "CSV" | "EXCEL";
type ExportJobStatus = "QUEUED" | "PROCESSING" | "DONE";

interface ExportField {
  id: string;
  label: string;
  source: string;
  alias: string;
  enabled: boolean;
}

interface ExportJob {
  id: string;
  format: ExportFormat;
  status: ExportJobStatus;
  progress: number;
  createdAt: string;
  fileName: string;
  recordCount: number;
}

type BackendExportJob = {
  id?: string;
  format?: string;
  status?: string;
  mapping?: { format?: string };
  progress?: number | { total?: number; done?: number };
  createdAt?: string;
  fileName?: string;
  recordCount?: number;
  rowsExported?: number;
};

const exportFormats: Array<{
  value: ExportFormat;
  title: string;
  icon: string;
  description: string;
}> = [
  { value: "JSON", title: "JSON", icon: "JS", description: "结构化对象，适合系统集成" },
  { value: "JSONL", title: "JSONL", icon: "JL", description: "逐行记录，适合大规模训练数据" },
  { value: "CSV", title: "CSV", icon: "CSV", description: "表格文本，适合数据分析" },
  { value: "EXCEL", title: "Excel", icon: "XLS", description: "工作簿格式，适合业务交付" },
];

const defaultFields: ExportField[] = [
  { id: "item_id", label: "数据 ID", source: "item.id", alias: "item_id", enabled: true },
  { id: "source_title", label: "新闻标题", source: "sourcePayload.title", alias: "title", enabled: true },
  { id: "quality_rating", label: "质量判断", source: "answers.qualityRating", alias: "quality_rating", enabled: true },
  { id: "summary", label: "新闻摘要", source: "answers.summary", alias: "summary", enabled: true },
  { id: "rewrite_suggestion", label: "修改建议", source: "answers.rewriteSuggestion", alias: "rewrite_suggestion", enabled: true },
];

export default function OwnerExportPage({ role }: OwnerExportPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const task = tasksMock.find((item) => item.id === taskId);
  const demoState = getDemoWorkflowState();
  const approvedCount =
    submissionsMock.filter((submission) => submission.taskId === taskId && submission.status === "ACCEPTED").length +
    (taskId === "task_news_quality" && demoState.submissionStatus === "ACCEPTED" ? 1 : 0);

  const [format, setFormat] = useState<ExportFormat>("JSONL");
  const [includeAudit, setIncludeAudit] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ACCEPTED");
  const [fields, setFields] = useState<ExportField[]>(defaultFields);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [jobs, setJobs] = useState<ExportJob[]>([
    {
      id: "exp_demo_001",
      format: "JSONL",
      status: "DONE",
      progress: 100,
      createdAt: "2026-06-03 10:24",
      fileName: "news_quality_approved.jsonl",
      recordCount: Math.max(approvedCount, 289),
    },
  ]);

  const enabledFields = useMemo(() => fields.filter((field) => field.enabled), [fields]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void (async () => {
      try {
        const backendJobs = await listExportJobs(taskId);
        if (!cancelled && backendJobs.length > 0) {
          setJobs(backendJobs.map((job) => mapBackendExportJob(job as BackendExportJob, taskId)));
        }
      } catch (error) {
        console.warn("Export history unavailable, using local history fallback:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const updateField = (id: string, patch: Partial<ExportField>) => {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };

  const confirmExport = async () => {
    const jobId = `exp_${Date.now()}`;
    const createdAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const fileName = `${taskId ?? "task"}_${statusFilter.toLowerCase()}.${format.toLowerCase() === "excel" ? "xlsx" : format.toLowerCase()}`;
    const nextJob: ExportJob = {
      id: jobId,
      format,
      status: "QUEUED",
      progress: 12,
      createdAt,
      fileName,
      recordCount: approvedCount,
    };

    setExporting(true);
    setExportNotice("导出任务已创建，正在异步处理。");
    setJobs((current) => [nextJob, ...current]);

    try {
      const fallbackSchemaVersionId: ID = `sv_${taskId ?? "task"}_draft`;
      const schemaVersionId = task?.activeSchemaVersionId ?? fallbackSchemaVersionId;
      const response = await createExportJob(taskId ?? "", {
        mapping: {
          schemaVersionId,
          format,
          answerSource: "PATCHED_ANSWERS",
          allowPatchedAnswers: true,
          includeReviewRecords: includeAudit,
          columns: enabledFields.map((field) => ({
            header: field.alias || field.label,
            sourcePath: field.source,
          })),
          filters: {
            acceptedOnly: statusFilter === "ACCEPTED",
            submissionStatus: [statusFilter as never],
          },
        },
      });
      const backendJob = mapBackendExportJob(response.exportJob as BackendExportJob, taskId ?? "");
      setJobs((current) => current.map((job) => (job.id === jobId ? backendJob : job)));
      setExporting(false);
      setExportNotice("导出任务已提交，进度可在下载历史中查看。");
      return;
    } catch (error) {
      console.warn("Backend export unavailable, using local async export fallback:", error);
    }

    window.setTimeout(() => {
      setJobs((current) =>
        current.map((job) => (job.id === jobId ? { ...job, status: "PROCESSING", progress: 58 } : job)),
      );
    }, 350);

    window.setTimeout(() => {
      setJobs((current) =>
        current.map((job) => (job.id === jobId ? { ...job, status: "DONE", progress: 100 } : job)),
      );
      setExporting(false);
      setExportNotice("导出完成，可在下载历史中获取文件。");
    }, 900);
  };

  const handleExport = () => {
    if (shouldSuppressConfirm(CONFIRM_KEYS.export)) {
      void confirmExport();
      return;
    }
    setExportConfirmOpen(true);
  };

  const handleDownload = (job: ExportJob) => {
    const payload = buildDownloadPayload(job, enabledFields, includeAudit, taskId ?? "");
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = job.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!task) {
    return <Card className="state-panel danger-text">任务不存在：{taskId}</Card>;
  }

  return (
    <div className="page-stack owner-export-page">
      <div className="page-header owner-export-header">
        <div>
          <h2 className="page-title">导出中心</h2>
          <p className="page-subtitle">当前角色：{role}。导出 {task.title} 的审核通过数据。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      <Card className="owner-export-card">
        <div className="owner-export-task">
          <Badge tone="primary">任务 {taskId}</Badge>
          <div>
            <h3>{task.title}</h3>
            <p>{task.description}</p>
          </div>
          <div className="owner-export-task__metrics">
            <span>已审核通过</span>
            <strong>{approvedCount}</strong>
          </div>
        </div>

        <section className="owner-export-section">
          <div className="owner-export-section__title">
            <h3>导出格式</h3>
            <span>支持 JSON / JSONL / CSV / Excel</span>
          </div>
          <div className="owner-export-format-grid" role="radiogroup" aria-label="导出格式">
            {exportFormats.map((item) => (
              <button
                aria-checked={format === item.value}
                className={["owner-export-format", format === item.value ? "owner-export-format--active" : ""]
                  .filter(Boolean)
                  .join(" ")}
                key={item.value}
                role="radio"
                type="button"
                onClick={() => setFormat(item.value)}
              >
                <span>{item.icon}</span>
                <strong>{item.title}</strong>
                <small>{format === item.value ? "当前选择" : item.description}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="owner-export-section owner-export-controls">
          <label className="field-label">
            导出格式
            <Select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              {exportFormats.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.title}
                </option>
              ))}
            </Select>
          </label>
          <label className="field-label">
            状态过滤
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ACCEPTED">已通过</option>
              <option value="RETURNED">已打回</option>
              <option value="SUBMITTED">已提交</option>
            </Select>
          </label>
          <label className="owner-export-check">
            <input
              type="checkbox"
              checked={includeAudit}
              onChange={(event) => setIncludeAudit(event.target.checked)}
            />
            包含审核记录和任务元数据
          </label>
        </section>

        <section className="owner-export-section">
          <div className="owner-export-section__title">
            <h3>字段映射</h3>
            <span>选择导出字段，可重命名列名</span>
          </div>
          <div className="owner-export-field-map">
            {fields.map((field) => (
              <div className="owner-export-field-row" key={field.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={(event) => updateField(field.id, { enabled: event.target.checked })}
                  />
                  <span>{field.label}</span>
                </label>
                <code>{field.source}</code>
                <Input
                  aria-label={`${field.label} 导出列名`}
                  value={field.alias}
                  onChange={(event) => updateField(field.id, { alias: event.target.value })}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="owner-export-section">
          <div className="owner-export-section__title">
            <h3>导出预览</h3>
            <span>{enabledFields.length} 个字段将被导出</span>
          </div>
          <div className="inset-well">
            <pre className="source-json">{buildPreview(format, statusFilter, includeAudit, enabledFields, taskId ?? "")}</pre>
          </div>
        </section>

        <Button tone="success" onClick={handleExport} disabled={exporting || enabledFields.length === 0}>
          {exporting ? "异步导出中..." : "开始导出"}
        </Button>
        {exportNotice ? <Badge tone="success">{exportNotice}</Badge> : null}
      </Card>

      <Card className="owner-export-card">
        <div className="owner-export-section__title">
          <h3>下载历史</h3>
          <span>异步导出任务进度可查</span>
        </div>
        <div className="owner-export-history">
          {jobs.map((job) => (
            <div className="owner-export-job" key={job.id}>
              <div>
                <strong>{job.fileName}</strong>
                <span>{job.createdAt} · {job.format} · {job.recordCount} 条</span>
              </div>
              <Badge tone={job.status === "DONE" ? "success" : job.status === "PROCESSING" ? "primary" : "warning"}>
                {job.status === "DONE" ? "已完成" : job.status === "PROCESSING" ? "处理中" : "排队中"}
              </Badge>
              <div className="owner-export-progress" aria-label={`进度 ${job.progress}%`}>
                <span style={{ width: `${job.progress}%` }} />
              </div>
              <Button type="button" disabled={job.status !== "DONE"} onClick={() => handleDownload(job)}>
                下载
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={exportConfirmOpen}
        title="确认导出数据？"
        description="将异步导出当前任务中已审核通过的数据，并生成下载历史记录。"
        confirmText="导出"
        cancelText="取消"
        suppressLabel="本次会话不再提醒导出确认"
        onCancel={() => setExportConfirmOpen(false)}
        onConfirm={(suppress) => {
          if (suppress) suppressConfirmForSession(CONFIRM_KEYS.export);
          setExportConfirmOpen(false);
          void confirmExport();
        }}
      />
    </div>
  );
}

function mapBackendExportJob(job: BackendExportJob, taskId: string): ExportJob {
  const backendStatus = job.status ?? "PENDING";
  const total = typeof job.progress === "object" ? Number(job.progress.total ?? 0) : 0;
  const done = typeof job.progress === "object" ? Number(job.progress.done ?? 0) : 0;
  const progress =
    typeof job.progress === "number" ? job.progress : total > 0 ? Math.round((done / total) * 100) : backendStatus === "SUCCEEDED" ? 100 : 12;
  const format = (job.format ?? job.mapping?.format ?? "JSONL") as ExportFormat;
  return {
    id: job.id ?? `exp_${Date.now()}`,
    format,
    status: backendStatus === "SUCCEEDED" ? "DONE" : backendStatus === "RUNNING" ? "PROCESSING" : "QUEUED",
    progress,
    createdAt: job.createdAt ?? new Date().toLocaleString("zh-CN", { hour12: false }),
    fileName: job.fileName ?? `${taskId}_${format.toLowerCase()}.${format === "EXCEL" ? "xlsx" : format.toLowerCase()}`,
    recordCount: job.recordCount ?? job.rowsExported ?? done,
  };
}

function buildPreview(format: ExportFormat, statusFilter: string, includeAudit: boolean, fields: ExportField[], taskId: string) {
  const record = Object.fromEntries(fields.map((field) => [field.alias || field.id, sampleValueFor(field.id)]));
  const payload = {
    taskId,
    format,
    filter: statusFilter,
    includeAudit,
    fields: fields.map((field) => ({ source: field.source, exportAs: field.alias })),
    records: [record],
  };

  if (format === "CSV") {
    return `${fields.map((field) => field.alias).join(",")}\n${fields.map((field) => sampleValueFor(field.id)).join(",")}`;
  }

  if (format === "JSONL") {
    return JSON.stringify({ taskId, ...record, audit: includeAudit ? "included" : "excluded" });
  }

  return JSON.stringify(payload, null, 2);
}

function buildDownloadPayload(job: ExportJob, fields: ExportField[], includeAudit: boolean, taskId: string) {
  return buildPreview(job.format, "ACCEPTED", includeAudit, fields, taskId);
}

function sampleValueFor(fieldId: string) {
  const values: Record<string, string> = {
    item_id: "item_001",
    source_title: "示例新闻标题",
    quality_rating: "pass",
    summary: "新闻摘要示例",
    rewrite_suggestion: "修改建议示例",
  };
  return values[fieldId] ?? "示例值";
}
