# LabelHub Demo Guide

## Owner mock demo 启动

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

注意：普通 `npm run dev` 不会启用 MSW，会把 `/api` 请求代理到 `localhost:3000`。

## Owner Schema Governance demo

### Demo A：安全发布

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_safe_publish/designer
```

预期结果：

- 发布前检查允许发布。
- 确认发布后成功跳转。
- Audit Timeline 显示 compatibility checked、publish requested、schema version published。

### Demo B：Breaking Change 阻断

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_breaking_change/designer
```

预期结果：

- 发布前检查显示 `FIELD_REMOVED`。
- 确认发布按钮禁用。
- Audit Timeline 显示 compatibility checked、publish blocked。

### Demo C：Deprecated 字段

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_deprecation/designer
```

预期结果：

- 发布前检查显示 deprecation warning。
- 勾选确认后可以发布。
- Audit Timeline 显示 compatibility checked、deprecation warning generated、publish requested、schema version published。

### Demo D：Migration Required

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_migration_required/designer
```

预期结果：

- 发布前检查显示 `FIELD_TYPE_CAST_REQUIRED`。
- 不需要后端 migration API。
- 不需要 mapping editor。
- Audit Timeline 至少显示 compatibility checked。
