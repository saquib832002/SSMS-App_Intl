/**
 * Search box → pick a student (name, roll number or enrollment number).
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { searchStudents } from "../services/StudentLeaveApi";
import { C } from "./ReportCardUI";
import { _t, _tx } from "../services/i18n";

export default function StudentSearch({ user, value, onChange }) {
  const [q, setQ]         = useState("");
  const [rows, setRows]   = useState([]);
  const [busy, setBusy]   = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setRows([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try { const r = await searchStudents(user, q.trim()); setRows(Array.isArray(r) ? r : []); } catch { setRows([]); } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (value) {
    return (
      <View style={st.sel}>
        <Feather name="user" size={16} color={C.brand} />
        <View style={{ flex: 1 }}>
          <Text style={st.name}>{_tx(value.student_name)}</Text>
          <Text style={st.meta}>{_t("{v} · Roll {v2}", { v: [value.class_name, value.section_name].filter(Boolean).join(" "), v2: value.roll_number || "–" })}</Text>
        </View>
        <TouchableOpacity onPress={() => onChange(null)}><Feather name="x-circle" size={18} color={C.muted} /></TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={st.box}>
        <Feather name="search" size={15} color="#64748b" />
        <TextInput style={st.input} value={q} onChangeText={setQ} placeholder={_t("Search student by name or roll no.")}
          placeholderTextColor="#94a3b8" autoCorrect={false} />
        {busy && <ActivityIndicator size="small" color={C.brand} />}
      </View>
      {rows.map((r) => (
        <TouchableOpacity key={String(r.enrollment_id)} style={st.row} onPress={() => { onChange(r); setQ(""); setRows([]); }}>
          <Text style={st.name}>{_tx(r.student_name)}</Text>
          <Text style={st.meta}>{_t("{v} · Roll {v2}", { v: [r.class_name, r.section_name].filter(Boolean).join(" "), v2: r.roll_number || "–" })}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1",
         borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, paddingVertical: 10, fontSize: 14, color: C.ink },
  row: { backgroundColor: "#fff", paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  sel: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.brandSoft, borderRadius: 10, padding: 12, marginBottom: 10 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 1 },
});
