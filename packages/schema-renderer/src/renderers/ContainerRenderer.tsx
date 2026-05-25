import type { ContainerNode } from "@labelhub/contracts";
import { renderNode } from "../render-node";
import type { RenderNodeContext } from "../types";

export interface ContainerRendererProps {
  node: ContainerNode;
  renderContext: RenderNodeContext;
}

export function ContainerRenderer({ node, renderContext }: ContainerRendererProps) {
  return (
    <section data-node-id={node.id}>
      <h2>{node.title}</h2>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <div>
        {node.children.map((child) => (
          <div key={child.id}>{renderNode(child, renderContext)}</div>
        ))}
      </div>
    </section>
  );
}
