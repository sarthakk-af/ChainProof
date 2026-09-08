import { useState, useEffect, useCallback } from "react";
import { api } from "../utils/api.js";

/** Students registered under one specific college, so a college only ever sees its own. */
export function useCollegeStudents(collegeAddress) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!collegeAddress) return;
    try {
      const { students: list } = await api.get(`/students?college=${collegeAddress}`);
      setStudents(list);
    } catch (err) {
      console.error("[useCollegeStudents] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [collegeAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { students, loading, refresh };
}
