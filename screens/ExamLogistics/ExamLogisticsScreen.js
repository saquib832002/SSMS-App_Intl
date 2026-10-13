/**
 * Exam halls & seating – pick an exam; every date + time in its date sheet is a "sitting".
 * Each sitting gets a seating plan (who sits where) and invigilators; admit cards list it all.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker } from "../../components/ReportCardUI";
import { getSetup, getSittings, getRoster, rosterHtml, sharePdf, letterheadFor, niceDate, timeRange } from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

export function StatusChip({ status }) {
  const map = { published: ["check-circle", "Published", "#0ca30c"], draft: ["edit-3", "Draft", "#a16207"], none: ["minus-circle", "No plan yet", C.muted] };
  const [icon, label, color] = map[status] ?? map.none;
  return (
    <View style={[s.chip, { borderColor: color }]}>
      <Feather name={icon} size={11} color={color} />
      <Text style={s.chipTxt}>{_tx(label)}</Text>
    </View>
  );
}

export default function ExamLogisticsScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [setup, setSetup] = useState(null);
  const [err, setErr] = useState(null);
  const [examId, setExamId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [branchId, setBranchId] = useState("0");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const loadSetup = useCallback(async () => {
    try {
      const r = await getSetup(user);
      setSetup(r); setErr(null);
      setExamId((x) => x || (r.exams?.[0] ? String(r.exams[0].exam_id) : ""));
      setSessionId((x) => x || (r.current_session ? String(r.current_session) : ""));
    } catch (e) { setErr(e.message); }
  }, [user]);
  useEffect(() => { loadSetup(); }, [loadSetup]);

  const load = useCallback(async () => {
    if (!examId || !sessionId) return;
    setLoading(true);
    try { setData(await getSittings(user, { exam_id: examId, session_id: sessionId, branch_id: branchId })); setErr(null); }
    catch (e) { setErr(e.message); setData(null); }
    finally { setLoading(false); }
  }, [user, examId, sessionId, branchId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const printRoster = async () => {
    setPrinting(true);
    try {
      const r = await getRoster(user, { exam_id: examId, session_id: sessionId, branch_id: branchId });
      if (!r.rows?.length) { Alert.alert(_t("Duty roster"), _t("No invigilators have been assigned for this exam yet.")); return; }
      await sharePdf(rosterHtml(r, await letterheadFor(user)), "Invigilation roster");
    } catch (e) { Alert.alert(_t("Duty roster"), _tx(e.message)); } finally { setPrinting(false); }
  };

  if (!setup) {
    return (
      <View style={[s.center, { backgroundColor: C.bg }]}>
        {err ? <Card style={{ margin: 16, alignSelf: "stretch" }}><Empty icon="alert-circle" text={_tx(err)} /><Btn title={_t("Try again")} kind="ghost" icon="refresh-cw" onPress={loadSetup} /></Card>
          : <ActivityIndicator color={C.brand} />}
      </View>
    );
  }
  const can = setup.can ?? {};
  const list = data?.sittings ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} />}>
      {!setup.exams?.length ? (
        <Card><Empty icon="file-text" text={_t("No exams yet. Create the exam and its date sheet first (Examinations › Create Exam, Date Sheet).")} /></Card>
      ) : (
        <>
          <Picker label={_t("Exam")} value={examId} options={setup.exams.map((x) => ({ value: String(x.exam_id), label: x.name }))} onChange={(v) => setExamId(String(v))} />
          <View style={s.two}>
            {setup.sessions?.length > 1 && (
              <View style={{ flex: 1 }}>
                <Picker label={_t("School year")} value={sessionId} options={setup.sessions.map((x) => ({ value: String(x.id), label: x.name, sub: x.current ? _t("Current") : undefined }))}
                  onChange={(v) => setSessionId(String(v))} />
              </View>
            )}
            {setup.branches?.length > 0 && (
              <View style={{ flex: 1 }}>
                <Picker label={_t("Branch")} value={branchId} options={[{ value: "0", label: _t("All branches") }, ...setup.branches.map((b) => ({ value: String(b.branch_id), label: b.name }))]}
                  onChange={(v) => setBranchId(String(v))} />
              </View>
            )}
          </View>

          <View style={s.tiles}>
            <Tile icon="grid" label={_t("Exam halls")} sub={_t("{halls} in use", { halls: setup.halls })} onPress={() => navigation.navigate("ExamHalls")} />
            <Tile icon="credit-card" label={_t("Admit cards")} sub={_t("Rules, publish, print")} onPress={() => examId && navigation.navigate("AdmitCards", { examId: +examId, sessionId: +sessionId })} />
            <Tile icon="users" label={_t("Duty roster")} sub={printing ? _t("Preparing…") : _t("Print (PDF)")} onPress={printRoster} />
            {can.has_staff && <Tile icon="user-check" label={_t("My duties")} sub={_t("Where I invigilate")} onPress={() => navigation.navigate("MyExamDuties")} />}
          </View>

          <Text style={s.section}>{_t("Sittings from the date sheet")}</Text>
          {!data && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} />}
          {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
          {data && !list.length && (
            <Card><Empty icon="calendar" text={_t("This exam has no date sheet for this school year yet. Add dates and times in Examinations › Date Sheet, then come back to seat students.")} /></Card>
          )}
          {list.map((x) => {
            const status = x.plan?.status ?? "none";
            return (
              <TouchableOpacity key={x.key} activeOpacity={0.8} onPress={() => navigation.navigate("SeatingPlan", {
                examId: +examId, sessionId: +sessionId, branchId: +branchId, examName: data.exam.name, sitting: x, planId: x.plan?.plan_id ?? null, schoolName: setup.school?.name, canEdit: !!can.edit })}>
                <Card>
                  <View style={s.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.title}>{niceDate(x.exam_date)}</Text>
                      <Text style={s.meta}>{timeRange(x.start_time, x.end_time)}</Text>
                    </View>
                    <StatusChip status={status} />
                  </View>
                  {x.orphan ? <Text style={s.warn}>{_t("The date sheet no longer has a paper at this time. Open the plan to delete it.")}</Text> : (
                    <Text style={s.meta}>{x.classes.map((cl) => `${cl.name} (${cl.subjects.join(", ")})`).join(" · ")}</Text>
                  )}
                  <View style={s.facts}>
                    <Fact icon="users" text={_t("{students} students", { students: x.students })} />
                    {x.plan && <Fact icon="check-square" text={_t("{seated} seated in {halls} hall{pl}", { seated: x.plan.seated, halls: x.plan.halls, pl: x.plan.halls === 1 ? "" : "s" })} />}
                    {x.plan && <Fact icon="user-check" text={_t("{duties} invigilator{pl}", { duties: x.plan.duties, pl: x.plan.duties === 1 ? "" : "s" })} />}
                    {!x.published && !x.orphan && <Fact icon="eye-off" text={_t("Date sheet not published")} />}
                  </View>
                  {x.plan && x.plan.seated !== x.students && !x.orphan && (
                    <Text style={s.warn}>{_t("{v} – regenerate the plan.", { v: x.students - x.plan.seated > 0 ? _t("{v} students have no seat yet", { v: x.students - x.plan.seated }) : _t("Some seated students have left") })}</Text>
                  )}
                </Card>
              </TouchableOpacity>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function Tile({ icon, label, sub, onPress }) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.8}>
      <Feather name={icon} size={18} color={C.brand} />
      <Text style={s.tileLabel}>{_tx(label)}</Text>
      <Text style={s.tileSub} numberOfLines={1}>{_tx(sub)}</Text>
    </TouchableOpacity>
  );
}

function Fact({ icon, text }) {
  return (
    <View style={s.fact}><Feather name={icon} size={11} color={C.muted} /><Text style={s.factTxt}>{_tx(text)}</Text></View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  two: { flexDirection: "row", gap: 8 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  tile: { flexGrow: 1, flexBasis: "45%", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12 },
  tileLabel: { fontSize: 14, fontWeight: "800", color: C.ink, marginTop: 6 },
  tileSub: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  section: { fontSize: 12, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 8 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  warn: { fontSize: 12, color: C.warn, fontWeight: "600", marginTop: 6 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  fact: { flexDirection: "row", alignItems: "center", gap: 4 },
  factTxt: { fontSize: 11.5, color: C.muted },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "#fff" },
  chipTxt: { fontSize: 11, fontWeight: "800", color: C.ink },
});
