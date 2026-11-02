/*
 * 后端枚举的中文映射。枚举值本身是英文（见 backend/app/models.py、workflow.py），
 * 这里只做展示层翻译，不引入第二套枚举。
 */

export const DEVICE_KIND_LABELS = {
  pot: "煎药锅",
  dispenser: "调剂机",
  verification: "复核台",
  conveyor: "输送单元",
  water: "加水单元",
  soaking: "浸泡工位",
  decocter: "煎煮工位",
  filter: "过滤单元",
  packer: "包装机",
  labeler: "贴标机",
  quality: "质检台",
  dispatch: "配发台",
  residue: "倒渣机",
  washer: "清洗机",
};

/** 设备状态 → 状态灯 class 后缀，与 app.css 的 .lamp-* 对应 */
export const DEVICE_STATUS_LAMP = {
  idle: "idle",
  busy: "busy",
  fault: "fault",
  offline: "offline",
};

export const DEVICE_STATUS_LABELS = {
  idle: "空闲",
  busy: "占用",
  fault: "故障",
  offline: "停用",
};

export const BATCH_STATUS_LABELS = {
  queued: "排队中",
  running: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

/** 批次状态 → 结论条色调，与 .verdict-badge.tone-* 对应 */
export const BATCH_STATUS_TONE = {
  queued: "idle",
  running: "info",
  paused: "warn",
  completed: "ok",
  cancelled: "bad",
};

export const STAGE_STATUS_LABELS = {
  pending: "待执行",
  running: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};

export const PRESCRIPTION_STATUS_LABELS = {
  pending_review: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};

export const HERB_METHOD_LABELS = {
  normal: "常规",
  pre_decoct: "先煎",
  late_add: "后下",
  bag: "包煎",
};

export const ALARM_STATUS_LABELS = {
  active: "未处理",
  resolved: "已解决",
};

/** 把后端返回的秒数格式化为 时:分:秒，全部基于虚拟时间 */
export function formatVirtualDuration(totalSeconds) {
  const value = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** 温度保留一位小数并带单位，字段名已含 _c 后缀 */
export function formatTemperature(celsius) {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return "—";
  return Number(celsius).toFixed(1);
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(2);
}
