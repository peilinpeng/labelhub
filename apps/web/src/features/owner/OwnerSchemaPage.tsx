import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { fetchServerRegistry } from "../../api/owner";
import { Badge, Card } from "../../ui/primitives";
import type { ServerComponentRegistryItem } from "@labelhub/contracts";

interface OwnerSchemaPageProps {
  role: Role;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>([]);
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

  if (loading) {
    return <Card className="state-panel">加载模板物料中...</Card>;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">模板搭建器</h2>
          <p className="page-subtitle">Schema 与渲染解释由组件包负责，页面只托管设计器和业务操作。</p>
        </div>
        <div className="page-actions">
          <Badge tone="primary">{role}</Badge>
          <Badge tone="success">物料 {serverRegistry.length}</Badge>
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
        </div>
      </div>

      <Card className="designer-frame">
        <div className="schema-placeholder">
          <Badge tone="primary">Task {taskId ?? "unknown"}</Badge>
          <h3 className="schema-placeholder__title">SchemaDesigner integration placeholder</h3>
          <p className="schema-placeholder__copy">
            Waiting for @labelhub/schema-core package exports/build to be fixed
          </p>
          <div className="inset-well">
            <pre className="source-json">
              {JSON.stringify(
                {
                  status: "temporarily_disabled",
                  reason: "schema-designer imports @labelhub/schema-core internally",
                  registryItemsLoaded: serverRegistry.length,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
