import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, InputNumber, Menu, Space, Tag, message } from "antd";
import { api } from "../api/client";
import { formatVirtualDuration } from "../domain/labels";

const NAV = [
  { to: "/overview", label: "总览" },
  { to: "/simulation", label: "仿真工作台" },
  { to: "/devices", label: "设备分类" },
  { to: "/prescriptions", label: "处方" },
  { to: "/batches", label: "批次" },
];

const CONNECTION_LABELS = {
  open: { color: "success", text: "已连接" },
  connecting: { color: "processing", text: "连接中" },
  closed: { color: "error", text: "已断开" },
};

const DEFAULT_SCENARIO_COUNT = 5;
const WALL_CLOCK_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/**
 * 顶栏显示当前北京时间；调度进度来自后端1倍速计时，暂停时保留资源。
 */
export function AppShell({ clock, connection, onChanged, children }) {
  const location = useLocation();
  const [wallNow, setWallNow] = useState(() => new Date());
  const [scenarioCount, setScenarioCount] = useState(DEFAULT_SCENARIO_COUNT);
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(false);
  const running = clock?.running === true;
  const hasClock = clock !== null && clock !== undefined;
  useEffect(() => {
    const timer = setInterval(() => setWallNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const act = async (which, fn, okText) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(which);
    try {
      await fn();
      message.success(okText);
      await onChanged?.();
    } catch (error) {
      message.error(error.message);
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  return (
    <div className="floor">
      <header className="topbar">
        <div className="topbar-head">
          <h3>中药煎药流程仿真平台</h3>
          <span className="silkscreen">TCM DECOCTION · PROCESS SIMULATION CONSOLE</span>
        </div>
        <div className="topbar-clock">
          <Space size={8} wrap>
            <Tag bordered={false}>{hasClock ? (running ? "真实计时运行" : "已暂停") : "无数据"}</Tag>
            <Tag bordered={false} color={running ? "processing" : "default"}>
              真实时间 · 1 倍速
            </Tag>
            {/* 连接状态播报；当前时间每秒更新，不主动播报。 */}
            <span aria-live="polite">
              <Tag color={CONNECTION_LABELS[connection]?.color}>{CONNECTION_LABELS[connection]?.text}</Tag>
            </span>
            <time className="mono" role="timer" aria-label="当前北京时间" dateTime={wallNow.toISOString()}
                  style={{ fontSize: 14, fontWeight: 650 }}>
              {WALL_CLOCK_FORMAT.format(wallNow)}
            </time>
          </Space>
        </div>
      </header>

      <div className="shell">
        <nav className="sidenav" aria-label="主导航">
          <SideNav pathname={location.pathname} />
          <div className="sidenav-note">
            仿真演示数据，不用于临床煎药或真实设备控制。
          </div>
        </nav>

        <main className="workspace">
          {connection === "closed" ? (
            <Alert className="banner" type="warning" showIcon
                   message="与后端的实时推送已断开，正在重连；界面数据可能不是最新。" />
          ) : null}
          <ControlBar
            hasClock={hasClock}
            running={running}
            pending={pending}
            elapsedSeconds={clock?.now}
            scenarioCount={scenarioCount}
            onScenarioCount={setScenarioCount}
            onGenerate={() => act("scenario", () => api.createScenario(scenarioCount ?? DEFAULT_SCENARIO_COUNT),
              `已新增 ${scenarioCount ?? DEFAULT_SCENARIO_COUNT} 个演示批次，可开始真实计时运行`)}
            onStart={() => act("start", () => api.start(), "已开始真实计时运行")}
            onPause={() => act("pause", () => api.pause(), "已暂停")}
          />
          {children}
        </main>
      </div>
    </div>
  );
}

function SideNav({ pathname }) {
  const navigate = useNavigate();
  const selected = NAV.find((item) => pathname.startsWith(item.to))?.to;
  const items = NAV.map((item) => ({ key: item.to, label: item.label }));
  return (
    <Menu
      mode="inline"
      items={items}
      selectedKeys={selected ? [selected] : []}
      onClick={({ key }) => {
        const target = NAV.find((item) => item.to === key);
        if (target) navigate(target.to);
      }}
    />
  );
}

function ControlBar({ hasClock, running, pending, elapsedSeconds, scenarioCount,
  onScenarioCount, onGenerate, onStart, onPause }) {
  // 每个按钮只在自己的请求在飞时转圈，避免点“开始”把“暂停”也置为 loading
  const spin = (which) => pending === which;
  const disabled = !hasClock || pending !== null;
  return (
    <section className="console simulation-controls" aria-label="全局仿真控制">
      <div className="console-head">
        <div>
          <h4>全局仿真控制</h4>
          <span className="section-title">按现实时间计时：1 秒就是现实 1 秒，调剂 10 分钟需实际运行 10 分钟</span>
        </div>
        <Space wrap>
          <Space.Compact>
            <InputNumber min={1} max={50} precision={0} value={scenarioCount} onChange={onScenarioCount}
                         disabled={disabled} style={{ width: 88 }} aria-label="演示批次数量" />
            <Button loading={spin("scenario")} onClick={onGenerate} disabled={disabled}>生成演示数据</Button>
          </Space.Compact>
          <Button type="primary" loading={spin("start")} onClick={onStart} disabled={disabled || running}>开始</Button>
          <Button loading={spin("pause")} onClick={onPause} disabled={disabled || !running}>暂停</Button>
          <span className="notice">累计运行 <span className="mono">{hasClock ? formatVirtualDuration(elapsedSeconds) : "—"}</span></span>
        </Space>
      </div>
      <p className="notice">演示批次数量 1–50，每次生成均新增匿名处方和批次，包含常规、包煎、先煎或后下示例；生成后点击「开始」。</p>
      {!hasClock ? (
        <span className="notice">尚未取得仿真状态，请等待后端连接后操作。</span>
      ) : running ? (
        <Alert className="banner" type="info" showIcon
               message="正在按真实时间运行。暂停期间不累计工序用时，继续后从原进度运行。" />
      ) : (
        <span className="notice">已暂停，当前设备分配与工序进度保留；点击「开始」后按真实时间继续。</span>
      )}
    </section>
  );
}
