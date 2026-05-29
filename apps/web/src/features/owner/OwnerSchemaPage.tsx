import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { fetchServerRegistry } from "../../api/owner";
import { Badge, Button, Card } from "../../ui/primitives";
import type { ServerComponentRegistryItem } from "@labelhub/contracts";

interface OwnerSchemaPageProps {
  role: Role;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const fieldTypes = [
    { name: "单行文本", code: "TXT", description: "短文本、标题、摘要" },
    { name: "多行文本", code: "LONG", description: "理由、说明、长答案" },
    { name: "单选", code: "ONE", description: "互斥选项判断" },
    { name: "多选", code: "MULTI", description: "多标签分类" },
    { name: "标签选择", code: "TAG", description: "标准化标签集合" },
    { name: "文件上传", code: "FILE", description: "附件或证据材料" },
    { name: "图片上传", code: "IMG", description: "图片证据采集" },
    { name: "LLM 辅助", code: "LLM", description: "模型建议与生成" },
    { name: "ShowItem", code: "ITEM", description: "展示待标注样本" },
  ];
  const publishChecks = [
    { label: "Schema 合法", done: false },
    { label: "字段 name 不重复", done: false },
    { label: "已配置 ShowItem", done: true },
    { label: "已配置审核规则", done: true },
    { label: "可进入标注台预览", done: false },
  ];

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
    <div className="page-stack schema-workbench-page">
      <div className="page-header schema-workbench-header">
        <div>
          <Badge tone="primary">Owner Template</Badge>
          <h2 className="page-title">模板配置</h2>
          <p className="page-subtitle">为当前任务配置动态标注 Schema，并预览标注员填写效果</p>
        </div>
        <div className="schema-workbench-actions">
          <Button type="button">保存草稿</Button>
          <Button type="button">预览标注台</Button>
          <Button type="button" tone="primary">发布任务</Button>
        </div>
      </div>

      <div className="schema-workbench-layout">
        <Card className="schema-side-panel schema-component-library">
          <div className="schema-panel-heading">
            <div>
              <h3>组件库</h3>
              <p>选择字段类型组成标注模板</p>
            </div>
            <Badge tone="success">{serverRegistry.length} 物料</Badge>
          </div>
          <div className="schema-field-list">
            {fieldTypes.map((field) => (
              <button className="schema-field-item" key={field.name} type="button">
                <span className="schema-field-item__icon">{field.code}</span>
                <span>
                  <strong>{field.name}</strong>
                  <small>{field.description}</small>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="schema-designer-shell">
          <div className="schema-canvas-header">
            <div>
              <Badge tone="primary">Task {taskId ?? "unknown"}</Badge>
              <h3>新闻质量标注 Schema</h3>
              <p>SchemaDesigner integration placeholder</p>
            </div>
            <Link to={RoutePath.OWNER_TASKS} className="lh-button">
              返回任务
            </Link>
          </div>

          <div className="schema-canvas">
            <div className="schema-canvas-toolbar">
              <span>Canvas</span>
              <span>Draft version</span>
            </div>
            <div className="schema-placeholder schema-placeholder--workbench">
              <div className="schema-placeholder__mark">SD</div>
              <h3 className="schema-placeholder__title">SchemaDesigner integration placeholder</h3>
              <p className="schema-placeholder__copy">
                Waiting for @labelhub/schema-core package exports/build to be fixed
              </p>
              <div className="schema-designer-note">
                等待 @labelhub/schema-core exports/build 修复后接入真实 SchemaDesigner。当前页面只负责承载设计器，不实现 schema traversal、visibleWhen、validation 或 normalization。
              </div>
            </div>
          </div>
        </Card>

        <Card className="schema-side-panel schema-inspector-panel">
          <div className="schema-panel-heading">
            <div>
              <h3>属性配置</h3>
              <p>当前选中字段与发布检查</p>
            </div>
            <Badge tone="warning">{role}</Badge>
          </div>

          <div className="schema-inspector-section">
            <div className="schema-inspector-title">当前选中字段</div>
            <div className="schema-property-grid">
              <span>字段名称</span>
              <strong>article_quality</strong>
              <span>字段类型</span>
              <strong>单选</strong>
              <span>是否必填</span>
              <strong>是</strong>
              <span>校验状态</span>
              <Badge tone="warning">待校验</Badge>
              <span>条件显示</span>
              <strong>未配置</strong>
            </div>
          </div>

          <div className="schema-inspector-section">
            <div className="schema-inspector-title">发布检查清单</div>
            <div className="schema-check-list">
              {publishChecks.map((item) => (
                <div className="schema-check-item" key={item.label}>
                  <span className={item.done ? "schema-check-dot schema-check-dot--done" : "schema-check-dot"} />
                  <strong>{item.label}</strong>
                  <Badge tone={item.done ? "success" : "warning"}>{item.done ? "已完成" : "待处理"}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
