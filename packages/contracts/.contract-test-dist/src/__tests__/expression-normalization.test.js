"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const contract_guards_1 = require("../utils/contract-guards");
const fixtures_1 = require("./fixtures");
(0, node_test_1.describe)("表达式求值", () => {
    (0, node_test_1.test)("支持 eq / ne / in / notIn / empty / notEmpty / and / or / not", () => {
        const expressions = [
            [{ op: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 1 } }, true],
            [{ op: "ne", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } }, true],
            [{ op: "in", left: { kind: "literal", value: "a" }, right: [{ kind: "literal", value: "a" }] }, true],
            [{ op: "notIn", left: { kind: "literal", value: "b" }, right: [{ kind: "literal", value: "a" }] }, true],
            [{ op: "empty", value: { kind: "literal", value: [] } }, true],
            [{ op: "notEmpty", value: { kind: "literal", value: "x" } }, true],
            [
                {
                    op: "and",
                    items: [
                        { op: "eq", left: { kind: "literal", value: true }, right: { kind: "literal", value: true } },
                        { op: "not", item: { op: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } } },
                    ],
                },
                true,
            ],
            [
                {
                    op: "or",
                    items: [
                        { op: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } },
                        { op: "eq", left: { kind: "literal", value: 3 }, right: { kind: "literal", value: 3 } },
                    ],
                },
                true,
            ],
        ];
        for (const [expression, expected] of expressions) {
            (0, strict_1.equal)((0, contract_guards_1.evaluateExpression)(expression, fixtures_1.baseContext), expected);
        }
    });
    (0, node_test_1.test)("visibleWhen 可以读取 $.answers 与 $.item.sourcePayload", () => {
        (0, strict_1.equal)((0, contract_guards_1.evaluateExpression)({ op: "eq", left: { kind: "path", path: "$.answers.qualityScore" }, right: { kind: "literal", value: "2" } }, fixtures_1.baseContext), true);
        (0, strict_1.equal)((0, contract_guards_1.evaluateExpression)({ op: "notEmpty", value: { kind: "path", path: "$.item.sourcePayload.title" } }, fixtures_1.baseContext), true);
    });
    (0, node_test_1.test)("hidden required 字段默认不阻止提交", () => {
        const schema = schemaWithHiddenRequired(false);
        const errors = (0, contract_guards_1.validateRequiredFields)(schema, { newsCategory: "technology", qualityScore: "5" }, fixtures_1.baseContext);
        (0, strict_1.deepEqual)(errors, []);
    });
    (0, node_test_1.test)("validateWhenHidden 为 true 时，隐藏字段仍执行校验", () => {
        const schema = schemaWithHiddenRequired(true);
        const errors = (0, contract_guards_1.validateRequiredFields)(schema, { newsCategory: "technology", qualityScore: "5" }, fixtures_1.baseContext);
        (0, strict_1.equal)(errors.some((item) => item.fieldName === "hiddenRequired"), true);
    });
});
(0, node_test_1.describe)("答案归一化", () => {
    (0, node_test_1.test)("answers 只能包含可提交 FieldNode", () => {
        const { answers } = (0, contract_guards_1.normalizeAnswers)((0, fixtures_1.cloneSchema)(), {
            newsCategory: "technology",
            qualityScore: "5",
            show_title: "不应提交",
            ai_quality_helper: "不应提交",
        }, fixtures_1.baseContext);
        (0, strict_1.deepEqual)(Object.keys(answers).sort(), ["newsCategory", "qualityScore"]);
    });
    (0, node_test_1.test)("hidden 字段默认移除", () => {
        const schema = schemaWithHiddenField(false);
        const { answers } = (0, contract_guards_1.normalizeAnswers)(schema, { hiddenText: "已有值" }, fixtures_1.baseContext);
        (0, strict_1.deepEqual)(answers, {});
    });
    (0, node_test_1.test)("preserveWhenHidden 为 true 时保留已有值", () => {
        const schema = schemaWithHiddenField(true);
        const { answers } = (0, contract_guards_1.normalizeAnswers)(schema, { hiddenText: "已有值" }, fixtures_1.baseContext);
        (0, strict_1.deepEqual)(answers, { hiddenText: "已有值" });
    });
    (0, node_test_1.test)("choice.radio 只接受 string", () => {
        const { errors } = (0, contract_guards_1.normalizeAnswers)((0, fixtures_1.cloneSchema)(), { newsCategory: ["technology"] }, fixtures_1.baseContext);
        (0, strict_1.equal)(errors.some((item) => item.fieldName === "newsCategory"), true);
    });
    (0, node_test_1.test)("choice.checkbox 只接受 string[]", () => {
        const schema = (0, fixtures_1.cloneSchema)();
        schema.root.children.push({
            id: "checkbox_field",
            kind: "FIELD",
            type: "choice.checkbox",
            name: "checkboxField",
            title: "多选字段",
            options: [
                { label: "选项 A", value: "a" },
                { label: "选项 B", value: "b" },
            ],
        });
        const { errors } = (0, contract_guards_1.normalizeAnswers)(schema, { checkboxField: "a" }, fixtures_1.baseContext);
        (0, strict_1.equal)(errors.some((item) => item.fieldName === "checkboxField"), true);
    });
    (0, node_test_1.test)("data.json 必须可 JSON 序列化", () => {
        const schema = (0, fixtures_1.cloneSchema)();
        schema.root.children.push({
            id: "json_payload",
            kind: "FIELD",
            type: "data.json",
            name: "jsonPayload",
            title: "结构化数据",
        });
        const circular = {};
        circular.self = circular;
        const { errors } = (0, contract_guards_1.normalizeAnswers)(schema, { jsonPayload: circular }, fixtures_1.baseContext);
        (0, strict_1.equal)(errors.some((item) => item.fieldName === "jsonPayload"), true);
    });
});
function schemaWithHiddenRequired(validateWhenHidden) {
    const schema = (0, fixtures_1.cloneSchema)();
    schema.root.children.push({
        id: "hidden_required",
        kind: "FIELD",
        type: "input.text",
        name: "hiddenRequired",
        title: "隐藏必填",
        hidden: true,
        validateWhenHidden,
        required: true,
    });
    return schema;
}
function schemaWithHiddenField(preserveWhenHidden) {
    const schema = (0, fixtures_1.cloneSchema)();
    schema.root.children.push({
        id: "hidden_text",
        kind: "FIELD",
        type: "input.text",
        name: "hiddenText",
        title: "隐藏字段",
        hidden: true,
        preserveWhenHidden,
    });
    return schema;
}
