# 中药煎药流程仿真平台

本项目先实现后端，参考[厚达智能 · 北京本草方源煎药中心应用案例](http://www.houdar.com/prodetail.html?appid=1.2)，将接方、审核、调剂、复核、输送、加水、浸泡、先煎、后下、两煎、包装配发、倒渣清洗建模为可运行的流程仿真。

项目根目录即本仓库，后端代码位于 `backend/` 子目录。当前版本 `0.1.0`，提供 REST API、WebSocket 快照推送和 React 业务前端；开发者可使用后端 `/docs` 调试。

## 已实现

- 匿名处方录入、人工审核和驳回；外部处方编号唯一，一张处方只创建一个批次。支持克与片计量，片数按原值保存和统计；审核时补每剂实测重量后才能计算水量并创建批次。
- 按优先级、同优先级先进先出调度，多批次竞争工位与药锅，显示等待原因。
- 常规、先煎、后下、包煎演示；可关闭二煎，按批次保存工艺参数和工序记录。
- 固定真实时间 1 倍速运行，界面显示当前北京时间；支持全局暂停与单批次暂停。
- 仿真设备添加、停用、故障注入、修复，报警确认与处理。
- 药锅从开始调剂到清洗完成持续占用；生产中取消批次也需完成倒渣和清洗。
- PostgreSQL 持久化、事件追溯、温度采样、产量及设备利用率统计。
- 默认预置 129 个仿真资源，包括 50 口锅、7 台调剂机、4 个浸泡位和 30 个煎煮位。完整数量见 [默认设备数量](docs/PROJECT-SPEC.md#默认设备数量)。

## 与本草知问对接

本草通过 `POST /api/v1/prescriptions` 录入匿名处方，平台保存后等待人工审核。处方接收代码位于 `backend/app/prescription_routes.py`，字段、重复编号、认证和排障见 [本草对接说明](docs/BENCAO-INTEGRATION.md)。

## 技术栈

Python 3.11+ / FastAPI / Pydantic v2 / PostgreSQL 17 / Psycopg 3 / Uvicorn / wsproto。测试使用标准库 unittest 和 HTTPX TestClient。

## Docker 部署（Linux 服务器）

根目录提供 `compose.yaml`，启动 Nginx 前端、FastAPI 后端和 PostgreSQL 17。后端固定单进程，数据库保存在独立命名卷中。服务器或 WSL 需先安装 Docker Engine 和 Compose。

从 SQLite 版本升级时，先执行[旧数据迁移](docs/DEPLOYMENT.md#迁移旧-sqlite-数据)，再启动新版后端。首次部署可以直接使用以下步骤。

在项目根目录执行：

```bash
cp -n .env.example .env
# 在 .env 中设置 DECOCTION_POSTGRES_PASSWORD，并按需配置浏览器访问地址
docker compose config --quiet
docker compose up -d --build --wait
```

默认仅本机可访问 `http://127.0.0.1:8080`。其他电脑访问前，需设置监听地址，并把实际浏览器地址（如 `http://服务器IP:8080`）填入 `DECOCTION_CORS_ORIGINS`，否则 WebSocket 会被拒绝。端口、域名、升级、备份及已有数据迁移见 [部署说明](docs/DEPLOYMENT.md#docker-部署linux-服务器)。

该配置面向受控演示；公网访问需由 VPN 或带身份认证的 HTTPS 网关限制访问。当前未实现用户账户与数据隔离。

## 快速开始（Windows）

直接开发后端时，先在可访问的 PostgreSQL 实例中创建数据库和有建表权限的专用用户。将示例连接地址替换为实际地址，在 PowerShell 执行：

```powershell
cd backend
$env:DECOCTION_DATABASE_URL = 'postgresql://decoction:CHANGE_ME@127.0.0.1:5432/decoction'
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会在缺少环境时创建 `backend\.venv`、按 `requirements-lock.txt` 安装已验证依赖，并在本机启动单进程服务。首次安装需要可用的 Python 包源；默认包源失败会尝试 PyPI。启动后打开：

- [接口调试文档](http://127.0.0.1:8000/docs)
- [健康检查](http://127.0.0.1:8000/health)
- [OpenAPI 定义](http://127.0.0.1:8000/openapi.json)

更换端口（在 `backend` 目录执行）：`powershell -ExecutionPolicy Bypass -File .\start.ps1 -Port 8001`。停止服务按 `Ctrl+C`。

手动安装和启动（在 `backend` 目录执行）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --ws wsproto
```

如果系统默认包源不可用，可显式指定：

```powershell
.\.venv\Scripts\python.exe -m pip install --index-url https://pypi.org/simple -r requirements.txt
```

## 三步体验

在前端总览或仿真工作台，点击「生成演示数据」（默认 5 批），再点击「开始」。现在固定按现实时间运行：调剂 10 分钟就实际运行 10 分钟；页面提供开始和暂停，不再提供加速或手动推进。首次启动只预置设备，没有处方和批次，因此设备空闲、统计为 0；每次生成会新增演示数据。

也可以按顺序调用下面的接口：

1. `POST /api/v1/simulation/scenarios`，请求 `{"count":5}`，生成五张匿名处方及批次。
2. `POST /api/v1/simulation/start`，请求 `{}` 或 `{"speed":1}`，开始真实计时。
3. `GET /api/v1/dashboard`、`GET /api/v1/batches`，观察运行进度；`POST /api/v1/simulation/pause` 暂停。

开发者可在显式开启调试步进的独立数据库上执行离线回归：

```powershell
.\.venv\Scripts\python.exe .\scripts\demo.py
```

上面的 `demo.py` 是开发者离线回归脚本，仅允许连接显式开启 `DECOCTION_ALLOW_DEBUG_STEP=1` 的独立调试库；普通服务会在新增数据前拒绝执行。正常页面固定 1 倍速，非 1 倍速启动请求返回 422，调试步进默认禁用。

默认工序为：调剂 10 分钟、复核 5 分钟、输送 5 分钟、加水 3 分钟、浸泡 5 分钟、每次煎煮 15 分钟、过滤 3 分钟、包装 5 分钟、贴标 5 分钟、质检 3 分钟、配发 3 分钟、倒渣 2 分钟、清洗 3 分钟。默认升温并入煎煮，不另加时间；二煎默认开启，重复工序按各次计时。无先煎、关闭二煎时，不含排队和暂停的总用时为 67 分钟。既有处方和批次保留原计划，新处方及新演示场景使用新默认值。

## 开发验证

准备一个独立 PostgreSQL 测试数据库，在 `backend` 目录执行：

```powershell
$env:DECOCTION_TEST_DATABASE_URL = 'postgresql://tester:CHANGE_ME@127.0.0.1:5432/decoction_test'
.\.venv\Scripts\python.exe -m unittest discover -v
```

每项测试在指定测试库中创建独立 schema，并在结束后清理。覆盖流程、资源互斥、并发、追溯、重启持久化及 SQLite 导入。未设置测试库连接串时，集成测试会跳过。

## 配置与数据

后端首次启动时在 PostgreSQL 创建业务表。重新启动后保留处方、批次、工位与事件，仿真时钟暂停，需显式继续。直接启动时由环境变量配置数据库连接，Docker 部署由 Compose 读取根目录 `.env`。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DECOCTION_DATABASE_URL` | 空 | 直接启动时使用的 PostgreSQL 连接串，也可设置 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD` |
| `DECOCTION_POSTGRES_PASSWORD` | 必填 | Compose 初始化 PostgreSQL 时使用的数据库密码 |
| `DECOCTION_API_KEY` | 空 | 非空时 REST 需 `X-API-Key`，WebSocket 首条消息认证 |
| `DECOCTION_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 允许的浏览器前端来源，逗号分隔 |
| `DECOCTION_ALLOW_DEBUG_STEP` | `0` | 仅独立调试库设为 `1` 以启用离线步进；正常运行保持关闭 |

本地演示默认绑定 `127.0.0.1`，未配置密钥。部署配置和数据备份见 [DEPLOYMENT](docs/DEPLOYMENT.md)。

### 启动前端

前端为 React 18 + Ant Design 5 + Vite，源码在 `frontend/`：

```powershell
cd frontend
npm install       # 首次
npm run dev
```

开发服务器默认 `http://127.0.0.1:5173`。`/api` 与 `/ws` 由 Vite 代理转发到 `127.0.0.1:8000`，因此不需要额外配置跨域。生产构建用 `npm run build`，产物在 `frontend/dist`。 计量单位显示回归使用 `npm test`。

日常操作使用总览、仿真工作台、设备分类、处方和批次，均在当前标签页内切换。设备分类目录为 `/devices`，每类设备进入独立页面，例如煎药锅 `/devices/pot`、浸泡工位 `/devices/soaking`。Swagger 是开发者的接口调试工具，已从前端导航移除；需要调试时直接访问上文的后端接口文档链接。

需要直连后端（不走代理）时设置 `VITE_API_BASE`；后端配置了 `DECOCTION_API_KEY` 时，前端设置同名值的 `VITE_API_KEY`。可用环境变量见 `frontend/vite.config.js` 与 `src/api/client.js`。

前端已实现总览、仿真工作台、处方列表与录入、处方详情与审核、批次列表、批次详情、追溯页面；报警暂内嵌在仿真工作台，移动端适配为后续工作，详见 [DESIGN](DESIGN.md) 与 [PAGE-STRUCTURE](docs/PAGE-STRUCTURE.md)。

## 文档导航

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 协作与代码规范 |
| [DESIGN.md](DESIGN.md) | 前端视觉与交互规范 |
| [CHANGELOG.md](CHANGELOG.md) / [TODO.md](TODO.md) | 版本与开发进度 |
| [PROJECT-SPEC](docs/PROJECT-SPEC.md) | 产品定位、功能范围与参考依据 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 实际架构、目录和数据组织 |
| [COMPONENT-GUIDELINES](docs/COMPONENT-GUIDELINES.md) | 前端组件、依赖与无障碍约定 |
| [PAGE-STRUCTURE](docs/PAGE-STRUCTURE.md) | 页面与组件结构规划 |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | 开发、验证与发布流程 |
| [REGISTRY](docs/REGISTRY.md) | 当前 API 与组件登记 |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | 本地及服务器部署 |

该版本用于教学、流程演示与资源排队实验；水量公式、温度曲线、复核与质检结果是仿真假设，不用于临床煎药或真实设备控制。尚未实现 HIS/PLC 接入、库存、账户权限、配送物流和真实生产质控。
