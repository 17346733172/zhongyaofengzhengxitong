import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Tag } from "antd";
import { api } from "../api/client";
import { DeviceOverview, DeviceTypeIndex } from "../components/DeviceOverview";
import { PanelSkeleton } from "../components/Display";
import { DEVICE_KIND_LABELS } from "../domain/labels";

/** /devices 为类型入口；/devices/:kind 只展示指定类型的设备。 */
export function DevicePage({ clock, lastEventId, batches }) {
  const { kind } = useParams();
  const validKind = kind === undefined || Object.hasOwn(DEVICE_KIND_LABELS, kind);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!validKind) return;
    let alive = true;
    api.dashboard().then((result) => {
      if (alive) { setData(result); setError(null); }
    }).catch((reason) => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [clock?.now, lastEventId, validKind]);

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
        <DeviceOverview key={kind} kind={kind} devices={data.devices} batches={batches} />
      ) : <DeviceTypeIndex devices={data.devices} />}
    </section>
  );
}
