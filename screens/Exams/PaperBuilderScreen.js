/**
 * screens/Exams/PaperBuilderScreen.js
 * Assemble questions into a paper: add from bank, reorder, set marks, preview/export.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchPaperDetail, addQuestionToPaper, removeQuestionFromPaper,
  fetchQuestions,
} from "../../services/QuestionPaperServiceApi";
import { fetchSubjects } from "../../services/SubjectServiceApi";

const TYPE_COLORS = {
  fill_blank: "#7c3aed", mcq: "#2563eb", true_false: "#0891b2",
  match: "#d97706", short: "#059669", long: "#dc2626",
  passage: "#9333ea", figure: "#c2410c",
};
const TYPE_LABELS = {
  fill_blank: "FB", mcq: "MCQ", true_false: "T/F",
  match: "Match", short: "Short", long: "Long", passage: "Pass", figure: "Fig",
};
const TYPE_FULL_LABELS = {
  mcq:        "Multiple Choice Questions",
  true_false: "True / False",
  fill_blank: "Fill in the Blanks",
  match:      "Match the Following",
  short:      "Short Answer Questions",
  long:       "Long Answer Questions",
  passage:    "Passage",
  figure:     "Diagram / Figure",
};
// Preferred display order within a subject section
const TYPE_ORDER = ["mcq","true_false","fill_blank","match","short","long","passage","figure"];

export default function PaperBuilderScreen({ navigation, route }) {
  const { paper } = route.params ?? {};
  const { user } = useContext(AuthContext);

  const [paperData,      setPaperData]      = useState(null);
  const [questions,      setQuestions]      = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [pickerOpen,     setPickerOpen]     = useState(false);
  const [editMarksId,    setEditMarksId]    = useState(null);
  const [editMarksVal,   setEditMarksVal]   = useState("");
  // Resolved subject list for the picker — properly populated even when opened from PaperListScreen
  const [pickerSubjects, setPickerSubjects] = useState([]);

  const totalMarks = questions.reduce((sum, q) => sum + (parseInt(q.marks) || 0), 0);

  // ── Resolve subjects array for the picker ─────────────────────────────────
  // Sources (priority order):
  //   1. data.subjects  — returned by updated getPaper backend
  //   2. paper.subjects — set by PaperHeaderScreen when creating a new paper
  //   3. subject_ids    — fetch subjects list and resolve names ourselves
  //   4. single subject — data.subject_id / paper.subject_id
  const resolvePickerSubjects = useCallback(async (data) => {
    // 1. Backend already resolved subjects array
    if (Array.isArray(data?.subjects) && data.subjects.length > 0) {
      setPickerSubjects(data.subjects);
      return;
    }
    // 2. Subjects passed from PaperHeaderScreen navigation
    if (Array.isArray(paper?.subjects) && paper.subjects.length > 0) {
      setPickerSubjects(paper.subjects);
      return;
    }
    // 3. We have subject_ids but no names — fetch the subjects list to resolve them
    const ids = data?.subject_ids ?? paper?.subject_ids;
    if (Array.isArray(ids) && ids.length > 0) {
      try {
        const raw = await fetchSubjects(user);
        const allSubs = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const resolved = ids
          .map(id => allSubs.find(s => String(s.subject_id) === String(id)))
          .filter(Boolean)
          .map(s => ({ subject_id: Number(s.subject_id), subject_name: s.subject_name }));
        if (resolved.length > 0) { setPickerSubjects(resolved); return; }
      } catch {}
    }
    // 4. Fallback: single subject
    const sid  = data?.subject_id  ?? paper?.subject_id;
    const name = data?.subject_name ?? paper?.subject_name;
    if (sid && name) setPickerSubjects([{ subject_id: Number(sid), subject_name: name }]);
    else             setPickerSubjects([]);
  }, [user, paper]);

  // ── Load paper detail ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!paper?.id) return;
    setLoading(true);
    try {
      const data = await fetchPaperDetail(user, paper.id);
      setPaperData(data);
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      await resolvePickerSubjects(data);
    } catch (e) {
      setPaperData(paper);
      setQuestions([]);
      await resolvePickerSubjects(null); // will fall back to paper.subjects / paper.subject_ids
    } finally {
      setLoading(false);
    }
  }, [user, paper?.id, resolvePickerSubjects]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Remove question ───────────────────────────────────────────────────────
  const handleRemove = (pqId, questionText) => {
    Alert.alert("Remove", `Remove this question from the paper?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try {
            await removeQuestionFromPaper(user, paper.id, pqId);
            load();
          } catch (e) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  // ── Inline marks edit ─────────────────────────────────────────────────────
  const openMarksEdit = (q) => { setEditMarksId(q.pq_id ?? q.id); setEditMarksVal(String(q.marks ?? "")); };
  const saveMarks     = () => { /* optimistic UI — backend call happens in picker save */ setEditMarksId(null); };

  // ── Group questions for display: subject → type ───────────────────────────
  const buildListData = useCallback(() => {
    if (!questions.length) return [];
    const isMulti = questions.some(q => q.section_label && q.section_label.trim());

    if (!isMulti) {
      // Single-subject: group by type in TYPE_ORDER
      const sorted = [...questions].sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a.type); const bi = TYPE_ORDER.indexOf(b.type);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      const items = [];
      let lastType = null; let qNum = 0;
      sorted.forEach(q => {
        qNum++;
        if (q.type !== lastType) {
          lastType = q.type;
          items.push({ _hdr: "type", label: TYPE_FULL_LABELS[q.type] ?? q.type, _key: `th_${q.type}` });
        }
        items.push({ ...q, _qNum: qNum });
      });
      return items;
    }

    // Multi-subject: collect unique subjects in first-appearance order
    const subjOrder = []; const subjMap = {};
    questions.forEach(q => {
      const s = (q.section_label || "").trim() || "General";
      if (!subjMap[s]) { subjMap[s] = []; subjOrder.push(s); }
      subjMap[s].push(q);
    });

    const items = []; let qNum = 0;
    subjOrder.forEach(subj => {
      const subjQs = subjMap[subj];
      const sorted = [...subjQs].sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a.type); const bi = TYPE_ORDER.indexOf(b.type);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      items.push({ _hdr: "subject", label: subj, count: subjQs.length, _key: `sh_${subj}` });
      let lastType = null;
      sorted.forEach(q => {
        qNum++;
        if (q.type !== lastType) {
          lastType = q.type;
          items.push({ _hdr: "type", label: TYPE_FULL_LABELS[q.type] ?? q.type, _key: `th_${subj}_${q.type}` });
        }
        items.push({ ...q, _qNum: qNum });
      });
    });
    return items;
  }, [questions]);

  // ── Render question row ───────────────────────────────────────────────────
  const renderRow = ({ item }) => {
    const tc = TYPE_COLORS[item.type] ?? "#374151";
    return (
      <View style={st.qRow}>
        <View style={st.qNumWrap}>
          <Text style={st.qNum}>{item._qNum ?? "?"}</Text>
        </View>
        <View style={st.qBody}>
          <View style={st.qTop}>
            <View style={[st.typeBadge, { backgroundColor: tc }]}>
              <Text style={st.typeTxt}>{TYPE_LABELS[item.type] ?? item.type}</Text>
            </View>
            <Text style={st.qPreview} numberOfLines={1}>{item.question_text ?? ""}</Text>
          </View>
          {/* Marks inline editor */}
          <View style={st.qBot}>
            {editMarksId === (item.pq_id ?? item.id) ? (
              <View style={st.marksEdit}>
                <TextInput
                  style={st.marksInput}
                  keyboardType="numeric"
                  value={editMarksVal}
                  onChangeText={setEditMarksVal}
                  autoFocus
                />
                <TouchableOpacity onPress={saveMarks} style={st.marksOk}>
                  <Feather name="check" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={st.marksTap} onPress={() => openMarksEdit(item)}>
                <Text style={st.marksTxt}>{item.marks ?? 0} mk</Text>
                <Feather name="edit-2" size={10} color="#6b7280" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={st.removeBtn} onPress={() => handleRemove(item.pq_id ?? item.id, item.question_text)}>
              <Feather name="x" size={16} color="#dc2626" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ── Render list item (header or question row) ─────────────────────────────
  const renderListItem = ({ item }) => {
    if (item._hdr === "subject") {
      return (
        <View style={st.subjHeader}>
          <Feather name="book-open" size={13} color="#fff" />
          <Text style={st.subjHeaderTxt}>{item.label}</Text>
          <Text style={st.subjHeaderCount}>{item.count} Q</Text>
        </View>
      );
    }
    if (item._hdr === "type") {
      return <View style={st.typeHeader}><Text style={st.typeHeaderTxt}>{item.label}</Text></View>;
    }
    return renderRow({ item });
  };

  return (
    <View style={st.root}>
      {/* Header summary */}
      <View style={st.header}>
        <Text style={st.headerTitle} numberOfLines={1}>{paperData?.title ?? paper?.title ?? "Building Paper"}</Text>
        <Text style={st.headerSub}>
          {questions.length} question{questions.length !== 1 ? "s" : ""}  ·  {totalMarks} marks
        </Text>
      </View>

      {/* Action bar */}
      <View style={st.actionBar}>
        <TouchableOpacity style={[st.actionBtn, { backgroundColor: "#475569" }]} onPress={() => navigation.navigate("PaperHeader", { paper: paperData ?? paper })}>
          <Feather name="edit-3" size={15} color="#fff" />
          <Text style={st.actionTxt}>Edit Header</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.actionBtn} onPress={() => setPickerOpen(true)}>
          <Feather name="database" size={15} color="#fff" />
          <Text style={st.actionTxt}>Add from Bank</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.actionBtn, { backgroundColor: "#059669" }]} onPress={() => navigation.navigate("AddEditQuestion", { _forPaper: paper?.id })}>
          <Feather name="plus" size={15} color="#fff" />
          <Text style={st.actionTxt}>New Question</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.actionBtn, { backgroundColor: "#7c3aed" }]} onPress={() => navigation.navigate("PaperPreview", { paper: paperData ?? paper, questions })}>
          <Feather name="eye" size={15} color="#fff" />
          <Text style={st.actionTxt}>Preview</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={buildListData()}
          keyExtractor={(item, i) => item._key ?? String(item.pq_id ?? item.id ?? i)}
          renderItem={renderListItem}
          contentContainerStyle={st.list}
          ListEmptyComponent={
            <View style={st.emptyWrap}>
              <Feather name="inbox" size={40} color="#d1d5db" />
              <Text style={st.empty}>No questions added yet.{"\n"}Use "Add from Bank" or "New Question".</Text>
            </View>
          }
        />
      )}

      {/* Bottom total bar */}
      <View style={st.totalBar}>
        <Text style={st.totalTxt}>Total: <Text style={st.totalNum}>{totalMarks} marks</Text></Text>
        <TouchableOpacity style={st.previewBtn} onPress={() => navigation.navigate("PaperPreview", { paper: paperData ?? paper, questions })}>
          <Feather name="file-text" size={15} color="#fff" />
          <Text style={st.previewTxt}>Preview & Export</Text>
        </TouchableOpacity>
      </View>

      {/* Question Picker Modal */}
      <QuestionPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        user={user}
        paperId={paper?.id}
        classId={paperData?.class_id ?? paper?.class_id}
        subjects={pickerSubjects}
        existingIds={questions.map(q => q.question_id ?? q.id)}
        onAdded={() => { setPickerOpen(false); load(); }}
      />
    </View>
  );
}

