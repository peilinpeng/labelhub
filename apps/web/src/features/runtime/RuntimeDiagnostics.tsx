import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerPayload, LabelHubRuntimeContext, LabelHubSchema, RuntimeTraceEvent } from "@labelhub/contracts";
import { AsyncSchemaCompiler } from "@labelhub/schema-compiler";
import type { CompiledSchema } from "@labelhub/schema-compiler";
import { SchemaRenderer } from "@labelhub/schema-renderer";

export function RuntimeDiagnostics({ schema, context }: { schema: LabelHubSchema; context: LabelHubRuntimeContext }) {
  const [open, setOpen] = useState(false);
  return <section className="card runtime-diagnostics"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "关闭运行诊断" : "打开运行诊断"}</button>
    {open && <DiagnosticsContent schema={schema} context={context} />}
  </section>;
}
function DiagnosticsContent({ schema, context }: { schema: LabelHubSchema; context: LabelHubRuntimeContext }) {
  const compiler = useRef<AsyncSchemaCompiler | null>(null);
  const [compiled, setCompiled] = useState<{ schema: LabelHubSchema; value: CompiledSchema }>();
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<AnswerPayload>({});
  const [events, setEvents] = useState<RuntimeTraceEvent[]>([]);
  const [recording, setRecording] = useState(true);
  const [field, setField] = useState("");
  useEffect(() => {
    compiler.current = new AsyncSchemaCompiler(() => new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "module" }));
    return () => { compiler.current?.dispose(); compiler.current = null; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setEvents([]); setAnswers({}); setError(""); setField("");
    void compiler.current!.compile(schema, controller.signal).then((value) => {
      if (!controller.signal.aborted) setCompiled({ schema, value });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "模板编译失败");
    });
    return () => controller.abort();
  }, [schema]);
  const trace = useCallback((event: RuntimeTraceEvent) => { setEvents((current) => [...current, event].slice(-200)); }, []);
  const value = compiled?.schema === schema ? compiled.value : undefined;
  if (error) return <p role="alert">{error}</p>;
  if (!value) return <p role="status">正在编译模板…</p>;
  const edges = value.graph.edges.filter((edge) => !field || edge.fromFieldName === field || edge.toFieldName === field);
  return <div className="page-stack">
    <h3>依赖图与运行追踪</h3><p>在此试填观察规则。记录仅保存在当前面板，最多 200 条，不记录答案；关闭后清空。</p>
    <label>检查字段 <select value={field} onChange={(event) => setField(event.target.value)}><option value="">全部字段</option>{value.graph.nodes.map((node) => <option key={node.nodeId} value={node.fieldName}>{node.title}（{node.fieldName}）</option>)}</select></label>
    <div role="img" aria-label="字段依赖图" className="dependency-graph">
      {edges.length ? edges.map((edge, index) => <div className="dependency-edge" key={`${edge.ruleId}-${index}`}><code>{edge.fromFieldName}</code><span aria-hidden="true"> → </span><code>{edge.toFieldName}</code><span> · {edge.source} · {edge.ruleId} · {edge.effectActions.join("、")}</span></div>) : <p>当前字段没有依赖边。</p>}
    </div>
    <SchemaRenderer key={schema.schemaId} schema={schema} context={{ ...context, answers }} answers={answers} mode="PREVIEW" engine="formily-v2" compiledSchema={value} onAnswersChange={setAnswers} {...(recording ? { onTrace: trace } : {})} />
    <div><button type="button" onClick={() => setRecording(!recording)}>{recording ? "暂停记录" : "继续记录"}</button> <button type="button" onClick={() => setEvents([])}>清空追踪</button></div>
    <div className="runtime-trace-list" role="log" aria-label="运行追踪" aria-live="off"><table><thead><tr><th>序号</th><th>事件</th><th>规则</th><th>字段</th><th>匹配 / 动作</th></tr></thead><tbody>{events.map((event) => <tr key={event.sequence}><td>{event.sequence}</td><td>{event.kind}</td><td>{event.ruleId ?? "—"}</td><td>{event.fieldNames.join("、") || "—"}</td><td>{event.matched === undefined ? "" : event.matched ? "是 · " : "否 · "}{event.actions.join("、")}</td></tr>)}</tbody></table></div>
  </div>;
}
