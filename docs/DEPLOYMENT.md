# 项目构建与部署说明

## 本地运行

Windows 开发可使用 `backend/start.ps1`，默认监听 `127.0.0.1:8000`。先准备 PostgreSQL，并设置下文的连接环境变量。WSL 也可直接运行 Docker Compose 部署。

依赖可使用 `requirements.txt` 范围安装，或使用已验证环境的 `requirements-lock.txt` 锁定清单复现。不同操作系统和 Python 版本仍需重新验证。

## Docker 部署（Linux 服务器）

服务器安装 Docker Engine 和 Compose，上传或检出完整仓库，在项目根目录操作。构建需要访问 Docker Hub、Python 包源和 `package-lock.json` 记录的 npm 包源。PostgreSQL 由 Compose 启动。

### 文件与运行结构

| 文件 | 职责 |
|---|---|
| `compose.yaml` | 编排前端、后端及 PostgreSQL 17，配置端口、数据卷和健康检查 |
| `.env.example` | Compose 环境变量模板；复制为根目录 `.env` 后修改 |
| `backend/Dockerfile` | Python 3.14、锁定依赖、非 root 运行、单 worker、后端健康检查 |
| `backend/.dockerignore` | 构建上下文仅包含后端源码与依赖锁，不包含数据库、密钥或虚拟环境 |
| `frontend/Dockerfile` | Node.js 24 用 `npm ci` 构建，Nginx 运行静态产物 |
| `frontend/.dockerignore` | 排除本机依赖、旧产物与 `.env`，仅允许前端构建输入 |
| `frontend/nginx.conf` | 页面路由回退、静态文件、REST 与 WebSocket 代理 |

浏览器通过服务器 8080 端口访问 Nginx。Nginx 将 API、WebSocket 和健康检查转发到 `backend:8000`，由后端连接 Compose 内网中的 `db:5432`。只有 Nginx 发布宿主机端口。

PostgreSQL 使用 `decoction-sim_postgres-data` 命名卷。项目名默认是 `decoction-sim`，通过 `-p` 修改项目名时会使用另一个数据卷。从 SQLite 版本升级请先执行下文的迁移步骤。

### 配置与启动

```bash
cp -n .env.example .env
openssl rand -hex 32
```

将生成的密码填入根目录 `.env` 的 `DECOCTION_POSTGRES_PASSWORD`。密码用于初始化数据库卷，后续应保留原值。已经初始化后，修改 `.env` 不会自动修改 PostgreSQL 用户密码。

