import { createForm } from "@formily/core";
import { FormProvider } from "@formily/react";
import { useMemo } from "react";
import type { ComponentRegistry } from "./ComponentRegistry";
import type { SchemaRendererProps } from "./types";

export interface FormilyRuntimeRendererProps extends SchemaRendererProps {
  /** FE-2 傳入包裝後的 adapter 集合；FE-1 階段可不傳 */
  registry?: ComponentRegistry;
}

export function FormilyRuntimeRenderer({
  schema,
  answers,
  mode,
  registry: _registry,
}: FormilyRuntimeRendererProps) {
  const form = useMemo(
    () => createForm({ initialValues: answers }),
    [schema.schemaId],
  );

  return (
    <FormProvider form={form}>
      <div data-renderer-engine="formily-v2" data-renderer-mode={mode}>
        {/* FE-2：掛載 SchemaField + adapter，此處為 Phase 1 佔位 */}
      </div>
    </FormProvider>
  );
}
