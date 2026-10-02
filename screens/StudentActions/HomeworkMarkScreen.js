/**
 * screens/StudentActions/HomeworkMarkScreen.js
 *
 * Teacher marks student completion for a homework task.
 *   • Shows homework header + summary stats
 *   • Per-student rows: status chip, completion %, remarks text input
 *   • "Save All" bulk-marks via POST /HomeworkApi/markStudents
 *   • Changes are tracked locally — unsaved changes are highlighted
 *
 * Nav params: { homeworkId, sessionId, title }
 */
import React, {
  useState, useEffect, useCallback, useContext, useRef,
} from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather }      from "@expo/vector-icons";
import { AuthContext }  from "../../context/AuthContext";
import { getHomeworkDetail, markStudents } from "../../services/HomeworkServiceApi";

// ── Status options ────────────────────────────────────────────────────────────
const STATUSES = [
  { key: "pending",    label: "Pending",    color: "#94a3b8", bg: "#f1f5f9" },
  { key: "submitted",  label: "Submitted",  color: "#2563eb", bg: "#eff6ff" },
  { key: "completed",  label: "Completed",  color: "#15803d", bg: "#dcfce7" },
  { key: "incomplete", label: "Incomplete", color: "#dc2626", bg: "#fee2e2" },
];

function StatusChip({ value, onChange }) {
  const cur = STATUSES.find(s => s.key === value) ?? STATUSES[0];
  const next = () => {
    const idx = STATUSES.findIndex(s => s.key === value);
    onChange(STATUSES[(idx + 1) % STATUSES.length].key);
  };
  return (
    <TouchableOpacity
      style={[mk.chip, { backgroundColor: cur.bg, borderColor: cur.color }]}
      onPress={next}
      activeOpacity={0.7}
    >
      <Text style={[mk.chipTxt, { color: cur.color }]}>{cur.label}</Text>
      <Feather name="refresh-cw" size={10} color={cur.color} />
    </TouchableOpacity>
  );
}

