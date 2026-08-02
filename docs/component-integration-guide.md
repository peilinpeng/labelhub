# LabelHub 功能组件接入说明

本文档说明 `apps/web` 页面如何接入 LabelHub 的动态 Schema 组件体系。页面层只负责组织业务流程，不重新实现 schema 规则。

## 1. 当前组件包职责

- `@labelhub/contracts`：唯一契约类型来源，所有页面、组件、Mock、后端都必须引用这里导出的类型。
- `@labelhub/schema-core`：动态 schema 规则内核，负责 traversal、JsonPath、Expression、visibility、normalization、validation、schema guards 和 schema factory。
- `@labelhub/schema-renderer`：动态 schema 渲染器，负责 Labeler 作答、Reviewer 只读、Reviewer diff 和 Designer 预览。
- `@labelhub/schema-designer`：Owner 侧模板设计器，负责物料添加、节点树编辑、属性配置、schema 校验和实时预览。

当前接入关系：

```txt
Owner 页面
  -> SchemaDesigner
  -> 生成 / 编辑 LabelHubSchema
  -> schema-core 校验
  -> schema-renderer PREVIEW 预览

Labeler 页面
  -> SchemaRenderer mode="LABELING"
  -> 填写 answers
  -> schema-core normalize + validate
  -> submit assignment

Reviewer 页面
  -> SchemaRenderer mode="REVIEW_READONLY" / "REVIEW_DIFF"
  -> 查看 submission answers / review patches
  -> 提交 review decision
```

## 2. 页面层职责边界

页面层负责：

- 路由与角色工作台布局。
- API / MSW Mock 数据请求。
- loading / error / empty state。
- 组合 `SchemaDesigner`、`SchemaRenderer` 和业务按钮。
- 接收组件回调，并调用保存草稿、提交、审核、发布等 API。

页面层不负责：

- schema traversal。
- JsonPath 解析。
- `visibleWhen` / `disabledWhen` 判断。
- answers normalization。
- answers validation。
- schema guards。
- LLM outputBinding 校验。
- 自己遍历 schema 并渲染字段。

所有契约类型都从 `@labelhub/contracts` 引入：

```ts
import type {
  AnswerPayload,
  LabelHubRuntimeContext,
  LabelHubSchema,
  ReviewPatch,
  ServerComponentRegistryItem,
} from "@labelhub/contracts";
```

不要在 `apps/web` 中重新定义这些类型。

## 3. RuntimeContext 组装规则

页面层需要从 API response 组装 `LabelHubRuntimeContext`。字段名必须以 `@labelhub/contracts` 当前导出类型为准。

```ts
import type { LabelHubRuntimeContext } from "@labelhub/contracts";

export const sampleContext: LabelHubRuntimeContext = {
  task: {
    id: "task_demo",
    title: "新闻质量标注任务",
    status: "DRAFT",
    activeSchemaVersionId: "sv_preview",
  },
  schema: {
    schemaId: "schema_demo",
    schemaVersionId: "sv_preview",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_demo",
    sourcePayload: {
      title: "示例新闻标题",
      body: "这是一段用于预览的新闻正文。",
    },
  },
  answers: {},
  system: {
    actor: {
      id: "usr_owner_demo",
      role: "OWNER",
      displayName: "Owner",
    },
    role: "OWNER",
    now: new Date().toISOString(),
  },
};
```

JsonPath 命名空间必须遵守契约：

- `$.task.xxx`
- `$.schema.xxx`
- `$.item.sourcePayload.xxx`
- `$.answers.xxx`
- `$.review.xxx`
- `$.system.xxx`
- `$.meta.xxx`
- `$.output.xxx`

其中 `$.output.xxx` 仅允许用于 LLM output binding，不用于普通 `ShowItem`、`visibleWhen`、`disabledWhen` 或 Export `sourcePath`。

禁止使用：

- `$.sourcePayload.xxx`
- `$.item.text`
- 没有命名空间的裸路径。

## 4. Owner 端接入 SchemaDesigner

Owner 页面用于创建和编辑任务模板。`serverRegistry` 必须来自 `GET /api/v1/schema/component-registry`，Mock 阶段也应从 MSW Mock API 获取。

如果传入空数组，`MaterialPanel` 会因为没有 server 支持的 `node.type` 而没有可添加组件。因此空数组只能作为 loading 前的瞬时状态，不应作为长期示例数据。

最小接入示例：

