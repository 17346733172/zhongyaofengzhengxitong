# 中药煎药流程仿真平台

本项目先实现后端，参考[厚达智能 · 北京本草方源煎药中心应用案例](http://www.houdar.com/prodetail.html?appid=1.2)，将接方、审核、调剂、复核、输送、加水、浸泡、先煎、后下、两煎、包装配发、倒渣清洗建模为可运行的流程仿真。

项目路径：`D:\中药煎药流程仿真平台`。当前版本 `0.1.0`，提供 REST API、Swagger 调试文档和 WebSocket 快照推送。业务前端尚未开发，`/docs` 可直接用于调试。

## 已实现

- 匿名处方录入、人工审核和驳回；外部处方编号唯一，一张处方只创建一个批次。
- 按优先级、同优先级先进先出调度，多批次竞争工位与药锅，显示等待原因。
- 常规、先煎、后下、包煎演示；可关闭二煎，按批次保存工艺参数和工序记录。
- 逐步推进虚拟时间，或按 `0.1–3600` 倍速自动运行；支持全局暂停与单批次暂停。
- 仿真设备添加、停用、故障注入、修复，报警确认与处理。
- 药锅从开始调剂到清洗完成持续占用；生产中取消批次也需完成倒渣和清洗。
- SQLite 持久化、事件追溯、温度采样、产量及设备利用率统计。
- 默认预置 27 个仿真资源：8 口锅、2 台调剂机、4 个浸泡位、2 个煎煮位及其他工位。

## 技术栈

Python 3.11+ / FastAPI / Pydantic v2 / SQLite / Uvicorn / wsproto。测试使用标准库 unittest 和 HTTPX TestClient。当前验证环境为 Windows、Python 3.14；数据库无需另外安装。

## 快速开始（Windows）

双击根目录的 `启动后端.cmd`，或在 PowerShell 执行：

```powershell
cd 'D:\中药煎药流程仿真平台'
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会在缺少环境时创建 `.venv`、按 `requirements-lock.txt` 安装已验证依赖，并在本机启动单进程服务。首次安装需要可用的 Python 包源；默认包源失败会尝试 PyPI。启动后打开：

- [接口调试文档](http://127.0.0.1:8000/docs)
- [健康检查](http://127.0.0.1:8000/health)
- [OpenAPI 定义](http://127.0.0.1:8000/openapi.json)

更换端口：`powershell -ExecutionPolicy Bypass -File .\start.ps1 -Port 8001`。停止服务按 `Ctrl+C`。

手动安装和启动：

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

在 Swagger 按顺序调用下面三个接口，或执行示例脚本：

1. `POST /api/v1/simulation/scenarios`，请求 `{"count":5}`，生成五张匿名处方及批次。
2. `POST /api/v1/simulation/step`，请求 `{"seconds":86400}`，推进一天虚拟时间。
3. `GET /api/v1/dashboard`、`GET /api/v1/batches`，查看完成量与工序轨迹。

```powershell
.\.venv\Scripts\python.exe .\scripts\demo.py
```

脚本会向当前服务新增演示数据，并先暂停全局自动运行。真实时间不会等待一天。自动演示改用 `POST /simulation/start` 请求 `{"speed":60}`；先 `POST /simulation/pause` 才能手动推进。

## 开发验证

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
```

测试在独立临时数据库中运行，不更改开发数据库。当前 24 项测试已通过，覆盖流程边界、后下时间点、资源互斥、故障暂停、取消清洗、并发重复提交、追溯、接口鉴权、自动时钟和重启持久化。已实际验证 HTTP、WebSocket 及五批次全流程演示。

## 配置与数据

默认数据位于 `data/simulation.db`，首次启动自动创建。重新启动保留处方、批次、工位与事件，自动时钟会暂停，需显式继续。`.env.example` 仅供参考；程序从环境变量读取配置，不自动加载 `.env`。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DECOCTION_DB` | 项目目录下 `data/simulation.db` | SQLite 路径，建议使用绝对路径 |
| `DECOCTION_API_KEY` | 空 | 非空时 REST 需 `X-API-Key`，WebSocket 首条消息认证 |
| `DECOCTION_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 允许的浏览器前端来源，逗号分隔 |

本地演示默认绑定 `127.0.0.1`，未配置密钥。部署配置和数据备份见 [DEPLOYMENT](docs/DEPLOYMENT.md)。

## 文档导航

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 协作与代码规范 |
| [DESIGN.md](DESIGN.md) | 未来前端视觉与交互规范 |
| [CHANGELOG.md](CHANGELOG.md) / [TODO.md](TODO.md) | 版本与开发进度 |
| [PROJECT-SPEC](docs/PROJECT-SPEC.md) | 产品定位、功能范围与参考依据 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 实际架构、目录和数据组织 |
| [COMPONENT-GUIDELINES](docs/COMPONENT-GUIDELINES.md) | 未来组件、依赖与无障碍约定 |
| [PAGE-STRUCTURE](docs/PAGE-STRUCTURE.md) | 未来页面和组件详情结构 |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | 开发、验证与发布流程 |
| [REGISTRY](docs/REGISTRY.md) | 当前 API 与未来组件登记 |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | 本地及服务器部署 |

该版本用于教学、流程演示与资源排队实验；水量公式、温度曲线、复核与质检结果是仿真假设，不用于临床煎药或真实设备控制。尚未实现 HIS/PLC 接入、库存、账户权限、配送物流和真实生产质控。
