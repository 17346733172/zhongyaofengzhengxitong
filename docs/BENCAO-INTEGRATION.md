# 接收本草知问的匿名处方

更新于 2026-11-10。

本草知问通过现有处方 API 上传已核对药材，仿真平台保存后进入 `pending_review`，再由平台工作人员审核并创建批次。

## 后端代码

| 文件 | 职责 |
| --- | --- |
| `backend/app/api.py` | 创建应用、统一 API Key 鉴权、挂载业务路由 |
| `backend/app/prescription_routes.py` | 处方录入、分页查询、详情与人工审核 |
| `backend/app/pagination.py` | 处方、批次、报警共用分页响应 |
| `backend/app/models.py` | `PrescriptionCreate`、`Herb`、`Recipe`、`Review` |
| `backend/app/service.py` | 编号唯一、处方状态与批次业务 |
| `backend/app/store.py` | PostgreSQL 状态和事件事务 |

本草的出站适配位于其 `backend/app/integrations/decoction.py`，字段转换与客户端配置见本草项目的 `docs/DECOCTION-INTEGRATION.md`。

## 接收接口

| 方法和路径 | 用途 |
| --- | --- |
| `POST /api/v1/prescriptions` | 创建匿名处方，成功返回 201 |
| `GET /api/v1/prescriptions` | 按状态分页查看处方 |
| `GET /api/v1/prescriptions/{id}` | 查看平台内部编号对应的处方 |
| `POST /api/v1/prescriptions/{id}/review` | 人工审核通过或驳回 |
| `POST /api/v1/batches` | 根据已审核处方创建批次 |

以下为独立测试环境使用的最小请求。

```json
{
  "external_no": "BENCAO-123456781234423482341234567890AB",
  "patient_code": "SIM-123456781234423482341234567890AB",
  "doses": 3,
  "herbs": [
    {"name": "演示常规饮片", "grams_per_dose": 12.0, "method": "normal"}
  ]
}
```

`external_no` 是调用方唯一编号，`patient_code` 为匿名编号。本草将报告 UUID 转成大写十六进制，分别加 `BENCAO-` 和 `SIM-` 前缀。

`doses` 要求 1–30，`herbs` 要求 1–100 味且药名不能重复。旧克数协议保持兼容：省略 `unit` 即为 `g`，`grams_per_dose` 大于 0 且不超过 1000。计数饮片使用 `unit="piece"` 与正数 `quantity_per_dose`（每剂片数，支持半片，上限 100 万），`grams_per_dose` 可暂不提供；克单位不能填写片数字段。支持 `normal`、`pre_decoct`、`late_add`、`bag` 四种药组。

例如 `{"name":"演示计数饮片","unit":"piece","quantity_per_dose":3,"method":"normal"}`，5 剂在平台显示每剂 3 片、合计 15 片、重量待称重。不会把 3 片按 3 克计算。

审核通过前，使用 `herb_grams_per_dose` 按药名补充这些片数的每剂实测总克数，例如 `{"approved":true,"operator":"演示审核员","herb_grams_per_dose":{"演示计数饮片":4.5}}`。示例数字仅用于说明协议，不是每片换算标准。原始片数继续保存，水量只按实际重量计算。未补重量返回 422 / `herb_weight_required`，不更新审核状态或事件；驳回无需称重。补重量字段只接受本处方按片记录的药名，每项大于 0 且不超过 1000 g/剂。

数据库继续使用现有 JSON 状态，无需迁移既有克数处方或历史批次。部署时更新接收端后端与前端，再更新本草上传端。旧接收端会拒绝计数协议，本草保留报告并提示升级。

最小请求省略包装和工艺参数，使用平台默认值，包括每剂 2 袋、每袋 200 ml、优先级 0 及当前 `Recipe` 默认工艺。当前完整默认值见运行中的 `/docs`。

## 回执与重复编号

创建成功的响应包含平台 `id`、调用方 `external_no`、`status`、药组和工艺快照。初始状态为 `pending_review`，详情页面使用 `/prescriptions/{id}`。

相同 `external_no` 再次录入时，平台在同一状态事务内校验并返回 409。

```json
{"error": {"code": "duplicate_prescription", "message": "处方外部编号已存在"}}
```

本草仅将该错误码识别为已录入，其他冲突保留错误反馈。首次保存后响应中断时，调用方复用编号重试。修改后重新检查的报告会使用新编号。

## 地址、认证与查询

接收实例由本草的 `DECOCTION_BASE_URL` 决定。本机和服务器各自连接自己的数据库，查看处方时应进入对应实例。

平台启用 `DECOCTION_API_KEY` 时，调用方通过 `X-API-Key` 发送同一值。HTTP Basic 由平台前面的 HTTPS 网关处理，本草用 `DECOCTION_HTTP_USERNAME` / `DECOCTION_HTTP_PASSWORD` 完成网关认证。Compose 配置、后端环境和网关职责见 [部署说明](DEPLOYMENT.md)。

处方列表支持 `status`、`offset`、`limit`，默认每页 50 条，最多 200 条。状态可选 `pending_review`、`approved`、`rejected`，返回 `items,total,offset,limit`。

| 现象 | 核对内容 |
| --- | --- |
| 本草显示已上传，当前列表无记录 | 接收实例、状态筛选和分页位置 |
| 401 / 403 | HTTPS 网关账号及后端 API Key |
| 422 | 药名、剂数、每剂克数、药组枚举和未知字段 |
| 409 | 区分重复编号与其他状态冲突 |
| 连接超时 | HTTPS 入口和网络，本草会同编号最多尝试 3 次 |

本草上传后继续由平台人工审核，批次操作使用现有 `Service` 事务。

## 验证

在平台 `backend` 目录，按 [开发说明](DEVELOPMENT.md) 配置独立 PostgreSQL 测试库后运行以下命令。

```powershell
.venv\Scripts\python.exe -m unittest discover -v
```

现有回归覆盖录入、重复编号、审核、并发、分页与批次限制。字段和错误语义调整时同步本草适配及两边说明。
