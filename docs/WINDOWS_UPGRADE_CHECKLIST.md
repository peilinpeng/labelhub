# Windows 保留数据升级与接续清单

> 整理日期：2026-11-09（Europe/Zurich）。适用于已有数据的 Windows 本地环境。
> 2026-11-09 已在当前 Windows 主机执行，记录见第 7 节及 [项目状态](PROJECT_STATUS.md)。复用于其他环境时须重新逐项核验，不能沿用本次结果。

本清单以 PR #164 的业务代码基线 `a1013528fa135f482173e5d24b49599c84963559` 为依据，
其状态记录已通过 PR #165 合入主线 `ad59823022cc0f0c9c88006aecacd6ca8045e0d5`。
执行时获取最新 `main` 并记录实际 SHA，不固定回退到上述历史提交。

所有命令从仓库根目录、PowerShell 中执行。逐条执行并检查 `$LASTEXITCODE`，非零立即停止；
PowerShell 默认不会因原生命令失败而阻止后续命令。代码块不是可无人值守整段粘贴的升级脚本。

Mac 不再新增构建，后续本地运行、迁移和验收留到 Windows。真实模型评测和 Agent 化继续暂缓。
不要运行 `evaluate_ai_quality.py --live`。受控模型测试只证明工程流程正确，不证明真实模型质量提升。

## 1. 确认目标环境与主线

- [ ] 确认 Docker Desktop 使用 WSL2 Linux 引擎。
- [ ] 记录原 Compose 项目名、端口、镜像、卷、数据库地址以及使用的 env/覆盖文件。
- [ ] 沿用原 `COMPOSE_PROJECT_NAME`、`LABELHUB_IMAGE_TAG`、端口及配置。不要照抄新环境示例切换到空项目。
- [ ] 核对实际数据库和文件存储：以下备份示例仅适用于 Compose MySQL 与 `/data/files` 本地存储。
      外部数据库或对象存储需要备份实际目标，不能用空的默认卷代替。
- [ ] 工作区无未提交修改后，更新主线；分叉或本地修改先单独处理，不使用 `reset --hard`。

```powershell
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git log -1 --oneline
docker compose ls
python scripts/local-compose.py ps -a
```

- [ ] 核对工具链：Node `26.13.0`、npm `11.20.0`、Python `3.11`。
      安装与激活方法见 [Windows 开发说明](WINDOWS_DEVELOPMENT.md)。
- [ ] 在 Docker Desktop 设置中确认活动数据 VHDX，不能用引擎盘或离线副本替代。

```powershell
$env:LABELHUB_DOCKER_DISK_PATH = '实际使用的 docker_data.vhdx 完整路径'
python scripts/local-compose.py --check
python scripts/local-compose.py config --quiet
```

工作区和 VHDX 所在宿主分区启动前均至少保留 10 GiB，并为备份、镜像与测试另留余量。
门槛不是容量保证；不调低门槛、不重置 Docker、不清理未知数据卷。
不要把含凭据的完整 Compose 配置输出到公开日志。

## 2. 暂停写入并备份

- [ ] 进入维护窗口，停止用户写入及调度，记录升级前迁移版本和业务数据基线。

```powershell
python scripts/local-compose.py exec -T api alembic current
python scripts/local-compose.py stop web api scheduler
python scripts/local-compose.py exec -T worker celery -A app.worker.celery_app.celery_app inspect active
python scripts/local-compose.py exec -T worker celery -A app.worker.celery_app.celery_app inspect reserved
python scripts/local-compose.py exec -T worker celery -A app.worker.celery_app.celery_app inspect scheduled
```

- [ ] 确认 worker 有响应，且无在途、预取、定时重试任务；再核对 Redis 队列及数据库待执行任务。
      Celery inspect 返回空不等于 broker 队列为空。没有响应也不能按“无任务”处理。
- [ ] 若存在任务，先记录并处理；不得清空队列或为了升级触发真实模型调用。
      无法在当前暂停范围内处理时停在此处，不继续升级或启动 worker。
- [ ] 停止 worker，保留 MySQL 运行供逻辑备份；确认应用和 worker 均已停止。

```powershell
python scripts/local-compose.py stop worker
python scripts/local-compose.py ps -a
$BackupDir = Join-Path 'D:\LabelHub-backups' (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $BackupDir
```

