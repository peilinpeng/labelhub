"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const contract_guards_1 = require("../utils/contract-guards");
const fixtures_1 = require("./fixtures");
(0, node_test_1.describe)("Schema 不变量", () => {
    (0, node_test_1.test)("一个 schema tree 内 node.id 必须全局唯一", () => {
        const schema = (0, fixtures_1.cloneSchema)();
        const firstNode = schema.root.children[0];
        if (firstNode === undefined) {
            throw new Error("示例 schema 必须至少包含一个子节点");
        }
        schema.root.children.push({ ...firstNode });
        const violations = (0, contract_guards_1.validateSchemaInvariants)(schema);
        (0, strict_1.equal)(violations.some((item) => item.code === "NODE_ID_DUPLICATED"), true);
    });
    (0, node_test_1.test)("一个 schema version 内 FieldNode.name 必须全局唯一", () => {
        const schema = (0, fixtures_1.cloneSchema)();
        schema.root.children.push({
            id: "duplicate_field_name",
            kind: "FIELD",
            type: "input.text",
            name: "newsCategory",
            title: "重复字段",
        });
        const violations = (0, contract_guards_1.validateSchemaInvariants)(schema);
        (0, strict_1.equal)(violations.some((item) => item.code === "FIELD_NAME_DUPLICATED"), true);
    });
    (0, node_test_1.test)("ShowItem、Container、LLMAssist 默认不写入 answers", () => {
        const writableNodes = (0, contract_guards_1.collectSchemaNodes)(fixtures_1.baseSchema).filter((node) => node.kind === "FIELD");
        const nonWritableNodes = (0, contract_guards_1.collectSchemaNodes)(fixtures_1.baseSchema).filter((node) => node.kind !== "FIELD");
        (0, strict_1.ok)(writableNodes.length > 0);
        (0, strict_1.equal)(nonWritableNodes.every((node) => !("name" in node)), true);
    });
    (0, node_test_1.test)("unknown node type 返回 UNKNOWN_NODE_TYPE", () => {
        const schema = (0, fixtures_1.cloneSchema)();
        const brokenSchema = {
            ...schema,
            root: {
                ...schema.root,
                children: [
                    ...schema.root.children,
                    {
                        id: "unknown_node",
                        kind: "FIELD",
                        type: "unknown.node",
                        name: "unknownNode",
                        title: "未知节点",
                    },
                ],
            },
        };
        const violations = (0, contract_guards_1.validateSchemaInvariants)(brokenSchema);
        (0, strict_1.equal)(violations.some((item) => item.code === "UNKNOWN_NODE_TYPE"), true);
    });
    (0, node_test_1.test)("JsonPath 必须使用 RuntimeContext 命名空间", () => {
        (0, strict_1.equal)((0, contract_guards_1.isAllowedRuntimeJsonPath)("$.answers.newsCategory"), true);
        (0, strict_1.equal)((0, contract_guards_1.isAllowedRuntimeJsonPath)("$.item.sourcePayload.title"), true);
        (0, strict_1.equal)((0, contract_guards_1.isAllowedRuntimeJsonPath)("$.sourcePayload.title"), false);
        (0, strict_1.equal)((0, contract_guards_1.isAllowedRuntimeJsonPath)("$.output.summary"), false);
        (0, strict_1.equal)((0, contract_guards_1.isAllowedRuntimeJsonPath)("$.output.summary", { allowOutput: true }), true);
    });
    (0, node_test_1.test)("AI-generated schema 只能是 DRAFT", () => {
        const draft = (0, fixtures_1.cloneSchema)();
        const published = {
            ...(0, fixtures_1.cloneSchema)(),
            status: "PUBLISHED",
            schemaVersionId: "sv_news_quality_1",
            schemaVersionNo: 1,
        };
        (0, strict_1.deepEqual)((0, contract_guards_1.assertAIGeneratedSchemaDraft)(draft), []);
        (0, strict_1.equal)((0, contract_guards_1.assertAIGeneratedSchemaDraft)(published).some((item) => item.code === "SCHEMA_INVALID"), true);
    });
    (0, node_test_1.test)("published schema version 不可变", () => {
        const published = {
            ...(0, fixtures_1.cloneSchema)(),
            status: "PUBLISHED",
            schemaVersionId: "sv_news_quality_1",
            schemaVersionNo: 1,
        };
        const changed = {
            ...published,
            meta: { ...published.meta, name: "被修改的模板" },
        };
        (0, strict_1.equal)((0, contract_guards_1.assertPublishedSchemaImmutable)(published, published).length, 0);
        (0, strict_1.equal)((0, contract_guards_1.assertPublishedSchemaImmutable)(published, changed).some((item) => item.code === "SCHEMA_VERSION_IMMUTABLE"), true);
    });
});
