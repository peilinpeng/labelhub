import type { ChoiceFieldNode, SchemaNode } from "@labelhub/contracts";
import type { PropertyPanelProps } from "../types";
import { BaseNodePanel } from "../property-panels/BaseNodePanel";
import { ChoicePropertyPanel } from "../property-panels/ChoicePropertyPanel";
import { ContainerPropertyPanel } from "../property-panels/ContainerPropertyPanel";
import { FieldPropertyPanel } from "../property-panels/FieldPropertyPanel";
import { LLMAssistPropertyPanel } from "../property-panels/LLMAssistPropertyPanel";
import { ShowItemPropertyPanel } from "../property-panels/ShowItemPropertyPanel";

export function PropertyPanel({ node, readonly, localErrors, onNodePatch, onLocalErrors }: PropertyPanelProps) {
  const onPatch = (patch: Partial<SchemaNode>) => onNodePatch(node.id, patch);

  return (
    <section aria-label="属性面板" className="schema-designer-panel schema-designer-properties">
      <div className="schema-designer-panel__header">
        <div>
          <h2>属性</h2>
          <p>{node.title}</p>
        </div>
        <span>{nodeKindLabel(node)}</span>
      </div>
      <BaseNodePanel node={node} readonly={readonly} onLocalErrors={onLocalErrors} onPatch={onPatch} />
      {node.kind === "FIELD" ? (
        <>
          <FieldPropertyPanel node={node} readonly={readonly} onLocalErrors={onLocalErrors} onPatch={onPatch} />
          {isChoiceFieldNode(node) ? (
            <ChoicePropertyPanel node={node} readonly={readonly} onLocalErrors={onLocalErrors} onPatch={onPatch} />
          ) : null}
        </>
      ) : null}
      {node.kind === "SHOW_ITEM" ? (
        <ShowItemPropertyPanel node={node} readonly={readonly} onLocalErrors={onLocalErrors} onPatch={onPatch} />
      ) : null}
      {node.kind === "LLM_ASSIST" ? (
        <LLMAssistPropertyPanel node={node} readonly={readonly} onLocalErrors={onLocalErrors} onPatch={onPatch} />
      ) : null}
      {node.kind === "CONTAINER" ? (
        <ContainerPropertyPanel node={node} readonly={readonly} onLocalErrors={onLocalErrors} onPatch={onPatch} />
      ) : null}
      {localErrors.length > 0 ? (
        <ul className="schema-designer-error-list">
          {localErrors.map((error, index) => (
            <li key={`${error.path}-${index}`} role="alert">
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function EmptyPropertyPanel() {
  return (
    <section aria-label="属性面板" className="schema-designer-panel schema-designer-properties">
      <div className="schema-designer-panel__header">
        <div>
          <h2>属性</h2>
          <p>请选择一个组件后编辑</p>
        </div>
      </div>
      <p className="schema-designer-empty">请选择一个节点。</p>
    </section>
  );
}

function isChoiceFieldNode(node: SchemaNode): node is ChoiceFieldNode {
  return node.kind === "FIELD" && node.type.startsWith("choice.");
}

function nodeKindLabel(node: SchemaNode): string {
  if (node.kind === "FIELD") return "字段";
  if (node.kind === "SHOW_ITEM") return "展示";
  if (node.kind === "LLM_ASSIST") return "AI";
  return "分组";
}
