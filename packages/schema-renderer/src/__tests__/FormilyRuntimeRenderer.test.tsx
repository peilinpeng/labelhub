import type { LabelHubRuntimeContext, LabelHubSchema } from "@labelhub/contracts";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
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
