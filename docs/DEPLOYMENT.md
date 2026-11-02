# 项目构建与部署说明

## 本地运行

推荐使用 `backend` 目录下的 `start.ps1` 或 `启动后端.cmd`。默认仅监听本机 `127.0.0.1:8000`。Python 服务无需前端打包或数据库服务器。

依赖可使用 `requirements.txt` 范围安装，或使用已验证环境的 `requirements-lock.txt` 锁定清单复现。不同操作系统和 Python 版本仍需重新验证。

## 服务配置

以下命令在 `backend` 目录执行，路径均相对于该目录。PowerShell 示例：

```powershell
$env:DECOCTION_DB = 'data\simulation.db'
$env:DECOCTION_API_KEY = '替换为你自己的随机长密钥'
$env:DECOCTION_CORS_ORIGINS = 'https://你的前端域名'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --ws wsproto
```

不要把示例密钥原样用于共享部署，不要写入 Git。程序不会自动读取 `.env`，应由启动脚本或服务管理器注入环境变量。当前版本适合本地仿真和受控内部演示；互联网多用户服务还需要账户、限流、数据隔离与单独调度器。

## 单进程要求

同一数据库只启动一个 Uvicorn worker 和一个服务实例。`--reload` 仅限开发，多 worker 或多个副本会同时驱动时钟。扩容前需把调度器拆成单独服务；仅 SQLite 写锁无法保证多时钟语义。

默认数据库路径相对于 `backend` 目录，由代码按入口文件位置推导，与启动工作目录无关；自定义相对路径则相对于启动工作目录。用服务管理器部署时需把工作目录显式设为 `backend`，否则自定义的相对路径会解析错误。使用本地磁盘，确保服务账户可写入数据库及同目录 WAL 文件。

## 反向代理

服务器部署可由 Nginx、IIS 等代理 HTTPS 到本机 8000 端口，并为 `/ws/simulation` 转发 WebSocket Upgrade 头、配置足够的连接超时。浏览器来源需准确登记在 `DECOCTION_CORS_ORIGINS`，包含协议和端口；不建议设置任意来源。

健康检查使用 `/health`：正常返回 200，数据库不可读或调度器异常返回 503。服务异常日志由 Uvicorn 输出。可由 Windows 服务管理器或 systemd 管理进程，当前不附带管理员级服务安装操作。

## 数据备份与恢复

最简单的备份方式是停止服务后复制 `simulation.db`；如仍存在同名 `-wal`、`-shm` 文件，使用 SQLite 备份 API 或同时保留相关文件，避免仅复制活动主文件。在线备份示例（在 `backend` 目录执行）：

```powershell
@'
import sqlite3
from pathlib import Path
source_path = Path('data/simulation.db')
backup_path = Path('data/simulation-backup.db')
if not source_path.exists():
    raise SystemExit('数据库尚未创建')
if backup_path.exists():
    raise SystemExit('备份文件已存在，请使用新的文件名')
with sqlite3.connect(source_path) as source, sqlite3.connect(backup_path) as target:
    source.backup(target)
print(backup_path.resolve())
'@ | .\.venv\Scripts\python.exe -
```

恢复时先停止服务，将 `DECOCTION_DB` 指向备份副本，并保留原始文件。启动后自动时钟处于暂停状态，检查批次和事件后再继续。恢复不应覆盖仍在使用的数据库。

## 验收与回滚

部署前运行 unittest、`pip check` 和健康检查；使用独立演示数据库运行 `scripts/demo.py`，确认五个批次可完成。变更前保存代码版本和数据库备份。当前数据库 `schema_version=1`，不提供自动跨版本迁移工具；后续改变数据结构必须先制定迁移与回滚方案。
