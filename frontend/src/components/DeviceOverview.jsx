import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty } from "antd";
import {
  CheckSquareOutlined, ClearOutlined, ClockCircleOutlined, ContainerOutlined,
  DeleteOutlined, ExperimentOutlined, FilterOutlined, FireOutlined, InboxOutlined,
  MedicineBoxOutlined, SafetyCertificateOutlined, SendOutlined, SwapOutlined,
  TagsOutlined, ToolOutlined,
} from "@ant-design/icons";
import { Chip, DeviceStatusTag, Lamp } from "./Display";
import {
  DEVICE_KIND_LABELS, DEVICE_STATUS_LABELS, formatPercent,
  formatTemperature, formatVirtualDuration,
} from "../domain/labels";

const DEVICE_PRESENTATION = {
  pot: { icon: ContainerOutlined, purpose: "批次全程保留，倒渣与清洗完成后释放。" },
  dispenser: { icon: MedicineBoxOutlined, purpose: "饮片调剂与包煎分包。" },
  verification: { icon: CheckSquareOutlined, purpose: "核对调剂结果，仿真中自动通过。" },
  conveyor: { icon: SwapOutlined, purpose: "承担药锅输送与常规药组入锅。" },
  water: { icon: ExperimentOutlined, purpose: "按批次水量计划进行一煎、二煎加水。" },
  soaking: { icon: ClockCircleOutlined, purpose: "按批次工艺参数进行浸泡。" },
  decocter: { icon: FireOutlined, purpose: "执行先煎、升温及一煎、二煎工序。" },
  filter: { icon: FilterOutlined, purpose: "一煎滤液暂存与两煎药液合并。" },
  packer: { icon: InboxOutlined, purpose: "按处方袋数进行仿真灌装包装。" },
  labeler: { icon: TagsOutlined, purpose: "为包装成品贴附仿真标签。" },
  quality: { icon: SafetyCertificateOutlined, purpose: "成品质检，仿真中自动通过。" },
  dispatch: { icon: SendOutlined, purpose: "配发仿真成品，计入已配发袋数。" },
  residue: { icon: DeleteOutlined, purpose: "正常生产或取消批次后清除药渣。" },
  washer: { icon: ClearOutlined, purpose: "完成一方一清洗，清洗后才释放锅具。" },
};

function deviceSummary(device, batch) {
  if (device.status === "fault") return "设备故障，等待修复";
  if (device.status === "offline") return "设备已停用";
  if (device.batch_id) return batch?.current_stage_name || "批次占用中";
  return device.kind === "pot" ? "洁净待用" : "空闲待工";
}

