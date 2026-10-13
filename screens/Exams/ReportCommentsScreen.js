/**
 * Exams › Teacher Comments
 * Class-teacher comment + a comment per subject for each student, printed on the report card.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, Modal, TouchableOpacity,
  KeyboardAvoidingView, Platform, FlatList,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getCommentSheet, saveComments } from "../../services/ReportCardApi";
import { C, Card, Btn, Field, Empty, u } from "../../components/ReportCardUI";
import { useReportCardFilters, ReportCardFilters } from "../../components/ReportCardFilters";
import { _t, _tx } from "../../services/i18n";

// Quick phrases the teacher can tap to add to the class-teacher comment.
const PHRASES = [
  "A pleasure to teach.", "Works hard and participates well.", "Shows great curiosity.",
  "Consistently completes homework on time.", "Needs to read more at home.",
  "Should ask for help when unsure.", "Has made excellent progress this term.",
  "Needs to focus more in class.", "A kind and helpful classmate.",
];

export default function ReportCommentsScreen() {
  const { user } = useContext(AuthContext);
  const f = useReportCardFilters(user);
  const [sheet, setSheet]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]     = useState(null);   // index into sheet.students
  const [draft, setDraft]   = useState({});     // subject_id → text
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!f.planId || !f.classId) { setSheet(null); return; }
    setLoading(true);
    try {
      const r = await getCommentSheet(user, f.planId, f.classId, f.sectionId);
      // normalise so render never hits .length / .map on undefined
      setSheet({ ...(r && typeof r === "object" ? r : {}),
        students: Array.isArray(r?.students) ? r.students : [],
        subjects: Array.isArray(r?.subjects) ? r.subjects : [] });
    }
    catch (e) { Alert.alert(_t("Comments"), _tx(e.message)); setSheet(null); }
    finally { setLoading(false); }
  }, [user, f.planId, f.classId, f.sectionId]);
  useEffect(() => { load(); }, [load]);

  const openStudent = (i) => {
    const s = sheet.students[i];
    const c = s.comments || {};
    const d = { 0: c[0] ?? c["0"] ?? "" };
    (sheet.subjects ?? []).forEach((sub) => { d[sub.subject_id] = c[sub.subject_id] ?? c[String(sub.subject_id)] ?? ""; });
    setDraft(d);
    setOpen(i);
  };

  const save = async (goNext) => {
    const s = sheet.students[open];
    setSaving(true);
    try {
      const list = Object.entries(draft).map(([k, v]) => ({ subject_id: Number(k), comment: v }));
      await saveComments(user, f.planId, s.enrollment_id, list);
      const comments = {};
      list.forEach((x) => { if (x.comment.trim()) comments[x.subject_id] = x.comment.trim(); });
      setSheet((sh) => {
        const students = sh.students.slice();
        students[open] = { ...students[open], comments, comment_count: Object.keys(comments).length };
        return { ...sh, students };
      });
      if (goNext && open + 1 < sheet.students.length) openStudent(open + 1); else setOpen(null);
    } catch (e) {
      Alert.alert(_t("Comments"), _tx(e.message));
    } finally { setSaving(false); }
  };

  if (!f.ready) return <View style={st.center}><ActivityIndicator color={C.brand} size="large" /></View>;

  const cur = open !== null ? sheet?.students?.[open] : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        data={sheet?.students ?? []}
        keyExtractor={(s) => String(s.enrollment_id)}
        ListHeaderComponent={
          <>
            <Card><ReportCardFilters f={f} /></Card>
            {f.plans.length === 0 && <Empty icon="file-text" text={_t("No report cards yet. An admin can create one in Report Card Setup.")} />}
            {loading && <ActivityIndicator color={C.brand} style={{ marginVertical: 20 }} />}
            {!!sheet && !loading && (
              <Text style={st.count}>{_t("{length} students · tap a name to write comments", { length: sheet.students.length })}</Text>
            )}
          </>
        }
        ListEmptyComponent={!!sheet && !loading ? <Empty icon="users" text={_t("No students found for this class.")} /> : null}
        renderItem={({ item: s, index }) => (
          <TouchableOpacity style={st.row} onPress={() => openStudent(index)} activeOpacity={0.75}>
            <View style={st.roll}><Text style={st.rollTxt}>{_tx(s.roll_number) || "–"}</Text></View>
            <Text style={st.name} numberOfLines={1}>{_tx(s.student_name)}</Text>
            {s.comment_count > 0
              ? <View style={st.done}><Feather name="check" size={12} color={C.ok} /><Text style={st.doneTxt}>{_tx(s.comment_count)}</Text></View>
              : <Text style={st.todo}>{_t("Add")}</Text>}
            <Feather name="chevron-right" size={16} color="#94a3b8" />
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!cur} animationType="slide" onRequestClose={() => setOpen(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.modalHead}>
            <View style={{ flex: 1 }}>
              <Text style={st.modalTitle} numberOfLines={1}>{_tx(cur?.student_name)}</Text>
              <Text style={u.hint}>{_t("Roll {v} · {v2}", { v: cur?.roll_number || "–", v2: open !== null ? _t("{v} of {length}", { v: open + 1, length: sheet?.students?.length }) : "" })}</Text>
            </View>
            <TouchableOpacity onPress={() => setOpen(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          {!!cur && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <Card title={_t("Class teacher's comment")}>
                <Field multiline value={draft[0] ?? ""} placeholder={_t("Overall comment for the report card")}
                  style={{ minHeight: 90, textAlignVertical: "top" }}
                  onChangeText={(v) => setDraft((d) => ({ ...d, 0: v }))} />
                <View style={st.chips}>
                  {PHRASES.map((p) => (
                    <TouchableOpacity key={p} style={st.chip}
                      onPress={() => setDraft((d) => ({ ...d, 0: ((d[0] ?? "").trim() + " " + p).trim() }))}>
                      <Text style={st.chipTxt}>+ {_tx(p)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Card>
              {(sheet?.subjects ?? []).length > 0 && (
                <Card title={_t("Subject comments")}>
                  {sheet.subjects.map((sub) => (
                    <Field key={sub.subject_id} label={_tx(sub.subject_name)} multiline value={draft[sub.subject_id] ?? ""}
                      placeholder={_t("Comment for {subject_name} (optional)", { subject_name: sub.subject_name })} style={{ minHeight: 56, textAlignVertical: "top" }}
                      onChangeText={(v) => setDraft((d) => ({ ...d, [sub.subject_id]: v }))} />
                  ))}
                </Card>
              )}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn title={_t("Save")} icon="check" kind="ghost" style={{ flex: 1 }} busy={saving} onPress={() => save(false)} />
                <Btn title={_t("Save & next")} icon="arrow-right" style={{ flex: 1 }} busy={saving} onPress={() => save(true)} />
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  count: { fontSize: 12, color: C.muted, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8,
         borderWidth: 1, borderColor: C.line, gap: 10 },
  roll: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center" },
  rollTxt: { fontWeight: "800", color: C.brand, fontSize: 12 },
  name: { flex: 1, fontSize: 14, fontWeight: "600", color: C.ink },
  done: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#dcfce7", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  doneTxt: { color: C.ok, fontWeight: "800", fontSize: 12 },
  todo: { color: C.warn, fontWeight: "700", fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: C.brandSoft, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipTxt: { color: C.brand, fontSize: 12, fontWeight: "600" },
  modalHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10,
               paddingTop: Platform.OS === "ios" ? 54 : 18, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
});
