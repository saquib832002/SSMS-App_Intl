/**
 * Parents / students › Absence & Leave
 * Send an absence note (today or a past day), request leave, or tell the school
 * about a late arrival or early pickup. The class teacher approves it.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, Modal, TouchableOpacity, ScrollView,
  FlatList, RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getMyChildren, getMyRequests, submitRequest, cancelRequest, updateRequest,
  TYPE_LABEL, STATUS_STYLE, when, ymd, niceDate, niceTime, schoolDaysText,
} from "../../services/StudentLeaveApi";
import { C, Card, Btn, Field, Picker, Empty, u } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import SchoolDaysPreview from "../../components/SchoolDaysPreview";
import { _t, _tx } from "../../services/i18n";

const TYPES = [
  { key: "absence",      icon: "thermometer", get label() { return _t("Absence note"); }, get sub() { return _t("Off today or on a past day"); } },
  { key: "leave",        icon: "calendar",    get label() { return _t("Leave"); },        get sub() { return _t("Planned days off"); } },
  { key: "late_arrival", icon: "clock",       get label() { return _t("Late arrival"); }, get sub() { return _t("Coming in late"); } },
  { key: "early_pickup", icon: "log-out",     get label() { return _t("Early pickup"); }, get sub() { return _t("Leaving before the end of the day"); } },
];

const today = () => ymd(new Date());

export default function MyAbsencesScreen() {
  const { user } = useContext(AuthContext);
  const [children, setChildren] = useState(null);
  const [reasons, setReasons]   = useState([]);
  const [data, setData]         = useState({ requests: [], arrivals: [] });
  const [form, setForm]         = useState(null);
  const [busy, setBusy]         = useState(null);

  const load = useCallback(async () => {
    try {
      // allSettled: a denied requests list must not hide the children / tiles (and vice versa)
      const [cRes, rRes] = await Promise.allSettled([getMyChildren(user), getMyRequests(user)]);
      const c = cRes.status === "fulfilled" ? cRes.value : null;
      const r = rRes.status === "fulfilled" ? rRes.value : null;
      setChildren(Array.isArray(c?.data) ? c.data : []); setReasons(Array.isArray(c?.reasons) ? c.reasons : []);
      setData({ requests: Array.isArray(r?.requests) ? r.requests : [], arrivals: Array.isArray(r?.arrivals) ? r.arrivals : [] });
      const err = cRes.status === "rejected" ? cRes.reason : rRes.status === "rejected" ? rRes.reason : null;
      if (err) Alert.alert(_t("Absence & leave"), _tx(err?.message) || _t("Something went wrong. Please try again."));
    } catch (e) {
      Alert.alert(_t("Absence & leave"), _tx(e.message)); setChildren([]);
    }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const openForm = (type) => setForm({
    request_type: type,
    enrollment_id: children?.length === 1 ? children[0].enrollment_id : "",
    from_date: type === "leave" ? ymd(new Date(Date.now() + 86400000)) : today(),
    to_date: "", time_at: "", reason_category: type === "absence" ? "Sick" : "", reason: "", pickup_person: "",
  });

  const submit = async () => {
    setBusy("submit");
    try {
      const payload = { ...form, to_date: form.to_date || form.from_date };
      if (form.id) await updateRequest(user, form.id, payload); else await submitRequest(user, payload);
      setForm(null);
      await load();
      Alert.alert(form.id ? _t("Updated") : _t("Sent"), form.id
        ? _t("Your change has been sent to the school for approval.")
        : _t("The school has been told. You'll see here when it's approved."));
    } catch (e) {
      Alert.alert(_t("Absence & leave"), _tx(e.message));
    } finally { setBusy(null); }
  };

  const onCancel = (r) => Alert.alert(_t("Cancel request"), _t("Cancel this request?"), [
    { text: _t("No"), style: "cancel" },
    { text: _t("Cancel request"), style: "destructive", onPress: async () => {
      setBusy("c-" + r.id);
      try { await cancelRequest(user, r.id); await load(); }
      catch (e) { Alert.alert(_t("Absence & leave"), _tx(e.message)); }
      finally { setBusy(null); }
    } },
  ]);

  const childOpts  = useMemo(() => (children ?? []).map((c) => ({ value: c.enrollment_id, label: c.student_name, sub: c.class_name })), [children]);
  const reasonOpts = useMemo(() => reasons.map((r) => ({ value: r, label: r })), [reasons]);

  if (children === null) return <View style={st.center}><ActivityIndicator color={C.brand} size="large" /></View>;

  const t = form ? TYPES.find((x) => x.key === form.request_type) : null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        data={data.requests}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListHeaderComponent={
          <>
            {children.length === 0 ? (
              <Empty icon="user-x" text={_t("No student is linked to this login. Please contact the school.")} />
            ) : (
              <View style={st.grid}>
                {TYPES.map((x) => (
                  <TouchableOpacity key={x.key} style={st.tile} onPress={() => openForm(x.key)} activeOpacity={0.8}>
                    <View style={st.tileIcon}><Feather name={x.icon} size={20} color={C.brand} /></View>
                    <Text style={st.tileTitle}>{_tx(x.label)}</Text>
                    <Text style={st.tileSub}>{_tx(x.sub)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {data.requests.length > 0 && <Text style={st.h}>{_t("My requests")}</Text>}
          </>
        }
        ListEmptyComponent={children.length > 0 ? <Empty icon="inbox" text={_t("No requests yet.")} /> : null}
        renderItem={({ item: r }) => {
          const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
          const canCancel = r.status === "pending" || r.status === "teacher_approved" || (r.status === "approved" && r.from_date > today());
          return (
            <View style={st.card}>
              <View style={st.row}>
                <Text style={st.title}>{_tx(TYPE_LABEL[r.request_type])}{children.length > 1 ? ` · ${_tx(r.student_name)}` : ""}</Text>
                <Text style={[st.badge, { backgroundColor: s.bg, color: s.fg }]}>{_tx(s.label)}</Text>
              </View>
              <Text style={st.meta}>{when(r)}{schoolDaysText(r)}</Text>
              <Text style={st.reason}>{_tx(r.reason_category)}{r.reason ? ` – ${_tx(r.reason)}` : ""}</Text>
              {!!r.pickup_person && <Text style={st.meta}>{_t("Collected by: {pickup_person}", { pickup_person: r.pickup_person })}</Text>}
              {r.status === "teacher_approved" && <Text style={st.note}>{_t("Approved by the class teacher – the principal will confirm because it is longer than usual.")}</Text>}
              {!!r.review_note && <Text style={st.note}>{_t("School: {review_note}", { review_note: r.review_note })}</Text>}
              <View style={{ flexDirection: "row", gap: 18 }}>
                {(r.status === "pending" || r.status === "teacher_approved") && (
                  <TouchableOpacity disabled={!!busy} style={{ marginTop: 6 }} onPress={() => setForm({
                    id: r.id, request_type: r.request_type, enrollment_id: r.enrollment_id, from_date: r.from_date,
                    to_date: r.to_date, time_at: r.time_at ?? "", reason_category: r.reason_category ?? "",
                    reason: r.reason ?? "", pickup_person: r.pickup_person ?? "",
                  })}>
                    <Text style={[st.cancel, { color: C.brand }]}>{_t("Edit")}</Text>
                  </TouchableOpacity>
                )}
                {canCancel && (
                  <TouchableOpacity onPress={() => onCancel(r)} disabled={!!busy} style={{ marginTop: 6 }}>
                    {busy === "c-" + r.id ? <ActivityIndicator color={C.err} /> : <Text style={st.cancel}>{_t("Cancel request")}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
        ListFooterComponent={data.arrivals?.length ? (
          <Card title={_t("Late arrivals & early pickups")} style={{ marginTop: 8 }}>
            {data.arrivals.map((a) => (
              <View key={String(a.id)} style={st.arr}>
                <Feather name={a.kind === "late" ? "clock" : "log-out"} size={14} color={C.muted} />
                <Text style={st.arrTxt}>
                  {niceDate(a.event_date)} · {a.kind === "late" ? _t("Arrived") : _t("Picked up")} {niceTime(a.event_time)}
                  {children.length > 1 ? ` · ${_tx(a.student_name)}` : ""}{a.picked_up_by ? ` ${_t("· by {picked_up_by}", { picked_up_by: a.picked_up_by })}` : ""}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}
      />

      <Modal visible={!!form} animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.modalHead}>
            <Text style={st.modalTitle}>{form?.id ? _t("Edit {v}", { v: t?.label?.toLowerCase() }) : _tx(t?.label)}</Text>
            <TouchableOpacity onPress={() => setForm(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          {!!form && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              {children.length > 1 && !form.id && (
                <Picker label={_t("Child")} value={form.enrollment_id} options={childOpts} placeholder={_t("Choose child")} onChange={(v) => set("enrollment_id", v)} />
              )}
              {form.request_type === "absence" || form.request_type === "leave" ? (
                <View style={st.row2}>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("From")} value={form.from_date} onChange={(v) => set("from_date", v)} /></View>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("To")} value={form.to_date || form.from_date} onChange={(v) => set("to_date", v)} /></View>
                </View>
              ) : null}
              {(form.request_type === "absence" || form.request_type === "leave") && (
                <SchoolDaysPreview user={user} enrollmentId={form.enrollment_id} from={form.from_date} to={form.to_date || form.from_date} />
              )}
              {form.request_type === "absence" || form.request_type === "leave" ? null : (
                <View style={st.row2}>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("Date")} value={form.from_date} onChange={(v) => set("from_date", v)} /></View>
                  <View style={{ flex: 1 }}>
                    <DateTimeField mode="time" label={form.request_type === "late_arrival" ? _t("Expected arrival") : _t("Pickup time")}
                      value={form.time_at} placeholder={_t("Choose time")} onChange={(v) => set("time_at", v)} />
                  </View>
                </View>
              )}
              {form.request_type === "early_pickup" && (
                <Field label={_t("Who will collect the child? *")} value={form.pickup_person} placeholder={_t("e.g. Mother – Sarah Lee")}
                  onChangeText={(v) => set("pickup_person", v)} />
              )}
              <Picker label={_t("Reason")} value={form.reason_category} options={reasonOpts} placeholder={_t("Choose reason")} onChange={(v) => set("reason_category", v)} />
              <Field label={_t("Details")} value={form.reason} multiline style={{ minHeight: 80, textAlignVertical: "top" }}
                placeholder={form.request_type === "absence" ? _t("e.g. Fever, staying home to rest") : _t("Anything the teacher should know")}
                onChangeText={(v) => set("reason", v)} />
              <Text style={u.hint}>{_t("The class teacher will be notified and can approve the request.")}</Text>
              <Btn title={_t("Send to school")} icon="send" busy={busy === "submit"} onPress={submit} style={{ marginTop: 12 }} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  tile: { width: "48%", flexGrow: 1, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line },
  tileIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  tileTitle: { fontSize: 14, fontWeight: "800", color: C.ink },
  tileSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  h: { fontSize: 13, fontWeight: "800", color: C.brand, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  row2: { flexDirection: "row", gap: 10 },
  title: { fontSize: 14, fontWeight: "800", color: C.ink, flex: 1 },
  badge: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  meta: { fontSize: 12, color: C.muted, marginTop: 3 },
  reason: { fontSize: 13, color: C.ink, marginTop: 4 },
  note: { fontSize: 12, color: C.brand, marginTop: 4, fontStyle: "italic" },
  cancel: { color: C.err, fontWeight: "700", fontSize: 13 },
  arr: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  arrTxt: { fontSize: 12, color: C.ink, flex: 1 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
               paddingTop: Platform.OS === "ios" ? 54 : 18, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
});
