# 组件开发、样式、依赖和无障碍规范

状态：**部分已实现**。`frontend/` 已建立 React 18 + Ant Design 5 + Vite 项目，落地了通用展示组件；`PrescriptionForm` 与 `TracePanel` 仍为规划。尚无独立组件包或可发布的组件库。

## 组件边界

将通用展示与业务动作分开。`StatusBadge` 只展示状态；`SimulationControls` 负责全局时钟；`BatchTimeline` 负责工序历史；`DeviceCard` 展示设备与故障；页面负责加载数据和提交操作。业务状态以后端为准，不在前端自行递增工序。

| 组件 | 状态 | 位置 | 输入 | 主要行为 |
|---|---|---|---|---|
| `Lamp` / `DeviceStatusTag` | 已实现 | `components/Display.jsx` | device.status | 状态灯 + 文字标签，故障脉冲 |
| `Chip` | 已实现 | `components/Display.jsx` | label、value、unit | 弱化 label + 等宽 value |
| `BatchStatusTag` / `Verdict` | 已实现 | `components/Display.jsx` | batch | 状态标签、进度槽、等待原因 |
| `TraceChart` | 已实现 | `components/TraceChart.jsx` | telemetry.point 列表 | SVG 曲线，纯展示 |
| `AppShell` / `ControlBar` | 已实现 | `components/AppShell.jsx` | clock、连接状态 | start / pause / step |
| 设备卡片与操作 | 已实现 | `pages/SimulationPage.jsx` | device、alarm | 故障、修复、停用、启用 |
| 批次时间轴 | 已实现 | `pages/BatchDetailPage.jsx` | steps、waiting_reason | 工序状态与时刻 |
| `PrescriptionForm` / `ReviewForm` | 已实现 | `pages/PrescriptionForm.jsx` | herbs、recipe | 字段校验、保存、审核 |
| `EventStream` | 已实现 | `pages/TracePage.jsx` | events | 独立游标分页、中文摘要 |
| `TracePanel` | 规划 | — | batch、prescription、events | 悬浮详情与事件筛选 |

页面组件只负责取数与提交操作，不自行推导业务状态；暂停、取消后的清洗等中间态一律以后端返回为准。

## 接口和依赖

前端框架已确定为 React 18 + Ant Design 5 + Vite，源码在 `frontend/`，`package.json` 固定版本。请求封装在 `src/api/client.js`，统一处理 `{"error":{"code","message"}}` 结构、401/404/409/422 与网络失败。WebSocket 订阅在 `src/hooks/useSimulation.js`。

WebSocket 是快照通道，历史事件必须使用事件接口补齐。遥测与事件按 `after_id` 增量读取，用 `next_after_id` 续拉直到没有新数据。

前端来源默认是 `http://localhost:5173` 或 `http://127.0.0.1:5173`；开发环境下 `/api` 与 `/ws` 由 Vite 代理转发，不依赖跨域配置。直连后端时设置 `VITE_API_BASE`。配置了 API Key 时，由连接后的首条 WebSocket 消息提交密钥，不放在 URL 中。当前密钥是演示级共享访问控制，不作为未来账户系统。

## 样式约定

共享颜色与间距集中在 `frontend/src/styles/tokens.css`，布局与组件样式在 `frontend/src/styles/app.css`，来源是 `DESIGN.md`；组件不得随意定义不同状态颜色。数字明确标注单位，时间统一标注「虚拟秒」并注明非真实记录时间。表格列保留稳定顺序，空值用 `—` 表示。所有数值使用等宽字体与 `tabular-nums`。

## 无障碍和状态

- 使用语义按钮、表格、标题和 label；所有操作可通过键盘完成。
- 状态同时提供文字，曲线提供 `aria-label` 摘要（采样点数与温度范围）。
- 使用可见焦点和满足对比度的文字；尊重减少动态效果的系统设置。
- 动态数据不自动移动焦点，报警摘要可使用适度的实时提示。
- 覆盖加载、空数据、失败、断线、权限不足和取消后清洗状态。
- 表单错误同时显示字段与原因；禁止只靠红色边框表达错误。

## 后续验收

组件落地后检查正常、等待、暂停、故障和完成状态；验证窄屏、键盘和断线恢复。未实现组件在登记表中保持「规划」，不得标记为已发布。