```tsx
import { useEffect, useState } from "react";
import type {
  LabelHubRuntimeContext,
  LabelHubSchema,
  SchemaValidationResult,
  ServerComponentRegistryItem,
} from "@labelhub/contracts";
import { createNewsQualitySchema } from "@labelhub/schema-core";
import { SchemaDesigner } from "@labelhub/schema-designer";

async function fetchServerRegistry(): Promise<ServerComponentRegistryItem[]> {
  const response = await fetch("/api/v1/schema/component-registry");
  return (await response.json()) as ServerComponentRegistryItem[];
}

async function validateSchema(schema: LabelHubSchema): Promise<SchemaValidationResult> {
  const response = await fetch("/api/v1/schema/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema),
  });
  return (await response.json()) as SchemaValidationResult;
}

export function OwnerSchemaDesignerPage() {
  const [schema, setSchema] = useState<LabelHubSchema>(() => createNewsQualitySchema());
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>([]);
  const [validation, setValidation] = useState<SchemaValidationResult | null>(null);

  useEffect(() => {
    void fetchServerRegistry().then(setServerRegistry);
  }, []);

  const sampleContext: LabelHubRuntimeContext = {
    task: {
      id: "task_demo",
      title: "新闻质量标注任务",
      status: "DRAFT",
      activeSchemaVersionId: "sv_preview",
    },
    schema: {
      schemaId: "schema_demo",
      schemaVersionId: "sv_preview",
      schemaVersionNo: 1,
      contractVersion: "1.1",
    },
    item: {
      id: "item_demo",
      sourcePayload: {
        title: "示例新闻标题",
        body: "这是一段用于预览的新闻正文。",
      },
    },
    answers: {},
    system: {
      actor: {
        id: "usr_owner_demo",
        role: "OWNER",
        displayName: "Owner",
      },
      role: "OWNER",
      now: new Date().toISOString(),
    },
  };

  return (
    <main>
      <h1>模板设计器</h1>

      <SchemaDesigner
        schema={schema}
        onSchemaChange={setSchema}
        readonly={false}
        serverRegistry={serverRegistry}
        sampleContext={sampleContext}
        onValidate={async (nextSchema) => {
          const result = await validateSchema(nextSchema);
          setValidation(result);
          return result;
        }}
        onPublishRequest={async (currentSchema) => {
          console.log("准备发布 schema", currentSchema);
          // 页面层按契约调用：
          // POST /api/v1/tasks/:taskId/schema/publish
          // POST /api/v1/tasks/:taskId/publish
        }}
      />

      {validation !== null && !validation.valid ? (
        <section>
          <h2>当前 schema 存在问题</h2>
          <pre>{JSON.stringify(validation.errors, null, 2)}</pre>
        </section>
      ) : null}
    </main>
  );
}
```

`onValidate` 的当前真实签名是：

```ts
onValidate?(schema: LabelHubSchema): SchemaValidationResult | Promise<SchemaValidationResult>;
```

`SchemaDesigner` 内部已经会用 `schema-core` 做本地校验。第一版页面可以先不传 `onValidate`，等接入后端或 MSW 的 `POST /api/v1/schema/validate` 后再补上。

Owner 页面建议接入的 API：

- `GET /api/v1/schema/component-registry`
- `GET /api/v1/tasks/:taskId`
- `PUT /api/v1/tasks/:taskId/schema/draft`
- `POST /api/v1/schema/validate`
- `POST /api/v1/tasks/:taskId/schema/ai-generate`
- `POST /api/v1/tasks/:taskId/schema/publish`
- `POST /api/v1/tasks/:taskId/publish`

## 5. Labeler 端接入 SchemaRenderer LABELING mode

Labeler 页面用于领取任务、填写答案、保存草稿和提交。

`SchemaRenderer` 当前真实 props 中，`onAnswersChange` 是必填；`onSubmit` 签名是：

```ts
onSubmit?(answers: AnswerPayload, validation: ValidationResult): void | Promise<void>;
```

`SchemaRenderer` 会在提交前调用 `schema-core` 完成 normalize 和 validate。只有本地 normalization 没有错误且 validation 通过时，才会调用 `onSubmit`。页面层仍可以通过 `errors` 传入后端返回的字段错误。

最小接入示例：

