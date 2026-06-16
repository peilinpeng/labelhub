import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createExportJob, downloadExportFile, fetchTask, getExportArtifactRecords, listExportJobs } from "../../api/owner";
import { RoutePath, Role } from "../../app/routes";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Input, Select } from "../../ui/primitives";
import type { ExportArtifactSummary, ExportRecord, Task } from "@labelhub/contracts";
import { appendExportGeneratedAuditSafely } from "./export-audit-events";

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
  artifactSummary?: ExportArtifactSummary;
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
  artifactSummary?: ExportArtifactSummary;
};

interface PassportPreviewState {
  loading: boolean;
  error: string | null;
  records: ExportRecord[];
  artifactSummary?: ExportArtifactSummary;
}

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

// sourcePath 必须使用 RuntimeContext 命名空间（后端 export 校验器 + worker 解析）：
// $.item.* / $.answers（整对象）/ $.review.*（需 includeReviewRecords）。
const defaultFields: ExportField[] = [
  { id: "item_id", label: "数据 ID", source: "$.item.id", alias: "item_id", enabled: true },
  { id: "source_payload", label: "原始数据", source: "$.item.sourcePayload", alias: "source_payload", enabled: true },
  { id: "answers", label: "标注答案", source: "$.answers", alias: "answers", enabled: true },
  { id: "review_status", label: "审核状态", source: "$.review.latestDecision", alias: "review_status", enabled: true },
];

