/**
 * Parent / student: the child's admit cards (hall tickets) – papers with date, time, hall and seat –
 * with a PDF to save or print. A withheld card shows the school's reason instead.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty } from "../../components/ReportCardUI";
import { getMyAdmitCards, admitCardsHtml, sharePdf, niceDate, timeRange } from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

export default function MyAdmitCardScreen() {
  const { user, activeEnrollmentId, setActiveEnrollmentId, linkedStudents } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const role = (user?.ssmsUserRole ?? "").toLowerCase();
  const child = activeEnrollmentId || (role === "student" ? (user?.enrollmentId || user?.ssmsUserName) : null) || null;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await getMyAdmitCards(user, child ?? undefined)); setErr(null); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [user, child]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async (x) => {
    setSaving(x.exam.exam_id);
    try { await sharePdf(admitCardsHtml({ school: x.school, exam: x.exam, session: x.session, instructions: x.instructions, show_photo: x.show_photo, cards: [x.card] }), "Admit card"); }
    catch (e) { Alert.alert(_t("Admit card"), _tx(e.message)); } finally { setSaving(null); }
  };

  const kids = Array.isArray(linkedStudents) ? linkedStudents : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} />}>
      {role === "parent" && kids.length > 1 && setActiveEnrollmentId && (
        <View style={s.kids}>
          {kids.map((k) => {
            const on = String(k.enrollment_id) === String(d?.enrollment_id ?? child);
            return (
              <TouchableOpacity key={k.enrollment_id} style={[s.kid, on && s.kidOn]} onPress={() => setActiveEnrollmentId(k.enrollment_id)}>
                <Text style={[s.kidTxt, on && { color: C.brand }]}>{_tx(k.student_name)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {!d && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
      {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /><Btn title={_t("Try again")} kind="ghost" icon="refresh-cw" onPress={load} /></Card>}
      {d && !d.exams.length && <Card><Empty icon="credit-card" text={_t("No admit cards yet. The school will let you know when they are ready.")} /></Card>}
      {(d?.exams ?? []).map((x) => x.status !== "eligible" ? (
        <Card key={x.exam.exam_id} title={_tx(x.exam.name)}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Feather name="slash" size={18} color="#d03b3b" />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{_t("The admit card is on hold")}</Text>
              <Text style={s.meta}>{_tx(x.reason)}</Text>
              <Text style={s.meta}>{_t("Please contact the school office.")}</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card key={x.exam.exam_id}>
          <View style={s.top}>
            <View style={{ flex: 1 }}>
              <Text style={s.small}>{_tx(x.school?.name)}</Text>
              <Text style={s.title}>{_t("Admit card · {name}", { name: x.exam.name })}</Text>
              <Text style={s.ticket}>{_tx(x.card.ticket_no) ?? "—"}</Text>
            </View>
            {x.show_photo && !!x.card.photo && <Image source={{ uri: x.card.photo }} style={s.photo} />}
          </View>
          <Text style={s.name}>{_tx(x.card.name)}</Text>
          <Text style={s.meta}>{_t("{class_name} · Roll {v}{v2}", { class_name: x.card.class_name, v: x.card.roll || "–", v2: x.session?.name ? ` · ${x.session.name}` : "" })}</Text>
          <View style={s.table}>
            {x.card.papers.length ? x.card.papers.map((pp, i) => (
              <View key={i} style={s.paper}>
                <View style={{ flex: 1 }}>
                  <Text style={s.paperName}>{_tx(pp.subject)}</Text>
                  <Text style={s.meta}>{niceDate(pp.exam_date)} · {timeRange(pp.start_time, pp.end_time)}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {pp.seat ? (<><Text style={s.seat}>{_tx(pp.seat)}</Text><Text style={s.meta}>{_tx(pp.hall)}</Text></>) : <Text style={s.meta}>{_tx(pp.venue) || _t("Seat to be announced")}</Text>}
                </View>
              </View>
            )) : <Text style={s.meta}>{_t("The timetable will be shared soon.")}</Text>}
          </View>
          {!!x.instructions && <Text style={s.instr}>{_tx(x.instructions)}</Text>}
          <Btn title={_t("Save / print PDF")} icon="download" busy={saving === x.exam.exam_id} onPress={() => save(x)} />
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  kids: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  kid: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  kidOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  kidTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  top: { flexDirection: "row", gap: 10, marginBottom: 8 },
  small: { fontSize: 11.5, color: C.muted, fontWeight: "700" },
  title: { fontSize: 15, fontWeight: "800", color: C.ink, marginTop: 2 },
  ticket: { fontSize: 18, fontWeight: "800", color: C.brand, marginTop: 4, letterSpacing: 0.5 },
  photo: { width: 64, height: 78, borderRadius: 6, backgroundColor: "#f1f5f9" },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  table: { marginTop: 10, borderTopWidth: 1, borderTopColor: C.line },
  paper: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", gap: 10 },
  paperName: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  seat: { fontSize: 15, fontWeight: "800", color: C.ink },
  instr: { fontSize: 12, color: "#334155", marginTop: 10, lineHeight: 18 },
});
