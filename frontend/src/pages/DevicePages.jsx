import { Link, useParams } from "react-router-dom";
import { Tag } from "antd";
import { DeviceOverview, DeviceTypeIndex } from "../components/DeviceOverview";
import { PanelSkeleton } from "../components/Display";
import { DEVICE_KIND_LABELS } from "../domain/labels";
import { useDashboard } from "../hooks/useDashboard";

/** /devices 为类型入口；/devices/:kind 只展示指定类型的设备。 */
export function DevicePage({ snapshot }) {
  const { kind } = useParams();
  const validKind = kind === undefined || Object.hasOwn(DEVICE_KIND_LABELS, kind);
  const { data, error } = useDashboard(snapshot, validKind);

  if (!validKind) {
    return <div className="console"><Tag color="error">设备类型不存在</Tag><p><Link to="/devices">返回设备分类</Link></p></div>;
  }

  const label = kind ? DEVICE_KIND_LABELS[kind] : "设备分类";
  return (
    <section aria-label={`${label}页面`}>
      <div className="device-page-head">
        <div>
          <h2>{label}</h2>
          <p className="notice">{kind ? `本页只显示${label}，点击设备卡片查看详情与利用率。` : "选择设备类型，进入该类型的独立设备页面。"}</p>
        </div>
        <Link to={kind ? "/devices" : "/overview"}>{kind ? "← 返回设备分类" : "← 返回总览"}</Link>
      </div>
      {error ? <div className="console"><Tag color="error">{error}</Tag></div> : !data ? <PanelSkeleton /> : kind ? (
        <DeviceOverview key={kind} kind={kind} devices={data.devices} batches={snapshot?.batches} />
      ) : <DeviceTypeIndex devices={data.devices} />}
    </section>
  );
}
