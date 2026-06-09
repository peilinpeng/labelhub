"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const contract_guards_1 = require("../utils/contract-guards");
(0, node_test_1.describe)("导出契约", () => {
    (0, node_test_1.test)("ExportColumn.sourcePath 必须使用允许命名空间", () => {
        (0, strict_1.equal)((0, contract_guards_1.isExportColumnPathValid)({ sourcePath: "$.answers.newsCategory" }), true);
        (0, strict_1.equal)((0, contract_guards_1.isExportColumnPathValid)({ sourcePath: "$.sourcePayload.title" }), false);
    });
    (0, node_test_1.test)("CSV / EXCEL 对象值必须配置 transform", () => {
        (0, strict_1.equal)((0, contract_guards_1.isTabularObjectValueTransformValid)("CSV", { a: 1 }, {}), false);
        (0, strict_1.equal)((0, contract_guards_1.isTabularObjectValueTransformValid)("EXCEL", { a: 1 }, { transform: { type: "JSON_STRINGIFY" } }), true);
    });
    (0, node_test_1.test)("默认只导出 ACCEPTED submission", () => {
        (0, strict_1.equal)((0, contract_guards_1.isDefaultExportEligible)({ status: "ACCEPTED" }), true);
        (0, strict_1.equal)((0, contract_guards_1.isDefaultExportEligible)({ status: "AI_PASSED" }), false);
    });
    (0, node_test_1.test)("PATCHED_ANSWERS 未显式允许时应被拒绝", () => {
        const mapping = {
            schemaVersionId: "sv_1",
            format: "JSONL",
            answerSource: "PATCHED_ANSWERS",
            includeReviewRecords: true,
            columns: [{ header: "类别", sourcePath: "$.answers.newsCategory" }],
        };
        (0, strict_1.equal)((0, contract_guards_1.usesPatchedAnswersExplicitly)(mapping), false);
        (0, strict_1.equal)((0, contract_guards_1.isExportAnswerSourceAllowed)(mapping), false);
        (0, strict_1.equal)((0, contract_guards_1.isExportAnswerSourceAllowed)({ ...mapping, allowPatchedAnswers: true }), true);
    });
});
(0, node_test_1.describe)("文件契约", () => {
    (0, node_test_1.test)("File upload lifecycle 使用 PENDING -> UPLOADING -> READY", () => {
        const pendingFile = fileObject("file_upload_1", "USER", "usr_1", "DATASET_IMPORT", "PENDING");
        const readyFile = fileObject("file_upload_2", "USER", "usr_1", "DATASET_IMPORT", "READY");
        (0, strict_1.equal)((0, contract_guards_1.isCreateUploadUrlResult)(pendingFile), true);
        (0, strict_1.equal)((0, contract_guards_1.canMarkUploadStarted)("PENDING"), true);
        (0, strict_1.equal)((0, contract_guards_1.canConfirmUpload)("PENDING"), true);
        (0, strict_1.equal)((0, contract_guards_1.canConfirmUpload)("UPLOADING"), true);
        (0, strict_1.equal)((0, contract_guards_1.isCreateUploadUrlResult)(readyFile), false);
        (0, strict_1.equal)((0, contract_guards_1.fileUploadTransitionAuditAction)("createUploadUrl"), "FILE_UPLOAD_URL_CREATED");
        (0, strict_1.equal)((0, contract_guards_1.fileUploadTransitionAuditAction)("confirmUpload"), "FILE_CONFIRMED");
    });
    (0, node_test_1.test)("failUpload 生命周期 PENDING / UPLOADING -> FAILED", () => {
        (0, strict_1.equal)((0, contract_guards_1.canFailUpload)("PENDING"), true);
        (0, strict_1.equal)((0, contract_guards_1.canFailUpload)("UPLOADING"), true);
        (0, strict_1.equal)((0, contract_guards_1.canFailUpload)("READY"), false);
        (0, strict_1.equal)((0, contract_guards_1.fileUploadTransitionAuditAction)("failUpload"), "FILE_UPLOAD_FAILED");
    });
    (0, node_test_1.test)("upload 字段 FileRef.fileId 必须属于当前 assignment 或当前用户", () => {
        const fileRef = {
            fileId: "file_answer_1",
            name: "answer.png",
            mimeType: "image/png",
            size: 1024,
        };
        const assignmentFile = fileObject("file_answer_1", "ASSIGNMENT", "asn_1", "ANSWER_ATTACHMENT", "READY");
        const otherFile = fileObject("file_answer_1", "ASSIGNMENT", "asn_other", "ANSWER_ATTACHMENT", "READY");
        (0, strict_1.equal)((0, contract_guards_1.canUseUploadFileRef)(fileRef, assignmentFile, "asn_1", "usr_1"), true);
        (0, strict_1.equal)((0, contract_guards_1.canUseUploadFileRef)(fileRef, otherFile, "asn_1", "usr_1"), false);
    });
    (0, node_test_1.test)("Dataset import 必须使用 READY + DATASET_IMPORT 文件", () => {
        (0, strict_1.equal)((0, contract_guards_1.canUseDatasetImportFile)(fileObject("file_dataset_1", "USER", "usr_1", "DATASET_IMPORT", "READY")), true);
        (0, strict_1.equal)((0, contract_guards_1.canUseDatasetImportFile)(fileObject("file_dataset_2", "USER", "usr_1", "ANSWER_ATTACHMENT", "READY")), false);
        (0, strict_1.equal)((0, contract_guards_1.canUseDatasetImportFile)(fileObject("file_dataset_3", "USER", "usr_1", "DATASET_IMPORT", "UPLOADING")), false);
    });
    (0, node_test_1.test)("Export download 必须使用 READY + EXPORT_RESULT 文件", () => {
        (0, strict_1.equal)((0, contract_guards_1.canDownloadExportFile)(fileObject("file_export_1", "EXPORT_JOB", "job_1", "EXPORT_RESULT", "READY")), true);
        (0, strict_1.equal)((0, contract_guards_1.canDownloadExportFile)(fileObject("file_export_2", "EXPORT_JOB", "job_1", "DATASET_IMPORT", "READY")), false);
        (0, strict_1.equal)((0, contract_guards_1.canDownloadExportFile)(fileObject("file_export_3", "EXPORT_JOB", "job_1", "EXPORT_RESULT", "FAILED")), false);
    });
});
function fileObject(id, ownerType, ownerId, purpose, status) {
    return {
        id,
        ownerId,
        ownerType,
        purpose,
        mimeType: "application/octet-stream",
        size: 1,
        storageKey: `${id}/object`,
        status,
        createdAt: "2026-05-24T00:00:00.000Z",
    };
}