```tsx
import { useState } from "react";
import type {
  AnswerPayload,
  LabelHubRuntimeContext,
  LabelHubSchema,
  LLMRuntimeResponse,
  SubmitAssignmentRequest,
  ValidationError,
} from "@labelhub/contracts";
import { SchemaRenderer } from "@labelhub/schema-renderer";

interface LabelerAssignmentPageProps {
  assignmentId: string;
  schema: LabelHubSchema;
  context: LabelHubRuntimeContext;
  initialAnswers?: AnswerPayload;
}

export function LabelerAssignmentPage({
  assignmentId,
  schema,
  context,
  initialAnswers = {},
}: LabelerAssignmentPageProps) {
  const [answers, setAnswers] = useState<AnswerPayload>(initialAnswers);
  const [errors, setErrors] = useState<ValidationError[]>([]);

  return (
    <main>
      <h1>标注工作台</h1>

      <SchemaRenderer
        schema={schema}
        context={{ ...context, answers }}
        answers={answers}
        mode="LABELING"
        readonly={false}
        errors={errors}
        onAnswersChange={setAnswers}
        onSubmit={async (submitAnswers, validation) => {
          if (!validation.valid) {
            setErrors(validation.errors);
            return;
          }

          const body: SubmitAssignmentRequest = {
            answers: submitAnswers,
          };

          await fetch(`/api/v1/assignments/${assignmentId}/submit`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify(body),
          });
        }}
        onLLMAssist={async (node, runtimeContext, currentAnswers) => {
          const response = await fetch(`/api/v1/assignments/${assignmentId}/llm-assist`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify({
              nodeId: node.id,
              answers: currentAnswers,
              context: runtimeContext,
            }),
          });

          return (await response.json()) as LLMRuntimeResponse;
        }}
      />
    </main>
  );
}
```

如果本地开发时暂时不接 API，可以让 `onLLMAssist` 返回契约中的 `LLMRuntimeResponse`：

```ts
const demoLLMResponse: LLMRuntimeResponse = {
  output: {
    summary: "这是 AI 生成的摘要建议，需要用户确认后才会写入 answers。",
  },
  suggestedPatch: {
    summary: "这是 AI 生成的摘要建议，需要用户确认后才会写入 answers。",
  },
  callId: "llm_demo",
};
```

`LLMAssistRenderer` 不会直接修改 answers。只有用户点击“确认应用建议”后，才会通过 `onAnswersChange` 输出新的 answers。

Labeler 页面建议接入的 API：

- `GET /api/v1/marketplace/tasks`
- `POST /api/v1/tasks/:taskId/claim`
- `GET /api/v1/assignments/:assignmentId`
- `PUT /api/v1/assignments/:assignmentId/draft`
- `POST /api/v1/assignments/:assignmentId/submit`
- `POST /api/v1/assignments/:assignmentId/llm-assist`
- `GET /api/v1/me/submissions`

## 6. Reviewer 端接入 SchemaRenderer REVIEW_READONLY / REVIEW_DIFF

Reviewer 页面用于查看提交结果、AI 预审结果、人工审核和返回意见。

### 6.1 REVIEW_READONLY 示例

只读模式也需要传入 `onAnswersChange`，当前组件 props 中它是必填。页面可以传 no-op。

```tsx
import type {
  AnswerPayload,
  LabelHubRuntimeContext,
  LabelHubSchema,
} from "@labelhub/contracts";
import { SchemaRenderer } from "@labelhub/schema-renderer";

interface ReviewerReadonlyPageProps {
  schema: LabelHubSchema;
  context: LabelHubRuntimeContext;
  answers: AnswerPayload;
}

export function ReviewerReadonlyPage({
  schema,
  context,
  answers,
}: ReviewerReadonlyPageProps) {
  return (
    <main>
      <h1>审核详情</h1>

      <SchemaRenderer
        schema={schema}
        context={{ ...context, answers }}
        answers={answers}
        mode="REVIEW_READONLY"
        readonly={true}
        onAnswersChange={() => undefined}
      />
    </main>
  );
}
```

### 6.2 REVIEW_DIFF 示例

当前 diff props 名称是 `patches` 和 `patchedAnswers`，不要写成 `reviewPatches`。

```tsx
import type {
  AnswerPayload,
  LabelHubRuntimeContext,
  LabelHubSchema,
  ReviewPatch,
} from "@labelhub/contracts";
import { SchemaRenderer } from "@labelhub/schema-renderer";

interface ReviewerDiffPageProps {
  schema: LabelHubSchema;
  context: LabelHubRuntimeContext;
  answers: AnswerPayload;
  patches: ReviewPatch[];
  patchedAnswers?: AnswerPayload;
}

export function ReviewerDiffPage({
  schema,
  context,
  answers,
  patches,
  patchedAnswers,
}: ReviewerDiffPageProps) {
  return (
    <main>
      <h1>审核修改对比</h1>

      <SchemaRenderer
        schema={schema}
        context={{
          ...context,
          answers,
          review: {
            ...context.review,
            patches,
          },
        }}
        answers={answers}
        mode="REVIEW_DIFF"
        readonly={true}
        patches={patches}
        patchedAnswers={patchedAnswers}
        onAnswersChange={() => undefined}
      />
    </main>
  );
}
```

如果没有传 `patchedAnswers`，`SchemaRenderer` 会根据 `patches` 计算字段级 patched value。Reviewer 页面只传审核 patch 数据，不自己实现字段渲染和 diff 规则。

