/**
 * screens/Exam/AddMarksScreen.js
 * Enterprise-level marks entry screen.
 * Step 1 — Select filters (Branch, Exam, Session, Class, Section, Subject)
 * Step 2 — Enter marks for each enrolled student in a clean table layout
 */
import React, {
  useState, useContext, useCallback, useEffect, useMemo, useRef,
} from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchExams, fetchStudentsForMarks, saveMarks, fetchSubjectMaxMarks } from "../../services/ExamServiceApi";
import { fetchClassSubjects, fetchTeacherAssignments } from "../../services/SubjectServiceApi";
import { fetchBranches, fetchClasses, fetchSessions } from "../../services/SetupServiceApi";
import { fetchSections } from "../../services/StudentServiceApi";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable Dropdown (same pattern across app)
// ─────────────────────────────────────────────────────────────────────────────
import { Modal, FlatList as FL } from "react-native";
function Dropdown({ label, value, options, onChange, disabled, loading, required }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[mk.dd, disabled && mk.ddDis]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[mk.ddTxt, !sel?.value && mk.ddPh]} numberOfLines={1}>
          {loading ? "Loading…" : (sel?.label ?? label)}
        </Text>
        <Feather name={loading ? "loader" : "chevron-down"} size={13} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={mk.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={mk.ddSheet}>
            <View style={mk.ddSheetHead}>
              <Text style={mk.ddSheetTitle}>{label}{required ? " *" : ""}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={mk.ddClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <FL
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[mk.ddOpt, String(o.value) === String(value) && mk.ddOptAct]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[mk.ddOptTxt, String(o.value) === String(value) && mk.ddOptTxtAct]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) &&
                    <Feather name="check" size={13} color="#1e40af" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter row label
// ─────────────────────────────────────────────────────────────────────────────
const FilterField = ({ label, required, children }) => (
  <View style={mk.filterField}>
    <Text style={mk.filterLabel}>{label}{required && <Text style={{ color: "#ef4444" }}> *</Text>}</Text>
    {children}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Marks input cell — supports per-component absent toggle
// ─────────────────────────────────────────────────────────────────────────────
const MarkCell = ({ value, onChangeText, maxVal, editable = true, isAbsent, onToggleAbsent }) => {
  const numVal = parseFloat(value) || 0;
  const exceeded = !isAbsent && maxVal != null && numVal > maxVal;
  return (
    <View style={{ alignItems: "center" }}>
      {isAbsent ? (
        // Absent mode: tappable "A" box — tap to undo
        <TouchableOpacity style={mk.absentBox} onPress={onToggleAbsent} activeOpacity={0.75}>
          <Text style={mk.absentBoxTxt}>A</Text>
        </TouchableOpacity>
      ) : (
        <TextInput
          style={[mk.markCell, exceeded && mk.markCellErr]}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          selectTextOnFocus
          editable={editable}
          placeholder="0"
          placeholderTextColor="#cbd5e1"
          maxLength={5}
        />
      )}
      {/* Absent toggle pill shown below input (only when editable) */}
      {editable && onToggleAbsent && (
        <TouchableOpacity
          style={[mk.absentPill, isAbsent && mk.absentPillOn]}
          onPress={onToggleAbsent}
          activeOpacity={0.75}
        >
          <Text style={[mk.absentPillTxt, isAbsent && mk.absentPillTxtOn]}>
            {isAbsent ? "✕ abs" : "abs"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function AddMarksScreen({ route }) {
  const { user } = useContext(AuthContext);
  const prefill = route?.params?.prefill ?? null;

  // ── Role / teacher restriction ─────────────────────────────────────────────
  const role         = (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim();
  const isAdmin      = ["admin", "owner"].includes(role);
  const isUserRole   = role === "user";
  const isRestricted = !isAdmin; // teacher / user see only their assignments
  const staffId      = user?.staffId ?? null;

  // ── Filter selections ──────────────────────────────────────────────────────
  const [filters, setFilters] = useState({
    branch_id: "", exam_id: "", session_id: "",
    class_id: "", section_id: "", subject_id: "",
  });
  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  // ── Static dropdown data ───────────────────────────────────────────────────
  const [branches,  setBranches]  = useState([]);
  const [exams,     setExams]     = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [subjects,  setSubjects]  = useState([]);
  const [maxMarksData, setMaxMarksData] = useState(null); // {theory, internal, practical}
  const [teacherAssignments, setTeacherAssignments] = useState([]); // [{class_id, class_name, subject_id, subject_name}]

  const [loadingFilters,  setLoadingFilters]  = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  // ── Students + marks ───────────────────────────────────────────────────────
  const [students,    setStudents]    = useState([]);   // [{enrollment_id, student_name, ...}]
  const [marksMap,    setMarksMap]    = useState({});   // { enrollment_id: {theory, internal, practical} }
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingMap,   setSavingMap]   = useState({});   // { enrollment_id: bool }
  const [savedMap,    setSavedMap]    = useState({});   // { enrollment_id: bool }
  const [step,        setStep]        = useState(1);    // 1=filters, 2=marks entry

  // ── Load static data on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFilters(true);

        // Always fetch branches, exams, sessions
        const basePromises = [fetchBranches(user), fetchExams(user), fetchSessions(user)];

        // For restricted roles with a staffId, fetch teacher assignments instead of all classes
        const restrictedLoad = isRestricted && staffId
          ? fetchTeacherAssignments(user, staffId).catch(() => [])
          : Promise.resolve(null);

        const [branchData, examData, sessionData, assignments] = await Promise.all([
          ...basePromises, restrictedLoad,
        ]);
        if (cancelled) return;

        const brList = Array.isArray(branchData)  ? branchData  : branchData?.data  ?? [];
        const exList = Array.isArray(examData)    ? examData    : examData?.data    ?? [];
        const seList = Array.isArray(sessionData) ? sessionData : sessionData?.data ?? [];
        setBranches(brList);
        setExams(exList);
        setSessions(seList);

        // Build class list
        let clList;
        if (isRestricted && Array.isArray(assignments) && assignments.length > 0) {
          // Derive unique classes from teacher assignments
          setTeacherAssignments(assignments);
          const seen = new Set();
          clList = [];
          assignments.forEach(a => {
            if (a.class_id && !seen.has(a.class_id)) {
              seen.add(a.class_id);
              clList.push({ class_id: a.class_id, class_name: a.class_name ?? String(a.class_id) });
            }
          });
        } else if (isRestricted && staffId) {
          // staffId present but no assignments — show nothing
          clList = [];
        } else {
          // Admin/owner — fetch all classes
          const classData = await fetchClasses(user);
          clList = Array.isArray(classData) ? classData : classData?.data ?? [];
        }
        setClasses(clList);

        // Apply prefill / auto-select
        if (prefill) {
          if (prefill.branch_id)  setFilter("branch_id",  String(prefill.branch_id));
          else if (brList.length) setFilter("branch_id",  String(brList[0].branch_id));
          if (prefill.session_id) setFilter("session_id", String(prefill.session_id));
          else if (seList.length) setFilter("session_id", String(seList[0].session_id));
          if (prefill.exam_id)    setFilter("exam_id",    String(prefill.exam_id));
          if (prefill.class_id)   setFilter("class_id",   String(prefill.class_id));
        } else {
          if (brList.length) setFilter("branch_id",  String(brList[0].branch_id));
          if (seList.length) setFilter("session_id", String(seList[0].session_id));
        }
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load filters");
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ── Load sections when class changes ──────────────────────────────────────
  useEffect(() => {
    if (!filters.class_id) { setSections([]); setFilter("section_id", ""); return; }
    let cancelled = false;
    setLoadingSections(true);
    setSections([]); setFilter("section_id", ""); setFilter("subject_id", "");
    fetchSections(user, filters.class_id)
      .then(d => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setSections(list);
        if (prefill?.section_id) setFilter("section_id", String(prefill.section_id));
        else if (list.length)   setFilter("section_id", String(list[0].section_id));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSections(false); });
    return () => { cancelled = true; };
  }, [filters.class_id]);

  // ── Load subjects when class changes ──────────────────────────────────────
  useEffect(() => {
    if (!filters.class_id) { setSubjects([]); setFilter("subject_id", ""); return; }
    setSubjects([]); setFilter("subject_id", "");

    if (isRestricted && teacherAssignments.length > 0) {
      // Derive subjects for this class from teacher assignments (no API call needed)
      const subs = teacherAssignments
        .filter(a => String(a.class_id) === String(filters.class_id))
        .map(a => ({ subject_id: a.subject_id, subject_name: a.subject_name, subject_code: a.subject_code ?? "" }));
      setSubjects(subs);
      return;
    }

    // Admin/owner — fetch all subjects for the class
    let cancelled = false;
    setLoadingSubjects(true);
    fetchClassSubjects(user, filters.class_id)
      .then(d => { if (!cancelled) setSubjects(Array.isArray(d) ? d : d?.data ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [filters.class_id, teacherAssignments]);

  // ── Load max marks when exam / class / subject changes ────────────────────
  // Uses exam-specific row if one exists (quick test), falls back to class-level
  useEffect(() => {
    if (!filters.subject_id || !filters.class_id) { setMaxMarksData(null); return; }
    let cancelled = false;
    fetchSubjectMaxMarks(user, filters.class_id, filters.subject_id, filters.exam_id || null)
      .then(row => { if (!cancelled) setMaxMarksData(row); })
      .catch(() => { if (!cancelled) setMaxMarksData(null); });
    return () => { cancelled = true; };
  }, [filters.subject_id, filters.class_id, filters.exam_id]);

  // ── Fetch students for marks ───────────────────────────────────────────────
  const handleProceed = async () => {
    if (!filters.exam_id)    { Alert.alert("Required", "Please select an exam.");    return; }
    if (!filters.class_id)   { Alert.alert("Required", "Please select a class.");   return; }
    if (!filters.section_id) { Alert.alert("Required", "Please select a section."); return; }
    if (!filters.subject_id) { Alert.alert("Required", "Please select a subject."); return; }

    try {
      setLoadingStudents(true);
      const rows = await fetchStudentsForMarks(user, {
        branchId:  filters.branch_id,
        examId:    filters.exam_id,
        sessionId: filters.session_id,
        classId:   filters.class_id,
        sectionId: filters.section_id,
        subjectId: filters.subject_id,
      });
      if (!rows.length) {
        Alert.alert("No Students", "No enrolled students found for the selected filters.");
        return;
      }
      // Build marksMap from existing marks
      const map = {};
      rows.forEach(r => {
        map[r.enrollment_id] = {
          marks_id:         r.marks_id           ?? null,
          theory_absent:    r.theory_absent    == 1,
          internal_absent:  r.internal_absent  == 1,
          practical_absent: r.practical_absent == 1,
          theory_marks:    r.theory_marks    != null ? String(r.theory_marks)    : "",
          internal_marks:  r.internal_marks  != null ? String(r.internal_marks)  : "",
          practical_marks: r.practical_marks != null ? String(r.practical_marks) : "",
          total_marks:     r.total_marks     != null ? String(r.total_marks)     : "",
        };
      });
      setStudents(rows);
      setMarksMap(map);
      setStep(2);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load students");
    } finally {
      setLoadingStudents(false);
    }
  };

  // ── Toggle per-component absent for a student ────────────────────────────
  // component: 'theory' | 'internal' | 'practical'
  const toggleAbsent = useCallback((enrollmentId, component) => {
    setMarksMap(prev => {
      const row = { ...prev[enrollmentId] };
      const key = `${component}_absent`;
      row[key] = !row[key];
      if (row[key]) {
        // Clear that component's mark when marking absent
        row[`${component}_marks`] = "";
      }
      // Recalculate total
      const t = row.theory_absent    ? 0 : (parseFloat(row.theory_marks)    || 0);
      const i = row.internal_absent  ? 0 : (parseFloat(row.internal_marks)  || 0);
      const p = row.practical_absent ? 0 : (parseFloat(row.practical_marks) || 0);
      row.total_marks = String(t + i + p);
      return { ...prev, [enrollmentId]: row };
    });
  }, []);

  // ── Update marks for a student field ─────────────────────────────────────
  const updateMark = useCallback((enrollmentId, field, value) => {
    setMarksMap(prev => {
      const row = { ...prev[enrollmentId], [field]: value };
      // Auto-calculate total
      const t = parseFloat(row.theory_marks)    || 0;
      const i = parseFloat(row.internal_marks)  || 0;
      const p = parseFloat(row.practical_marks) || 0;
      row.total_marks = String(t + i + p);
      return { ...prev, [enrollmentId]: row };
    });
  }, []);

  // ── Save marks for a single student ──────────────────────────────────────
  const handleSaveRow = useCallback(async (student) => {
    const eid = student.enrollment_id;
    const row = marksMap[eid] ?? {};
    const maxT = parseFloat(maxMarksData?.theory_max_marks)    || null;
    const maxI = parseFloat(maxMarksData?.internal_max_marks)  || null;
    const maxP = parseFloat(maxMarksData?.practical_max_marks) || null;

    // Validate: each non-absent component with a defined max must be filled
    const missing = [];
    if (!row.theory_absent    && maxT != null && (row.theory_marks    === "" || row.theory_marks    == null)) missing.push("Theory");
    if (!row.internal_absent  && maxI != null && (row.internal_marks  === "" || row.internal_marks  == null)) missing.push("Internal");
    if (!row.practical_absent && maxP != null && (row.practical_marks === "" || row.practical_marks == null)) missing.push("Practical");
    if (missing.length > 0) {
      Alert.alert("Marks Required", `Please enter ${missing.join(", ")} marks or mark them as absent.`);
      return;
    }
    if (!row.theory_absent    && maxT && parseFloat(row.theory_marks)    > maxT) {
      Alert.alert("Validation", `Theory marks exceed max (${maxT})`); return;
    }
    if (!row.internal_absent  && maxI && parseFloat(row.internal_marks)  > maxI) {
      Alert.alert("Validation", `Internal marks exceed max (${maxI})`); return;
    }
    if (!row.practical_absent && maxP && parseFloat(row.practical_marks) > maxP) {
      Alert.alert("Validation", `Practical marks exceed max (${maxP})`); return;
    }

    const t = row.theory_absent    ? 0 : (parseFloat(row.theory_marks)    || 0);
    const i = row.internal_absent  ? 0 : (parseFloat(row.internal_marks)  || 0);
    const p = row.practical_absent ? 0 : (parseFloat(row.practical_marks) || 0);
    const allAbsent = row.theory_absent && row.internal_absent && row.practical_absent;

    try {
      setSavingMap(prev => ({ ...prev, [eid]: true }));
      setSavedMap(prev => ({ ...prev, [eid]: false }));
      const payload = {
        ...filters,
        marks: [{
          enrollment_id:    eid,
          roll_number:      student.roll_number,
          theory_absent:    row.theory_absent    ? 1 : 0,
          internal_absent:  row.internal_absent  ? 1 : 0,
          practical_absent: row.practical_absent ? 1 : 0,
          theory_marks:     row.theory_absent    ? null : t,
          internal_marks:   row.internal_absent  ? null : i,
          practical_marks:  row.practical_absent ? null : p,
          total_marks:      allAbsent            ? null : (t + i + p),
        }],
      };
      console.log("saveMarks payload:", JSON.stringify(payload));
      await saveMarks(user, payload);
      setSavedMap(prev => ({ ...prev, [eid]: true }));
      // Reset saved indicator after 3 seconds
      setTimeout(() => setSavedMap(prev => ({ ...prev, [eid]: false })), 3000);
    } catch (e) {
      Alert.alert("Security Restriction", e.message || "Failed to save marks");
    } finally {
      setSavingMap(prev => ({ ...prev, [eid]: false }));
    }
  }, [marksMap, maxMarksData, filters, user]);

  // ── Save All (still available as convenience) ─────────────────────────────
  const handleSaveAll = async () => {
    const maxT = parseFloat(maxMarksData?.theory_max_marks)    || null;
    const maxI = parseFloat(maxMarksData?.internal_max_marks)  || null;
    const maxP = parseFloat(maxMarksData?.practical_max_marks) || null;

    for (const s of students) {
      const row = marksMap[s.enrollment_id] ?? {};
      const missing = [];
      if (!row.theory_absent    && maxT != null && (row.theory_marks    === "" || row.theory_marks    == null)) missing.push("Theory");
      if (!row.internal_absent  && maxI != null && (row.internal_marks  === "" || row.internal_marks  == null)) missing.push("Internal");
      if (!row.practical_absent && maxP != null && (row.practical_marks === "" || row.practical_marks == null)) missing.push("Practical");
      if (missing.length > 0) {
        Alert.alert("Marks Required", `${s.student_name}: enter ${missing.join(", ")} or mark as absent.`);
        return;
      }
      if (!row.theory_absent    && maxT && parseFloat(row.theory_marks)    > maxT) {
        Alert.alert("Validation", `${s.student_name}: Theory marks exceed max (${maxT})`); return;
      }
      if (!row.internal_absent  && maxI && parseFloat(row.internal_marks)  > maxI) {
        Alert.alert("Validation", `${s.student_name}: Internal marks exceed max (${maxI})`); return;
      }
      if (!row.practical_absent && maxP && parseFloat(row.practical_marks) > maxP) {
        Alert.alert("Validation", `${s.student_name}: Practical marks exceed max (${maxP})`); return;
      }
    }

    const marksArr = students.map(s => {
      const row = marksMap[s.enrollment_id] ?? {};
      const t = row.theory_absent    ? 0 : (parseFloat(row.theory_marks)    || 0);
      const i = row.internal_absent  ? 0 : (parseFloat(row.internal_marks)  || 0);
      const p = row.practical_absent ? 0 : (parseFloat(row.practical_marks) || 0);
      const allAbsent = row.theory_absent && row.internal_absent && row.practical_absent;
      return {
        enrollment_id:    s.enrollment_id,
        roll_number:      s.roll_number,
        theory_absent:    row.theory_absent    ? 1 : 0,
        internal_absent:  row.internal_absent  ? 1 : 0,
        practical_absent: row.practical_absent ? 1 : 0,
        theory_marks:     row.theory_absent    ? null : t,
        internal_marks:   row.internal_absent  ? null : i,
        practical_marks:  row.practical_absent ? null : p,
        total_marks:      allAbsent            ? null : (t + i + p),
      };
    });

    try {
      setSavingMap({ all: true });
      const result = await saveMarks(user, { ...filters, marks: marksArr });
      // Mark all as saved
      const allSaved = {};
      students.forEach(s => { allSaved[s.enrollment_id] = true; });
      setSavedMap(allSaved);
      setTimeout(() => setSavedMap({}), 3000);
      Alert.alert("Saved", result.message ?? "All marks saved successfully.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save marks");
    } finally {
      setSavingMap({});
    }
  };

  // ── Dropdown options ───────────────────────────────────────────────────────
  const branchOpts  = branches.map(b  => ({ label: b.branch_name,   value: String(b.branch_id)  }));
  const examOpts    = exams.map(e => ({
    label: e.exam_category && e.exam_category !== "Major"
      ? `${e.exam_name}  [${e.exam_category}]`
      : e.exam_name,
    value: String(e.exam_id),
  }));
  const sessionOpts = sessions.map(s  => ({ label: s.session_name ?? s.session_year, value: String(s.session_id) }));
  const classOpts   = [{ label: "Select Class",  value:""},  ...classes.map(c   => ({ label: c.class_name,    value: String(c.class_id)   }))];
  const sectionOpts = sections.map(s  => ({ label: s.section_name,  value: String(s.section_id) }));
  const subjectOpts = [{ label: "Select Subject", value: "" }, ...subjects.map(s => ({
    label: s.subject_code ? `${s.subject_name} - ${s.subject_code}` : s.subject_name,
    value: String(s.subject_id),
  }))];

  // ── Selected labels for summary ───────────────────────────────────────────
  const selExam    = exams.find(e   => String(e.exam_id)    === String(filters.exam_id));
  const selClass   = classes.find(c => String(c.class_id)   === String(filters.class_id));
  const selSection = sections.find(s=> String(s.section_id) === String(filters.section_id));
  const selSubject = subjects.find(s => String(s.subject_id) === String(filters.subject_id));
  const selSession = sessions.find(s => String(s.session_id) === String(filters.session_id));

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Filter selection
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <SafeAreaView style={mk.safe} edges={["bottom"]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={mk.scrollPad}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

            {/* Page title */}
            <View style={mk.pageHead}>
              <View style={mk.pageHeadIconWrap}>
                <Feather name="edit-3" size={20} color="#1e40af" />
              </View>
              <View>
                <Text style={mk.pageTitle}>Add / Edit Marks</Text>
                <Text style={mk.pageSub}>Select filters to load students</Text>
              </View>
            </View>

            {/* Filter card */}
            <View style={mk.card}>
              <Text style={mk.cardSectionTitle}>Step 1 — Select Filters</Text>

              <View style={mk.filterGrid}>
                <View style={mk.filterHalf}>
                  <FilterField label="Branch">
                    <Dropdown label="All Branches" value={filters.branch_id}
                      options={branchOpts} onChange={v => setFilter("branch_id", v)}
                      loading={loadingFilters} />
                  </FilterField>
                </View>
                <View style={mk.filterHalf}>
                  <FilterField label="Exam" required>
                    <Dropdown label="Select Exam" value={filters.exam_id}
                      options={examOpts} onChange={v => setFilter("exam_id", v)}
                      loading={loadingFilters} required />
                  </FilterField>
                </View>
                <View style={mk.filterHalf}>
                  <FilterField label="Session">
                    <Dropdown label="Select Session" value={filters.session_id}
                      options={sessionOpts} onChange={v => setFilter("session_id", v)}
                      loading={loadingFilters} />
                  </FilterField>
                </View>
                <View style={mk.filterHalf}>
                  <FilterField label="Class" required>
                    <Dropdown label="Select Class" value={filters.class_id}
                      options={classOpts}
                      onChange={v => { setFilter("class_id", v); setFilter("section_id", ""); setFilter("subject_id", ""); }}
                      loading={loadingFilters} required />
                  </FilterField>
                </View>
                <View style={mk.filterHalf}>
                  <FilterField label="Section" required>
                    <Dropdown label="Select Section" value={filters.section_id}
                      options={sectionOpts} onChange={v => setFilter("section_id", v)}
                      disabled={!filters.class_id} loading={loadingSections} required />
                  </FilterField>
                </View>
                <View style={mk.filterHalf}>
                  <FilterField label="Subject" required>
                    <Dropdown label="Select Subject" value={filters.subject_id}
                      options={subjectOpts} onChange={v => setFilter("subject_id", v)}
                      disabled={!filters.class_id} loading={loadingSubjects} required />
                  </FilterField>
                </View>
              </View>

              {/* Max marks hint */}
              {maxMarksData ? (
                <View style={mk.maxMarksBanner}>
                  <Feather name="info" size={13} color="#1e40af" />
                  <Text style={mk.maxMarksTxt}>
                    Max — Theory: {maxMarksData.theory_max_marks ?? 0}  ·
                    Internal: {maxMarksData.internal_max_marks ?? 0}  ·
                    Practical: {maxMarksData.practical_max_marks ?? 0}  ·
                    Total: {maxMarksData.max_marks ?? 0}
                  </Text>
                </View>
              ) : (
                <View style={mk.maxMarksWarnBanner}>
                  <Feather name="alert-triangle" size={13} color="#92400e" />
                  <Text style={mk.maxMarksWarnTxt}>
                    Max marks not set for this subject. Go to Setup → Max Marks to configure them, otherwise the marksheet will show 0% for all students.
                  </Text>
                </View>
              )}

              {/* Proceed button */}
              <TouchableOpacity
                style={[mk.proceedBtn, loadingStudents && { opacity: 0.6 }]}
                onPress={handleProceed}
                disabled={loadingStudents}
                activeOpacity={0.85}
              >
                {loadingStudents
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Text style={mk.proceedBtnTxt}>Load Students</Text>
                      <Feather name="arrow-right" size={16} color="#fff" />
                    </>}
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Marks entry table
  // ─────────────────────────────────────────────────────────────────────────
  const maxT = maxMarksData?.theory_max_marks    ?? null;
  const maxI = maxMarksData?.internal_max_marks  ?? null;
  const maxP = maxMarksData?.practical_max_marks ?? null;

  return (
    <SafeAreaView style={mk.safe} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>

        {/* ── Context bar — stays at top ── */}
        <View style={mk.contextBar}>
          <TouchableOpacity style={mk.backBtn} onPress={() => setStep(1)}>
            <Feather name="arrow-left" size={16} color="#1e40af" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={mk.contextTitle} numberOfLines={1}>
              {selSubject?.subject_name ?? "Subject"}
            </Text>
            <Text style={mk.contextSub} numberOfLines={1}>
              {selClass?.class_name ?? "Class"}
              {selSection ? ` · ${selSection.section_name}` : ""}
              {selSession ? ` · ${selSession.session_name ?? selSession.session_year}` : ""}
            </Text>
          </View>
          <View style={mk.studentCountBadge}>
            <Text style={mk.studentCountTxt}>{students.length}</Text>
            <Text style={mk.studentCountLabel}>students</Text>
          </View>
        </View>

        {/* ── Exam info strip — name + category ── */}
        {selExam && (
          <View style={mk.examInfoStrip}>
            <View style={mk.examInfoField}>
              <Text style={mk.examInfoLabel}>Exam</Text>
              <Text style={mk.examInfoValue} numberOfLines={1}>{selExam.exam_name}</Text>
            </View>
            <View style={mk.examInfoDivider} />
            <View style={mk.examInfoField}>
              <Text style={mk.examInfoLabel}>Category</Text>
              {(() => {
                const { bg, fg } = CAT_COLORS[selExam.exam_category] ?? CAT_COLORS.Major;
                return (
                  <View style={[mk.examCatBadge, { backgroundColor: bg }]}>
                    <Text style={[mk.examCatTxt, { color: fg }]}>{selExam.exam_category ?? "Major"}</Text>
                  </View>
                );
              })()}
            </View>
          </View>
        )}

        {/* ── Scrollable body ── */}
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >

          {/* Max marks strip */}
          {maxMarksData && (
            <View style={mk.maxStrip}>
              {[
                { label: "Theory",    val: maxT },
                { label: "Internal",  val: maxI },
                { label: "Practical", val: maxP },
                { label: "Total",     val: maxMarksData?.max_marks, highlight: true },
              ].filter(x => x.val != null).map(x => (
                <View key={x.label} style={[mk.maxChip, x.highlight && mk.maxChipHL]}>
                  <Text style={[mk.maxChipLabel, x.highlight && { color: "#fff" }]}>{x.label}</Text>
                  <Text style={[mk.maxChipVal,   x.highlight && { color: "#fff" }]}>{x.val}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Column headers */}
          <View style={mk.tableHeader}>
            <Text style={[mk.thCell, mk.thRoll]}>Roll</Text>
            <Text style={[mk.thCell, mk.thName]}>Name</Text>
            <Text style={[mk.thCell, mk.thMark]}>THEO.{maxT ? `\n/${maxT}` : ""}</Text>
            <Text style={[mk.thCell, mk.thMark]}>INT.{maxI ? `\n/${maxI}` : ""}</Text>
            <Text style={[mk.thCell, mk.thMark]}>PRAC{maxP ? `\n/${maxP}` : ""}</Text>
            <Text style={[mk.thCell, mk.thTotal]}>Total</Text>
            <Text style={[mk.thCell, mk.thSave]}>Save</Text>
          </View>

          {/* Student rows */}
          {students.map((item, index) => {
            const row      = marksMap[item.enrollment_id] ?? {};
            const tAbs     = !!row.theory_absent;
            const iAbs     = !!row.internal_absent;
            const pAbs     = !!row.practical_absent;
            const anyAbsent = tAbs || iAbs || pAbs;
            const allAbsent = tAbs && iAbs && pAbs;
            const t        = tAbs ? 0 : (parseFloat(row.theory_marks)    || 0);
            const i        = iAbs ? 0 : (parseFloat(row.internal_marks)  || 0);
            const p        = pAbs ? 0 : (parseFloat(row.practical_marks) || 0);
            const total    = t + i + p;
            const isEven   = index % 2 === 0;
            // user role: locked when marks_id exists AND every present component is filled
            const theoryOk    = maxT == null || tAbs || (row.theory_marks    !== "" && row.theory_marks    != null);
            const internalOk  = maxI == null || iAbs || (row.internal_marks  !== "" && row.internal_marks  != null);
            const practicalOk = maxP == null || pAbs || (row.practical_marks !== "" && row.practical_marks != null);
            const locked = isUserRole && !!row.marks_id && theoryOk && internalOk && practicalOk;
            return (
              <View key={String(item.enrollment_id)}
                style={[mk.studentRow, isEven && mk.studentRowAlt, locked && !anyAbsent && mk.studentRowLocked, anyAbsent && mk.studentRowAbsent]}>
                <View style={mk.cellRoll}>
                  <Text style={mk.rollTxt}>{item.roll_number ?? index + 1}</Text>
                </View>
                <View style={mk.cellName}>
                  <Text style={mk.nameTxt} numberOfLines={2}>{item.student_name}</Text>
                  <Text style={mk.regTxt}>{item.enrollment_id ?? ""}</Text>
                  {locked && !anyAbsent && <Text style={mk.lockedTxt}>Submitted</Text>}
                  {allAbsent && <Text style={mk.absentBadge}>ABSENT</Text>}
                </View>
                <View style={mk.cellMark}>
                  <MarkCell
                    value={row.theory_marks ?? ""}
                    onChangeText={v => updateMark(item.enrollment_id, "theory_marks", v)}
                    maxVal={maxT}
                    editable={!locked}
                    isAbsent={tAbs}
                    onToggleAbsent={!locked ? () => toggleAbsent(item.enrollment_id, "theory") : undefined}
                  />
                </View>
                <View style={mk.cellMark}>
                  <MarkCell
                    value={row.internal_marks ?? ""}
                    onChangeText={v => updateMark(item.enrollment_id, "internal_marks", v)}
                    maxVal={maxI}
                    editable={!locked}
                    isAbsent={iAbs}
                    onToggleAbsent={!locked ? () => toggleAbsent(item.enrollment_id, "internal") : undefined}
                  />
                </View>
                <View style={mk.cellMark}>
                  <MarkCell
                    value={row.practical_marks ?? ""}
                    onChangeText={v => updateMark(item.enrollment_id, "practical_marks", v)}
                    maxVal={maxP}
                    editable={!locked}
                    isAbsent={pAbs}
                    onToggleAbsent={!locked ? () => toggleAbsent(item.enrollment_id, "practical") : undefined}
                  />
                </View>
                <View style={mk.cellTotal}>
                  {allAbsent
                    ? <Text style={[mk.totalTxt, { color: "#ef4444" }]}>A</Text>
                    : <Text style={mk.totalTxt}>{total > 0 ? total : "—"}</Text>}
                </View>
                <View style={mk.cellSave}>
                  {locked && !anyAbsent
                    ? <Feather name="lock" size={13} color="#94a3b8" />
                    : savingMap[item.enrollment_id]
                      ? <ActivityIndicator size="small" color="#1e40af" />
                      : savedMap[item.enrollment_id]
                        ? <View style={mk.savedIcon}><Feather name="check" size={13} color="#fff" /></View>
                        : <TouchableOpacity style={mk.rowSaveBtn} onPress={() => handleSaveRow(item)} activeOpacity={0.75}>
                            <Feather name="save" size={13} color="#fff" />
                          </TouchableOpacity>}
                </View>
              </View>
            );
          })}

          {/* Save All button — inside scroll at the bottom */}
          <View style={mk.saveBarInline}>
            <View>
              <Text style={mk.saveBarCount}>{students.length} students</Text>
              <Text style={mk.saveBarSub}>Tap to save all at once</Text>
            </View>
            <TouchableOpacity
              style={[mk.saveBtn, savingMap?.all && { opacity: 0.6 }]}
              onPress={handleSaveAll}
              disabled={!!savingMap?.all}
              activeOpacity={0.85}
            >
              {savingMap?.all
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Feather name="check" size={16} color="#fff" />
                    <Text style={mk.saveBtnTxt}>Save All</Text>
                  </>}
            </TouchableOpacity>
          </View>

        </ScrollView>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Category badge colour map (bg, text) — kept outside StyleSheet (nested objects not allowed)
const CAT_COLORS = {
  Annual:  { bg: "#f3e8ff", fg: "#7c3aed" },
  Term:    { bg: "#e0f2fe", fg: "#0369a1" },
  Major:   { bg: "#f1f5f9", fg: "#475569" },
  Minor:   { bg: "#fef9c3", fg: "#b45309" },
  Weekly:  { bg: "#dbeafe", fg: "#1d4ed8" },
  Monthly: { bg: "#dcfce7", fg: "#15803d" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const mk = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#f8fafc" },
  scrollPad: { padding: 16 },

  // Page header
  pageHead:        { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 },
  pageHeadIconWrap:{ width: 48, height: 48, borderRadius: 14, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  pageTitle:       { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  pageSub:         { fontSize: 12, color: "#94a3b8", marginTop: 2 },

  // Card
  card:            { backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cardSectionTitle:{ fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 16 },

  // Filter grid
  filterGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  filterHalf:   { width: "47.5%" },
  filterField:  { marginBottom: 4 },
  filterLabel:  { fontSize: 11, fontWeight: "700", color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 },

  // Max marks banner
  maxMarksBanner:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#eff6ff", borderRadius: 10, padding: 10, marginTop: 14, marginBottom: 4 },
  maxMarksTxt:        { flex: 1, fontSize: 11, color: "#1e40af", fontWeight: "600" },
  maxMarksWarnBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginTop: 14, marginBottom: 4 },
  maxMarksWarnTxt:    { flex: 1, fontSize: 11, color: "#92400e", fontWeight: "600" },

  // Proceed button
  proceedBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#1e40af", borderRadius: 14, paddingVertical: 14, marginTop: 18, shadowColor: "#1e40af", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  proceedBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Context bar
  contextBar:    { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:       { width: 34, height: 34, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  contextTitle:  { fontSize: 13, fontWeight: "800", color: "#0f172a" },
  contextSub:    { fontSize: 11, color: "#64748b", marginTop: 1 },
  studentCountBadge: { alignItems: "center", backgroundColor: "#eff6ff", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  studentCountTxt:   { fontSize: 16, fontWeight: "800", color: "#1e40af" },
  studentCountLabel: { fontSize: 9, color: "#64748b", textTransform: "uppercase" },

  // Exam info strip
  examInfoStrip:   { flexDirection: "row", alignItems: "center", backgroundColor: "#eff6ff", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#dbeafe" },
  examInfoField:   { flex: 1, alignItems: "center" },
  examInfoLabel:   { fontSize: 9, fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  examInfoValue:   { fontSize: 12, fontWeight: "800", color: "#1e3a8a" },
  examInfoDivider: { width: 1, height: 28, backgroundColor: "#bfdbfe", marginHorizontal: 8 },
  examCatBadge:    { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  examCatTxt:      { fontSize: 11, fontWeight: "800" },

  // Max marks strip
  maxStrip:      { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  maxChip:       { flex: 1, backgroundColor: "#fff", borderRadius: 8, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  maxChipHL:     { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  maxChipLabel:  { fontSize: 9, fontWeight: "600", color: "#94a3b8", textTransform: "uppercase" },
  maxChipVal:    { fontSize: 12, fontWeight: "800", color: "#0f172a", marginTop: 1 },

  // Table header
  tableHeader:   { flexDirection: "row", backgroundColor: "#1e40af", paddingVertical: 8, paddingHorizontal: 4 },
  thCell:        { fontSize: 10, fontWeight: "800", color: "#fff", textTransform: "uppercase", textAlign: "center", letterSpacing: 0.3 },
  thRoll:        { width: 28 },
  thName:        { flex: 1, textAlign: "left", paddingLeft: 4 },
  thMark:        { width: 52, textAlign: "center" },
  thTotal:       { width: 40, textAlign: "center" },
  thSave:        { width: 36, textAlign: "center" },

  // Student row
  studentRow:         { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", minHeight: 68 },
  studentRowAlt:      { backgroundColor: "#f8fafc" },
  studentRowLocked:   { backgroundColor: "#f1f5f9", opacity: 0.75 },
  studentRowAbsent:   { backgroundColor: "#fef2f2" },
  lockedTxt:          { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", marginTop: 2 },
  absentBadge:        { fontSize: 9, fontWeight: "800", color: "#ef4444", textTransform: "uppercase", marginTop: 2 },
  cellRoll:      { width: 28, alignItems: "center" },
  cellName:      { flex: 1, paddingRight: 4 },
  cellMark:      { width: 52, alignItems: "center" },
  cellTotal:     { width: 40, alignItems: "center" },
  cellSave:      { width: 36, alignItems: "center", justifyContent: "center" },

  // Per-component absent toggle in MarkCell
  absentBox:      { width: 42, height: 36, borderRadius: 8, backgroundColor: "#fef2f2", borderWidth: 1.5, borderColor: "#fca5a5", alignItems: "center", justifyContent: "center" },
  absentBoxTxt:   { fontSize: 16, fontWeight: "800", color: "#ef4444" },
  absentPill:     { marginTop: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  absentPillOn:   { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  absentPillTxt:  { fontSize: 8, fontWeight: "700", color: "#94a3b8" },
  absentPillTxtOn:{ color: "#fff" },
  rollTxt:       { fontSize: 12, fontWeight: "800", color: "#1e40af" },
  nameTxt:       { fontSize: 11, fontWeight: "600", color: "#0f172a" },
  regTxt:        { fontSize: 10, color: "#94a3b8" },
  totalTxt:      { fontSize: 13, fontWeight: "800", color: "#1e40af" },
  rowSaveBtn:    { width: 28, height: 28, borderRadius: 7, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center" },
  savedIcon:     { width: 28, height: 28, borderRadius: 7, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },

  // Mark cell input
  markCell:      { width: 42, height: 36, borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 8, textAlign: "center", fontSize: 15, color: "#0f172a", backgroundColor: "#fff", fontWeight: "700", paddingVertical: 0, includeFontPadding: false },
  markCellErr:   { borderColor: "#ef4444", backgroundColor: "#fef2f2" },

  // Save bar
  saveBar:       { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  saveBarInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, marginTop: 8, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  saveBarCount:  { fontSize: 13, fontWeight: "800", color: "#0f172a" },
  saveBarSub:    { fontSize: 11, color: "#94a3b8" },
  saveBtn:       { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1e40af", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, shadowColor: "#1e40af", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  saveBtnTxt:    { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Dropdown
  dd:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  ddDis:       { opacity: 0.45 },
  ddTxt:       { flex: 1, fontSize: 12, color: "#0f172a" },
  ddPh:        { color: "#94a3b8" },
  ddOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  ddSheet:     { backgroundColor: "#fff", borderRadius: 18, width: "100%", maxHeight: "65%", overflow: "hidden" },
  ddSheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  ddSheetTitle:{ fontSize: 14, fontWeight: "800", color: "#0f172a" },
  ddClose:     { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  ddOpt:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 16, borderRadius: 0 },
  ddOptAct:    { backgroundColor: "#eff6ff" },
  ddOptTxt:    { fontSize: 13, color: "#0f172a" },
  ddOptTxtAct: { color: "#1e40af", fontWeight: "700" },
});