构建时访问 PyPI 较慢，可以在 `.env` 设置 `DECOCTION_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`。容器仍按锁定清单安装，镜像源需要包含对应版本。[清华 PyPI 镜像说明](https://mirrors.tuna.tsinghua.edu.cn/help/pypi/)

默认绑定 `127.0.0.1:8080`，适合先在服务器验证，或由宿主机上的 HTTPS 网关转发。需要从其他电脑直接访问时，编辑根目录 `.env`，例如：

```dotenv
DECOCTION_BIND_IP=0.0.0.0
DECOCTION_HTTP_PORT=8080
DECOCTION_CORS_ORIGINS=http://192.0.2.10:8080
DECOCTION_API_KEY=
```

`192.0.2.10` 是文档示例地址，必须换成服务器实际 IP。安全组和防火墙只向预期访问者开放该端口。`DECOCTION_CORS_ORIGINS` 必须与浏览器地址栏的协议、主机和端口一致，不带末尾斜杠；多个地址用逗号分隔。后端对 WebSocket 单独校验 Origin，因此同源代理也必须配置该值。更改端口时一并更新来源。

```bash
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl --fail http://127.0.0.1:8080/health
```

访问 `http://服务器IP:8080`。使用默认绑定时仅在服务器本机访问 `http://127.0.0.1:8080`。通过域名提供 HTTPS 时，来源改为实际的 `https://你的域名`，网关需转发 WebSocket Upgrade 头；当前配置不自动申请证书或提供 HTTPS。

根目录 `.env` 由 Compose 读取并显式注入，区别于后端直接启动时不会自动加载 `.env`。无需复制 `backend/.env.example`，也无需设置 `VITE_API_BASE`；REST 与 WebSocket 均走浏览器同源地址。调试步进在 Compose 中固定关闭。

默认未启用 API Key，部署适用于受控演示网络。当前前端仅支持把共享 Key 编译进浏览器 JavaScript；如设置 `DECOCTION_API_KEY`，Compose 会同步传给前端构建和后端，修改后必须重新执行 `docker compose up -d --build --wait`。该 Key 可被页面访问者读取，不能作为私密服务端凭据或公网用户认证；需要限制访问时使用 VPN 或带身份认证的 HTTPS 网关。

### 验收、日志与升级

首次部署需确认 `db`、`backend` 和 `frontend` 均为 `healthy`，检查首页、直接刷新 `/devices/pot`、`/api/v1/dashboard` 和浏览器 WebSocket 快照。使用匿名演示批次验证开始、暂停和重启后数据保留。重启后时钟暂停，需要手动继续。

```bash
docker compose logs --tail=100 -f
# 更新代码前先备份数据库，更新后重新构建并启动
docker compose up -d --build --wait
# 停止并移除容器，保留命名卷
docker compose down
```

不要使用 `docker compose down -v`，该选项会删除数据库卷。不要增加后端 worker 或用 `--scale backend=2` 扩容；同一数据库只能有一个后台时钟。`unless-stopped` 在进程退出后重启容器，但容器标为 unhealthy 不会单独触发自动重启，应检查日志并处理故障。

### 迁移旧 SQLite 数据

将 `.env` 中的 PostgreSQL 密码设好后，在项目根目录执行以下命令。WSL 中若当前用户没有 Docker 权限，在 Docker 命令前加 `sudo`。先构建镜像和启动数据库，再暂停旧版服务进行导入。

```bash
docker volume inspect decoction-sim_simulation-data --format '{{.Name}}'
docker compose build backend
docker compose up -d --wait db
docker compose stop frontend backend
docker compose run --rm -T --no-deps \
  --volume decoction-sim_simulation-data:/legacy:ro \
  backend python -m app.migrate_sqlite /legacy/simulation.db
```

命令使用旧版 Compose 的默认卷名。曾用 `-p` 部署时，请先查到实际旧卷名。导入成功会输出处方、批次、设备、事件数量和最后的事件编号。确认这些数字后启动新版服务。

```bash
docker compose up -d --wait
```

导入仅接受尚未初始化的 PostgreSQL 目标库。它以只读方式使用旧卷，复制 SQLite 主文件和仍存在的 WAL 文件并在一笔事务中导入。失败后可以修复原因并重新执行导入。导入后核对批次、处方、设备及事件，再手动开始仿真。旧 SQLite 卷可用于切换前的数据核对和回滚。

若来源是 Windows 本地 `backend/data/simulation.db`，停止旧本地后端后，在 `backend` 目录用设置好目标连接串的 Python 环境执行 `.\.venv\Scripts\python.exe -m app.migrate_sqlite .\data\simulation.db`。也可以将 SQLite 备份文件及同目录 WAL（如果存在）放入独立目录，以只读方式挂载给 Compose 的一次性导入容器。选择一个源库导入，Windows 和 Docker 的旧库是独立数据集。

## 服务配置

以下命令在 `backend` 目录执行，路径均相对于该目录。PowerShell 示例：

```powershell
$env:DECOCTION_DATABASE_URL = 'postgresql://decoction:CHANGE_ME@127.0.0.1:5432/decoction'
$env:DECOCTION_API_KEY = '替换为你自己的随机长密钥'
$env:DECOCTION_CORS_ORIGINS = 'https://你的前端域名'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --ws wsproto
```

不要把示例密钥原样用于共享部署，不要写入 Git。程序不会自动读取 `.env`，应由启动脚本或服务管理器注入环境变量。当前版本适合本地仿真和受控内部演示；互联网多用户服务还需要账户、限流、数据隔离与单独调度器。

## 单进程要求

同一数据库只启动一个 Uvicorn worker 和一个服务实例。`--reload` 仅限开发。PostgreSQL 行锁能串行化状态写入，多 worker 仍会各自推进时钟，扩容前需将调度器拆为单独服务。

## 反向代理

服务器部署可由 Nginx、IIS 等代理 HTTPS 到本机 8000 端口，并为 `/ws/simulation` 转发 WebSocket Upgrade 头、配置足够的连接超时。浏览器来源需准确登记在 `DECOCTION_CORS_ORIGINS`，包含协议和端口；不建议设置任意来源。

健康检查使用 `/health`：正常返回 200，数据库不可读或调度器异常返回 503。服务异常日志由 Uvicorn 输出。可由 Windows 服务管理器或 systemd 管理进程，当前不附带管理员级服务安装操作。

## 数据备份与恢复

在 Linux 或 WSL 的项目根目录用 `pg_dump` 创建一致性备份。备份包含仿真数据，应存放在 Git 仓库以外。

```bash
backup_path="../decoction-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U decoction -d decoction -Fc > "$backup_path"
```

恢复到独立数据库后先核对数据。下例使用单独的 Compose 项目和数据卷。

```bash
docker compose -p decoction-restore up -d --wait db
docker compose -p decoction-restore exec -T db pg_restore -U decoction -d decoction \
  --exit-on-error --single-transaction < "$backup_path"
```

确认处方、批次、设备和事件后再安排切换。启动恢复后的应用时，仿真时钟会暂停。

## 验收与回滚

部署前运行 unittest、`pip check` 和健康检查，记录代码版本及数据库备份。SQLite 切换后的回滚使用旧代码与原 SQLite 卷，切换后写入 PostgreSQL 的新记录需单独保留。快照结构版本仍为 `1`。
