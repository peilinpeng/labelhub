import { COMPONENT_NAMES, createRegistry } from "../ComponentRegistry";
import { FormilyCheckboxAdapter } from "./FormilyCheckboxAdapter";
import { FormilyFileAdapter } from "./FormilyFileAdapter";
import { FormilyJsonEditorAdapter } from "./FormilyJsonEditorAdapter";
import { FormilyRadioAdapter } from "./FormilyRadioAdapter";
import { FormilyRichTextAdapter } from "./FormilyRichTextAdapter";
import { FormilySelectAdapter } from "./FormilySelectAdapter";
import { FormilyTagsAdapter } from "./FormilyTagsAdapter";
import { FormilyTextInputAdapter } from "./FormilyTextInputAdapter";
import { FormilyTextareaAdapter } from "./FormilyTextareaAdapter";

export {
  FormilyCheckboxAdapter,
  FormilyFileAdapter,
  FormilyJsonEditorAdapter,
  FormilyRadioAdapter,
  FormilyRichTextAdapter,
  FormilySelectAdapter,
  FormilyTagsAdapter,
  FormilyTextInputAdapter,
  FormilyTextareaAdapter,
};

export const DEFAULT_FORMILY_REGISTRY = createRegistry({
  [COMPONENT_NAMES.TEXT]: FormilyTextInputAdapter,
  [COMPONENT_NAMES.TEXTAREA]: FormilyTextareaAdapter,
  [COMPONENT_NAMES.RICHTEXT]: FormilyRichTextAdapter,
  [COMPONENT_NAMES.RADIO]: FormilyRadioAdapter,
  [COMPONENT_NAMES.CHECKBOX]: FormilyCheckboxAdapter,
  [COMPONENT_NAMES.SELECT]: FormilySelectAdapter,
  [COMPONENT_NAMES.TAGS]: FormilyTagsAdapter,
  [COMPONENT_NAMES.FILE]: FormilyFileAdapter,
  [COMPONENT_NAMES.JSON_EDITOR]: FormilyJsonEditorAdapter,
});
