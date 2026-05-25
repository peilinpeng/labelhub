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
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "220px minmax(320px, 1fr) 320px" }}>
      <aside>{materials}</aside>
      <main>
        {canvas}
        {validation}
      </main>
      <aside>
        {properties}
        {preview}
      </aside>
    </div>
  );
}
