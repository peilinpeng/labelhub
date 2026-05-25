import type { ChoiceFieldNode, SchemaNode } from "@labelhub/contracts";
import type { PropertyPanelProps } from "../types";
import { BaseNodePanel } from "../property-panels/BaseNodePanel";
import { ChoicePropertyPanel } from "../property-panels/ChoicePropertyPanel";
import { ContainerPropertyPanel } from "../property-panels/ContainerPropertyPanel";
import { FieldPropertyPanel } from "../property-panels/FieldPropertyPanel";
import { LLMAssistPropertyPanel } from "../property-panels/LLMAssistPropertyPanel";
import { ShowItemPropertyPanel } from "../property-panels/ShowItemPropertyPanel";

export function PropertyPanel({ schema, node, readonly, localErrors, onNodePatch, onLocalErrors }: PropertyPanelProps) {
  const onPatch = (patch: Partial<SchemaNode>) => onNodePatch(node.id, patch);

  return (
    <section aria-label="属性面板">
      <h2>属性面板</h2>
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
        <ul>
          {localErrors.map((error, index) => (
            <li key={`${error.path}-${index}`} role="alert">
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div>当前 schema：{schema.meta.name}</div>
    </section>
  );
}

export function EmptyPropertyPanel() {
  return (
    <section aria-label="属性面板">
      <h2>属性面板</h2>
      <p>请选择一个节点。</p>
    </section>
  );
}

function isChoiceFieldNode(node: SchemaNode): node is ChoiceFieldNode {
  return node.kind === "FIELD" && node.type.startsWith("choice.");
}
