import { listSchemaVersions, type SchemaVersionHistoryItem } from "../../api/owner";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { ID, MigrationCandidate, MigrationJob, MigrationRecord, Task, TaskPermission, TaskPermissionGrant } from "@labelhub/contracts";
import { TASK_PERMISSIONS } from "@labelhub/contracts";
import * as api from "../../api/governance";

const statusLabels: Record<MigrationJob["status"], string> = { DRAFT: "待预演", READY: "预演通过", BLOCKED: "预演阻断", PENDING_APPROVAL: "待独立审批", APPROVED: "已批准", REJECTED: "已驳回", QUEUED: "排队中", RUNNING: "执行中", SUCCEEDED: "已完成", PARTIAL: "存在源数据冲突", FAILED: "执行失败", CANCELED: "已取消" };
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
function jsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("映射必须为 JSON 对象");
  return parsed as Record<string, unknown>;
}
function stringMap(value: string): Record<string, string> {
  const parsed = jsonObject(value);
  if (Object.values(parsed).some((entry) => typeof entry !== "string")) throw new Error("字段映射的值必须为字符串");
  return parsed as Record<string, string>;
}
function optionMap(value: string): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(jsonObject(value)).map(([key, entry]) => [key, stringMap(JSON.stringify(entry))]));
}
export default function GovernancePage() {
  const [search, setSearch] = useSearchParams();
  const taskId = search.get("taskId") ?? "";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void api.governanceTasks().then((result) => setTasks(result.items)).catch((failure: unknown) => setError(message(failure))); }, []);
  return <div className="page-stack governance-page"><h1>迁移与任务权限</h1><p>历史答卷保持不变。迁移先预演，再由另一位获授权用户审批，最后生成独立产物。</p>
    {error && <p role="alert">{error}</p>}<label>选择任务 <select value={taskId} onChange={(event) => setSearch({ taskId: event.target.value })}><option value="">请选择有治理权限的任务</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
    {taskId ? <TaskGovernance key={taskId} taskId={taskId} /> : <p>只显示你拥有治理权限的任务。审批人需先获得该任务的迁移读取与审批权限。</p>}
  </div>;
}
function TaskGovernance({ taskId }: { taskId: string }) {
  const [permissions, setPermissions] = useState<TaskPermission[]>([]);
  const [grants, setGrants] = useState<TaskPermissionGrant[]>([]);
  const [jobs, setJobs] = useState<MigrationJob[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>();
  const refresh = useCallback(async () => {
    const effective = await api.effectivePermissions(taskId);
    setPermissions(effective.permissions);
    if (effective.permissions.includes("migration.read")) {
      const result = await api.listMigrations(taskId, page); setJobs(result.items); setTotal(result.total);
    } else { setJobs([]); setTotal(0); }
    if (effective.permissions.includes("permissions.manage")) setGrants((await api.listGrants(taskId)).grants);
    else setGrants([]);
  }, [taskId, page]);
  useEffect(() => { let active = true; setLoading(true); void refresh().catch((failure: unknown) => { if (active) setError(message(failure)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [refresh]);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING")) return;
    const timer = setInterval(() => { void refresh().catch((failure: unknown) => setError(message(failure))); }, 3000);
    return () => clearInterval(timer);
  }, [jobs, refresh]);
  const perform = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); await refresh(); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } };
  return <div className="page-stack">{loading && <p role="status">正在加载治理数据…</p>}{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void perform(refresh)}>刷新权限与状态</button>
    {permissions.includes("permissions.manage") && <section className="card"><h2>任务授权</h2><GrantForm busy={busy} onCreate={(request) => perform(() => api.createGrants(taskId, request))} />
      <table><thead><tr><th>用户</th><th>动作</th><th>规则</th><th>到期 / 撤销</th><th>操作</th></tr></thead><tbody>{grants.map((grant) => <tr key={grant.id}><td>{grant.userId}</td><td>{grant.action}</td><td>{grant.effect === "ALLOW" ? "允许" : "拒绝"}</td><td>{grant.revokedAt ? "已撤销" : grant.expiresAt ? new Date(grant.expiresAt).toLocaleString() : "长期"}</td><td><button disabled={busy || !!grant.revokedAt} onClick={() => void perform(() => api.revokeGrant(taskId, grant.id))}>撤销</button></td></tr>)}</tbody></table></section>}
    {permissions.includes("migration.plan") && <CreateForm taskId={taskId} busy={busy} onCreate={(request) => perform(async () => { const job = await api.createMigration(taskId, request); setSelected(job.id); setPage(1); })} />}
    <section className="card"><h2>迁移计划</h2>{!jobs.length && !loading && <p>暂无可查看的迁移计划。</p>}{jobs.map((job) => <article key={job.id} className="governance-job"><button aria-expanded={selected === job.id} onClick={() => setSelected(selected === job.id ? undefined : job.id)}>{job.id} · {statusLabels[job.status]}</button><p>{job.submissionIds.length} 条提交 · 成功 {job.completedCount} · 冲突 {job.conflictCount}</p>{selected === job.id && <JobDetails job={job} permissions={permissions} busy={busy} perform={perform} />}</article>)}<button disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>上一页</button> <span>第 {page} 页，共 {total} 项</span> <button disabled={page * 20 >= total || busy} onClick={() => setPage(page + 1)}>下一页</button></section>
  </div>;
}
function CreateForm({ taskId, busy, onCreate }: { taskId: string; busy: boolean; onCreate: (request: Parameters<typeof api.createMigration>[1]) => Promise<void> }) {
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<SchemaVersionHistoryItem[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [candidates, setCandidates] = useState<MigrationCandidate[]>([]);
  const [selected, setSelected] = useState<ID[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => { void listSchemaVersions(taskId).then(setVersions).catch((failure: unknown) => setError(message(failure))); }, [taskId]);
  useEffect(() => {
    if (!source) { setCandidates([]); return; }
    let active = true;
    void api.migrationCandidates(taskId, source, page).then((result) => { if (active) { setCandidates(result.items); setTotal(result.total); } }).catch((failure: unknown) => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [taskId, source, page]);
  return <section className="card"><h2>新建迁移计划</h2><p>选择两个已发布版本及历史提交。每批最多 500 条；删除字段需明确选择归档。</p>{versions.length < 2 && <p>至少需要两个已发布版本。请先在模板版本管理中检查可用版本。</p>}<form className="page-stack" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError("");
    try { if (!selected.length || selected.length > 500) throw new Error("请选择 1–500 条提交");
      void onCreate({ fromSchemaVersionId: source as ID, toSchemaVersionId: target as ID, submissionIds: selected, renameMap: stringMap(String(data.get("renames"))), defaults: jsonObject(String(data.get("defaults"))), optionValueMap: optionMap(String(data.get("options"))), archiveRemovedFields: data.get("archive") === "on" });
    } catch (failure) { setError(message(failure)); }
  }}><label>源版本<select required value={source} onChange={(event) => { setSource(event.target.value); setSelected([]); setPage(1); }}><option value="">请选择源版本</option>{versions.map((version) => <option key={version.id} value={version.id}>版本 {version.schemaVersionNo} · {version.id}</option>)}</select></label>
    <label>目标版本<select required value={target} onChange={(event) => setTarget(event.target.value)}><option value="">请选择目标版本</option>{versions.filter((version) => version.id !== source).map((version) => <option key={version.id} value={version.id}>版本 {version.schemaVersionNo} · {version.id}</option>)}</select></label>
    {source && <fieldset><legend>历史提交 · 已选 {selected.length} 条 / 共 {total} 条</legend>{candidates.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={selected.includes(candidate.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} />{candidate.id} · {candidate.labelerId} · {candidate.status} · {new Date(candidate.createdAt).toLocaleString()}</label>)}{!candidates.length && <p>此版本暂无历史提交。</p>}<button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页提交</button> <span>第 {page} 页</span> <button type="button" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页提交</button></fieldset>}
    <label>字段重命名（JSON）<textarea name="renames" defaultValue="{}" /></label><label>新增字段默认值（JSON）<textarea name="defaults" defaultValue="{}" /></label><label>选项值映射（JSON）<textarea name="options" defaultValue="{}" /></label><label><input name="archive" type="checkbox" />归档被删除字段的历史值</label>{error && <p role="alert">{error}</p>}<button disabled={busy || !selected.length || source === target}>创建计划</button></form></section>;
}

function GrantForm({ busy, onCreate }: { busy: boolean; onCreate: (request: Parameters<typeof api.createGrants>[1]) => Promise<void> }) {
  return <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const expires = String(data.get("expires")); void onCreate({ userId: String(data.get("user")) as ID, actions: data.getAll("actions") as TaskPermission[], effect: data.get("effect") as "ALLOW" | "DENY", ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}) }); }}>
    <label>用户 ID<input required name="user" pattern="usr_.+" /></label><label>规则<select name="effect"><option value="ALLOW">允许</option><option value="DENY">拒绝（优先）</option></select></label><label>到期时间<input name="expires" type="datetime-local" /></label><fieldset><legend>动作（授权不改变用户角色）</legend>{TASK_PERMISSIONS.filter((action) => action !== "permissions.manage").map((action) => <label key={action}><input name="actions" value={action} type="checkbox" />{action}</label>)}</fieldset><button disabled={busy}>保存授权</button>
  </form>;
}
function JobDetails({ job, permissions, busy, perform }: { job: MigrationJob; permissions: TaskPermission[]; busy: boolean; perform: (action: () => Promise<unknown>) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [records, setRecords] = useState<MigrationRecord[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [recordTotal, setRecordTotal] = useState(0);
  const command = (name: Parameters<typeof api.migrationCommand>[2]) => void perform(() => api.migrationCommand(job.taskId, job.id, name, name === "approve" || name === "reject" ? { checksum: job.checksum!, reason } : undefined));
  const plan = permissions.includes("migration.plan"), approve = permissions.includes("migration.approve"), execute = permissions.includes("migration.execute");
  return <div className="page-stack"><p>发起人：{job.createdBy} · 源 {job.fromSchemaVersionId} → 目标 {job.toSchemaVersionId}</p>{job.checksum && <p className="checksum">预演摘要：<code>{job.checksum}</code></p>}{job.error && <p role="alert">{job.error}</p>}{job.approvedBy && <p>审批人：{job.approvedBy} · {job.decisionReason}</p>}
    {job.plan && <details><summary>迁移操作与警告</summary><pre>{JSON.stringify({ operations: job.plan.operations, warnings: job.plan.warnings, blockingIssues: job.plan.blockingIssues }, null, 2)}</pre></details>}
    {job.report && <details open><summary>预演报告</summary><p>{job.report.executable ? "可执行" : "已阻断"} · 涉及 {job.report.totalSubmissions} 条 · 改变 {job.report.affectedSubmissions} 条</p><pre>{JSON.stringify(job.report, null, 2)}</pre></details>}
    <div>{plan && ["DRAFT", "READY", "BLOCKED"].includes(job.status) && <button disabled={busy} onClick={() => command("dry-run")}>执行预演</button>} {plan && job.status === "READY" && <button disabled={busy} onClick={() => command("submit")}>提交独立审批</button>}
    {approve && job.status === "PENDING_APPROVAL" && <><label>审批意见<input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => command("approve")}>批准此摘要</button><button disabled={busy || !reason.trim()} onClick={() => command("reject")}>驳回</button></>}
    {execute && job.status === "APPROVED" && <button disabled={busy} onClick={() => command("execute")}>执行已批准迁移</button>}{execute && job.status === "FAILED" && <button disabled={busy} onClick={() => command("retry")}>重试</button>}
    {plan && ["DRAFT", "READY", "BLOCKED", "PENDING_APPROVAL", "APPROVED"].includes(job.status) && <button disabled={busy} onClick={() => command("cancel")}>取消计划</button>}</div>
    {["SUCCEEDED", "PARTIAL"].includes(job.status) && <><button disabled={busy} onClick={() => void perform(async () => { const result = await api.migrationRecords(job.taskId, job.id, recordPage); setRecords(result.items); setRecordTotal(result.total); })}>加载第 {recordPage} 页迁移产物</button><div><button disabled={recordPage === 1} onClick={() => setRecordPage(recordPage - 1)}>上一页产物</button> <button disabled={recordPage * 20 >= recordTotal} onClick={() => setRecordPage(recordPage + 1)}>下一页产物</button></div><pre aria-label="迁移产物">{JSON.stringify(records, null, 2)}</pre></>}
  </div>;
}
