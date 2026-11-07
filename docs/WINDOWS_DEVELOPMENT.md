# Windows 本地开发与验收

推荐 Windows 原生 PowerShell + Docker Desktop WSL2 Linux 引擎，不需要另外安装 Ubuntu。
不要在 Docker Desktop 内部发行版安装开发工具。改用通用 WSL2 时也须检查虚拟磁盘所在宿主分区，
不能用 Linux 工作区余量代替宿主余量。工程边界见 [项目状态](PROJECT_STATUS.md)。

## 工具与依赖

要求 Node **26.13.0**、npm **11.20.0**、Python **3.11**。可将官方 Node ZIP 解压到私有工具目录，
先与同版本 `SHASUMS256.txt` 校验，再加入当前会话 PATH，无需替换系统 Node。
以下命令均从仓库根目录执行，每一步成功后才运行下一步。

```powershell
node --version
npm.cmd --version
py -3.11 -m venv apps/api/.venv
. ./apps/api/.venv/Scripts/Activate.ps1
python -m pip install --require-hashes -r apps/api/requirements-dev.txt
npm.cmd ci
npm.cmd --prefix apps/web ci
npm.cmd run build:migration-engine
```

也可使用 `uv venv --python 3.11 apps/api/.venv` 和
`uv pip install --python apps/api/.venv/Scripts/python.exe --require-hashes -r apps/api/requirements-dev.txt`。
npm 运维入口在 Windows 使用已激活环境的 `python`，Unix 保留 `python3`，
也可用 `LABELHUB_PYTHON` 指定解释器绝对路径，不依赖 Windows Store 的 `python3` 别名。
遇到失效企业源或代理时先核对用途，仅为当前命令或会话指定可用源，不覆盖全局配置。

## 容量保护与隔离启动

在 Docker Desktop 设置中核对实际数据磁盘位置。新安装常见路径为
`$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx`，旧版或迁移后的路径可能不同。
不要选 `main\ext4.vhdx` 引擎盘或离线备份副本代替正在使用的数据盘。

```powershell
$env:LABELHUB_DOCKER_DISK_PATH = "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx"
$env:COMPOSE_PROJECT_NAME = 'labelhub-windows-local'
$env:LABELHUB_IMAGE_TAG = 'windows-local'
$env:WEB_PORT = '127.0.0.1:15173'
$env:API_PORT = '127.0.0.1:13000'
python scripts/local-compose.py --check
python scripts/local-compose.py config --quiet
python scripts/local-compose.py build api web
python scripts/local-compose.py up -d mysql redis --wait
python scripts/local-compose.py --profile tools run --rm seed
python scripts/local-compose.py up -d api worker scheduler web --wait
```

门禁仅接受本机 Docker Desktop Linux 命名管道，同时监测工作区与明确指定的 VHDX 所在宿主文件系统。
启动前仍需 **10 GiB**，运行中低于 **3 GiB** 时使用 `taskkill /PID <本次子进程> /T /F`
终止客户端进程树。这不会回滚 daemon 已创建的资源，随后须用包装入口的 `ps` 核对状态。
脚本验证路径、文件存在和引擎类型，但不能证明指定文件就是活动数据盘；迁移磁盘后须重新核对。
不得跳过门禁、调低阈值、重置 Docker 或删除未知数据。

打开 `http://127.0.0.1:15173`，账号见 [API 说明](../apps/api/README.md)。
这里使用本地演示数据；真实 LLM 调用需要另行配置 `DOUBAO_API_KEY` 和 `DOUBAO_MODEL`。
不提交 `.env`、secret 文件、数据、下载缓存或测试产物。

## 完整验收

```powershell
npm.cmd run check:toolchain
npm.cmd run test:ops
npm.cmd run check:docs
npm.cmd run typecheck
npm.cmd test
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run test:coverage
npm.cmd --prefix apps/web run build:production
npm.cmd --prefix apps/web run build:demo
npm.cmd audit --omit=dev --audit-level=high
npm.cmd --prefix apps/web run audit:production
Push-Location apps/api
python -m pytest -m 'not integration' -q
python scripts/export_openapi.py
Pop-Location
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:15173'
Push-Location apps/web
npx.cmd playwright install chromium
npm.cmd run e2e
Pop-Location
git diff --check
```

