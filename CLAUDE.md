# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

协作规范见 `AGENTS.md`（优先遵循）；本文件补充命令入口与跨文件架构要点。

## 命令

项目分 `backend/` 与 `frontend/` 两个目录，**命令都在各自目录下执行**。已验证环境为 Windows + Python 3.14 / Node 24；`backend/.venv` 不存在时后端命令可直接用系统 Python，只要已安装 `requirements.txt`。

### 后端（在 `backend/` 目录）

```powershell
cd backend

# 测试（全部）
.\.venv\Scripts\python.exe -m unittest discover -v

# 测试（单个用例 / 单个测试类）
.\.venv\Scripts\python.exe -m unittest tests.test_api.BackendTests.test_full_flow_and_clean_pot -v
.\.venv\Scripts\python.exe -m unittest tests.test_api.BackendTests -v

# 静态检查（不执行测试，仅编译与依赖一致性）
.\.venv\Scripts\python.exe -m compileall -q app scripts tests
.\.venv\Scripts\python.exe -m pip check

# 启动服务（单进程，勿加 --workers）
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --ws wsproto

# 一键启动（缺环境时在 backend/ 下创建 .venv 并按 requirements-lock.txt 安装）
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 8000

# 端到端演示（需要服务已在运行；会先暂停自动时钟，再追加场景并推进一天虚拟时间）
.\.venv\Scripts\python.exe .\scripts\demo.py --count 5
```

启动后入口：`/docs`（Swagger 调试）、`/health`、`/openapi.json`、`/ws/simulation`（WebSocket 快照）。业务前端尚未开发，当前用 Swagger 或 `scripts/demo.py` 验证接口。

### 前端（在 `frontend/` 目录）

```powershell
npm install     # 首次
npm run dev     # 开发服务器 http://127.0.0.1:5173
npm run build   # 生产构建到 dist/
```

`vite.config.js` 把 `/api` 与 `/ws` 代理到 `127.0.0.1:8000`，所以前端**不需要**配跨域，后端未启动时前端能打开但所有请求失败。需要直连后端时设 `VITE_API_BASE`；后端设了 `DECOCTION_API_KEY` 时前端设 `VITE_API_KEY`。

前端源码结构：`api/client.js`（REST 封装 + 错误结构）、`hooks/useSimulation.js`（WS 订阅与断线重连）、`domain/labels.js`（后端枚举→中文映射与格式化）、`components/`（AppShell / Display / TraceChart）、`pages/`（Overview / Simulation / BatchList / BatchDetail / PrescriptionPages / PrescriptionForm / TracePage）、`styles/tokens.css` + `app.css`（设计变量与布局，来源是 `DESIGN.md`）。

**改前端的约束**：WebSocket 只读，控制命令一律走 REST；业务状态以后端返回为准，前端不得自行递增工序或推断中间态；暂停/取消后的清洗中状态必须显示。设计变量只能加在 `tokens.css`，不要在组件里另写状态色。AntD `Tag` 的 `color` 接受任意 CSS 色值但**不是任意预设名**——用预设名之外的字符串会静默回落默认样式，复用 `components/Display.jsx` 导出的 `ACCENT_COLOR`。

**不要用 `div` + AntD 类名冒充 AntD 组件。** AntD v5 是 CSS-in-JS，**只有真正渲染某个组件时才会注入它的样式**。曾用 `<div className="ant-menu ant-menu-inline">` + `<a className="ant-menu-item">` 冒充 Menu，由于全站没有渲染过真 `Menu`，这些类名拿不到任何样式，锚点保持默认 inline，导航项一行铺开换行，表现为左上角"文字堆叠"。已改为真正的 `<Menu mode="inline" items={...} selectedKeys={...} onClick={useNavigate}>`，顺带白拿 `role="menu"`、键盘导航和选中态。同理，覆写 AntD 样式必须针对真实渲染出来的组件。

**`npm run build` 抓不到未定义的 JSX 组件。** `<Tag>` 用了但没 import 时，打包照样成功，运行时才抛 `ReferenceError` 白屏。尤其注意 `element={<X/>}` 里的 JSX 是在父组件渲染时就求值的，跟路由是否匹配无关——所以 `App.jsx` 兜底路由少一个 import 会让**所有**页面白屏。改完路由或新增页面后，必须用无头浏览器实际加载验证，不能只信构建：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-sandbox `
  --user-data-dir=$env:TEMP\chromeprof --window-size=1500,2000 --virtual-time-budget=9000 `
  --enable-logging=stderr --v=0 --screenshot="$env:TEMP\shot.png" http://127.0.0.1:5173/simulation
