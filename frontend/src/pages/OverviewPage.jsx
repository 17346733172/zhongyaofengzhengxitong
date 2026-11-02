import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Statistic, Table, Tag } from "antd";
import { api } from "../api/client";
import { Chip, DeviceStatusTag, PanelSkeleton } from "../components/Display";
import { DEVICE_KIND_LABELS, formatPercent, formatVirtualDuration } from "../domain/labels";

/** 总览页。数据源 GET /api/v1/dashboard，全部为虚拟时间统计。 */
export function OverviewPage({ clock }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.dashboard().then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [clock?.now]);

  if (error) return <AlertError message={error} />;
  if (!data) return <PanelSkeleton />;

  const counts = data.batch_counts || {};

  return (
    <>
      <section className="desk" aria-label="总体指标">
        <div className="section-head">
          <span className="section-title">总体指标 · 虚拟时间</span>
          <span className="notice">利用率与吞吐量为仿真统计，非实际工厂性能承诺</span>
        </div>
        <div className="desk-gauges">
          <Statistic title="处方总数" value={data.total_prescriptions} />
          <Statistic title="排队中" value={counts.queued ?? 0} />
          <Statistic title="进行中" value={counts.running ?? 0} />
          <Statistic title="已暂停" value={counts.paused ?? 0} />
          <Statistic title="已完成" value={counts.completed ?? 0} valueStyle={{ color: "var(--ok)" }} />
          <Statistic title="已取消" value={counts.cancelled ?? 0} />
          <Statistic title="已配发袋数" value={data.dispatched_bags} />
          <Statistic title="活跃报警" value={data.active_alarms}
                     valueStyle={{ color: data.active_alarms ? "var(--bad)" : undefined }} />
          <Statistic title="袋 / 虚拟小时" value={data.bags_per_virtual_hour} />
        </div>
      </section>

      <section aria-label="批次状态">
        <div className="section-head" style={{ marginTop: 20 }}>
          <span className="section-title">批次状态分布</span>
        </div>
        <div className="chip-row">
          <Chip label="等待资源" value={data.waiting_batches} unit="批" />
          <Chip label="排队" value={counts.queued ?? 0} unit="批" />
          <Chip label="进行" value={counts.running ?? 0} unit="批" />
          <Chip label="暂停" value={counts.paused ?? 0} unit="批" />
          <Chip label="完成" value={counts.completed ?? 0} unit="批" />
          <Chip label="取消" value={counts.cancelled ?? 0} unit="批" />
        </div>
      </section>

      <section aria-label="设备利用率" style={{ marginTop: 24 }}>
        <div className="section-head">
          <span className="section-title">设备状态与利用率</span>
          <Link to="/simulation">前往仿真工作台 →</Link>
        </div>
        <div className="console" style={{ padding: 0, borderTop: "3px solid var(--ink)" }}>
          <Table
            size="small" scroll={{ x: "max-content" }}
            rowKey="id"
            pagination={false}
            dataSource={data.devices || []}
            columns={[
              { title: "设备", dataIndex: "name", render: (v, r) => <span className="mono">{v}</span> },
              { title: "类型", dataIndex: "kind", render: (v) => DEVICE_KIND_LABELS[v] || v },
              { title: "状态", dataIndex: "status", render: (v) => <DeviceStatusTag status={v} /> },
              {
                title: "所属批次", dataIndex: "batch_id",
                render: (v) => v ? <Link to={`/batches/${v}`} className="mono">{v}</Link>
                                 : <span className="notice">—</span>,
              },
              {
                title: "占用时长", dataIndex: "occupied_seconds",
                render: (v) => <span className="mono">{formatVirtualDuration(v)}</span>,
              },
              {
                title: "利用率", dataIndex: "utilization_percent",
                render: (v) => (
                  <span className="mono">
                    {formatPercent(v)}%
                    <Tag bordered={false} style={{ marginLeft: 6 }}
                         color={v >= 60 ? "success" : v >= 20 ? "processing" : "default"}>
                      {v >= 60 ? "高" : v >= 20 ? "中" : "低"}
                    </Tag>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </section>
    </>
  );
}

export function AlertError({ message }) {
  return <div className="console"><Tag color="error">{message}</Tag></div>;
}
