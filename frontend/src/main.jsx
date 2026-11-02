import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./styles/tokens.css";
import "./styles/app.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#c1440e",
          colorInfo: "#175cd3",
          colorSuccess: "#1a7f4b",
          colorWarning: "#b45309",
          colorError: "#b42318",
          borderRadius: 3,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Table: { headerBg: "#f3f5f7", borderRadius: 3, fontSize: 12 },
          Tag: { borderRadiusSM: 3 },
          Button: { borderRadius: 3 },
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </StrictMode>
);
