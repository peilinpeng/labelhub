import { describe, test } from "node:test";
import { equal } from "node:assert/strict";
import type { ExportMapping, FileObject, FileRef } from "../index";
import {
  canDownloadExportFile,
  canUseDatasetImportFile,
  canUseUploadFileRef,
  isDefaultExportEligible,
  isExportColumnPathValid,
  isTabularObjectValueTransformValid,
  usesPatchedAnswersExplicitly,
} from "../utils/contract-guards";

describe("导出契约", () => {
  test("ExportColumn.sourcePath 必须使用允许命名空间", () => {
    equal(isExportColumnPathValid({ sourcePath: "$.answers.newsCategory" }), true);
    equal(isExportColumnPathValid({ sourcePath: "$.sourcePayload.title" }), false);
  });

  test("CSV / EXCEL 对象值必须配置 transform", () => {
    equal(isTabularObjectValueTransformValid("CSV", { a: 1 }, {}), false);
    equal(isTabularObjectValueTransformValid("EXCEL", { a: 1 }, { transform: { type: "JSON_STRINGIFY" } }), true);
  });

  test("默认只导出 ACCEPTED submission", () => {
    equal(isDefaultExportEligible({ status: "ACCEPTED" }), true);
    equal(isDefaultExportEligible({ status: "AI_PASSED" }), false);
  });

  test("PATCHED_ANSWERS 必须显式配置", () => {
    const mapping: ExportMapping = {
      schemaVersionId: "sv_1",
      format: "JSONL",
      answerSource: "PATCHED_ANSWERS",
      includeReviewRecords: true,
      columns: [{ header: "类别", sourcePath: "$.answers.newsCategory" }],
    };

    equal(usesPatchedAnswersExplicitly(mapping), true);
  });
});

describe("文件契约", () => {
  test("upload 字段 FileRef.fileId 必须属于当前 assignment 或当前用户", () => {
    const fileRef: FileRef = {
      fileId: "file_answer_1",
      name: "answer.png",
      mimeType: "image/png",
      size: 1024,
    };
    const assignmentFile = fileObject("file_answer_1", "ASSIGNMENT", "asn_1", "ANSWER_ATTACHMENT", "READY");
    const otherFile = fileObject("file_answer_1", "ASSIGNMENT", "asn_other", "ANSWER_ATTACHMENT", "READY");

    equal(canUseUploadFileRef(fileRef, assignmentFile, "asn_1", "usr_1"), true);
    equal(canUseUploadFileRef(fileRef, otherFile, "asn_1", "usr_1"), false);
  });

  test("Dataset import 必须使用 READY + DATASET_IMPORT 文件", () => {
    equal(canUseDatasetImportFile(fileObject("file_dataset_1", "USER", "usr_1", "DATASET_IMPORT", "READY")), true);
    equal(canUseDatasetImportFile(fileObject("file_dataset_2", "USER", "usr_1", "ANSWER_ATTACHMENT", "READY")), false);
    equal(canUseDatasetImportFile(fileObject("file_dataset_3", "USER", "usr_1", "DATASET_IMPORT", "UPLOADING")), false);
  });

  test("Export download 必须使用 READY + EXPORT_RESULT 文件", () => {
    equal(canDownloadExportFile(fileObject("file_export_1", "EXPORT_JOB", "job_1", "EXPORT_RESULT", "READY")), true);
    equal(canDownloadExportFile(fileObject("file_export_2", "EXPORT_JOB", "job_1", "DATASET_IMPORT", "READY")), false);
    equal(canDownloadExportFile(fileObject("file_export_3", "EXPORT_JOB", "job_1", "EXPORT_RESULT", "FAILED")), false);
  });
});

function fileObject(
  id: FileObject["id"],
  ownerType: FileObject["ownerType"],
  ownerId: FileObject["ownerId"],
  purpose: FileObject["purpose"],
  status: FileObject["status"],
): FileObject {
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
