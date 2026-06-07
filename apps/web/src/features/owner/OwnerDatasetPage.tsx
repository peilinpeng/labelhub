import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Role } from "../../app/routes";
import { Badge, Button, Card, Input, Select } from "../../ui/primitives";
import {
  importDataset,
  listItems,
  updateItem,
  inferFormat,
  type DatasetFormat,
} from "../../api/dataset";
import type { DatasetItem } from "@labelhub/contracts";

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

export default function OwnerDatasetPage({ role: _role }: OwnerDatasetPageProps) {
  const { taskId = "" } = useParams<{ taskId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">数据集管理</h2>
          <p className="page-subtitle">任务 {taskId}：导入题目（JSON / JSONL / Excel）、预览与批量启用/禁用。</p>
        </div>
        <div className="page-actions">
          <Link to={`/owner/tasks/${taskId}`} className="lh-button">返回任务详情</Link>
          <Link to={`/owner/tasks/${taskId}/designer`} className="lh-button">配置模板</Link>
        </div>
      </div>

      {/* 导入区 */}
      <Card className="soft-panel">
        <h3 className="soft-panel__title">导入数据集</h3>
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

      {/* 题目列表 */}
      <Card className="soft-panel">
        <div className="page-header">
          <h3 className="soft-panel__title">题目列表（共 {total} 条）</h3>
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