// ── Student row ───────────────────────────────────────────────────────────────
const StudentRow = React.memo(function StudentRow({ student, draft, onUpdate, dirty }) {
  const name = [student.firstName, student.middleName, student.lastName]
    .filter(Boolean).join(" ");

  return (
    <View style={[mk.row, dirty && mk.rowDirty]}>
      {/* Name + roll */}
      <View style={mk.nameCell}>
        {dirty && <View style={mk.dirtyDot} />}
        <Text style={mk.rollNo}>#{student.rollNumber ?? "—"}</Text>
        <Text style={mk.name} numberOfLines={2}>{name}</Text>
        <Text style={mk.enrollId}>{student.enrollmentId}</Text>
      </View>

      {/* Controls */}
      <View style={mk.controls}>
        {/* Status chip */}
        <StatusChip
          value={draft.completionStatus}
          onChange={v => onUpdate("completionStatus", v)}
        />

        {/* Completion % */}
        <View style={mk.pctRow}>
          <TextInput
            style={mk.pctInput}
            value={draft.completionPercentage}
            onChangeText={v => onUpdate("completionPercentage", v.replace(/[^0-9]/g, "").slice(0, 3))}
            keyboardType="number-pad"
            placeholder="—"
            placeholderTextColor="#94a3b8"
            maxLength={3}
          />
          <Text style={mk.pctLabel}>%</Text>
        </View>

        {/* Remarks */}
        <TextInput
          style={mk.remarksInput}
          value={draft.teacherRemarks}
          onChangeText={v => onUpdate("teacherRemarks", v)}
          placeholder="Remarks..."
          placeholderTextColor="#94a3b8"
          multiline
        />
      </View>
    </View>
  );
});

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  return (
    <View style={mk.summaryBar}>
      {[
        { label: "Total",      n: summary.total,      color: "#334155" },
        { label: "Done",       n: summary.completed,  color: "#15803d" },
        { label: "Submitted",  n: summary.submitted,  color: "#2563eb" },
        { label: "Incomplete", n: summary.incomplete, color: "#dc2626" },
        { label: "Pending",    n: summary.pending,    color: "#94a3b8" },
      ].map(item => (
        <View key={item.label} style={mk.summaryChip}>
          <Text style={[mk.summaryN, { color: item.color }]}>{item.n}</Text>
          <Text style={mk.summaryL}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function HomeworkMarkScreen({ route, navigation }) {
  const { homeworkId, sessionId, title } = route.params ?? {};
  const { user } = useContext(AuthContext);

  const [homework, setHomework] = useState(null);
  const [summary,  setSummary]  = useState(null);
  const [students, setStudents] = useState([]);
  const [drafts,   setDrafts]   = useState({}); // { enrollmentId: { completionStatus, completionPercentage, teacherRemarks } }
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);

  // ── Load detail ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHomeworkDetail(user, homeworkId, sessionId);
      setHomework(res.homework);
      setSummary(res.summary);
      setStudents(res.students ?? []);

      // Initialise drafts from server state
      const initial = {};
      (res.students ?? []).forEach(s => {
        initial[s.enrollmentId] = {
          completionStatus:     s.completionStatus     ?? "pending",
          completionPercentage: s.completionPercentage != null ? String(s.completionPercentage) : "",
          teacherRemarks:       s.teacherRemarks       ?? "",
        };
      });
      setDrafts(initial);
      setDirtyIds(new Set());
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [homeworkId, sessionId]);

  useEffect(() => { load(); }, [load]);

  // ── Update draft for one student ──
  const updateDraft = useCallback((enrollmentId, field, value) => {
    setDrafts(prev => ({
      ...prev,
      [enrollmentId]: { ...prev[enrollmentId], [field]: value },
    }));
    setDirtyIds(prev => new Set(prev).add(enrollmentId));
  }, []);

  // ── Save all ──
  const handleSave = async () => {
    const payload = students
      .filter(s => dirtyIds.has(s.enrollmentId))
      .map(s => {
        const d = drafts[s.enrollmentId];
        return {
          enrollmentId:        s.enrollmentId,
          completionStatus:    d.completionStatus,
          completionPercentage: d.completionPercentage !== "" ? parseInt(d.completionPercentage) : null,
          teacherRemarks:      d.teacherRemarks || null,
        };
      });

    if (payload.length === 0) {
      Alert.alert("No changes", "No students have been modified.");
      return;
    }

    setSaving(true);
    try {
      const res = await markStudents(
        user, homeworkId, payload,
        user?.staffId ?? user?.userId ?? null
      );
      Alert.alert(
        "Saved",
        res.message ?? `Marked ${res.marked} student(s).`,
        [{ text: "OK", onPress: load }]
      );
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Quick mark all ──
  const markAll = (status) => {
    const next = {};
    const dirty = new Set(dirtyIds);
    students.forEach(s => {
      next[s.enrollmentId] = { ...drafts[s.enrollmentId], completionStatus: status };
      dirty.add(s.enrollmentId);
    });
    setDrafts(prev => ({ ...prev, ...next }));
    setDirtyIds(dirty);
  };

  if (loading) {
    return (
      <SafeAreaView style={mk.safe} edges={["bottom"]}>
        <View style={mk.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
            <Feather name="arrow-left" size={20} color="#1e40af" />
          </TouchableOpacity>
          <Text style={mk.headerTitle} numberOfLines={1}>{title ?? "Mark Students"}</Text>
        </View>
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color="#2563eb" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={mk.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={mk.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
            <Feather name="arrow-left" size={20} color="#1e40af" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={mk.headerTitle} numberOfLines={1}>{homework?.title ?? title}</Text>
            <Text style={mk.headerSub}>
              {homework?.assigned_date ?? homework?.assignedDate}
            </Text>
          </View>
          <TouchableOpacity
            style={[mk.saveBtn, saving && { opacity: 0.65 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="save" size={14} color="#fff" /><Text style={mk.saveBtnTxt}>Save</Text></>
            }
          </TouchableOpacity>
        </View>

        {/* Class / Section banner */}
        {homework && (
          <View style={mk.classBanner}>
            <View style={mk.classBannerItem}>
              <Feather name="book-open" size={13} color="#1e40af" />
              <Text style={mk.classBannerLabel}>Class</Text>
              <Text style={mk.classBannerValue}>
                {homework.class_name ?? homework.className ?? "—"}
              </Text>
            </View>
            <View style={mk.classBannerDivider} />
            <View style={mk.classBannerItem}>
              <Feather name="layers" size={13} color="#1e40af" />
              <Text style={mk.classBannerLabel}>Section</Text>
              <Text style={mk.classBannerValue}>
                {homework.section_name ?? homework.sectionName ?? "All"}
              </Text>
            </View>
            {homework.subject_name || homework.subjectName ? (
              <>
                <View style={mk.classBannerDivider} />
                <View style={mk.classBannerItem}>
                  <Feather name="tag" size={13} color="#1e40af" />
                  <Text style={mk.classBannerLabel}>Subject</Text>
                  <Text style={mk.classBannerValue} numberOfLines={1}>
                    {homework.subject_name ?? homework.subjectName}
                  </Text>
                </View>
              </>
            ) : null}
            <View style={mk.classBannerDivider} />
            <View style={mk.classBannerItem}>
              <Feather name="users" size={13} color="#1e40af" />
              <Text style={mk.classBannerLabel}>Students</Text>
              <Text style={mk.classBannerValue}>{students.length}</Text>
            </View>
          </View>
        )}

        {/* Summary */}
        {summary && <SummaryBar summary={summary} />}

        {/* Quick mark bar */}
        <View style={mk.quickBar}>
          <Text style={mk.quickLabel}>Mark all as:</Text>
          {["completed", "incomplete", "pending"].map(st => {
            const cfg = STATUSES.find(s => s.key === st);
            return (
              <TouchableOpacity
                key={st}
                style={[mk.quickBtn, { borderColor: cfg.color }]}
                onPress={() => markAll(st)}
              >
                <Text style={[mk.quickBtnTxt, { color: cfg.color }]}>{cfg.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Column headers */}
        <View style={mk.colHeader}>
          <Text style={[mk.colHd, { width: 110 }]}>Student</Text>
          <Text style={[mk.colHd, { flex: 1 }]}>Status · % · Remarks</Text>
        </View>

        {/* Student list */}
        {students.length === 0
          ? (
            <View style={mk.empty}>
              <Feather name="users" size={36} color="#cbd5e1" />
              <Text style={mk.emptyTxt}>No enrolled students found.</Text>
            </View>
          )
          : (
            <FlatList
              data={students}
              keyExtractor={s => String(s.enrollmentId)}
              contentContainerStyle={{ paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <StudentRow
                  student={item}
                  draft={drafts[item.enrollmentId] ?? { completionStatus: "pending", completionPercentage: "", teacherRemarks: "" }}
                  dirty={dirtyIds.has(item.enrollmentId)}
                  onUpdate={(field, value) => updateDraft(item.enrollmentId, field, value)}
                />
              )}
            />
          )
        }
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const mk = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },

  header:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  headerTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  headerSub:   { fontSize: 11, color: "#64748b", marginTop: 1 },
  saveBtn:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#2563eb", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  saveBtnTxt:  { color: "#fff", fontSize: 13, fontWeight: "700" },

  classBanner:        { flexDirection: "row", backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#bfdbfe", paddingVertical: 8, paddingHorizontal: 6 },
  classBannerItem:    { flex: 1, alignItems: "center", gap: 2 },
  classBannerDivider: { width: 1, backgroundColor: "#bfdbfe", marginVertical: 2 },
  classBannerLabel:   { fontSize: 9, fontWeight: "700", color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.5 },
  classBannerValue:   { fontSize: 12, fontWeight: "800", color: "#1e40af", textAlign: "center" },

  summaryBar:  { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingVertical: 8, paddingHorizontal: 6 },
  summaryChip: { flex: 1, alignItems: "center" },
  summaryN:    { fontSize: 18, fontWeight: "800" },
  summaryL:    { fontSize: 9, color: "#94a3b8", marginTop: 1 },

  quickBar:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  quickLabel:  { fontSize: 11, fontWeight: "700", color: "#64748b" },
  quickBtn:    { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  quickBtnTxt: { fontSize: 11, fontWeight: "700" },

  colHeader:   { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  colHd:       { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },

  row:         { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", backgroundColor: "#fff", gap: 10 },
  rowDirty:    { backgroundColor: "#fefce8" },
  nameCell:    { width: 110, paddingRight: 4, position: "relative" },
  dirtyDot:    { position: "absolute", top: 0, left: -6, width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" },
  rollNo:      { fontSize: 10, fontWeight: "700", color: "#94a3b8" },
  name:        { fontSize: 12, fontWeight: "700", color: "#0f172a", lineHeight: 16, marginTop: 1 },
  section:     { fontSize: 10, color: "#2563eb", marginTop: 2 },
  enrollId:    { fontSize: 10, color: "#6b7280", marginTop: 2 },

  controls:    { flex: 1, gap: 6 },
  chip:        { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  chipTxt:     { fontSize: 12, fontWeight: "700" },

  pctRow:      { flexDirection: "row", alignItems: "center", gap: 4 },
  pctInput:    { width: 50, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, fontWeight: "700", color: "#0f172a", backgroundColor: "#f8fafc", textAlign: "center" },
  pctLabel:    { fontSize: 12, color: "#64748b" },

  remarksInput:{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12, color: "#334155", backgroundColor: "#f8fafc", minHeight: 34 },

  empty:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  emptyTxt:    { fontSize: 14, color: "#94a3b8" },
});
