import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Descriptions, Popconfirm, Space, Tag, message } from "antd";
import { api } from "../api/client";
import { BatchStatusTag, Chip, PanelSkeleton, Verdict } from "../components/Display";
import { TraceChart } from "../components/TraceChart";
import {
  HERB_METHOD_LABELS, PRESCRIPTION_STATUS_LABELS,
  STAGE_STATUS_LABELS, formatTemperature, formatVirtualDuration,
} from "../domain/labels";

function useBatchTelemetry(batchId, live) {
  const [points, setPoints] = useState([]);
  const [error, setError] = useState(null);
  const cursor = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer;

    const load = async () => {
      try {
        let page;
        do {
          page = await api.telemetry(batchId, cursor.current, signal);
          if (signal.aborted) return;
          cursor.current = page.next_after_id;
          if (page.items.length) {
            const samples = page.items.map(({ sim_time, payload }) => ({ sim_time, temperature_c: payload.temperature_c }));
            setPoints((previous) => [...previous, ...samples]);
          }
        } while (page.items.length === 1000);
        setError(null);
        if (live) timer = setTimeout(load, 2000);
      } catch (reason) {
        if (!signal.aborted) {
          setError(reason.message);
          timer = setTimeout(load, 2000);
        }
      }
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [batchId, live]);

  return { points, error };
}

export function BatchDetailPage({ snapshot, onChanged }) {
  const { batchId } = useParams();
  if (!snapshot) return <PanelSkeleton />;
  const batch = snapshot.batches.find((item) => item.id === batchId);
  if (!batch) return <div className="console"><Tag color="error">批次不存在</Tag> <Link to="/batches">返回批次列表</Link></div>;
  return <BatchDetails key={batchId} batch={batch} onChanged={onChanged} />;
}

