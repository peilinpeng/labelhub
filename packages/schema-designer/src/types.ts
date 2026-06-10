import type {
  LabelHubRuntimeContext,
  LabelHubSchema,
  NodeType,
  SchemaNode,
  SchemaValidationError,
  SchemaValidationResult,
  ServerComponentRegistryItem,
} from "@labelhub/contracts";

export interface SchemaDesignerProps {
  schema: LabelHubSchema;
  onSchemaChange(nextSchema: LabelHubSchema): void;
  readonly?: boolean;
  serverRegistry: ServerComponentRegistryItem[];
  sampleContext: LabelHubRuntimeContext;
  nodeErrors?: Record<string, string[]>;
  validationResult?: SchemaValidationResult;
  onValidate?(schema: LabelHubSchema): SchemaValidationResult | Promise<SchemaValidationResult>;
  onPublishRequest?(schema: LabelHubSchema): void | Promise<void>;
}

export interface DesignerState {
  selectedNodeId?: string | undefined;
  validationResult: SchemaValidationResult;
  localErrors: SchemaValidationError[];
  previewAnswers: Record<string, unknown>;
  activePanel?: "MATERIALS" | "PROPERTIES" | "PREVIEW" | undefined;
}

export interface MaterialItem {
  type: NodeType;
  label: string;
  description: string;
}

export interface DesignerActionContext {
  schema: LabelHubSchema;
  readonly: boolean;
  selectedNodeId?: string | undefined;
  onSchemaChange(nextSchema: LabelHubSchema): void;
  onSelectNode(nodeId: string | undefined): void;
  setLocalErrors(errors: SchemaValidationError[]): void;
}

export interface PropertyPanelProps {
  schema: LabelHubSchema;
  node: SchemaNode;
  readonly: boolean;
  localErrors: SchemaValidationError[];
  onNodePatch(nodeId: string, patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: SchemaValidationError[]): void;
}
