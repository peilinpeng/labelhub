import { COMPONENT_NAMES, createRegistry } from "../ComponentRegistry";
import { FormilyCheckboxAdapter } from "./FormilyCheckboxAdapter";
import { FormilyJsonEditorAdapter } from "./FormilyJsonEditorAdapter";
import { FormilyRadioAdapter } from "./FormilyRadioAdapter";
import { FormilySelectAdapter } from "./FormilySelectAdapter";
import { FormilyTagsAdapter } from "./FormilyTagsAdapter";
import { FormilyTextInputAdapter } from "./FormilyTextInputAdapter";
import { FormilyTextareaAdapter } from "./FormilyTextareaAdapter";

export {
  FormilyCheckboxAdapter,
  FormilyJsonEditorAdapter,
  FormilyRadioAdapter,
  FormilySelectAdapter,
  FormilyTagsAdapter,
  FormilyTextInputAdapter,
  FormilyTextareaAdapter,
};

export const DEFAULT_FORMILY_REGISTRY = createRegistry({
  [COMPONENT_NAMES.TEXT]: FormilyTextInputAdapter,
  [COMPONENT_NAMES.TEXTAREA]: FormilyTextareaAdapter,
  [COMPONENT_NAMES.RADIO]: FormilyRadioAdapter,
  [COMPONENT_NAMES.CHECKBOX]: FormilyCheckboxAdapter,
  [COMPONENT_NAMES.SELECT]: FormilySelectAdapter,
  [COMPONENT_NAMES.TAGS]: FormilyTagsAdapter,
  [COMPONENT_NAMES.JSON_EDITOR]: FormilyJsonEditorAdapter,
});
