import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { fetchSchoolSettings } from "../services/SchoolSettingsServiceApi";

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 12 month names starting at the session's first month (1–12). 4 → Apr … Mar, 8 → Aug … Jul. */
export function orderedMonths(startMonth = 4) {
  const s = Math.min(12, Math.max(1, parseInt(startMonth, 10) || 4)) - 1;
  return [...NAMES.slice(s), ...NAMES.slice(0, s)];
}

// One fetch per school per app run; SchoolSettingsScreen updates it on save.
const cache = {};          // clientCode → start month
const listeners = new Set();

export function setSessionStartMonth(clientCode, month) {
  if (!clientCode) return;
  cache[clientCode] = Math.min(12, Math.max(1, parseInt(month, 10) || 4));
  listeners.forEach((fn) => fn());
}

/** Month names in session order for the logged-in school (April start until loaded). */
export default function useSessionMonths() {
  const { user } = useContext(AuthContext);
  const code = user?.ssmsClientCode || "";
  const [, bump] = useState(0);

  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (code && cache[code] === undefined && user?.token) {
      cache[code] = null; // loading
      fetchSchoolSettings(user)
        .then((d) => setSessionStartMonth(code, d?.session_start_month ?? 4))
        .catch(() => { delete cache[code]; });
    }
    return () => listeners.delete(fn);
  }, [code, user?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  return orderedMonths(cache[code] || 4);
}
