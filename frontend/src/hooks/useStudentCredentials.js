import { useState, useEffect, useCallback } from "react";
import { api } from "../utils/api.js";

/** A student's own credential history, newest first. */
export function useStudentCredentials(address) {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const { credentials: creds } = await api.get(`/students/${address}/credentials`);
      setCredentials([...creds].reverse());
    } catch (err) {
      console.error("[useStudentCredentials] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A superseded Offer no longer counts — it's been corrected (e.g. rescinded)
  // by a later record, same "any non-superseded Offer" rule the contract itself uses.
  const isPlaced = credentials.some((c) => c.credType === "Offer" && !c.superseded);

  return { credentials, loading, isPlaced, refresh };
}
