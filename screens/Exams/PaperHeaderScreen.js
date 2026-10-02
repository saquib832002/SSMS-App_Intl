/**
 * screens/Exams/PaperHeaderScreen.js
 * Configure the paper header: school info, branch, session, class, subject,
 * exam type, duration, marks, instructions.
 * All dropdowns are sourced from the DB for the logged-in client.
 */
import React, { useState, useContext, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image, Modal,
  FlatList, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { createPaper, updatePaper } from "../../services/QuestionPaperServiceApi";
import { fetchClasses, fetchBranches, fetchSessions } from "../../services/SetupServiceApi";
import { fetchSubjects } from "../../services/SubjectServiceApi";
import { fetchInstituteDetails } from "../../services/UserServiceApi";
import { HOST_NAME } from "../../Environment/EnvironmentConfig";

const EXAM_TYPES = ["Unit Test", "Mid Term", "Half Yearly", "Annual", "Practice", "Quarterly"];

const LANGUAGES = [
  { key: "hi", label: "हिन्दी",   sub: "Hindi"   },
  { key: "en", label: "English",  sub: "English"  },
  { key: "ur", label: "اردو",     sub: "Urdu"     },
  { key: "ar", label: "العربية",  sub: "Arabic"   },
];

const DEFAULT_INSTRUCTIONS = {
  hi: "सभी प्रश्न अनिवार्य हैं।\nउत्तर साफ एवं सुंदर लिखावट में लिखें।\nमोबाइल फोन की अनुमति नहीं है।",
  en: "All questions are compulsory.\nWrite answers in neat handwriting.\nMobile phones are not allowed.",
  ur: "تمام سوالات لازمی ہیں۔\nجوابات صاف اور خوبصورت لکھاوٹ میں لکھیں۔\nموبائل فون کی اجازت نہیں ہے۔",
  ar: "جميع الأسئلة إلزامية.\nاكتب الإجابات بخط واضح ومرتب.\nالهواتف المحمولة غير مسموح بها.",
};

// All default instruction strings as a set for "is this still the default?" check
const ALL_DEFAULTS = new Set(Object.values(DEFAULT_INSTRUCTIONS));

// ── Reusable dropdown ─────────────────────────────────────────────────────────
function DropdownPicker({ label, value, placeholder, items, labelKey, valueKey, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => String(i[valueKey]) === String(value));
  return (
    <>
      <Text style={st.label}>{label}</Text>
      <TouchableOpacity style={st.dropdown} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={[st.dropdownTxt, !selected && st.dropdownPlaceholder]}>
          {selected ? selected[labelKey] : placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color="#64748b" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={st.modalOverlay} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={st.modalSheet}>
          <View style={st.modalHandle} />
          <Text style={st.modalTitle}>{label}</Text>
          <FlatList
            data={items}
            keyExtractor={i => String(i[valueKey])}
            renderItem={({ item }) => {
              const isSelected = String(item[valueKey]) === String(value);
              return (
                <TouchableOpacity
                  style={[st.modalItem, isSelected && st.modalItemSel]}
                  onPress={() => { onChange(String(item[valueKey])); setOpen(false); }}
                >
                  <Text style={[st.modalItemTxt, isSelected && st.modalItemTxtSel]}>
                    {item[labelKey]}
                  </Text>
                  {isSelected && <Feather name="check" size={16} color="#2563eb" />}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={st.modalSep} />}
          />
        </View>
      </Modal>
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function PaperHeaderScreen({ navigation, route }) {
  const { paper: editing } = route.params ?? {};
  const { user } = useContext(AuthContext);
  const isEdit = !!editing?.id;

  const [title,        setTitle]        = useState(editing?.title                        ?? "");
  const [schoolName,   setSchoolName]   = useState(editing?.header_config?.schoolName    ?? "");
  const [schoolAddr,   setSchoolAddr]   = useState(editing?.header_config?.address       ?? "");
  const [logoUrl,      setLogoUrl]      = useState(editing?.header_config?.logoUrl       ?? "");
  // branch_id / session_id are now proper DB columns returned at the top level.
  // Fall back to header_config for backward compat with papers saved before the migration.
  const [branchId,  setBranchId]  = useState(
    String(editing?.branch_id  ?? editing?.header_config?.branch_id  ?? "")
  );
  const [sessionId, setSessionId] = useState(
    String(editing?.session_id ?? editing?.header_config?.session_id ?? "")
  );
  const [classId,      setClassId]      = useState(String(editing?.class_id ?? ""));
  // ── Subject: single or multi ──────────────────────────────────────────────
  // Derive initSubjectIds from subject_ids array, OR fall back to deriving from
  // the resolved subjects[] array (returned by getPaper detail endpoint).
  // This handles the case where subject_ids is null but subjects[] is populated.
  const initSubjectIds = (() => {
    if (Array.isArray(editing?.subject_ids) && editing.subject_ids.length > 1)
      return editing.subject_ids.map(String);
    if (Array.isArray(editing?.subjects) && editing.subjects.length > 1)
      return editing.subjects.map(s => String(s.subject_id));
    return [];
  })();
  const [multiSubject, setMultiSubject] = useState(initSubjectIds.length > 1);
  const [subjectId,    setSubjectId]    = useState(String(editing?.subject_id ?? ""));
  const [subjectIds,   setSubjectIds]   = useState(initSubjectIds); // for multi-subject mode
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
  const [examType,     setExamType]     = useState(editing?.exam_type                    ?? "Unit Test");
  const [duration,     setDuration]     = useState(String(editing?.duration_minutes      ?? "90"));
  const [totalMarks,   setTotalMarks]   = useState(String(editing?.total_marks           ?? ""));
  const initLang = editing?.header_config?.language ?? "hi";
  const [language, setLanguage] = useState(initLang);

  const [instructions, setInstructions] = useState(() => {
    if (Array.isArray(editing?.instructions)) return editing.instructions.join("\n");
    if (editing?.instructions)               return editing.instructions;
    return DEFAULT_INSTRUCTIONS[initLang] ?? DEFAULT_INSTRUCTIONS.hi;
  });

  const handleLanguageChange = (key) => {
    const doSwap = () => {
      setLanguage(key);
      setInstructions(DEFAULT_INSTRUCTIONS[key]);
    };
    const isStillDefault = ALL_DEFAULTS.has(instructions.trim());
    if (isStillDefault) {
      // Instructions haven't been customised — swap silently
      doSwap();
    } else {
      // Custom instructions — ask before overwriting
      Alert.alert(
        "Update Instructions?",
        "Replace the current instructions with the default text for the selected language?",
        [
          {
            text: "Keep my text",
            style: "cancel",
            onPress: () => setLanguage(key), // still change language, keep text
          },
          {
            text: "Replace",
            onPress: doSwap,
          },
        ]
      );
    }
  };

  const [branches,  setBranches]  = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [subjects,  setSubjects]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [br, sess, cls, subs, inst] = await Promise.all([
          fetchBranches(user).catch(() => []),
          fetchSessions(user).catch(() => []),
          fetchClasses(user).catch(() => []),
          fetchSubjects(user).catch(() => []),
          fetchInstituteDetails(user).catch(() => null),
        ]);

        // normalise — APIs may return {status, data:[...]} or plain arrays
        const norm = (r) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];

        setBranches(norm(br));
        setSessions(norm(sess));
        setClasses(norm(cls));
        setSubjects(norm(subs));

        if (inst) {
          if (!schoolName && inst.ssms_client_name)    setSchoolName(inst.ssms_client_name);
          if (!schoolAddr && inst.ssms_client_address) setSchoolAddr(inst.ssms_client_address);
          if (!logoUrl && inst.logo_name && inst.ssms_client_code) {
            setLogoUrl(`${HOST_NAME}/clients/${inst.ssms_client_code}/${inst.logo_name}`);
          }
        }
      } catch (e) {
        console.warn("PaperHeaderScreen load error:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleNext = async () => {
    if (!title.trim()) { Alert.alert("Validation", "Paper title is required."); return; }
    if (!classId)      { Alert.alert("Validation", "Please select a class.");   return; }
    if (multiSubject && subjectIds.length < 2) {
      Alert.alert("Validation", "Select at least 2 subjects for a combined paper."); return;
    }
    if (!multiSubject && !subjectId) {
      Alert.alert("Validation", "Please select a subject."); return;
    }

    const instructionArr = instructions.split("\n").map(s => s.trim()).filter(Boolean);

    const selClass   = classes.find(c  => String(c.class_id)   === classId);
    const selSubject = multiSubject ? null : subjects.find(s => String(s.subject_id) === subjectId);
    const selSession = sessions.find(s  => String(s.session_id) === sessionId);
    const selBranch  = branches.find(b  => String(b.branch_id)  === branchId);
    // Resolve multi-subject objects
    const selSubjects = multiSubject
      ? subjectIds.map(sid => subjects.find(s => String(s.subject_id) === sid)).filter(Boolean)
      : (selSubject ? [selSubject] : []);

    const payload = {
      title:            title.trim(),
      branch_id:        branchId  || undefined,
      session_id:       sessionId || undefined,
      session:          selSession?.session_name ?? "",
      class_id:         classId,
      // Send explicit null (not undefined/omit) so the backend always updates both
      // columns when switching between single-subject and multi-subject modes.
      subject_id:       multiSubject ? null : (subjectId || undefined),
      subject_ids:      multiSubject ? subjectIds.map(Number) : null,
      exam_type:        examType,
      duration_minutes: parseInt(duration) || 90,
      total_marks:      totalMarks ? parseInt(totalMarks) : undefined,
      instructions:     instructionArr,
      header_config: {
        schoolName:  schoolName.trim(),
        address:     schoolAddr.trim(),
        logoUrl:     logoUrl || undefined,
        branch_id:   branchId  || undefined,
        session_id:  sessionId || undefined,
        branchName:  selBranch?.branch_name   ?? "",
        session:     selSession?.session_name ?? "",
        className:   selClass?.class_name     ?? "",
        subjectName: multiSubject
          ? selSubjects.map(s => s.subject_name).join(" · ")
          : (selSubject?.subject_name ?? ""),
        language,
      },
    };

    try {
      setSaving(true);
      if (isEdit) {
        await updatePaper(user, editing.id, payload);
        navigation.goBack();
      } else {
        const res = await createPaper(user, payload);
        const paper = {
          id:          res.id ?? res.paper_id,
          ...payload,
          class_name:  selClass?.class_name   ?? "",
          subject_name:!multiSubject ? (selSubject?.subject_name ?? "") : "",
          subjects:    selSubjects,   // [{subject_id, subject_name}] for multi
        };
        navigation.navigate("PaperBuilder", { paper });
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save paper header");
    } finally {
      setSaving(false);
    }
  };

  const selClass   = classes.find(c  => String(c.class_id)   === classId);
  const selSubject = !multiSubject ? subjects.find(s => String(s.subject_id) === subjectId) : null;
  const selSession = sessions.find(s  => String(s.session_id) === sessionId);
  const selSubjectsPreview = multiSubject
    ? subjectIds.map(sid => subjects.find(s => String(s.subject_id) === sid)?.subject_name).filter(Boolean)
    : [];

  if (loading) {
    return <View style={st.center}><ActivityIndicator size="large" color="#2563eb" /></View>;
  }

  return (
    <View style={st.root}>
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">

        {/* Paper title */}
        <Label>Paper Title (internal name)</Label>
        <Input placeholder="e.g. Class 10 Math Unit Test Oct 2026" value={title} onChangeText={setTitle} />

        {/* Branch & Session — side by side */}
        <SectionHead icon="git-branch" title="Branch & Session" />
        <View style={st.row}>
          <View style={st.cell}>
            <DropdownPicker
              label="Branch"
              value={branchId}
              placeholder="Branch…"
              items={branches.length ? branches : [{ branch_id: "", branch_name: "—" }]}
              labelKey="branch_name"
              valueKey="branch_id"
              onChange={setBranchId}
            />
          </View>
          <View style={st.cell}>
            <DropdownPicker
              label="Session *"
              value={sessionId}
              placeholder="Session…"
              items={sessions}
              labelKey="session_name"
              valueKey="session_id"
              onChange={setSessionId}
            />
          </View>
        </View>

        {/* Class & Subject */}
        <SectionHead icon="book-open" title="Class & Subject" />
        <View style={st.row}>
          <View style={st.cell}>
            <DropdownPicker
              label="Class *"
              value={classId}
              placeholder="Class…"
              items={classes}
              labelKey="class_name"
              valueKey="class_id"
              onChange={setClassId}
            />
          </View>
          {!multiSubject && (
            <View style={st.cell}>
              <DropdownPicker
                label="Subject *"
                value={subjectId}
                placeholder="Subject…"
                items={subjects}
                labelKey="subject_name"
                valueKey="subject_id"
                onChange={setSubjectId}
              />
            </View>
          )}
        </View>

        {/* Multi-subject toggle */}
        <TouchableOpacity
          style={st.multiToggle}
          onPress={() => setMultiSubject(v => !v)}
          activeOpacity={0.75}
        >
          <View style={[st.multiToggleBox, multiSubject && st.multiToggleBoxOn]}>
            {multiSubject && <Feather name="check" size={12} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.multiToggleTxt}>Combined / Multi-Subject Paper</Text>
            <Text style={st.multiToggleSub}>NEET, IIT JEE, or any paper spanning multiple subjects</Text>
          </View>
        </TouchableOpacity>

        {/* Multi-subject picker */}
        {multiSubject && (
          <>
            <Label>Select Subjects * (choose 2 or more)</Label>
            <TouchableOpacity style={st.multiSubjectBtn} onPress={() => setSubjectPickerOpen(true)}>
              {subjectIds.length === 0 ? (
                <Text style={st.multiSubjectPlaceholder}>Tap to select subjects…</Text>
              ) : (
                <View style={st.multiSubjectChips}>
                  {subjectIds.map(sid => {
                    const s = subjects.find(sub => String(sub.subject_id) === sid);
                    return s ? (
                      <View key={sid} style={st.subjectChip}>
                        <Text style={st.subjectChipTxt}>{s.subject_name}</Text>
                        <TouchableOpacity
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          onPress={() => setSubjectIds(prev => prev.filter(id => id !== sid))}
                        >
                          <Feather name="x" size={11} color="#1d4ed8" />
                        </TouchableOpacity>
                      </View>
                    ) : null;
                  })}
                  <TouchableOpacity style={st.subjectChipAdd} onPress={() => setSubjectPickerOpen(true)}>
                    <Feather name="plus" size={13} color="#2563eb" />
                  </TouchableOpacity>
                </View>
              )}
              {subjectIds.length === 0 && <Feather name="chevron-down" size={16} color="#64748b" />}
            </TouchableOpacity>

            {/* Subject multi-select modal */}
            <Modal visible={subjectPickerOpen} transparent animationType="slide" onRequestClose={() => setSubjectPickerOpen(false)}>
              <TouchableOpacity style={st.modalOverlay} activeOpacity={1} onPress={() => setSubjectPickerOpen(false)} />
              <View style={st.modalSheet}>
                <View style={st.modalHandle} />
                <Text style={st.modalTitle}>Select Subjects</Text>
                <FlatList
                  data={subjects}
                  keyExtractor={i => String(i.subject_id)}
                  renderItem={({ item }) => {
                    const sid = String(item.subject_id);
                    const isSel = subjectIds.includes(sid);
                    return (
                      <TouchableOpacity
                        style={[st.modalItem, isSel && st.modalItemSel]}
                        onPress={() => setSubjectIds(prev =>
                          isSel ? prev.filter(id => id !== sid) : [...prev, sid]
                        )}
                      >
                        <Text style={[st.modalItemTxt, isSel && st.modalItemTxtSel]}>{item.subject_name}</Text>
                        <View style={[st.multiCheck, isSel && st.multiCheckOn]}>
                          {isSel && <Feather name="check" size={12} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                  ItemSeparatorComponent={() => <View style={st.modalSep} />}
                />
                <View style={{ padding: 14 }}>
                  <TouchableOpacity
                    style={[st.nextBtn, { backgroundColor: "#059669" }]}
                    onPress={() => setSubjectPickerOpen(false)}
                  >
                    <Text style={st.nextTxt}>Done ({subjectIds.length} selected)</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          </>
        )}

        {/* Exam details */}
        <SectionHead icon="calendar" title="Exam Details" />
        <DropdownPicker
          label="Exam Type"
          value={examType}
          placeholder="Select exam type…"
          items={EXAM_TYPES.map(t => ({ label: t, value: t }))}
          labelKey="label"
          valueKey="value"
          onChange={setExamType}
        />

        <View style={st.row}>
          <View style={st.cell}>
            <Label>Duration (min)</Label>
            <Input placeholder="90" keyboardType="numeric" value={duration} onChangeText={setDuration} />
          </View>
          <View style={st.cell}>
            <Label>Total Marks</Label>
            <Input placeholder="auto" keyboardType="numeric" value={totalMarks} onChangeText={setTotalMarks} />
          </View>
        </View>

        {/* Instructions */}
        <SectionHead icon="info" title="General Instructions" />
        <Label>One instruction per line</Label>
        <TextInput
          style={st.textArea}
          multiline
          numberOfLines={6}
          value={instructions}
          onChangeText={setInstructions}
          textAlignVertical="top"
          placeholder="All questions are compulsory."
          placeholderTextColor="#9ca3af"
        />

        {/* Paper Language */}
        <SectionHead icon="globe" title="Paper Language" />
        <Label>Labels on the printed paper will appear in the selected language</Label>
        <View style={st.langRow}>
          {LANGUAGES.map(lang => {
            const sel = language === lang.key;
            return (
              <TouchableOpacity
                key={lang.key}
                style={[st.langChip, sel && st.langChipSel]}
                onPress={() => handleLanguageChange(lang.key)}
                activeOpacity={0.75}
              >
                <Text style={[st.langScript, sel && st.langScriptSel]}>{lang.label}</Text>
                <Text style={[st.langSub, sel && st.langSubSel]}>{lang.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Preview badge */}
        <View style={st.previewBox}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={st.previewLogo} resizeMode="contain" />
          ) : null}
          <Text style={st.previewTitle}>{schoolName || "School Name"}</Text>
          {schoolAddr ? <Text style={st.previewAddr}>{schoolAddr}</Text> : null}
          <View style={st.previewMeta}>
            <Text style={st.previewMetaTxt}>Class: {selClass?.class_name ?? "—"}</Text>
            <Text style={st.previewMetaTxt}>
              {multiSubject
                ? (selSubjectsPreview.length ? selSubjectsPreview.join(" · ") : "No subjects")
                : `Subject: ${selSubject?.subject_name ?? "—"}`}
            </Text>
            <Text style={st.previewMetaTxt}>Marks: {totalMarks || "auto"}</Text>
          </View>
          {selSession && (
            <Text style={st.previewSession}>Session: {selSession.session_name}</Text>
          )}
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      <View style={st.footer}>
        <TouchableOpacity style={st.nextBtn} onPress={handleNext} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <Text style={st.nextTxt}>{isEdit ? "Save Changes" : "Next: Add Questions"}</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Mini components ───────────────────────────────────────────────────────────
function Label({ children }) {
  return <Text style={st.label}>{children}</Text>;
}
function Input(props) {
  return <TextInput style={st.input} placeholderTextColor="#9ca3af" {...props} />;
}
function SectionHead({ icon, title }) {
  return (
    <View style={st.sectionHead}>
      <Feather name={icon} size={14} color="#2563eb" />
      <Text style={st.sectionHeadTxt}>{title}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f8fafc" },
  center:      { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll:      { padding: 16, paddingBottom: 16 },
  label:       { fontSize: 12, fontWeight: "700", color: "#374151", marginTop: 10, marginBottom: 4 },
  input:       { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0f172a" },
  textArea:    { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, fontSize: 13, color: "#0f172a", minHeight: 110 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 20, marginBottom: 4, borderBottomWidth: 1, borderColor: "#e2e8f0", paddingBottom: 6 },
  sectionHeadTxt: { fontSize: 14, fontWeight: "800", color: "#1e40af" },

  // Dropdown
  dropdown:           { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 11 },
  dropdownTxt:        { fontSize: 14, color: "#0f172a", flex: 1 },
  dropdownPlaceholder:{ color: "#9ca3af" },

  // Dropdown modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "60%", paddingBottom: Platform.OS === "ios" ? 28 : 16 },
  modalHandle:  { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginTop: 10, marginBottom: 8 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#1e293b", paddingHorizontal: 16, marginBottom: 6 },
  modalItem:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 },
  modalItemSel: { backgroundColor: "#eff6ff" },
  modalItemTxt: { fontSize: 14, color: "#374151" },
  modalItemTxtSel: { color: "#2563eb", fontWeight: "700" },
  modalSep:     { height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 16 },

  row:  { flexDirection: "row", gap: 10, marginTop: 4 },
  cell: { flex: 1 },

  // Language picker
  langRow:      { flexDirection: "row", gap: 8, marginTop: 6, marginBottom: 4 },
  langChip:     { flex: 1, alignItems: "center", paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1.5, borderColor: "#d1d5db", backgroundColor: "#fff" },
  langChipSel:  { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  langScript:   { fontSize: 16, color: "#374151", fontWeight: "700" },
  langScriptSel:{ color: "#2563eb" },
  langSub:      { fontSize: 10, color: "#9ca3af", marginTop: 2 },
  langSubSel:   { color: "#93c5fd" },

  // Preview
  previewBox:     { marginTop: 20, backgroundColor: "#1e3a8a", borderRadius: 12, padding: 14, alignItems: "center" },
  previewLogo:    { width: 52, height: 52, borderRadius: 26, marginBottom: 6, backgroundColor: "rgba(255,255,255,0.15)" },
  previewTitle:   { color: "#fff", fontSize: 15, fontWeight: "900", textAlign: "center" },
  previewAddr:    { color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center", marginTop: 2 },
  previewSession: { color: "rgba(255,255,255,0.65)", fontSize: 11, marginTop: 4 },
  previewMeta:    { flexDirection: "row", justifyContent: "space-between", marginTop: 10, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, padding: 8, alignSelf: "stretch" },
  previewMetaTxt: { color: "#fff", fontSize: 11, fontWeight: "600" },

  // Multi-subject
  multiToggle:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f0fdf4", borderRadius: 10, borderWidth: 1.5, borderColor: "#bbf7d0", padding: 12, marginTop: 10 },
  multiToggleBox:   { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  multiToggleBoxOn: { backgroundColor: "#059669", borderColor: "#059669" },
  multiToggleTxt:   { fontSize: 13, fontWeight: "700", color: "#065f46" },
  multiToggleSub:   { fontSize: 11, color: "#6b7280", marginTop: 1 },
  multiSubjectBtn:  { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 46 },
  multiSubjectPlaceholder: { fontSize: 14, color: "#9ca3af", flex: 1 },
  multiSubjectChips:{ flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  subjectChip:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#eff6ff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "#bfdbfe" },
  subjectChipTxt:   { fontSize: 12, fontWeight: "600", color: "#1d4ed8" },
  subjectChipAdd:   { width: 28, height: 28, borderRadius: 14, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center" },
  multiCheck:       { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  multiCheckOn:     { backgroundColor: "#2563eb", borderColor: "#2563eb" },

  // Footer
  footer:  { backgroundColor: "#fff", padding: 14, paddingBottom: 28, borderTopWidth: 1, borderColor: "#e2e8f0" },
  nextBtn: { backgroundColor: "#2563eb", borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  nextTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
