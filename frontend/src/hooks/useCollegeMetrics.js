import { useState, useEffect, useCallback } from "react";
import { api } from "../utils/api.js";

/** Placement metrics for one college, polled every 10s to reflect new placements. */
export function useCollegeMetrics(address) {
  const [totalRegistered, setTotalRegistered] = useState(0);
  const [totalPlaced, setTotalPlaced] = useState(0);
  const [placementPct, setPlacementPct] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const stats = await api.get(`/colleges/${address}/placement`);
      setTotalRegistered(stats.registered);
      setTotalPlaced(stats.placed);
      setPlacementPct(stats.percentage.toFixed(2));
    } catch (err) {
      console.error("[useCollegeMetrics] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { totalRegistered, totalPlaced, placementPct, loading, refresh };
}
