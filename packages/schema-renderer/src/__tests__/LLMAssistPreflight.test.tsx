import type { LabelHubRuntimeContext, LabelHubSchema, LLMRuntimeResponse } from "@labelhub/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SchemaRenderer } from "../SchemaRenderer";
import { convertSuggestedPatchToPreflightPatch } from "../renderers/LLMAssistRenderer";

// ---------------------------------------------------------------------------
// 基础 context
// ---------------------------------------------------------------------------

const baseContext: LabelHubRuntimeContext = {
  task: {
    id: "task_preflight_fe8",
    title: "Preflight UI 测试",
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_preflight_1",
  },
  schema: {
    schemaId: "schema_preflight_fe8",
    schemaVersionId: "sv_preflight_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: { id: "item_pf_1", sourcePayload: {} },
  answers: {},
  system: {
    actor: { id: "usr_labeler", role: "LABELER", displayName: "标注员" },
    role: "LABELER",
    now: "2026-06-07T00:00:00.000Z",
  },
};

// ---------------------------------------------------------------------------
// 测试 schema 工厂
// ---------------------------------------------------------------------------

/** 简单 schema：一个文本字段 + LLM_ASSIST，无联动 → patch 存在字段时 SAFE */
function makeSimpleSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_preflight_fe8",
    status: "DRAFT",
    meta: {
      name: "FE-8 测试",
      taskId: "task_preflight_fe8",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根",
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
 * 带联动的 schema：
 * - trigger 字段（radio）+ note 字段
 * - linkageRules：trigger="low" → note visible+required；otherwise → note hidden + clearValue
 */
function makeLinkageSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_linkage_fe8",
    status: "DRAFT",
    meta: {
      name: "FE-8 联动测试",
      taskId: "task_preflight_fe8",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根",
      children: [
        {
          id: "trigger_field",
          kind: "FIELD",
          type: "choice.radio",
          name: "trigger",
          title: "触发字段",
          options: [
            { label: "低", value: "low" },
            { label: "高", value: "high" },
          ],
          linkageRules: [
            {
              id: "R-trigger-note",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.trigger" },
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

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------

type RenderSchemaOptions = {
  answers?: Record<string, unknown>;
  onLLMAssist?: Parameters<typeof SchemaRenderer>[0]["onLLMAssist"];
  onAssistOutcome?: Parameters<typeof SchemaRenderer>[0]["onAssistOutcome"];
  onAnswersChange?: (answers: Record<string, unknown>) => void;
};

function renderWithSchema(schema: LabelHubSchema, options: RenderSchemaOptions = {}) {
  const answers = options.answers ?? {};
  const extraProps: Partial<Parameters<typeof SchemaRenderer>[0]> = {};
  if (options.onLLMAssist !== undefined) extraProps.onLLMAssist = options.onLLMAssist;
  if (options.onAssistOutcome !== undefined) extraProps.onAssistOutcome = options.onAssistOutcome;

  return render(
    <SchemaRenderer
      schema={schema}
      context={{ ...baseContext, answers }}
      answers={answers}
      mode="LABELING"
      onAnswersChange={options.onAnswersChange ?? (() => undefined)}
      {...extraProps}
    />,
  );
}

async function clickAiButton(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "AI 辅助" }));
  });
}

// ---------------------------------------------------------------------------
// 1. convertSuggestedPatchToPreflightPatch 单元测试
// ---------------------------------------------------------------------------

describe("convertSuggestedPatchToPreflightPatch", () => {
  test("普通值转为 set 操作", () => {
    const result = convertSuggestedPatchToPreflightPatch({ fieldA: "hello", fieldB: 42 });
    expect(result).toEqual([
      { op: "set", fieldName: "fieldA", value: "hello" },
      { op: "set", fieldName: "fieldB", value: 42 },
    ]);
  });

  test("undefined 值转为 unset 操作", () => {
    const result = convertSuggestedPatchToPreflightPatch({ fieldA: undefined });
    expect(result).toEqual([{ op: "unset", fieldName: "fieldA" }]);
  });

  test("null 值转为 set（null 不是 undefined）", () => {
    const result = convertSuggestedPatchToPreflightPatch({ fieldA: null });
    expect(result).toEqual([{ op: "set", fieldName: "fieldA", value: null }]);
  });

  test("空对象返回空数组", () => {
    expect(convertSuggestedPatchToPreflightPatch({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. FE-8 集成测试
// ---------------------------------------------------------------------------

describe("LLMAssistRenderer preflight UI", () => {
  test("无 suggestedPatch 时不显示 preflight block", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "纯文本建议",
      callId: "llm_test_1",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => expect(screen.getByText("纯文本建议")).toBeTruthy());
    // 无 suggestedPatch → 无 preflight block
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // 无确认按钮（requireUserConfirm with empty outputBindings = true, but no patch）
  });

  test("空 suggestedPatch 时不显示确认按钮，也不显示 preflight block", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: {}, // 空对象：AI 未给出任何字段建议
      callId: "llm_test_empty_patch",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => expect(screen.getByText("AI 输出")).toBeTruthy());
    // 空 patch → 跳过 preflight（无 block）且不渲染可点的"确认应用建议"按钮
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "确认应用建议" })).toBeNull();
  });

  test("SAFE 状态显示'预检通过'", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "建议值" },
      callId: "llm_test_safe",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => {
      expect(screen.getByText(/预检通过/)).toBeTruthy();
    });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // 新文案：说明预检含义
    expect(screen.getByText(/不会新增必填缺失/)).toBeTruthy();
  });

  test("SAFE 状态显示'将更新字段'", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "建议值" },
      callId: "llm_test_safe_fields",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    // 字段摘要：只展示字段名，不展示值
    expect(screen.getByText(/将更新字段/)).toBeTruthy();
    expect(screen.getByText(/fieldA/)).toBeTruthy();
  });

  test("SAFE 状态不展示完整 patch value", async () => {
    const secretValue = "SECRET_PATCH_VALUE_12345";
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出摘要",
      suggestedPatch: { fieldA: secretValue },
      callId: "llm_safe_no_value",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    // preflight block 区域不应暴露 patch 的具体值
    const statusBlock = screen.getByRole("status");
    expect(statusBlock.textContent).not.toContain(secretValue);
  });

  test("WARNING 状态显示'预检发现影响'", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { trigger: "high" },
      callId: "llm_test_warn",
    } as LLMRuntimeResponse);

    renderWithSchema(makeLinkageSchema(), {
      answers: { trigger: "low", note: "已填写的内容" },
      onLLMAssist,
    });
    await clickAiButton();

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeTruthy();
    });
    const statusBlock = screen.getByRole("status");
    expect(statusBlock.textContent).toMatch(/预检发现影响/);
    expect(statusBlock.getAttribute("data-preflight-status")).toBe("WARNING");
    expect(statusBlock.textContent).toMatch(/将更新字段/);
  });

  test("BLOCKED 状态显示'预检阻断'", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { notExistField: "x" },
      callId: "llm_test_blocked_1",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => {
      return document.querySelector("[data-preflight-status='BLOCKED']") !== null;
    });

    const blockedEl = document.querySelector("[data-preflight-status='BLOCKED']");
    expect(blockedEl).not.toBeNull();
    expect(blockedEl?.textContent).toMatch(/预检阻断/);
    expect(blockedEl?.textContent).toMatch(/⛔/);
  });

  test("BLOCKED 状态显示'将更新字段'", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { notExistField: "x" },
      callId: "llm_blocked_fields",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => document.querySelector("[data-preflight-status='BLOCKED']") !== null);

    const blockedEl = document.querySelector("[data-preflight-status='BLOCKED']") as Element;
    expect(blockedEl.textContent).toMatch(/将更新字段/);
    expect(blockedEl.textContent).toMatch(/notExistField/);
  });

  test("BLOCKED 时确认按钮禁用", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { nonExistent: "x" },
      callId: "llm_blocked_btn",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => {
      return document.querySelector("[data-preflight-status='BLOCKED']") !== null;
    });

    const confirmBtn = screen.getByRole("button", { name: "确认应用建议" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  test("WARNING 时确认按钮可点击（ok === true）", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { trigger: "high" },
      callId: "llm_warn_btn",
    } as LLMRuntimeResponse);

    renderWithSchema(makeLinkageSchema(), {
      answers: { trigger: "low", note: "有值" },
      onLLMAssist,
    });
    await clickAiButton();

    await waitFor(() => {
      return document.querySelector("[data-preflight-status='WARNING']") !== null;
    });

    const confirmBtn = screen.getByRole("button", { name: "确认应用建议" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  test("SAFE 时确认按钮可点击", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "v" },
      callId: "llm_safe_btn",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    const confirmBtn = screen.getByRole("button", { name: "确认应用建议" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  test("BLOCKED 时点击不触发 ACCEPTED", async () => {
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { nonExistent: "x" },
      callId: "llm_blocked_accepted",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist, onAssistOutcome });
    await clickAiButton();

    await waitFor(() => {
      return document.querySelector("[data-preflight-status='BLOCKED']") !== null;
    });

    const confirmBtn = screen.getByRole("button", { name: "确认应用建议" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // disabled 按钮点击不会触发 handler
    fireEvent.click(confirmBtn);
    const acceptedCalls = onAssistOutcome.mock.calls.filter(
      (call) => (call[0] as { action: string }).action === "ACCEPTED",
    );
    expect(acceptedCalls).toHaveLength(0);
  });

  test("WARNING 时点击确认触发 ACCEPTED", async () => {
    const onAssistOutcome = vi.fn();
    const onAnswersChange = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { trigger: "high" },
      callId: "llm_warn_accepted",
    } as LLMRuntimeResponse);

    renderWithSchema(makeLinkageSchema(), {
      answers: { trigger: "low", note: "有值" },
      onLLMAssist,
      onAssistOutcome,
      onAnswersChange,
    });
    await clickAiButton();

    await waitFor(() => document.querySelector("[data-preflight-status='WARNING']") !== null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认应用建议" }));
    });

    const acceptedCalls = onAssistOutcome.mock.calls.filter(
      (call) => (call[0] as { action: string }).action === "ACCEPTED",
    );
    expect(acceptedCalls).toHaveLength(1);
    expect(onAnswersChange).toHaveBeenCalled();
  });

  test("SAFE 时点击确认触发 ACCEPTED", async () => {
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "v" },
      callId: "llm_safe_accepted",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist, onAssistOutcome });
    await clickAiButton();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认应用建议" }));
    });

    const acceptedCalls = onAssistOutcome.mock.calls.filter(
      (call) => (call[0] as { action: string }).action === "ACCEPTED",
    );
    expect(acceptedCalls).toHaveLength(1);
  });

  test("DISMISSED 不受 preflight 影响（BLOCKED 时仍可忽略）", async () => {
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { nonExistent: "x" },
      callId: "llm_dismissed",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist, onAssistOutcome });
    await clickAiButton();

    await waitFor(() => document.querySelector("[data-preflight-status='BLOCKED']") !== null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "忽略建议" }));
    });

    const dismissedCalls = onAssistOutcome.mock.calls.filter(
      (call) => (call[0] as { action: string }).action === "DISMISSED",
    );
    expect(dismissedCalls).toHaveLength(1);
  });

  test("点击忽略后清空 preflightResult（status block 消失）", async () => {
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 输出",
      suggestedPatch: { fieldA: "v" },
      callId: "llm_dismiss_clear",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });
    await clickAiButton();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "忽略建议" }));
    });

    // 忽略后 response 和 preflightResult 都清空
    expect(screen.queryByText(/预检通过/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("重新点击 AI 辅助时旧 preflightResult 不残留", async () => {
    let callCount = 0;
    const onLLMAssist = vi.fn().mockImplementation(async () => {
      callCount++;
      // 第一次返回 BLOCKED patch，第二次返回 SAFE patch
      return callCount === 1
        ? { output: "第一次", suggestedPatch: { nonExistent: "x" }, callId: `llm_retry_${callCount}` }
        : { output: "第二次", suggestedPatch: { fieldA: "v" }, callId: `llm_retry_${callCount}` };
    });

    renderWithSchema(makeSimpleSchema(), { onLLMAssist });

    // 第一次：BLOCKED
    await clickAiButton();
    await waitFor(() => document.querySelector("[data-preflight-status='BLOCKED']") !== null);

    // 忽略
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "忽略建议" }));
    });

    // 第二次：SAFE（旧 BLOCKED 状态不应残留）
    await clickAiButton();
    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    expect(document.querySelector("[data-preflight-status='BLOCKED']")).toBeNull();
    expect(screen.getByText(/预检通过/)).toBeTruthy();
  });

  test("不在 DOM 中展示完整 answers / raw output", async () => {
    const sensitiveValue = "__SENSITIVE_ANSWERS_SHOULD_NOT_APPEAR__";
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      suggestedPatch: { fieldA: "v" },
      callId: "llm_no_leak",
    } as LLMRuntimeResponse);

    renderWithSchema(makeSimpleSchema(), {
      answers: { fieldA: sensitiveValue },
      onLLMAssist,
    });
    await clickAiButton();

    await waitFor(() => screen.queryByText(/预检通过/) !== null);

    // 完整 answers 对象不应出现在渲染输出中
    expect(document.body.textContent).not.toContain(sensitiveValue);
  });
});
