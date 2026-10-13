/**
 * Publish (or change) a parent–teacher meeting session: date, time window, slot length,
 * break, how it happens, who can book. Times can't change after parents have booked.
 */
import React, { useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Field, Toggle, Picker } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import { saveSession, getTeachers } from "../../services/MeetingApi";
import { fetchClasses } from "../../services/SetupServiceApi";
import { _t, _tx } from "../../services/i18n";

const pad = (n) => String(n).padStart(2, "0");
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toMin = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };

export default function MeetingEditScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const old = route?.params?.session ?? null;
  const locked = !!old && (old.booked ?? (Array.isArray(old.slot_list) ? old.slot_list.filter((x) => x.booking).length : 0)) > 0;
  const [f, setF] = useState(() => old ? {
    id: old.id, staff_id: old.staff_id, title: old.title, meet_date: old.meet_date, start_time: old.start_time, end_time: old.end_time,
    slot_minutes: String(old.slot_minutes), gap_minutes: String(old.gap_minutes), mode: old.mode, location: old.location ?? "",
    closes_hours: String(old.closes_hours), note_for_parents: old.note_for_parents ?? "", status: old.status,
    audience: Array.isArray(old.audience) ? old.audience : null,
  } : {
    title: _t("Parent–teacher meeting"), meet_date: tomorrow(), start_time: "15:00", end_time: "17:00", slot_minutes: "10", gap_minutes: "0",
    mode: "in_person", location: "", closes_hours: "12", note_for_parents: "", status: "open", audience: null,
  });
  const [teachers, setTeachers] = useState(null);
  const [classes, setClasses] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    if (!old) {
      getTeachers(user).then((r) => {
        if (off) return;
        const list = Array.isArray(r?.teachers) ? r.teachers : [];
        setTeachers(list);
        // an office account without its own staff record has to publish for a teacher
        if (route?.params?.hasStaff === false && list.length) setF((x) => (x.staff_id ? x : { ...x, staff_id: list[0].staff_id }));
      }).catch(() => { if (!off) setTeachers(null); });
    }
    fetchClasses(user).then((r) => { if (!off) setClasses(Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []); }).catch(() => {});
    return () => { off = true; };
  }, [user, old]);   // eslint-disable-line react-hooks/exhaustive-deps

  const slots = useMemo(() => {
    const a = toMin(f.start_time), b = toMin(f.end_time), len = parseInt(f.slot_minutes, 10), gap = parseInt(f.gap_minutes || "0", 10);
    if (a == null || b == null || !len || len < 5 || b <= a) return 0;
    let n = 0; for (let t = a; t + len <= b; t += len + (gap || 0)) n++;
    return n;
  }, [f.start_time, f.end_time, f.slot_minutes, f.gap_minutes]);

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const custom = Array.isArray(f.audience);
  const toggleClass = (id) => setF((x) => {
    const list = Array.isArray(x.audience) ? x.audience : [];
    const has = list.some((a) => +a.class_id === +id);
    return { ...x, audience: has ? list.filter((a) => +a.class_id !== +id) : [...list, { class_id: +id, section_id: null }] };
  });

  const save = async () => {
    if (custom && !f.audience.length) { Alert.alert(_t("Who can book"), _t("Choose at least one class, or switch back to your own classes.")); return; }
    setBusy(true);
    try {
      const body = { ...f, slot_minutes: parseInt(f.slot_minutes, 10), gap_minutes: parseInt(f.gap_minutes || "0", 10), closes_hours: parseInt(f.closes_hours || "0", 10),
        audience: custom ? f.audience : null };
      if (!body.staff_id) delete body.staff_id;
      const r = await saveSession(user, body);
      const id = r?.session?.id;
      Alert.alert(old ? _t("Saved") : _t("Published"), old ? _t("The session was updated.") : _t("{v} slots are open for booking.", { v: r?.session?.slot_list?.length ?? slots }));
      if (old) navigation.goBack();
      else if (id) navigation.replace("MeetingSession", { id, title: r.session.title });
      else navigation.goBack();
    } catch (e) { Alert.alert(_t("Meeting slots"), _tx(e.message)); } finally { setBusy(false); }
  };

  const teacherOpts = [...(route?.params?.hasStaff === false ? [] : [{ value: "", label: _t("Me") }]), ...(teachers ?? []).map((t) => ({ value: t.staff_id, label: t.name }))];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Card title={_t("Session")}>
          {!old && Array.isArray(teachers) && teachers.length > 0 && (
            <Picker label={_t("Teacher")} value={f.staff_id ?? ""} options={teacherOpts} onChange={(v) => setF((x) => ({ ...x, staff_id: v || undefined }))} />
          )}
          <Field label={_t("Title")} value={f.title} onChangeText={set("title")} placeholder={_t("e.g. Term 1 parent–teacher meetings")} />
          {locked && <Text style={s.warn}>{_t("Parents have booked, so the date and times can't change. To move it, cancel the session and publish a new one.")}</Text>}
          {!locked ? (
            <>
              <DateTimeField label={_t("Date")} value={f.meet_date} onChange={set("meet_date")} />
              <View style={s.two}>
                <View style={{ flex: 1 }}><DateTimeField label={_t("From")} mode="time" value={f.start_time} onChange={set("start_time")} /></View>
                <View style={{ flex: 1 }}><DateTimeField label={_t("To")} mode="time" value={f.end_time} onChange={set("end_time")} /></View>
              </View>
              <View style={s.two}>
                <View style={{ flex: 1 }}><Field label={_t("Slot (minutes)")} keyboardType="number-pad" value={f.slot_minutes} onChangeText={(v) => set("slot_minutes")(v.replace(/\D/g, ""))} /></View>
                <View style={{ flex: 1 }}><Field label={_t("Break between (min)")} keyboardType="number-pad" value={f.gap_minutes} onChangeText={(v) => set("gap_minutes")(v.replace(/\D/g, ""))} /></View>
              </View>
              <Text style={s.meta}>{slots ? _t("{slots} slots", { slots }) : _t("The time window is shorter than one slot.")}</Text>
            </>
          ) : (
            <Text style={s.meta}>{_t("{meet_date} · {start_time}–{end_time} · {slot_minutes} min slots", { meet_date: f.meet_date, start_time: f.start_time, end_time: f.end_time, slot_minutes: f.slot_minutes })}</Text>
          )}
        </Card>

        <Card title={_t("How and where")}>
          <Picker label={_t("Meeting by")} value={f.mode} onChange={set("mode")}
            options={[{ value: "in_person", label: _t("In person") }, { value: "video", label: _t("Video call") }, { value: "phone", label: _t("Phone call") }]} />
          <Field label={f.mode === "video" ? _t("Video link (https://…)") : f.mode === "phone" ? _t("Notes (e.g. the teacher will call you)") : _t("Room / place")}
            value={f.location} onChangeText={set("location")} autoCapitalize={f.mode === "video" ? "none" : "sentences"}
            placeholder={f.mode === "video" ? "https://meet.google.com/…" : f.mode === "in_person" ? _t("e.g. Room 12") : ""} />
          {f.mode === "video" && <Text style={s.meta}>{_t("Parents only see the link after they book.")}</Text>}
          <Field label={_t("Message for parents (optional)")} value={f.note_for_parents} onChangeText={set("note_for_parents")} multiline
            style={{ minHeight: 70, textAlignVertical: "top" }} placeholder={_t("e.g. Please bring the reading log.")} />
        </Card>

        <Card title={_t("Who can book")}>
          <Toggle label={_t("Parents of my classes")} value={!custom} onChange={(v) => setF((x) => ({ ...x, audience: v ? null : [] }))}
            hint={_t("The classes this teacher teaches or is class teacher of.")} />
          {custom && (
            <View style={s.chips}>
              {classes.map((c) => {
                const on = (f.audience ?? []).some((a) => +a.class_id === +c.class_id);
                return (
                  <TouchableOpacity key={c.class_id} onPress={() => toggleClass(c.class_id)} style={[s.chip, on && s.chipOn]}>
                    <Text style={[s.chipTxt, on && { color: C.brand }]}>{_tx(c.class_name)}</Text>
                  </TouchableOpacity>
                );
              })}
              {!classes.length && <Text style={s.meta}>{_t("No classes found.")}</Text>}
            </View>
          )}
          <Field label={_t("Booking closes (hours before each slot)")} keyboardType="number-pad" value={f.closes_hours} onChangeText={(v) => set("closes_hours")(v.replace(/\D/g, ""))} />
          <Text style={s.meta}>{_t("Parents can't book or cancel in the app after that; you can still book for them.")}</Text>
          {!!old && <Toggle label={_t("Open for booking")} value={f.status === "open"} onChange={(v) => set("status")(v ? "open" : "closed")} />}
        </Card>

        <Btn title={old ? _t("Save changes") : _t("Publish slots")} icon={old ? "save" : "send"} busy={busy} onPress={save} disabled={!locked && !slots} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  two: { flexDirection: "row", gap: 10 },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, marginBottom: 6, lineHeight: 17 },
  warn: { fontSize: 12, color: C.warn, fontWeight: "600", marginBottom: 8, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
});
