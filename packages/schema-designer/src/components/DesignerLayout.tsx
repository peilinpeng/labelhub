import type { ReactNode } from "react";

export interface DesignerLayoutProps {
  materials: ReactNode;
  canvas: ReactNode;
  properties: ReactNode;
  validation: ReactNode;
  preview: ReactNode;
}

export function DesignerLayout({ materials, canvas, properties, validation, preview }: DesignerLayoutProps) {
  return (
    <div className="schema-designer-layout">
      <aside className="schema-designer-layout__materials">{materials}</aside>
      <main className="schema-designer-layout__canvas">
        {canvas}
        {validation}
      </main>
      <aside className="schema-designer-layout__inspector">
        {properties}
        {preview}
      </aside>
    </div>
  );
}
