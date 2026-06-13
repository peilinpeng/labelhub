import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { DatasetItem, Task } from "@labelhub/contracts";
import { Role } from "../../app/routes";
import { fetchTask } from "../../api/owner";
import { Badge, Button, Card, Input, Select } from "../../ui/primitives";
import {
  importDataset,
  listItems,
  updateItem,
  inferFormat,
  type DatasetFormat,
} from "../../api/dataset";
import { getReviewConfig } from "../../api/reviewer";
import { buildTaskSetupSteps, TaskSetupStepper } from "./TaskSetupGuide";

interface OwnerDatasetPageProps {
  role: Role;
}

function statusMeta(status: DatasetItem["status"]): { label: string; tone: "success" | "warning" | "danger" | "default" } {
  switch (status) {
    case "AVAILABLE": return { label: "可领取", tone: "success" };
    case "LOCKED": return { label: "标注中", tone: "warning" };
    case "COMPLETED": return { label: "已完成", tone: "default" };
    case "DISABLED": return { label: "已禁用", tone: "danger" };
    default: return { label: status, tone: "default" };
  }
}

function previewPayload(payload: Record<string, unknown>): string {
  const s = JSON.stringify(payload);
  return s.length > 120 ? s.slice(0, 120) + " …" : s;
}

type FieldType = "文本" | "数字" | "布尔" | "数组" | "对象" | "链接" | "空值";
type FieldRole = "recommended" | "metadata" | "answer" | "other";

interface FieldSample {
  name: string;
  type: FieldType;
  role: FieldRole;
  sample: string;
  sampleIndex: number | null;
}

