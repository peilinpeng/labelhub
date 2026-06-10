import type {
  Expression,
  ExprValue,
  FieldLinkageEffect,
  FieldLinkageEffectAction,
  FieldNode,
  LabelHubSchema,
} from "@labelhub/contracts";
import { collectFieldNodes } from "@labelhub/schema-core";
import { collectLinkageRules } from "./linkage-rules.ts";

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
}

export interface DependencyGraphNode {
  fieldName: string;
  nodeId: string;
  fieldType: FieldNode["type"];
  title: string;
}

export type DependencyGraphEdgeSource =
  | "visibleWhen"
  | "disabledWhen"
  | "linkageRule";

export interface DependencyGraphEdge {
  fromFieldName: string;
  toFieldName: string;
  ruleId: string;
  source: DependencyGraphEdgeSource;
  effectActions: FieldLinkageEffectAction[];
}

export class DependencyGraphVisitor {
  visit(schema: LabelHubSchema): DependencyGraph {
    return buildDependencyGraph(schema);
  }
}

export function buildDependencyGraph(schema: LabelHubSchema): DependencyGraph {
  const fields = collectFieldNodes(schema);
  const nodes = fields.map(toDependencyGraphNode);
  const edges: DependencyGraphEdge[] = [];

  for (const field of fields) {
    if (field.visibleWhen !== undefined) {
      edges.push(...createExpressionEdges({
        expression: field.visibleWhen,
        toFieldName: field.name,
        ruleId: `visibleWhen:${field.id}`,
        source: "visibleWhen",
        effectActions: ["setVisible"],
      }));
    }

    if (field.disabledWhen !== undefined) {
      edges.push(...createExpressionEdges({
        expression: field.disabledWhen,
        toFieldName: field.name,
        ruleId: `disabledWhen:${field.id}`,
        source: "disabledWhen",
        effectActions: ["setDisabled"],
      }));
    }
  }

  for (const binding of collectLinkageRules(schema)) {
    const readFieldNames = collectExpressionFieldNames(binding.rule.when);
    const targetActions = collectTargetActions([
      ...binding.rule.effects,
      ...(binding.rule.otherwise ?? []),
    ]);

    for (const fromFieldName of readFieldNames) {
      for (const [toFieldName, effectActions] of targetActions) {
        edges.push({
          fromFieldName,
          toFieldName,
          ruleId: binding.rule.id,
          source: "linkageRule",
          effectActions,
        });
      }
    }
  }

  return {
    nodes,
    edges,
  };
}

export function collectExpressionFieldNames(expression: Expression): string[] {
  const names = new Set<string>();
  collectExpressionFieldNamesInto(expression, names);
  return [...names].sort();
}

function toDependencyGraphNode(field: FieldNode): DependencyGraphNode {
  return {
    fieldName: field.name,
    nodeId: field.id,
    fieldType: field.type,
    title: field.title,
  };
}

function createExpressionEdges(input: {
  expression: Expression;
  toFieldName: string;
  ruleId: string;
  source: DependencyGraphEdgeSource;
  effectActions: FieldLinkageEffectAction[];
}): DependencyGraphEdge[] {
  return collectExpressionFieldNames(input.expression).map((fromFieldName) => ({
    fromFieldName,
    toFieldName: input.toFieldName,
    ruleId: input.ruleId,
    source: input.source,
    effectActions: input.effectActions,
  }));
}

function collectTargetActions(effects: FieldLinkageEffect[]): Map<string, FieldLinkageEffectAction[]> {
  const result = new Map<string, Set<FieldLinkageEffectAction>>();

  for (const effect of effects) {
    const actions = result.get(effect.target) ?? new Set<FieldLinkageEffectAction>();
    actions.add(effect.action);
    result.set(effect.target, actions);
  }

  return new Map([...result.entries()].map(([target, actions]) => [target, [...actions]]));
}

function collectExpressionFieldNamesInto(expression: Expression, names: Set<string>): void {
  switch (expression.op) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      collectExprValueFieldName(expression.left, names);
      collectExprValueFieldName(expression.right, names);
      return;
    case "in":
    case "notIn":
      collectExprValueFieldName(expression.left, names);
      for (const item of expression.right) {
        collectExprValueFieldName(item, names);
      }
      return;
    case "empty":
    case "notEmpty":
      collectExprValueFieldName(expression.value, names);
      return;
    case "and":
    case "or":
      for (const item of expression.items) {
        collectExpressionFieldNamesInto(item, names);
      }
      return;
    case "not":
      collectExpressionFieldNamesInto(expression.item, names);
      return;
  }
}

function collectExprValueFieldName(value: ExprValue, names: Set<string>): void {
  if (value.kind !== "path") {
    return;
  }

  const fieldName = readAnswerFieldName(value.path);
  if (fieldName !== undefined) {
    names.add(fieldName);
  }
}

function readAnswerFieldName(path: string): string | undefined {
  const prefix = "$.answers.";
  if (!path.startsWith(prefix)) {
    return undefined;
  }

  const rest = path.slice(prefix.length);
  const match = /^[A-Za-z0-9_$-]+/.exec(rest);
  return match?.[0];
}
