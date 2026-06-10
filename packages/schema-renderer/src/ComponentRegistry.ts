import type { ComponentType } from "react";

/**
 * FE-2 的 connect() 包裝後，adapter 組件暴露給 Formily 的最小接口。
 * FE-1 階段此類型僅作為約定，尚無 adapter 實現。
 */
export interface FieldComponentProps {
  value?: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  readOnly?: boolean;
  [key: string]: unknown;
}

export type FieldComponent = ComponentType<FieldComponentProps>;

/**
 * 直接傳遞給 Formily createSchemaField({ components: registry.entries }) 的映射表。
 * noUncheckedIndexedAccess 下按字符串取值返回 FieldComponent | undefined，屬預期行為。
 */
export type ComponentRegistryEntries = Record<string, FieldComponent>;

export interface ComponentRegistry {
  readonly entries: Readonly<ComponentRegistryEntries>;
}

/**
 * 創建一個不可變的組件注冊表。
 * FE-1 可傳空對象（暫無 adapter），FE-2 傳入所有 adapter 後完整激活。
 */
export function createRegistry(
  entries: ComponentRegistryEntries = {},
): ComponentRegistry {
  return { entries: Object.freeze({ ...entries }) };
}

/**
 * Formily schema x-component 字段使用的規範名稱常量。
 * FE-2 adapter 文件名與此對齊，FE-5 compiler 輸出引用此表。
 */
export const COMPONENT_NAMES = {
  TEXT: "TextInput",
  TEXTAREA: "TextareaInput",
  RICHTEXT: "RichTextInput",
  RADIO: "RadioInput",
  CHECKBOX: "CheckboxInput",
  SELECT: "SelectInput",
  TAGS: "TagsInput",
  FILE: "FileInput",
  JSON_EDITOR: "JsonEditorInput",
} as const;

export type ComponentName = (typeof COMPONENT_NAMES)[keyof typeof COMPONENT_NAMES];
