/**
 * One meeting session (staff): every slot with its booking. Tap a booked slot to call the
 * parent, mark the meeting held / missed, keep a private note or cancel it. Tap a free slot
 * to block it (a break) or book it for a family who phoned.
 */
import React, { useCallback, useContext, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl, Modal, Linking,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import StudentSearch from "../../components/StudentSearch";
import {
  getSession, setSlot, markBooking, bookFor, staffCancel, cancelSession, niceDay, niceTime, MODE_ICON, BOOKING_STATUS,
} from "../../services/MeetingApi";
import { _t, _tx } from "../../services/i18n";

const call = (phone) => {
  const n = String(phone || "").replace(/[^\d+]/g, "");
  if (n) Linking.openURL(`tel:${n}`).catch(() => Alert.alert(_t("Call"), _t("Calling isn't available on this device.")));
};

export default function MeetingSessionScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const id = route?.params?.id;
  const [s, setS] = useState(null);
  const [now, setNow] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState(null);   // { kind: 'booking'|'free', slot }
  const [note, setNote] = useState("");
  const [student, setStudent] = useState(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await getSession(user, id);
      setS(r.session); setNow(r.now); setErr(null);
      if (r.session?.title) navigation.setOptions?.({ title: r.session.title });
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [user, id, navigation]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn, after) => {
    setBusy(true);
    try { const r = await fn(); if (r?.session) setS(r.session); after?.(); }
    catch (e) { Alert.alert(_t("Meeting"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (!s) {
    return err ? (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>
        <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>
        <Btn title={_t("Try again")} kind="ghost" icon="refresh-cw" onPress={load} />
      </View>
    ) : <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  }

  const slots = Array.isArray(s.slot_list) ? s.slot_list : [];
  const booked = slots.filter((x) => x.booking).length;
  const manage = !!s.can_manage && s.status !== "cancelled";
  const started = (slot) => !!now && slot.start_at <= now;

  const openSlot = (slot) => {
    if (!manage && !slot.booking) return;
    if (slot.booking) { setNote(slot.booking.teacher_note ?? ""); setSheet({ kind: "booking", slot }); return; }
    if (slot.status === "blocked") {
      Alert.alert(_t("Blocked slot"), _t("{start_at} is blocked.", { start_at: niceTime(slot.start_at) }), [
        { text: _t("Keep blocked"), style: "cancel" },
        { text: _t("Open it again"), onPress: () => run(() => setSlot(user, slot.id, false)) },
      ], { cancelable: true });
      return;
    }
    setStudent(null); setTopic(""); setSheet({ kind: "free", slot });
  };

  const cancelAll = () => Alert.alert(_t("Cancel session"), _t("Cancel \"{title}\"? {v}", { title: s.title, v: booked ? _t("{booked} booked parent{pl} will be told.", { booked, pl: booked === 1 ? "" : "s" }) : "" }), [
    { text: _t("Keep it"), style: "cancel" },
    { text: _t("Cancel session"), style: "destructive", onPress: () => run(async () => { await cancelSession(user, s.id, "Cancelled by the school"); await load(); }) },
  ], { cancelable: true });

  const b = sheet?.slot?.booking;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Card>
          <Text style={st.title}>{_tx(s.title)}</Text>
          <Text style={st.meta}>{niceDay(s.meet_date)} · {niceTime(s.start_time)} – {niceTime(s.end_time)} · {_tx(s.teacher)}</Text>
          <View style={st.row}>
            <Feather name={MODE_ICON[s.mode] ?? "map-pin"} size={13} color={C.muted} />
            <Text style={st.meta}> {_tx(s.mode_label)}{s.location ? ` · ${_tx(s.location)}` : ""}</Text>
          </View>
          <Text style={st.meta}>{_tx(s.audience_label)}</Text>
          <Text style={st.meta}>{_t("Booking closes {closes_hours} h before each slot · {booked} of {length} booked", { closes_hours: s.closes_hours, booked, length: slots.length })}</Text>
          {s.status === "cancelled" && <Text style={[st.meta, { color: C.err, fontWeight: "700" }]}>{_t("Cancelled{v}", { v: s.cancel_reason ? `: ${s.cancel_reason}` : "" })}</Text>}
          {s.status === "closed" && <Text style={[st.meta, { color: C.warn, fontWeight: "700" }]}>{_t("Closed for booking")}</Text>}
          {manage && (
            <View style={st.actions}>
              <Btn title={_t("Edit")} kind="ghost" icon="edit-2" style={{ flex: 1, marginTop: 8 }}
                onPress={() => navigation.navigate("MeetingEdit", { session: { ...s, booked } })} />
              <Btn title={_t("Cancel session")} kind="danger" icon="x-circle" style={{ flex: 1, marginTop: 8 }} onPress={cancelAll} />
            </View>
          )}
        </Card>

        <Card title={_t("Slots")}>
          {!slots.length && <Text style={st.meta}>{_t("No slots.")}</Text>}
          {slots.map((x) => {
            const bs = x.booking ? (BOOKING_STATUS[x.booking.status] ?? BOOKING_STATUS.booked) : null;
            return (
              <TouchableOpacity key={x.id} style={st.slot} onPress={() => openSlot(x)} disabled={!manage && !x.booking}>
                <Text style={st.time}>{niceTime(x.start_at)}</Text>
                <View style={{ flex: 1 }}>
                  {x.booking ? (
                    <>
                      <Text style={st.name}>{_tx(x.booking.student_name)} <Text style={st.meta}>· {_tx(x.booking.class_name)}</Text></Text>
                      <Text style={st.meta}>{_tx(x.booking.parent_name) || _t("Parent")}{x.booking.parent_phone ? ` · ${_tx(x.booking.parent_phone)}` : ""}</Text>
                      {!!x.booking.topic && <Text style={st.topic}>"{_tx(x.booking.topic)}"</Text>}
                    </>
                  ) : x.status === "blocked" ? <Text style={st.meta}>{_t("Blocked")}</Text> : <Text style={[st.meta, { color: C.ok }]}>{_t("Free")}</Text>}
                </View>
                {bs && <Text style={[st.pill, { backgroundColor: bs.bg, color: bs.fg }]}>{_tx(bs.label)}</Text>}
              </TouchableOpacity>
            );
          })}
        </Card>
      </ScrollView>

      <Modal visible={!!sheet} animationType="slide" transparent onRequestClose={() => setSheet(null)}>
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[st.sheet, { paddingBottom: 18 + insets.bottom }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
              <Text style={[st.title, { flex: 1 }]}>{sheet ? `${niceTime(sheet.slot.start_at)} – ${niceTime(sheet.slot.end_at)}` : ""}</Text>
              <TouchableOpacity onPress={() => setSheet(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
              {sheet?.kind === "booking" && b && (
                <>
                  <Text style={st.name}>{_tx(b.student_name)} · {_tx(b.class_name)}</Text>
                  <Text style={st.meta}>{_tx(b.parent_name) || _t("Parent")}{b.booked_by_role !== "parent" ? (" " + _t("(booked by the school)") + "") : ""}</Text>
                  {!!b.topic && <Text style={st.topic}>"{_tx(b.topic)}"</Text>}
                  {!!b.parent_phone && <Btn title={_t("Call {parent_phone}", { parent_phone: b.parent_phone })} kind="ghost" icon="phone" onPress={() => call(b.parent_phone)} />}
                  {manage && started(sheet.slot) && b.status !== "cancelled" && (
                    <View style={st.actions}>
                      <Btn title={_t("Held")} kind={b.status === "attended" ? "primary" : "ghost"} icon="check" style={{ flex: 1 }} busy={busy}
                        onPress={() => run(() => markBooking(user, b.id, { status: "attended" }), () => setSheet(null))} />
                      <Btn title={_t("Missed")} kind={b.status === "no_show" ? "danger" : "ghost"} icon="user-x" style={{ flex: 1 }} busy={busy}
                        onPress={() => run(() => markBooking(user, b.id, { status: "no_show" }), () => setSheet(null))} />
                    </View>
                  )}
                  {manage && (
                    <>
                      <Field label={_t("Private note (staff only)")} value={note} onChangeText={setNote} multiline style={{ minHeight: 80, textAlignVertical: "top" }}
                        placeholder={_t("What was discussed, follow-ups…")} />
                      <Btn title={_t("Save note")} kind="ghost" icon="save" busy={busy} onPress={() => run(() => markBooking(user, b.id, { teacher_note: note }), () => setSheet(null))} />
                      {b.status === "booked" && (
                        <Btn title={_t("Cancel this meeting")} kind="danger" icon="x-circle" onPress={() => Alert.alert(_t("Cancel meeting"), _t("The parent will be told."), [
                          { text: _t("Keep it"), style: "cancel" },
                          { text: _t("Cancel meeting"), style: "destructive", onPress: () => run(() => staffCancel(user, b.id, "Cancelled by the teacher"), () => setSheet(null)) },
                        ], { cancelable: true })} />
                      )}
                    </>
                  )}
                </>
              )}
              {sheet?.kind === "free" && (
                <>
                  <Text style={st.meta}>{_t("Book this time for a family who phoned, or block it (e.g. a break).")}</Text>
                  <StudentSearch user={user} value={student} onChange={setStudent} />
                  <Field label={_t("Topic (optional)")} value={topic} onChangeText={setTopic} />
                  <Btn title={_t("Book for this student")} icon="user-plus" busy={busy} disabled={!student} onPress={() =>
                    run(() => bookFor(user, sheet.slot.id, student.enrollment_id, topic), () => setSheet(null))} />
                  <Btn title={_t("Block this slot")} kind="ghost" icon="slash" busy={busy} onPress={() => run(() => setSlot(user, sheet.slot.id, true), () => setSheet(null))} />
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "800", color: C.ink },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  topic: { fontSize: 13, color: C.ink, fontStyle: "italic", marginTop: 3 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  actions: { flexDirection: "row", gap: 8 },
  slot: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  time: { width: 70, fontSize: 13, fontWeight: "800", color: C.ink },
  pill: { fontSize: 11, fontWeight: "800", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
});
