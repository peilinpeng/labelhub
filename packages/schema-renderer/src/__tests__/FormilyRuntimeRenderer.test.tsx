import type { AnswerPayload, LabelHubRuntimeContext, LabelHubSchema, LLMRuntimeResponse } from "@labelhub/contracts";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { runSchemaPreflight } from "@labelhub/schema-compiler";
import { SchemaRenderer } from "../SchemaRenderer";

// 基础 context，保持与 SchemaRenderer.test.tsx 风格一致
const baseContext: LabelHubRuntimeContext = {
  task: {
    id: "task_linkage_test",
    title: "联动测试",
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_linkage_1",
  },
  schema: {
    schemaId: "schema_linkage_test",
    schemaVersionId: "sv_linkage_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_linkage_1",
    sourcePayload: {},
  },
  answers: {},
  system: {
    actor: {
      id: "usr_labeler",
      role: "LABELER",
      displayName: "标注员",
    },
    role: "LABELER",
    now: "2026-06-07T00:00:00.000Z",
  },
};

// 简单联动 schema：trigger 字段控制 target 字段可见性
function createLinkageSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_linkage_test",
    status: "DRAFT",
    meta: {
      name: "联动测试 schema",
      taskId: "task_linkage_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "trigger_field",
          kind: "FIELD",
          type: "input.text",
          name: "trigger",
          title: "触发字段",
        },
        {
          id: "target_field",
          kind: "FIELD",
          type: "input.text",
          name: "target",
          title: "联动目标",
          visibleWhen: {
            op: "eq",
            left: { kind: "path", path: "$.answers.trigger" },
            right: { kind: "literal", value: "show" },
          },
        },
      ],
    },
  };
}

// 带 linkageRules 的 schema：当 score 为 "low" 时显示并必填 note，否则隐藏并清空
function createLinkageRulesSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_rules_test",
    status: "DRAFT",
    meta: {
      name: "联动规则 schema",
      taskId: "task_linkage_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "score_field",
          kind: "FIELD",
          type: "choice.radio",
          name: "score",
          title: "评分",
          options: [
            { label: "低", value: "low" },
            { label: "高", value: "high" },
          ],
          linkageRules: [
            {
              id: "R-score-note",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.score" },
                right: { kind: "literal", value: "low" },
              },
              effects: [
                { action: "setVisible", target: "note", value: true },
                { action: "setRequired", target: "note", value: true },
              ],
              otherwise: [
                { action: "setVisible", target: "note", value: false },
                { action: "setRequired", target: "note", value: false },
                { action: "clearValue", target: "note" },
              ],
            },
          ],
        },
        {
          id: "note_field",
          kind: "FIELD",
          type: "input.text",
          name: "note",
          title: "备注",
        },
      ],
    },
  };
}

function renderFormily(
  schema: LabelHubSchema,
  options: {
    answers?: Record<string, unknown>;
    onAnswersChange?: (a: Record<string, unknown>) => void;
  } = {},
) {
  const answers = options.answers ?? {};
  return render(
    <SchemaRenderer
      engine="formily-v2"
      schema={schema}
      context={{ ...baseContext, answers }}
      answers={answers}
      mode="LABELING"
      onAnswersChange={options.onAnswersChange ?? (() => undefined)}
    />,
  );
}

