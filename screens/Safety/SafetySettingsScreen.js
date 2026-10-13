/**
 * Safety rules (owner / safety approvers): what reception must check, the visitor rules, how long visitor details
 * are kept, how parents may add pick-up persons, pick-up codes – and the watch list (people who must not be let in,
 * or the office should be told about).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Platform, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import { C, Card, Btn, Empty, Picker, Field, Toggle } from "../../components/ReportCardUI";
import { getSafetySettings, saveSafetySettings, getWatchlist, saveWatch, removeWatch } from "../../services/SafetyApi";
import { _t, _tx } from "../../services/i18n";

const PARENT_MODES = () => [
  { value: "approve", label: _t("Parents add, the school approves") },
  { value: "direct", label: _t("Parents add, valid at once") },
  { value: "off", label: _t("Only the school adds") },
];
const LEVELS = () => [
  { value: "deny", label: _t("Do not let in") },
  { value: "alert", label: _t("Let in, tell the office") },
];

export default function SafetySettingsScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [set, setSet] = useState(null);
  const [watch, setWatch] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [w, setW] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await getSafetySettings(user);
      if (!r.can?.approve) { setErr(_t("Only the owner or a safety approver can change the safety rules.")); return; }
      const wl = await getWatchlist(user);
      setSet({ ...r.settings, retention_days: String(r.settings.retention_days ?? 90) });
      setWatch(wl.people ?? []);
      setErr(null);
    } catch (e) { setErr(_tx(e.message)); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ch = (k, v) => setSet((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const days = Number(set.retention_days);
    if (!Number.isInteger(days) || days < 30 || days > 3650) { Alert.alert(_t("Safety rules"), _t("Keep visitor details for 30 – 3650 days.")); return; }
    setBusy(true);
    try {
      const { settings: st } = await saveSafetySettings(user, {
        require_photo: set.require_photo ? 1 : 0, require_id: set.require_id ? 1 : 0, notify_host: set.notify_host ? 1 : 0, temp_code: set.temp_code ? 1 : 0,
        visitor_rules: set.visitor_rules ?? "", retention_days: days, parent_pickup: set.parent_pickup,
      });
      setSet({ ...st, retention_days: String(st.retention_days) });
      Alert.alert(_t("Safety rules"), _t("Saved."));
    } catch (e) { Alert.alert(_t("Safety rules"), _tx(e.message)); } finally { setBusy(false); }
  };

  const saveW = async () => {
    if (w.name.trim().length < 2) { Alert.alert(_t("Watch list"), _t("Enter the person's name.")); return; }
    setBusy(true);
    try {
      const r = await saveWatch(user, { id: w.id || undefined, name: w.name, phone: w.phone, id_last4: w.id_last4, level: w.level, reason: w.reason });
      setWatch(r.people ?? []);
      setW(null);
    } catch (e) { Alert.alert(_t("Watch list"), _tx(e.message)); } finally { setBusy(false); }
  };

  const removeW = (p) => Alert.alert(_t("Remove {name} from the watch list?", { name: p.name }), "", [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      try { const r = await removeWatch(user, p.id); setWatch(r.people ?? []); setW(null); } catch (e) { Alert.alert(_t("Watch list"), _tx(e.message)); }
    } },
  ]);

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="lock" text={err} /></View>;
  if (!set) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Card title={_t("Visitors")}>
          <Toggle label={_t("Photo needed to sign in")} value={!!set.require_photo} onChange={(v) => ch("require_photo", v)} />
          <Toggle label={_t("ID needed to sign in")} hint={_t("Only the type and the last 4 characters are kept.")} value={!!set.require_id} onChange={(v) => ch("require_id", v)} />
          <Toggle label={_t("Tell the staff member when their visitor arrives")} value={!!set.notify_host} onChange={(v) => ch("notify_host", v)} />
          <Field label={_t("Visitor rules (shown at sign-in, the visitor must agree)")} value={set.visitor_rules ?? ""} onChangeText={(t) => ch("visitor_rules", t)}
            multiline maxLength={3000} style={{ minHeight: 90, textAlignVertical: "top" }} placeholder={_t("e.g. Wear your badge at all times. Do not take photos of students.")} />
          <Field label={_t("Keep visitor details for (days)")} value={set.retention_days} onChangeText={(t) => ch("retention_days", t.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={4} />
          <Text style={s.meta}>{_t("Visits older than this are deleted automatically every night, with their photos (default 90 days).")}</Text>
        </Card>

        <Card title={_t("Pick-up")}>
          <Picker label={_t("Parents adding pick-up persons")} value={set.parent_pickup} options={PARENT_MODES()} onChange={(v) => ch("parent_pickup", v)} />
          <Toggle label={_t("One-off persons need a pick-up code")} hint={_t("A 6-digit code the person shows at the gate.")} value={!!set.temp_code} onChange={(v) => ch("temp_code", v)} />
        </Card>
        <Btn title={_t("Save")} icon="check" busy={busy} onPress={save} />

        <Card title={_t("Watch list")} style={{ marginTop: 16 }} right={
          <TouchableOpacity onPress={() => setW({ id: 0, name: "", phone: "", id_last4: "", level: "deny", reason: "" })}><Feather name="plus-circle" size={20} color={C.brand} /></TouchableOpacity>}>
          <Text style={s.meta}>{_t("Reception is warned when someone on this list signs in or comes to collect a child.")}</Text>
          {!watch.length && <Text style={[s.meta, { marginTop: 8 }]}>{_t("Nobody on the list.")}</Text>}
          {watch.map((p) => (
            <TouchableOpacity key={p.id} style={s.row} onPress={() => setW({ id: p.id, name: p.name, phone: p.phone_last10 ?? "", id_last4: p.id_last4 ?? "", level: p.level, reason: p.reason ?? "" })}>
              <Feather name={p.level === "deny" ? "slash" : "alert-triangle"} size={18} color={p.level === "deny" ? C.err : C.warn} />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <Text style={s.meta}>{p.level === "deny" ? _t("Do not let in") : _t("Let in, tell the office")}{p.phone_last10 ? ` · ${p.phone_last10}` : ""}{p.id_last4 ? ` · ${_t("ID …{n}", { n: p.id_last4 })}` : ""}</Text>
                {!!p.reason && <Text style={s.meta}>{p.reason}</Text>}
              </View>
              <Feather name="edit-2" size={15} color={C.brand} />
            </TouchableOpacity>
          ))}
        </Card>
      </ScrollView>

      <KeyboardSheet visible={!!w} onClose={() => setW(null)}>
            {!!w && (
              <SheetScroll>
                <Text style={s.big}>{w.id ? _t("Watch list") : _t("Add to the watch list")}</Text>
                <Field label={_t("Name")} value={w.name} onChangeText={(t) => setW((x) => ({ ...x, name: t }))} maxLength={120} />
                <Field label={_t("Mobile number")} value={w.phone} onChangeText={(t) => setW((x) => ({ ...x, phone: t }))} keyboardType="phone-pad" maxLength={30} />
                <Field label={_t("Last 4 characters of the ID")} value={w.id_last4} onChangeText={(t) => setW((x) => ({ ...x, id_last4: t.toUpperCase() }))} maxLength={4} autoCapitalize="characters" />
                <Picker label={_t("What reception should do")} value={w.level} options={LEVELS()} onChange={(v) => setW((x) => ({ ...x, level: v }))} />
                <Field label={_t("Reason (shown to reception)")} value={w.reason} onChangeText={(t) => setW((x) => ({ ...x, reason: t }))} maxLength={300} multiline style={{ minHeight: 60, textAlignVertical: "top" }} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Btn title={_t("Cancel")} kind="ghost" onPress={() => setW(null)} style={{ flex: 1 }} />
                  <Btn title={_t("Save")} icon="check" busy={busy} onPress={saveW} style={{ flex: 1 }} />
                </View>
                {w.id > 0 && <Btn title={_t("Remove")} kind="danger" icon="trash-2" onPress={() => removeW(w)} style={{ marginTop: 8 }} />}
              </SheetScroll>
            )}
      </KeyboardSheet>
    </View>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 6 },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: "#f1f5f9" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "92%" },
});
