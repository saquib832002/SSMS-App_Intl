/**
 * Under the From / To dates of a leave or absence: how many school days that is,
 * and which days don't count (weekly off days from School Settings, holidays).
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { countSchoolDays, niceDate } from "../services/StudentLeaveApi";
import { _t } from "../services/i18n";

export default function SchoolDaysPreview({ user, enrollmentId, from, to }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    setD(null);
    if (!enrollmentId || !from) return undefined;
    const t = setTimeout(() => {
      countSchoolDays(user, enrollmentId, from, to || from).then((r) => { if (alive) setD(r); }).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [enrollmentId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d || !d.calendar_days) return null;
  const skipped = Array.isArray(d.skipped) ? d.skipped : [];
  const weekend = skipped.filter((s) => s.why === "weekend");
  const hol     = skipped.filter((s) => s.why === "holiday");
  const none    = d.school_days === 0;
  return (
    <View style={[st.box, none && st.boxWarn]}>
      <Feather name={none ? "alert-circle" : "calendar"} size={15} color={none ? "#b45309" : "#5b21b6"} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={[st.main, none && { color: "#b45309" }]}>
          {none ? _t("No school days in these dates – no leave needed")
            : _t("{school_days} school day{pl}{v}", { school_days: d.school_days, pl: d.school_days === 1 ? "" : "s", v: skipped.length ? ` ${_t("(of {calendar_days} calendar days)", { calendar_days: d.calendar_days })}` : "" })}
        </Text>
        {weekend.length > 0 && (
          <Text style={st.sub}>{_t("Weekly off, not counted: {v}", { v: weekend.map((s) => niceDate(s.date)).join(", ") })}</Text>
        )}
        {hol.length > 0 && (
          <Text style={st.sub}>{_t("Holiday, not counted: {v}", { v: hol.map((s) => `${niceDate(s.date)}${s.name ? ` (${s.name})` : ""}`).join(", ") })}</Text>
        )}
        {d.needs_principal && !none && (
          <Text style={[st.sub, { color: "#3730a3", fontWeight: "700" }]}>{_t("More than {principal_days} school days – the principal or owner also approves.", { principal_days: d.principal_days })}</Text>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  box: { flexDirection: "row", gap: 8, backgroundColor: "#f5f3ff", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: "#ddd6fe" },
  boxWarn: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  main: { fontSize: 13, fontWeight: "800", color: "#5b21b6" },
  sub: { fontSize: 11.5, color: "#475569", marginTop: 3 },
});
