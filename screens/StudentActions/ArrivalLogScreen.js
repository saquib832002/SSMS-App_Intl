/**
 * Staff › Late & Early Log (front office / gate)
 * Record late arrivals (marks the day "L" in attendance) and early pickups
 * (who collected the child, when). Shows what parents told the school in advance.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, Modal, TouchableOpacity, ScrollView,
  RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getRequests, getArrivals, recordArrival, ymd, hm, niceTime } from "../../services/StudentLeaveApi";
import { C, Card, Btn, Field, Picker, Empty, u } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import StudentSearch from "../../components/StudentSearch";
import { _t, _tx } from "../../services/i18n";

const RELATIONS = ["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Driver", "Other"].map((r) => ({ value: r, label: r }));

export default function ArrivalLogScreen() {
  const { user } = useContext(AuthContext);
  const [date, setDate]         = useState(ymd(new Date()));
  const [expected, setExpected] = useState([]);
  const [log, setLog]           = useState(null);
  const [form, setForm]         = useState(null);
  const [busy, setBusy]         = useState(false);

  const load = useCallback(async () => {
    try {
      const [req, arr] = await Promise.all([
        getRequests(user, { status: "approved", date }).catch(() => []),
        getArrivals(user, date),
      ]);
      setExpected((Array.isArray(req) ? req : []).filter((r) => r.request_type === "late_arrival" || r.request_type === "early_pickup"));
      setLog(Array.isArray(arr) ? arr : []);
    } catch (e) { Alert.alert(_t("Late & early log"), _tx(e.message)); setLog([]); }
  }, [user, date]);
  useEffect(() => { load(); }, [load]);

  const done = (r) => (log ?? []).some((a) => a.enrollment_id === r.enrollment_id
    && a.kind === (r.request_type === "late_arrival" ? "late" : "early"));

  const open = (kind, req) => setForm({
    kind,
    student: req ? { enrollment_id: req.enrollment_id, student_name: req.student_name, class_name: req.class_name,
                     section_name: req.section_name, roll_number: req.roll_number } : null,
    time: hm(new Date()),
    reason: req ? [req.reason_category, req.reason].filter(Boolean).join(" – ") : "",
    picked_up_by: req?.pickup_person ?? "", relation: "", request_id: req?.id ?? null,
  });

  const save = async () => {
    if (!form.student) { Alert.alert(_t("Late & early log"), _t("Choose a student.")); return; }
    setBusy(true);
    try {
      await recordArrival(user, {
        enrollment_id: form.student.enrollment_id, kind: form.kind, date, time: form.time,
        reason: form.reason, picked_up_by: form.picked_up_by, relation: form.relation, request_id: form.request_id,
      });
      setForm(null); await load();
    } catch (e) { Alert.alert(_t("Late & early log"), _tx(e.message)); }
    finally { setBusy(false); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <DateTimeField label={_t("Day")} value={date} onChange={setDate} maximumDate={new Date()} />
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          <Btn title={_t("Late arrival")} icon="clock" style={{ flex: 1 }} onPress={() => open("late")} />
          <Btn title={_t("Early pickup")} icon="log-out" style={{ flex: 1 }} onPress={() => open("early")} />
        </View>

        {expected.length > 0 && (
          <Card title={_t("Parents told us")}>
            {expected.map((r) => {
              const kind = r.request_type === "late_arrival" ? "late" : "early";
              const ok = done(r);
              return (
                <View key={String(r.id)} style={st.item}>
                  <Feather name={kind === "late" ? "clock" : "log-out"} size={16} color={ok ? C.ok : C.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.name}>{_tx(r.student_name)} <Text style={st.meta}>{[r.class_name, r.section_name].filter(Boolean).join(" ")}</Text></Text>
                    <Text style={st.meta}>
                      {kind === "late" ? _t("Arriving") : _t("Pickup")} ~{niceTime(r.time_at)}{r.pickup_person ? ` ${_t("· by {pickup_person}", { pickup_person: r.pickup_person })}` : ""}
                      {r.reason_category ? ` · ${_tx(r.reason_category)}` : ""}
                    </Text>
                  </View>
                  {ok ? <Feather name="check-circle" size={18} color={C.ok} /> : (
                    <TouchableOpacity style={st.rec} onPress={() => open(kind, r)}><Text style={st.recTxt}>{_t("Record")}</Text></TouchableOpacity>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        <Card title={_t("Recorded")}>
          {log === null ? <ActivityIndicator color={C.brand} /> : log.length === 0 ? <Empty icon="clipboard" text={_t("Nothing recorded for this day.")} /> :
            log.map((a) => (
              <View key={String(a.id)} style={st.item}>
                <Feather name={a.kind === "late" ? "clock" : "log-out"} size={16} color={C.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>{_tx(a.student_name)} <Text style={st.meta}>{[a.class_name, a.section_name].filter(Boolean).join(" ")}</Text></Text>
                  <Text style={st.meta}>
                    {a.kind === "late" ? _t("Arrived") : _t("Picked up")} {niceTime(a.event_time)}
                    {a.picked_up_by ? ` ${_t("· by {picked_up_by}{v}", { picked_up_by: a.picked_up_by, v: a.relation ? ` (${a.relation})` : "" })}` : ""}
                    {a.reason ? ` · ${_tx(a.reason)}` : ""}
                  </Text>
                </View>
              </View>
            ))}
        </Card>
        <Text style={u.hint}>{_t("A late arrival also marks the student \"L\" (late) in that day's attendance.")}</Text>
      </ScrollView>

      <Modal visible={!!form} animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.modalHead}>
            <Text style={st.modalTitle}>{form?.kind === "late" ? _t("Record late arrival") : _t("Record early pickup")}</Text>
            <TouchableOpacity onPress={() => setForm(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          {!!form && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <Text style={u.label}>{_t("Student")}</Text>
              <StudentSearch user={user} value={form.student} onChange={(v) => set("student", v)} />
              <DateTimeField mode="time" label={form.kind === "late" ? _t("Arrived at") : _t("Picked up at")} value={form.time} onChange={(v) => set("time", v)} />
              {form.kind === "early" && (
                <>
                  <Field label={_t("Collected by *")} value={form.picked_up_by} placeholder={_t("Full name")} onChangeText={(v) => set("picked_up_by", v)} />
                  <Picker label={_t("Relation")} value={form.relation} options={RELATIONS} placeholder={_t("Choose")} onChange={(v) => set("relation", v)} />
                </>
              )}
              <Field label={_t("Reason")} value={form.reason} placeholder={form.kind === "late" ? _t("e.g. Doctor's appointment, traffic") : _t("e.g. Not feeling well")}
                onChangeText={(v) => set("reason", v)} />
              <Btn title={_t("Save")} icon="check" busy={busy} onPress={save} style={{ marginTop: 10 }} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, fontWeight: "400" },
  rec: { backgroundColor: C.brand, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  recTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
               paddingTop: Platform.OS === "ios" ? 54 : 18, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
});
