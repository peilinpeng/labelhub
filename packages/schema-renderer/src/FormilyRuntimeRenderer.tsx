import { LifeCycleTypes, createForm } from "@formily/core";
import type { Field as FormilyField, Form } from "@formily/core";
import { Field, FormProvider, useField } from "@formily/react";
import { useEffect, useMemo, useRef } from "react";
import type {
  AnswerPayload,
  ChoiceFieldNode,
  ContainerNode,
  FieldLinkageEffect,
  FieldNode,
  LLMAssistNode,
  SchemaNode,
  ShowItemNode,
} from "@labelhub/contracts";
import { buildReactionPlan } from "@labelhub/schema-compiler";
import type { ReactionPlan } from "@labelhub/schema-compiler";
import { evaluateExpression, resolveNodeVisibility } from "@labelhub/schema-core";
import type { RuntimeContextWithOutput } from "@labelhub/schema-core";
import type { ComponentRegistry } from "./ComponentRegistry";
import { COMPONENT_NAMES } from "./ComponentRegistry";
import { LLMAssistRenderer } from "./renderers/LLMAssistRenderer";
import { ShowItemRenderer } from "./renderers/ShowItemRenderer";
import type { RenderNodeContext, SchemaRendererProps } from "./types";

export interface FormilyRuntimeRendererProps extends SchemaRendererProps {
  /** FE-2 傳入包裝後的 adapter 集合；registry 為空時 field 不渲染 */
  registry?: ComponentRegistry;
}

// ---------------------------------------------------------------------------
// FormilyFieldLabel：Formily decorator，通过 useField() 读取动态 required / errors
// ---------------------------------------------------------------------------
interface FormilyFieldLabelProps {
  title: string;
  children?: React.ReactNode;
}