还须审计 Python 哈希锁，并按 [真实后端工作流](../.github/workflows/web-e2e.yml)
验证 MySQL 并发、额外导出、导出/迁移产物存在时重复 seed、非 root 和内网端口。
这些写入型 Compose 操作同样通过容量包装入口。不能向未知旧库运行 seed。

监控按 [监控运维](OBSERVABILITY.md) 叠加。Windows `COMPOSE_FILE` 分隔符是分号：
`docker-compose.yml;docker-compose.monitoring.yml`。为 `METRICS_TOKEN_FILE`、
`GRAFANA_PASSWORD_FILE` 创建私有随机文件，并将 `MONITOR_*_URL` 指向实际回环端口，
然后运行 `python scripts/verify-monitoring.py`。

## 备份边界

Windows 可运行冻结恢复包的 `prepare`、`verify`，以及满足门禁后的临时卷 `restore-check`。
清单统一 UTF-8；没有 `st_blocks` 时以完整逻辑大小保守估算。默认排除 `Docker.raw*` 与 VHDX，
仅 `--include-vm` 包含已停机保存的整盘副本。清单拒绝盘符、备用数据流、保留设备名、符号链接及目录联接点。

异盘 `copy` 的物理介质核验仍仅支持 macOS，Windows 会明确失败，不生成成功证明。
不同盘符不代表不同物理盘。转存旧数据前须提供冻结恢复包位置和独立介质，
再适配并实测其身份核验；路径差异、内容校验或测试替身不能代替真实异盘恢复证明。
详细保留规则见 [存储维护](LOCAL_STORAGE_MAINTENANCE.md)。

## 本次 Windows 验收记录

2026-11-04，任务分支 `chore/windows-local-validation`，起点为最新拉取的
`origin/main`：`6f7cf219bf477ed5a10462d45f7c0e4b64988b99`。本节记录分支本地验证，不表示已合并或生产上线。
工程位于 `D:\AI_Projects\Labelhub`，使用隔离 Node 26.13.0 / npm 11.20.0 / Python 3.11.15。
接手时所选 Docker 引擎中容器、数据卷、镜像均为零；历史文档中的另一台机器恢复记录不作为本机状态。

| 检查 | 本地结果 |
| --- | --- |
| 工具链、共享包类型与测试 | 通过，380 项测试 |
| Web 类型、覆盖率、生产与 Demo 构建 | 通过，60 项测试；四项覆盖率均超过 50% 门槛 |
| API 非 MySQL 测试 / OpenAPI | 293 passed、2 deselected；导出 64 条路径 |
| 真实 MySQL 并发 | 2 passed |
| Chromium 真实后端 | 11 passed，额外导出 1 passed |
| 导出及迁移产物存在时重复 seed | 前置条件与重复初始化均通过 |
| 监控、容器权限与端口 | 真实抓取、面板、告警、匿名拒绝、非 root、数据库/Redis 无宿主端口均通过 |
| 依赖审计 | 根/Web 生产 npm 审计、Python 运行依赖审计通过 |
| 运维保护 | Windows 和 Linux 容器各 23 项通过，Windows 实际父/子进程取消通过 |
| 备份 | 合成恢复包准备、完整校验、临时卷恢复及逐文件比较通过；无旧数据或异盘恢复证明 |
| 文档与差异 | 41 份文档检查、`git diff --check` 通过 |

本机专用且被 Git/Docker 忽略的 `.cache/activate.ps1` 可在仓库根目录点加载，恢复工具链、
独立 Compose 项目 `labelhub-windows-20261103`、回环端口及监控凭据文件路径。
该文件不包含凭据内容；随机监控凭据留在 `.cache/secrets/`。它不是通用安装器，移动目录或 Docker 磁盘后需重新核实。
验收日志留在 `.cache/*.log`。Web 为 `http://127.0.0.1:15173`，API 为 `http://127.0.0.1:13000`。
全部原有资源保留，测试专用的唯一临时容器/卷按脚本清理，隔离应用栈及其数据保留。
验收结束时 D 盘约剩 414 GiB，Docker 数据盘所在 C 盘约剩 34 GiB；两盘符属于同一物理 NVMe。
