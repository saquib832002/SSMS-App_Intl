/**
 * screens/StudentActions/HomeworkCreateScreen.js
 *
 * Teacher homework management screen:
 *   • Top filter bar  — session / branch / class / section / date
 *   • Homework list   — today's tasks for the selected class, tap to mark students
 *   • FAB "+"         — opens bottom-sheet form to create a new task
 */
import React, {
  useState, useEffect, useCallback, useContext, useRef,
} from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, FlatList,
  KeyboardAvoidingView, Platform, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker   from "@react-native-community/datetimepicker";
import { Feather }      from "@expo/vector-icons";
import { AuthContext }  from "../../context/AuthContext";
import {
  fetchClasses, fetchSections, fetchSessions, fetchBranches,
} from "../../services/StudentServiceApi";
import { fetchClassSubjects, fetchTeacherAssignments } from "../../services/SubjectServiceApi";
import { listHomework, createHomework, deleteHomework } from "../../services/HomeworkServiceApi";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt  = (d) => d.toISOString().split("T")[0];
const today = fmt(new Date());

// ── Compact dropdown ──────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={sel ? dd.val : dd.ph} numberOfLines={1}>
          {sel ? sel.label : (placeholder ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#64748b" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={o => String(o.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[dd.opt, String(item.value) === String(value) && dd.optSel]}
                  onPress={() => { onChange(item.value); setOpen(false); }}
                >
                  <Text style={[dd.optTxt, String(item.value) === String(value) && dd.optSelTxt]}>
                    {item.label}
                  </Text>
                  {String(item.value) === String(value) &&
                    <Feather name="check" size={14} color="#2563eb" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  active:   { bg: "#dcfce7", fg: "#15803d", label: "Active"  },
  closed:   { bg: "#f1f5f9", fg: "#64748b", label: "Closed"  },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.active;
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 10, fontWeight: "700", color: s.fg }}>{s.label}</Text>
    </View>
  );
}

