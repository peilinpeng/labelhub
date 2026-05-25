import type {
  AnswerPayload,
  FieldNode,
  LabelHubRuntimeContext,
  LabelHubSchema,
  LLMAssistNode,
  LLMRuntimeResponse,
  RendererMode,
  ReviewPatch,
  SchemaNode,
  ValidationError,
  ValidationResult,
} from "@labelhub/contracts";

export interface SchemaRendererProps {
  schema: LabelHubSchema;
  context: LabelHubRuntimeContext;
  answers: AnswerPayload;
  mode: RendererMode;
  onAnswersChange(nextAnswers: AnswerPayload): void;
  onSubmit?(answers: AnswerPayload, validation: ValidationResult): void | Promise<void>;
  onLLMAssist?(
    node: LLMAssistNode,
    context: LabelHubRuntimeContext,
    answers: AnswerPayload,
  ): LLMRuntimeResponse | Promise<LLMRuntimeResponse>;
  readonly?: boolean;
  errors?: ValidationError[];
  patchedAnswers?: AnswerPayload;
  patches?: ReviewPatch[];
  onUnsupportedNode?(node: unknown): void;
  className?: string;
}

export interface RenderNodeContext {
  schema: LabelHubSchema;
  context: LabelHubRuntimeContext;
  answers: AnswerPayload;
  patchedAnswers: AnswerPayload;
  mode: RendererMode;
  readonly: boolean;
  errorsByField: Map<string, ValidationError[]>;
  onFieldChange(field: FieldNode, value: unknown): void;
  onLLMAssist: SchemaRendererProps["onLLMAssist"];
  onApplySuggestedPatch(patch: AnswerPayload): void;
  onUnsupportedNode: ((node: unknown) => void) | undefined;
}

export interface NodeRendererProps {
  node: SchemaNode;
  renderContext: RenderNodeContext;
}
