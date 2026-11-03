# 本地容量保护与异盘备份

本手册适用于本机开发与验收，不部署生产环境，不修改业务契约，不自动清理任何用户数据。
当前状态见 [PROJECT_STATUS](PROJECT_STATUS.md)，2026-11-03 故障记录见 [LOCAL_DOCKER_RECOVERY](LOCAL_DOCKER_RECOVERY.md)。
所有命令在仓库根目录运行，Python 3.9+；脚本只依赖标准库。

## 1. 容量保护入口

```bash
npm run check:storage
npm run compose -- build --pull
npm run compose -- up -d --wait
# 不依赖 npm 的等价入口
python3 scripts/local-compose.py --check
python3 scripts/local-compose.py -p labelhub-test -f docker-compose.yml build api web
```

- macOS 检查工作区与 Docker.raw 所在宿主文件系统；原生 Linux 检查工作区与 Docker 数据目录。
- 任何写入型 Compose 操作启动前至少保留 **10 GiB**，并确认 `docker system df` 可正常读取。
- 操作执行中每 2 秒检查容量，低于 **3 GiB** 时取消本次命令；先发 SIGINT，未退出再升级为 SIGTERM/SIGKILL。
  这是尽力取消客户端和其子进程，不代表 Docker daemon 已写入的数据会回滚；随后用 `compose ps` 核对部分启动的资源。
- 只读查询、停止和清理入口不受低空间门槛阻断，便于恢复；不会自动调用 prune 或删除卷。
- 不修改系统 `docker` 命令。直接运行 `docker compose` 会绕过此门禁；当前操作文档及 E2E CI 构建入口已使用包装脚本。
- 远程 TCP/SSH Docker 拒绝用本机空间冒充远端空间；应在目标主机执行预检。macOS 自定义磁盘位置需显式配置：

```bash
export LABELHUB_DOCKER_DISK_PATH='/实际位置/Docker.raw'
npm run check:storage
```

路径必须对应 Docker Desktop 设置中的当前磁盘文件；脚本不修改 Docker 设置。
10 GiB 是最低门槛，不是所有工作量的容量保证；大规模构建需额外空间。
门禁仅监测包装命令运行期间，不是后台监控服务，也不能阻止其他应用占满磁盘。

## 2. 低空间处理顺序

1. 暂停新的构建或大文件下载，先查看 `df -h`、`docker system df`。
2. 在确认没有其他构建使用缓存后，按需清理可重建的构建或包下载缓存；不把用户数据目录当缓存。
3. 若仍不足，将备份转存至独立介质并完成校验；本流程不会自动删除本机原件。
4. 清理旧备份或迁移 Docker 磁盘需另行明确选择。禁止通过 Docker 虚拟磁盘缩容或 `system prune --volumes` 释放未知数据。
5. 空间恢复后重新执行容量预检，不能通过调低门槛掩盖容量不足。

## 3. 备份范围与准备

对已经冻结的恢复目录执行准备；不要直接复制正在运行的数据库文件或 Docker.raw。
源目录需包含 `volume-backup-manifest.json`、卷归档、SQL 逻辑备份与对应的解压 SHA-256。
源目录中的 inspect/settings 可能包含凭据，只能存入本人控制的私有位置，不纳入 Git。

```bash
python3 scripts/recovery_backup.py prepare \
  --source /absolute/private/recovery-snapshot \
  --manifest /absolute/private/recovery-transfer.json
```

默认准备数据库、卷归档、配置清单与日志，不包含 `Docker.raw*`；这是一份数据恢复备份，不能据此宣称所有镜像及容器可离线整机恢复。
需要把已停机保存的整盘副本一起转存时，在 prepare 增加 `--include-vm`。它会读取并计算整盘全部逻辑字节，
耗时和目标容量需求明显更大。传输支持保留零块为空洞，但目标文件系统的实际占用可能不同。
传输清单必须位于源目录之外，且不能覆盖已有文件。准备阶段核对卷原始摘要、解压完整性与 SQL 摘要。

## 4. 异盘复制与回读

先连接外置盘或挂载 NAS，并创建私有目标文件夹，再运行：

```bash
python3 scripts/recovery_backup.py copy \
  --manifest /absolute/private/recovery-transfer.json \
  --destination /Volumes/Backup/LabelHub
```

- macOS 使用底层物理设备标识，拒绝同盘不同 APFS 卷、同文件系统和磁盘映像；NAS 要求真实 SMB/NFS 挂载。
  NAS 识别只证明使用独立网络目标，不证明服务端自身的磁盘冗余或备份策略。
- 开始前核对目标容量，复制中保留至少 1 GiB；每份文件复制前及最终回读后复核介质身份。
- 每次创建全新唯一目录，不覆盖目标现有文件；逐文件写入后 fsync，再完整回读计算 SHA-256，重新验证卷归档与 SQL。
- 全部通过后才生成 `TRANSFER_VERIFIED.json`；失败保留部分副本供排查，不生成成功证明，也不删除源数据。
- 文件权限请求 0600、目录 0700；实际访问控制由目标文件系统决定。NAS 需有私有 ACL，移动介质宜采用加密卷。
- 此脚本当前的物理介质自动核验限 macOS，其他平台会明确失败，不降级为“路径不同即异盘”。

## 5. 从目标恢复验证

```bash
python3 scripts/recovery_backup.py verify \
  --directory /Volumes/Backup/LabelHub/labelhub-recovery-具体批次 \
  --manifest /Volumes/Backup/LabelHub/labelhub-recovery-具体批次/transfer-manifest.json
python3 scripts/recovery_backup.py restore-check \
  --directory /Volumes/Backup/LabelHub/labelhub-recovery-具体批次 \
  --manifest /Volumes/Backup/LabelHub/labelhub-recovery-具体批次/transfer-manifest.json \
  --report /absolute/private/restore-verification-唯一批次.json
```

恢复演练要求已有 `ubuntu:24.04` 镜像（GNU tar）和至少 3 GiB 本机余量。它先验证完整摘要，
再逐个创建唯一临时卷，从目标归档恢复并逐文件比较；每个临时容器/卷均在 finally 中清理。
不覆盖原有卷，不启动原有数据库。恢复报告不冒充“SQL 已导入并启动数据库”的证明。
如 Docker Desktop 未获准访问外置路径，先在 Docker Desktop 文件共享设置中授权该路径，不能改用源文件冒充目标恢复。

## 6. 保留策略与完成定义

- 数据持续变化时，每天保存数据库逻辑备份与文件卷的一致性快照；重要升级前额外保存一份。
- 建议保留最近 7 个每日快照及最近 4 个每周快照，按数据量调整目标容量；每次备份完整校验，每月至少演练恢复一次。
- 原始故障现场副本保留到异盘验证及恢复演练通过，并由维护者明确决定是否删除；本脚本不自动轮转或删除任何副本。
- 上述周期是运行约定，本轮未安装后台定时任务；只有实际执行并产生证明的批次才能标记完成。
- **准备成功、同盘演练通过、异盘复制通过、从异盘恢复通过是四个不同状态。** 未提供目标时只记“准备完成、异盘待目标”，不能写成异盘备份已完成。

## 7. 验证维护工具

```bash
npm run test:ops
npm run check:docs
```

测试覆盖低容量拒绝、运行中取消、保留停止入口、同物理盘拒绝、路径穿越/符号链接拒绝、损坏/截断拒绝、
完整回读及失败不生成成功报告。真实介质复制仍需提供独立存储，测试替身不替代实盘验证。