备份目录放在仓库外、本人控制的私有位置。根据本机空间调整盘符，原备份不覆盖。

```powershell
python scripts/local-compose.py exec -T mysql sh -ec 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --result-file=/tmp/labelhub-pre-upgrade.sql $MYSQL_DATABASE'
if ($LASTEXITCODE -ne 0) { throw '数据库备份失败，停止升级' }
python scripts/local-compose.py cp mysql:/tmp/labelhub-pre-upgrade.sql "$BackupDir\database.sql"
python scripts/local-compose.py cp api:/data/files "$BackupDir\files"
python scripts/local-compose.py stop redis
python scripts/local-compose.py cp redis:/data "$BackupDir\redis"
```

SQL 在容器内生成再复制，文件在应用停止后复制，Redis 在停止后复制。
不使用 PowerShell 文本重定向保存 SQL 或二进制归档，不复制运行中的 MySQL 数据目录。
停止的 API 容器必须仍存在，不提前执行 down/rm。

- [ ] 私下保存 `.env`、Compose 覆盖文件及其引用的配置/凭据，均不提交 Git。
- [ ] 保存业务表行数、三个任务完整审核配置、原文件数量和摘要，供迁移后比较。
- [ ] 为备份生成 SHA-256 清单；清单本身放在待摘要目录外，避免自包含。

```powershell
Get-ChildItem -LiteralPath $BackupDir -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  Export-Csv -LiteralPath "$BackupDir.sha256.csv" -NoTypeInformation -Encoding UTF8
```

- [ ] 检查 SQL、文件、Redis 和配置备份均完整可读，重新计算摘要与清单比较。
- [ ] SQL 导入独立临时数据库并核对行数；文件备份做恢复读取校验，记录属主/权限恢复要求。
      验证目标不得使用原数据库或原卷，演练期间不得启动会消费旧任务的 worker。
- [ ] 恢复验证通过后才进入升级。

这份普通备份不能直接冒充 `recovery_backup.py` 要求的专用恢复包。
专用包格式及 prepare/verify/restore-check 的边界见 [存储维护](LOCAL_STORAGE_MAINTENANCE.md)。
不同盘符不代表独立物理介质；没有实际证明时不得记录“异盘恢复完成”。

## 3. 更新环境并迁移

保持应用停止，使用相同项目、卷和数据库配置：

```powershell
python scripts/local-compose.py build api web
python scripts/local-compose.py up -d mysql redis --wait
python scripts/local-compose.py run --rm --no-deps api alembic current
python scripts/local-compose.py run --rm --no-deps api alembic upgrade head
python scripts/local-compose.py run --rm --no-deps api alembic current
python scripts/local-compose.py run --rm --no-deps api alembic heads
```

- [ ] current 与 heads 一致。本文交付版本包含 `a7b8c9d0e1f2`，新增可空预审快照列。
- [ ] API、worker、scheduler 使用同一版本镜像；后续新迁移以拉取版本为准。
- [ ] 现有数据环境不运行 seed，不执行 `down --volumes`。

迁移失败时保持维护状态，保留错误和备份，不继续执行修复或恢复应用写入。

## 4. 预览并执行定向修复

```powershell
python scripts/local-compose.py run --rm --no-deps api python scripts/repair_demo_review_ranges.py
```

预览仅涉及三个任务：

| 任务 | ID | 缺失的预审范围 |
| --- | --- | --- |
| 新闻质量 | `task_demo_news_quality` | `[0,100]` |
| 偏好对比 | `task_demo_pref_compare` | `[0,100]` |
| 问答质量 | `task_demo_qa_quality` | `[0,100]` |

- [ ] 只补缺失范围；已有范围、名称、权重、阈值、Prompt 不改动。
- [ ] 问答标注表单的 1–5 分保持原样；历史审核结果和工作流快照不改写。
- [ ] 任务缺失、维度集合变化或其他配置非法时整批拒绝，先核对原因，不用 seed 强行补齐。
- [ ] 预览符合规范后执行，并再次预览确认幂等：

```powershell
python scripts/local-compose.py run --rm --no-deps api python scripts/repair_demo_review_ranges.py --apply
python scripts/local-compose.py run --rm --no-deps api python scripts/repair_demo_review_ranges.py
```

