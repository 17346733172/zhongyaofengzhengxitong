import { useEffect, useState } from "react";
import { api } from "../api/client";

export function useDashboard(snapshot, enabled = true) {
  const [legacy, setLegacy] = useState(null);
  const needsLegacy = enabled && snapshot && !snapshot.summary;

  useEffect(() => {
    if (!needsLegacy) return;
    const controller = new AbortController();
    let timer;
    // A running backend may still have the old snapshot format until restarted.
    const poll = async () => {
      try {
        const data = await api.dashboard(controller.signal);
        if (!controller.signal.aborted) setLegacy({ data, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setLegacy({ data: null, error: error.message });
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    };
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [needsLegacy]);

  if (snapshot?.summary) return { data: { ...snapshot.summary, devices: snapshot.devices }, error: null };
  return legacy || { data: null, error: null };
}
