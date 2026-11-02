# 项目开发和组件发布流程

## 开发准备

阅读根目录 `AGENTS.md`、`PROJECT-SPEC.md` 和 `ARCHITECTURE.md`。后端代码位于 `backend` 目录，以下命令都在该目录执行。建立 Python 3.11+ 环境，安装 `requirements.txt`。需要复现本次验证环境时使用 `requirements-lock.txt`。当前 Windows Python 3.14 环境已验证，其他平台按相同步骤复测。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --ws wsproto
```

`--reload` 仅用于开发。每次重载都会暂停自动仿真并保存现有数据，避免在编辑代码期间无意推进流程。

## 开发流程

1. 在 `TODO.md` 确认范围，在相应产品文档标记设计假设。
2. 请求字段放在 `models.py`；业务限制放在 `service.py`；调度变更放在 `engine.py`。
3. 修改仿真规则时同时核对事件顺序、资源释放、取消清洗和边界时间。
4. 增加有意义的回归用例，运行测试和演示，核对 Swagger。
5. 更新 API 登记、变更记录和未完成事项。

## 验证命令

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
.\.venv\Scripts\python.exe -m compileall -q app scripts tests
.\.venv\Scripts\python.exe -m pip check
```

服务运行后，可用 `scripts/demo.py` 进行端到端演示。它会暂停自动时钟、追加演示批次并手动推进；请使用专门演示数据库。集成测试使用 `data/tests/run-*` 临时目录，完成后自动清理自身目录。

## 调度变更要求

测试应验证外部可观察结果：同一设备不会被多个批次占用；故障不推进被阻塞工序；修复不丢失进度；后下事件只发生一次且时刻准确；大步进与分段步进得到相同生产结果；异常操作同时回滚状态与事件。

不能增加多个后台时钟来提升吞吐。需要多进程时先拆分调度服务，明确单一时钟所有者和消息处理方式。

## 接口兼容和发布

当前版本为 `0.1.0`，使用 `/api/v1` 前缀。删除或更改现有字段、枚举前需要更新文档并评估前端兼容。发布后端时检查测试、依赖、启动命令、独立数据库演示和备份恢复。分发目录不包含 `.venv`、数据库或密钥。

前端组件尚未开发，因此当前没有 npm 构建或组件发布命令。未来确定技术栈后再在 `REGISTRY.md` 登记包名、版本、构建结果和发布目标，完成类型、交互与无障碍验证后发布。
