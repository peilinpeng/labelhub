import type { Role } from "../../app/routes";
import { useSchemaDraftController } from "./schema-draft/useSchemaDraftController";

/** Stable façade retained for every Owner designer consumer. */
export function useSchemaDraft(role: Role) {
  return useSchemaDraftController(role);
}
