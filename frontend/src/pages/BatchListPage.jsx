import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Space, Table, Tag } from "antd";
import { api } from "../api/client";
import { ACCENT_COLOR, BatchStatusTag } from "../components/Display";
import { formatTemperature, formatVirtualDuration } from "../domain/labels";

const STATUS_FILTERS = [
  { value: undefined, label: "全部" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "进行中" },
  { value: "paused", label: "已暂停" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

/** 批次列表。数据源 GET /api/v1/batches，支持 status 筛选与 offset/limit 分页。 */
export function BatchListPage({ clockNow }) {
  const [status, setStatus] = useState(undefined);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], total: 0, limit: 50 });
  const [error, setError] = useState(null);
  const limit = 50;
  // 批次状态随虚拟时钟变化，因此订阅 clockNow 刷新；用序号丢弃乱序到达的旧响应
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const page = await api.batches({ status, offset, limit });
      if (seq === seqRef.current) {
        setData(page);
        setError(null);
      }
    } catch (e) {
      if (seq === seqRef.current) setError(e.message);
    }
  }, [status, offset]);

  useEffect(() => { load(); }, [load, clockNow]);

  return (
    <section aria-label="批次列表">
      <div className="section-head">
        <span className="section-title">批次 · 共 {data.total} 个</span>
        <Space size={4} wrap>
          {STATUS_FILTERS.map((f) => (
            <Tag key={f.label}
                 color={status === f.value ? ACCENT_COLOR : "default"}
                 style={{ cursor: "pointer" }}
                 onClick={() => { setStatus(f.value); setOffset(0); }}>
              {f.label}
            </Tag>
          ))}
        </Space>
      </div>
      {error ? <Tag color="error">{error}</Tag> : null}
      <div className="console" style={{ padding: 0, borderTop: "3px solid var(--ink)" }}>
        <Table
          size="small" scroll={{ x: "max-content" }}
          rowKey="id"
          pagination={{
            current: offset / limit + 1,
            pageSize: limit,
            total: data.total,
            showSizeChanger: false,
            onChange: (page) => setOffset((page - 1) * limit),
          }}
          dataSource={data.items}
          columns={[
            { title: "序号", dataIndex: "sequence", width: 64, render: (v) => <span className="mono">#{v}</span> },
            { title: "追溯码", dataIndex: "trace_code", render: (v, r) => <Link to={`/batches/${r.id}`} className="mono">{v}</Link> },
            { title: "优先级", dataIndex: "priority", width: 72 },
            { title: "状态", dataIndex: "status", width: 96, render: (v) => <BatchStatusTag status={v} /> },
            { title: "当前工序", dataIndex: "current_stage_name" },
            {
              title: "进度", dataIndex: "progress_percent", width: 84,
              render: (v) => <span className="mono">{v}%</span>,
            },
            {
              title: "温度", dataIndex: "temperature_c", width: 80,
              render: (v) => <span className="mono">{formatTemperature(v)} ℃</span>,
            },
            {
              title: "等待原因", dataIndex: "waiting_reason",
              render: (v) => v ? <span style={{ color: "var(--warn)" }}>{v}</span> : <span className="notice">—</span>,
            },
            {
              title: "袋数", dataIndex: "produced_bags", width: 64,
              render: (v, r) => (r.dispatched ? v : <span className="notice">—</span>),
            },
            { title: "药锅", dataIndex: "pot_id", render: (v) => <span className="mono">{v || "—"}</span> },
            {
              title: "工序用时", key: "elapsed", width: 104,
              // 已结束用 completed_at；进行中/暂停/阻塞用 计划-剩余，暂停与故障时随进度一起冻结，
              // 不用全局虚拟时钟——否则批次停了表还在走，会误导用户认为资源仍在推进
              render: (_, r) => {
                if (r.started_at === null) return <span className="notice">—</span>;
                if (r.completed_at !== null) {
                  return <span className="mono">{formatVirtualDuration(r.completed_at - r.started_at)}</span>;
                }
                const processed = (r.planned_processing_seconds ?? 0) - (r.remaining_processing_seconds ?? 0);
                return <span className="mono">{formatVirtualDuration(processed)}</span>;
              },
            },
          ]}
        />
      </div>
    </section>
  );
}
