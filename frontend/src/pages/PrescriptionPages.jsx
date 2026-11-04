import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { api } from "../api/client";
import { ACCENT_COLOR, BatchStatusTag, Chip, PanelSkeleton } from "../components/Display";
import { PrescriptionForm, ReviewForm } from "./PrescriptionForm";
import { HERB_METHOD_LABELS, PRESCRIPTION_STATUS_LABELS, formatVirtualDuration } from "../domain/labels";

const STATUS_FILTERS = [
  { value: undefined, label: "全部" },
  { value: "pending_review", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
];

const STATUS_COLORS = { pending_review: "processing", approved: "success", rejected: "error" };

/** 处方列表。数据源 GET /api/v1/prescriptions，支持 status 筛选与 offset/limit 分页。 */
export function PrescriptionListPage({ batchCount }) {
  const [status, setStatus] = useState(undefined);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], total: 0, limit: 50 });
  const [formOpen, setFormOpen] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [error, setError] = useState(null);
  const limit = 50;
  // 处方只在录入和审核时变化，不随虚拟时钟推进，因此不订阅 clockNow；
  // 否则每个快照都会触发一次全量列表请求。序号用于丢弃乱序到达的旧响应
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const page = await api.prescriptions({ status, offset, limit });
      if (seq === seqRef.current) {
        setData(page);
        setError(null);
      }
    } catch (e) {
      if (seq === seqRef.current) setError(e.message);
    }
  }, [status, offset]);

  // 演示场景同时新增处方和批次；批次数变化时同步列表，不随自动时钟反复请求。
  useEffect(() => { load(); }, [load, batchCount]);

  return (
    <section aria-label="处方列表">
      <div className="section-head">
        <span className="section-title">处方 · 共 {data.total} 张</span>
        <Space size={4} wrap>
          {STATUS_FILTERS.map((f) => (
            <Tag key={f.label} color={status === f.value ? ACCENT_COLOR : "default"} style={{ cursor: "pointer" }}
                 onClick={() => { setStatus(f.value); setOffset(0); }}>
              {f.label}
            </Tag>
          ))}
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>录入处方</Button>
        </Space>
      </div>
      {error ? <Tag color="error">{error}</Tag> : null}

      <div className="console" style={{ padding: 0, borderTop: "3px solid var(--ink)" }}>
        <Table
          size="small" scroll={{ x: "max-content" }}
          rowKey="id"
          pagination={{
            current: offset / limit + 1, pageSize: limit, total: data.total,
            showSizeChanger: false, onChange: (page) => setOffset((page - 1) * limit),
          }}
          dataSource={data.items}
          columns={[
            { title: "外部编号", dataIndex: "external_no", render: (v, r) => <Link to={`/prescriptions/${r.id}`} className="mono">{v}</Link> },
            { title: "匿名编号", dataIndex: "patient_code", render: (v) => <span className="mono">{v}</span> },
            {
              title: "状态", dataIndex: "status", width: 96,
              render: (v) => <Tag color={STATUS_COLORS[v]} bordered={false}>{PRESCRIPTION_STATUS_LABELS[v] || v}</Tag>,
            },
            { title: "优先级", dataIndex: "priority", width: 72 },
            {
              title: "药组", dataIndex: "herbs",
              render: (herbs) => (
                <Space size={4} wrap>
                  {herbs.slice(0, 3).map((h) => (
                    <Tag key={h.name} bordered={false}
                         color={h.method === "late_add" ? "warning" : h.method === "pre_decoct" ? "processing" : "default"}>
                      {h.name}
                    </Tag>
                  ))}
                  {herbs.length > 3 ? <Tag bordered={false}>+{herbs.length - 3}</Tag> : null}
                </Space>
              ),
            },
            { title: "剂数", dataIndex: "doses", width: 64 },
            {
              title: "批次", dataIndex: "batch_id",
              render: (v) => v ? <Link to={`/batches/${v}`} className="mono">{v}</Link> : <span className="notice">未创建</span>,
            },
            {
              title: "录入时刻", dataIndex: "created_at", width: 104,
              render: (v) => <span className="mono">{formatVirtualDuration(v)}</span>,
            },
            {
              title: "操作", key: "action", width: 88,
              render: (_, r) => r.status === "pending_review"
                ? <Button size="small" onClick={() => setReviewing(r)}>审核</Button>
                : <span className="notice">已审核</span>,
            },
          ]}
        />
      </div>

      <PrescriptionForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      {reviewing ? (
        <ReviewForm prescription={reviewing} open onClose={() => setReviewing(null)} onDone={load} />
      ) : null}
    </section>
  );
}

