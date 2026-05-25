import type { LabelHubSchema, SchemaValidationResult } from "@labelhub/contracts";
import { findNodeById } from "@labelhub/schema-core";
import { useEffect, useMemo, useState } from "react";
import { DesignerLayout } from "./components/DesignerLayout";
import { DesignerCanvas } from "./components/DesignerCanvas";
import { EmptyPropertyPanel, PropertyPanel } from "./components/PropertyPanel";
import { MaterialPanel } from "./components/MaterialPanel";
import { SchemaPreview } from "./components/SchemaPreview";
import { ValidationPanel } from "./components/ValidationPanel";
import { addMaterialNode, deleteSelectedNode, moveSelectedNode, patchNode } from "./designer-actions";
import { createDesignerState, syncDesignerState, validateDesignerSchema } from "./designer-state";
import type { DesignerActionContext, DesignerState, SchemaDesignerProps } from "./types";

export function SchemaDesigner(props: SchemaDesignerProps) {
  const readonly = props.readonly === true;
  const [state, setState] = useState<DesignerState>(() => createDesignerState(props.schema));

  useEffect(() => {
    setState((current) => syncDesignerState(props.schema, current));
  }, [props.schema]);

  const selectedNode = useMemo(() => {
    if (state.selectedNodeId === undefined) {
      return undefined;
    }
    return findNodeById(props.schema, state.selectedNodeId);
  }, [props.schema, state.selectedNodeId]);

  const emitSchemaChange = (nextSchema: LabelHubSchema) => {
    const validationResult = validateDesignerSchema(nextSchema);
    setState((current) => ({ ...syncDesignerState(nextSchema, current), validationResult }));
    props.onSchemaChange(nextSchema);
    void runExternalValidate(nextSchema, props.onValidate, (result) => {
      setState((current) => ({ ...current, validationResult: result }));
    });
  };

  const actionContext: DesignerActionContext = {
    schema: props.schema,
    readonly,
    selectedNodeId: state.selectedNodeId,
    onSchemaChange: emitSchemaChange,
    onSelectNode: (nodeId) => setState((current) => ({ ...current, selectedNodeId: nodeId })),
    setLocalErrors: (localErrors) => setState((current) => ({ ...current, localErrors })),
  };

  return (
    <>
      {props.onPublishRequest !== undefined ? (
        <button disabled={readonly || !state.validationResult.valid} type="button" onClick={() => void props.onPublishRequest?.(props.schema)}>
          请求发布
        </button>
      ) : null}
      <DesignerLayout
      canvas={
        <DesignerCanvas
          nodes={props.schema.root.children}
          readonly={readonly}
          selectedNodeId={state.selectedNodeId}
          onDelete={(nodeId) => deleteSelectedNode(actionContext, nodeId)}
          onMoveDown={(nodeId) => moveSelectedNode(actionContext, nodeId, "DOWN")}
          onMoveUp={(nodeId) => moveSelectedNode(actionContext, nodeId, "UP")}
          onSelect={(nodeId) => setState((current) => ({ ...current, selectedNodeId: nodeId }))}
        />
      }
      materials={
        <MaterialPanel
          readonly={readonly}
          serverRegistry={props.serverRegistry}
          onAdd={(type) => addMaterialNode(actionContext, type)}
        />
      }
      preview={
        <SchemaPreview
          previewAnswers={state.previewAnswers}
          sampleContext={props.sampleContext}
          schema={props.schema}
          validationResult={state.validationResult}
          onPreviewAnswersChange={(previewAnswers) => setState((current) => ({ ...current, previewAnswers }))}
        />
      }
      properties={
        selectedNode === undefined ? (
          <EmptyPropertyPanel />
        ) : (
          <PropertyPanel
            localErrors={state.localErrors}
            node={selectedNode}
            readonly={readonly}
            schema={props.schema}
            onLocalErrors={(localErrors) => setState((current) => ({ ...current, localErrors }))}
            onNodePatch={(nodeId, patch) => patchNode(actionContext, nodeId, patch)}
          />
        )
      }
      validation={<ValidationPanel localErrors={state.localErrors} validationResult={state.validationResult} />}
      />
    </>
  );
}

async function runExternalValidate(
  schema: LabelHubSchema,
  onValidate: SchemaDesignerProps["onValidate"],
  onResult: (result: SchemaValidationResult) => void,
): Promise<void> {
  if (onValidate === undefined) {
    return;
  }
  const result = await onValidate(schema);
  onResult(result);
}
