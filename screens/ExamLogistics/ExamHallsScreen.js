/**
 * Exam halls – rooms used for exams, laid out as rows × desks. Tap a desk in the layout to mark it
 * unusable (broken desk, pillar, invigilator's table).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Field, Toggle, Picker } from "../../components/ReportCardUI";
import { getHalls, saveHall, deleteHall, getSetup, rowLabel } from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

const EMPTY = { hall_id: null, name: "", location: "", rows: "5", cols: "6", blocked: [], active: true, branch_id: "0" };
const rowNum = (lab) => { const m = /^([A-Z]+)(\d+)$/.exec(lab); if (!m) return [0, 0]; let r = 0; for (const ch of m[1]) r = r * 26 + (ch.charCodeAt(0) - 64); return [r, +m[2]]; };

export function HallLayout({ rows, cols, blocked, onToggle, maxWidth = 320 }) {
  const r = Math.max(0, Math.min(40, +rows || 0));
  const c = Math.max(0, Math.min(30, +cols || 0));
  if (!r || !c) return null;
  const size = Math.max(9, Math.min(26, Math.floor((maxWidth - 24) / c) - 3));
  const set = new Set(blocked);
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={s.front}>{_t("Front of the room")}</Text>
      {Array.from({ length: r }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
          <Text style={[s.rowLab, { width: 18 }]}>{rowLabel(i + 1)}</Text>
          {Array.from({ length: c }, (_, j) => {
            const lab = `${rowLabel(i + 1)}${j + 1}`;
            const off = set.has(lab);
            return (
              <TouchableOpacity key={j} disabled={!onToggle} onPress={() => onToggle?.(lab)} hitSlop={2}
                style={{ width: size, height: size, marginRight: 3, borderRadius: 3, borderWidth: 1, borderColor: off ? "#cbd5e1" : C.brand,
                  backgroundColor: off ? "#e2e8f0" : C.brandSoft, alignItems: "center", justifyContent: "center" }}>
                {off && <Feather name="x" size={Math.max(7, size - 6)} color="#94a3b8" />}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function ExamHallsScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [halls, setHalls] = useState(null);
  const [can, setCan] = useState({});
  const [branches, setBranches] = useState([]);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, st] = await Promise.all([getHalls(user, { all: 1 }), getSetup(user)]);
      setHalls(h.halls ?? []); setCan(st.can ?? {}); setBranches(st.branches ?? []); setErr(null);
    } catch (e) { setErr(e.message); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k) => (v) => setForm((x) => ({ ...x, [k]: v }));
  // desks outside the current size are kept while typing (e.g. "5" → "" → "6") and dropped only when saving
  const inside = form ? form.blocked.filter((b) => { const [r, c] = rowNum(b); return r >= 1 && c >= 1 && r <= (+form.rows || 0) && c <= (+form.cols || 0); }) : [];
  const capacity = form ? Math.max(0, (+form.rows || 0) * (+form.cols || 0) - inside.length) : 0;

  const save = async () => {
    setBusy(true);
    try {
      await saveHall(user, { hall_id: form.hall_id, name: form.name, location: form.location, rows: +form.rows, cols: +form.cols,
        blocked: inside.join(", "), active: form.active ? 1 : 0, ...(branches.length ? { branch_id: +form.branch_id || 0 } : {}) });
      setForm(null);
      await load();
    } catch (e) { Alert.alert(_t("Exam hall"), _tx(e.message)); } finally { setBusy(false); }
  };

  const remove = () => {
    Alert.alert(_t("Delete hall?"), _t("{name} will be removed. Halls used by past seating plans are switched off instead.", { name: form.name }), [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Delete"), style: "destructive", onPress: async () => {
        setBusy(true);
        try { const r = await deleteHall(user, form.hall_id); setForm(null); await load(); Alert.alert(_t("Exam hall"), _tx(r.message)); }
        catch (e) { Alert.alert(_t("Exam hall"), _tx(e.message)); } finally { setBusy(false); }
      } },
    ]);
  };

  const toggleSeat = (lab) => setForm((x) => ({ ...x, blocked: x.blocked.includes(lab) ? x.blocked.filter((b) => b !== lab) : [...x.blocked, lab] }));
  const resize = (k) => (v) => setForm((x) => ({ ...x, [k]: v.replace(/\D/g, "").slice(0, 2) }));

  if (form) {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
          <Card title={form.hall_id ? _t("Edit hall") : _t("New exam hall")}>
            <Field label={_t("Name")} value={form.name} onChangeText={set("name")} placeholder={_t("e.g. Room 12, Main hall")} maxLength={80} />
            <Field label={_t("Where (optional)")} value={form.location} onChangeText={set("location")} placeholder={_t("e.g. First floor, Science block")} maxLength={120} />
            {branches.length > 0 && (
              <Picker label={_t("Branch")} value={String(form.branch_id ?? "0")} options={[{ value: "0", label: _t("Any branch") }, ...branches.map((b) => ({ value: String(b.branch_id), label: b.name }))]}
                onChange={(v) => set("branch_id")(String(v))} />
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Field label={_t("Rows (front to back)")} keyboardType="number-pad" value={form.rows} onChangeText={resize("rows")} /></View>
              <View style={{ flex: 1 }}><Field label={_t("Desks per row")} keyboardType="number-pad" value={form.cols} onChangeText={resize("cols")} /></View>
            </View>
            <Text style={s.meta}>{_t("{capacity} seats{v}. Tap a desk to block or free it.", { capacity, v: inside.length ? ` ${_t("({length} blocked: {v})", { length: inside.length, v: inside.join(", ") })}` : "" })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <HallLayout rows={form.rows} cols={form.cols} blocked={form.blocked} onToggle={toggleSeat} />
            </ScrollView>
            {!!form.hall_id && <Toggle label={_t("In use for exams")} value={form.active} onChange={set("active")} hint={_t("Switched-off halls aren't offered for new seating plans.")} />}
          </Card>
          <Btn title={_t("Save hall")} icon="save" busy={busy} onPress={save} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setForm(null)} />
          {!!form.hall_id && can.delete && <Btn title={_t("Delete hall")} kind="danger" icon="trash-2" onPress={remove} disabled={busy} />}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
      {can.edit && <Btn title={_t("Add exam hall")} icon="plus" onPress={() => setForm({ ...EMPTY })} style={{ marginTop: 0, marginBottom: 12 }} />}
      {!halls && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
      {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
      {halls && !halls.length && <Card><Empty icon="grid" text={_t("No exam halls yet. Add the rooms you use for exams with their rows and desks.")} /></Card>}
      {(halls ?? []).map((h) => (
        <TouchableOpacity key={h.hall_id} activeOpacity={0.8} disabled={!can.edit}
          onPress={() => setForm({ hall_id: h.hall_id, name: h.name, location: h.location ?? "", rows: String(h.rows), cols: String(h.cols), blocked: h.blocked ?? [], active: h.active, branch_id: String(h.branch_id ?? 0) })}>
          <Card style={!h.active && { opacity: 0.6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="grid" size={16} color={C.brand} />
              <Text style={s.title}>{_tx(h.name)}</Text>
              {!h.active && <Text style={s.off}>{_t("Switched off")}</Text>}
              {can.edit && <Feather name="edit-2" size={14} color={C.muted} />}
            </View>
            <Text style={s.meta}>{_t("{capacity} seats · {rows} rows × {cols} desks{v}{v2}", { capacity: h.capacity, rows: h.rows, cols: h.cols, v: h.location ? ` · ${h.location}` : "", v2: h.plans ? ` ${_t("· used in {plans} plan{pl}", { plans: h.plans, pl: h.plans === 1 ? "" : "s" })}` : "" })}</Text>
          </Card>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { flex: 1, fontSize: 15, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 6, lineHeight: 17 },
  off: { fontSize: 11, fontWeight: "700", color: C.muted },
  front: { fontSize: 10.5, color: C.muted, textAlign: "center", marginBottom: 4, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  rowLab: { fontSize: 10, color: C.muted, fontWeight: "700" },
});
