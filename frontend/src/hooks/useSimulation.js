/*
 * WebSocket 与 REST 补偿共用同一份快照，见 docs/REGISTRY.md。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, BASE } from "../api/client";

const RECONNECT_DELAY_MS = 1500;
const AUTH_TIMEOUT_MS = 5000; // 后端给 WebSocket 首条消息认证的窗口

export function useSimulation() {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("connecting"); // connecting | open | closed
  const session = useRef(null);

  const accept = useCallback((incoming) => {
    if (!incoming?.clock) return;
    setSnapshot((current) => {
      if (!current || incoming.last_event_id > current.last_event_id || (
        incoming.last_event_id === current.last_event_id && incoming.clock.now > current.clock.now
      )) return incoming;
      return current;
    });
  }, []);

  // 断线补偿：重新拉取 REST 快照。失败时保留上一份，由连接状态另行反映
  const refresh = useCallback(async () => {
    const signal = session.current?.signal;
    if (!signal || signal.aborted) return;
    try {
      const data = await api.snapshot(signal);
      if (!signal.aborted) accept(data);
    } catch {
      /* 忽略：连接状态会告诉用户当前不可用 */
    }
  }, [accept]);

  useEffect(() => {
    const lifetime = new AbortController();
    session.current = lifetime;
    const { signal } = lifetime;
    let socket;
    let retryTimer;
    let authTimer;

    const retry = () => {
      if (signal.aborted) return;
      setStatus("closed");
      retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    const connect = () => {
      if (signal.aborted) return;
      // 未显式指定后端地址时走同源代理，与 REST 保持同一来源
      const wsUrl = BASE
        ? BASE.replace(/^http/, "ws") + "/ws/simulation"
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/simulation`;

      refresh();
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        retry();
        return;
      }

      // 浏览器无法自定义 WebSocket 请求头，密钥按后端约定走首条消息
      socket.onopen = () => {
        if (signal.aborted || !import.meta.env.VITE_API_KEY) return;
        socket.send(JSON.stringify({ api_key: import.meta.env.VITE_API_KEY }));
        authTimer = setTimeout(() => socket.close(), AUTH_TIMEOUT_MS);
      };

      socket.onmessage = (event) => {
        if (signal.aborted) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "snapshot") {
          clearTimeout(authTimer);
          accept(message.data);
          setStatus("open");
        }
        // heartbeat 只证明连接存活，不更新数据
      };

      socket.onclose = () => {
        clearTimeout(authTimer);
        retry();
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      lifetime.abort();
      clearTimeout(retryTimer);
      clearTimeout(authTimer);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [accept, refresh]);

  return { snapshot, status, refresh };
}