// ── Homework list card ────────────────────────────────────────────────────────
function HomeworkCard({ item, onMark, onDelete }) {
  const completed  = parseInt(item.totalCompleted  ?? 0);
  const total      = parseInt(item.totalMarked     ?? 0);
  const incomplete = parseInt(item.totalIncomplete ?? 0);

  return (
    <View style={c.card}>
      <View style={c.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={c.cardTitle} numberOfLines={2}>{item.title}</Text>
          {item.subjectName
            ? <Text style={c.cardSub}>📚 {item.subjectName}</Text>
            : null}
          <Text style={c.cardMeta}>
            Due: {item.dueDate}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <StatusBadge status={item.status} />
          {item.avgCompletionPct !== null && item.avgCompletionPct !== undefined
            ? <Text style={c.pct}>{item.avgCompletionPct}% avg</Text>
            : null}
        </View>
      </View>

      {/* Stats row */}
      {total > 0 && (
        <View style={c.statsRow}>
          <View style={c.statChip}>
            <Text style={[c.statN, { color: "#15803d" }]}>{completed}</Text>
            <Text style={c.statL}>Done</Text>
          </View>
          <View style={c.statChip}>
            <Text style={[c.statN, { color: "#dc2626" }]}>{incomplete}</Text>
            <Text style={c.statL}>Incomplete</Text>
          </View>
          <View style={c.statChip}>
            <Text style={[c.statN, { color: "#64748b" }]}>{parseInt(item.totalPending ?? 0)}</Text>
            <Text style={c.statL}>Pending</Text>
          </View>
        </View>
      )}

      <View style={c.cardActions}>
        <TouchableOpacity style={c.markBtn} onPress={() => onMark(item)}>
          <Feather name="edit-3" size={13} color="#fff" />
          <Text style={c.markBtnTxt}>Mark Students</Text>
        </TouchableOpacity>
        <TouchableOpacity style={c.delBtn} onPress={() => onDelete(item)}>
          <Feather name="trash-2" size={13} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function HomeworkCreateScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  // ── Role flags ──
  const role          = (user?.ssmsUserRole ?? "").toLowerCase().trim();
  const isAdminOwner  = role === "admin" || role === "owner";
  const staffId       = user?.staffId ?? null;

  // ── Teacher assignments cache (used when NOT admin/owner) ──
  const [teacherAssignments, setTeacherAssignments] = useState([]);

  // ── Filter state ──
  const [sessions,  setSessions]  = useState([]);
  const [branches,  setBranches]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [subjects,  setSubjects]  = useState([]);

  const [sessionId,  setSessionId]  = useState("");
  const [branchId,   setBranchId]   = useState(user?.branchId ?? "");
  const [classId,    setClassId]    = useState("");
  const [sectionId,  setSectionId]  = useState("");
  const [date,       setDate]       = useState(today);
  const [showDatePk, setShowDatePk] = useState(false);

  // ── Homework list ──
  const [homework, setHomework] = useState([]);
  const [loading,  setLoading]  = useState(false);

  // ── Create form ──
  const [showForm,     setShowForm]     = useState(false);
  const [formSubject,  setFormSubject]  = useState("");
  const [formSubjName, setFormSubjName] = useState("");
  const [formTitle,    setFormTitle]    = useState("");
  const [formDesc,     setFormDesc]     = useState("");
  const [formDueDate,  setFormDueDate]  = useState(today);
  const [showDuePk,    setShowDuePk]    = useState(false);
  const [saving,       setSaving]       = useState(false);

  // ── Load sessions (active + current only) + branches (auto-select first) ──
  useEffect(() => {
    Promise.all([
      fetchSessions(user).catch(() => []),
      fetchBranches(user).catch(() => []),
    ]).then(([sess, bran]) => {
      // Only sessions that are currently active
      const activeSess = sess.filter(s =>
        (s.is_current === 'Y' || s.is_current === 'y') &&
        (s.active === 'Yes' || s.active === 'yes' || s.active === 'Y' || s.active === 'y')
      );
      const sessOpts = activeSess.map(s => ({ value: s.session_id ?? s.id, label: s.session_name ?? s.name }));
      setSessions(sessOpts);
      if (sessOpts.length > 0) setSessionId(String(sessOpts[0].value));

      const branOpts = bran.map(b => ({ value: b.branch_id ?? b.id, label: b.branch_name ?? b.name }));
      setBranches(branOpts);
      // Auto-select first branch
      if (branOpts.length > 0 && !user?.branchId) setBranchId(String(branOpts[0].value));
    });
  }, []);

  // ── Load classes: admin/owner OR teacher with no staffId → all classes
  //                 teacher with staffId → only assigned classes ──────────────
  useEffect(() => {
    if (isAdminOwner || !staffId) {
      // Fallback: show all classes (covers admin, owner, and teachers whose
      // account has no staff_id linked yet)
      fetchClasses(user).catch(() => []).then(cls =>
        setClasses(cls.map(c => ({ value: c.class_id ?? c.id, label: c.class_name ?? c.name })))
      );
    } else {
      // Teacher with a known staffId: only their assigned classes
      fetchTeacherAssignments(user, staffId).catch(() => []).then(assignments => {
        setTeacherAssignments(assignments);
        const seen = new Set();
        const cls  = [];
        assignments.forEach(a => {
          if (a.class_id && !seen.has(a.class_id)) {
            seen.add(a.class_id);
            cls.push({ value: a.class_id, label: a.class_name ?? String(a.class_id) });
          }
        });
        // If assignments came back empty (not yet configured), fall back to all
        if (cls.length === 0) {
          fetchClasses(user).catch(() => []).then(all =>
            setClasses(all.map(c => ({ value: c.class_id ?? c.id, label: c.class_name ?? c.name })))
          );
        } else {
          setClasses(cls);
        }
      });
    }
  }, [isAdminOwner, staffId]);

  // ── Sections + Subjects when class changes ──
  useEffect(() => {
    if (!classId) { setSections([]); setSubjects([]); return; }

    // Sections always come from the API (not subject-teacher-specific)
    fetchSections(user, classId).catch(() => []).then(s => {
      const opts = s.map(x => ({ value: x.section_id ?? x.id, label: x.section_name ?? x.name }));
      setSections(opts);
      // Auto-select first section
      setSectionId(opts.length > 0 ? String(opts[0].value) : "");
    });

    if (isAdminOwner) {
      // Admin/owner: all subjects for this class
      fetchClassSubjects(user, classId).catch(() => []).then(s =>
        setSubjects(s.map(x => ({ value: x.subject_id ?? x.id, label: x.subject_name ?? x.name })))
      );
    } else {
      // Teacher: only their assigned subjects for this class
      const assigned = teacherAssignments.filter(a => String(a.class_id) === String(classId));
      const seen = new Set();
      const subs = [];
      assigned.forEach(a => {
        if (a.subject_id && !seen.has(a.subject_id)) {
          seen.add(a.subject_id);
          subs.push({ value: a.subject_id, label: a.subject_name ?? String(a.subject_id) });
        }
      });
      setSubjects(subs);
    }
  }, [classId, isAdminOwner, teacherAssignments]);

  // ── Load homework list ──
  const loadHomework = useCallback(async () => {
    if (!classId || !sessionId) return;
    setLoading(true);
    try {
      const rows = await listHomework(user, {
        sessionId, branchId: branchId || undefined,
        classId, sectionId: sectionId || undefined, date,
      });
      setHomework(rows);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [classId, sessionId, branchId, sectionId, date]);

  useEffect(() => { loadHomework(); }, [loadHomework]);

  // ── Save new homework ──
  const handleSave = async () => {
    if (!formTitle.trim()) { Alert.alert("Required", "Title is required."); return; }
    if (!classId || !sessionId) { Alert.alert("Required", "Please select a session and class first."); return; }
    setSaving(true);
    try {
      await createHomework(user, {
        sessionId, branchId: branchId || undefined,
        classId, sectionId: sectionId || undefined,
        subjectId:   formSubject  || undefined,
        subjectName: formSubjName || undefined,
        teacherId:   user?.staffId ?? user?.userId ?? 0,
        title:       formTitle.trim(),
        description: formDesc.trim() || undefined,
        assignedDate: date,
        dueDate:      formDueDate,
      });
      Alert.alert("Success", "Homework created!", [{ text: "OK" }]);
      setFormTitle(""); setFormDesc(""); setFormSubject(""); setFormSubjName(""); setFormDueDate(today);
      setShowForm(false);
      loadHomework();
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──
  const handleDelete = (item) => {
    Alert.alert(
      "Delete Homework",
      `Delete "${item.title}"? This will also remove all student marks.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteHomework(user, item.id);
              loadHomework();
            } catch (e) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Homework</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setShowForm(true)}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={s.addBtnTxt}>New Task</Text>
        </TouchableOpacity>
      </View>

      {/* ── Filter bar ── */}
      <View style={s.filters}>
        <View style={s.filterRow}>
          <View style={s.filterCell}>
            <Text style={s.filterLabel}>Session</Text>
            <Dropdown
              label="Session" value={sessionId}
              options={sessions} onChange={setSessionId}
              placeholder="Select"
            />
          </View>
          <View style={s.filterCell}>
            <Text style={s.filterLabel}>Branch</Text>
            <Dropdown
              label="Branch" value={branchId}
              options={branches}
              onChange={setBranchId}
              placeholder="Select"
            />
          </View>
        </View>
        <View style={s.filterRow}>
          <View style={s.filterCell}>
            <Text style={s.filterLabel}>Class</Text>
            <Dropdown
              label="Class" value={classId}
              options={classes} onChange={v => { setClassId(v); setSectionId(""); }}
              placeholder="Select"
            />
          </View>
          <View style={s.filterCell}>
            <Text style={s.filterLabel}>Section</Text>
            <Dropdown
              label="Section" value={sectionId}
              options={sections}
              onChange={setSectionId}
              disabled={!classId}
              placeholder="Select"
            />
          </View>
        </View>

        {/* Date */}
        <TouchableOpacity style={s.datePicker} onPress={() => setShowDatePk(true)}>
          <Feather name="calendar" size={14} color="#2563eb" />
          <Text style={s.datePickerTxt}>{date}</Text>
          <Feather name="chevron-down" size={13} color="#64748b" />
        </TouchableOpacity>
        {showDatePk && (
          <DateTimePicker
            value={new Date(date)}
            mode="date"
            display="default"
            onChange={(_, d) => { setShowDatePk(false); if (d) setDate(fmt(d)); }}
          />
        )}
      </View>

      {/* ── List ── */}
      {loading
        ? <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#2563eb" />
        : homework.length === 0
          ? (
            <View style={s.empty}>
              <Feather name="book" size={40} color="#cbd5e1" />
              <Text style={s.emptyTitle}>No homework assigned</Text>
              <Text style={s.emptyDesc}>
                {classId && sessionId
                  ? 'Tap “+ New Task” to create one.'
                  : "Select session and class to view homework."}
              </Text>
            </View>
          )
          : (
            <FlatList
              data={homework}
              keyExtractor={i => String(i.id)}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              renderItem={({ item }) => (
                <HomeworkCard
                  item={item}
                  onMark={(hw) => navigation.navigate("HomeworkMark", {
                    homeworkId: hw.id,
                    sessionId,
                    title: hw.title,
                  })}
                  onDelete={handleDelete}
                />
              )}
            />
          )
      }

      {/* ── Create form modal ── */}
      <Modal
        visible={showForm}
        animationType="slide"
        transparent
        onRequestClose={() => setShowForm(false)}
      >
        <KeyboardAvoidingView
          style={f.overlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity style={f.backdrop} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={f.sheet}>
            {/* Sheet header */}
            <View style={f.sheetHeader}>
              <Text style={f.sheetTitle}>New Homework Task</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}>
                <Feather name="x" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={f.scroll} keyboardShouldPersistTaps="handled">

              {/* Session + Branch */}
              <View style={f.row}>
                <View style={f.cell}>
                  <Text style={f.label}>Session <Text style={{ color: "#dc2626" }}>*</Text></Text>
                  <Dropdown
                    label="Session" value={sessionId}
                    options={sessions} onChange={setSessionId}
                    placeholder="Select"
                  />
                </View>
                <View style={f.cell}>
                  <Text style={f.label}>Branch</Text>
                  <Dropdown
                    label="Branch" value={branchId}
                    options={branches}
                    onChange={setBranchId}
                    placeholder="Select"
                  />
                </View>
              </View>

              {/* Class + Section */}
              <View style={f.row}>
                <View style={f.cell}>
                  <Text style={f.label}>Class <Text style={{ color: "#dc2626" }}>*</Text></Text>
                  <Dropdown
                    label="Class" value={classId}
                    options={classes}
                    onChange={v => { setClassId(v); setSectionId(""); }}
                    placeholder="Select"
                  />
                </View>
                <View style={f.cell}>
                  <Text style={f.label}>Section</Text>
                  <Dropdown
                    label="Section" value={sectionId}
                    options={sections}
                    onChange={setSectionId}
                    disabled={!classId}
                    placeholder="Select"
                  />
                </View>
              </View>

              {/* Subject */}
              <Text style={f.label}>Subject (optional)</Text>
              <Dropdown
                label="Subject" value={formSubject}
                options={[{ value: "", label: "General / No subject" }, ...subjects]}
                onChange={v => {
                  setFormSubject(v);
                  const found = subjects.find(s => String(s.value) === String(v));
                  setFormSubjName(found?.label ?? "");
                }}
              />

              {/* Title */}
              <Text style={f.label}>Title <Text style={{ color: "#dc2626" }}>*</Text></Text>
              <TextInput
                style={f.input}
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="e.g. Complete exercises 5–10"
                placeholderTextColor="#94a3b8"
                maxLength={200}
              />

              {/* Description */}
              <Text style={f.label}>Description / Instructions</Text>
              <TextInput
                style={[f.input, f.multiline]}
                value={formDesc}
                onChangeText={setFormDesc}
                placeholder="Add any notes or details for students..."
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              {/* Due Date */}
              <Text style={f.label}>Due Date</Text>
              <TouchableOpacity style={f.dateBtn} onPress={() => setShowDuePk(true)}>
                <Feather name="calendar" size={14} color="#2563eb" />
                <Text style={f.dateBtnTxt}>{formDueDate}</Text>
              </TouchableOpacity>
              {showDuePk && (
                <DateTimePicker
                  value={new Date(formDueDate)}
                  mode="date"
                  minimumDate={new Date(date)}
                  display="default"
                  onChange={(_, d) => { setShowDuePk(false); if (d) setFormDueDate(fmt(d)); }}
                />
              )}

              {/* Info */}
              <View style={f.infoBox}>
                <Feather name="info" size={13} color="#2563eb" />
                <Text style={f.infoTxt}>
                  Will be assigned to {sectionId
                    ? `${classes.find(c=>String(c.value)===String(classId))?.label ?? ""} — ${sections.find(s=>String(s.value)===String(sectionId))?.label ?? ""}`
                    : `all sections of ${classes.find(c=>String(c.value)===String(classId))?.label ?? "the selected class"}`
                  } on {date}.
                </Text>
              </View>

              {/* Save button */}
              <TouchableOpacity
                style={[f.saveBtn, saving && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="check" size={16} color="#fff" /><Text style={f.saveBtnTxt}>Create Homework</Text></>
                }
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 8 },
  backBtn:     { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: "#0f172a" },
  addBtn:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#2563eb", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  addBtnTxt:   { color: "#fff", fontSize: 13, fontWeight: "700" },

  filters:     { backgroundColor: "#fff", paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 8, paddingTop: 10 },
  filterRow:   { flexDirection: "row", gap: 8 },
  filterCell:  { flex: 1 },
  filterLabel: { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase", marginBottom: 3 },

  datePicker:  { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#f8fafc" },
  datePickerTxt: { flex: 1, fontSize: 13, fontWeight: "600", color: "#1e40af" },

  empty:       { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTitle:  { fontSize: 16, fontWeight: "700", color: "#64748b" },
  emptyDesc:   { fontSize: 13, color: "#94a3b8", textAlign: "center", lineHeight: 19 },
});

const c = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", gap: 10, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardTop:     { flexDirection: "row", gap: 10 },
  cardTitle:   { fontSize: 14, fontWeight: "700", color: "#0f172a", lineHeight: 20 },
  cardSub:     { fontSize: 12, color: "#2563eb", marginTop: 2 },
  cardMeta:    { fontSize: 11, color: "#94a3b8", marginTop: 3 },
  pct:         { fontSize: 11, fontWeight: "700", color: "#7c3aed" },
  statsRow:    { flexDirection: "row", gap: 8 },
  statChip:    { flex: 1, backgroundColor: "#f8fafc", borderRadius: 8, padding: 8, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  statN:       { fontSize: 16, fontWeight: "800" },
  statL:       { fontSize: 10, color: "#94a3b8", marginTop: 1 },
  cardActions: { flexDirection: "row", gap: 8 },
  markBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 8 },
  markBtnTxt:  { color: "#fff", fontSize: 13, fontWeight: "700" },
  delBtn:      { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8, backgroundColor: "#fff7f7" },
});

const f = StyleSheet.create({
  overlay:     { flex: 1, justifyContent: "flex-end" },
  backdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, elevation: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  sheetTitle:  { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  scroll:      { paddingHorizontal: 18 },
  label:       { fontSize: 12, fontWeight: "700", color: "#475569", marginTop: 14, marginBottom: 5 },
  input:       { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0f172a", backgroundColor: "#f8fafc" },
  multiline:   { minHeight: 90, paddingTop: 10 },
  dateBtn:     { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#f8fafc" },
  dateBtnTxt:  { fontSize: 14, fontWeight: "600", color: "#1e40af" },
  infoBox:     { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "#eff6ff", borderRadius: 10, padding: 12, marginTop: 14 },
  infoTxt:     { flex: 1, fontSize: 12, color: "#1e40af", lineHeight: 17 },
  saveBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, marginTop: 18 },
  saveBtnTxt:  { color: "#fff", fontSize: 15, fontWeight: "700" },
  row:         { flexDirection: "row", gap: 10 },
  cell:        { flex: 1 },
});

const dd = StyleSheet.create({
  trigger:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#f8fafc", gap: 4 },
  disabled: { opacity: 0.5 },
  val:      { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "600" },
  ph:       { flex: 1, fontSize: 13, color: "#94a3b8" },
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 30, maxHeight: "60%" },
  sheetTitle:{ fontSize: 14, fontWeight: "800", color: "#0f172a", padding: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  opt:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  optSel:   { backgroundColor: "#eff6ff" },
  optTxt:   { flex: 1, fontSize: 14, color: "#334155" },
  optSelTxt:{ color: "#2563eb", fontWeight: "700" },
});