describe("FormilyRuntimeRenderer（formily-v2）", () => {
  test("legacy renderer 测试不受 formily-v2 影响（smoke check）", () => {
    const schema = createLinkageSchema();
    render(
      <SchemaRenderer
        schema={schema}
        context={{ ...baseContext, answers: {} }}
        answers={{}}
        mode="LABELING"
        onAnswersChange={() => undefined}
      />,
    );
    expect(screen.getByText("触发字段")).toBeTruthy();
  });

  test("visibleWhen：初始条件不满足时目标字段不可见", async () => {
    renderFormily(createLinkageSchema(), { answers: { trigger: "hide" } });

    // Formily field display=hidden 时 DOM 不渲染内容
    await waitFor(() => {
      const label = screen.queryByText("联动目标");
      expect(label).toBeNull();
    });
  });

  test("visibleWhen：条件满足时目标字段可见", async () => {
    renderFormily(createLinkageSchema(), { answers: { trigger: "show" } });

    await waitFor(() => {
      expect(screen.getByText("联动目标")).toBeTruthy();
    });
  });

  test("linkageRules：clearValue 在值为空时不触发无限递归", async () => {
    // 初始 note 为空，切换 score → otherwise 的 clearValue 不应引发 call stack
    const onAnswersChange = vi.fn();
    renderFormily(createLinkageRulesSchema(), { answers: {}, onAnswersChange });

    // 选择 high → otherwise 触发 clearValue(note)，note 已是空值 → idempotent，无递归
    const highRadio = screen.getByLabelText("高") as HTMLInputElement;

    await act(async () => {
      fireEvent.click(highRadio);
    });

    // 不应抛出 Maximum call stack，且 onAnswersChange 被调用（score 变化）
    expect(onAnswersChange).toHaveBeenCalled();
    const lastCall = onAnswersChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastCall?.["score"]).toBe("high");
    // note 被 clearValue，值不存在或为 undefined
    expect(lastCall?.["note"]).toBeUndefined();
  });

  test("linkageRules：选 low 后 note 出现且带必填标记", async () => {
    renderFormily(createLinkageRulesSchema(), { answers: {} });

    const lowRadio = screen.getByLabelText("低") as HTMLInputElement;
    await act(async () => {
      fireEvent.click(lowRadio);
    });

    // note 字段可见，label 含必填标记 *
    await waitFor(() => {
      expect(screen.getByText("备注 *")).toBeTruthy();
    });
  });

  test("linkageRules：选 high 后 note 隐藏", async () => {
    renderFormily(createLinkageRulesSchema(), { answers: { score: "low" } });

    // 先确认 note 已显示
    await waitFor(() => {
      expect(screen.getByText("备注 *")).toBeTruthy();
    });

    const highRadio = screen.getByLabelText("高") as HTMLInputElement;
    await act(async () => {
      fireEvent.click(highRadio);
    });

    await waitFor(() => {
      expect(screen.queryByText("备注 *")).toBeNull();
      expect(screen.queryByText("备注")).toBeNull();
    });
  });

  test("linkageRules：clearValue 会清空已有值", async () => {
    const onAnswersChange = vi.fn();
    // 初始 note 有值，切换 score=high → clearValue 应清空
    renderFormily(createLinkageRulesSchema(), {
      answers: { score: "low", note: "需要清除的内容" },
      onAnswersChange,
    });

    await waitFor(() => {
      expect(screen.getByText("备注 *")).toBeTruthy();
    });

    const highRadio = screen.getByLabelText("高") as HTMLInputElement;
    await act(async () => {
      fireEvent.click(highRadio);
    });

    // 最后一次 onAnswersChange 调用中 note 应被清除
    await waitFor(() => {
      const lastAnswers = onAnswersChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(lastAnswers?.["note"]).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// LLM_ASSIST 节点在 formily-v2 下的集成测试
// ---------------------------------------------------------------------------

/** 含 LLM_ASSIST 节点的简单 schema */
function createLLMAssistSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_llm_formily_test",
    status: "DRAFT",
    meta: {
      name: "formily-v2 LLM_ASSIST 测试",
      taskId: "task_linkage_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "field_a",
          kind: "FIELD",
          type: "input.text",
          name: "fieldA",
          title: "字段 A",
        },
        {
          id: "ai_node",
          kind: "LLM_ASSIST",
          type: "llm.assist",
          title: "AI 辅助",
          trigger: "MANUAL",
          promptTemplate: "提示词",
          inputBindings: {},
          outputMode: "SUGGESTION",
          outputBindings: [],
        },
      ],
    },
  };
}

/**
 * 联动 + LLM_ASSIST schema：
 * score (radio) → note（visible/required/clearValue）+ LLM_ASSIST 节点
 */
function createLinkageLLMAssistSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_linkage_llm_formily",
    status: "DRAFT",
    meta: {
      name: "formily-v2 联动+LLM_ASSIST 测试",
      taskId: "task_linkage_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "score_field",
          kind: "FIELD",
          type: "choice.radio",
          name: "score",
          title: "评分",
          options: [
            { label: "低", value: "low" },
            { label: "高", value: "high" },
          ],
          linkageRules: [
            {
              id: "R-score-note-llm",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.score" },
                right: { kind: "literal", value: "low" },
              },
              effects: [
                { action: "setVisible", target: "note", value: true },
                { action: "setRequired", target: "note", value: true },
              ],
              otherwise: [
                { action: "setVisible", target: "note", value: false },
                { action: "setRequired", target: "note", value: false },
                { action: "clearValue", target: "note" },
              ],
            },
          ],
        },
        {
          id: "note_field",
          kind: "FIELD",
          type: "input.text",
          name: "note",
          title: "备注",
        },
        {
          id: "ai_node",
          kind: "LLM_ASSIST",
          type: "llm.assist",
          title: "AI 辅助",
          trigger: "MANUAL",
          promptTemplate: "提示词",
          inputBindings: {},
          outputMode: "SUGGESTION",
          outputBindings: [],
        },
      ],
    },
  };
}

