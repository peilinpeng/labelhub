import type { NodeType, ServerComponentRegistryItem, ValidationRuleType } from "@labelhub/contracts";

type RegistrySeed = Omit<ServerComponentRegistryItem, "normalizer" | "validators" | "allowedValidationRules"> & {
  allowedValidationRules?: ValidationRuleType[];
  validators?: string[];
};

const textRules: ValidationRuleType[] = ["required", "minLength", "maxLength", "regex"];
const choiceRules: ValidationRuleType[] = ["required", "minItems", "maxItems"];
const fileRules: ValidationRuleType[] = ["required", "file"];

function item(seed: RegistrySeed): ServerComponentRegistryItem {
  return {
    normalizer: `web.local.${seed.type}.normalize`,
    validators: seed.validators ?? [],
    allowedValidationRules: seed.allowedValidationRules ?? [],
    ...seed,
  };
}

export const localServerComponentRegistry: ServerComponentRegistryItem[] = [
  item({
    type: "show.text",
    category: "SHOW",
    valueKind: "NONE",
    exportValueType: "TEXT",
    defaultSubmitEnabled: false,
    defaultExportEnabled: false,
    defaultAiReviewEnabled: false,
  }),
  item({
    type: "show.richtext",
    category: "SHOW",
    valueKind: "NONE",
    exportValueType: "TEXT",
    defaultSubmitEnabled: false,
    defaultExportEnabled: false,
    defaultAiReviewEnabled: false,
  }),
  item({
    type: "show.image",
    category: "SHOW",
    valueKind: "NONE",
    exportValueType: "FILE_URLS",
    defaultSubmitEnabled: false,
    defaultExportEnabled: false,
    defaultAiReviewEnabled: false,
  }),
  item({
    type: "input.text",
    category: "INPUT",
    valueKind: "STRING",
    exportValueType: "TEXT",
    allowedValidationRules: textRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "input.textarea",
    category: "INPUT",
    valueKind: "STRING",
    exportValueType: "TEXT",
    allowedValidationRules: textRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "input.richtext",
    category: "INPUT",
    valueKind: "RICH_TEXT",
    exportValueType: "TEXT",
    allowedValidationRules: textRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "choice.radio",
    category: "CHOICE",
    valueKind: "STRING",
    exportValueType: "TEXT",
    allowedValidationRules: choiceRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "choice.checkbox",
    category: "CHOICE",
    valueKind: "STRING_ARRAY",
    exportValueType: "JSON",
    allowedValidationRules: choiceRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "choice.select",
    category: "CHOICE",
    valueKind: "STRING",
    exportValueType: "TEXT",
    allowedValidationRules: choiceRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "choice.tags",
    category: "CHOICE",
    valueKind: "STRING_ARRAY",
    exportValueType: "JSON",
    allowedValidationRules: choiceRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "upload.file",
    category: "UPLOAD",
    valueKind: "FILE_ARRAY",
    exportValueType: "FILE_URLS",
    allowedValidationRules: fileRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: false,
  }),
  item({
    type: "upload.image",
    category: "UPLOAD",
    valueKind: "FILE_ARRAY",
    exportValueType: "FILE_URLS",
    allowedValidationRules: fileRules,
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "data.json",
    category: "DATA",
    valueKind: "JSON",
    exportValueType: "JSON",
    allowedValidationRules: ["jsonSchema"],
    defaultSubmitEnabled: true,
    defaultExportEnabled: true,
    defaultAiReviewEnabled: true,
  }),
  item({
    type: "llm.assist",
    category: "AI",
    valueKind: "NONE",
    exportValueType: "JSON",
    defaultSubmitEnabled: false,
    defaultExportEnabled: false,
    defaultAiReviewEnabled: false,
  }),
  ...(["container.section", "container.group", "container.tabs"] as NodeType[]).map((type) =>
    item({
      type,
      category: "LAYOUT",
      valueKind: "NONE",
      exportValueType: "JSON",
      defaultSubmitEnabled: false,
      defaultExportEnabled: false,
      defaultAiReviewEnabled: false,
    }),
  ),
];