保存三次输出，最后一次应全部 `changed: false`。首次已为 false 表示无需补齐，不是失败。
比较完整配置时允许修改时间变化，业务变化仅限缺失的 scoreRange。

若已核实本地只存在部分演示任务，可在预览、应用、再次预览三个命令中均显式追加
`--task-id task_demo_news_quality`（其他允许的演示任务可重复指定）。只锁定并处理所选配置，
所选任务缺失或非法时仍整批拒绝；不指定时仍要求三份配置齐全。不得通过 seed 补齐旧环境。

## 5. 恢复环境并核对旧数据

若要求保留现有容器对象，不能直接对原项目执行下方 `up`：镜像变化会使 Compose 替换容器。
应先停止原应用容器，另建应用项目并显式复用原数据库/Redis 网络和文件卷，保留原应用容器停止状态；
核实新项目的网络、外部卷、环境变量、端口及镜像一致后，再对新项目执行 `up`。
原基础服务仅 `start`，不重建；每次调用明确指定项目名和配置文件，防止旧环境变量选错项目。
保留原容器不等于可直接回滚：迁移后的数据库仍须先验证兼容性，不能同时启动旧新 worker。

确认不存在会触发真实模型调用的待执行任务后再启动：

```powershell
python scripts/local-compose.py up -d --no-deps --wait api worker scheduler web
python scripts/local-compose.py ps
```

- [ ] 六个服务健康，无持续报错；以实际端口检查 API `/api/v1/health`、Web `/healthz`。
- [ ] 原用户、任务、数据集、提交、审核历史、附件和导出可访问。
- [ ] 表结构仅有预期迁移，数据仅有预期配置更新，原文件内容一致。
- [ ] 审核队列和详情均显示正确自定义维度名称；历史无快照记录正常回退，未知名称显示 key。
- [ ] 此环境只做旧数据读取核对，完整写入验收放在下一节隔离环境，避免污染原数据。

Mac 数据库修改不会随 Git 同步至 Windows；Windows 的修复结果必须独立核验。

## 6. 隔离完整流程验收

建立独立 Compose 项目、数据库、Redis、文件卷和端口。切换项目名不足以证明隔离：
还须检查 DATABASE_URL、REDIS_URL、外部卷及覆盖文件没有指向原环境。
仅在专用新测试库运行 seed，Playwright 和并发测试不得连接保留数据的环境。

模型使用受控 HTTP 响应，不配置真实模型凭据，并验证不会意外访问外部模型。
此前临时模型服务不是仓库的一键启动能力，Windows 需要单独准备；未准备好时将这部分标为待执行，
不能用普通页面冒烟或单元测试替代完整异步链路验收。

| 验证项 | 通过标准 |
| --- | --- |
| 结构化输入 | 包含原始材料、规范、当前答案及绑定 Schema |
| 辅助正常候选 | 确认前不自动改写答案 |
| 非法输出 | 未知字段、错误类型、越界值被拒绝，草稿不变 |
| 过期候选 | 人工修改或切换题目后不能覆盖当前答案 |
| 用户采纳 | 采纳后保存，刷新可读回 |
| 异步预审 | 真实 Celery 执行，核查标注质量而非只评价原始回答 |
| 审核路由 | 低置信度、矛盾或非法结果转人工；人工复核模式不自动终审 |
| 维度展示 | 队列与详情一致，配置改名不改变已有快照名称 |
| 人工审核 | 通过、退回及历史记录正常，无静默修改原标注 |
| 导出 | 审核后产生可下载的非空导出 |
| 运行状态 | 无页面脚本错误、持续失败任务和异常日志 |