function BatchDetails({ batch, onChanged }) {
  const [prescription, setPrescription] = useState(null);
  const [busy, setBusy] = useState(false);
  const terminal = batch.status === "completed" || batch.status === "cancelled";
  const { points, error: telemetryError } = useBatchTelemetry(batch.id, !terminal);

  useEffect(() => {
    const controller = new AbortController();
    api.prescription(batch.prescription_id, controller.signal).then((data) => {
      if (!controller.signal.aborted) setPrescription(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [batch.prescription_id]);

  const act = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      message.success(okText);
      await onChanged();
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const water = batch.water_plan || {};
  const recipe = prescription?.recipe || {};
  const currentStep = batch.steps?.[batch.stage_index] || null;

  return (
    <>
      <div className="section-head">
        <Link to="/batches">← 返回批次列表</Link>
        <Space size={8}>
          <span className="notice">追溯码 {batch.trace_code}</span>
          <Link to={`/trace/${batch.trace_code}`}>查看完整追溯</Link>
        </Space>
      </div>

      <Verdict batch={batch} />

      <section className="console" aria-label="批次摘要">
        <div className="console-head">
          <div>
            <h4>{batch.trace_code}</h4>
            <Space size={6} wrap>
              <BatchStatusTag status={batch.status} />
              <Chip label="优先级" value={batch.priority} />
              <Chip label="当前工序" value={batch.current_stage_name} />
              <Chip label="药锅" value={batch.pot_id} />
              {batch.late_added ? <Tag color="warning" bordered={false}>已投后下组</Tag> : null}
              {batch.cancel_requested ? <Tag color="error" bordered={false}>取消处理中</Tag> : null}
            </Space>
          </div>
          <Space wrap>
            {batch.status === "paused" ? (
              <Button loading={busy} onClick={() => act(() => api.batchAction(batch.id, "resume"), "已继续")}>继续</Button>
            ) : (
              <Button loading={busy} disabled={terminal} onClick={() => act(() => api.batchAction(batch.id, "pause"), "已暂停")}>暂停</Button>
            )}
            <Popconfirm
              title="取消批次？"
              description="已取锅的批次需完成倒渣和清洗才会最终取消，期间药锅不释放。"
              okText="取消批次" okButtonProps={{ danger: true }}
              onConfirm={() => act(() => api.batchAction(batch.id, "cancel"), "已请求取消，等待清洗完成")}>
              <Button danger loading={busy} disabled={terminal || batch.cancel_requested || batch.dispatched}>取消批次</Button>
            </Popconfirm>
          </Space>
        </div>

        <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
          <Descriptions.Item label="批次编号"><span className="mono">{batch.id}</span></Descriptions.Item>
          <Descriptions.Item label="创建序号">{batch.sequence}</Descriptions.Item>
          <Descriptions.Item label="处方">{prescription?.external_no || "—"}</Descriptions.Item>
          <Descriptions.Item label="匿名编号">{prescription?.patient_code || "—"}</Descriptions.Item>
          <Descriptions.Item label="审核状态">{prescription ? PRESCRIPTION_STATUS_LABELS[prescription.status] : "—"}</Descriptions.Item>
          <Descriptions.Item label="开始时间"><span className="mono">{formatVirtualDuration(batch.started_at)}</span></Descriptions.Item>
          <Descriptions.Item label="计划工时"><span className="mono">{formatVirtualDuration(batch.planned_processing_seconds)}</span></Descriptions.Item>
          <Descriptions.Item label="剩余工时"><span className="mono">{formatVirtualDuration(batch.remaining_processing_seconds)}</span></Descriptions.Item>
          <Descriptions.Item label="当前温度">{formatTemperature(batch.temperature_c)} ℃</Descriptions.Item>
          <Descriptions.Item label="产出袋数">{batch.produced_bags}</Descriptions.Item>
          <Descriptions.Item label="成品配发">{batch.dispatched ? "已配发" : "未配发"}</Descriptions.Item>
          <Descriptions.Item label="结束时间"><span className="mono">{batch.completed_at === null ? "—" : formatVirtualDuration(batch.completed_at)}</span></Descriptions.Item>
        </Descriptions>
      </section>

      <section className="console" style={{ marginTop: 16 }} aria-label="工艺参数">
        <div className="section-head"><span className="section-title">工艺参数 · 演示估算</span></div>
        <div className="chip-row">
          <Chip label="药材总量" value={water.herb_mass_g} unit="g" />
          <Chip label="总加水量" value={water.total_water_ml} unit="ml" />
          <Chip label="一煎加水" value={water.first_water_ml} unit="ml" />
          <Chip label="二煎加水" value={water.second_water_ml} unit="ml" />
          <Chip label="目标药液" value={water.target_output_ml} unit="ml" />
          <Chip label="目标袋数" value={water.target_bags} unit="袋" />
          <Chip label="浸泡" value={recipe.soak_seconds} unit="s" />
          <Chip label="先煎" value={recipe.pre_decoct_seconds} unit="s" />
          <Chip label="一煎" value={recipe.first_decoct_seconds} unit="s" />
          <Chip label="二煎" value={recipe.second_decoct_seconds} unit="s" />
          <Chip label="后下提前" value={recipe.late_add_seconds} unit="s" />
          <Chip label="目标温度" value={recipe.target_temperature_c} unit="℃" />
        </div>
        {water.model ? <div style={{ marginTop: 8 }}><span className="notice">{water.model}</span></div> : null}

        {prescription?.herbs?.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="section-head"><span className="section-title">药组构成</span></div>
            <Space size={6} wrap>
              {prescription.herbs.map((h) => (
                <Tag key={h.name} bordered={false}
                     color={h.method === "late_add" ? "warning" : h.method === "pre_decoct" ? "processing" : "default"}>
                  {h.name} · {h.grams_per_dose}g · {HERB_METHOD_LABELS[h.method] || h.method}
                </Tag>
              ))}
            </Space>
          </div>
        ) : null}
      </section>

      <section className="console" style={{ marginTop: 16 }} aria-label="工序时间轴">
        <div className="section-head">
          <span className="section-title">工序时间轴 · 共 {batch.steps?.length ?? 0} 步</span>
          <span className="notice">先煎、二煎等节点是否存在由本批 steps 决定，非固定节点数</span>
        </div>
        <div className="stage-track">
          {(batch.steps || []).map((s, i) => (
            <span key={`${s.code}-${i}`} className={`stage-node ${s.status}`}>
              {i + 1}. {s.name}
              <span className="mono" style={{ marginLeft: 6, fontSize: 11 }}>
                {s.status === "completed" ? formatVirtualDuration(s.finished_at)
                  : s.status === "running" ? `${s.elapsed_seconds.toFixed(0)}/${s.duration_seconds.toFixed(0)}s`
                  : STAGE_STATUS_LABELS[s.status]}
              </span>
            </span>
          ))}
        </div>
        {currentStep ? (
          <div style={{ marginTop: 10 }}>
            <Space size={6} wrap>
              <Chip label="当前设备" value={currentStep.device_id} />
              <Chip label="开始温度" value={formatTemperature(currentStep.start_temperature_c)} unit="℃" />
              <Chip label="目标温度" value={formatTemperature(currentStep.target_temperature_c)} unit="℃" />
              <Chip label="开始时刻" value={formatVirtualDuration(currentStep.started_at)} />
            </Space>
          </div>
        ) : null}
      </section>

      <section className="console" style={{ marginTop: 16 }} aria-label="温度曲线">
        <div className="section-head">
          <span className="section-title">温度过程曲线 · 仿真采样</span>
          <span className="notice">横轴为累计运行秒数，数据来自仿真采样</span>
        </div>
        {telemetryError ? <Alert type="warning" showIcon message={`温度采样暂时无法读取，正在重试。${telemetryError}`} /> : null}
        <div className="trace-wrap">
          <TraceChart points={points} />
        </div>
      </section>

      {batch.status === "cancelled" ? (
        <Alert className="banner" type="warning" showIcon
               message="该批次已取消，未产出成品；药锅已完成倒渣与清洗后释放。" />
      ) : null}
      {batch.cancel_requested && batch.status !== "cancelled" ? (
        <Alert className="banner" type="warning" showIcon
               message="取消处理中：药锅需完成倒渣和清洗才会最终释放，期间不可用于其他批次。" />
      ) : null}
    </>
  );
}
