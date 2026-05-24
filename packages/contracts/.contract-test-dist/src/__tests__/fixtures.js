"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseContext = exports.baseSchema = void 0;
exports.cloneSchema = cloneSchema;
const news_quality_schema_1 = require("../../examples/news-quality.schema");
exports.baseSchema = news_quality_schema_1.newsQualitySchema;
exports.baseContext = {
    task: {
        id: "task_news_quality",
        title: "新闻质量标注",
        status: "PUBLISHED",
        activeSchemaVersionId: "sv_news_quality_1",
    },
    schema: {
        schemaId: "schema_news_quality",
        schemaVersionId: "sv_news_quality_1",
        schemaVersionNo: 1,
        contractVersion: "1.1",
    },
    item: {
        id: "item_news_1",
        externalKey: "news-1",
        sourcePayload: {
            title: "示例新闻标题",
            body: "示例新闻正文",
            source: "示例来源",
        },
    },
    answers: {
        newsCategory: "technology",
        qualityScore: "2",
        issueTags: ["unclear_fact"],
    },
    system: {
        actor: {
            id: "usr_labeler",
            role: "LABELER",
            displayName: "标注员",
        },
        role: "LABELER",
        now: "2026-05-24T00:00:00.000Z",
        timezone: "Europe/Zurich",
    },
};
function cloneSchema(schema = exports.baseSchema) {
    return JSON.parse(JSON.stringify(schema));
}
