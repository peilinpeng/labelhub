import type { Expression, FieldLinkageEffect, LabelHubSchema } from "@labelhub/contracts";
import { collectFieldNodes } from "@labelhub/schema-core";
import { collectExpressionFieldNames } from "./dependency-graph.ts";
import { collectLinkageRules } from "./linkage-rules.ts";

export interface CompiledReaction {
  ruleId: string;
  source: "visibleWhen" | "disabledWhen" | "linkageRule";
  /** 监听哪些字段变化时触发本条 reaction（来自 when 表达式） */
  triggerFieldNames: string[];
  when: Expression;
  /** when 为 true 时执行 */
  effects: FieldLinkageEffect[];
  /** when 为 false 时执行 */
  otherwise: FieldLinkageEffect[];
}

export interface ReactionPlan {
  reactions: CompiledReaction[];
}

export class FormilyReactionVisitor {
  visit(schema: LabelHubSchema): ReactionPlan {
    return buildReactionPlan(schema);
  }
}

export function buildReactionPlan(schema: LabelHubSchema): ReactionPlan {
  const reactions: CompiledReaction[] = [];
  const fields = collectFieldNodes(schema);

  for (const field of fields) {
    if (field.visibleWhen !== undefined) {
      reactions.push({
        ruleId: `visibleWhen:${field.id}`,
        source: "visibleWhen",
        triggerFieldNames: collectExpressionFieldNames(field.visibleWhen),
        when: field.visibleWhen,
        effects: [{ action: "setVisible", target: field.name, value: true }],
        otherwise: [{ action: "setVisible", target: field.name, value: false }],
      });
    }

    if (field.disabledWhen !== undefined) {
      reactions.push({
        ruleId: `disabledWhen:${field.id}`,
        source: "disabledWhen",
        triggerFieldNames: collectExpressionFieldNames(field.disabledWhen),
        when: field.disabledWhen,
        effects: [{ action: "setDisabled", target: field.name, value: true }],
        otherwise: [{ action: "setDisabled", target: field.name, value: false }],
      });
    }
  }

  for (const binding of collectLinkageRules(schema)) {
    reactions.push({
      ruleId: binding.rule.id,
      source: "linkageRule",
      triggerFieldNames: collectExpressionFieldNames(binding.rule.when),
      when: binding.rule.when,
      effects: binding.rule.effects,
      otherwise: binding.rule.otherwise ?? [],
    });
  }

  return { reactions };
}
