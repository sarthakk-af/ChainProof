import { useState, useEffect, useCallback } from "react";
import { api } from "../utils/api.js";

/** All registered students, already enriched by the backend with pipeline stage + placed status. */
export function useStudentList() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { students: list } = await api.get("/students");
      setStudents(list);
    } catch (err) {
      console.error("[useStudentList] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { students, loading, refresh };
}
