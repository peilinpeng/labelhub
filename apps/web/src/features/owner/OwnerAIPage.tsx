import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { AIReviewPanel, Badge, Button, Card, Select } from "../../ui/primitives";

interface OwnerAIPageProps {
  role: Role;
}

export default function OwnerAIPage({ role }: OwnerAIPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("gpt-4o");
  const [threshold, setThreshold] = useState(0.8);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">AI 预审规则</h2>
          <p className="page-subtitle">当前角色：{role}。此页是规则配置占位，真实 LLM 节点仍由 SchemaDesigner 管理。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS} className="lh-button">
          返回任务列表
        </Link>
      </div>

      <div className="split-layout">
        <Card className="soft-panel">
          <div className="form-stack">
            <div className="page-actions">
              <Badge tone={enabled ? "success" : "warning"}>{enabled ? "已开启" : "未开启"}</Badge>
              <Badge tone="primary">任务 {taskId}</Badge>
            </div>
            <Button tone={enabled ? "success" : "primary"} onClick={() => setEnabled((value) => !value)}>
              {enabled ? "关闭 AI 预审" : "开启 AI 预审"}
            </Button>
            <label className="field-label">
              模型
              <Select value={model} onChange={(event) => setModel(event.target.value)} disabled={!enabled}>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4">GPT-4</option>
                <option value="doubao-pro-32k">doubao-pro-32k</option>
              </Select>
            </label>
            <label className="field-label">
              置信度阈值：{threshold}
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={threshold}
                onChange={(event) => setThreshold(parseFloat(event.target.value))}
                disabled={!enabled}
              />
            </label>
            <Button tone="primary">保存配置</Button>
          </div>
        </Card>

        <AIReviewPanel title="规则预览" badge={<Badge tone="primary">电商相关性 v2</Badge>}>
          <div className="form-stack">
            <p>维度：相关性、准确性、格式合规、安全性。综合分低于阈值时建议打回或转人工。</p>
            <div className="inset-well">
              <pre className="source-json">{`outputBindings:
  summary -> $.answers.rewriteSuggestion
verdict:
  pass | return | human_review`}</pre>
            </div>
          </div>
        </AIReviewPanel>
      </div>
    </div>
  );
}
