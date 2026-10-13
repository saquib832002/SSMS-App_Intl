/**
 * Staff › Student Leave
 * Absence notes, leave, late-arrival and early-pickup requests from parents.
 * Teachers see their own classes; owner / admin / principal see everyone.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, Modal, TouchableOpacity, ScrollView,
  FlatList, RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  schoolDaysText, getRequests, reviewRequest, submitRequest, updateRequest, cancelRequest, getLeaveSettings, saveLeaveSettings, TYPE_LABEL, STATUS_STYLE, when, ymd,
} from "../../services/StudentLeaveApi";
import { C, Btn, Field, Picker, Empty, u } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import StudentSearch from "../../components/StudentSearch";
import SchoolDaysPreview from "../../components/SchoolDaysPreview";
import { _t, _tx } from "../../services/i18n";

const TABS = [
  { key: "pending", get label() { return _t("Pending"); } }, { key: "approved", get label() { return _t("Approved"); } },
  { key: "rejected", get label() { return _t("Not approved"); } }, { key: "all", get label() { return _t("All"); } },
];
const REASONS = ["Sick", "Medical appointment", "Family", "Travel", "Religious / cultural", "Other"].map((r) => ({ value: r, label: r }));
const TYPE_OPTS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

export default function StudentLeaveScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [tab, setTab]       = useState("pending");
  const [rows, setRows]     = useState(null);
  const [busy, setBusy]     = useState(null);
  const [decide, setDecide] = useState(null);   // { req, decision, note }
  const [form, setForm]     = useState(null);   // staff entry
  const [cfg, setCfg]       = useState(null);   // { principal_days, can_edit, is_final_approver }
  const [daysInput, setDaysInput] = useState("");

  useEffect(() => {
    getLeaveSettings(user).then((c) => { setCfg(c); setDaysInput(String(c?.principal_days ?? 3)); }).catch(() => {});
  }, [user]);

  const onSaveDays = async () => {
    const n = parseInt(daysInput, 10);
    if (isNaN(n)) { Alert.alert(_t("Student leave"), _t("Enter a number of days.")); return; }
    setBusy("cfg");
    try { const d = await saveLeaveSettings(user, n); setCfg((c) => ({ ...c, principal_days: d })); Alert.alert(_t("Saved"), n === 0 ? _t("Teacher approval is now enough for any length of leave.") : _t("Leave longer than {d} day{pl} now also needs the principal or owner.", { d, pl: d === 1 ? "" : "s" })); }
    catch (e) { Alert.alert(_t("Student leave"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  const load = useCallback(async () => {
    try { const r = await getRequests(user, { status: tab }); setRows(Array.isArray(r) ? r : []); }
    catch (e) { Alert.alert(_t("Student leave"), _tx(e.message)); setRows([]); }
  }, [user, tab]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const onDecide = async () => {
    setBusy("decide");
    try {
      await reviewRequest(user, decide.req.id, decide.decision, decide.note);
      setDecide(null); await load();
    } catch (e) { Alert.alert(_t("Student leave"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  const onAdd = async () => {
    if (!form.student) { Alert.alert(_t("Student leave"), _t("Choose a student.")); return; }
    setBusy("add");
    try {
      const payload = {
        enrollment_id: form.student.enrollment_id, request_type: form.request_type,
        from_date: form.from_date, to_date: form.to_date || form.from_date, time_at: form.time_at,
        reason_category: form.reason_category, reason: form.reason, pickup_person: form.pickup_person,
      };
      if (form.id) await updateRequest(user, form.id, payload); else await submitRequest(user, payload);
      setForm(null); await load();
    } catch (e) { Alert.alert(_t("Student leave"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  const openEdit = (r) => setForm({
    id: r.id, locked: true,
    student: { enrollment_id: r.enrollment_id, student_name: r.student_name, class_name: r.class_name, section_name: r.section_name, roll_number: r.roll_number },
    request_type: r.request_type, from_date: r.from_date, to_date: r.to_date, time_at: r.time_at ?? "",
    reason_category: r.reason_category ?? "Other", reason: r.reason ?? "", pickup_person: r.pickup_person ?? "",
  });

  const onCancel = (r) => Alert.alert(
    _t("Cancel this request?"),
    r.status === "approved" && (r.request_type === "absence" || r.request_type === "leave")
      ? _t("The leave days marked “L” in attendance will go back to how they were.")
      : `${_tx(r.student_name)} · ${_tx(TYPE_LABEL[r.request_type])} · ${when(r)}`,
    [{ text: _t("Keep"), style: "cancel" }, { text: _t("Cancel request"), style: "destructive", onPress: async () => {
      setBusy("c-" + r.id);
      try { await cancelRequest(user, r.id); await load(); }
      catch (e) { Alert.alert(_t("Student leave"), _tx(e.message)); }
      finally { setBusy(null); }
    } }],
  );

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const multiDay = form && (form.request_type === "absence" || form.request_type === "leave");

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[st.tab, tab === t.key && st.tabOn]} onPress={() => setTab(t.key)}>
            <Text style={[st.tabTxt, tab === t.key && st.tabTxtOn]}>{_tx(t.label)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {rows === null ? <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} /> : (
        <FlatList
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          data={rows}
          keyExtractor={(r) => String(r.id)}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListHeaderComponent={
            <>
            {cfg?.can_edit && (
              <View style={st.cfg}>
                <Text style={st.cfgTitle}>{_t("Principal / owner approval")}</Text>
                <Text style={u.hint}>{_t("Leave or absence longer than this many days needs the class teacher AND the principal or owner. 0 = teacher approval is enough.")}</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 6 }}>
                  <View style={{ width: 90 }}><Field value={daysInput} keyboardType="number-pad" onChangeText={setDaysInput} /></View>
                  <Text style={[u.hint, { flex: 1, marginBottom: 18 }]}>{_t("days")}</Text>
                  <Btn title={_t("Save")} kind="ghost" busy={busy === "cfg"} onPress={onSaveDays} style={{ marginBottom: 10 }} />
                </View>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
              <Btn title={_t("Add for a student")} icon="plus" kind="ghost" style={{ flex: 1 }}
                onPress={() => setForm({ student: null, request_type: "absence", from_date: ymd(new Date()), to_date: "", time_at: "",
                  reason_category: "Sick", reason: "", pickup_person: "" })} />
              <Btn title={_t("Late & early log")} icon="clock" kind="ghost" style={{ flex: 1 }} onPress={() => navigation.navigate("ArrivalLog")} />
            </View>
            </>
          }
          ListEmptyComponent={<Empty icon="inbox" text={tab === "pending" ? _t("No requests waiting for approval.") : _t("Nothing here.")} />}
          renderItem={({ item: r }) => {
            const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
            return (
              <View style={st.card}>
                <View style={st.row}>
                  <Text style={st.title} numberOfLines={1}>{_tx(r.student_name)}</Text>
                  <Text style={[st.badge, { backgroundColor: s.bg, color: s.fg }]}>{_tx(s.label)}</Text>
                </View>
                <Text style={st.meta}>{_t("{v} · Roll {v2}", { v: [r.class_name, r.section_name].filter(Boolean).join(" "), v2: r.roll_number || "–" })}</Text>
                <Text style={st.type}>{_tx(TYPE_LABEL[r.request_type])} · {when(r)}{schoolDaysText(r)}</Text>
                <Text style={st.reason}>{_tx(r.reason_category)}{r.reason ? ` – ${_tx(r.reason)}` : ""}</Text>
                {!!r.pickup_person && <Text style={st.meta}>{_t("Collected by: {pickup_person}", { pickup_person: r.pickup_person })}</Text>}
                <Text style={st.by}>{_t("From {v} {submitted_by}{v2}{v3}", { v: r.submitted_role === "parent" ? "parent" : r.submitted_role, submitted_by: r.submitted_by, v2: r.reviewed_by ? ` ${_t("· {status} by {reviewed_by}", { status: r.status, reviewed_by: r.reviewed_by })}` : "", v3: r.review_note ? ` – “${r.review_note}”` : "" })}</Text>
                {r.needs_final && r.status === "pending" && (
                  <Text style={st.two}>{_t("Longer than {v} school days – needs the class teacher and the principal / owner", { v: cfg?.principal_days ?? 3 })}</Text>
                )}
                {r.status === "teacher_approved" && (
                  <Text style={st.two}>{_t("Approved by {first_approved_by}{v} – waiting for the principal / owner", { first_approved_by: r.first_approved_by, v: r.first_note ? ` (“${r.first_note}”)` : "" })}</Text>
                )}
                {(r.status === "pending" || (r.status === "teacher_approved" && cfg?.is_final_approver)) && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <Btn title={_t("Not approve")} icon="x" kind="danger" style={{ flex: 1 }} onPress={() => setDecide({ req: r, decision: "rejected", note: "" })} />
                    <Btn title={r.needs_final && r.status === "pending" && !cfg?.is_final_approver ? _t("Approve → principal") : _t("Approve")} icon="check" style={{ flex: 1 }} onPress={() => setDecide({ req: r, decision: "approved", note: "" })} />
                  </View>
                )}
                {["pending", "teacher_approved", "approved"].includes(r.status) && (
                  <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                    <TouchableOpacity onPress={() => openEdit(r)} disabled={!!busy} style={st.link}>
                      <Feather name="edit-2" size={13} color={C.brand} /><Text style={st.linkTxt}>{_t("Edit")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onCancel(r)} disabled={!!busy} style={st.link}>
                      {busy === "c-" + r.id ? <ActivityIndicator size="small" color={C.err} /> : <>
                        <Feather name="x-circle" size={13} color={C.err} /><Text style={[st.linkTxt, { color: C.err }]}>{_t("Cancel")}</Text></>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* Approve / reject with optional note */}
      <Modal visible={!!decide} transparent animationType="fade" onRequestClose={() => setDecide(null)}>
        <View style={st.overlay}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>{decide?.decision === "approved" ? _t("Approve request") : _t("Not approve request")}</Text>
            <Text style={u.hint}>{_tx(decide?.req?.student_name)} · {decide && _tx(TYPE_LABEL[decide.req.request_type])} · {decide && when(decide.req)}</Text>
            <Field label={_t("Note to parent (optional)")} value={decide?.note ?? ""} multiline style={{ minHeight: 60, textAlignVertical: "top" }}
              placeholder={decide?.decision === "approved" ? _t("e.g. Get well soon!") : _t("e.g. Please bring a doctor's note")}
              onChangeText={(v) => setDecide((d) => ({ ...d, note: v }))} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn title={_t("Back")} kind="ghost" style={{ flex: 1 }} onPress={() => setDecide(null)} />
              <Btn title={decide?.decision === "approved" ? _t("Approve") : _t("Not approve")} kind={decide?.decision === "approved" ? "primary" : "danger"}
                style={{ flex: 1 }} busy={busy === "decide"} onPress={onDecide} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Staff entry – e.g. parent phoned the office */}
      <Modal visible={!!form} animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.modalHead}>
            <Text style={st.modalTitle}>{form?.id ? _t("Edit request") : _t("Add for a student")}</Text>
            <TouchableOpacity onPress={() => setForm(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          {!!form && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <Text style={u.label}>{_t("Student")}</Text>
              {form.locked ? (
                <Text style={st.lockedStu}>{_tx(form.student.student_name)} · {[form.student.class_name, form.student.section_name].filter(Boolean).join(" ")}</Text>
              ) : (
                <StudentSearch user={user} value={form.student} onChange={(v) => set("student", v)} />
              )}
              <Picker label={_t("Type")} value={form.request_type} options={TYPE_OPTS} onChange={(v) => set("request_type", v)} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><DateTimeField label={multiDay ? _t("From") : _t("Date")} value={form.from_date} onChange={(v) => set("from_date", v)} /></View>
                <View style={{ flex: 1 }}>
                  {multiDay
                    ? <DateTimeField label={_t("To")} value={form.to_date || form.from_date} onChange={(v) => set("to_date", v)} />
                    : <DateTimeField mode="time" label={_t("Time")} value={form.time_at} placeholder={_t("Choose time")} onChange={(v) => set("time_at", v)} />}
                </View>
              </View>
              {multiDay && !!form.student && (
                <SchoolDaysPreview user={user} enrollmentId={form.student.enrollment_id} from={form.from_date} to={form.to_date || form.from_date} />
              )}
              {form.request_type === "early_pickup" && (
                <Field label={_t("Collected by *")} value={form.pickup_person} placeholder={_t("Name and relation")} onChangeText={(v) => set("pickup_person", v)} />
              )}
              <Picker label={_t("Reason")} value={form.reason_category} options={REASONS} onChange={(v) => set("reason_category", v)} />
              <Field label={_t("Details")} value={form.reason} onChangeText={(v) => set("reason", v)} placeholder={_t("Optional")} />
              <Text style={u.hint}>{_t("Requests added by staff are approved straight away – except leave longer than {v} days, which still goes to the principal / owner unless you are one.", { v: cfg?.principal_days ?? 3 })}</Text>
              <Btn title={_t("Save")} icon="check" busy={busy === "add"} onPress={onAdd} style={{ marginTop: 12 }} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 8 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: C.brand },
  tabTxt: { fontSize: 13, color: C.muted, fontWeight: "600" },
  tabTxtOn: { color: C.brand, fontWeight: "800" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontWeight: "800", color: C.ink, flex: 1 },
  badge: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  type: { fontSize: 13, fontWeight: "700", color: C.brand, marginTop: 6 },
  reason: { fontSize: 13, color: C.ink, marginTop: 2 },
  by: { fontSize: 11, color: C.muted, marginTop: 6 },
  two: { fontSize: 12, color: "#3730a3", fontWeight: "600", marginTop: 6 },
  link: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  linkTxt: { color: C.brand, fontWeight: "700", fontSize: 13 },
  lockedStu: { fontSize: 14, fontWeight: "700", color: C.ink, backgroundColor: C.brandSoft, borderRadius: 10, padding: 12, marginBottom: 10 },
  cfg: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.line },
  cfgTitle: { fontSize: 13, fontWeight: "800", color: C.brand },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: C.ink, marginBottom: 4 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
               paddingTop: Platform.OS === "ios" ? 54 : 18, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
});
