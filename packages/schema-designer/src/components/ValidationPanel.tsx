import type { SchemaValidationError, SchemaValidationResult } from "@labelhub/contracts";

export interface ValidationPanelProps {
  validationResult: SchemaValidationResult;
  localErrors: SchemaValidationError[];
}

export function ValidationPanel({ validationResult, localErrors }: ValidationPanelProps) {
  const errors = [...validationResult.errors, ...localErrors];

  return (
    <section aria-label="Schema 校验">
      <h2>Schema 校验</h2>
      {errors.length === 0 ? <p>当前 schema 校验通过</p> : null}
      {errors.length > 0 ? (
        <ul>
          {errors.map((error, index) => (
            <li key={`${error.code}-${error.nodeId ?? "schema"}-${error.path}-${index}`}>
              <strong>{error.code}</strong>
              {error.nodeId !== undefined ? <span> nodeId: {error.nodeId}</span> : null}
              <span> path: {error.path}</span>
              <span> {error.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
