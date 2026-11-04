import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Statistic, Tag } from "antd";
import { api } from "../api/client";
import { Chip, PanelSkeleton } from "../components/Display";
import { DeviceTypeIndex } from "../components/DeviceOverview";
import { SimulationEmptyState } from "../components/SimulationEmptyState";

/** 总览页。数据源 GET /api/v1/dashboard，按累计运行时间统计。 */
export function OverviewPage({ clock, lastEventId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.dashboard().then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [clock?.now, lastEventId]);

  if (error) return <AlertError message={error} />;
  if (!data) return <PanelSkeleton />;

  const counts = data.batch_counts || {};

  return (
    <>
      {Object.values(counts).every((count) => count === 0) ? <SimulationEmptyState /> : null}
      <section className="desk" aria-label="总体指标">
        <div className="section-head">
          <span className="section-title">总体指标 · 真实计时</span>
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
          <Statistic title="袋 / 运行小时" value={data.bags_per_virtual_hour} />
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
          <span className="section-title">设备分类</span>
          <Link to="/devices">查看设备分类 →</Link>
        </div>
        <DeviceTypeIndex devices={data.devices} />
      </section>
    </>
  );
}

export function AlertError({ message }) {
  return <div className="console"><Tag color="error">{message}</Tag></div>;
}
