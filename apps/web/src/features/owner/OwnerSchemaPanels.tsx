import type { Dispatch, DragEvent, MouseEvent, SetStateAction } from "react";
import { SchemaDesigner } from "@labelhub/schema-designer";
import { collectFieldNodes } from "@labelhub/schema-core";
import type {
  FieldNode,
  LabelHubRuntimeContext,
  LabelHubSchema,
  SchemaValidationResult,
  ServerComponentRegistryItem,
} from "@labelhub/contracts";
import { Link } from "react-router";
import { Badge, Button, Card, HelpDisclosure } from "../../ui/primitives";
import {
  FIELD_SECTIONS,
  collectSelectableNodeSummaries,
  conditionActionLabels,
  conditionOperatorLabels,
  formatSchemaIssue,
  updateConditionRule,
  updateValidationRule,
  validationTypeLabels,
  type AiSchemaDraftPreview,
  type ConditionAction,
  type ConditionOperator,
  type ConditionRuleDraft,
  type DataFieldInfo,
  type SchemaPresetOption,
  type ValidationRuleDraft,
  type VisualValidationType,
} from "./schema-normalization";

export function SchemaDataFieldPanel({
  open,
  fields,
  onAdd,
  onClose,
}: {
  open: boolean;
  fields: DataFieldInfo[];
  onAdd(fieldName: string): void;
  onClose(): void;
}) {
  if (!open) return null;
  return (
    <div className="owner-data-fields-overlay" role="presentation">
      <button type="button" className="owner-data-fields-backdrop" aria-label="关闭数据字段面板" onClick={onClose} />
      <aside className="owner-data-fields-drawer" role="dialog" aria-modal="true" aria-label="数据字段">
        <header className="owner-data-fields-drawer__head">
          <div>
            <h3>数据字段</h3>
          </div>
          <button type="button" className="owner-data-fields-drawer__close" aria-label="关闭数据字段面板" onClick={onClose}>×</button>
        </header>
        <div className="owner-data-fields-drawer__body">
          {fields.length === 0 ? (
            <p className="owner-data-fields-empty">当前任务还没有可读取的数据字段。请先在数据管理导入 JSON / JSONL 数据。</p>
          ) : FIELD_SECTIONS.map((section) => {
            const sectionFields = fields.filter((field) => field.role === section.role);
            if (sectionFields.length === 0) return null;
            const isAnswer = section.role === "answer";
            return (
              <section className="owner-data-fields-section" key={section.role}>
                <div className="owner-data-fields-section__head">
                  <h4>{section.title}</h4>
                </div>
                {sectionFields.map((field) => (
                  <div className={`owner-data-field-card${isAnswer ? " owner-data-field-card--answer" : ""}`} key={field.name}>
                    <div className="owner-data-field-card__head">
                      <code className="owner-data-field-card__name">{field.name}</code>
                      <Badge tone={isAnswer ? "warning" : "default"}>{field.kind}</Badge>
                    </div>
                    <p className="owner-data-field-card__sample" title={field.sample}>{field.sample}</p>
                    {isAnswer ? (
                      <>
                        <p className="owner-data-field-card__warn">可能是答案或隐藏标签，展示给标注员可能造成泄露。</p>
                        <Button type="button" disabled title="疑似答案 / 隐藏标签字段，默认禁止添加，避免答案泄露。">默认禁止添加</Button>
                      </>
                    ) : (
                      <Button type="button" tone={section.role === "recommended" ? "primary" : undefined} onClick={() => onAdd(field.name)}>
                        {section.role === "metadata" ? "高级添加" : "添加到模板：展示文本"}
                      </Button>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

export function SchemaGenerationDialog({
  open,
  prompt,
  generating,
  error,
  preview,
  selectedIds,
  onPromptChange,
  onClose,
  onGenerate,
  onApply,
  onSelectAll,
  onSelectAnswerFields,
  onClearSelection,
  onToggleNode,
}: {
  open: boolean;
  prompt: string;
  generating: boolean;
  error: string | null;
  preview: AiSchemaDraftPreview | null;
  selectedIds: Set<string>;
  onPromptChange(value: string): void;
  onClose(): void;
  onGenerate(): void;
  onApply(): void;
  onSelectAll(): void;
  onSelectAnswerFields(): void;
  onClearSelection(): void;
  onToggleNode(nodeId: string): void;
}) {
  if (!open) return null;
  const selectableNodes = preview?.schema.root.children ?? [];
  return (
    <div className="ai-schema-draft-layer" role="presentation">
      <button type="button" className="ai-schema-draft-backdrop" aria-label="关闭 AI 生成模板草稿" onClick={onClose} />
      <section className="ai-schema-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-schema-draft-title">
        <header className="ai-schema-draft-dialog__header">
          <div>
            <span>AI Schema Draft Beta</span>
            <h3 id="ai-schema-draft-title">AI 生成模板草稿 Beta</h3>
            <HelpDisclosure summary="查看草稿使用规则">
              生成结果需手动应用；不会自动保存或发布。
            </HelpDisclosure>
          </div>
          <button type="button" aria-label="关闭 AI 生成模板草稿" disabled={generating} onClick={onClose}>×</button>
        </header>
        <div className="ai-schema-draft-dialog__body">
          <label className="ai-schema-draft-prompt">
            自然语言需求
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="例如：我想做新闻质量评估，需要判断标题是否准确、正文是否完整、是否有低俗内容，并让标注员填写修改建议。"
            />
          </label>
          {error ? <div className="ai-schema-draft-error" role="alert">{error}</div> : null}
          {preview ? (
            <div className="ai-schema-draft-preview">
              <div className="ai-schema-draft-preview__summary">
                <div><strong>{preview.schema.root.children.length}</strong><span>生成节点</span></div>
                <div><strong>{collectFieldNodes(preview.schema).length}</strong><span>作答字段</span></div>
                <div><strong>{preview.validation.valid ? "通过" : "需检查"}</strong><span>AI 校验</span></div>
              </div>
              <div className="ai-schema-draft-select-toolbar" role="group" aria-label="选择性导入快捷操作">
                <span className="ai-schema-draft-select-count">已选 {selectedIds.size} / {selectableNodes.length} 项</span>
                <div className="ai-schema-draft-select-actions">
                  <Button type="button" tone="ghost" onClick={onSelectAll}>全选</Button>
                  <Button type="button" tone="ghost" onClick={onSelectAnswerFields}>只选作答字段</Button>
                  <Button type="button" tone="ghost" onClick={onClearSelection}>清空</Button>
                </div>
              </div>
              <div className="ai-schema-draft-field-list">
                {collectSelectableNodeSummaries(preview.schema).map((item) => (
                  <label className="ai-schema-draft-field-row" key={item.id}>
                    <input type="checkbox" className="ai-schema-draft-field-check" checked={selectedIds.has(item.id)} onChange={() => onToggleNode(item.id)} />
                    <div><strong>{item.title}</strong><span>{item.name}</span></div>
                    <Badge tone="default">{item.type}</Badge>
                    <Badge tone={item.required ? "warning" : "default"}>{item.required ? "必填" : "可选"}</Badge>
                  </label>
                ))}
              </div>
              {(preview.validation.errors.length > 0 || preview.warnings.length > 0) ? (
                <div className="ai-schema-draft-issues">
                  {preview.validation.errors.map((issue, index) => <p key={`error-${index}`}><strong>校验错误：</strong>{formatSchemaIssue(issue)}</p>)}
                  {preview.warnings.map((warning, index) => <p key={`warning-${index}`}><strong>AI warning：</strong>{formatSchemaIssue(warning)}</p>)}
                </div>
              ) : <p className="ai-schema-draft-empty">未返回 warning 或校验错误。应用前仍建议检查字段名称、选项和必填规则。</p>}
              <p className="ai-schema-draft-trace">调用记录：{preview.generatedBy.llmCallId}</p>
            </div>
          ) : null}
        </div>
        <footer className="ai-schema-draft-dialog__actions">
          <Button type="button" disabled={generating} onClick={onGenerate}>{generating ? "生成中..." : "生成草稿预览"}</Button>
          <Button type="button" tone="primary" disabled={preview === null || generating || selectedIds.size === 0} onClick={onApply}>
            {selectedIds.size === 0 ? "请选择至少 1 项" : `应用选中的 ${selectedIds.size} 项到当前草稿`}
          </Button>
          <Button type="button" tone="ghost" disabled={generating} onClick={onClose}>取消</Button>
        </footer>
      </section>
    </div>
  );
}

export function SchemaPresetPanel({
  presets,
  activePresetId,
  issueCounts,
  schema,
  fieldCount,
  title,
  description,
  onCreateBlank,
  onLoad,
  onSaveAsPreset,
  onTitleChange,
  onDescriptionChange,
}: {
  presets: SchemaPresetOption[];
  activePresetId: string;
  issueCounts: Map<string, number>;
  schema: LabelHubSchema;
  fieldCount: number;
  title: string;
  description: string;
  onCreateBlank(): void;
  onLoad(preset: SchemaPresetOption): void;
  onSaveAsPreset(): void;
  onTitleChange(value: string): void;
  onDescriptionChange(value: string): void;
}) {
  return (
    <>
      <Card className="schema-preset-panel schema-preset-panel--compact">
        <div className="schema-preset-heading"><div><h3>常用预设模板</h3></div></div>
        <div className="schema-preset-grid schema-preset-grid--compact">
          <button className="schema-preset-card schema-preset-card--create" type="button" onClick={onCreateBlank}>
            <b className="schema-preset-plus" aria-hidden="true" /><strong>新建预设</strong><em>空白模板</em>
          </button>
          {presets.map((preset) => (
            <button className={["schema-preset-card", activePresetId === preset.id ? "schema-preset-card--active" : ""].filter(Boolean).join(" ")} key={preset.id} type="button" onClick={() => onLoad(preset)}>
              <span>{activePresetId === preset.id ? "当前模板" : preset.source === "custom" ? "自定义预设" : "预设模板"}</span>
              {(issueCounts.get(preset.id) ?? 0) > 0 ? <span className="schema-preset-card__warning">需补充配置 · {issueCounts.get(preset.id)} 项</span> : null}
              <strong>{preset.title}</strong><em>{preset.fields}</em>
            </button>
          ))}
        </div>
      </Card>
      <Card className="schema-config-card schema-config-card--wide schema-save-preset-card">
        <div className="schema-config-heading">
          <div><h3>当前模板</h3><p>{schema.root.children.length} 个节点 · {fieldCount} 个字段</p></div>
          <Button type="button" onClick={onSaveAsPreset}>另存为预设</Button>
        </div>
        <div className="schema-save-preset-form">
          <label>预设名称<input value={title} onChange={(event) => onTitleChange(event.target.value)} /></label>
          <label>说明<textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} /></label>
        </div>
      </Card>
    </>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: FieldNode[]; onChange(value: string): void }) {
  return (
    <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((field) => <option key={field.id} value={field.name}>{field.title} ({field.name})</option>)}
    </select></label>
  );
}

export function SchemaRuleEditors({
  schema,
  fieldNodes,
  conditionRules,
  validationRules,
  advancedOpen,
  templateReady,
  taskId,
  validationSummary,
  setConditionRules,
  setValidationRules,
  onAddCondition,
  onAddValidation,
  onAdvancedOpenChange,
  onExpandPreview,
}: {
  schema: LabelHubSchema;
  fieldNodes: FieldNode[];
  conditionRules: ConditionRuleDraft[];
  validationRules: ValidationRuleDraft[];
  advancedOpen: boolean;
  templateReady: boolean;
  taskId: string;
  validationSummary: { tone: "success" | "warning" | "danger"; badge: string; errors: string[]; warnings: string[] };
  setConditionRules: Dispatch<SetStateAction<ConditionRuleDraft[]>>;
  setValidationRules: Dispatch<SetStateAction<ValidationRuleDraft[]>>;
  onAddCondition(): void;
  onAddValidation(): void;
  onAdvancedOpenChange(open: boolean): void;
  onExpandPreview(): void;
}) {
  return (
    <section className="schema-visual-config">
      <Card className="schema-config-card">
        <div className="schema-config-heading"><div><h3>字段配置</h3></div><Badge tone="default">{fieldNodes.length} 个字段</Badge></div>
        {fieldNodes.length > 0 ? <div className="schema-field-config-list">{fieldNodes.map((field) => (
          <div className="schema-field-config-row" key={field.id}><strong>{field.title}</strong><span>{field.name}</span><Badge tone={field.required ? "warning" : "default"}>{field.required ? "必填" : "可选"}</Badge></div>
        ))}</div> : <p className="schema-config-empty">暂无可配置字段。请先从物料区添加输入或选择类字段。</p>}
      </Card>
      <Card className="schema-config-card">
        <div className="schema-config-heading"><div><h3>条件显示</h3></div><Button type="button" onClick={onAddCondition} disabled={fieldNodes.length === 0}>新增规则</Button></div>
        {conditionRules.length > 0 ? <div className="schema-rule-list">{conditionRules.map((rule, index) => (
          <div className="schema-rule-card" key={rule.id}>
            <div className="schema-rule-card__title"><strong>条件规则 {index + 1}</strong><button type="button" onClick={() => setConditionRules((current) => current.filter((item) => item.id !== rule.id))}>删除</button></div>
            <div className="schema-rule-grid schema-rule-grid--condition">
              <SelectField label="目标字段" value={rule.targetField} options={fieldNodes} onChange={(value) => updateConditionRule(setConditionRules, rule.id, { targetField: value })} />
              <SelectField label="条件字段" value={rule.conditionField} options={fieldNodes} onChange={(value) => updateConditionRule(setConditionRules, rule.id, { conditionField: value })} />
              <label>判断关系<select value={rule.operator} onChange={(event) => updateConditionRule(setConditionRules, rule.id, { operator: event.target.value as ConditionOperator })}>{Object.entries(conditionOperatorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>条件值<input disabled={rule.operator === "empty" || rule.operator === "notEmpty"} value={rule.value} onChange={(event) => updateConditionRule(setConditionRules, rule.id, { value: event.target.value })} placeholder="例如 pass" /></label>
              <label>动作<select value={rule.action} onChange={(event) => updateConditionRule(setConditionRules, rule.id, { action: event.target.value as ConditionAction })}>{Object.entries(conditionActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
          </div>
        ))}</div> : <p className="schema-config-empty">暂无条件规则。</p>}
      </Card>
      <Card className="schema-config-card">
        <div className="schema-config-heading"><div><h3>校验规则</h3></div><Button type="button" onClick={onAddValidation} disabled={fieldNodes.length === 0}>新增规则</Button></div>
        {validationRules.length > 0 ? <div className="schema-rule-list">{validationRules.map((rule, index) => (
          <div className="schema-rule-card" key={rule.id}>
            <div className="schema-rule-card__title"><strong>校验规则 {index + 1}</strong><button type="button" onClick={() => setValidationRules((current) => current.filter((item) => item.id !== rule.id))}>删除</button></div>
            <div className="schema-rule-grid">
              <SelectField label="目标字段" value={rule.targetField} options={fieldNodes} onChange={(value) => updateValidationRule(setValidationRules, rule.id, { targetField: value })} />
              <label>校验类型<select value={rule.type} onChange={(event) => updateValidationRule(setValidationRules, rule.id, { type: event.target.value as VisualValidationType })}>{Object.entries(validationTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>参数值<input disabled={rule.type === "required"} value={rule.value} onChange={(event) => updateValidationRule(setValidationRules, rule.id, { value: event.target.value })} placeholder={rule.type === "numberRange" ? "例如 1-100" : "例如 10"} /></label>
              <label>错误提示文案<input value={rule.message} onChange={(event) => updateValidationRule(setValidationRules, rule.id, { message: event.target.value })} placeholder="请输入错误提示" /></label>
            </div>
          </div>
        ))}</div> : <p className="schema-config-empty">暂无校验规则。</p>}
      </Card>
      <Card className="schema-config-card">
        <div className="schema-config-heading"><div><h3>表单预览</h3></div><Button type="button" onClick={onExpandPreview}>放大预览</Button></div>
        <div className="schema-preview-summary"><div><strong>{schema.root.children.length}</strong><span>画布节点</span></div><div><strong>{conditionRules.length}</strong><span>条件规则</span></div><div><strong>{validationRules.length}</strong><span>校验规则</span></div></div>
      </Card>
      <Card className="schema-config-card owner-schema-validation">
        <div className="schema-config-heading"><div><h3>校验结果</h3></div><Badge tone={validationSummary.tone}>{validationSummary.badge}</Badge></div>
        {validationSummary.errors.length === 0 && validationSummary.warnings.length === 0 ? <p className="schema-config-empty">未发现模板配置问题，可进入发布前检查。</p> : (
          <div className="owner-schema-issue-list">
            {validationSummary.errors.map((issue, index) => <div className="owner-schema-issue owner-schema-issue--error" key={`error-${index}`}><span className="owner-schema-issue-tag">必须修复</span><p>{issue}</p></div>)}
            {validationSummary.warnings.map((issue, index) => <div className="owner-schema-issue owner-schema-issue--warning" key={`warning-${index}`}><span className="owner-schema-issue-tag">建议检查</span><p>{issue}</p></div>)}
          </div>
        )}
        {templateReady ? <div className="owner-template-next-step"><span>已通过发布前检查</span><Link to={`/owner/tasks/${taskId}/ai-precheck`} className="lh-button lh-button--primary">继续配置 AI 预审</Link></div> : null}
      </Card>
      <Card className="schema-config-card schema-config-card--wide">
        <details open={advancedOpen} onToggle={(event) => onAdvancedOpenChange(event.currentTarget.open)}>
          <summary>高级 JSON 配置 / 查看 JSON</summary>
          <textarea readOnly value={JSON.stringify({ schema, visualRules: { conditionRules, validationRules } }, null, 2)} />
        </details>
      </Card>
    </section>
  );
}

export function SchemaCanvas({
  schema,
  taskId,
  templateTitle,
  registry,
  sampleContext,
  nodeErrors,
  validationResult,
  previewExpanded,
  dropActive,
  onSchemaChange,
  onClosePreview,
  onCanvasClick,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  schema: LabelHubSchema;
  taskId: string;
  templateTitle: string;
  registry: ServerComponentRegistryItem[];
  sampleContext: LabelHubRuntimeContext;
  nodeErrors: Record<string, string[]>;
  validationResult: SchemaValidationResult;
  previewExpanded: boolean;
  dropActive: boolean;
  onSchemaChange: Dispatch<SetStateAction<LabelHubSchema>>;
  onClosePreview(): void;
  onCanvasClick(event: MouseEvent<HTMLDivElement>): void;
  onDragLeave(): void;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}) {
  return (
    <Card className="schema-designer-shell schema-designer-shell--builder">
      <div className="schema-canvas-header schema-canvas-header--compact"><div><Badge tone="primary">任务 {taskId}</Badge><h3>{templateTitle}</h3><p>{schema.meta.description || "暂无说明"}</p></div></div>
      {previewExpanded ? <><button type="button" className="schema-preview-backdrop" aria-label="关闭预览" onClick={onClosePreview} /><button type="button" className="schema-preview-close" aria-label="关闭实时预览" onClick={onClosePreview}>关闭</button></> : null}
      <div className={`schema-canvas schema-canvas--builder${dropActive ? " schema-canvas--drop-active" : ""}`} onClick={onCanvasClick} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
        {dropActive ? <div className="schema-canvas-drop-hint">释放后添加到当前模板画布</div> : null}
        <SchemaDesigner key={schema.schemaId} schema={schema} serverRegistry={registry} sampleContext={sampleContext} readonly={false} nodeErrors={nodeErrors} validationResult={validationResult} onSchemaChange={onSchemaChange} />
      </div>
    </Card>
  );
}
