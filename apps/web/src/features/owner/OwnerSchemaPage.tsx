import { Link } from "react-router-dom";
import { RoutePath, type Role } from "../../app/routes";
import { AuditTimelinePanel } from "./AuditTimelinePanel";
import { SchemaVersionPanel } from "./SchemaVersionPanel";
import { Badge, Button, Card } from "../../ui/primitives";
import { PublishPreviewDialog } from "./PublishPreviewDialog";
import { PublishReadinessPanel, TaskSetupStepper } from "./TaskSetupGuide";
import { noticeBadgeTone } from "./schema-normalization";
import {
  SchemaCanvas,
  SchemaDataFieldPanel,
  SchemaGenerationDialog,
  SchemaPresetPanel,
  SchemaRuleEditors,
} from "./OwnerSchemaPanels";
import { useSchemaDraft } from "./useSchemaDraft";

interface OwnerSchemaPageProps {
  role: Role;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const {
    taskId, schema, setSchema, task, loading, saving, publishing, publishPreviewPreparing,
    publishNotice, publishIssueListRef, publishNoticeTone, publishFailureDetails, previewExpanded, setPreviewExpanded,
    publishPreviewOpen, setPublishPreviewOpen, publishPreview, versionRefreshKey, boundVersionNo,
    setBoundVersionNo, auditEvents, auditLoading, auditError, activePresetId, conditionRules,
    setConditionRules, validationRules, setValidationRules, advancedOpen, setAdvancedOpen,
    dataFieldsOpen, setDataFieldsOpen, datasetFields, aiSchemaOpen, aiSchemaPrompt, setAiSchemaPrompt,
    aiSchemaGenerating, aiSchemaError, aiSchemaPreview, aiSchemaSelectedIds, serverRegistry,
    statusMessage, fieldNodes, templateTitle, presetOptions, presetIssueCounts, templateStatus,
    setupSteps, publishReadinessItems, publishBlockedByDataset, publishBlockedByAiConfig,
    publishConfigurationIssues, nodeErrorMap, validationSummary, hasDataset, templateReady,
    resolvedAuditTaskId, sampleContext, dropActive, setDropActive, publishValidationResult,
    loadAuditTimeline, handleSaveDraft, exportSchemaJson, handleCopyVersionToDraft,
    handleRollbackToVersion, handlePublish, handleConfirmPublishPreview, focusIssueNode,
    handleDesignerCanvasClick, handleLoadPreset, handleCreateBlankPresetTemplate,
    openAiSchemaDraft, closeAiSchemaDraft, handleGenerateAiSchemaDraft, handleApplyAiSchemaDraft,
    handleAiSchemaSelectAll, handleAiSchemaSelectAnswerFields, handleAiSchemaClearSelection,
    toggleAiSchemaNode, presetTitleInput, presetDescriptionInput, handlePresetTitleChange,
    handlePresetDescriptionChange, handleSaveAsPreset, handleCanvasDragOver, handleCanvasDrop,
    addConditionRule, addValidationRule, handleAddShowItemField,
  } = useSchemaDraft(role);

  if (loading) {
    return <Card className="state-panel">加载模板组件中...</Card>;
  }

  if (!task) {
    const isLocalTask = taskId?.startsWith("task_local_") === true;
    return (
      <Card className="state-panel danger-text">
        {isLocalTask ? "本地临时任务不支持发布，请启动后端 API 后重新创建任务。" : `任务不存在：${taskId}`}
      </Card>
    );
  }

