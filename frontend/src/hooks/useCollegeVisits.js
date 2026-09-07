import { useState, useEffect, useCallback } from "react";
import { api } from "../utils/api.js";

/** A college's own published visit announcements, newest first. */
export function useCollegeVisits(address) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const { visits: v } = await api.get(`/colleges/${address}/visits`);
      setVisits([...v].reverse());
    } catch (err) {
      console.error("[useCollegeVisits] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { visits, loading, refresh };
}