export default function OwnerExportPage({ role }: OwnerExportPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);

  const [format, setFormat] = useState<ExportFormat>("JSONL");
  const [includeAudit, setIncludeAudit] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ACCEPTED");
  const [fields, setFields] = useState<ExportField[]>(defaultFields);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [passportPreviews, setPassportPreviews] = useState<Record<string, PassportPreviewState>>({});
  const [jobs, setJobs] = useState<ExportJob[]>([]);

  const enabledFields = useMemo(() => fields.filter((field) => field.enabled), [fields]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void (async () => {
      try {
        setLoadingTask(true);
        setTaskError(null);
        const data = await fetchTask(taskId);
        if (!cancelled) setTask(data);
      } catch (error) {
        if (!cancelled) {
          setTask(null);
          setTaskError(error instanceof Error ? error.message : "任务详情接口暂不可用。");
        }
      } finally {
        if (!cancelled) setLoadingTask(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const refreshBackendExportJobs = async () => {
    if (!taskId) return;
    try {
      const backendJobs = await listExportJobs(taskId);
      setJobs(backendJobs.map((job) => mapBackendExportJob(job as BackendExportJob, taskId)));
    } catch (error) {
      console.warn("导出历史刷新失败：", error);
    }
  };

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void (async () => {
      try {
        const backendJobs = await listExportJobs(taskId);
        if (!cancelled) {
          setJobs(backendJobs.map((job) => mapBackendExportJob(job as BackendExportJob, taskId)));
        }
      } catch (error) {
        console.warn("导出历史加载失败：", error);
        if (!cancelled) setJobs([]);
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
    setExporting(true);
    setExportNotice("导出任务已创建，正在异步处理。");

    try {
      if (!task?.activeSchemaVersionId) {
        throw new Error("当前任务尚未绑定已发布模板版本，不能导出。");
      }
      const schemaVersionId = task.activeSchemaVersionId;
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
      appendExportGeneratedAuditSafely({
        taskId: taskId ?? "",
        exportJob: response.exportJob,
        format,
        rowCount: response.exportJob.progress.total,
        warningCount: 0,
        targetSchemaVersionId: schemaVersionId,
        includedSchemaVersionIds: response.exportJob.mapping.includedSchemaVersionIds ?? [schemaVersionId],
        includeAudit,
        statusFilter,
        stage: "JOB_CREATED",
      });
      setJobs((current) => [backendJob, ...current]);
      window.setTimeout(() => void refreshBackendExportJobs(), 1100);
      window.setTimeout(() => void refreshBackendExportJobs(), 1600);
      setExporting(false);
      setExportNotice("导出任务已提交，进度可在下载历史中查看。");
      return;
    } catch (error) {
      console.warn("导出任务创建失败：", error);
      setExporting(false);
      setExportNotice(error instanceof Error ? `导出失败：${error.message}` : "导出失败，请稍后重试。");
      return;
    }
  };

  const handleExport = () => {
    if (shouldSuppressConfirm(CONFIRM_KEYS.export)) {
      void confirmExport();
      return;
    }
    setExportConfirmOpen(true);
  };

  const handleDownload = async (job: ExportJob) => {
    if (job.status !== "DONE") return;
    try {
      const { blob, filename } = await downloadExportFile(job.id);
      // 文件名优先用历史记录里的展示名，其次后端 Content-Disposition，最后兜底。
      const downloadName = job.fileName || filename || `${taskId ?? "export"}.${(job.format ?? "jsonl").toLowerCase()}`;
      triggerBrowserDownload(blob, downloadName);
      setExportNotice(`已开始下载 ${downloadName}`);
    } catch (error) {
      console.warn("导出文件下载失败：", error);
      setExportNotice(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请稍后重试。");
    }
  };

  const handleLoadPassportPreview = async (job: ExportJob) => {
    setPassportPreviews((current) => ({
      ...current,
      [job.id]: {
        loading: true,
        error: null,
        records: current[job.id]?.records ?? [],
        ...(current[job.id]?.artifactSummary !== undefined ? { artifactSummary: current[job.id].artifactSummary } : {}),
      },
    }));
    try {
      const response = await getExportArtifactRecords(job.id);
      const nextState: PassportPreviewState = {
        loading: false,
        error: null,
        records: response.records.slice(0, 3),
      };
      if (response.artifactSummary !== undefined) {
        const artifactSummary = response.artifactSummary;
        nextState.artifactSummary = artifactSummary;
        setJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  artifactSummary,
                  recordCount: artifactSummary.recordCount,
                }
              : item,
          ),
        );
      }
      setPassportPreviews((current) => ({ ...current, [job.id]: nextState }));
    } catch (error) {
      console.warn("查询质量护照摘要失败：", error);
      setPassportPreviews((current) => ({
        ...current,
        [job.id]: {
          loading: false,
          error: "质量摘要加载失败，请稍后重试。",
          records: current[job.id]?.records ?? [],
          ...(current[job.id]?.artifactSummary !== undefined ? { artifactSummary: current[job.id].artifactSummary } : {}),
        },
      }));
    }
  };

  // 下载质量护照 JSON：前端组装额外文件，不改原始导出 data file。
  // 内容来自 GET /exports/{id}/records（artifactSummary + 逐条 passport），容错处理空记录。
  const handleDownloadPassport = async (job: ExportJob) => {
    setPassportPreviews((current) => ({
      ...current,
      [job.id]: {
        loading: true,
        error: null,
        records: current[job.id]?.records ?? [],
        ...(current[job.id]?.artifactSummary !== undefined ? { artifactSummary: current[job.id].artifactSummary } : {}),
      },
    }));
    try {
      const response = await getExportArtifactRecords(job.id);
      // 既无批次摘要又无记录：不下载空文件，给出明确空状态说明。
      if ((response.artifactSummary === undefined || response.artifactSummary === null) && response.records.length === 0) {
        setPassportPreviews((current) => ({
          ...current,
          [job.id]: { loading: false, error: null, records: [] },
        }));
        setExportNotice("当前导出没有质量护照记录。可能是本次导出记录数为 0，或该导出生成于质量护照入口上线前。");
        return;
      }
      const payload = {
        exportId: job.id,
        artifactSummary: response.artifactSummary ?? null,
        records: response.records.map((record) => ({
          recordIndex: record.recordIndex,
          submissionId: record.submissionId,
          schemaVersionId: record.schemaVersionId,
          passport: record.passport ?? null,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      triggerBrowserDownload(blob, `quality_passport_${job.id}.json`);
      // 顺带把摘要回填到预览，避免用户还要再点一次“查看”。
      const nextState: PassportPreviewState = {
        loading: false,
        error: null,
        records: response.records.slice(0, 3),
      };
      if (response.artifactSummary !== undefined && response.artifactSummary !== null) {
        nextState.artifactSummary = response.artifactSummary;
      }
      setPassportPreviews((current) => ({ ...current, [job.id]: nextState }));
      setExportNotice(`已开始下载 quality_passport_${job.id}.json`);
    } catch (error) {
      console.warn("下载质量护照失败：", error);
      setPassportPreviews((current) => ({
        ...current,
        [job.id]: {
          loading: false,
          error: "质量护照下载失败，请稍后重试。",
          records: current[job.id]?.records ?? [],
          ...(current[job.id]?.artifactSummary !== undefined ? { artifactSummary: current[job.id].artifactSummary } : {}),
        },
      }));
      setExportNotice(error instanceof Error ? `质量护照下载失败：${error.message}` : "质量护照下载失败，请稍后重试。");
    }
  };

  if (loadingTask) {
    return <Card className="state-panel">加载导出任务中...</Card>;
  }

  if (!task) {
    return <Card className="state-panel danger-text">任务详情加载失败：{taskError ?? taskId}</Card>;
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
            <strong>-</strong>
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
              <Button type="button" disabled={job.status !== "DONE"} onClick={() => void handleDownload(job)}>
                下载
              </Button>
              {job.status === "DONE" ? (
                <PassportSummaryBlock
                  job={job}
                  preview={passportPreviews[job.id]}
                  onLoadPreview={() => void handleLoadPassportPreview(job)}
                  onDownloadPassport={() => void handleDownloadPassport(job)}
                />
              ) : null}
            </div>
          ))}
          {jobs.length === 0 ? <div className="empty-state">暂无真实导出历史</div> : null}
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

// 用 blob + 临时 <a download> 触发稳定的浏览器下载，避免直接 window.open 一个需要 token 的 URL。
function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    recordCount: job.artifactSummary?.recordCount ?? job.recordCount ?? job.rowsExported ?? done,
    ...(job.artifactSummary !== undefined ? { artifactSummary: job.artifactSummary } : {}),
  };
}

function PassportSummaryBlock({
  job,
  preview,
  onLoadPreview,
  onDownloadPassport,
}: {
  job: ExportJob;
  preview?: PassportPreviewState;
  onLoadPreview: () => void;
  onDownloadPassport: () => void;
}) {
  // summary 可能尚未加载（真实导出列表接口不返回 artifactSummary）：入口仍要展示，
  // 由用户点击“查看质量护照”按需拉取 GET /exports/{id}/records。
  const summary = preview?.artifactSummary ?? job.artifactSummary;
  const loaded = preview !== undefined && !preview.loading && preview.error === null;
  return (
    <div className="owner-export-passport">
      <div className="owner-export-passport__header">
        <div>
          <strong>数据质量护照</strong>
          {summary !== undefined ? (
            <span>记录数：{summary.recordCount ?? 0} · 护照数：{summary.passportCount ?? 0} · 警告数：{summary.warningCount ?? 0}</span>
          ) : (
            <span>查看或下载本批次的质量护照（含答案指纹、审核状态、批次哈希）。</span>
          )}
        </div>
        <div className="owner-export-passport__actions">
          <Button type="button" tone="ghost" onClick={onLoadPreview} disabled={preview?.loading === true}>
            {preview?.loading ? "加载中..." : "查看质量护照"}
          </Button>
          <Button type="button" tone="ghost" onClick={onDownloadPassport} disabled={preview?.loading === true}>
            下载质量护照 JSON
          </Button>
        </div>
      </div>
      {summary !== undefined ? (
        <div className="owner-export-passport__fingerprint">
          <span>批次指纹</span>
          <code title={summary.passportBatchHash ?? "暂无批次指纹"}>{formatHash(summary.passportBatchHash)}</code>
        </div>
      ) : null}
      {summary !== undefined && (summary.warningCount ?? 0) > 0 ? (
        <p className="owner-export-passport__warning">部分记录缺少完整质量证据。</p>
      ) : null}
      {preview?.error ? <p className="owner-export-passport__error">{preview.error}</p> : null}
      {loaded ? (
        preview.records.length > 0 ? (
          <div className="owner-export-passport-preview">
            {preview.records.map((record) => (
              <PassportRecordPreview record={record} key={`${record.exportId}:${record.submissionId}:${record.recordIndex}`} />
            ))}
          </div>
        ) : (
          <p className="owner-export-passport__empty">
            当前导出没有质量护照记录。可能是本次导出记录数为 0，或该导出生成于质量护照入口上线前。
          </p>
        )
      ) : null}
    </div>
  );
}

function PassportRecordPreview({ record }: { record: ExportRecord }) {
  const passport = record.passport;
  if (passport === undefined) {
    return (
      <div className="owner-export-passport-record">
        <div className="owner-export-passport-record__head">
          <strong className="owner-export-passport-record__id" title={record.submissionId}>{formatHash(record.submissionId)}</strong>
        </div>
        <span className="owner-export-passport-record__note">该记录暂无质量护照。</span>
      </div>
    );
  }
  return (
    <div className="owner-export-passport-record">
      <div className="owner-export-passport-record__head">
        <strong className="owner-export-passport-record__id" title={passport.submissionId}>{formatHash(passport.submissionId)}</strong>
        <span className="owner-export-passport-record__status">{reviewStatusLabel(passport.reviewStatus)}</span>
      </div>
      <dl>
        <div>
          <dt>修订字段</dt>
          <dd>{passport.reviewerPatchCount ?? 0}</dd>
        </div>
        <div>
          <dt>AI 辅助</dt>
          <dd>{passport.aiAssistUsed ? "是" : "否"}</dd>
        </div>
        <div>
          <dt>改动字段</dt>
          <dd>{passport.changedFieldNames?.length ?? 0}</dd>
        </div>
        <div>
          <dt>审计事件</dt>
          <dd>{passport.auditEventCount ?? 0}</dd>
        </div>
      </dl>
      <p className="owner-export-passport-record__hash">
        <span>答案指纹</span>
        <code title={passport.finalAnswerHash ?? "暂无答案指纹"}>{formatHash(passport.finalAnswerHash)}</code>
      </p>
    </div>
  );
}

function formatHash(hash: string | undefined): string {
  if (hash === undefined || hash.length === 0) return "暂无";
  if (hash.length <= 24) return hash;
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

function reviewStatusLabel(status: string): string {
  if (status === "APPROVED") return "已通过";
  if (status === "RETURNED") return "已打回";
  if (status === "REJECTED") return "已拒绝";
  return "未审核";
}

function buildPreview(format: ExportFormat, statusFilter: string, includeAudit: boolean, fields: ExportField[], taskId: string) {
  const payload = {
    taskId,
    format,
    filter: statusFilter,
    includeAudit,
    fields: fields.map((field) => ({ source: field.source, exportAs: field.alias })),
    records: "由后端导出任务生成",
  };

  if (format === "CSV") {
    return fields.map((field) => field.alias).join(",");
  }

  if (format === "JSONL") {
    return JSON.stringify({ taskId, format, filter: statusFilter, includeAudit, fields: fields.map((field) => field.alias) });
  }

  return JSON.stringify(payload, null, 2);
}
