export type CompatibilityLevel =
  | "SAFE"
  | "NEEDS_APPROVAL"
  | "BREAKING"
  | "MIGRATION_REQUIRED";

export type SchemaChange = {
  code: string;
  level: CompatibilityLevel;
  fieldName?: string;
  nodeId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  message: string;
  recommendation?: string;
};

export type CompatibilityReport = {
  compatible: boolean;
  publishAllowed: boolean;
  requiresApproval: boolean;
  requiresMigration: boolean;
  changes: SchemaChange[];
  blockingChanges: SchemaChange[];
  warnings: SchemaChange[];
  recommendations: string[];
};