function FormilyFieldLabel({ title, children }: FormilyFieldLabelProps) {
  const field = useField<FormilyField>();
  const errorMessages = (field.selfErrors as unknown[])
    .map((m) => (typeof m === "string" ? m : String(m)))
    .filter(Boolean);

  return (
    <div data-formily-field={String(field.path)}>
      <label>
        {title}
        {field.required ? " *" : ""}
      </label>
      {children}
      {errorMessages.length > 0 ? (
        <ul>
          {errorMessages.map((msg, i) => (
            <li key={i} role="alert">
              {msg}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormilyRuntimeRenderer
// ---------------------------------------------------------------------------
export function FormilyRuntimeRenderer({
  schema,
  answers,
  context,
  mode,
  onAnswersChange,
  onLLMAssist,
  onAssistOutcome,
  readonly: readonlyProp,
  patchedAnswers: patchedAnswersProp,
  onUnsupportedNode,
  registry,
}: FormilyRuntimeRendererProps) {
  const isReadonly = (readonlyProp === true) || mode === "REVIEW_READONLY" || mode === "REVIEW_DIFF";

  const form = useMemo(
    () => createForm({ initialValues: answers }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema.schemaId],
  );

  // 防止 reaction 写值（clearValue / setValue）再次触发 ON_FORM_VALUES_CHANGE → 无限递归
  const applyingReactionsRef = useRef(false);

  // 稳定化 context 和 onAnswersChange 引用
  const contextRef = useRef(context);
  contextRef.current = context;

  const onAnswersChangeRef = useRef(onAnswersChange);
  onAnswersChangeRef.current = onAnswersChange;

  // 编译 reaction plan，只在 schema 变化时重新计算
  const reactionPlan = useMemo(() => buildReactionPlan(schema), [schema]);

  useEffect(() => {
    function runReactions(currentAnswers: AnswerPayload): void {
      const runtimeCtx: RuntimeContextWithOutput = {
        ...contextRef.current,
        answers: currentAnswers,
      };
      applyReactionPlan(form, reactionPlan, runtimeCtx);
    }

    // 初始化：基于初始 answers 立刻求值所有 reaction（guard 保护，防止 clearValue 引发递归）
    applyingReactionsRef.current = true;
    try {
      runReactions(form.values as AnswerPayload);
    } finally {
      applyingReactionsRef.current = false;
    }

    const id = form.subscribe(({ type }) => {
      if (type !== LifeCycleTypes.ON_FORM_VALUES_CHANGE) return;
      // guard：reaction 执行期间 clearValue/setValue 会再次触发此回调，直接跳过
      if (applyingReactionsRef.current) return;

      applyingReactionsRef.current = true;
      try {
        runReactions(form.values as AnswerPayload);
      } finally {
        applyingReactionsRef.current = false;
      }

      // 在所有 reaction（含 clearValue）完成后，上报最终 answers
      // 必须 spread 成新的 plain object：form.values 是 Formily mutable proxy，
      // 始终是同一引用，直接传入会导致 React setAnswers 做 Object.is 比较后
      // 认为引用未变而跳过 re-render，上层 useMemo([answers]) 不重新计算。
      onAnswersChangeRef.current({ ...(form.values as AnswerPayload) });
    });
    return () => {
      form.unsubscribe(id);
    };
  }, [form, reactionPlan]);

  const contextWithAnswers = useMemo(
    () => ({ ...context, answers }),
    [context, answers],
  );

  const entries = registry?.entries ?? {};

  function renderLLMAssistNode(node: LLMAssistNode): React.ReactNode {
    const formAnswers = form.values as AnswerPayload;
    const renderContext: RenderNodeContext = {
      schema,
      context: { ...context, answers: formAnswers },
      answers: formAnswers,
      patchedAnswers: patchedAnswersProp ?? formAnswers,
      mode,
      readonly: isReadonly,
      errorsByField: new Map(),
      onFieldChange: () => undefined,
      onLLMAssist,
      onAssistOutcome,
      onApplySuggestedPatch: (nextAnswers: AnswerPayload) => {
        // 屏蔽中间 reaction，整批完成后再统一触发
        applyingReactionsRef.current = true;
        try {
          const currentValues = form.values as Record<string, unknown>;
          // 删除 nextAnswers 中不存在或 undefined 的字段（normalize 清理）
          for (const key of Object.keys(currentValues)) {
            if (!(key in nextAnswers) || nextAnswers[key] === undefined) {
              form.deleteValuesIn(key);
            }
          }
          // 只写入有明确值的字段
          const definedAnswers = Object.fromEntries(
            Object.entries(nextAnswers).filter(([, v]) => v !== undefined),
          ) as AnswerPayload;
          form.setValues(definedAnswers);
        } finally {
          applyingReactionsRef.current = false;
        }
        // patch 写入后统一重跑 reactions，确保联动规则（clearValue / setRequired / setVisible）继续触发
        const runtimeCtx: RuntimeContextWithOutput = {
          ...contextRef.current,
          answers: form.values as AnswerPayload,
        };
        applyReactionPlan(form, reactionPlan, runtimeCtx);
        // 同理：spread 成新 plain object，确保上层 setAnswers 触发 re-render
        onAnswersChangeRef.current({ ...(form.values as AnswerPayload) });
      },
      onUnsupportedNode,
    };
    return <LLMAssistRenderer key={node.id} node={node} renderContext={renderContext} />;
  }

  function renderSchemaNode(node: SchemaNode): React.ReactNode {
    if (node.kind === "FIELD") {
      // FE-5：FieldNode 始终挂载，由 Formily field state.display 控制可见性
      return renderFieldNode(node);
    }

    if (node.kind === "CONTAINER") {
      // ContainerNode 暂保留 legacy visibility gate（FE-5 不做 container reaction）
      if (!resolveNodeVisibility(node, contextWithAnswers)) return null;
      return renderContainerNode(node);
    }

    if (node.kind === "LLM_ASSIST") {
      return renderLLMAssistNode(node);
    }

    if (node.kind === "SHOW_ITEM") {
      // ShowItem 只读展示题目原始数据（prompt/answer/media），不写 answers；
      // 沿用 legacy visibility gate，保持与 ContainerNode 一致。
      if (!resolveNodeVisibility(node, contextWithAnswers)) return null;
      return renderShowItemNode(node);
    }

    return null;
  }

  function renderShowItemNode(node: ShowItemNode): React.ReactNode {
    const formAnswers = form.values as AnswerPayload;
    const renderContext: RenderNodeContext = {
      schema,
      context: { ...context, answers: formAnswers },
      answers: formAnswers,
      patchedAnswers: patchedAnswersProp ?? formAnswers,
      mode,
      readonly: isReadonly,
      errorsByField: new Map(),
      onFieldChange: () => undefined,
      onLLMAssist,
      onAssistOutcome,
      onApplySuggestedPatch: () => undefined,
      onUnsupportedNode,
    };
    return <ShowItemRenderer key={node.id} node={node} renderContext={renderContext} />;
  }

  function renderFieldNode(node: FieldNode): React.ReactNode {
    const componentName = getComponentName(node);
    if (componentName === undefined) return null;

    const AdapterComponent = entries[componentName];
    if (AdapterComponent === undefined) return null;

    return (
      <Field
        key={node.id}
        name={node.name}
        required={node.required ?? false}
        disabled={node.disabled ?? false}
        decorator={[FormilyFieldLabel, { title: node.title }]}
        component={[AdapterComponent, buildComponentProps(node, isReadonly)]}
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

// ---------------------------------------------------------------------------
// reaction 执行层
// ---------------------------------------------------------------------------
function applyReactionPlan(
  form: Form,
  plan: ReactionPlan,
  runtimeCtx: RuntimeContextWithOutput,
): void {
  for (const reaction of plan.reactions) {
    const matched = evaluateExpression(reaction.when, runtimeCtx);
    applyEffects(form, matched ? reaction.effects : reaction.otherwise);
  }
}

function applyEffects(form: Form, effects: FieldLinkageEffect[]): void {
  for (const effect of effects) {
    switch (effect.action) {
      case "setVisible":
        form.setFieldState(effect.target, (state) => {
          state.display = effect.value ? "visible" : "hidden";
        });
        break;

      case "setDisabled":
        form.setFieldState(effect.target, (state) => {
          // 同时更新 componentProps.disabled，使 adapter 感知禁用状态
          state.componentProps = {
            ...(state.componentProps as Record<string, unknown>),
            disabled: effect.value,
          };
        });
        break;

      case "setRequired":
        form.setFieldState(effect.target, (state) => {
          // 更新 Formily field.required（FormilyFieldLabel decorator 通过 useField() 读取）
          state.required = effect.value;
        });
        break;

      case "clearValue": {
        // idempotent check：只有字段有值时才清空，防止无意义写入再次触发 ON_FORM_VALUES_CHANGE
        const current = form.getValuesIn(effect.target);
        if (current !== undefined && current !== null && current !== "") {
          form.deleteValuesIn(effect.target);
        }
        break;
      }

      case "setValue": {
        // idempotent check：只有目标值与当前值不同时才写入
        const current = form.getValuesIn(effect.target);
        if (current !== effect.value) {
          form.setValuesIn(effect.target, effect.value);
        }
        break;
      }

      case "setOptions":
        form.setFieldState(effect.target, (state) => {
          const prevField = (
            state.componentProps as Record<string, unknown> | undefined
          )?.["field"] as Record<string, unknown> | undefined;
          state.componentProps = {
            ...(state.componentProps as Record<string, unknown>),
            field: { ...(prevField ?? {}), options: effect.options },
          };
        });
        break;

      // setWarning、setReadonly：FE-5 暂不实现 runtime，类型已保留
    }
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------
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
): Record<string, unknown> {
  const base = { readOnly };
  switch (node.type) {
    case "input.text":
      return { ...base, placeholder: node.placeholder };
    case "input.textarea":
      return {
        ...base,
        placeholder: node.placeholder,
        minRows: node.minRows,
        maxRows: node.maxRows,
      };
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
