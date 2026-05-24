# LabelHub 共享契约类型包

这是 LabelHub 前端、后端、AI Agent、Mock 和测试共同引用的唯一契约类型来源。

## 使用原则

- 业务模块不得重新定义契约类型。
- 类型名、接口名、枚举值、API 路径与 `labelhub-architecture-contract.md v1.1` 保持一致。
- 灵活数据统一使用 `unknown`，禁止使用 `any`。
- 本 package 只包含类型、契约和示例 schema，不包含 UI、后端 service 或数据库实现。

## 文件划分

- `src/global.ts`：全局 ID、角色、运行时上下文和 JsonPath。
- `src/schema.ts`：动态 schema、节点、字段、表达式、校验、Designer 和 Renderer 契约。
- `src/registry.ts`：服务端组件注册表、前端组件注册表、自定义校验规则注册表。
- `src/workflow.ts`：任务、题目、分配、草稿、提交状态模型。
- `src/review.ts`：人工审核、终审、AI Review Agent、LLM 调用日志。
- `src/export.ts`：导出映射和导出任务。
- `src/file.ts`：文件引用、文件对象、上传确认契约。
- `src/api.ts`：REST API request 和 response。
- `src/errors.ts`：稳定错误码和 API 错误结构。
- `src/audit.ts`：审计动作和审计日志。
- `examples/news-quality.schema.ts`：符合 v1.1 契约的新闻质量标注示例 schema。

## 类型检查

```bash
npm run typecheck
```

## 契约测试

测试会先把 TypeScript 测试文件编译到 `./.contract-test-dist`，并在该目录写入局部 CommonJS 标记，再通过 Node test runner 执行编译后的测试文件。

```bash
npm run test
```

清理测试编译产物：

```bash
npm run clean:test
```
