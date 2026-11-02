/*
 * 温度曲线。纯 SVG，网格底纹与参考前端的 .trace 一致。
 * 数据源是 backend 的 telemetry.point 事件（虚拟秒 + 温度），
 * 按 docs/ARCHITECTURE.md：温度在工序起始与目标温度间线性插值，仅在阶段边界和推进末尾采样。
 */

const WIDTH = 640;
const HEIGHT = 138;
const PAD = { top: 8, right: 8, bottom: 14, left: 30 };

export function TraceChart({ points, emptyText = "暂无温度采样" }) {
  if (!points || points.length < 2) {
    return <div className="trace-empty"><span className="notice">{emptyText}</span></div>;
  }

  const times = points.map((p) => p.sim_time);
  const temps = points.map((p) => p.temperature_c);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const cMin = Math.min(...temps);
  const cMax = Math.max(...temps);
  // 温度轴留 5% 余量，避免曲线贴边
  const span = Math.max(1e-6, cMax - cMin);
  const lo = cMin - span * 0.05;
  const hi = cMax + span * 0.05;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (c) => PAD.top + plotH - ((c - lo) / (hi - lo)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.sim_time).toFixed(2)},${y(p.temperature_c).toFixed(2)}`).join(" ");
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((r) => lo + (hi - lo) * r);
  const tTicks = t1 === t0 ? [t0] : [t0, t0 + (t1 - t0) / 2, t1];

  return (
    <svg className="trace" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img"
         aria-label={`温度曲线，${points.length} 个采样点，范围 ${cMin.toFixed(1)} 至 ${cMax.toFixed(1)} 摄氏度`}>
      {gridLines.map((c) => (
        <g key={c}>
          <line className="trace-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(c)} y2={y(c)} />
          <text className="trace-axis" x={PAD.left - 4} y={y(c) + 3} textAnchor="end">{c.toFixed(0)}</text>
        </g>
      ))}
      <line className="trace-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
      {tTicks.map((t, i) => (
        <text key={i} className="trace-axis" x={x(t)} y={HEIGHT - 3} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>
          {Math.round(t)}s
        </text>
      ))}
      <path className="trace-line" d={path} stroke="var(--accent)" />
    </svg>
  );
}
