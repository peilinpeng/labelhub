import type { SchemaValidationError, SchemaValidationResult } from "@labelhub/contracts";

export interface ValidationPanelProps {
  validationResult: SchemaValidationResult;
  localErrors: SchemaValidationError[];
}

export function ValidationPanel({ validationResult, localErrors }: ValidationPanelProps) {
  const errors = [...validationResult.errors, ...localErrors];

  return (
    <section aria-label="模板检查" className="schema-designer-panel schema-designer-validation">
      <div className="schema-designer-panel__header">
        <div>
          <h2>模板检查</h2>
          <p>本地结构检查</p>
        </div>
        <span>{errors.length === 0 ? "无错误" : errors.length}</span>
      </div>
      {errors.length === 0 ? <p className="schema-designer-valid">当前模板结构无错误。</p> : null}
      {errors.length > 0 ? (
        <ul className="schema-designer-error-list">
          {errors.map((error, index) => (
            <li key={`${error.code}-${error.nodeId ?? "schema"}-${error.path}-${index}`}>
              <span>{error.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
