/**
 * Students › Health alerts – every student with allergies, conditions, medicines or a
 * dietary need, grouped by class (teachers: their own classes). Handy before a trip,
 * sports day or when covering a class. Tap a student to open their full record.
 *
 * Students › Expiring documents (mode "expiry") – passports, visas … that expire soon.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Empty } from "../../components/ReportCardUI";
import { getMedicalList, getExpiringDocuments, ALERT_STYLE } from "../../services/StudentRecordApi";

import { fmtDate } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
const niceDate = (d) => {
  if (!d) return "";
  return fmtDate(String(d).slice(0, 10), "medium") || String(d);
};

export default function HealthAlertsScreen({ navigation, route }) {
  const { user } = useContext(AuthContext);
  const expiry = route?.params?.mode === "expiry";
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = expiry ? await getExpiringDocuments(user, 90) : await getMedicalList(user, {});
      const list = expiry ? r?.documents : r?.students;
      setRows(Array.isArray(list) ? list : []);
      setErr(null);
    } catch (e) {
      setErr(e.message);
      setRows((x) => x ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, expiry]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (rows ?? []).filter((r) => !term || `${r.name ?? r.student_name} ${r.class_name ?? ""} ${r.title ?? ""}`.toLowerCase().includes(term));
    if (expiry) return [["", list]];
    const g = {};
    list.forEach((r) => { (g[r.class_name || "—"] = g[r.class_name || "—"] || []).push(r); });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [rows, q, expiry]);

  const openRecord = (registrationId) => navigation.navigate("StudentRecord", { registrationId, tab: expiry ? "docs" : "health" });

  if (!rows) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
      <View style={s.search}>
        <Feather name="search" size={16} color={C.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={expiry ? _t("Search student or document") : _t("Search student or class")} placeholderTextColor="#94a3b8" style={s.searchInput} />
      </View>
      {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
      {!err && !rows.length && (
        <Card><Empty icon={expiry ? "calendar" : "heart"} text={expiry ? _t("No documents expire in the next 90 days.") : _t("No health alerts recorded for your students.")} /></Card>
      )}
      {groups.map(([cls, list]) => (!list.length ? null : (
        <Card key={cls || "all"} title={expiry ? _t("Expiring within 90 days ({length})", { length: list.length }) : `${_tx(cls)} (${_tx(list.length)})`}>
          {list.map((r) => {
            if (expiry) {
              return (
                <TouchableOpacity key={r.id} style={s.row} onPress={() => openRecord(r.registration_id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{_tx(r.student_name)}</Text>
                    <Text style={s.meta}>{_tx(r.title)}{r.doc_number ? ` · ${_tx(r.doc_number)}` : ""}</Text>
                  </View>
                  <View style={[s.pill, { backgroundColor: r.expired ? "#fee2e2" : "#fef3c7" }]}>
                    <Text style={[s.pillTxt, { color: r.expired ? "#991b1b" : "#92400e" }]}>{r.expired ? ("" + _t("Expired") + " ") : ""}{niceDate(r.expires_on)}</Text>
                  </View>
                </TouchableOpacity>
              );
            }
            const st = ALERT_STYLE[r.alert_level] ?? ALERT_STYLE.none;
            return (
              <TouchableOpacity key={r.enrollment_id} style={s.row} onPress={() => openRecord(r.registration_id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{_tx(r.name)}{r.roll_number ? <Text style={s.meta}>{_t("· Roll {roll_number}", { roll_number: r.roll_number })}</Text> : null}</Text>
                  {!!r.allergies && <Text style={s.line}><Text style={s.k}>{_t("Allergies:")}{" "}</Text>{_tx(r.allergies)}</Text>}
                  {!!r.conditions && <Text style={s.line}><Text style={s.k}>{_t("Conditions:")}{" "}</Text>{_tx(r.conditions)}</Text>}
                  {!!r.medications && <Text style={s.line}><Text style={s.k}>{_t("Medicines:")}{" "}</Text>{_tx(r.medications)}</Text>}
                  {!!r.dietary && <Text style={s.line}><Text style={s.k}>{_t("Diet:")}{" "}</Text>{_tx(r.dietary)}</Text>}
                </View>
                {r.alert_level !== "none" && (
                  <View style={[s.pill, { backgroundColor: st.bg }]}><Text style={[s.pillTxt, { color: st.fg }]}>{_tx(st.label)}</Text></View>
                )}
              </TouchableOpacity>
            );
          })}
        </Card>
      )))}
      {!expiry && <Text style={s.meta}>{_t("Only staff allowed to see student health details can open this list. Opening it is recorded in the audit log.")}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: C.ink },
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 10 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  line: { fontSize: 13, color: C.ink, marginTop: 3, lineHeight: 18 },
  k: { fontWeight: "800", color: C.muted },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 11, fontWeight: "800" },
});
