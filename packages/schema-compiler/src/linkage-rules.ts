import type { FieldLinkageRule, FieldNode, LabelHubSchema } from "@labelhub/contracts";
import { collectFieldNodes } from "@labelhub/schema-core";

export interface CompilerField {
  nodeId: string;
  fieldName: string;
  field: FieldNode;
}

export interface FieldLinkageRuleBinding {
  ownerNodeId: string;
  ownerFieldName: string;
  rule: FieldLinkageRule;
}

export interface SchemaCompilerInput {
  schema: LabelHubSchema;
  fields: CompilerField[];
  linkageRules: FieldLinkageRuleBinding[];
}

export function parseSchemaToCompilerInput(schema: LabelHubSchema): SchemaCompilerInput {
  const fields = collectFieldNodes(schema).map((field) => ({
    nodeId: field.id,
    fieldName: field.name,
    field,
  }));

  return {
    schema,
    fields,
    linkageRules: collectLinkageRulesFromFields(fields),
  };
}

export function collectLinkageRules(schema: LabelHubSchema): FieldLinkageRuleBinding[] {
  return collectLinkageRulesFromFields(parseSchemaToCompilerInput(schema).fields);
}

function collectLinkageRulesFromFields(fields: CompilerField[]): FieldLinkageRuleBinding[] {
  const bindings: FieldLinkageRuleBinding[] = [];

  for (const field of fields) {
    for (const rule of field.field.linkageRules ?? []) {
      bindings.push({
        ownerNodeId: field.nodeId,
        ownerFieldName: field.fieldName,
        rule,
      });
    }
  }

  return bindings;
}
