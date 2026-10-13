/**
 * Exams › Report Card Setup (owner / admin)
 * A report card = which exams count and how much (term weighting), the grading
 * scale, the template and what to show. Publishing lets students/parents see it.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, Modal, TouchableOpacity,
  RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getPlans, savePlan, deletePlan, publishPlan, getScales } from "../../services/ReportCardApi";
import { fetchExams } from "../../services/ExamServiceApi";
import { fetchClasses, fetchSessions } from "../../services/SetupServiceApi";
import { TEMPLATE_OPTIONS } from "../../constants/reportCardTemplates";
import { C, Card, Btn, Field, Toggle, Picker, Empty, u } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const newPlan = (sessionId) => ({
  id: null, name: "", session_id: sessionId ?? "", class_id: "", scale_id: "", template: "classic",
  show_term_columns: true, show_gpa: false, show_rank: false, show_attendance: true,
  principal_name: "", footer_note: "",
  terms: [{ label: _t("Term 1"), exam_id: "", weight: "100" }],
});

export default function ReportCardSetupScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const role    = String(user?.ssmsUserRole ?? "").toLowerCase();
  const canEdit = role === "owner" || role === "admin";

  const [plans, setPlans]       = useState([]);
  const [exams, setExams]       = useState([]);
  const [classes, setClasses]   = useState([]);
  const [sessions, setSessions] = useState([]);
  const [scales, setScales]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(null);
  const [edit, setEdit]         = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, e, c, s, g] = await Promise.all([
        getPlans(user), fetchExams(user).catch(() => []), fetchClasses(user).catch(() => []),
        fetchSessions(user).catch(() => []), getScales(user).catch(() => ({ scales: [] })),
      ]);
      // fetchSessions returns the raw { status, data } body, not an array
      setPlans(Array.isArray(p) ? p : []); setExams(Array.isArray(e) ? e : []); setClasses(Array.isArray(c) ? c : []);
      setSessions(Array.isArray(s) ? s : Array.isArray(s?.data) ? s.data : []); setScales(Array.isArray(g?.scales) ? g.scales : []);
    } catch (err) {
      Alert.alert(_t("Report cards"), _tx(err.message));
    } finally { setLoading(false); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); await load(); return true; }
    catch (e) { Alert.alert(_t("Report cards"), _tx(e.message)); return false; }
    finally { setBusy(null); }
  };

  const examOpts    = useMemo(() => exams.map((x) => ({ value: String(x.exam_id), label: x.exam_name, sub: x.exam_category })), [exams]);
  const sessionOpts = useMemo(() => [{ value: "", label: _t("All sessions") },
    ...sessions.map((x) => ({ value: String(x.session_id), label: x.session_name || x.session_year }))], [sessions]);
  const classOpts   = useMemo(() => [{ value: "", label: _t("All classes") },
    ...classes.map((x) => ({ value: String(x.class_id), label: x.class_name }))], [classes]);
  const scaleOpts   = useMemo(() => [{ value: "", label: _t("School default scale") },
    ...scales.map((x) => ({ value: String(x.id), label: x.name + (x.is_default ? " (default)" : "") }))], [scales]);

  const totalWeight = (edit?.terms ?? []).reduce((a, t) => a + (parseFloat(t.weight) || 0), 0);

  const openEdit = (p) => setEdit(p ? {
    ...p,
    session_id: p.session_id ? String(p.session_id) : "", class_id: p.class_id ? String(p.class_id) : "",
    scale_id: p.scale_id ? String(p.scale_id) : "", principal_name: p.principal_name ?? "", footer_note: p.footer_note ?? "",
    terms: (Array.isArray(p.terms) ? p.terms : []).map((t) => ({ label: t.label, exam_id: String(t.exam_id), weight: String(t.weight) })),
  } : newPlan(sessions.length === 1 ? String(sessions[0].session_id) : ""));

  const setTerm = (i, k, v) => setEdit((e) => { const terms = e.terms.slice(); terms[i] = { ...terms[i], [k]: v }; return { ...e, terms }; });

  const splitEvenly = () => setEdit((e) => {
    const n = e.terms.length; if (!n) return e;
    const base = Math.floor((100 / n) * 100) / 100;
    return { ...e, terms: e.terms.map((t, i) => ({ ...t, weight: String(i === n - 1 ? +(100 - base * (n - 1)).toFixed(2) : base) })) };
  });

  const onSave = async () => {
    const ok = await run("save", () => savePlan(user, edit));
    if (ok) setEdit(null);
  };

  const onDelete = (p) => Alert.alert(_t("Delete report card"), _t("Delete \"{name}\" and its teacher comments?", { name: p.name }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Delete"), style: "destructive", onPress: () => run("del-" + p.id, () => deletePlan(user, p.id)) },
  ]);

  if (loading) return <View style={st.center}><ActivityIndicator color={C.brand} size="large" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Text style={st.intro}>{_t("Pick the exams that make up a report card and how much each one counts – for example Term 1 30%, Term 2 30%, Final 40%.")}</Text>
        <View style={st.row}>
          <Btn title={_t("Grading scales")} icon="sliders" kind="ghost" style={st.flex} onPress={() => navigation.navigate("GradingScales")} />
          <Btn title={_t("Report cards")} icon="file-text" kind="ghost" style={st.flex} onPress={() => navigation.navigate("ReportCards")} />
        </View>

        {plans.length === 0 && <Empty icon="file-text" text={_t("No report cards yet. Create one to get started.")} />}

        {plans.map((p) => (
          <Card key={p.id} title={_tx(p.name)}
            right={<Text style={[st.badge, !p.is_published && st.badgeOff]}>{p.is_published ? _t("Published") : _t("Draft")}</Text>}>
            <Text style={st.meta}>
              {(p.session_name || "All sessions") + " · " + (p.class_name || "All classes") + " · " + (p.scale_name || "Default scale")
                + " · " + (TEMPLATE_OPTIONS.find((t) => t.value === p.template)?.label.split(" –")[0] ?? p.template)}
            </Text>
            {(Array.isArray(p.terms) ? p.terms : []).map((t, i) => (
              <View key={i} style={st.termRow}>
                <Text style={st.termLabel}>{_tx(t.label)}</Text>
                <Text style={st.termExam} numberOfLines={1}>{_tx(t.exam_name)}</Text>
                <Text style={st.termW}>{Number(t.weight)}%</Text>
              </View>
            ))}
            {canEdit && (
              <View style={[st.row, { marginTop: 6 }]}>
                <Btn title={_t("Edit")} icon="edit-2" kind="ghost" style={st.flex} onPress={() => openEdit(p)} />
                <Btn title={p.is_published ? _t("Unpublish") : _t("Publish")} icon={p.is_published ? "eye-off" : "eye"} kind="ghost" style={st.flex}
                  busy={busy === "pub-" + p.id} onPress={() => run("pub-" + p.id, () => publishPlan(user, p.id, !p.is_published))} />
                <Btn title="" icon="trash-2" kind="danger" style={{ width: 48 }} busy={busy === "del-" + p.id} onPress={() => onDelete(p)} />
              </View>
            )}
          </Card>
        ))}

        {canEdit
          ? <Btn title={_t("New report card")} icon="plus" onPress={() => openEdit(null)} />
          : <Text style={u.hint}>{_t("Only the school owner or an admin can set up report cards.")}</Text>}
        <Text style={[u.hint, { marginTop: 10 }]}>{_t("Published report cards can be seen by students and parents in the app (Report Cards).")}</Text>
      </ScrollView>

      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.modalHead}>
            <Text style={st.modalTitle}>{edit?.id ? _t("Edit report card") : _t("New report card")}</Text>
            <TouchableOpacity onPress={() => setEdit(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          {!!edit && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <Field label={_t("Name *")} value={edit.name} placeholder={_t("e.g. Annual Report Card 2026-27")}
                onChangeText={(v) => setEdit((e) => ({ ...e, name: v }))} />
              <Picker label={_t("Session")} value={edit.session_id} options={sessionOpts} onChange={(v) => setEdit((e) => ({ ...e, session_id: v }))} />
              <Picker label={_t("Class")} value={edit.class_id} options={classOpts} onChange={(v) => setEdit((e) => ({ ...e, class_id: v }))} />
              <Picker label={_t("Grading scale")} value={edit.scale_id} options={scaleOpts} onChange={(v) => setEdit((e) => ({ ...e, scale_id: v }))} />
              <Picker label={_t("Template")} value={edit.template} options={TEMPLATE_OPTIONS} onChange={(v) => setEdit((e) => ({ ...e, template: v }))} />

              <Card title={_t("Exams & weighting")} style={{ marginTop: 8 }}
                right={<Text style={[st.total, Math.abs(totalWeight - 100) > 0.01 && { color: C.err }]}>{_t("Total {v}%", { v: +totalWeight.toFixed(2) })}</Text>}>
                {edit.terms.map((t, i) => (
                  <View key={i} style={st.termEdit}>
                    <View style={st.row}>
                      <View style={st.flex}><Field label={_t("Label")} value={t.label} placeholder={_t("Term 1")} onChangeText={(v) => setTerm(i, "label", v)} /></View>
                      <View style={{ width: 86 }}><Field label={_t("Weight %")} value={t.weight} keyboardType="decimal-pad" onChangeText={(v) => setTerm(i, "weight", v)} /></View>
                      <TouchableOpacity style={{ paddingBottom: 18 }} onPress={() => setEdit((e) => ({ ...e, terms: e.terms.filter((_, j) => j !== i) }))}>
                        <Feather name="x-circle" size={20} color={C.err} />
                      </TouchableOpacity>
                    </View>
                    <Picker value={t.exam_id} options={examOpts} placeholder={_t("Choose exam")} onChange={(v) => setTerm(i, "exam_id", v)} />
                  </View>
                ))}
                <View style={st.row}>
                  <Btn title={_t("Add exam")} icon="plus" kind="ghost" style={st.flex}
                    onPress={() => setEdit((e) => ({ ...e, terms: [...e.terms, { label: _t("Term {v}", { v: e.terms.length + 1 }), exam_id: "", weight: "" }] }))} />
                  <Btn title={_t("Split evenly")} icon="divide" kind="ghost" style={st.flex} onPress={splitEvenly} />
                </View>
                <Text style={u.hint}>{_t("Weights must add up to 100%. If a student missed an exam, the others are re-weighted.")}</Text>
              </Card>

              <Card title={_t("Show on the report card")}>
                <Toggle label={_t("Marks for each exam")} value={edit.show_term_columns} onChange={(v) => setEdit((e) => ({ ...e, show_term_columns: v }))} />
                <Toggle label={_t("GPA")} hint={_t("Needs a scale with grade points.")} value={edit.show_gpa} onChange={(v) => setEdit((e) => ({ ...e, show_gpa: v }))} />
                <Toggle label={_t("Class rank")} value={edit.show_rank} onChange={(v) => setEdit((e) => ({ ...e, show_rank: v }))} />
                <Toggle label={_t("Attendance")} value={edit.show_attendance} onChange={(v) => setEdit((e) => ({ ...e, show_attendance: v }))} />
              </Card>
              <Field label={_t("Principal's name (signature line)")} value={edit.principal_name} placeholder={_t("Principal")}
                onChangeText={(v) => setEdit((e) => ({ ...e, principal_name: v }))} />
              <Field label={_t("Footer note")} value={edit.footer_note} placeholder={_t("e.g. School reopens on 6 January")}
                onChangeText={(v) => setEdit((e) => ({ ...e, footer_note: v }))} />
              <Btn title={_t("Save report card")} icon="check" busy={busy === "save"} onPress={onSave} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 13, color: C.muted, marginBottom: 10, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  flex: { flex: 1 },
  badge: { backgroundColor: "#dcfce7", color: C.ok, fontWeight: "800", fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  badgeOff: { backgroundColor: "#f1f5f9", color: C.muted },
  meta: { fontSize: 12, color: C.muted, marginBottom: 8 },
  termRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  termLabel: { width: 90, fontWeight: "700", color: C.ink, fontSize: 13 },
  termExam: { flex: 1, color: C.muted, fontSize: 13 },
  termW: { fontWeight: "800", color: C.brand, fontSize: 13 },
  total: { fontWeight: "800", color: C.ok, fontSize: 13 },
  termEdit: { borderBottomWidth: 1, borderBottomColor: "#f1f5f9", paddingBottom: 4, marginBottom: 8 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
               paddingTop: Platform.OS === "ios" ? 54 : 18, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
});
