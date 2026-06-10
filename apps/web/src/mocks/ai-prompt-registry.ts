import type { AiAssistType } from "@labelhub/contracts";
import { hashCanonicalJson } from "./hash-utils";

export interface MockPromptSnapshot {
  promptVersionId: string;
  modelId: string;
  assistType: AiAssistType;
  promptName: string;
  promptTemplate: string;
  registryVersion: string;
}

const DEFAULT_PROMPT_REGISTRY_VERSION = "mock-prompt-registry-v1";
const DEFAULT_PROMPT_VERSION_ID = "prompt_labeler_assist_v1";
const DEFAULT_MODEL_ID = "mock-llm-v1";

export function getMockPromptSnapshot(assistType: AiAssistType): MockPromptSnapshot {
  return {
    promptVersionId: DEFAULT_PROMPT_VERSION_ID,
    modelId: DEFAULT_MODEL_ID,
    assistType,
    promptName: "标注员 AI 辅助建议",
    promptTemplate: "根据当前题目、schema 和已有 answers，生成可执行的字段改写或质量检查建议。不得输出与当前任务无关的内容。",
    registryVersion: DEFAULT_PROMPT_REGISTRY_VERSION,
  };
}

export async function hashPromptSnapshot(snapshot: MockPromptSnapshot): Promise<string | undefined> {
  return hashCanonicalJson({
    kind: "PROMPT_SNAPSHOT",
    canonicalSerializationVersion: "canonical-json-v1",
    promptVersionId: snapshot.promptVersionId,
    modelId: snapshot.modelId,
    assistType: snapshot.assistType,
    promptName: snapshot.promptName,
    promptTemplate: snapshot.promptTemplate,
    registryVersion: snapshot.registryVersion,
  });
}
