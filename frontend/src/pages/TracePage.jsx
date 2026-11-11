import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Space, Table, Tag } from "antd";
import { api } from "../api/client";
import { herbDose } from "../domain/herb-dose";
import { BatchStatusTag, Chip, PanelSkeleton, Verdict } from "../components/Display";
import { HERB_METHOD_LABELS, formatVirtualDuration } from "../domain/labels";

const PAGE = 1000; // 与 client.entityEvents 请求的 limit 一致，否则“加载更多”会出现空页

/** 事件流分组展示，中文类型名 + 时间戳 + 载荷摘要 */
function eventSummary(type, payload) {
  const p = payload || {};
  switch (type) {
    case "prescription.created": return `外部编号 ${p.external_no}`;
    case "prescription.reviewed": return `${p.approved ? "审核通过" : "审核驳回"} · 操作人 ${p.operator}`;
    case "batch.created": return `追溯码 ${p.trace_code}`;
    case "batch.started": return "批次开始调度";
    case "stage.started": return `${p.name || p.stage} · 设备 ${p.device_id}`;
    case "stage.completed": return `${p.name || p.stage} 完成`;
    case "ingredient.late_added": return `后下投料：${(p.herbs || []).join("、")}`;
    case "product.dispatched": return `成品配发 ${p.bags} 袋`;
    case "pot.reserved": return `分配药锅 ${p.device_id}`;
    case "pot.cleaned": return `药锅 ${p.device_id} 清洗完成并释放`;
    case "batch.completed": return `批次完成，产出 ${p.produced_bags} 袋`;
    case "batch.cancelled": return "批次取消";
    case "batch.cleanup_required": return `需倒渣清洗，药锅 ${p.pot_id}`;
    case "batch.pause": return "人工暂停";
    case "batch.resume": return "人工继续";
    case "batch.cancel": return "人工请求取消";
    case "device.fault": return `注入故障：${p.reason || "未说明"}`;
    case "device.repair": return "设备修复";
    case "device.offline": return "设备停用";
    case "device.online": return "设备启用";
    case "alarm.raised": return p.message;
    case "alarm.acknowledged": return `报警确认 · ${p.operator || ""}`;
    case "alarm.resolved": return "报警解决";
    case "telemetry.point": return `${p.stage} · ${p.temperature_c}℃ · 工序已用 ${p.stage_elapsed_seconds}s`;
    case "simulation.start": return p.value === 1 ? "按真实时间1倍速运行" : `历史倍速运行，倍率 ${p.value}`;
    case "simulation.pause": return "全局暂停";
    case "simulation.step": return `开发调试推进 ${p.value} 秒`;
    case "simulation.restart_paused": return `服务重启后暂停：${p.reason || ""}`;
    case "simulation.runner_failed": return `调度器异常：${p.reason || ""}`;
    default: return null;
  }
}

/**
 * 追溯页。数据源 GET /api/v1/trace/{trace_code}。
 * 批次事件与处方事件是两条独立流，各自用 entity_id + after_id 分页
 * （见 backend/docs/REGISTRY.md），因此这里分别维护两个游标。
 */
