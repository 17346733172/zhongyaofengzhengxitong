# 组件构建、校验和分发说明

## 当前登记状态

当前发布对象包括 Python 后端（入口 `app.main:app`）与 React 前端（`frontend/`），版本均为 `0.1.0`。前端使用 React 18 + Ant Design 5 + Vite，开发服务器 5173。下面的接口已实现；前端页面与组件的实现状态分别标注，规划项不得视为可用代码。

## 后端接口登记

除 `/health` 外，下表路径都以 `/api/v1` 开头。完整请求结构、默认值与校验范围可在运行中的 `/docs` 和 `/openapi.json` 查看。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health`（根路径） | 数据库与调度器健康状态 |
| GET | `/workflow` | 工序模板、设备类型、建模假设 |
| GET / POST | `/prescriptions` | 分页列表 / 创建处方 |
| GET | `/prescriptions/{id}` | 处方详情 |
| POST | `/prescriptions/{id}/review` | 人工审核或驳回 |
| GET / POST | `/batches` | 分页列表 / 根据已审处方创建批次 |
| GET | `/batches/{id}` | 批次、工序、进度及等待原因 |
| POST | `/batches/{id}/{pause,resume,cancel}` | 单批次控制 |
| GET / POST | `/devices` | 设备列表 / 新增工位或锅具 |
| POST | `/devices/{id}/{fault,repair,offline,online}` | 设备异常和启停 |
| GET | `/alarms` | 分页报警列表 |
| POST | `/alarms/{id}/acknowledge` | 确认报警，修复需操作设备 |
| GET | `/simulation` | 完整快照与最新事件 ID |
| POST | `/simulation/start` | 固定真实时间 1 倍速，请求 `{}` 或 `{"speed":1}`；其他倍率 422 |
| POST | `/simulation/pause` | 暂停全局时钟，无请求体 |
| POST | `/simulation/step` | 离线调试推进，默认返回 409；仅 `DECOCTION_ALLOW_DEBUG_STEP=1` 开启 |
| POST | `/simulation/scenarios` | 新增演示场景，请求 `{"count":5}` |
| GET | `/events` | 全局或实体增量事件 |
| GET | `/batches/{id}/telemetry` | 温度采样点 |
| GET | `/trace/{trace_code}` | 批次及处方追溯 |
| GET | `/dashboard` | 产量、状态和设备利用率 |
| WS | `/ws/simulation`（根路径） | 快照 / 心跳推送 |

花括号中的动作代表独立 URL，例如 `/devices/decocter-01/fault`。操作接口请求为 `{"operator":"演示操作员","reason":"人工操作"}`，字段可省略但需提交 `{}`。

## 分页、错误与认证

处方、批次、报警列表支持 `offset` 和 `limit`（默认 50，上限 200）；相应 `status` 参数支持状态筛选。返回 `items,total,offset,limit`。设备列表规模较小，目前不分页。

事件和遥测使用 `after_id`（不包含该 ID）及 `limit`（默认 100，上限 1000）。响应包含 `next_after_id`，用其继续读取，直到没有新数据。追溯返回 `batch_events`、`prescription_events` 两组，各自使用最后一个 ID 独立分页；可通过 `/events?entity_id=...` 分别补齐全部历史。

业务错误返回 `{"error":{"code":"...","message":"..."}}`。HTTP 401 表示密钥无效，404 表示不存在，409 表示状态冲突，422 使用 FastAPI 的 `detail` 参数错误结构。未知字段会被拒绝；处方药材不能重名。

配置 `DECOCTION_API_KEY` 后，REST 通过 `X-API-Key` 提交，Swagger 可点击 Authorize。健康检查和文档公开。WebSocket 连接后五秒内提交 `{"api_key":"..."}`；无效密钥或不允许的浏览器来源会以 1008 关闭。无密钥时直接推送。

## 推送与事件约定

WebSocket 消息为 `{"type":"snapshot","data":{...}}` 或 `{"type":"heartbeat","last_event_id":123}`。快照含 `clock,batches,devices,alarms,last_event_id`。只读连接不支持发送控制命令，操作仍使用 REST。断线后重新取快照，再按已保存事件 ID 拉取遗漏事件。

事件类型包含 `prescription.*`、`batch.*`、`stage.started/completed`、`ingredient.late_added`、`product.dispatched`、`pot.reserved/cleaned`、`device.*`、`alarm.*`、`simulation.*` 和 `telemetry.point`。遥测在阶段边界及每次推进末尾采样，并非固定频率传感器数据。

## 前端页面登记

| 路由 | 状态 | 数据来源 |
|---|---|---|
| `/overview` | 已实现 | `GET /api/v1/dashboard` |
| `/devices` | 已实现 | `GET /api/v1/dashboard`，设备类型目录 |
| `/devices/:kind` | 已实现 | dashboard.devices、snapshot.batches，单类型设备页面 |
| `/simulation` | 已实现 | `GET /api/v1/simulation`、`/ws/simulation`、设备与报警操作 |
| `/prescriptions` | 已实现 | `GET/POST /api/v1/prescriptions`、审核 |
| `/prescriptions/:id` | 已实现 | `GET /api/v1/prescriptions/{id}`、`POST /batches` |
| `/batches` | 已实现 | `GET /api/v1/batches` |
| `/batches/:id` | 已实现 | 批次、`/telemetry` |
| `/trace/:code` | 已实现 | `GET /api/v1/trace/{code}`、`/events?entity_id=` |
| `/alarms` | 规划 | `GET /api/v1/alarms`（当前报警内嵌在仿真工作台） |

## 前端组件登记

| 组件 | 状态 | 位置 |
|---|---|---|
| `Lamp` / `DeviceStatusTag` | 已实现 | `frontend/src/components/Display.jsx` |
| `Chip` | 已实现 | `frontend/src/components/Display.jsx` |
| `BatchStatusTag` / `Verdict` | 已实现 | `frontend/src/components/Display.jsx` |
| `TraceChart` | 已实现 | `frontend/src/components/TraceChart.jsx` |
| `AppShell` / `ControlBar` | 已实现 | `frontend/src/components/AppShell.jsx` |
| `SimulationEmptyState` | 已实现 | `frontend/src/components/SimulationEmptyState.jsx` |
| `DeviceTypeIndex` / `DeviceOverview` | 已实现 | `frontend/src/components/DeviceOverview.jsx`（分类入口、单类型卡片与选中详情） |
| `PrescriptionForm` / `ReviewForm` | 已实现 | `frontend/src/pages/PrescriptionForm.jsx` |
| `EventStream` | 已实现 | `frontend/src/pages/TracePage.jsx` |
| 设备卡片与操作 | 已实现 | `frontend/src/pages/SimulationPage.jsx` |
| 批次时间轴 | 已实现 | `frontend/src/pages/BatchDetailPage.jsx` |
| `TracePanel` | 规划 | 已由 `EventStream` 覆盖，后续补充悬浮详情与筛选 |
| `SimulationControls` | 规划 | 已由 `ControlBar` 覆盖，后续按需抽象 |
| `BatchTimeline` | 规划 | 已由批次详情内时间轴覆盖，后续按需抽象 |
| `DeviceCard` | 规划 | 已由仿真工作台卡片覆盖，后续按需抽象 |
| `TemperatureChart` | 规划 | 已由 `TraceChart` 覆盖，后续补充缩放与悬浮读数 |

## 校验与分发

后端通过 unittest、编译检查、依赖检查和真实 HTTP 演示验证；前端通过 `vite build` 编译检查，并经 Vite 代理验证 REST、WebSocket 快照、遥测曲线与端到端流程。分发代码与文档，不分发开发数据库、密钥、`node_modules` 和虚拟环境。

前端尚无独立组件包或 npm 发布目标；未来发布组件时再增加组件包名、版本、导出路径、类型和无障碍验证记录。
