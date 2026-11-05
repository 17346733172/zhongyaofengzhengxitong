/*
 * REST 客户端。错误结构、分页与状态码遵循 backend/docs/REGISTRY.md：
 *   业务错误 {"error":{"code","message"}}；401 密钥；404 不存在；409 状态冲突；422 参数校验。
 *
 * 默认走同源相对路径，由 vite.config.js 的开发代理转发到后端，天然避开跨域；
 * 需要直连后端时设置 VITE_API_BASE=http://127.0.0.1:8000。
 */

const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const API_KEY = import.meta.env.VITE_API_KEY || "";

/** 后端业务错误，携带 code / message / status，页面按 status 分别提示。 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || "请求失败");
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  let response;
  try {
    response = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "network_error", "无法连接后端服务，请确认服务已启动");
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    // 422 走 FastAPI 的 detail 结构（始终是数组），其余走 error.code/message
    if (response.status === 422 && Array.isArray(payload?.detail)) {
      const first = payload.detail[0];
      const where = first?.loc?.slice(1).join(".") || "参数";
      throw new ApiError(422, "validation_error", `${where}：${first?.msg || "参数不合法"}`);
    }
    // 非 JSON 响应体（5xx 纯文本、代理错误页）或未知结构，给可读的兜底文案而不是裸 code
    const message_ = payload?.error?.message
      || `请求失败（HTTP ${response.status}${payload?.error?.code ? ` ${payload.error.code}` : ""}）`;
    throw new ApiError(response.status, payload?.error?.code || "http_error", message_);
  }
  return payload;
}

const get = (path, signal) => request(path, { signal });
const post = (path, body = {}) => request(path, { method: "POST", body });

export const api = {
  // 仿真控制与快照
  snapshot: (signal) => get("/simulation", signal),
  start: () => post("/simulation/start", { speed: 1 }),
  pause: () => post("/simulation/pause"),
  createScenario: (count) => post("/simulation/scenarios", { count }),
  dashboard: (signal) => get("/dashboard", signal),

  // 批次
  batch: (id) => get(`/batches/${id}`),
  createBatch: (prescriptionId) => post("/batches", { prescription_id: prescriptionId }),
  batchAction: (id, action) => post(`/batches/${id}/${action}`),

  // 处方
  prescriptions: ({ status, offset, limit } = {}) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (offset) query.set("offset", String(offset));
    if (limit) query.set("limit", String(limit));
    const suffix = query.toString();
    return get(suffix ? `/prescriptions?${suffix}` : "/prescriptions");
  },
  prescription: (id, signal) => get(`/prescriptions/${id}`, signal),
  createPrescription: (body) => request("/prescriptions", { method: "POST", body }),
  review: (id, body) => request(`/prescriptions/${id}/review`, { method: "POST", body }),

  // 设备与报警
  deviceAction: (id, action, reason = "前端操作") => post(`/devices/${id}/${action}`, { reason }),
  acknowledge: (id) => post(`/alarms/${id}/acknowledge`, { operator: "前端操作员" }),

  // 追溯。batch 与 prescription 是两条独立事件流，各自用 entity_id + after_id 续拉
  telemetry: (id, afterId, signal) => get(`/batches/${id}/telemetry?limit=1000&after_id=${afterId}`, signal),
  trace: (code) => get(`/trace/${code}?limit=1000`),
  entityEvents: (entityId, afterId = 0) =>
    get(`/events?entity_id=${encodeURIComponent(entityId)}&limit=1000&after_id=${afterId}`),
};

export { BASE };
