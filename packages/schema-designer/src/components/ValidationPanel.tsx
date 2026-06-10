import type { SchemaValidationError, SchemaValidationResult } from "@labelhub/contracts";

export interface ValidationPanelProps {
  validationResult: SchemaValidationResult;
  localErrors: SchemaValidationError[];
  onSelectNode?(nodeId: string): void;
}

export function ValidationPanel({ validationResult, localErrors, onSelectNode }: ValidationPanelProps) {
  const errors = [...validationResult.errors, ...localErrors];

  return (
    <section aria-label="模板检查" className="schema-designer-panel schema-designer-validation">
      <div className="schema-designer-panel__header">
        <div>
          <h2>模板检查</h2>
          <p>发布前完整检查</p>
        </div>
        <span>{errors.length === 0 ? "已通过" : `${errors.length} 项`}</span>
      </div>
      {errors.length === 0 ? <p className="schema-designer-valid">当前模板已通过发布前检查。</p> : null}
      {errors.length > 0 ? (
        <ul className="schema-designer-error-list">
          {errors.map((error, index) => (
            <li key={`${error.code}-${error.nodeId ?? "schema"}-${error.path}-${index}`}>
              {error.nodeId !== undefined && onSelectNode !== undefined ? (
                <button type="button" onClick={() => onSelectNode(error.nodeId as string)}>
                  {error.message}
                </button>
              ) : <span>{error.message}</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
