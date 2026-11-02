# 组件构建、校验和分发说明

## 当前登记状态

当前发布对象是 Python 后端，入口 `app.main:app`，版本 `0.1.0`。没有前端组件包、组件构建服务或 npm registry。下面的接口已实现；前端组件仅登记规划，避免将规范误认为可用代码。

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
| POST | `/simulation/start` | 自动运行，请求 `{"speed":60}` |
| POST | `/simulation/pause` | 暂停全局时钟，无请求体 |
| POST | `/simulation/step` | 手动推进，请求 `{"seconds":60}` |
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

## 前端组件规划登记

| 组件 | 状态 | 后续验收 |
|---|---|---|
| SimulationControls | 规划 | 自动/手动互斥、暂停与倍率 |
| BatchTimeline | 规划 | 动态工序、后下事件、清洗闭环 |
| DeviceCard | 规划 | 故障与保留资源展示 |
| PrescriptionForm | 规划 | 药材、单位与工艺校验 |
| TemperatureChart | 规划 | 虚拟时间和采样说明 |
| TracePanel | 规划 | 双实体分页与来源追溯 |

## 校验与分发

后端通过 unittest、编译检查、依赖检查和真实 HTTP 演示验证。分发代码与文档，不分发开发数据库、密钥和虚拟环境。未来发布组件时再增加组件包名、版本、导出路径、类型和无障碍验证记录，当前不执行组件发布。
