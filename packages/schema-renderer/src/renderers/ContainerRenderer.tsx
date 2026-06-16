import type { ContainerNode } from "@labelhub/contracts";
import { useState } from "react";
import { resolveNodeVisibility } from "@labelhub/schema-core";
import { renderNode } from "../render-node";
import type { RenderNodeContext } from "../types";

export interface ContainerRendererProps {
  node: ContainerNode;
  renderContext: RenderNodeContext;
}

export function ContainerRenderer({ node, renderContext }: ContainerRendererProps) {
  if (node.type === "container.tabs") {
    return <TabsContainer node={node} renderContext={renderContext} />;
  }
  return <StackContainer node={node} renderContext={renderContext} />;
}

function StackContainer({ node, renderContext }: ContainerRendererProps) {
  return (
    <section data-node-id={node.id} data-container-type={node.type}>
      <h2>{node.title}</h2>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <div data-columns={node.layout?.columns ?? undefined}>
        {node.children.map((child) => (
          <div key={child.id}>{renderNode(child, renderContext)}</div>
        ))}
      </div>
    </section>
  );
}

function TabsContainer({ node, renderContext }: ContainerRendererProps) {
  // 每个可见子节点 = 一个 Tab，其 title 作 Tab 头。被 visibleWhen 联动隐藏的子节点不产生 Tab。
  const visibleChildren = node.children.filter((child) =>
    resolveNodeVisibility(child, renderContext.context),
  );
  const [activeId, setActiveId] = useState<string | undefined>(visibleChildren[0]?.id);
  // 容错：当前激活 Tab 被联动隐藏时回退到第一个可见 Tab。
  const activeChild = visibleChildren.find((child) => child.id === activeId) ?? visibleChildren[0];

  return (
    <section data-node-id={node.id} data-container-type={node.type}>
      <h2>{node.title}</h2>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      {activeChild === undefined ? null : (
        <>
          <div role="tablist" data-tab-style={node.layout?.tabStyle ?? "LINE"}>
            {visibleChildren.map((child) => {
              const selected = child.id === activeChild.id;
              return (
                <button
                  key={child.id}
                  type="button"
                  role="tab"
                  id={`tab-${child.id}`}
                  aria-selected={selected}
                  aria-controls={`tabpanel-${child.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveId(child.id)}
                >
                  {child.title}
                </button>
              );
            })}
          </div>
          {visibleChildren.map((child) => (
            <div
              key={child.id}
              role="tabpanel"
              id={`tabpanel-${child.id}`}
              aria-labelledby={`tab-${child.id}`}
              hidden={child.id !== activeChild.id}
            >
              {renderNode(child, renderContext)}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
