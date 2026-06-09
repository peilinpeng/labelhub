import { useEffect, useMemo, useState } from "react";
import type { CompatibilityReport, LabelHubSchema, SchemaChange } from "@labelhub/contracts";
import { checkBackwardCompatibility } from "@labelhub/schema-core";
import { listSchemaVersions, type SchemaVersionHistoryItem } from "../../api/owner";
import { Badge, Button, Card, Select } from "../../ui/primitives";

interface SchemaVersionPanelProps {
  taskId: string;
  /** 任务当前绑定（发布）的版本 id，用于高亮“活动版本”。 */
  activeSchemaVersionId?: string;
  /** 外部发生发布/回滚后自增此值，触发版本历史重新拉取。 */
  refreshKey?: number;
  /** 复制为新草稿：把某版本快照载入编辑器（不自动发布）。 */
  onCopyToDraft: (schema: LabelHubSchema, version: SchemaVersionHistoryItem) => void;
  /** 历史保留式回滚：以该版本快照重新发布为新版本。 */
  onRollback: (schema: LabelHubSchema, version: SchemaVersionHistoryItem) => void;
}

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("zh-CN");
}

const LEVEL_LABEL: Record<string, string> = {
  BREAKING: "破坏性",
  WARNING: "提醒",
  COMPATIBLE: "兼容",
  INFO: "信息",
};

function changeTone(level: string): "danger" | "warning" | "default" {
  if (level === "BREAKING") return "danger";
  if (level === "WARNING") return "warning";
  return "default";
}

export function SchemaVersionPanel({
  taskId,
  activeSchemaVersionId,
  refreshKey,
  onCopyToDraft,
  onRollback,
}: SchemaVersionPanelProps) {
  const [versions, setVersions] = useState<SchemaVersionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await listSchemaVersions(taskId);
        if (cancelled) return;
        setVersions(result);
        setError(null);
        // 默认对比：次新版本 → 最新版本（展示最近一次发布带来的变更）。
        if (result.length >= 2) {
          setFromId((cur) => cur || result[1].id);
          setToId((cur) => cur || result[0].id);
        } else if (result.length === 1) {
          setFromId(result[0].id);
          setToId(result[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setVersions([]);
          setError(err instanceof Error ? err.message : "版本历史加载失败。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, refreshKey]);

  const fromVersion = versions.find((v) => v.id === fromId);
  const toVersion = versions.find((v) => v.id === toId);

  const report = useMemo<CompatibilityReport | null>(() => {
    if (!fromVersion || !toVersion || fromVersion.id === toVersion.id) return null;
    try {
      // 以较旧版本为 old、较新版本为 new，方向固定为“从 from 升级到 to”。
      return checkBackwardCompatibility(fromVersion.schema, toVersion.schema);
    } catch {
      return null;
    }
  }, [fromVersion, toVersion]);

  return (
    <Card className="schema-version-panel">
      <div className="schema-version-panel__head">
        <div>
          <h3>版本管理</h3>
          <p>模板每次发布生成一个不可变版本快照。可查看历史、对比变更、复制为新草稿或回滚。</p>
        </div>
        <Badge tone={versions.length > 0 ? "primary" : "default"}>共 {versions.length} 个版本</Badge>
      </div>

      {loading ? (
        <div className="empty-state">加载版本历史中...</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : versions.length === 0 ? (
        <div className="empty-state">该任务暂无已发布版本。发布模板后，这里会显示版本历史。</div>
      ) : (
        <>
          <div className="schema-version-list">
            {versions.map((v) => {
              const isActive = activeSchemaVersionId !== undefined && v.id === activeSchemaVersionId;
              return (
                <div className={isActive ? "schema-version-row schema-version-row--active" : "schema-version-row"} key={v.id}>
                  <div className="schema-version-row__main">
                    <div className="schema-version-row__title">
                      <strong>第 {v.schemaVersionNo} 版</strong>
                      {isActive ? <Badge tone="success">任务绑定中</Badge> : null}
                      <span className="schema-version-row__contract">契约 {v.contractVersion}</span>
                    </div>
                    <span className="schema-version-row__meta">{v.id} · 发布于 {formatTime(v.publishedAt)}</span>
                  </div>
                  <div className="schema-version-row__actions">
                    <Button tone="ghost" onClick={() => onCopyToDraft(v.schema, v)}>复制为新草稿</Button>
                    <Button
                      tone="ghost"
                      disabled={isActive}
                      title={isActive ? "该版本已是当前绑定版本" : "以此版本快照重新发布为新版本"}
                      onClick={() => onRollback(v.schema, v)}
                    >
                      回滚到此版本
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {versions.length >= 2 ? (
            <div className="schema-version-compare">
              <div className="schema-version-compare__controls">
                <label>
                  <span>从版本</span>
                  <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>第 {v.schemaVersionNo} 版</option>
                    ))}
                  </Select>
                </label>
                <span className="schema-version-compare__arrow" aria-hidden="true">→</span>
                <label>
                  <span>到版本</span>
                  <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>第 {v.schemaVersionNo} 版</option>
                    ))}
                  </Select>
                </label>
              </div>

              {fromId === toId ? (
                <div className="empty-state">请选择两个不同版本进行对比。</div>
              ) : report ? (
                <CompatibilityResult report={report} />
              ) : (
                <div className="empty-state">无法生成兼容性对比。</div>
              )}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function CompatibilityResult({ report }: { report: CompatibilityReport }) {
  const verdict = report.publishAllowed
    ? report.compatible
      ? { tone: "success" as const, text: "向后兼容，可直接发布" }
      : { tone: "warning" as const, text: "有变更，可发布（建议关注）" }
    : { tone: "danger" as const, text: "存在破坏性变更，发布受限" };

  return (
    <div className="schema-version-result">
      <div className="schema-version-result__verdict">
        <Badge tone={verdict.tone}>{verdict.text}</Badge>
        {report.requiresMigration ? <Badge tone="warning">需要数据迁移</Badge> : null}
        {report.requiresApproval ? <Badge tone="warning">需要审批</Badge> : null}
      </div>

      {report.changes.length === 0 ? (
        <div className="empty-state">两个版本结构一致，无字段级变更。</div>
      ) : (
        <ul className="schema-version-changes">
          {report.changes.map((c: SchemaChange, index) => (
            <li className="schema-version-change" key={`${c.code}-${c.fieldName ?? c.nodeId ?? index}`}>
              <Badge tone={changeTone(c.level)}>{LEVEL_LABEL[c.level] ?? c.level}</Badge>
              <div className="schema-version-change__body">
                <span className="schema-version-change__msg">{c.message}</span>
                {c.recommendation ? <span className="schema-version-change__rec">建议：{c.recommendation}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {report.recommendations.length > 0 ? (
        <div className="schema-version-result__recs">
          <strong>整体建议</strong>
          <ul>
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