Reviewer 页面建议接入的 API：

- `GET /api/v1/review/queue`
- `GET /api/v1/review/submissions/:submissionId`
- `POST /api/v1/review/submissions/:submissionId/claim`
- `POST /api/v1/review/submissions/:submissionId/decision`
- `POST /api/v1/review/batch-decision`

## 7. API 对接建议

建议先接 MSW Mock，再切真实后端。

Owner 端：

- `GET /api/v1/schema/component-registry`
- `GET /api/v1/tasks/:taskId`
- `PUT /api/v1/tasks/:taskId/schema/draft`
- `POST /api/v1/schema/validate`
- `POST /api/v1/tasks/:taskId/schema/ai-generate`
- `POST /api/v1/tasks/:taskId/schema/publish`
- `POST /api/v1/tasks/:taskId/publish`
- `POST /api/v1/tasks/:taskId/dataset/import`
- `POST /api/v1/tasks/:taskId/exports`
- `GET /api/v1/tasks/:taskId/exports`
- `GET /api/v1/exports/:exportJobId`

Labeler 端：

- `GET /api/v1/marketplace/tasks`
- `POST /api/v1/tasks/:taskId/claim`
- `GET /api/v1/assignments/:assignmentId`
- `PUT /api/v1/assignments/:assignmentId/draft`
- `POST /api/v1/assignments/:assignmentId/submit`
- `POST /api/v1/assignments/:assignmentId/llm-assist`
- `GET /api/v1/me/submissions`

Reviewer 端：

- `GET /api/v1/review/queue`
- `GET /api/v1/review/submissions/:submissionId`
- `POST /api/v1/review/submissions/:submissionId/claim`
- `POST /api/v1/review/submissions/:submissionId/decision`
- `POST /api/v1/review/batch-decision`

System：

- `GET /api/v1/schema/component-registry`
- `GET /api/v1/schema-versions/:schemaVersionId`
- `POST /api/v1/files/upload-url`
- `POST /api/v1/files/:fileId/confirm`

当前 MSW `componentRegistryMock` 已覆盖部分常用类型，例如 `input.text`、`input.textarea`、`choice.radio`、`choice.select`、`choice.tags`、`show.text`、`container.section`、`llm.assist`。如果页面期望展示更多物料，需要先扩展 Mock registry 或等待真实后端 registry 返回对应类型。

## 8. 推荐页面集成顺序

1. 搭建 `apps/web` 路由和 Owner / Labeler / Reviewer 三角色 Layout。
2. 启用 MSW。
3. Owner 页面接入 `SchemaDesigner`。
4. Labeler 页面接入 `SchemaRenderer`，`mode="LABELING"`。
5. Reviewer 页面接入 `SchemaRenderer`，`mode="REVIEW_READONLY"`。
6. Reviewer 页面接入 `SchemaRenderer`，`mode="REVIEW_DIFF"`。
7. 接入 save draft / submit / review decision / export。
8. 切换到真实 API。

建议页面目录：

```txt
apps/web/src/
├── app/
│   ├── routes.tsx
│   └── App.tsx
├── features/
│   ├── owner/
│   │   ├── OwnerWorkspace.tsx
│   │   └── OwnerSchemaPage.tsx
│   ├── labeler/
│   │   ├── LabelerWorkspace.tsx
│   │   └── AssignmentPage.tsx
│   └── reviewer/
│       ├── ReviewerWorkspace.tsx
│       └── ReviewDetailPage.tsx
├── api/
│   ├── client.ts
│   ├── owner.ts
│   ├── labeler.ts
│   └── reviewer.ts
└── mocks/
```

## 9. 禁止事项

不要重新定义 contracts 类型：

```ts
// 错误：不要在页面层重新定义
interface LocalLabelHubSchema {
  root: unknown;
}
```

不要直接 mutation schema / answers：

```ts
// 错误
schema.root.children.push(newNode);
answers[fieldName] = value;

// 正确
setSchema(nextSchema);
setAnswers(nextAnswers);
```

不要在页面层手写这些逻辑：

- `visibleWhen` 判断。
- `disabledWhen` 判断。
- `required`、`minLength`、`choice.radio` 类型校验。
- ShowItem `sourcePath` 读取。
- FieldNode 收集。
- hidden 字段过滤。
- LLM outputBinding apply 规则。

应该统一交给：

- `@labelhub/schema-core`
- `@labelhub/schema-renderer`
- `@labelhub/schema-designer`

页面层的核心职责是连接 API、维护页面状态、展示业务 loading / error / empty state，并把 schema、context、answers 和回调传给组件包。
