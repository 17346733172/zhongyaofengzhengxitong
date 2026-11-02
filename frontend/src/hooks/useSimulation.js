/*
 * 仿真快照订阅。遵循 backend/docs/REGISTRY.md 的推送约定：
 *   - WebSocket 只读，控制命令一律走 REST；
 *   - 消息为 {"type":"snapshot","data":{...}} 或 {"type":"heartbeat","last_event_id":N}；
 *   - 断线后先重新拉取 REST 快照，再继续订阅推送。
 *
 * main.jsx 包了 StrictMode，effect 会 setup→cleanup→setup 跑两轮，因此每条连接
 * 都要能识别自己是否已被取代：用 per-effect 的 disposed 标志，不用共享 ref。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, BASE } from "../api/client";

const RECONNECT_DELAY_MS = 1500;
const AUTH_TIMEOUT_MS = 5000; // 后端给 WebSocket 首条消息认证的窗口

export function useSimulation() {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("connecting"); // connecting | open | closed
  const retryRef = useRef(null);

  // 断线补偿：重新拉取 REST 快照。失败时保留上一份，由连接状态另行反映
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
    } catch {
      /* 忽略：连接状态会告诉用户当前不可用 */
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      // 未显式指定后端地址时走同源代理，与 REST 保持同一来源
      const wsUrl = BASE
        ? BASE.replace(/^http/, "ws") + "/ws/simulation"
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/simulation`;

      let socket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        if (!disposed) {
          setStatus("closed");
          retryRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
        return;
      }

      // 浏览器无法自定义 WebSocket 请求头，密钥按后端约定走首条消息
      const needsAuth = Boolean(import.meta.env.VITE_API_KEY);
      let authenticated = !needsAuth;
      let authTimer = null;

      const clearAuthTimer = () => {
        if (authTimer !== null) {
          clearTimeout(authTimer);
          authTimer = null;
        }
      };

      // 每次连接前都补一次 REST 快照：覆盖首次加载与断线重连两种情况
      refresh();

      socket.onopen = () => {
        if (disposed) return;
        setStatus("open");
        if (!needsAuth) return;
        socket.send(JSON.stringify({ api_key: import.meta.env.VITE_API_KEY }));
        authTimer = setTimeout(() => {
          authTimer = null;
          // 后端 5 秒内收不到合法密钥会以 1008 关闭；这里兜底避免半开连接
          if (!authenticated && socket.readyState === WebSocket.OPEN) socket.close();
        }, AUTH_TIMEOUT_MS);
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "snapshot") {
          authenticated = true;
          clearAuthTimer();
          setSnapshot(message.data);
        }
        // heartbeat 只证明连接存活，不更新数据
      };

      socket.onclose = () => {
        clearAuthTimer();
        if (disposed) return; // 被 StrictMode 的二轮 setup 或卸载取代，不报警
        setStatus("closed");
        retryRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryRef.current);
    };
  }, [refresh]);

  return { snapshot, status, refresh };
}
