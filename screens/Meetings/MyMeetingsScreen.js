/**
 * Parent portal › Parent–teacher meetings
 *  - My meetings: upcoming bookings (where, link, cancel) and recent ones
 *  - Book: the selected child's teachers with free times – tap a time to book it
 * Uses the child selected in the portal (like the other portal screens).
 */
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl, Modal, Linking,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import { getAvailable, bookSlot, getMyBookings, cancelMine, niceDay, niceTime, niceWhen, MODE_ICON, BOOKING_STATUS } from "../../services/MeetingApi";
import { getMyChildren } from "../../services/StudentRecordApi";
import { _t, _tx } from "../../services/i18n";

export default function MyMeetingsScreen() {
  const { user, activeEnrollmentId, setActiveEnrollmentId, linkedStudents } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const role = (user?.ssmsUserRole ?? "").toLowerCase();
  const isParent = role === "parent";
  const child = activeEnrollmentId || (role === "student" ? (user?.enrollmentId || user?.ssmsUserName) : null);
  const [fallbackKids, setFallbackKids] = useState(null);   // null = loading, [] = none / failed
  const [kidsTry, setKidsTry] = useState(0);
  const kids = Array.isArray(linkedStudents) && linkedStudents.length ? linkedStudents : (fallbackKids ?? []);
  const seq = useRef(0);   // ignore replies for a child that is no longer selected

  const [avail, setAvail] = useState(null);
  const [mine, setMine] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState(null);     // { session, slot }
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  // no child selected yet (e.g. opened from a notification): get the list so the parent can pick one
  useEffect(() => {
    if (!isParent || child || (Array.isArray(linkedStudents) && linkedStudents.length)) return;
    let off = false;
    setFallbackKids(null);
    getMyChildren(user).then((list) => { if (!off) setFallbackKids(Array.isArray(list) ? list : []); }).catch(() => { if (!off) setFallbackKids([]); });
    return () => { off = true; };
  }, [isParent, child, linkedStudents, user, kidsTry]);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true);
    try {
      const needPick = isParent && !child;
      const [a, m] = await Promise.allSettled([needPick ? Promise.resolve(null) : getAvailable(user, child || ""), getMyBookings(user)]);
      if (mySeq !== seq.current) return;
      setAvail(a.status === "fulfilled" ? a.value : null);
      setMine(m.status === "fulfilled" && Array.isArray(m.value?.bookings) ? m.value.bookings : []);
      const failed = [a, m].find((x) => x.status === "rejected");
      setErr(failed ? failed.reason?.message ?? _t("Something went wrong.") : null);
    } finally { if (mySeq === seq.current) setLoading(false); }
  }, [user, child, isParent]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { setAvail(null); }, [child]);

  const book = async () => {
    setBusy(true);
    try {
      const r = await bookSlot(user, pick.slot.id, avail?.student?.enrollment_id ?? child, topic);
      setPick(null); setTopic("");
      Alert.alert(_t("Booked"), _t("Meeting with {v} on {v2}. You'll get a reminder the day before.", { v: r.booking?.teacher ?? _t("the teacher"), v2: niceWhen(r.booking?.start_at ?? pick.slot.start_at) }));
      await load();
    } catch (e) {
      Alert.alert(_t("Booking"), _tx(e.message));
      await load();
    } finally { setBusy(false); }
  };
  const cancel = (bk) => Alert.alert(_t("Cancel meeting"), _t("Cancel the meeting with {teacher} on {start_at}?", { teacher: bk.teacher, start_at: niceWhen(bk.start_at) }), [
    { text: _t("Keep it"), style: "cancel" },
    { text: _t("Cancel meeting"), style: "destructive", onPress: async () => {
      try { const r = await cancelMine(user, bk.id, ""); setMine(Array.isArray(r?.bookings) ? r.bookings : []); load(); }
      catch (e) { Alert.alert(_t("Cancel"), _tx(e.message)); }
    } },
  ], { cancelable: true });
  const openLink = (url) => Linking.openURL(url).catch(() => Alert.alert(_t("Link"), _t("This link can't be opened on this device.")));

  const upcoming = (mine ?? []).filter((x) => x.upcoming && x.status === "booked");
  const past = (mine ?? []).filter((x) => !(x.upcoming && x.status === "booked"));
  const sessions = Array.isArray(avail?.sessions) ? avail.sessions : [];

  if (!avail && !mine && !err) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  const pickChild = (id) => {
    setChoosing(false);
    if (setActiveEnrollmentId) setActiveEnrollmentId(id);
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {!!avail?.student && (
          <View style={s.childRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.child}>{_tx(avail.student.name)}</Text>
              <Text style={s.meta}>{_tx(avail.student.class_name)}</Text>
            </View>
            {isParent && kids.length > 1 && setActiveEnrollmentId && (
              <TouchableOpacity style={s.switchBtn} onPress={() => setChoosing(true)}>
                <Feather name="repeat" size={14} color={C.brand} /><Text style={s.link}>{" "}{_t("Switch")}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {isParent && !child && (
          <Card title={_t("Choose a child")}>
            {!kids.length && fallbackKids === null && <Text style={s.meta}>{_t("Loading your children…")}</Text>}
            {!kids.length && fallbackKids !== null && (
              <>
                <Text style={s.meta}>{_t("No children are linked to your account yet, or they couldn't be loaded.")}</Text>
                <Btn title={_t("Try again")} kind="ghost" icon="refresh-cw" onPress={() => setKidsTry((n) => n + 1)} />
              </>
            )}
            {kids.map((k) => (
              <TouchableOpacity key={k.enrollment_id} style={s.pastRow} onPress={() => pickChild(k.enrollment_id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{_tx(k.student_name)}</Text>
                  <Text style={s.meta}>{[k.class_name, k.section_name].filter(Boolean).join(" ")}</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </Card>
        )}
        {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}

        <Card title={_t("My meetings")}>
          {!upcoming.length && <Text style={s.meta}>{_t("No upcoming meetings.")}</Text>}
          {upcoming.map((bk) => (
            <View key={bk.id} style={s.bk}>
              <View style={s.bkHead}>
                <Feather name={MODE_ICON[bk.mode] ?? "map-pin"} size={16} color={C.brand} />
                <Text style={[s.name, { flex: 1 }]}> {niceWhen(bk.start_at)}</Text>
              </View>
              <Text style={s.meta}>{_tx(bk.teacher)} · {_tx(bk.student?.name)} · {_tx(bk.mode_label)}</Text>
              {!!bk.location && bk.mode !== "video" && <Text style={s.meta}>{_tx(bk.location)}</Text>}
              {bk.mode === "video" && !!bk.location && (
                <TouchableOpacity onPress={() => openLink(bk.location)}><Text style={[s.link, { marginTop: 4 }]}>{_t("Join video call")}</Text></TouchableOpacity>
              )}
              {!!bk.note_for_parents && <Text style={s.note}>{_tx(bk.note_for_parents)}</Text>}
              {isParent && (bk.can_cancel
                ? <TouchableOpacity onPress={() => cancel(bk)}><Text style={[s.link, { color: C.err, marginTop: 6 }]}>{_t("Cancel")}</Text></TouchableOpacity>
                : <Text style={[s.meta, { marginTop: 4 }]}>{_t("To change it now, please call the school.")}</Text>)}
            </View>
          ))}
        </Card>

        <Card title={_t("Book a meeting")}>
          {!avail?.student && !err && <Text style={s.meta}>{_t("Choose a child first.")}</Text>}
          {!!avail?.student && !sessions.length && <Text style={s.meta}>{_t("No meeting times are open for {name} right now. Teachers publish them before parent–teacher meetings.", { name: avail.student.name })}</Text>}
          {sessions.map((x) => (
            <View key={x.id} style={s.sess}>
              <Text style={s.name}>{_tx(x.teacher)}{x.subjects?.length ? <Text style={s.meta}>  · {x.subjects.join(", ")}</Text> : null}</Text>
              <Text style={s.meta}>{_tx(x.title)} · {niceDay(x.meet_date)} · {_tx(x.mode_label)}{x.location && x.mode !== "video" ? ` · ${_tx(x.location)}` : ""}</Text>
              {!!x.note_for_parents && <Text style={s.note}>{_tx(x.note_for_parents)}</Text>}
              {x.my_booking ? (
                <Text style={[s.meta, { color: C.ok, fontWeight: "700", marginTop: 4 }]}>{_t("Booked for {start_at}", { start_at: niceTime(x.my_booking.start_at) })}</Text>
              ) : !isParent ? (
                <Text style={[s.meta, { marginTop: 4 }]}>{_t("Ask a parent to book.")}</Text>
              ) : (
                <View style={s.chips}>
                  {(x.free_slots ?? []).map((sl) => (
                    <TouchableOpacity key={sl.id} style={s.chip} onPress={() => { setTopic(""); setPick({ session: x, slot: sl }); }}>
                      <Text style={s.chipTxt}>{niceTime(sl.start_at)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </Card>

        {!!past.length && (
          <Card title={_t("Earlier")}>
            {past.map((bk) => {
              const st = BOOKING_STATUS[bk.status] ?? BOOKING_STATUS.booked;
              return (
                <View key={bk.id} style={s.pastRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{niceWhen(bk.start_at)}</Text>
                    <Text style={s.meta}>{_tx(bk.teacher)} · {_tx(bk.student?.name)}{bk.status === "cancelled" && bk.cancel_reason ? ` · ${_tx(bk.cancel_reason)}` : ""}</Text>
                  </View>
                  <Text style={[s.pill, { backgroundColor: st.bg, color: st.fg }]}>{_tx(st.label)}</Text>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>

      <Modal visible={!!pick} transparent animationType="slide" onRequestClose={() => setPick(null)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[s.sheet, { paddingBottom: 18 + insets.bottom }]}>
            <Text style={s.title}>{_t("Book {v}", { v: pick ? niceWhen(pick.slot.start_at) : "" })}</Text>
            <Text style={s.meta}>{_t("With {teacher} · {mode_label} · {slot_minutes} minutes", { teacher: pick?.session?.teacher, mode_label: pick?.session?.mode_label, slot_minutes: pick?.session?.slot_minutes })}</Text>
            <Field label={_t("What would you like to talk about? (optional)")} value={topic} onChangeText={setTopic} multiline
              style={{ minHeight: 70, textAlignVertical: "top" }} placeholder={_t("e.g. Reading, settling in, homework")} />
            <Btn title={_t("Book this time")} icon="check" busy={busy} onPress={book} />
            <Btn title={_t("Back")} kind="ghost" onPress={() => setPick(null)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={choosing} transparent animationType="fade" onRequestClose={() => setChoosing(false)}>
        <TouchableOpacity style={[s.overlay, { justifyContent: "center", padding: 20 }]} activeOpacity={1} onPress={() => setChoosing(false)}>
          <View style={[s.sheet, { borderRadius: 16 }]}>
            <Text style={s.title}>{_t("Choose a child")}</Text>
            {kids.map((k) => (
              <TouchableOpacity key={k.enrollment_id} style={s.pastRow} onPress={() => pickChild(k.enrollment_id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{_tx(k.student_name)}</Text>
                  <Text style={s.meta}>{[k.class_name, k.section_name].filter(Boolean).join(" ")}</Text>
                </View>
                {String(k.enrollment_id) === String(activeEnrollmentId) && <Feather name="check" size={18} color={C.brand} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "800", color: C.ink, marginBottom: 4 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  child: { fontSize: 16, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  note: { fontSize: 12, color: C.ink, backgroundColor: C.bg, borderRadius: 8, padding: 8, marginTop: 6, lineHeight: 17 },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  childRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  switchBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.brandSoft },
  bk: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  bkHead: { flexDirection: "row", alignItems: "center" },
  sess: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { borderWidth: 1.5, borderColor: C.brand, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  chipTxt: { fontSize: 13, fontWeight: "700", color: C.brand },
  pastRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  pill: { fontSize: 11, fontWeight: "800", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
});
