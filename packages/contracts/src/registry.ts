import type {
  AnswerFieldType,
  JsonSchemaLike,
  NodeType,
  ValidationRuleType,
} from "./schema";

export interface ServerComponentRegistryItem {
  type: NodeType;
  category: "INPUT" | "CHOICE" | "UPLOAD" | "DATA" | "SHOW" | "AI" | "LAYOUT";
  valueKind: "NONE" | "STRING" | "STRING_ARRAY" | "FILE_ARRAY" | "JSON" | "RICH_TEXT";
  normalizer: string;
  validators: string[];
  exportValueType: "TEXT" | "NUMBER" | "BOOLEAN" | "JSON" | "FILE_URLS";
  allowedValidationRules: ValidationRuleType[];
  defaultSubmitEnabled: boolean;
  defaultExportEnabled: boolean;
  defaultAiReviewEnabled: boolean;
}

export interface FrontendComponentRegistryItem {
  type: NodeType;
  icon: string;
  defaultNodeFactory: string;
  propertyPanels: Array<"BASIC" | "OPTIONS" | "VALIDATION" | "LINKAGE" | "LLM" | "LAYOUT">;
  designerComponentKey: string;
  rendererComponentKey: string;
  readonlyRendererComponentKey: string;
  diffRendererComponentKey?: string;
  supportsReadonly: boolean;
  supportsReviewDiff: boolean;
  canHaveChildren: boolean;
}

export interface CustomValidationRuleRegistryItem {
  ruleId: string;
  label: string;
  description?: string;
  applicableNodeTypes: AnswerFieldType[];
  paramsSchema?: JsonSchemaLike;
  frontendHintRunnerKey?: string;
  backendValidatorKey: string;
  enabled: boolean;
}
