import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Tag } from "antd";
import { AppShell } from "./components/AppShell";
import { OverviewPage } from "./pages/OverviewPage";
import { SimulationPage } from "./pages/SimulationPage";
import { BatchListPage } from "./pages/BatchListPage";
import { BatchDetailPage } from "./pages/BatchDetailPage";
import { PrescriptionDetailPage, PrescriptionListPage } from "./pages/PrescriptionPages";
import { TracePage } from "./pages/TracePage";
import { DevicePage } from "./pages/DevicePages";
import { useSimulation } from "./hooks/useSimulation";

export default function App() {
  const { snapshot, status, refresh } = useSimulation();
  const clock = snapshot?.clock;

  // WebSocket 只读；任何 REST 操作后主动补一次快照，不必等下一轮推送
  useEffect(() => {
    document.title = clock?.running ? "煎药仿真 · 自动运行" : "煎药仿真 · 已暂停";
  }, [clock?.running]);

  return (
    <BrowserRouter>
      <AppShell clock={clock} connection={status} onChanged={refresh}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage snapshot={snapshot} />} />
          <Route path="/devices" element={<DevicePage snapshot={snapshot} />} />
          <Route path="/devices/:kind" element={<DevicePage snapshot={snapshot} />} />
          <Route path="/simulation" element={<SimulationPage snapshot={snapshot} onChanged={refresh} />} />
          <Route path="/prescriptions" element={<PrescriptionListPage batchCount={snapshot?.batches?.length} />} />
          <Route path="/prescriptions/:prescriptionId" element={<PrescriptionDetailPage />} />
          <Route path="/batches" element={<BatchListPage batches={snapshot?.batches} />} />
          <Route path="/batches/:batchId" element={<BatchDetailPage snapshot={snapshot} onChanged={refresh} />} />
          <Route path="/trace/:traceCode" element={<TracePage />} />
          <Route path="*" element={<div className="console"><Tag color="error">页面不存在</Tag></div>} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