  return (
    <div className={`page-stack schema-workbench-page schema-builder-page${previewExpanded ? " schema-preview-expanded" : ""}`}>
      <Card className="schema-builder-toolbar">
        <div>
          <div className="schema-builder-breadcrumb">
            <Link to={RoutePath.OWNER_TASKS}>任务负责人后台</Link>
            <span>/</span>
            <span>模板搭建</span>
            <span>/</span>
            <strong>{task.title}</strong>
          </div>
          <h2>
            模板搭建
          </h2>
          <p>{task.title}</p>
          <p className="schema-builder-intro">
            配置字段结构、校验规则与联动逻辑。
          </p>
        </div>
        <div className="schema-builder-toolbar__actions owner-schema-actions-compact">
          <div className="owner-schema-actions-group owner-schema-actions-group--nav">
            <Link to={RoutePath.OWNER_TASKS} className="lh-button">
              返回任务
            </Link>
            {task.status === "DRAFT" ? (
              <Link to={`/owner/tasks/${task.id}?edit=basic`} className="lh-button">
                编辑基础信息
              </Link>
            ) : null}
            <Button type="button" onClick={() => setDataFieldsOpen(true)}>
              数据字段
            </Button>
          </div>
          <div className="owner-schema-actions-group owner-schema-actions-group--tools">
            <Button type="button" onClick={() => setPreviewExpanded(true)}>
              实时预览
            </Button>
            <Button type="button" onClick={openAiSchemaDraft}>
              AI 生成模板草稿 Beta
            </Button>
            <Button type="button" onClick={exportSchemaJson}>
              导出 JSON
            </Button>
          </div>
          <div className="owner-schema-actions-group owner-schema-actions-group--primary">
            <Button type="button" disabled={saving} onClick={() => void handleSaveDraft()}>
              {saving && !publishing ? "保存中..." : "保存草稿"}
            </Button>
            <Button type="button" tone="primary" disabled={saving || publishPreviewPreparing} onClick={() => void handlePublish()}>
              {publishing ? "发布中..." : publishPreviewPreparing ? "检查中..." : "保存并发布模板"}
            </Button>
          </div>
        </div>
      </Card>

      <SchemaDataFieldPanel
        open={dataFieldsOpen}
        fields={datasetFields}
        onAdd={handleAddShowItemField}
        onClose={() => setDataFieldsOpen(false)}
      />

      <SchemaGenerationDialog
        open={aiSchemaOpen}
        prompt={aiSchemaPrompt}
        generating={aiSchemaGenerating}
        error={aiSchemaError}
        preview={aiSchemaPreview}
        selectedIds={aiSchemaSelectedIds}
        onPromptChange={setAiSchemaPrompt}
        onClose={closeAiSchemaDraft}
        onGenerate={() => void handleGenerateAiSchemaDraft()}
        onApply={handleApplyAiSchemaDraft}
        onSelectAll={handleAiSchemaSelectAll}
        onSelectAnswerFields={handleAiSchemaSelectAnswerFields}
        onClearSelection={handleAiSchemaClearSelection}
        onToggleNode={toggleAiSchemaNode}
      />

      <div className="schema-builder-statusbar owner-schema-status">
        <div className="owner-schema-status-summary">
          <Badge tone={templateStatus.tone}>{templateStatus.label}</Badge>
          <Badge tone={boundVersionNo != null ? "success" : "default"}>
            {boundVersionNo != null
              ? `已发布 · 第 ${boundVersionNo} 版`
              : task.activeSchemaVersionId
                ? "已绑定版本"
                : "未发布"}
          </Badge>
          <Badge tone="primary">第 {schema.schemaDraftRevision ?? 1} 次修改</Badge>
        </div>
        <details className="owner-schema-status-details">
          <summary>状态详情</summary>
          <dl className="owner-schema-status-details__grid">
            <div>
              <dt>模板状态</dt>
              <dd>{templateStatus.label}</dd>
            </div>
            <div>
              <dt>草稿修订</dt>
              <dd>第 {schema.schemaDraftRevision ?? 1} 次修改</dd>
            </div>
            <div>
              <dt>任务绑定版本</dt>
              <dd>
                {boundVersionNo != null
                  ? `第 ${boundVersionNo} 版`
                  : task.activeSchemaVersionId
                    ? "已绑定已发布版本"
                    : "尚未发布"}
              </dd>
            </div>
            <div>
              <dt>所属任务</dt>
              <dd>{task.title || "当前任务"}</dd>
            </div>
            <div>
              <dt>可用字段组件</dt>
              <dd>{serverRegistry.length} 类</dd>
            </div>
            {statusMessage ? (
              <div>
                <dt>当前状态</dt>
                <dd>{statusMessage}</dd>
              </div>
            ) : null}
          </dl>
          <p className="owner-schema-status-hint">{templateStatus.hint}</p>
        </details>
      </div>

      <TaskSetupStepper steps={setupSteps} />

      {!hasDataset ? (
        <Card className="labeler-return-card owner-flow-warning-card">
          <Badge tone="warning">数据待导入</Badge>
          <p>当前任务还未导入数据，请先完成数据管理。</p>
          <div className="schema-builder-notice-actions">
            <Link to={`/owner/tasks/${resolvedAuditTaskId}/data`} className="lh-button lh-button--primary">
              去导入数据
            </Link>
          </div>
        </Card>
      ) : null}

      <PublishReadinessPanel items={publishReadinessItems} />

      {publishNotice ? (
        <div className="schema-builder-notice-slot" ref={publishIssueListRef}>
          <Card className={`labeler-return-card schema-builder-notice schema-builder-notice--${publishNoticeTone}`}>
            <Badge tone={noticeBadgeTone(publishNoticeTone)}>
              {publishNoticeTone === "danger" ? "操作失败" : publishNoticeTone === "success" ? "已更新" : publishNoticeTone === "warning" ? "待完成" : "提示"}
            </Badge>
            <p>{publishNotice}</p>
            {publishBlockedByDataset || publishBlockedByAiConfig ? (
              <div className="schema-builder-notice-actions">
                {publishBlockedByDataset ? (
                  <Link to={`/owner/tasks/${resolvedAuditTaskId}/data`} className="lh-button lh-button--primary">
                    去导入数据
                  </Link>
                ) : null}
                {publishBlockedByAiConfig ? (
                  <Link to={`/owner/tasks/${resolvedAuditTaskId}/ai-precheck`} className="lh-button">
                    去配置 AI 预审
                  </Link>
                ) : null}
              </div>
            ) : null}
            {(publishNoticeTone === "danger" || publishNoticeTone === "warning") && publishConfigurationIssues.length > 0 ? (
              <div className="schema-builder-publish-issues">
                <strong>请先修复以下问题：</strong>
                <ul>
                  {publishConfigurationIssues.map((issue) => (
                    <li key={issue.id}>
                      <button type="button" onClick={() => focusIssueNode(issue.nodeId)}>
                        <span>{issue.message}</span>
                        <small>{issue.suggestion}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(publishNoticeTone === "danger" || publishNoticeTone === "warning") && publishConfigurationIssues.length === 0 && publishFailureDetails.length > 0 ? (
              <div className="schema-builder-publish-issues">
                <strong>建议处理：</strong>
                <ul>
                  {publishFailureDetails.map((detail) => (
                    <li key={detail}><span>{detail}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      <SchemaPresetPanel
        presets={presetOptions}
        activePresetId={activePresetId}
        issueCounts={presetIssueCounts}
        schema={schema}
        fieldCount={fieldNodes.length}
        title={presetTitleInput}
        description={presetDescriptionInput}
        onCreateBlank={handleCreateBlankPresetTemplate}
        onLoad={handleLoadPreset}
        onSaveAsPreset={handleSaveAsPreset}
        onTitleChange={handlePresetTitleChange}
        onDescriptionChange={handlePresetDescriptionChange}
      />

      <SchemaRuleEditors
        schema={schema}
        fieldNodes={fieldNodes}
        conditionRules={conditionRules}
        validationRules={validationRules}
        advancedOpen={advancedOpen}
        templateReady={templateReady}
        taskId={resolvedAuditTaskId}
        validationSummary={validationSummary}
        setConditionRules={setConditionRules}
        setValidationRules={setValidationRules}
        onAddCondition={addConditionRule}
        onAddValidation={addValidationRule}
        onAdvancedOpenChange={setAdvancedOpen}
        onExpandPreview={() => setPreviewExpanded(true)}
      />

      <SchemaCanvas
        schema={schema}
        taskId={task.id}
        templateTitle={templateTitle}
        registry={serverRegistry}
        sampleContext={sampleContext}
        nodeErrors={nodeErrorMap}
        validationResult={publishValidationResult}
        previewExpanded={previewExpanded}
        dropActive={dropActive}
        onSchemaChange={setSchema}
        onClosePreview={() => setPreviewExpanded(false)}
        onCanvasClick={handleDesignerCanvasClick}
        onDragLeave={() => setDropActive(false)}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      />

      <SchemaVersionPanel
        taskId={resolvedAuditTaskId}
        activeSchemaVersionId={task?.activeSchemaVersionId}
        refreshKey={versionRefreshKey}
        onActiveVersionResolved={setBoundVersionNo}
        onCopyToDraft={handleCopyVersionToDraft}
        onRollback={(snapshot, version) => void handleRollbackToVersion(snapshot, version)}
      />

      <AuditTimelinePanel
        events={auditEvents}
        loading={auditLoading}
        error={auditError}
        onRefresh={() => void loadAuditTimeline()}
        title="模板治理审计"
        description="记录该任务的模板变更、发布前兼容性检查、Breaking Change 阻断、字段废弃与版本发布事件。"
        emptyText="暂无模板治理事件。保存草稿或发起发布检查后，这里会出现对应记录。"
      />

      {publishPreview ? (
        <PublishPreviewDialog
          affectedSubmissionsLabel={publishPreview.affectedSubmissionsLabel}
          compatibilityReport={publishPreview.compatibilityReport}
          deprecationErrors={publishPreview.deprecationErrors}
          deprecationWarnings={publishPreview.deprecationWarnings}
          isFirstPublish={publishPreview.isFirstPublish}
          manualMappingSlots={publishPreview.manualMappingSlots}
          oldSchemaStatusMessage={publishPreview.oldSchemaStatusMessage}
          open={publishPreviewOpen}
          publishAllowed={publishPreview.publishAllowed}
          requiresApproval={publishPreview.requiresApproval}
          requiresMigration={publishPreview.requiresMigration}
          schemaValidation={publishPreview.schemaValidation}
          onCancel={() => setPublishPreviewOpen(false)}
          onConfirm={handleConfirmPublishPreview}
        />
      ) : null}
    </div>
  );
}