```

`--dump-dom` 在新版 headless 下不输出，用 `--screenshot` 直接看图；控制台错误走 `--enable-logging=stderr` 再 grep `Uncaught|ReferenceError`。要验证弹窗类组件，在 `frontend/` 下建一个临时 `.jsx` 入口 + `.html` 挂载它（**不要**把 JSX 写进 HTML 的 `<script>`，浏览器不认），截图后删掉。

环境变量：`DECOCTION_DB`（SQLite 路径，默认 `backend/data/simulation.db`）、`DECOCTION_API_KEY`（非空时 REST 需 `X-API-Key`，WebSocket 首条消息认证）、`DECOCTION_CORS_ORIGINS`。程序不自动加载 `.env`，只读环境变量。测试一律使用临时数据库（`backend/data/tests/run-*`，自动清理），不会写 `backend/data/simulation.db`。

## 架构：一次事务里的状态、时钟与事件

代码分层（`docs/ARCHITECTURE.md` 有图示）：`api.py` 只管协议/鉴权/分页/生命周期 → `service.py` 业务校验与事务边界 → `engine.py` 资源分配与时间推进；`workflow.py` 是工序与水量模板，`store.py` 是唯一持久化出口，`models.py` 是对外契约。

**整个仿真的可变状态是 SQLite `simulation_state` 表里的单行 JSON 快照**（`schema_version` 固定为 1），没有按实体拆表。每次变更都要读出、修改、写回整份状态，因此：

- 任何写操作必须包在 `with self.store.transaction() as (s, emit):` 里。事务是 `BEGIN IMMEDIATE`，`emit()` 只缓冲事件，提交时才连同状态一起写入 `events` 表；块内抛异常会同时回滚状态与事件（见 `backend/tests/test_api.py::test_atomic_rollback`）。
- 只读路径用 `store.read()`（不加写锁），不要为读取新开事务。
- 扩大单份状态体积（例如给每个事件存快照）会线性放大每次写入成本，这是当前方案已知的规模边界。

**时间只有一个来源。** `engine.py` 不读系统时间、不碰数据库，只修改传入的 state 字典并调用 `emit`——这是它可以脱离 HTTP 独立验证的原因，也是"大步进与分段步进结果完全一致"这类测试能成立的原因。唯一读取墙上时钟的地方是 `Service.auto_tick()`（`time.monotonic()` 换算倍速），由 `api.py` 的后台任务每 250ms 调用；墙上基线 `last_wall` 与 SQLite 写入共用同一把 `store.lock`。**不要新增第二个时钟或 Uvicorn worker**：多进程会各自推进时钟并各自执行"重启暂停"。

**推进方式是事件步进，不是固定切片。** `engine.advance()` 先 `dispatch()`，再把时间推到最近的工序完成点或后下投料点，随后释放资源、重新派工、推进剩余时间。所以 `{"seconds":86400}` 不会跳过中间工序，也不会让一个设备同时归属两个批次。改调度规则时必须同时核对事件顺序、资源释放、取消清洗与边界时刻。

**资源占用的关键不变量**（跨 `engine.py`/`service.py`/`workflow.py`）：

- 药锅（`kind == "pot"`）从首次调剂起被批次独占，直到倒渣+清洗完成才释放；`device["batch_id"]` 是"是否在用"的唯一判据。取消已取锅的批次会跳到 `residue`/`cleaning` 工序，`cancel_requested` 期间锅不释放。
- 每个工序占用一台同 `device_kind` 且 `idle` 的设备；`dispatch()` 按 `(-priority, sequence)` 排序，同优先级 FIFO，**进行中的工序永不抢占**。
- 锅具容量按演示总加水量保守筛选，容量不足表现为 `waiting_reason`，不是报错。
- 设备故障/停用通过 `blocker()` 让批次停止进度但保留已分配资源；修复后恢复为 `busy` 或 `idle`。
- `workflow.make_steps()` 在建批次时生成并冻结进批次记录，改工序模板只影响之后新建的批次。

**工序是数据不是代码**：批次状态来自 `steps` 列表里的 `status/elapsed_seconds/device_id`，`engine.batch_view()` 才派生出 `current_stage`、`progress_percent`、`remaining_processing_seconds` 等展示字段。接口返回的批次视图都是 `batch_view()` 的结果，不要另外拼装。

## 接口约定

除 `/health`、`/ws/simulation`、`/` 外全部挂在 `/api/v1`。错误体统一 `{"error":{"code":"...","message":"..."}}`：401 密钥、404 不存在、409 状态冲突、422 为 FastAPI 参数校验。列表用 `offset`/`limit`；事件与遥测用 `after_id` 增量读并返回 `next_after_id`。字段名带单位后缀（`*_seconds`、`*_ml`、`*_g`、`*_c`），枚举用英文、说明与显示用中文。完整登记表见 `docs/REGISTRY.md`，新增/变更接口要同步更新它。

## 测试约定

`backend/tests/test_api.py` 是唯一测试文件，走 HTTP + WebSocket 全链路。`setUp` 用 `create_app(self.db, api_key="", enable_runner=False)` 建临时库——**必须关掉 runner**，否则后台时钟会在断言期间推进仿真。调度类测试应验证外部可观察结果（设备不重复占用、故障不推进、修复不丢进度、后下只触发一次且时刻准确、大步进等于分段步进、异常同时回滚状态与事件），不要断言内部实现细节。

## 修改后的收尾

1. `.\.venv\Scripts\python.exe -m unittest discover -v`（业务逻辑或调度变更需带复现问题的测试；纯文档/排版调整不必）。
2. 更新 `CHANGELOG.md` 与 `TODO.md`；接口变更同步 `docs/REGISTRY.md`。
3. 文档职责：`README.md` 启动入口、`DESIGN.md` 前端视觉与交互、`docs/ARCHITECTURE.md` 实际架构、`docs/REGISTRY.md` 接口与组件登记。未实现功能必须显式标注"规划"。
4. 前端改动额外跑 `npm run build`；改了设计变量或页面结构要同步 `DESIGN.md`、`docs/COMPONENT-GUIDELINES.md`、`docs/PAGE-STRUCTURE.md`。
## 边界（不可在代码或注释里突破）

水量公式、温度插值、工序耗时、复核与质检结果是**仿真假设**，不得表述为厂商真实参数、药学判断或设备控制命令；项目不连接、不控制真实设备。不录入真实患者信息，只用匿名编号与虚构饮片名称。前端页面与组件（`DESIGN.md`、`docs/COMPONENT-GUIDELINES.md`、`docs/PAGE-STRUCTURE.md`、`docs/REGISTRY.md` 的组件规划表）目前只是规范，尚无对应代码。
