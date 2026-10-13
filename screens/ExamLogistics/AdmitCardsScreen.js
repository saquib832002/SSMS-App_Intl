/**
 * Admit cards / hall tickets for an exam: rules (fees, attendance), the office's decisions,
 * publishing (gives every student a hall-ticket number and tells parents) and printing.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Field, Toggle, Picker } from "../../components/ReportCardUI";
import { getAdmitList, saveAdmitSettings, setAdmitStatus, publishAdmit, getPrintCards, admitCardsHtml, sharePdf } from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

function StatusPill({ status }) {
  const ok = status === "eligible";
  return (
    <View style={[s.pill, { borderColor: ok ? "#0ca30c" : "#d03b3b" }]}>
      <Feather name={ok ? "check-circle" : "slash"} size={11} color={ok ? "#0ca30c" : "#d03b3b"} />
      <Text style={s.pillTxt}>{ok ? _t("Eligible") : _t("Withheld")}</Text>
    </View>
  );
}

export default function AdmitCardsScreen({ route }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const examId = route?.params?.examId;
  const sessionId = route?.params?.sessionId;
  const [classId, setClassId] = useState("");
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [rules, setRules] = useState(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState(null);   // student row
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await getAdmitList(user, { exam_id: examId, session_id: sessionId, class_id: classId || undefined });
      setD(r); setErr(null);
      setRules((x) => x ?? { rule_fees: r.settings.rule_fees, fee_tolerance: String(r.settings.fee_tolerance ?? 0), rule_attendance: r.settings.rule_attendance == null ? "" : String(r.settings.rule_attendance),
        show_photo: r.settings.show_photo, instructions: r.settings.instructions ?? "" });
    } catch (e) { setErr(e.message); }
  }, [user, examId, sessionId, classId]);
  useEffect(() => { load(); }, [load]);

  const saveRules = async () => {
    setBusy(true);
    try {
      await saveAdmitSettings(user, { exam_id: examId, session_id: sessionId, rule_fees: rules.rule_fees ? 1 : 0, fee_tolerance: +rules.fee_tolerance || 0,
        rule_attendance: rules.rule_attendance === "" ? null : +rules.rule_attendance, show_photo: rules.show_photo ? 1 : 0, instructions: rules.instructions });
      await load();
      Alert.alert(_t("Saved"), _t("Eligibility has been checked again with these rules."));
    } catch (e) { Alert.alert(_t("Admit cards"), _tx(e.message)); } finally { setBusy(false); }
  };

  const togglePublish = () => {
    const pub = !d.settings.published;
    Alert.alert(pub ? _t("Publish admit cards?") : _t("Unpublish admit cards?"), pub
      ? _t("Every student in the school year gets a hall-ticket number. Families of eligible students can see the card in the app and are notified. Withheld students see the reason instead.")
      : _t("Families won't see admit cards until you publish again. Hall-ticket numbers are kept."), [
      { text: _t("Cancel"), style: "cancel" },
      { text: pub ? _t("Publish") : _t("Unpublish"), onPress: async () => {
        setBusy(true);
        try { const r = await publishAdmit(user, examId, sessionId, pub); await load(); if (pub) Alert.alert(_t("Published"), _t("{issued} new hall-ticket numbers. {notified} notification{pl} sent.", { issued: r.issued, notified: r.notified, pl: r.notified === 1 ? "" : "s" })); }
        catch (e) { Alert.alert(_t("Admit cards"), _tx(e.message)); } finally { setBusy(false); }
      } },
    ]);
  };

  const applyDecision = async (override) => {
    if (override === "withhold" && !reason.trim()) { Alert.alert(_t("Withhold"), _t("Write the reason – the family sees it.")); return; }
    setBusy(true);
    try {
      await setAdmitStatus(user, { exam_id: examId, session_id: sessionId, enrollment_id: decide.enrollment_id, override, reason: reason.trim() });
      setDecide(null); setReason("");
      await load();
    } catch (e) { Alert.alert(_t("Admit card"), _tx(e.message)); } finally { setBusy(false); }
  };

  const print = async () => {
    if (!classId) { Alert.alert(_t("Print"), _t("Choose a class first – hall tickets are printed class by class.")); return; }
    setBusy(true);
    try {
      const r = await getPrintCards(user, { exam_id: examId, session_id: sessionId, class_id: classId });
      if (!r.cards?.length) { Alert.alert(_t("Print"), _t("No eligible students in this class.")); return; }
      await sharePdf(admitCardsHtml(r), "Hall tickets");
    } catch (e) { Alert.alert(_t("Print"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (!d) return <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>{err ? <Card><Empty icon="alert-circle" text={_tx(err)} /></Card> : <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}</View>;
  const can = d.can ?? {};
  const list = d.students.filter((x) => filter === "all" || x.status === filter);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Text style={s.head}>{_tx(d.exam.name)} · {_tx(d.session.name)}</Text>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name={d.settings.published ? "check-circle" : "eye-off"} size={16} color={d.settings.published ? "#0ca30c" : C.muted} />
            <Text style={[s.name, { flex: 1 }]}>{d.settings.published ? _t("Published – families can see the cards") : _t("Not published yet")}</Text>
          </View>
          <Text style={s.meta}>{_t("{eligible} eligible · {withheld} withheld{v}{v2}", { eligible: d.counts.eligible, withheld: d.counts.withheld, v: d.settings.published ? ` ${_t("· {viewed} opened in the app", { viewed: d.counts.viewed })}` : "", v2: classId ? (" " + _t("(this class)") + "") : "" })}</Text>
          {!!d.no_schedule?.length && <Text style={s.warn}>{_t("No published date sheet for: {v}. Their cards will say the timetable is coming.", { v: d.no_schedule.join(", ") })}</Text>}
          {can.approve && <Btn title={d.settings.published ? _t("Unpublish") : _t("Publish admit cards")} icon={d.settings.published ? "eye-off" : "send"} kind={d.settings.published ? "ghost" : "primary"} busy={busy} onPress={togglePublish} />}
          {can.export && d.settings.published && <Btn title={classId ? _t("Print hall tickets for this class") : _t("Choose a class to print")} icon="printer" kind="ghost" onPress={print} disabled={busy} />}
        </Card>

        {rules && (
          <Card title={_t("Rules")}>
            <Toggle label={_t("Withhold when fees are overdue")} value={rules.rule_fees} onChange={(v) => setRules((x) => ({ ...x, rule_fees: v }))} hint={_t("Academic fees due up to today, after discounts.")} />
            {rules.rule_fees && <Field label={_t("Ignore dues up to ({v})", { v: d.currency || "amount" })} keyboardType="decimal-pad" value={rules.fee_tolerance} editable={can.edit}
              onChangeText={(v) => setRules((x) => ({ ...x, fee_tolerance: v.replace(/[^\d.]/g, "") }))} />}
            <Field label={_t("Minimum attendance % (empty = no rule)")} keyboardType="number-pad" value={rules.rule_attendance} editable={can.edit} maxLength={3}
              onChangeText={(v) => setRules((x) => ({ ...x, rule_attendance: v.replace(/\D/g, "") }))} placeholder={_t("e.g. 75")} />
            <Toggle label={_t("Show the student's photo")} value={rules.show_photo} onChange={(v) => setRules((x) => ({ ...x, show_photo: v }))} />
            <Field label={_t("Instructions printed on the card (one per line)")} value={rules.instructions} editable={can.edit} multiline
              onChangeText={(v) => setRules((x) => ({ ...x, instructions: v }))} style={{ minHeight: 110, textAlignVertical: "top" }} />
            {can.edit && <Btn title={_t("Save rules")} icon="save" busy={busy} onPress={saveRules} />}
          </Card>
        )}

        <Picker label={_t("Class")} value={classId} options={[{ value: "", label: _t("All classes") }, ...(d.classes ?? []).map((c) => ({ value: String(c.class_id), label: c.name }))]} onChange={(v) => setClassId(String(v))} />
        <View style={s.chips}>
          {[["all", "Everyone"], ["eligible", "Eligible"], ["withheld", "Withheld"]].map(([k, l]) => (
            <TouchableOpacity key={k} style={[s.chip, filter === k && s.chipOn]} onPress={() => setFilter(k)}>
              <Text style={[s.chipTxt, filter === k && { color: C.brand }]}>{_tx(l)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Card>
          {list.length ? list.slice(0, 300).map((x) => (
            <TouchableOpacity key={x.enrollment_id} style={s.row} disabled={!can.approve} onPress={() => { setDecide(x); setReason(x.override === "withhold" ? (x.note ?? "") : ""); }} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>{_tx(x.name)}</Text>
                  <StatusPill status={x.status} />
                </View>
                <Text style={s.meta}>{_t("{class_name} · Roll {v}{v2}", { class_name: x.class_name, v: x.roll || "–", v2: x.ticket_no ? ` · ${x.ticket_no}` : "" })}</Text>
                {x.reasons.map((r, i) => <Text key={i} style={s.reason}>• {_tx(r)}</Text>)}
                {x.override && <Text style={s.reason}>{_t("Office: {v}{v2}", { v: x.override === "allow" ? "allowed" : "withheld", v2: x.note ? ` – ${x.note}` : "" })}</Text>}
              </View>
              {can.approve && <Feather name="more-vertical" size={16} color="#94a3b8" />}
            </TouchableOpacity>
          )) : <Empty icon="users" text={_t("No students here.")} />}
          {list.length > 300 && <Text style={s.meta}>{_t("Showing 300 of {length}. Choose a class to see the rest.", { length: list.length })}</Text>}
        </Card>
      </ScrollView>

      <Modal visible={!!decide} transparent animationType="fade" onRequestClose={() => setDecide(null)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.sheet}>
            <Text style={s.head}>{_tx(decide?.name)}</Text>
            <Text style={s.meta}>{decide?.reasons?.length ? _t("Rules: {v}", { v: decide.reasons.join("; ") }) : _t("Meets the rules.")}</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder={_t("Reason / note (shown to the family if withheld)")} placeholderTextColor="#94a3b8" style={s.input} maxLength={200} />
            <Btn title={_t("Allow the card")} icon="check" onPress={() => applyDecision("allow")} busy={busy} />
            <Btn title={_t("Withhold the card")} icon="slash" kind="danger" onPress={() => applyDecision("withhold")} disabled={busy} />
            {!!decide?.override && <Btn title={_t("Follow the rules again")} icon="rotate-ccw" kind="ghost" onPress={() => applyDecision(null)} disabled={busy} />}
            <Btn title={_t("Cancel")} kind="ghost" onPress={() => setDecide(null)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  head: { fontSize: 15, fontWeight: "800", color: C.ink, marginBottom: 8 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 17 },
  warn: { fontSize: 12, color: C.warn, fontWeight: "600", marginTop: 6 },
  reason: { fontSize: 12, color: "#334155", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  pill: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1.2, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  pillTxt: { fontSize: 10.5, fontWeight: "800", color: C.ink },
  chips: { flexDirection: "row", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.ink, marginTop: 10 },
});