function DetailField({ label, children }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

/** 分类入口只展示类型汇总，每种类型进入独立路由。 */
export function DeviceTypeIndex({ devices = [] }) {
  return (
    <div className="device-type-index" aria-label="设备分类入口">
      {Object.entries(DEVICE_KIND_LABELS).map(([kind, label]) => {
        const items = devices.filter((device) => device.kind === kind);
        const PresentationIcon = DEVICE_PRESENTATION[kind]?.icon || ToolOutlined;
        return (
          <Link key={kind} to={`/devices/${kind}`} className="device-type-entry" aria-label={`查看${label}，共 ${items.length} 台`}>
            <span className="device-type-entry-head"><PresentationIcon aria-hidden="true" /><strong>{label}</strong><span className="notice">{items.length} 台</span></span>
            <span className="device-type-description">{DEVICE_PRESENTATION[kind]?.purpose}</span>
            {items[0]?.default_processing_seconds != null ? <span className="notice">默认每次用时 {items[0].default_processing_seconds / 60} 分钟</span> : null}
            <span className="device-type-counts">
              {Object.entries(DEVICE_STATUS_LABELS).map(([status, statusLabel]) => (
                <span key={status}>{statusLabel} <strong className="mono">{items.filter((device) => device.status === status).length}</strong></span>
              ))}
            </span>
            <span className="device-type-open">查看设备与利用率 →</span>
          </Link>
        );
      })}
    </div>
  );
}

/** 单一设备类型的卡片和详情，类型由路由指定。 */
export function DeviceOverview({ kind, devices = [], batches = [] }) {
  const [selectedId, setSelectedId] = useState(null);
  const items = useMemo(() => devices.filter((device) => device.kind === kind), [devices, kind]);
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);
  const group = { kind, label: DEVICE_KIND_LABELS[kind] || kind, devices: items };
  const selected = items.find((device) => device.id === selectedId) || items[0];

  if (!selected) return <div className="console"><Empty description={`暂无${group.label}设备`} /></div>;

  const owner = batchById.get(selected.batch_id);
  const PresentationIcon = DEVICE_PRESENTATION[group.kind]?.icon || ToolOutlined;

  return (
    <div className="device-overview">
      <div className="device-group-head">
        <h3>{group.label}<span className="notice">共 {group.devices.length} 台</span></h3>
        <div className="chip-row" aria-label="该类型设备状态汇总">
          {Object.entries(DEVICE_STATUS_LABELS).map(([status, label]) => (
            <Chip key={status} label={label} value={group.devices.filter((device) => device.status === status).length} />
          ))}
          {selected.default_processing_seconds != null ? <Chip label="默认每次用时" value={selected.default_processing_seconds / 60} unit="分钟" /> : null}
        </div>
      </div>

      <div className="device-grid" aria-label={`${group.label}设备卡片`}>
        {group.devices.map((device) => {
          const batch = batchById.get(device.batch_id);
          const isSelected = device.id === selected.id;
          return (
            <button key={device.id} type="button"
                    className={`device-card${isSelected ? " is-selected" : ""}`}
                    aria-label={`${device.name}，${DEVICE_STATUS_LABELS[device.status] || device.status}，利用率 ${formatPercent(device.utilization_percent)}%`}
                    aria-pressed={isSelected} aria-controls="overview-device-detail"
                    onClick={() => setSelectedId(device.id)}>
              <span className="device-card-head">
                <Lamp status={device.status} />
                <strong>{device.name}</strong>
                <DeviceStatusTag status={device.status} />
              </span>
              <span className="device-instrument">
                <PresentationIcon aria-hidden="true" />
                <span className="device-utilization">
                  <span className="notice">利用率</span>
                  <strong className="mono">{formatPercent(device.utilization_percent)}<small>%</small></strong>
                </span>
              </span>
              <span className="device-card-duration">占用 <span className="mono">{formatVirtualDuration(device.occupied_seconds)}</span></span>
              <span className="device-card-stage">{deviceSummary(device, batch)}</span>
              <span className={`device-card-owner${device.batch_id ? " mono" : ""}`}>
                {device.batch_id || "未分配批次"}
              </span>
            </button>
          );
        })}
      </div>

      <section id="overview-device-detail" className="console device-detail" aria-label="选中设备详情">
        <div className="device-detail-head">
          <h3><PresentationIcon aria-hidden="true" />{selected.name}<DeviceStatusTag status={selected.status} /></h3>
          <Link to="/simulation">前往工作台操作设备 →</Link>
        </div>
        <dl className="device-detail-grid">
          <DetailField label="设备编号"><span className="mono">{selected.id}</span></DetailField>
          <DetailField label="设备类型">{group.label}</DetailField>
          <DetailField label="所属批次">
            {selected.batch_id ? <Link to={`/batches/${selected.batch_id}`} className="mono">{selected.batch_id}</Link> : "—"}
          </DetailField>
          <DetailField label="当前工序">{owner?.current_stage_name || deviceSummary(selected, owner)}</DetailField>
          <DetailField label="累计占用时长"><span className="mono">{formatVirtualDuration(selected.occupied_seconds)}</span></DetailField>
          <DetailField label="有效工作时长"><span className="mono">{formatVirtualDuration(selected.productive_seconds)}</span></DetailField>
          <DetailField label="设备利用率"><span className="mono">{formatPercent(selected.utilization_percent)}%</span></DetailField>
          {selected.kind === "pot" ? (
            <DetailField label="仿真容量"><span className="mono">{selected.capacity_ml} ml</span></DetailField>
          ) : (
            <DetailField label="加入时运行计时"><span className="mono">{formatVirtualDuration(selected.added_at)}</span></DetailField>
          )}
        </dl>
        {owner ? (
          <div className="device-batch-summary">
            <div className="chip-row">
              <Chip label="批次进度" value={owner.progress_percent} unit="%" />
              <Chip label="仿真温度" value={formatTemperature(owner.temperature_c)} unit="℃" />
            </div>
            {owner.waiting_reason ? <p className="waiting-reason">等待原因：{owner.waiting_reason}</p> : null}
          </div>
        ) : null}
        <p className="device-purpose">{DEVICE_PRESENTATION[group.kind]?.purpose || "按批次工序分配的仿真资源。"}</p>
        <p className="notice">利用率按有效工作时长与设备加入后的累计运行时长计算；单批次暂停、排队和故障期间仍保留设备占用。</p>
      </section>
    </div>
  );
}