function renderFormilyWithLLM(
  schema: LabelHubSchema,
  options: {
    answers?: Record<string, unknown>;
    onAnswersChange?: (a: Record<string, unknown>) => void;
    onLLMAssist?: Parameters<typeof SchemaRenderer>[0]["onLLMAssist"];
    onAssistOutcome?: Parameters<typeof SchemaRenderer>[0]["onAssistOutcome"];
  } = {},
) {
  const answers = options.answers ?? {};
  const extraProps: Partial<Parameters<typeof SchemaRenderer>[0]> = {};
  if (options.onLLMAssist !== undefined) extraProps.onLLMAssist = options.onLLMAssist;
  if (options.onAssistOutcome !== undefined) extraProps.onAssistOutcome = options.onAssistOutcome;

  return render(
    <SchemaRenderer
      engine="formily-v2"
      schema={schema}
      context={{ ...baseContext, answers }}
      answers={answers}
      mode="LABELING"
      onAnswersChange={options.onAnswersChange ?? (() => undefined)}
      {...extraProps}
    />,
  );
}

async function clickAiButtonFormily(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "AI 辅助" }));
  });
}

describe("FormilyRuntimeRenderer（formily-v2）：LLM_ASSIST 集成", () => {
  test("formily-v2 能渲染 LLM_ASSIST 节点（AI 辅助按钮可见）", () => {
    renderFormilyWithLLM(createLLMAssistSchema());
    expect(screen.getByRole("button", { name: "AI 辅助" })).toBeTruthy();
  });

  test("点击 AI 辅助后显示 AI output", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "formily-v2 AI 输出",
      callId: "llm_formily_1",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLLMAssistSchema(), { onLLMAssist });
    await clickAiButtonFormily();

    await waitFor(() => {
      expect(screen.getByText("formily-v2 AI 输出")).toBeTruthy();
    });
  });

  test("有 suggestedPatch 时显示 preflight block", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "建议值" },
      callId: "llm_formily_2",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLLMAssistSchema(), { onLLMAssist });
    await clickAiButtonFormily();

    await waitFor(() => {
      expect(screen.getByText(/预检通过/)).toBeTruthy();
    });
    expect(screen.getByRole("status")).toBeTruthy();
  });

  test("BLOCKED 时确认按钮 disabled", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { nonExistentField: "x" },
      callId: "llm_formily_blocked",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLLMAssistSchema(), { onLLMAssist });
    await clickAiButtonFormily();

    await waitFor(() => {
      return document.querySelector("[data-preflight-status='BLOCKED']") !== null;
    });

    const confirmBtn = screen.getByRole("button", { name: "确认应用建议" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  test("SAFE 时确认按钮可点击", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "建议值" },
      callId: "llm_formily_safe",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLLMAssistSchema(), { onLLMAssist });
    await clickAiButtonFormily();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    const confirmBtn = screen.getByRole("button", { name: "确认应用建议" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  test("点击确认后通过 Formily state machine 更新 answers", async () => {
    const onAnswersChange = vi.fn();
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "新值" },
      callId: "llm_formily_apply",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLLMAssistSchema(), {
      onLLMAssist,
      onAssistOutcome,
      onAnswersChange,
    });
    await clickAiButtonFormily();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认应用建议" }));
    });

    // ACCEPTED audit 事件应触发
    const acceptedCalls = onAssistOutcome.mock.calls.filter(
      (call) => (call[0] as { action: string }).action === "ACCEPTED",
    );
    expect(acceptedCalls).toHaveLength(1);

    // onAnswersChange 应被调用，且包含新字段值
    expect(onAnswersChange).toHaveBeenCalled();
    const lastAnswers = onAnswersChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastAnswers?.["fieldA"]).toBe("新值");
  });

  test("onApplySuggestedPatch 上报的 answers 也是新 plain object（不共享 Formily proxy 引用）", async () => {
    const onAnswersChange = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "建议值" },
      callId: "llm_clone_check",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLLMAssistSchema(), {
      onLLMAssist,
      onAnswersChange,
    });
    await clickAiButtonFormily();
    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认应用建议" }));
    });

    expect(onAnswersChange).toHaveBeenCalled();
    const patchArg = onAnswersChange.mock.calls.at(-1)?.[0];
    // 应是 plain object（可被 JSON.stringify，且不是 Formily proxy 的同一引用）
    expect(() => JSON.stringify(patchArg)).not.toThrow();
    expect(typeof patchArg).toBe("object");
    expect(patchArg).not.toBeNull();
  });

  test("应用 AI patch 后 linkageRules 会重新求值（联动继续触发）", async () => {
    const onAnswersChange = vi.fn();
    // 初始 score=low → note visible+required
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      // patch：将 score 改为 high → note 应被 clearValue + hidden
      suggestedPatch: { score: "high" },
      callId: "llm_formily_linkage_reeval",
    } as LLMRuntimeResponse);

    renderFormilyWithLLM(createLinkageLLMAssistSchema(), {
      answers: { score: "low", note: "有值" },
      onLLMAssist,
      onAnswersChange,
    });

    // 确认初始状态：note 可见且必填
    await waitFor(() => {
      expect(screen.getByText("备注 *")).toBeTruthy();
    });

    await clickAiButtonFormily();

    // WARNING（改 score 会清空 note）或 SAFE 都允许应用
    await waitFor(() => {
      return (
        document.querySelector("[data-preflight-status='WARNING']") !== null ||
        document.querySelector("[data-preflight-status='SAFE']") !== null
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认应用建议" }));
    });

    // patch 应用后 reactions 重跑：note 隐藏（被 setVisible:false）并清空
    await waitFor(() => {
      const lastAnswers = onAnswersChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      // score 更新为 high
      expect(lastAnswers?.["score"]).toBe("high");
      // note 被 clearValue（linkageRules otherwise 分支）
      expect(lastAnswers?.["note"]).toBeUndefined();
    });

    // note 字段在 DOM 中应该隐藏
    await waitFor(() => {
      expect(screen.queryByText("备注 *")).toBeNull();
      expect(screen.queryByText("备注")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// onAnswersChange 必须上报新 plain object（修复 Formily proxy 引用问题）
// 修复前：form.values 是 Formily mutable proxy，每次是同一引用。
//         连续两次字段变更后，React setAnswers 做 Object.is 比较认为引用未变，
//         跳过 re-render，上层 missingRequiredFields useMemo 不重新计算。
// 修复后：{ ...(form.values) } 展开为新 plain object，Object.is 必然返回 false。
// ---------------------------------------------------------------------------

describe("FormilyRuntimeRenderer（formily-v2）：onAnswersChange 必须为新 plain object", () => {
  test("连续两次字段变更，每次 onAnswersChange 传入的是不同 plain object 引用", async () => {
    const onAnswersChange = vi.fn();
    renderFormily(createLinkageRulesSchema(), { onAnswersChange });

    // 第一次变更：score=low
    await act(async () => {
      fireEvent.click(screen.getByLabelText("低"));
    });

    // 第二次变更：score=high
    await act(async () => {
      fireEvent.click(screen.getByLabelText("高"));
    });

    expect(onAnswersChange).toHaveBeenCalledTimes(2);
    const firstArg = onAnswersChange.mock.calls.at(0)?.[0] as Record<string, unknown>;
    const secondArg = onAnswersChange.mock.calls.at(1)?.[0] as Record<string, unknown>;

    // 关键断言：两次调用必须是不同对象引用
    // 修复前此断言失败（firstArg === secondArg，同一 Formily proxy）
    expect(firstArg).not.toBe(secondArg);

    // 内容正确
    expect(firstArg["score"]).toBe("low");
    expect(secondArg["score"]).toBe("high");
  });

  test("score=high：隐藏的 note 不出现在 preflight requiredMissingFieldNames（不阻断提交）", async () => {
    const onAnswersChange = vi.fn();
    renderFormily(createLinkageRulesSchema(), { onAnswersChange });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("高"));
    });

    expect(onAnswersChange).toHaveBeenCalled();
    const lastAnswers = onAnswersChange.mock.calls.at(-1)?.[0] as AnswerPayload;

    // score=high → note 被 setVisible:false → preflight 跳过 hidden 字段
    const { requiredMissingFieldNames } = runSchemaPreflight({
      schema: createLinkageRulesSchema(),
      currentAnswers: lastAnswers,
      patch: [],
    });
    expect(requiredMissingFieldNames).toHaveLength(0);
  });

  test("score=low + note 为空：preflight 应阻断（note visible+required+empty）", async () => {
    const onAnswersChange = vi.fn();
    renderFormily(createLinkageRulesSchema(), { onAnswersChange });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("低"));
    });

    expect(onAnswersChange).toHaveBeenCalled();
    const lastAnswers = onAnswersChange.mock.calls.at(-1)?.[0] as AnswerPayload;

    // score=low → note 被 setVisible:true + setRequired:true，但值为空 → 应阻断
    const { requiredMissingFieldNames } = runSchemaPreflight({
      schema: createLinkageRulesSchema(),
      currentAnswers: lastAnswers,
      patch: [],
    });
    expect(requiredMissingFieldNames).toContain("note");
  });
});