export function TracePage() {
  const { traceCode } = useParams();
  const [data, setData] = useState(null);
  const [batchEvents, setBatchEvents] = useState([]);
  const [rxEvents, setRxEvents] = useState([]);
  const [batchCursor, setBatchCursor] = useState(0);
  const [rxCursor, setRxCursor] = useState(0);
  const [batchDone, setBatchDone] = useState(false);
  const [rxDone, setRxDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(null); // "batch" | "rx" | null
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const initial = await api.trace(traceCode);
      setData(initial);
      setError(null);
      setBatchEvents(initial.batch_events || []);
      setRxEvents(initial.prescription_events || []);
      const bLast = initial.batch_events?.at(-1)?.id ?? 0;
      const rLast = initial.prescription_events?.at(-1)?.id ?? 0;
      setBatchCursor(bLast);
      setRxCursor(rLast);
      setBatchDone((initial.batch_events || []).length < PAGE);
      setRxDone((initial.prescription_events || []).length < PAGE);
    } catch (e) {
      setError(e.message);
    }
  }, [traceCode]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async (which) => {
    if (!data || loadingMore) return; // 飞行中再点会带同一个 after_id 再取一遍，导致重复行
    setLoadingMore(which);
    try {
      if (which === "batch") {
        const page = await api.entityEvents(data.batch.id, batchCursor);
        setBatchEvents((prev) => [...prev, ...page.items]);
        setBatchCursor(page.next_after_id);
        setBatchDone(page.items.length < PAGE);
      } else {
        const page = await api.entityEvents(data.prescription.id, rxCursor);
        setRxEvents((prev) => [...prev, ...page.items]);
        setRxCursor(page.next_after_id);
        setRxDone(page.items.length < PAGE);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(null);
    }
  };

  if (error) return <div className="console"><Tag color="error">{error}</Tag><div style={{ marginTop: 10 }}><Link to="/batches">返回批次列表</Link></div></div>;
  if (!data) return <PanelSkeleton />;

  const { batch, prescription } = data;

  return (
    <>
      <div className="section-head">
        <Link to="/batches">← 返回批次列表</Link>
        <span className="notice">追溯码 {traceCode}</span>
      </div>

      <Alert className="banner" type="info" showIcon
             message="记录时间为事件实际发生时间；累计运行计时不包含全局暂停。历史记录可能使用旧版倍速或调试步进。" />

      <Verdict batch={batch} />

      <section className="console" aria-label="追溯摘要">
        <div className="console-head">
          <div>
            <h4>追溯摘要</h4>
            <Space size={6} wrap>
              <BatchStatusTag status={batch.status} />
              <Chip label="处方" value={prescription?.external_no} />
              <Chip label="匿名编号" value={prescription?.patient_code} />
              <Chip label="当前工序" value={batch.current_stage_name} />
              <Chip label="药锅" value={batch.pot_id} />
              {batch.late_added ? <Tag color="warning" bordered={false}>已投后下组</Tag> : null}
            </Space>
          </div>
          <Space wrap>
            <Link to={`/batches/${batch.id}`}>批次详情</Link>
            <Link to={`/prescriptions/${prescription?.id}`}>处方详情</Link>
          </Space>
        </div>
        {prescription?.herbs?.length ? (
          <Space size={4} wrap>
            {prescription.herbs.map((h) => (
              <Tag key={h.name} bordered={false}
                   color={h.method === "late_add" ? "warning" : h.method === "pre_decoct" ? "processing" : "default"}>
                {h.name} · {herbDose(h)} · {HERB_METHOD_LABELS[h.method] || h.method}
              </Tag>
            ))}
          </Space>
        ) : null}
      </section>

      <EventStream
        title="批次事件"
        subtitle={`实体 ${batch.id}`}
        events={batchEvents}
        done={batchDone}
        loading={loadingMore === "batch"}
        onMore={() => loadMore("batch")}
      />

      <EventStream
        title="处方事件"
        subtitle={`实体 ${prescription?.id}`}
        events={rxEvents}
        done={rxDone}
        loading={loadingMore === "rx"}
        onMore={() => loadMore("rx")}
      />
    </>
  );
}

function EventStream({ title, subtitle, events, done, loading, onMore }) {
  return (
    <section className="console" style={{ marginTop: 16 }} aria-label={title}>
      <div className="section-head">
        <span className="section-title">{title} · {events.length} 条</span>
        <span className="notice mono">{subtitle}</span>
      </div>
      <Table
        size="small" scroll={{ x: "max-content" }}
        rowKey="id"
        pagination={false}
        dataSource={events}
        columns={[
          { title: "ID", dataIndex: "id", width: 64, render: (v) => <span className="mono">{v}</span> },
          {
            title: "累计运行", dataIndex: "sim_time", width: 104,
            render: (v) => <span className="mono">{formatVirtualDuration(v)}</span>,
          },
          {
            title: "记录时间（北京）", dataIndex: "real_time", width: 184,
            render: (v) => <span className="mono">{v ? new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—"}</span>,
          },
          { title: "类型", dataIndex: "type", width: 168, render: (v) => <span className="mono">{v}</span> },
          {
            title: "内容", key: "summary",
            render: (_, r) => {
              const text = eventSummary(r.type, r.payload);
              return text ?? <span className="notice mono">{JSON.stringify(r.payload)}</span>;
            },
          },
        ]}
      />
      {done ? null : <Button style={{ marginTop: 10 }} loading={loading} onClick={onMore}>加载更多</Button>}
    </section>
  );
}
