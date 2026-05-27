import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { fetchServerRegistry, validateSchema } from "../../api/owner";
import { SchemaDesigner } from "@labelhub/schema-designer";
import { createNewsQualitySchema } from "@labelhub/schema-core";
import type {
  LabelHubRuntimeContext,
  LabelHubSchema,
  SchemaValidationResult,
  ServerComponentRegistryItem,
} from "@labelhub/contracts";

interface OwnerSchemaPageProps {
  role: Role;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [schema, setSchema] = useState<LabelHubSchema>(() => createNewsQualitySchema());
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>([]);
  const [validation, setValidation] = useState<SchemaValidationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const registry = await fetchServerRegistry();
        setServerRegistry(registry);
      } catch (e) {
        console.error("Failed to fetch registry:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sampleContext: LabelHubRuntimeContext = {
    task: {
      id: taskId ? (taskId as LabelHubRuntimeContext["task"]["id"]) : "task_demo",
      title: "新闻质量标注任务",
      status: "DRAFT",
      activeSchemaVersionId: "sv_preview",
    },
    schema: {
      schemaId: "schema_demo",
      schemaVersionId: "sv_preview",
      schemaVersionNo: 1,
      contractVersion: "1.1",
    },
    item: {
      id: "item_demo",
      sourcePayload: {
        title: "示例新闻标题",
        body: "这是一段用于预览的新闻正文。",
      },
    },
    answers: {},
    system: {
      actor: {
        id: "usr_owner_demo",
        role: "OWNER",
        displayName: "Owner",
      },
      role: "OWNER",
      now: new Date().toISOString(),
    },
  };

  const handleValidate = async (nextSchema: LabelHubSchema): Promise<SchemaValidationResult> => {
    const result = await validateSchema(nextSchema);
    setValidation(result);
    return result;
  };

  const handlePublishRequest = async (currentSchema: LabelHubSchema) => {
    console.log("准备发布 schema", currentSchema);
  };

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to={RoutePath.OWNER_TASKS} style={styles.backLink}>← 返回</Link>
          <h2 style={styles.title}>模板设计器</h2>
          <span style={styles.role}>{role}</span>
        </div>
      </div>

      <div style={styles.content}>
        <SchemaDesigner
          schema={schema}
          onSchemaChange={setSchema}
          readonly={false}
          serverRegistry={serverRegistry}
          sampleContext={sampleContext}
          onValidate={handleValidate}
          onPublishRequest={handlePublishRequest}
        />

        {validation !== null && !validation.valid && (
          <section style={styles.validationError}>
            <h3>当前 schema 存在问题</h3>
            <pre style={styles.errorPre}>{JSON.stringify(validation.errors, null, 2)}</pre>
          </section>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "20px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  backLink: {
    color: "#4a69bd",
    textDecoration: "none",
    fontSize: "0.9rem",
  },
  title: {
    fontSize: "1.8rem",
    color: "#1a1a2e",
  },
  role: {
    backgroundColor: "#4a69bd",
    color: "white",
    padding: "5px 15px",
    borderRadius: "20px",
    fontSize: "0.9rem",
  },
  content: {
    backgroundColor: "white",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    padding: "20px",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "200px",
    fontSize: "1.2rem",
    color: "#666",
  },
  validationError: {
    marginTop: "20px",
    padding: "20px",
    backgroundColor: "#ffebee",
    borderRadius: "8px",
  },
  errorPre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    color: "#c62828",
    fontSize: "0.9rem",
    maxHeight: "300px",
    overflowY: "auto",
  },
};