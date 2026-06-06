import { LifeCycleTypes, createForm } from "@formily/core";
import { Field, FormProvider } from "@formily/react";
import { useEffect, useMemo, useRef } from "react";
import type {
  AnswerPayload,
  ChoiceFieldNode,
  ContainerNode,
  FieldNode,
  SchemaNode,
} from "@labelhub/contracts";
import { resolveNodeDisabled, resolveNodeVisibility } from "@labelhub/schema-core";
import type { ComponentRegistry } from "./ComponentRegistry";
import { COMPONENT_NAMES } from "./ComponentRegistry";
import type { SchemaRendererProps } from "./types";

export interface FormilyRuntimeRendererProps extends SchemaRendererProps {
  /** FE-2 傳入包裝後的 adapter 集合；registry 為空時 field 不渲染 */
  registry?: ComponentRegistry;
}

export function FormilyRuntimeRenderer({
  schema,
  answers,
  context,
  mode,
  onAnswersChange,
  registry,
}: FormilyRuntimeRendererProps) {
  const isReadonly = mode === "REVIEW_READONLY" || mode === "REVIEW_DIFF";

  const contextWithAnswers = useMemo(
    () => ({ ...context, answers }),
    [context, answers],
  );

  const form = useMemo(
    () => createForm({ initialValues: answers }),
    // 僅在 schema 換版本時重建；answers 同步由 subscribe 負責
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema.schemaId],
  );

  // 穩定化 onAnswersChange 引用，避免 subscribe 因函數 identity 頻繁重建
  const onAnswersChangeRef = useRef(onAnswersChange);
  onAnswersChangeRef.current = onAnswersChange;

  useEffect(() => {
    const id = form.subscribe(({ type }) => {
      if (type === LifeCycleTypes.ON_FORM_VALUES_CHANGE) {
        onAnswersChangeRef.current(form.values as AnswerPayload);
      }
    });
    return () => {
      form.unsubscribe(id);
    };
  }, [form]);

  const entries = registry?.entries ?? {};

  function renderSchemaNode(node: SchemaNode): React.ReactNode {
    if (!resolveNodeVisibility(node, contextWithAnswers)) return null;

    if (node.kind === "FIELD") {
      return renderFieldNode(node);
    }

    if (node.kind === "CONTAINER") {
      return renderContainerNode(node);
    }

    return null;
  }

  function renderFieldNode(node: FieldNode): React.ReactNode {
    const componentName = getComponentName(node);
    if (componentName === undefined) return null;

    const AdapterComponent = entries[componentName];
    if (AdapterComponent === undefined) return null;

    const disabled = resolveNodeDisabled(node, contextWithAnswers);

    return (
      <Field
        key={node.id}
        name={node.name}
        component={[AdapterComponent, buildComponentProps(node, isReadonly, disabled)]}
      />
    );
  }

  function renderContainerNode(node: ContainerNode): React.ReactNode {
    return (
      <div key={node.id} data-container-type={node.type}>
        {node.children.map((child) => renderSchemaNode(child))}
      </div>
    );
  }

  return (
    <FormProvider form={form}>
      <div data-renderer-engine="formily-v2" data-renderer-mode={mode}>
        {renderSchemaNode(schema.root)}
      </div>
    </FormProvider>
  );
}

function getComponentName(node: FieldNode): string | undefined {
  switch (node.type) {
    case "input.text":
      return COMPONENT_NAMES.TEXT;
    case "input.textarea":
      return COMPONENT_NAMES.TEXTAREA;
    case "input.richtext":
      return COMPONENT_NAMES.TEXTAREA;
    case "choice.radio":
      return COMPONENT_NAMES.RADIO;
    case "choice.checkbox":
      return COMPONENT_NAMES.CHECKBOX;
    case "choice.select":
      return COMPONENT_NAMES.SELECT;
    case "choice.tags":
      return COMPONENT_NAMES.TAGS;
    case "data.json":
      return COMPONENT_NAMES.JSON_EDITOR;
    default:
      return undefined;
  }
}

function buildComponentProps(
  node: FieldNode,
  readOnly: boolean,
  disabled: boolean,
): Record<string, unknown> {
  const base = { readOnly, disabled };
  switch (node.type) {
    case "input.text":
      return { ...base, placeholder: node.placeholder };
    case "input.textarea":
      return { ...base, placeholder: node.placeholder, minRows: node.minRows, maxRows: node.maxRows };
    case "input.richtext":
      return { ...base, placeholder: node.placeholder };
    case "choice.radio":
    case "choice.checkbox":
    case "choice.select":
    case "choice.tags":
      return { ...base, field: node as ChoiceFieldNode };
    case "data.json":
      return { ...base };
    default:
      return { ...base };
  }
}