export default function OwnerDatasetPage({ role: _role }: OwnerDatasetPageProps) {
  const { taskId = "" } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [task, setTask] = useState<Task | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<DatasetFormat>("JSON");
  const [externalKeyPath, setExternalKeyPath] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [items, setItems] = useState<DatasetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [taskResult, configResult] = await Promise.allSettled([
          fetchTask(taskId),
          getReviewConfig(taskId),
        ]);
        if (cancelled) return;
        if (taskResult.status === "fulfilled") {
          setTask(taskResult.value);
        }
        setAiConfigured(configResult.status === "fulfilled");
      } catch {
        if (!cancelled) {
          setTask(null);
          setAiConfigured(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listItems(taskId, 1, 200);
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载题目失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onPickFile = (f: File | null) => {
    setFile(f);
    if (f) setFormat(inferFormat(f.name));
  };

  const handleImport = async () => {
    if (!file) { setImportMsg("请先选择文件"); return; }
    try {
      setImporting(true);
      setImportMsg(null);
      const r = await importDataset(taskId, file, format, externalKeyPath.trim() || undefined);
      const errPart = r.failedCount ? `，失败 ${r.failedCount}` : "";
      setImportMsg(`✅ 导入成功：新增 ${r.importedCount}，跳过 ${r.skippedCount}${errPart}`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh();
    } catch (e) {
      setImportMsg(`❌ 导入失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setImporting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  };

  const setStatus = async (ids: string[], status: "AVAILABLE" | "DISABLED") => {
    try {
      setBusy(true);
      await Promise.all(ids.map((id) => updateItem(id, { status })));
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const availableCount = items.filter((item) => item.status === "AVAILABLE").length;
  const hasData = total > 0;
  const latestImportTime = formatLatestItemTime(items);
  const fieldSamples = collectFieldSamples(items);
  const setupSteps = buildTaskSetupSteps({
    taskId,
    currentStep: "data",
    hasData,
    templateReady: Boolean(task?.activeSchemaVersionId),
    aiReady: aiConfigured,
    dataMeta: hasData ? `已导入 ${total} 条，可领取 ${availableCount} 条` : "还未导入数据",
    templateMeta: task?.activeSchemaVersionId ? "已发布模板" : "待配置模板",
    aiMeta: aiConfigured ? "已保存配置" : "待配置规则",
  });

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">数据管理</h2>
          <p className="page-subtitle">导入标注数据。请先导入本任务需要标注的数据，再继续配置标注模板。</p>
        </div>
        <div className="page-actions">
          <Link to={`/owner/tasks/${taskId}`} className="lh-button">返回任务详情</Link>
          <Link to={`/owner/tasks/${taskId}/designer`} className="lh-button">配置模板</Link>
        </div>
      </div>

      <TaskSetupStepper steps={setupSteps} />

      <Card className="soft-panel owner-data-summary-card">
        <div className="owner-section-heading">
          <div>
            <h3>{task?.title ?? "当前任务"}</h3>
            <p>数据会作为标注员领取的题目来源，发布任务前至少需要 1 条可领取数据。</p>
          </div>
          <Badge tone={hasData ? "success" : "warning"}>{hasData ? `已导入 ${total} 条` : "待导入"}</Badge>
        </div>
        <div className="owner-data-summary-grid">
          <div>
            <span>已导入数据数量</span>
            <strong>{loading ? "加载中..." : total.toLocaleString()}</strong>
            <small>当前可领取 {availableCount.toLocaleString()} 条</small>
          </div>
          <div>
            <span>最近导入时间</span>
            <strong>{latestImportTime}</strong>
            <small>按题目更新时间推断</small>
          </div>
          <div className="owner-data-field-summary">
            <span>数据字段预览</span>
            <strong>{fieldSamples.length > 0 ? `${fieldSamples.length} 个字段` : "暂无字段"}</strong>
            <small>根据已导入样本自动识别字段、类型和示例值。</small>
          </div>
        </div>
        {fieldSamples.length > 0 ? (
          <section className="owner-dataset-field-preview" aria-label="数据字段预览">
            <div className="owner-dataset-field-preview__head">
              <h4>数据字段预览</h4>
              <p>根据已导入样本自动识别字段、类型和示例值。</p>
            </div>
            <div className="owner-dataset-field-grid">
              {fieldSamples.map((field) => (
                <article
                  className={`owner-dataset-field-card owner-dataset-field-card--${field.role}`}
                  key={field.name}
                >
                  <div className="owner-dataset-field-card__head">
                    <code>{field.name}</code>
                    <div>
                      <Badge tone="default">{field.type}</Badge>
                      <Badge tone={field.role === "answer" ? "warning" : field.role === "recommended" ? "success" : "default"}>
                        {fieldRoleLabel(field.role)}
                      </Badge>
                    </div>
                  </div>
                  <p className="owner-dataset-field-card__sample" title={field.sample}>{field.sample}</p>
                  <small>
                    {field.sampleIndex === null ? "暂无示例" : `来自第 ${field.sampleIndex + 1} 条样本`}
                  </small>
                  {field.role === "answer" ? (
                    <p className="owner-dataset-field-card__warn">可能是答案或隐藏标签，不建议展示给标注员。</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : (
          <div className="owner-dataset-field-empty">暂无可预览字段。导入数据后会显示字段类型和示例值。</div>
        )}
        <div className="owner-data-next-actions">
          <Button
            type="button"
            tone="primary"
            disabled={!hasData}
            onClick={() => navigate(`/owner/tasks/${taskId}/designer`)}
          >
            继续配置模板
          </Button>
          {!hasData ? <span>请先导入至少 1 条标注数据。</span> : null}
        </div>
      </Card>

      <Card className="soft-panel">
        <h3 className="soft-panel__title">导入标注数据</h3>
        <div className="form-stack">
          <label className="field-label">
            选择文件（.json / .jsonl / .xlsx）
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.jsonl,.xlsx,.xls"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field-label">
            格式
            <Select value={format} onChange={(e) => setFormat(e.target.value as DatasetFormat)}>
              <option value="JSON">JSON（数组）</option>
              <option value="JSONL">JSONL（每行一条）</option>
              <option value="EXCEL">Excel（.xlsx）</option>
            </Select>
            <small className="field-hint">支持 JSON / JSONL / Excel。CSV 请先另存为 Excel 或 JSON 后导入，避免前端伪装后端尚未支持的格式。</small>
          </label>
          <label className="field-label">
            外部主键路径（可选，如 id 或 meta.id）
            <Input
              value={externalKeyPath}
              onChange={(e) => setExternalKeyPath(e.target.value)}
              placeholder="留空则不设置外部主键"
            />
          </label>
          <div className="page-actions">
            <Button tone="primary" onClick={handleImport} disabled={importing || !file}>
              {importing ? "导入中…" : "导入"}
            </Button>
          </div>
          {importMsg ? <p className="page-subtitle">{importMsg}</p> : null}
        </div>
      </Card>

      <Card className="soft-panel">
        <div className="page-header">
          <h3 className="soft-panel__title">数据预览表格（共 {total} 条）</h3>
          <div className="page-actions">
            <Button onClick={() => void refresh()} disabled={loading}>刷新</Button>
            <Button onClick={() => void setStatus([...selected], "DISABLED")} disabled={busy || selected.size === 0}>
              批量禁用（{selected.size}）
            </Button>
            <Button onClick={() => void setStatus([...selected], "AVAILABLE")} disabled={busy || selected.size === 0}>
              批量启用（{selected.size}）
            </Button>
          </div>
        </div>

        {error ? <p className="danger-text">{error}</p> : null}
        {loading ? (
          <p className="page-subtitle">加载中…</p>
        ) : items.length === 0 ? (
          <div className="empty-state">暂无题目，请先在上方导入数据集。</div>
        ) : (
          <table className="soft-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} /></th>
                <th>题目 ID</th>
                <th>外部主键</th>
                <th>状态</th>
                <th>原始数据预览</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const meta = statusMeta(it.status);
                const togglable = it.status === "AVAILABLE" || it.status === "DISABLED";
                return (
                  <tr key={it.id}>
                    <td><input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} /></td>
                    <td><code>{it.id}</code></td>
                    <td>{it.externalKey ?? "-"}</td>
                    <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                    <td><span title={JSON.stringify(it.sourcePayload)}>{previewPayload(it.sourcePayload)}</span></td>
                    <td>
                      {togglable ? (
                        it.status === "AVAILABLE" ? (
                          <Button onClick={() => void setStatus([it.id], "DISABLED")} disabled={busy}>禁用</Button>
                        ) : (
                          <Button onClick={() => void setStatus([it.id], "AVAILABLE")} disabled={busy}>启用</Button>
                        )
                      ) : (
                        <span className="page-subtitle">不可改</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const ROLE_ORDER: Record<FieldRole, number> = {
  recommended: 0,
  metadata: 1,
  answer: 2,
  other: 3,
};

const RECOMMENDED_FIELD_NAMES = new Set([
  "prompt", "question", "query", "instruction",
  "content", "content_markdown", "text", "body", "passage",
  "response_a", "response_b", "model_answer", "answer", "response",
  "model_a_answer", "model_b_answer", "reference",
]);
const METADATA_FIELD_NAMES = new Set([
  "id", "lang", "language", "task_type", "category", "difficulty",
  "source", "tags", "created_at", "updated_at", "media_type", "type",
]);
const ANSWER_FIELD_NAMES = new Set([
  "margin", "label", "gold", "ground_truth", "groundtruth", "target",
  "winner", "chosen", "score", "expected_label", "correct_answer",
  "gold_label", "gt", "preference", "preferred", "verdict", "is_correct",
]);

function collectFieldSamples(items: DatasetItem[]): FieldSample[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, 20)) {
    for (const key of Object.keys(item.sourcePayload ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order
    .map((name, orderIndex) => {
      const sample = findFieldSample(items, name);
      return {
        name,
        type: inferFieldType(sample.value),
        role: classifyFieldRole(name),
        sample: formatFieldSample(sample.value),
        sampleIndex: sample.index,
        orderIndex,
      };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.orderIndex - b.orderIndex)
    .map(({ orderIndex: _orderIndex, ...field }) => field);
}

function findFieldSample(items: DatasetItem[], fieldName: string): { value: unknown; index: number | null } {
  for (let i = 0; i < items.length; i += 1) {
    const value = (items[i].sourcePayload ?? {})[fieldName];
    if (!isEmptySample(value)) return { value, index: i };
  }
  return { value: undefined, index: null };
}

function isEmptySample(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function classifyFieldRole(fieldName: string): FieldRole {
  const name = fieldName.toLowerCase();
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  const hasToken = (set: Set<string>) => tokens.some((token) => set.has(token));
  if (
    ANSWER_FIELD_NAMES.has(name) ||
    hasToken(ANSWER_FIELD_NAMES) ||
    /ground_?truth|gold|winner|chosen|correct|expected_label|is_?correct/.test(name)
  ) {
    return "answer";
  }
  if (RECOMMENDED_FIELD_NAMES.has(name) || hasToken(RECOMMENDED_FIELD_NAMES)) return "recommended";
  if (
    METADATA_FIELD_NAMES.has(name) ||
    hasToken(METADATA_FIELD_NAMES) ||
    /^id$|_id$|_at$|^created|^updated/.test(name)
  ) {
    return "metadata";
  }
  return "other";
}

function fieldRoleLabel(role: FieldRole): string {
  if (role === "recommended") return "推荐展示";
  if (role === "metadata") return "元数据";
  if (role === "answer") return "疑似答案";
  return "其他字段";
}

function inferFieldType(value: unknown): FieldType {
  if (value === null || value === undefined || value === "") return "空值";
  if (Array.isArray(value)) return value.length === 0 ? "空值" : "数组";
  if (typeof value === "boolean") return "布尔";
  if (typeof value === "number") return "数字";
  if (typeof value === "object") return "对象";
  if (typeof value === "string") return isUrlLike(value) ? "链接" : "文本";
  return "文本";
}

function formatFieldSample(value: unknown): string {
  if (isEmptySample(value)) return "暂无示例";
  let text: string;
  if (Array.isArray(value)) {
    text = value.every(isPrimitiveValue)
      ? value.map(formatPrimitiveValue).join("、")
      : safeStringify(value);
  } else if (typeof value === "object") {
    text = safeStringify(value);
  } else {
    text = formatPrimitiveValue(value);
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text === "") return "暂无示例";
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function isUrlLike(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) || /^\/\//.test(trimmed);
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function formatPrimitiveValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLatestItemTime(items: DatasetItem[]): string {
  const latest = items
    .map((item) => item.updatedAt || item.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest) return "暂无导入记录";
  return new Date(latest).toLocaleString("zh-CN", { hour12: false });
}
