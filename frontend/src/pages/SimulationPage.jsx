import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Popconfirm, Space, Tag, message } from "antd";
import { api } from "../api/client";
import { BatchStatusTag, Chip, DeviceStatusTag, Lamp } from "../components/Display";
import {
  BATCH_STATUS_LABELS, DEVICE_KIND_LABELS, formatVirtualDuration,
} from "../domain/labels";

/**
 * 仿真工作台。数据源 GET /api/v1/simulation 快照 + /ws/simulation 推送。
 * 锅具从开始调剂到清洗完成持续占用，因此卡片显示的所属批次包含倒渣与清洗阶段。
 */
export function SimulationPage({ snapshot, onChanged }) {
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const batches = snapshot?.batches || [];
  const devices = snapshot?.devices || [];
  const alarms = snapshot?.alarms || [];

  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const activeAlarms = useMemo(() => alarms.filter((a) => a.status === "active"), [alarms]);
  const device = devices.find((d) => d.id === selected) || null;

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      message.success(okText);
      onChanged?.();
    } catch (error) {
      message.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const deviceAction = (id, action) =>
    run(() => api.deviceAction(id, action), `设备 ${id} 已执行 ${action}`);

  return (
    <>
      <section aria-label="报警">
        <div className="section-head">
          <span className="section-title">活跃报警</span>
          <span className="notice">确认报警与修复设备是独立操作；修复后进度从暂停处继续</span>
        </div>
        {activeAlarms.length === 0 ? (
          <div className="console"><span className="notice">当前没有未处理报警。</span></div>
        ) : (
          <Alert className="banner" type="error" showIcon
                 message={`${activeAlarms.length} 条未处理报警`}
                 description="故障设备上的批次已停止推进，但资源仍被占用，不会释放给其他批次。" />
        )}
      </section>

      <section aria-label="设备院">
        <div className="section-head" style={{ marginTop: 20 }}>
          <span className="section-title">设备院 · 共 {devices.length} 台</span>
          <span className="notice">点击卡片查看可执行操作</span>
        </div>
        <div className="yard">
          {devices.map((d) => {
            const owner = d.batch_id ? batchById.get(d.batch_id) : null;
            return (
              <button key={d.id} type="button"
                      className={`cabinet${selected === d.id ? " selected" : ""}`}
                      onClick={() => setSelected(selected === d.id ? null : d.id)}
                      aria-pressed={selected === d.id}>
                <div className="cabinet-row">
                  <Lamp status={d.status} />
                  <span className="cabinet-id">{d.id}</span>
                  <span className="cabinet-spacer" />
                  <span className="cabinet-chip"
                        style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}>
                    {DEVICE_KIND_LABELS[d.kind] || d.kind}
                  </span>
                </div>
                <div className="cabinet-row" style={{ marginTop: 6 }}>
                  <DeviceStatusTag status={d.status} />
                </div>
                {owner ? (
                  <span className="cabinet-plan">
                    占用批次
                    <Link to={`/batches/${owner.id}`} className="mono" onClick={(e) => e.stopPropagation()}>
                      {owner.trace_code}
                    </Link>
                    <span>{owner.current_stage_name || "—"} · {owner.progress_percent}%</span>
                  </span>
                ) : (
                  <span className="cabinet-plan is-none">
                    {d.kind === "pot" ? "洁净待用" : "空闲待工"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {device ? (
        <section className="console" aria-label="设备操作" style={{ marginTop: 4 }}>
          <div className="console-head">
            <div>
              <h4>{device.id} · {DEVICE_KIND_LABELS[device.kind] || device.kind}</h4>
              <Space size={6} wrap>
                <DeviceStatusTag status={device.status} />
                <Chip label="容量" value={device.capacity_ml} unit="ml" />
                <Chip label="占用" value={formatVirtualDuration(device.occupied_seconds)} />
              </Space>
            </div>
            <Space wrap>
              {device.status === "fault" ? (
                <Button danger loading={busy} onClick={() => deviceAction(device.id, "repair")}>修复设备</Button>
              ) : (
                <Button danger loading={busy} onClick={() => deviceAction(device.id, "fault")}>注入故障</Button>
              )}
              {device.status === "offline" ? (
                <Button loading={busy} onClick={() => deviceAction(device.id, "online")}>启用</Button>
              ) : (
                <Popconfirm title="仅空闲设备可停用，确定停用？" onConfirm={() => deviceAction(device.id, "offline")}>
                  <Button loading={busy} disabled={device.status !== "idle"}>停用</Button>
                </Popconfirm>
              )}
              <Button onClick={() => setSelected(null)}>关闭</Button>
            </Space>
          </div>
          <span className="notice">
            故障会让当前工序停止推进并保留资源；修复后从暂停处继续。仅空闲设备允许停用。
          </span>
        </section>
      ) : null}

      <section aria-label="批次队列" style={{ marginTop: 24 }}>
        <div className="section-head">
          <span className="section-title">批次队列 · 按优先级与创建顺序</span>
          <span className="notice">进行中的工序不会被抢占</span>
        </div>
        {batches.length === 0 ? (
          <div className="console"><span className="notice">暂无批次。可在 Swagger 或用演示场景生成匿名批次。</span></div>
        ) : (
          <div className="slot-strip">
            {batches.map((b) => (
              <Link key={b.id} to={`/batches/${b.id}`} className="slot-bay">
                <span className="slot-index">#{b.sequence} · {BATCH_STATUS_LABELS[b.status] || b.status}</span>
                <span className="slot-serial mono">{b.trace_code}</span>
                <span className="slot-serial">{b.current_stage_name || "—"}</span>
                <span className="slot-serial mono">{b.progress_percent}%</span>
                {b.waiting_reason ? <span className="waiting-reason">等待：{b.waiting_reason}</span> : null}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-label="报警列表" style={{ marginTop: 8 }}>
        <div className="section-head">
          <span className="section-title">报警记录 · 共 {alarms.length} 条</span>
        </div>
        <div className="fault-table">
          <div className="fault-row fault-head">
            <span>设备</span><span>原因</span><span>关联批次</span><span>状态</span>
          </div>
          {alarms.length === 0 ? (
            <div className="fault-row"><span className="notice">暂无报警</span><span /><span /><span /></div>
          ) : alarms.map((a) => (
            <div key={a.id} className="fault-row">
              <span className="fault-kind">{a.device_id}</span>
              <span>{a.message}</span>
              <span>{a.batch_id ? <Link to={`/batches/${a.batch_id}`} className="mono">{a.batch_id}</Link> : "—"}</span>
              <span>
                {a.status === "active" ? (
                  <Button size="small" loading={busy}
                          onClick={() => run(() => api.acknowledge(a.id), "已确认报警")}>确认</Button>
                ) : (
                  <Tag bordered={false} color="default">已解决</Tag>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
