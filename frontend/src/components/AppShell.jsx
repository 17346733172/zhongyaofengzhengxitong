import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, InputNumber, Menu, Space, Tag, message } from "antd";
import { api } from "../api/client";
import { formatVirtualDuration } from "../domain/labels";

const NAV = [
  { to: "/overview", label: "总览" },
  { to: "/simulation", label: "仿真工作台" },
  { to: "/prescriptions", label: "处方" },
  { to: "/batches", label: "批次" },
];

const CONNECTION_LABELS = {
  open: { color: "success", text: "已连接" },
  connecting: { color: "processing", text: "连接中" },
  closed: { color: "error", text: "已断开" },
};

const DEFAULT_SPEED = 60;
const DEFAULT_STEP = 3600;

/**
 * 应用外壳。顶栏常驻虚拟时钟、运行状态、倍率与连接状态；
 * 全局控制（开始/暂停/步进）与单批次控制分开，符合 DESIGN.md 的交互原则。
 * clock 为 null 表示还没拿到任何快照，此时一律显示 —，不推断暂停或倍率。
 */
export function AppShell({ clock, connection, onChanged, children }) {
  const location = useLocation();
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [stepSeconds, setStepSeconds] = useState(DEFAULT_STEP);
  const [pending, setPending] = useState(null); // "start" | "pause" | "step" | null
  const running = clock?.running === true;
  const hasClock = clock !== null && clock !== undefined;

  const act = async (which, fn, okText) => {
    setPending(which);
    try {
      await fn();
      message.success(okText);
      onChanged?.();
    } catch (error) {
      message.error(error.message);
    } finally {
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
            <Tag bordered={false}>{hasClock ? (running ? "自动运行" : "已暂停") : "无数据"}</Tag>
            <Tag bordered={false} color={running ? "processing" : "default"}>
              倍率 ×{hasClock ? clock.speed : "—"}
            </Tag>
            {/* 连接状态是用户需要知道的状态变化，用 aria-live 播报；时钟每秒变数次，不播报 */}
            <span aria-live="polite">
              <Tag color={CONNECTION_LABELS[connection]?.color}>{CONNECTION_LABELS[connection]?.text}</Tag>
            </span>
            <span className="mono" role="timer" aria-label="虚拟时钟"
                  style={{ fontSize: 15, fontWeight: 650 }} title="虚拟时间，非真实时间">
              {hasClock ? formatVirtualDuration(clock.now) : "—"}
            </span>
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
          {children}
        </main>
      </div>

      {/* 全局控制放在页面底部，避免与顶栏时钟争抢注意力 */}
      <ControlBar
        running={running}
        pending={pending}
        speed={speed}
        stepSeconds={stepSeconds}
        onSpeed={setSpeed}
        onStepSeconds={setStepSeconds}
        onStart={() => act("start", () => api.start(speed ?? DEFAULT_SPEED), "已开始自动运行")}
        onPause={() => act("pause", () => api.pause(), "已暂停")}
        onStep={() => act("step", () => api.step(stepSeconds ?? DEFAULT_STEP), `已推进 ${stepSeconds ?? DEFAULT_STEP} 虚拟秒`)}
      />
    </div>
  );
}

function SideNav({ pathname }) {
  const navigate = useNavigate();
  const selected = NAV.find((item) => pathname.startsWith(item.to))?.to;
  const items = [
    ...NAV.map((item) => ({ key: item.to, label: item.label })),
    // 外部链接自带 target，交给 <a> 处理，不参与路由跳转
    { key: "__docs", label: <a href="/docs" target="_blank" rel="noreferrer">Swagger 调试</a> },
  ];
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

function ControlBar({ running, pending, speed, stepSeconds, onSpeed, onStepSeconds, onStart, onPause, onStep }) {
  // 每个按钮只在自己的请求在飞时转圈，避免点“开始”把“暂停”也置为 loading
  const spin = (which) => pending === which;
  return (
    <section className="console" style={{ marginTop: 20 }} aria-label="全局仿真控制">
      <div className="console-head">
        <div>
          <h4>全局仿真控制</h4>
          <span className="section-title">时间单位为虚拟秒，与真实时间无关</span>
        </div>
        <Space wrap>
          <Space.Compact>
            <InputNumber min={0.1} max={3600} value={speed} onChange={onSpeed} style={{ width: 96 }}
                         aria-label="自动运行倍率" />
            <Button type="primary" loading={spin("start")} onClick={onStart} disabled={running}>开始</Button>
          </Space.Compact>
          <Button loading={spin("pause")} onClick={onPause} disabled={!running}>暂停</Button>
          <Space.Compact>
            <InputNumber min={1} max={86400} value={stepSeconds} onChange={onStepSeconds} style={{ width: 96 }}
                         aria-label="手动推进秒数" />
            <Button loading={spin("step")} onClick={onStep} disabled={running}>手动推进</Button>
          </Space.Compact>
        </Space>
      </div>
      {running ? (
        <Alert className="banner" type="info" showIcon
               message="自动运行中，手动推进已停用。需要精确控制工序边界时，请先暂停。" />
      ) : (
        <span className="notice">已暂停。手动推进会精确处理到最近的工序完成点或后下投料点，不会跳过中间工序。</span>
      )}
    </section>
  );
}
