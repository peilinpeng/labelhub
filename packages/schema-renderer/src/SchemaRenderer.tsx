import type { AnswerPayload, ReviewPatch, ValidationError } from "@labelhub/contracts";
import { normalizeAnswers, validateAnswers, validateSchemaShape } from "@labelhub/schema-core";
import { useMemo, useState } from "react";
import { renderNode } from "./render-node";
import type { RenderNodeContext, SchemaRendererProps } from "./types";

export function SchemaRenderer(props: SchemaRendererProps) {
  const { schema, answers, context, mode, onAnswersChange } = props;
  const [submitErrors, setSubmitErrors] = useState<ValidationError[]>([]);
  const contextWithAnswers = useMemo(() => ({ ...context, answers }), [context, answers]);
  const errorsByField = useMemo(
    () => groupErrorsByField([...(props.errors ?? []), ...submitErrors]),
    [props.errors, submitErrors],
  );
  const readonly = props.readonly === true || mode === "REVIEW_READONLY" || mode === "REVIEW_DIFF";
  const patchedAnswers = props.patchedAnswers ?? applyReviewPatches(answers, props.patches ?? context.review?.patches ?? []);
  const hasUnsupportedNodes = !validateSchemaShape(schema).valid;

  const renderContext: RenderNodeContext = {
    schema,
    context: contextWithAnswers,
    answers,
    patchedAnswers,
    mode,
    readonly,
    errorsByField,
    onFieldChange: (field, value) => {
      const nextAnswers = { ...answers, [field.name]: value };
      const normalized = normalizeAnswers(schema, nextAnswers, { ...contextWithAnswers, answers: nextAnswers });
      onAnswersChange(normalized.answers);
    },
    onLLMAssist: props.onLLMAssist,
    onAssistOutcome: props.onAssistOutcome,
    onApplySuggestedPatch: (patch) => {
      onAnswersChange(patch);
    },
    onUnsupportedNode: props.onUnsupportedNode,
  };

  return (
    <form
      className={props.className}
      data-renderer-mode={mode}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(schema, answers, contextWithAnswers, props.onSubmit, setSubmitErrors);
      }}
    >
      {renderNode(schema.root, renderContext)}
      {mode === "LABELING" && props.onSubmit !== undefined ? (
        <button disabled={hasUnsupportedNodes} type="submit">
          提交
        </button>
      ) : null}
    </form>
  );
}

async function submit(
  schema: SchemaRendererProps["schema"],
  answers: AnswerPayload,
  context: SchemaRendererProps["context"],
  onSubmit: SchemaRendererProps["onSubmit"],
  setSubmitErrors: (errors: ValidationError[]) => void,
): Promise<void> {
  if (onSubmit === undefined) {
    return;
  }

  const normalized = normalizeAnswers(schema, answers, context);
  const validation = validateAnswers(schema, normalized.answers, { ...context, answers: normalized.answers });
  setSubmitErrors([...normalized.errors, ...validation.errors]);

  if (normalized.errors.length === 0 && validation.valid) {
    await onSubmit(normalized.answers, validation);
  }
}

function groupErrorsByField(errors: ValidationError[]): Map<string, ValidationError[]> {
  const result = new Map<string, ValidationError[]>();

  for (const error of errors) {
    if (error.fieldName === undefined) {
      continue;
    }
    const existing = result.get(error.fieldName) ?? [];
    result.set(error.fieldName, [...existing, error]);
  }

  return result;
}

function applyReviewPatches(answers: AnswerPayload, patches: ReviewPatch[]): AnswerPayload {
  return patches.reduce<AnswerPayload>((result, patch) => {
    return {
      ...result,
      [patch.fieldName]: patch.nextValue,
    };
  }, answers);
}
