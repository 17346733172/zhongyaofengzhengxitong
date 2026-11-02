import { Skeleton, Tag } from "antd";
import { BATCH_STATUS_LABELS, BATCH_STATUS_TONE, DEVICE_STATUS_LABELS, DEVICE_STATUS_LAMP } from "../domain/labels";

/**
 * AntD Tag 的颜色prop 接受任意 CSS 色值；这里复用 tokens.css 的 --accent，
 * 避免使用不存在的 "accent" 预设名而静默回落到默认样式。
 */
export const ACCENT_COLOR = "#c1440e";

/** 状态灯：颜色 + 故障脉冲动画，与文字标签同时使用，不单靠颜色表意 */
export function Lamp({ status }) {
  return <span className={`lamp lamp-${DEVICE_STATUS_LAMP[status] || "idle"}`} aria-hidden="true" />;
}

/** 指标 chip：label（11px 弱化）+ value（等宽加粗）+ unit */
export function Chip({ label, value, unit }) {
  if (value === null || value === undefined || value === "") {
    return <span className="chip"><span className="chip-label">{label}</span><span className="chip-value">—</span></span>;
  }
  return (
    <span className="chip">
      <span className="chip-label">{label}</span>
      <span className="chip-value">
        {value}
        {unit ? <span className="chip-unit">{unit}</span> : null}
      </span>
    </span>
  );
}

/** 批次状态标签。tone 与 .verdict-badge.tone-* 一致 */
const TONE_COLORS = { ok: "success", bad: "error", info: "processing", warn: "warning", idle: "default" };
export function BatchStatusTag({ status }) {
  return <Tag color={TONE_COLORS[BATCH_STATUS_TONE[status]] || "default"} bordered={false}>{BATCH_STATUS_LABELS[status] || status}</Tag>;
}

export function DeviceStatusTag({ status }) {
  const color = { idle: "default", busy: "processing", fault: "error", offline: "default" }[status];
  return <Tag color={color} bordered={false}>{DEVICE_STATUS_LABELS[status] || status}</Tag>;
}

/** 批次结论条：徽标 + 进度。清洗未结束时不能显示为完成 */
export function Verdict({ batch }) {
  const tone = BATCH_STATUS_TONE[batch.status] || "idle";
  const icon = { ok: "✓", bad: "✕", info: "▶", warn: "‖", idle: "·" }[tone];
  const label = BATCH_STATUS_LABELS[batch.status] || batch.status;
  return (
    <div className="verdict">
      <div className={`verdict-badge tone-${tone}`}>
        <span className="verdict-icon" aria-hidden="true">{icon}</span>
        <span className="verdict-text">{label}</span>
      </div>
      <div className="verdict-body">
        <div className="verdict-progress-head">
          <span className="section-title">工序进度</span>
          <span className="mono" style={{ fontSize: 12 }}>{batch.progress_percent ?? 0}%</span>
        </div>
        <div className="verdict-track">
          <div className={`verdict-fill tone-${tone}`} style={{ width: `${Math.min(100, batch.progress_percent ?? 0)}%` }} />
        </div>
        {batch.waiting_reason ? (
          <div className="waiting-reason">等待：{batch.waiting_reason}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 面板骨架屏。用与真实面板相同的外框占位，避免数据到达时整块内容突然撑开页面
 * （技能规则 Content Jumping：为异步内容预留空间）。aria-busy 让读屏软件知道正在加载。
 */
export function PanelSkeleton({ rows = 6, label = "加载中…" }) {
  return (
    <div className="console" aria-busy="true">
      <div className="section-head">
        <span className="section-title">{label}</span>
      </div>
      <Skeleton active paragraph={{ rows }} title={false} />
    </div>
  );
}
