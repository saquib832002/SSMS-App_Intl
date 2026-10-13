/**
 * Invigilators for one sitting: per hall, add / remove staff and pick the chief invigilator.
 * "Fill automatically" spreads duties fairly and skips people on leave or busy at that time.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, FlatList } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker } from "../../components/ReportCardUI";
import { getDuties, assignDuty, unassignDuty, autoAssign, niceDate, timeRange } from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

const ROLES = [{ value: "chief", get label() { return _t("Chief invigilator"); } }, { value: "invigilator", get label() { return _t("Invigilator"); } }, { value: "reliever", get label() { return _t("Reliever"); } }];

export default function InvigilationScreen({ route }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const planId = route?.params?.planId;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);   // hall being filled
  const [role, setRole] = useState("invigilator");
  const [perHall, setPerHall] = useState("2");

  const load = useCallback(async () => {
    try { setD(await getDuties(user, planId)); setErr(null); } catch (e) { setErr(e.message); }
  }, [user, planId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async (s, force = false) => {
    setBusy(true);
    try {
      const r = await assignDuty(user, { plan_id: planId, hall_id: adding.hall_id, staff_id: s.staff_id, role, ...(force ? { force: 1 } : {}) });
      setD(r.duties); setAdding(null);
      if (r.warnings?.length) Alert.alert(_t("Assigned"), `${_tx(r.staff)}: ${r.warnings.join(". ")}.`);
    } catch (e) {
      if (/leave/i.test(e.message) && !force) {
        Alert.alert(_t("On leave"), _t("{message} Assign anyway?", { message: e.message }), [{ text: _t("No"), style: "cancel" }, { text: _t("Assign"), onPress: () => add(s, true) }]);
      } else Alert.alert(_t("Invigilator"), _tx(e.message));
    } finally { setBusy(false); }
  };

  const remove = (duty) => Alert.alert(_t("Remove duty?"), _t("{name} won't invigilate here.", { name: duty.name }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      setBusy(true);
      try { setD((await unassignDuty(user, duty.id)).duties); } catch (e) { Alert.alert(_t("Invigilator"), _tx(e.message)); } finally { setBusy(false); }
    } },
  ]);

  const auto = async () => {
    setBusy(true);
    try {
      const r = await autoAssign(user, planId, +perHall);
      setD(r.duties);
      Alert.alert(_t("Filled in"), _t("{added} invigilator{pl} added.{v}", { added: r.added, pl: r.added === 1 ? "" : "s", v: r.short?.length ? ` ${_t("Not enough free staff for: {v}.", { v: r.short.join(", ") })}` : "" }));
    } catch (e) { Alert.alert(_t("Invigilators"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (!d) return <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>{err ? <Card><Empty icon="alert-circle" text={_tx(err)} /></Card> : <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}</View>;
  const plan = d.plan;
  const can = plan.can ?? {};
  const staff = [...(d.staff ?? [])].sort((a, b) => {
    const rank = (x) => (x.busy ? 3 : x.on_leave ? 2 : x.assigned_hall ? 1 : 0);
    return rank(a) - rank(b) || (a.teaches ? 1 : 0) - (b.teaches ? 1 : 0) || a.load - b.load || a.name.localeCompare(b.name);
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <Text style={s.head}>{_tx(plan.exam.name)} · {niceDate(plan.exam_date)} · {timeRange(plan.start_time, plan.end_time)}</Text>
        {plan.status !== "published" && <Text style={s.note}>{_t("Invigilators are told about their duty when the seating plan is published.")}</Text>}
        {can.edit && (
          <Card title={_t("Fill automatically")}>
            <Picker label={_t("Invigilators per hall")} value={perHall} options={["1", "2", "3", "4"].map((x) => ({ value: x, label: x }))} onChange={(v) => setPerHall(String(v))} />
            <Text style={s.note}>{_t("Fewest duties first; nobody on leave or busy elsewhere; teachers of today's paper only if no one else is free. Existing duties stay.")}</Text>
            <Btn title={_t("Fill empty places")} icon="zap" busy={busy} onPress={auto} />
          </Card>
        )}
        {plan.halls.filter((h) => h.used > 0).map((h) => (
          <Card key={h.hall_id} title={_tx(h.name)} right={<Text style={s.meta}>{_t("{used} students", { used: h.used })}</Text>}>
            {h.duties.length ? h.duties.map((x) => (
              <View key={x.id} style={s.row}>
                <Feather name={x.role === "chief" ? "star" : "user"} size={14} color={x.role === "chief" ? C.brand : C.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{_tx(x.name)}</Text>
                  <Text style={s.meta}>{_tx(x.role_label)}</Text>
                </View>
                {can.edit && <TouchableOpacity onPress={() => remove(x)} hitSlop={10} disabled={busy}><Feather name="x-circle" size={18} color="#b91c1c" /></TouchableOpacity>}
              </View>
            )) : <Text style={s.meta}>{_t("No invigilator yet.")}</Text>}
            {can.edit && <Btn title={_t("Add invigilator")} icon="user-plus" kind="ghost" onPress={() => { setRole(h.duties.some((x) => x.role === "chief") ? "invigilator" : "chief"); setAdding(h); }} />}
          </Card>
        ))}
        {!plan.halls.some((h) => h.used > 0) && <Card><Empty icon="grid" text={_t("Nobody is seated yet – generate the seating plan first.")} /></Card>}
      </ScrollView>

      <Modal visible={!!adding} animationType="slide" onRequestClose={() => setAdding(null)} transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
              <Text style={[s.head, { flex: 1, marginBottom: 0 }]}>{_t("Add to {name}", { name: adding?.name })}</Text>
              <TouchableOpacity onPress={() => setAdding(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <Picker label={_t("Role")} value={role} options={ROLES} onChange={setRole} />
            <FlatList data={staff} keyExtractor={(x) => String(x.staff_id)} style={{ maxHeight: 420 }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
              renderItem={({ item: x }) => {
                const here = x.assigned_hall === adding?.hall_id;
                const note = x.busy || (x.on_leave ? "On leave that day" : null) || (x.assigned_hall && !here ? "Already in another hall (will move)" : null) || x.teaches;
                return (
                  <TouchableOpacity style={[s.row, (x.busy || here) && { opacity: 0.45 }]} disabled={!!x.busy || here || busy} onPress={() => add(x)}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{_tx(x.name)}{here ? (" " + _t("· here") + "") : ""}</Text>
                      <Text style={[s.meta, (x.busy || x.on_leave) && { color: "#b91c1c" }]}>{_t("{load} dut{pl} this exam{v}", { load: x.load, pl: x.load === 1 ? "y" : "ies", v: note ? ` · ${note}` : "" })}</Text>
                    </View>
                    {!x.busy && !here && <Feather name="plus-circle" size={18} color={C.brand} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Empty icon="users" text={_t("No staff found.")} />} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  head: { fontSize: 14, fontWeight: "800", color: C.ink, marginBottom: 8 },
  note: { fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 1 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
});