/** 处方详情：匿名信息、药组、工艺参数、审核记录，以及创建批次入口。 */
export function PrescriptionDetailPage() {
  const { prescriptionId } = useParams();
  const [prescription, setPrescription] = useState(null);
  const [batch, setBatch] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = await api.prescription(prescriptionId);
      setPrescription(p);
      setError(null);
      // 一张处方只对应一个批次；后端对重复创建返回 409
      setBatch(p.batch_id ? await api.batch(p.batch_id).catch(() => null) : null);
    } catch (e) {
      setError(e.message);
    }
  }, [prescriptionId]);

  useEffect(() => { load(); }, [load]);

  const createBatch = async () => {
    setCreating(true);
    try {
      await api.createBatch(prescriptionId);
      message.success("批次已创建，进入调度队列");
      await load();
    } catch (e) {
      message.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (error) return <div className="console"><Tag color="error">{error}</Tag><div style={{ marginTop: 10 }}><Link to="/prescriptions">返回处方列表</Link></div></div>;
  if (!prescription) return <PanelSkeleton />;

  const recipe = prescription.recipe || {};

  return (
    <>
      <div className="section-head">
        <Link to="/prescriptions">← 返回处方列表</Link>
        <span className="notice">处方编号 {prescription.external_no}</span>
      </div>

      <section className="console" aria-label="处方摘要">
        <div className="console-head">
          <div>
            <h4>{prescription.external_no}</h4>
            <Space size={6} wrap>
              <Tag color={STATUS_COLORS[prescription.status]} bordered={false}>
                {PRESCRIPTION_STATUS_LABELS[prescription.status] || prescription.status}
              </Tag>
              <Tag bordered={false}>匿名编号 {prescription.patient_code}</Tag>
              <Tag bordered={false}>优先级 {prescription.priority}</Tag>
              <Tag bordered={false}>{prescription.doses} 剂 × {prescription.bags_per_dose} 袋 × {prescription.bag_volume_ml}ml</Tag>
            </Space>
          </div>
          <Space wrap>
            {prescription.status === "pending_review" ? (
              <Button type="primary" onClick={() => setReviewing(true)}>审核</Button>
            ) : null}
            <Button loading={creating} disabled={prescription.status !== "approved" || Boolean(prescription.batch_id)}
                    onClick={createBatch}>
              {prescription.batch_id ? "批次已创建" : "创建批次"}
            </Button>
          </Space>
        </div>

        {prescription.status !== "approved" ? (
          <Alert className="banner" type="warning" showIcon
                 message={prescription.status === "rejected" ? "该处方已驳回，不能创建批次。" : "处方需人工审核通过后才能创建批次。"} />
        ) : null}

        {prescription.review ? (
          <div style={{ marginTop: 12 }}>
            <div className="section-head"><span className="section-title">审核记录</span></div>
            <Space size={6} wrap>
              <Tag bordered={false} color={prescription.review.approved ? "success" : "error"}>
                {prescription.review.approved ? "通过" : "驳回"}
              </Tag>
              <Tag bordered={false}>操作人 {prescription.review.operator}</Tag>
              <Tag bordered={false}>虚拟时刻 {formatVirtualDuration(prescription.review.sim_time)}</Tag>
            </Space>
            {prescription.review.comment ? <div style={{ marginTop: 6 }}><span className="notice">{prescription.review.comment}</span></div> : null}
          </div>
        ) : null}

        {batch ? (
          <div style={{ marginTop: 14 }}>
            <div className="section-head"><span className="section-title">关联批次</span></div>
            <Space size={6} wrap>
              <Link to={`/batches/${batch.id}`} className="mono">{batch.trace_code}</Link>
              <BatchStatusTag status={batch.status} />
              <Link to={`/trace/${batch.trace_code}`}>查看追溯</Link>
            </Space>
          </div>
        ) : null}
      </section>

      <section className="console" style={{ marginTop: 16 }} aria-label="药组构成">
        <div className="section-head"><span className="section-title">药组构成 · 共 {prescription.herbs?.length ?? 0} 条</span></div>
        <Table size="small" rowKey="name" pagination={false} dataSource={prescription.herbs || []}
               columns={[
                 { title: "饮片", dataIndex: "name", render: (v) => <span className="mono">{v}</span> },
                 { title: "每剂剂量", dataIndex: "grams_per_dose", render: (v) => <span className="mono">{v} g</span> },
                 { title: "煎法", dataIndex: "method", render: (v) => <Tag bordered={false}>{HERB_METHOD_LABELS[v] || v}</Tag> },
                 { title: "合计剂量", key: "total", render: (_, r) => <span className="mono">{(r.grams_per_dose * prescription.doses).toFixed(2)} g</span> },
               ]} />
      </section>

      <section className="console" style={{ marginTop: 16 }} aria-label="工艺参数">
        <div className="section-head">
          <span className="section-title">工艺参数 · 演示假设</span>
          <span className="notice">后下组只在一煎剩余指定时长时投料一次</span>
        </div>
        <div className="chip-row">
          <Chip label="浸泡" value={recipe.soak_seconds} unit="s" />
          <Chip label="先煎" value={recipe.pre_decoct_seconds} unit="s" />
          <Chip label="升温" value={recipe.heat_seconds} unit="s" />
          <Chip label="一煎" value={recipe.first_decoct_seconds} unit="s" />
          <Chip label="二煎" value={recipe.second_decoct_seconds} unit="s" />
          <Chip label="后下提前" value={recipe.late_add_seconds} unit="s" />
          <Chip label="目标温度" value={recipe.target_temperature_c} unit="℃" />
          <Chip label="吸水系数" value={recipe.water_ml_per_g} unit="ml/g" />
          <Chip label="蒸发速率" value={recipe.evaporation_ml_per_minute} unit="ml/min" />
        </div>
        {prescription.note ? <div style={{ marginTop: 8 }}><span className="notice">备注：{prescription.note}</span></div> : null}
      </section>

      {reviewing ? (
        <ReviewForm prescription={prescription} open onClose={() => setReviewing(false)} onDone={load} />
      ) : null}
    </>
  );
}
