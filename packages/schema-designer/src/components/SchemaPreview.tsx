import type { AnswerPayload, LabelHubRuntimeContext, LabelHubSchema, SchemaValidationResult } from "@labelhub/contracts";
import { SchemaRenderer } from "@labelhub/schema-renderer";

export interface SchemaPreviewProps {
  schema: LabelHubSchema;
  sampleContext: LabelHubRuntimeContext;
  validationResult: SchemaValidationResult;
  previewAnswers: AnswerPayload;
  onPreviewAnswersChange(answers: AnswerPayload): void;
}

export function SchemaPreview({
  schema,
  sampleContext,
  validationResult,
  previewAnswers,
  onPreviewAnswersChange,
}: SchemaPreviewProps) {
  const previewBlocked = validationResult.errors.some((error) =>
    error.code === "INVALID_JSON_PATH" || error.code === "UNKNOWN_NODE_TYPE" || error.code === "SCHEMA_INVALID",
  );

  return (
    <section aria-label="Schema 预览">
      <h2>实时预览</h2>
      {schema.root.children.length === 0 ? <p>暂无节点可预览</p> : null}
      {!validationResult.valid ? <p>当前 schema 存在 validation error，预览仅供参考。</p> : null}
      {previewBlocked ? <p>当前 schema 暂不可预览，请先修复关键错误。</p> : null}
      {schema.root.children.length > 0 && !previewBlocked ? (
        <SchemaRenderer
          answers={previewAnswers}
          context={{ ...sampleContext, answers: previewAnswers }}
          mode="PREVIEW"
          schema={schema}
          onAnswersChange={onPreviewAnswersChange}
        />
      ) : null}
    </section>
  );
}
