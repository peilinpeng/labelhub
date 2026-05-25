import type { ChoiceFieldNode, FieldNode } from "@labelhub/contracts";
import { resolveNodeDisabled } from "@labelhub/schema-core";
import { CheckboxInput } from "../components/CheckboxInput";
import { FileInput } from "../components/FileInput";
import { JsonEditorInput } from "../components/JsonEditorInput";
import { RadioInput } from "../components/RadioInput";
import { SelectInput } from "../components/SelectInput";
import { TagsInput } from "../components/TagsInput";
import { TextareaInput } from "../components/TextareaInput";
import { TextInput } from "../components/TextInput";
import type { RenderNodeContext } from "../types";
import { ReviewDiffRenderer } from "./ReviewDiffRenderer";

export interface FieldRendererProps {
  node: FieldNode;
  renderContext: RenderNodeContext;
}

export function FieldRenderer({ node, renderContext }: FieldRendererProps) {
  const value = renderContext.answers[node.name];
  const readonly = renderContext.readonly;
  const disabled = resolveNodeDisabled(node, renderContext.context);
  const errors = renderContext.errorsByField.get(node.name) ?? [];

  if (renderContext.mode === "REVIEW_DIFF") {
    return (
      <ReviewDiffRenderer
        field={node}
        originalValue={value}
        patchedValue={renderContext.patchedAnswers[node.name]}
        patches={renderContext.context.review?.patches}
      />
    );
  }

  return (
    <div data-field-name={node.name} data-node-id={node.id}>
      <label>
        <span>
          {node.title}
          {node.required === true ? " *" : ""}
        </span>
        {renderInput(node, value, readonly, disabled, (nextValue) => renderContext.onFieldChange(node, nextValue))}
      </label>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      {errors.length > 0 ? (
        <ul>
          {errors.map((error, index) => (
            <li key={`${error.code}-${index}`} role="alert">
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function renderInput(
  node: FieldNode,
  value: unknown,
  readonly: boolean,
  disabled: boolean,
  onChange: (value: unknown) => void,
) {
  switch (node.type) {
    case "input.text":
      return (
        <TextInput
          disabled={disabled}
          placeholder={node.placeholder}
          readonly={readonly}
          value={value}
          onChange={onChange}
        />
      );
    case "input.textarea":
    case "input.richtext":
      return (
        <TextareaInput
          disabled={disabled}
          maxRows={"maxRows" in node ? node.maxRows : undefined}
          minRows={"minRows" in node ? node.minRows : undefined}
          placeholder={node.placeholder}
          readonly={readonly}
          value={value}
          onChange={onChange}
        />
      );
    case "choice.radio":
      return <RadioInput disabled={disabled} field={node} readonly={readonly} value={value} onChange={onChange} />;
    case "choice.checkbox":
      return <CheckboxInput disabled={disabled} field={node} readonly={readonly} value={value} onChange={onChange} />;
    case "choice.select":
      return <SelectInput disabled={disabled} field={node} readonly={readonly} value={value} onChange={onChange} />;
    case "choice.tags":
      return <TagsInput disabled={disabled} field={node} readonly={readonly} value={value} onChange={onChange} />;
    case "data.json":
      return <JsonEditorInput disabled={disabled} readonly={readonly} value={value} onChange={onChange} />;
    case "upload.file":
    case "upload.image":
      return <FileInput disabled={disabled} field={node} readonly={readonly} value={value} />;
  }
}

export function isChoiceFieldNode(node: FieldNode): node is ChoiceFieldNode {
  return node.type.startsWith("choice.");
}