// ── Question Picker Modal ─────────────────────────────────────────────────────
// subjects = [{subject_id, subject_name}, ...] — 1 entry for single, 2+ for multi-subject
function QuestionPickerModal({ visible, onClose, user, paperId, classId, subjects = [], existingIds, onAdded }) {
  const isMulti = subjects.length > 1;
  // For multi-subject: tabs = subjects (no "All"); index 0 = subjects[0], index N = subjects[N]
  // For single-subject: no tabs, just load that subject's questions
  const [activeIdx,     setActiveIdx]     = useState(0);
  const [bankQuestions, setBankQuestions] = useState([]);
  // selected: { qId: { marks: string, subjectName: string } }
  const [selected,      setSelected]      = useState({});
  const [search,        setSearch]        = useState("");
  const [loading,       setLoading]       = useState(false);
  const [saving,        setSaving]        = useState(false);

  // activeIdx maps directly to subjects[activeIdx] for multi; subjects[0] for single
  const activeSubject = isMulti
    ? (subjects[activeIdx] ?? subjects[0] ?? null)
    : (subjects[0] ?? null);

  // Reload questions when modal opens or active subject tab changes
  useEffect(() => {
    if (!visible) { setSelected({}); setSearch(""); return; }
    const load = async () => {
      setLoading(true);
      try {
        const filters = {};
        if (classId)                    filters.class_id   = classId;
        if (activeSubject?.subject_id)  filters.subject_id = activeSubject.subject_id;
        const qs = await fetchQuestions(user, filters);
        setBankQuestions(Array.isArray(qs) ? qs : []);
      } catch {}
      finally { setLoading(false); }
    };
    load();
  }, [visible, activeIdx, classId]);

  // Reset active tab when modal opens
  useEffect(() => { if (visible) setActiveIdx(0); }, [visible]);

  const toggleSelect = (q) => {
    setSelected(prev => {
      if (prev[q.id]) { const next = { ...prev }; delete next[q.id]; return next; }
      const subjectName = activeSubject?.subject_name ?? q.subject_name ?? "";
      return { ...prev, [q.id]: { marks: String(q.marks ?? 2), subjectName } };
    });
  };

  const handleAdd = async () => {
    const entries = Object.entries(selected);
    if (!entries.length) { Alert.alert("Select questions", "Choose at least one question."); return; }
    setSaving(true);
    try {
      for (let i = 0; i < entries.length; i++) {
        const [qId, info] = entries[i];
        await addQuestionToPaper(user, paperId, {
          question_id:   parseInt(qId),
          marks:         parseInt(info.marks) || 1,
          order_index:   i + 1,
          section_label: isMulti ? info.subjectName : "",
        });
      }
      onAdded();
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = Object.keys(selected).length;
  const filtered = bankQuestions.filter(q =>
    !existingIds.includes(q.id) &&
    (!search || (q.question_text ?? "").toLowerCase().includes(search.toLowerCase()))
  );
  const currentSubjectName = activeSubject?.subject_name ?? "";
  const className = ""; // classId label not needed here

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={pm.overlay} activeOpacity={1} onPress={onClose} />
      <View style={pm.sheet}>
        <View style={pm.handle} />
        <View style={pm.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={pm.sheetTitle}>Add from Question Bank</Text>
            {selectedCount > 0 && (
              <Text style={pm.selCountTxt}>{selectedCount} question{selectedCount > 1 ? "s" : ""} selected</Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color="#374151" /></TouchableOpacity>
        </View>

        {/* Subject tabs — only shown for multi-subject papers */}
        {isMulti && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={pm.tabsRow}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
          >
            {/* One tab per subject */}
            {subjects.map((subj, idx) => {
              const isActive = idx === activeIdx;
              const countForSubj = Object.values(selected).filter(s => s.subjectName === subj.subject_name).length;
              return (
                <TouchableOpacity
                  key={subj.subject_id}
                  style={[pm.tab, isActive && pm.tabActive]}
                  onPress={() => setActiveIdx(idx)}
                >
                  <Text style={[pm.tabTxt, isActive && pm.tabTxtActive]}>{subj.subject_name}</Text>
                  {countForSubj > 0 && (
                    <View style={pm.tabBadge}><Text style={pm.tabBadgeTxt}>{countForSubj}</Text></View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Single-subject context badge */}
        {!isMulti && currentSubjectName ? (
          <View style={pm.filterBadgeRow}>
            <View style={pm.filterBadge}>
              <Feather name="book" size={10} color="#1d4ed8" />
              <Text style={pm.filterBadgeTxt}>{currentSubjectName}</Text>
            </View>
          </View>
        ) : null}

        {/* Search */}
        <View style={pm.searchRow}>
          <Feather name="search" size={15} color="#9ca3af" />
          <TextInput style={pm.searchInput} placeholder="Search questions…" placeholderTextColor="#9ca3af" value={search} onChangeText={setSearch} />
        </View>

        {loading ? <ActivityIndicator color="#2563eb" style={{ marginTop: 30 }} /> : (
          <FlatList
            data={filtered}
            keyExtractor={q => String(q.id)}
            style={pm.list}
            renderItem={({ item }) => {
              const isSel = !!selected[item.id];
              const tc = TYPE_COLORS[item.type] ?? "#374151";
              return (
                <TouchableOpacity style={[pm.qCard, isSel && pm.qCardSel]} onPress={() => toggleSelect(item)}>
                  <View style={pm.qCheck}>
                    <View style={[pm.checkbox, isSel && pm.checkboxSel]}>
                      {isSel && <Feather name="check" size={12} color="#fff" />}
                    </View>
                  </View>
                  <View style={pm.qInfo}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                      <View style={[pm.typeBadge, { backgroundColor: tc }]}>
                        <Text style={pm.typeTxt}>{TYPE_LABELS[item.type] ?? item.type}</Text>
                      </View>
                    </View>
                    <Text style={pm.qText} numberOfLines={2}>{item.question_text ?? ""}</Text>
                    {isSel && (
                      <View style={pm.marksRow}>
                        <Text style={pm.marksLabel}>Marks:</Text>
                        <TextInput
                          style={pm.marksIn}
                          keyboardType="numeric"
                          value={selected[item.id]?.marks ?? ""}
                          onChangeText={v => setSelected(prev => ({ ...prev, [item.id]: { ...prev[item.id], marks: v } }))}
                          onPress={(e) => e.stopPropagation?.()}
                        />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={pm.empty}>
                {currentSubjectName
                  ? `No questions found for ${currentSubjectName}.\nAdd questions to the bank for this subject first.`
                  : "No questions in bank yet."}
              </Text>
            }
          />
        )}
        <View style={pm.footer}>
          <TouchableOpacity style={[pm.addBtn, !selectedCount && { opacity: 0.5 }]} onPress={handleAdd} disabled={saving || !selectedCount}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={pm.addTxt}>Add {selectedCount > 0 ? `${selectedCount} Question${selectedCount > 1 ? "s" : ""}` : "Selected Questions"}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f8fafc" },
  header:      { backgroundColor: "#1e3a8a", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  headerTitle: { fontSize: 17, fontWeight: "900", color: "#fff" },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  actionBar:   { flexDirection: "row", gap: 8, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#e2e8f0" },
  actionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 9 },
  actionTxt:   { color: "#fff", fontSize: 11, fontWeight: "700" },
  list:        { padding: 14, paddingBottom: 100 },
  qRow:        { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3 },
  qNumWrap:    { width: 28, height: 28, borderRadius: 14, backgroundColor: "#1e3a8a", alignItems: "center", justifyContent: "center", marginRight: 10, flexShrink: 0, marginTop: 2 },
  qNum:        { fontSize: 12, fontWeight: "800", color: "#fff" },
  qBody:       { flex: 1 },
  qTop:        { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  typeBadge:   { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0 },
  typeTxt:     { fontSize: 9, fontWeight: "700", color: "#fff" },
  qPreview:    { flex: 1, fontSize: 13, color: "#1e293b" },
  qBot:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  marksTap:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f1f5f9", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  marksTxt:    { fontSize: 12, fontWeight: "600", color: "#374151" },
  marksEdit:   { flexDirection: "row", alignItems: "center", gap: 4 },
  marksInput:  { backgroundColor: "#eff6ff", borderRadius: 6, borderWidth: 1, borderColor: "#93c5fd", paddingHorizontal: 8, paddingVertical: 3, fontSize: 13, width: 60, color: "#0f172a" },
  marksOk:     { backgroundColor: "#2563eb", borderRadius: 6, padding: 5 },
  removeBtn:   { padding: 4 },
  emptyWrap:   { alignItems: "center", marginTop: 60, gap: 12 },
  empty:       { textAlign: "center", color: "#9ca3af", fontSize: 14, lineHeight: 22 },
  // Subject & type section headers inside the builder list
  subjHeader:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1e3a8a", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 6, marginTop: 10 },
  subjHeaderTxt:   { flex: 1, fontSize: 13, fontWeight: "800", color: "#fff" },
  subjHeaderCount: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.7)", backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  typeHeader:      { backgroundColor: "#f0f4ff", borderLeftWidth: 3, borderLeftColor: "#2563eb", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginBottom: 6, marginTop: 4 },
  typeHeaderTxt:   { fontSize: 11, fontWeight: "700", color: "#1e40af", fontStyle: "italic" },
  totalBar:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: "#e2e8f0" },
  totalTxt:    { fontSize: 14, color: "#374151" },
  totalNum:    { fontWeight: "800", color: "#1e3a8a" },
  previewBtn:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#7c3aed", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  previewTxt:  { color: "#fff", fontSize: 13, fontWeight: "700" },
});

const pm = StyleSheet.create({
  overlay:     { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%", paddingBottom: 20 },
  handle:      { width: 40, height: 4, backgroundColor: "#d1d5db", borderRadius: 2, alignSelf: "center", marginTop: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 10 },
  sheetTitle:  { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  searchRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginBottom: 8, backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#0f172a" },
  list:        { flexGrow: 0, maxHeight: 400 },
  qCard:       { flexDirection: "row", padding: 12, marginHorizontal: 14, marginBottom: 8, borderRadius: 10, borderWidth: 1.5, borderColor: "#e2e8f0" },
  qCardSel:    { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  qCheck:      { marginRight: 10, paddingTop: 2 },
  checkbox:    { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  checkboxSel: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  qInfo:       { flex: 1 },
  typeBadge:   { alignSelf: "flex-start", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 },
  typeTxt:     { fontSize: 9, fontWeight: "700", color: "#fff" },
  qText:       { fontSize: 13, color: "#1e293b", lineHeight: 18 },
  marksRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  marksLabel:  { fontSize: 12, color: "#374151", fontWeight: "600" },
  marksIn:     { backgroundColor: "#fff", borderRadius: 6, borderWidth: 1, borderColor: "#93c5fd", paddingHorizontal: 8, paddingVertical: 3, fontSize: 13, width: 55, color: "#0f172a" },
  selCountTxt:    { fontSize: 12, color: "#059669", fontWeight: "700", marginTop: 2 },
  // Subject tabs (multi-subject)
  tabsRow:        { maxHeight: 44, marginBottom: 4, borderBottomWidth: 1, borderColor: "#e2e8f0" },
  tab:            { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 0, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive:      { borderBottomColor: "#2563eb" },
  tabTxt:         { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  tabTxtActive:   { color: "#2563eb" },
  tabBadge:       { backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  tabBadgeTxt:    { fontSize: 10, fontWeight: "700", color: "#fff" },
  // Filter badge (single-subject)
  filterBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, marginBottom: 4 },
  filterBadge:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  filterBadgeTxt: { fontSize: 11, fontWeight: "600", color: "#1d4ed8" },
  empty:       { textAlign: "center", color: "#9ca3af", fontSize: 13, padding: 30, lineHeight: 20 },
  footer:      { padding: 14 },
  addBtn:      { backgroundColor: "#2563eb", borderRadius: 12, alignItems: "center", paddingVertical: 13 },
  addTxt:      { color: "#fff", fontSize: 14, fontWeight: "700" },
});