工程回归按 [Windows 完整验收](WINDOWS_DEVELOPMENT.md#完整验收) 执行。
先安装锁定依赖并激活 Python 3.11 环境，核心命令如下：

```powershell
npm.cmd run check:toolchain
npm.cmd run test:ops
npm.cmd run check:docs
npm.cmd run typecheck
npm.cmd test
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run test:coverage
npm.cmd --prefix apps/web run build:production
npm.cmd audit --omit=dev --audit-level=high
npm.cmd --prefix apps/web run audit:production
Push-Location apps/api
python -m pytest -m 'not integration' -q
Pop-Location
git diff --check
```

另按 [API CI](../.github/workflows/api-ci.yml) 核对 Python 锁文件审计，按 [真实后端 CI](../.github/workflows/web-e2e.yml) 核对 MySQL 并发、Playwright、
审核后额外导出、监控、非 root、内部端口和重复 seed。CI 中的 Bash 命令需按 Windows 环境转换，
不能直接整段粘贴；所有 Compose 写入操作使用 `python scripts/local-compose.py` 容量保护入口。
CI 的 seed 和卷清理仅适用于明确隔离的临时测试资源。

PR #164 的参考数量为共享包 392、API 361（另有 2 项 MySQL 测试）、Web 68；
后续新增测试以实际版本为准。以上旧结果不代替本次 Windows 执行记录。

## 7. 记录、失败处理与完成条件

- [ ] 保存实际 Git SHA、镜像标识、迁移版本、项目名和端口。
- [ ] 保存备份位置、摘要、恢复验证结果及修复前后差异。
- [ ] 保存测试报告、完整流程证据、失败原因和未完成项；敏感结果留在私有目录。
- [ ] 仅清理本次明确创建的临时验收资源，保留原数据与备份。
- [ ] 失败先停止相关写入并定位，不直接 downgrade、清库或覆盖原卷。
      如需恢复，先在隔离目标验证 SQL、文件和配置的配套恢复，保留失败现场。
      不回退到存在错误自动审核路由的旧 worker。

| 验收记录 | 实际值 |
| --- | --- |
| 执行日期 / 操作者 | 2026-11-09（Europe/Berlin）/ 用户授权的 Codex；AI 自查，非独立人工 review |
| Git SHA / 镜像 / 项目 | `17b4cd49ffa53e4de685218a620dafad6170e704`；`windows-upgrade-20261109`；新应用 `labelhub-windows-upgrade-20261109`，原基础服务 `labelhub-windows-20261103` |
| 迁移前后版本 | `f6a7b8c9d0e1` → `a7b8c9d0e1f2` |
| 备份位置及恢复验证 | `D:\LabelHub-backups\windows-upgrade-20261109`；SHA-256 清单；独立 SQL 恢复 23 表/98 行一致；五归档 1,460 文件内容、属主和权限一致；同物理盘 |
| 修复预览 / 应用 / 幂等结果 | 显式选择唯一已有新闻配置；三个缺失范围补 `[0,100]`；再次预览 `changed: false`；未 seed 原库 |
| 原数据与文件核对 | 除迁移版本、范围和配置时间外所有行一致，两个文件一致；原 9 容器/6 卷保留；3 用户/3 任务/12 条数据和原预审记录读回正常 |
| 工程测试及隔离流程证据 | 共享包 392、API 362、MySQL 2、Web 68、E2E 11+导出 1、维护工具 23、文档 43；受控模型+真实 worker/浏览器、监控、重复 seed 通过；PR #167 与主线 CI 通过，链接见项目状态 |
| 失败或待完成事项 | 测试模型健康检查修正后验收通过；两份旧导出文件升级前已无对应任务，下载恢复需原记录；异盘备份、真实模型评测、Agent 化继续暂缓 |

只有备份可恢复、迁移与修复正确、旧数据保留、隔离完整流程验证通过，才能标记本次 Windows 接续完成。
真实模型评测和 Agent 化维持暂缓，不作为本轮完成条件，也不标记为已完成。

### 当前 Windows 主机接续

本机 Web 为 `http://127.0.0.1:15173`，API 为 `http://127.0.0.1:13000`。
私有激活入口 `.cache/live-activate.ps1` 选择新应用项目和显式保留卷的配置；这属于本机运维产物，不提交 Git。
旧 `.cache/activate.ps1` 保留原配置，只能用于核对及 `start` 原基础服务，不能 `up` 原应用或启动旧 worker。
本次隔离验收项目 `labelhub-validation-20261109` 与恢复项目 `labelhub-restore-20261109` 已停止，卷保留。
原两份孤立导出文件和元数据均已保留；它们在升级前就缺失父导出任务，不将无法下载误报为升级丢失，也不虚构恢复完成。
