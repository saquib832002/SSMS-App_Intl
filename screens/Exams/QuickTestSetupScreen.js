/**
 * screens/Exams/QuickTestSetupScreen.js
 *
 * Select an existing exam (Minor / Weekly / Monthly), pick class + section,
 * set max marks per subject, then jump straight to AddMarksScreen.
 */
import React, { useState, useContext, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, FlatList, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchBranches, fetchClasses, fetchSections, fetchSessions } from "../../services/SetupServiceApi";
import { fetchClassSubjects } from "../../services/SubjectServiceApi";
import { fetchExams, fetchQuickTestMaxMarks, saveQuickTestMaxMarks } from "../../services/ExamServiceApi";

// ── Category badge colours ────────────────────────────────────────────────────
const CAT_STYLE = {
  Annual:  { bg: "#f3e8ff", fg: "#7c3aed" },
  Term:    { bg: "#e0f2fe", fg: "#0369a1" },
  Major:   { bg: "#f1f5f9", fg: "#475569" },
  Minor:   { bg: "#fef9c3", fg: "#b45309" },
  Weekly:  { bg: "#dbeafe", fg: "#1d4ed8" },
  Monthly: { bg: "#dcfce7", fg: "#15803d" },
};
function CategoryBadge({ category }) {
  if (!category) return null;
  const { bg, fg } = CAT_STYLE[category] ?? CAT_STYLE.Major;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ fontSize: 10, fontWeight: "700", color: fg }}>{category}</Text>
    </View>
  );
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading, renderOption }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[s.dd, disabled && s.ddDis]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[s.ddTxt, !sel && s.ddPh]} numberOfLines={1}>
          {loading ? "Loading…" : (sel?.label ?? label)}
        </Text>
        {sel?.category && <CategoryBadge category={sel.category} />}
        <Feather name="chevron-down" size={13} color="#94a3b8" style={{ marginLeft: 4 }} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.ddSheet}>
            <View style={s.ddHead}>
              <Text style={s.ddTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) =>
                renderOption
                  ? renderOption(o, () => { onChange(o.value); setOpen(false); }, String(o.value) === String(value))
                  : (
                    <TouchableOpacity
                      style={[s.ddOpt, String(o.value) === String(value) && s.ddOptAct]}
                      onPress={() => { onChange(o.value); setOpen(false); }}
                    >
                      <Text style={[s.ddOptTxt, String(o.value) === String(value) && s.ddOptTxtAct]}>
                        {o.label}
                      </Text>
                      {String(o.value) === String(value) && <Feather name="check" size={13} color="#1e40af" />}
                    </TouchableOpacity>
                  )
              }
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function QuickTestSetupScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [examId,    setExamId]    = useState("");
  const [branchId,  setBranchId]  = useState("");
  const [sessionId, setSessionId] = useState("");
  const [classId,   setClassId]   = useState("");
  const [sectionId, setSectionId] = useState("");

  const [exams,     setExams]     = useState([]);
  const [branches,  setBranches]  = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [subjects,  setSubjects]  = useState([]);
  const [maxMarks,  setMaxMarks]  = useState({});

  const [loadingFilters,  setLoadingFilters]  = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [saving,          setSaving]          = useState(false);

  // ── Load exams / branches / sessions / classes ────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoadingFilters(true);
        const [exData, brData, seData, clData] = await Promise.all([
          fetchExams(user), fetchBranches(user), fetchSessions(user), fetchClasses(user),
        ]);
        const exList = Array.isArray(exData) ? exData : exData?.data ?? [];
        const brList = Array.isArray(brData) ? brData : brData?.data ?? [];
        const seList = Array.isArray(seData) ? seData : seData?.data ?? [];
        const clList = Array.isArray(clData) ? clData : clData?.data ?? [];
        setExams(exList);
        setBranches(brList);
        setSessions(seList);
        setClasses(clList);
        if (brList.length) setBranchId(String(brList[0].branch_id));
        if (seList.length) setSessionId(String(seList[0].session_id));
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load filters");
      } finally {
        setLoadingFilters(false);
      }
    })();
  }, [user]);

  // ── Sections when class changes ───────────────────────────────────────────
  useEffect(() => {
    setSectionId(""); setSections([]);
    setSubjects([]); setMaxMarks({});
    if (!classId) return;
    setLoadingSections(true);
    fetchSections(user, classId)
      .then(d => {
        const list = Array.isArray(d) ? d : d?.data ?? [];
        setSections(list);
        if (list.length) setSectionId(String(list[0].section_id));
      })
      .catch(() => {})
      .finally(() => setLoadingSections(false));
  }, [classId]);

  // ── Subjects when class changes ───────────────────────────────────────────
  useEffect(() => {
    setSubjects([]); setMaxMarks({});
    if (!classId) return;
    setLoadingSubjects(true);
    fetchClassSubjects(user, classId)
      .then(d => {
        const list = Array.isArray(d) ? d : d?.data ?? [];
        setSubjects(list);
        const init = {};
        list.forEach(sub => {
          init[sub.subject_id] = { theory: "", internal: "", practical: "", total: "" };
        });
        setMaxMarks(init);
      })
      .catch(() => {})
      .finally(() => setLoadingSubjects(false));
  }, [classId]);

  // ── Load saved max marks when exam + class is ready ───────────────────────
  // Fires when examId changes OR when subjects finish loading (subjects.length)
  useEffect(() => {
    if (!examId || !classId || subjects.length === 0) return;
    let cancelled = false;
    fetchQuickTestMaxMarks(user, examId, classId)
      .then(saved => {
        if (cancelled) return;
        setMaxMarks(prev => {
          // Start from current subjects (reset to blank, then overlay saved)
          const next = {};
          Object.keys(prev).forEach(id => {
            next[id] = { theory: "", internal: "", practical: "", total: "" };
          });
          saved.forEach(row => {
            const id = String(row.subject_id);
            if (next[id] !== undefined) {
              next[id] = {
                theory:    row.theory_max_marks    != null ? String(row.theory_max_marks)    : "",
                internal:  row.internal_max_marks  != null ? String(row.internal_max_marks)  : "",
                practical: row.practical_max_marks != null ? String(row.practical_max_marks) : "",
                total:     row.max_marks           != null ? String(row.max_marks)           : "",
              };
            }
          });
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, classId, subjects.length]);

  const setMark = (subjectId, field, val) =>
    setMaxMarks(prev => {
      const cleaned  = val.replace(/[^0-9.]/g, "");
      const updated  = { ...prev[subjectId], [field]: cleaned };
      // Auto-compute total as sum of theory + internal + practical
      const th  = parseFloat(updated.theory)    || 0;
      const int = parseFloat(updated.internal)  || 0;
      const pr  = parseFloat(updated.practical) || 0;
      updated.total = (th + int + pr) > 0 ? String(th + int + pr) : "";
      return { ...prev, [subjectId]: updated };
    });

  const isIncluded = (subjectId) => {
    const m = maxMarks[subjectId] ?? {};
    return parseFloat(m.theory) > 0 || parseFloat(m.internal) > 0 ||
           parseFloat(m.practical) > 0 || parseFloat(m.total) > 0;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!examId)    { Alert.alert("Required", "Please select an exam.");    return; }
    if (!classId)   { Alert.alert("Required", "Please select a class.");    return; }
    if (!sectionId) { Alert.alert("Required", "Please select a section.");  return; }

    const includedSubjects = subjects
      .filter(sub => isIncluded(sub.subject_id))
      .map(sub => {
        const m = maxMarks[sub.subject_id] ?? {};
        return {
          subject_id:          sub.subject_id,
          theory_max_marks:    parseFloat(m.theory)   || null,
          internal_max_marks:  parseFloat(m.internal) || null,
          practical_max_marks: parseFloat(m.practical)|| null,
          max_marks:           parseFloat(m.total)    || null,
        };
      });

    if (!includedSubjects.length) {
      Alert.alert("Required", "Enter max marks for at least one subject.");
      return;
    }

    try {
      setSaving(true);
      await saveQuickTestMaxMarks(user, {
        exam_id:  examId,
        class_id: classId,
        subjects: includedSubjects,
      });

      const selExam = exams.find(e => String(e.exam_id) === String(examId));
      Alert.alert(
        "Max Marks Saved",
        `Ready to enter marks for "${selExam?.exam_name ?? "Test"}"`,
        [
          { text: "Later", style: "cancel" },
          {
            text: "Enter Marks →",
            onPress: () => navigation.replace("AddMarks", {
              prefill: {
                exam_id:    String(examId),
                class_id:   classId,
                section_id: sectionId,
                branch_id:  branchId,
                session_id: sessionId,
              },
            }),
          },
        ]
      );
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save max marks");
    } finally {
      setSaving(false);
    }
  }, [examId, classId, sectionId, branchId, sessionId, subjects, maxMarks, exams, user, navigation]);

  // ── Options ───────────────────────────────────────────────────────────────
  const examOpts    = exams.map(e  => ({ label: e.exam_name, value: String(e.exam_id), category: e.exam_category }));
  const branchOpts  = branches.map(b  => ({ label: b.branch_name, value: String(b.branch_id) }));
  const sessionOpts = sessions.map(s  => ({ label: s.session_name ?? s.session_year, value: String(s.session_id) }));
  const classOpts   = classes.map(c   => ({ label: c.class_name, value: String(c.class_id) }));
  const sectionOpts = sections.map(sc => ({ label: sc.section_name, value: String(sc.section_id) }));

  const selExam        = exams.find(e => String(e.exam_id) === String(examId));
  const includedCount  = subjects.filter(sub => isIncluded(sub.subject_id)).length;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Quick Test Setup</Text>
          <Text style={s.headerSub}>Set max marks &amp; enter scores</Text>
        </View>
        {saving
          ? <ActivityIndicator color="#1e40af" />
          : <TouchableOpacity style={s.saveBtn} onPress={handleSave} activeOpacity={0.8}>
              <Feather name="check" size={16} color="#fff" />
              <Text style={s.saveBtnTxt}>Save</Text>
            </TouchableOpacity>}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Exam selector ────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>SELECT EXAM</Text>
          <Text style={s.label}>Exam <Text style={s.req}>*</Text></Text>

          {/* Custom exam list with category badges */}
          <Dropdown
            label="Select Exam"
            value={examId}
            options={examOpts}
            onChange={setExamId}
            loading={loadingFilters}
            renderOption={(o, onPress, isActive) => (
              <TouchableOpacity
                style={[s.ddOpt, isActive && s.ddOptAct]}
                onPress={onPress}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.ddOptTxt, isActive && s.ddOptTxtAct]}>{o.label}</Text>
                </View>
                <CategoryBadge category={o.category} />
                {isActive && <Feather name="check" size={13} color="#1e40af" style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            )}
          />

          {selExam && (
            <View style={s.examPill}>
              <CategoryBadge category={selExam.exam_category} />
              <Text style={s.examPillTxt}>{selExam.exam_name}</Text>
            </View>
          )}
        </View>

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>CLASS &amp; SECTION</Text>
          <View style={s.row2}>
            <View style={s.half}>
              <Text style={s.label}>Branch</Text>
              <Dropdown label="Branch" value={branchId} options={branchOpts}
                onChange={setBranchId} loading={loadingFilters} />
            </View>
            <View style={s.half}>
              <Text style={s.label}>Session</Text>
              <Dropdown label="Session" value={sessionId} options={sessionOpts}
                onChange={setSessionId} loading={loadingFilters} />
            </View>
          </View>
          <View style={s.row2}>
            <View style={s.half}>
              <Text style={s.label}>Class <Text style={s.req}>*</Text></Text>
              <Dropdown label="Select Class" value={classId} options={classOpts}
                onChange={setClassId} loading={loadingFilters} />
            </View>
            <View style={s.half}>
              <Text style={s.label}>Section <Text style={s.req}>*</Text></Text>
              <Dropdown label="Select Section" value={sectionId} options={sectionOpts}
                onChange={setSectionId} disabled={!classId} loading={loadingSections} />
            </View>
          </View>
        </View>

        {/* ── Subject Max Marks ─────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.subjectHeader}>
            <Text style={s.sectionTitle}>SUBJECT MAX MARKS</Text>
            {includedCount > 0 && (
              <View style={s.countBadge}>
                <Text style={s.countBadgeTxt}>{includedCount} included</Text>
              </View>
            )}
          </View>
          <Text style={s.hint}>Enter max marks for subjects included in this test. Leave blank to exclude.</Text>

          {loadingSubjects
            ? <ActivityIndicator color="#1e40af" style={{ marginVertical: 20 }} />
            : !classId
              ? <Text style={s.emptyHint}>Select a class to load subjects.</Text>
              : subjects.length === 0
                ? <Text style={s.emptyHint}>No subjects assigned to this class.</Text>
                : subjects.map(sub => {
                    const m        = maxMarks[sub.subject_id] ?? {};
                    const included = isIncluded(sub.subject_id);
                    return (
                      <View key={sub.subject_id} style={[s.subRow, included && s.subRowAct]}>
                        {/* Subject name */}
                        <View style={s.subNameWrap}>
                          <Text style={s.subName}>{sub.subject_name}</Text>
                          {sub.subject_code ? <Text style={s.subCode}>{sub.subject_code}</Text> : null}
                        </View>
                        {/* Four mark inputs */}
                        <View style={s.markGrid}>
                          {[
                            { key: "theory",    label: "Theory"   },
                            { key: "internal",  label: "Internal" },
                            { key: "practical", label: "Practical"},
                          ].map(({ key, label }) => (
                            <View key={key} style={s.markCell}>
                              <Text style={s.markCellLabel}>{label}</Text>
                              <TextInput
                                style={[s.markInput, parseFloat(m[key]) > 0 && s.markInputAct]}
                                placeholder="—"
                                placeholderTextColor="#cbd5e1"
                                keyboardType="numeric"
                                value={m[key] ?? ""}
                                onChangeText={v => setMark(sub.subject_id, key, v)}
                                maxLength={5}
                              />
                            </View>
                          ))}
                          {/* Total — readonly, auto-computed */}
                          <View style={s.markCell}>
                            <Text style={s.markCellLabel}>Total</Text>
                            <View style={[s.markInput, s.markInputReadonly, parseFloat(m.total) > 0 && s.markInputTotalAct]}>
                              <Text style={[s.markInputReadonlyTxt, parseFloat(m.total) > 0 && { color: "#1e40af" }]}>
                                {m.total || "—"}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
        </View>

        {/* ── Bottom button ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[s.bottomBtn, saving && { opacity: 0.55 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Feather name="zap" size={16} color="#fff" />
                <Text style={s.bottomBtnTxt}>Save &amp; Enter Marks</Text>
              </>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#f8fafc" },
  header:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 12 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  headerSub:    { fontSize: 12, color: "#64748b", marginTop: 1 },
  saveBtn:      { flexDirection: "row", alignItems: "center", backgroundColor: "#1e40af", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 5 },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },

  body:         { padding: 16, gap: 14 },
  card:         { backgroundColor: "#fff", borderRadius: 16, padding: 16, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  sectionTitle: { fontSize: 10, fontWeight: "800", color: "#94a3b8", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },
  label:        { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 10 },
  req:          { color: "#ef4444" },

  examPill:     { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, backgroundColor: "#f8fafc", borderRadius: 10, padding: 10 },
  examPillTxt:  { fontSize: 14, fontWeight: "600", color: "#0f172a" },

  row2:         { flexDirection: "row", gap: 10 },
  half:         { flex: 1 },

  dd:           { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, gap: 6 },
  ddDis:        { opacity: 0.45 },
  ddTxt:        { flex: 1, fontSize: 14, color: "#0f172a" },
  ddPh:         { color: "#94a3b8" },
  ddOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  ddSheet:      { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "65%" },
  ddHead:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  ddTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  ddOpt:        { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, gap: 8 },
  ddOptAct:     { backgroundColor: "#eff6ff" },
  ddOptTxt:     { fontSize: 14, color: "#0f172a", flex: 1 },
  ddOptTxtAct:  { color: "#1e40af", fontWeight: "700" },

  subjectHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  hint:           { fontSize: 12, color: "#94a3b8", marginBottom: 12 },
  emptyHint:      { fontSize: 13, color: "#94a3b8", textAlign: "center", paddingVertical: 20 },
  countBadge:     { backgroundColor: "#dcfce7", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  countBadgeTxt:  { fontSize: 11, fontWeight: "700", color: "#16a34a" },

  subRow:         { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  subRowAct:      { backgroundColor: "#f0fdf4", borderRadius: 10, paddingHorizontal: 8, marginHorizontal: -8 },
  subNameWrap:    { marginBottom: 8 },
  subName:        { fontSize: 14, fontWeight: "600", color: "#0f172a" },
  subCode:        { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  markGrid:       { flexDirection: "row", gap: 6 },
  markCell:       { flex: 1, alignItems: "center", gap: 3 },
  markCellLabel:  { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" },
  markInput:            { width: "100%", textAlign: "center", backgroundColor: "#f8fafc", borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 10, paddingVertical: 8, fontSize: 14, fontWeight: "700", color: "#0f172a" },
  markInputAct:         { borderColor: "#16a34a", backgroundColor: "#f0fdf4", color: "#16a34a" },
  markInputReadonly:    { alignItems: "center", justifyContent: "center", backgroundColor: "#eff6ff", borderStyle: "dashed", minHeight: 38 },
  markInputReadonlyTxt: { fontSize: 14, fontWeight: "800", color: "#94a3b8" },
  markInputTotalAct:    { borderColor: "#1e40af", backgroundColor: "#dbeafe" },
  markLabel:            { fontSize: 9, color: "#94a3b8", fontWeight: "600" },

  bottomBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1e40af", borderRadius: 16, paddingVertical: 16, marginTop: 4 },
  bottomBtnTxt:   { color: "#fff", fontWeight: "800", fontSize: 16 },
});
