/**
 * screens/Exams/QuestionBankScreen.js
 * Browse, search, filter, and manage the school's question bank.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchQuestions, deleteQuestion } from "../../services/QuestionPaperServiceApi";
import { fetchClasses } from "../../services/SetupServiceApi";
import { fetchSubjects } from "../../services/SubjectServiceApi";
import { fetchChapters } from "../../services/TestSeriesServiceApi";

const TYPE_LABELS = {
  fill_blank: "Fill Blanks",
  mcq:        "MCQ",
  true_false: "True/False",
  match:      "Match",
  short:      "Short Ans",
  long:       "Long Ans",
  passage:    "Passage",
  figure:     "Figure",
};
const TYPE_COLORS = {
  fill_blank: "#7c3aed", mcq: "#2563eb", true_false: "#0891b2",
  match: "#d97706",      short: "#059669", long: "#dc2626",
  passage: "#9333ea",    figure: "#c2410c",
};
const DIFFICULTIES = ["", "easy", "medium", "hard"];

export default function QuestionBankScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [questions,   setQuestions]   = useState([]);
  const [classes,     setClasses]     = useState([]);
  const [subjects,    setSubjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [filterClass,   setFilterClass]   = useState("");
  const [filterSub,     setFilterSub]     = useState("");
  const [filterChapter, setFilterChapter] = useState("");
  const [filterType,    setFilterType]    = useState("");
  const [filterDiff,    setFilterDiff]    = useState("");
  const [filterOpen,    setFilterOpen]    = useState(false);
  const [chapters,      setChapters]      = useState([]);

  // ── Load chapters when class + subject both set ───────────────────────────
  useEffect(() => {
    setFilterChapter("");
    if (!filterClass || !filterSub) { setChapters([]); return; }
    fetchChapters(user, filterClass, filterSub)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [user, filterClass, filterSub]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [qs, cls, subs] = await Promise.all([
        fetchQuestions(user, {
          class_id:   filterClass,
          subject_id: filterSub,
          chapter_id: filterChapter,
          type:       filterType,
          difficulty: filterDiff,
          keyword:    search,
        }),
        fetchClasses(user),
        fetchSubjects(user),
      ]);
      setQuestions(Array.isArray(qs)   ? qs   : []);
      setClasses  (Array.isArray(cls)  ? cls  : []);
      setSubjects (Array.isArray(subs) ? subs : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load questions");
    } finally {
      setLoading(false);
    }
  }, [user, filterClass, filterSub, filterChapter, filterType, filterDiff, search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert("Delete Question", "Remove this question from the bank?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteQuestion(user, item.id);
            load();
          } catch (e) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  // ── Active filter count ───────────────────────────────────────────────────
  const activeFilters = [filterClass, filterSub, filterChapter, filterType, filterDiff].filter(Boolean).length;

  // ── Render ────────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }) => {
    const typeColor = TYPE_COLORS[item.type] ?? "#374151";
    return (
      <TouchableOpacity
        style={st.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate("AddEditQuestion", { question: item })}
      >
        {/* Row 1: number + type badge + marks */}
        <View style={st.cardTop}>
          <Text style={st.qNum}>Q{index + 1}.</Text>
          <View style={[st.typeBadge, { backgroundColor: typeColor }]}>
            <Text style={st.typeText}>{TYPE_LABELS[item.type] ?? item.type}</Text>
          </View>
          {item.difficulty ? (
            <View style={[st.diffBadge, { backgroundColor: item.difficulty === "easy" ? "#d1fae5" : item.difficulty === "hard" ? "#fee2e2" : "#fef9c3" }]}>
              <Text style={[st.diffText, { color: item.difficulty === "easy" ? "#065f46" : item.difficulty === "hard" ? "#991b1b" : "#854d0e" }]}>
                {item.difficulty}
              </Text>
            </View>
          ) : null}
          <Text style={st.marks}>{item.marks ?? 0} mk</Text>
        </View>
        {/* Row 2: question preview */}
        <Text style={st.qPreview} numberOfLines={2}>{item.question_text ?? ""}</Text>
        {/* Row 3: chapter + edit/delete */}
        <View style={st.cardBot}>
          {(item.chapter_name || item.chapter)
            ? <Text style={st.chapterTag}>📘 {item.chapter_name ?? item.chapter}</Text>
            : <View />}
          <View style={st.actions}>
            <TouchableOpacity style={st.editBtn} onPress={() => navigation.navigate("AddEditQuestion", { question: item })}>
              <Feather name="edit-2" size={14} color="#2563eb" />
              <Text style={st.editTxt}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.delBtn} onPress={() => handleDelete(item)}>
              <Feather name="trash-2" size={14} color="#dc2626" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={st.root}>
      {/* Search bar */}
      <View style={st.searchRow}>
        <View style={st.searchBox}>
          <Feather name="search" size={16} color="#9ca3af" style={{ marginRight: 6 }} />
          <TextInput
            style={st.searchInput}
            placeholder="Search questions…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={load}
          />
          {search ? (
            <TouchableOpacity onPress={() => { setSearch(""); }}>
              <Feather name="x" size={15} color="#9ca3af" />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={[st.filterBtn, activeFilters > 0 && st.filterBtnActive]}
          onPress={() => setFilterOpen(true)}
        >
          <Feather name="filter" size={16} color={activeFilters > 0 ? "#fff" : "#374151"} />
          {activeFilters > 0 && <Text style={st.filterCount}>{activeFilters}</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={st.importBtn}
          onPress={() => navigation.navigate("ImportQuestions")}
        >
          <Feather name="upload" size={16} color="#2563eb" />
        </TouchableOpacity>
      </View>

      {/* Active filter chips */}
      {activeFilters > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chipRow} contentContainerStyle={{ paddingHorizontal: 14, gap: 6 }}>
          {filterClass   && <Chip label={`Class: ${classes.find(c => String(c.class_id) === String(filterClass))?.class_name ?? filterClass}`} onRemove={() => setFilterClass("")} />}
          {filterSub     && <Chip label={`Sub: ${subjects.find(s => String(s.subject_id) === String(filterSub))?.subject_name ?? filterSub}`} onRemove={() => setFilterSub("")} />}
          {filterChapter && <Chip label={`Ch: ${chapters.find(ch => String(ch.id) === String(filterChapter))?.chapter_name ?? filterChapter}`} onRemove={() => setFilterChapter("")} />}
          {filterType    && <Chip label={TYPE_LABELS[filterType] ?? filterType} onRemove={() => setFilterType("")} />}
          {filterDiff    && <Chip label={filterDiff} onRemove={() => setFilterDiff("")} />}
        </ScrollView>
      )}

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={questions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={st.list}
          ListEmptyComponent={<Text style={st.empty}>No questions found.{"\n"}Add one using the + button.</Text>}
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={st.fab} onPress={() => navigation.navigate("AddEditQuestion", {})}>
        <Feather name="plus" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Filter Modal */}
      <FilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        classes={classes}
        subjects={subjects}
        chapters={chapters}
        filterClass={filterClass}     setFilterClass={setFilterClass}
        filterSub={filterSub}         setFilterSub={setFilterSub}
        filterChapter={filterChapter} setFilterChapter={setFilterChapter}
        filterType={filterType}       setFilterType={setFilterType}
        filterDiff={filterDiff}       setFilterDiff={setFilterDiff}
        onApply={() => { setFilterOpen(false); load(); }}
        onClear={() => { setFilterClass(""); setFilterSub(""); setFilterChapter(""); setFilterType(""); setFilterDiff(""); setFilterOpen(false); }}
      />
    </View>
  );
}

function Chip({ label, onRemove }) {
  return (
    <View style={st.chip}>
      <Text style={st.chipTxt}>{label}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
        <Feather name="x" size={12} color="#1e40af" />
      </TouchableOpacity>
    </View>
  );
}

function FilterModal({ visible, onClose, classes, subjects, chapters, filterClass, setFilterClass, filterSub, setFilterSub, filterChapter, setFilterChapter, filterType, setFilterType, filterDiff, setFilterDiff, onApply, onClear }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.sheetHandle} />
        <Text style={st.sheetTitle}>Filter Questions</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          <FilterSection title="Class">
            {[{ class_id: "", class_name: "All Classes" }, ...classes].map(c => (
              <FilterChip key={String(c.class_id)} label={c.class_name} selected={String(filterClass) === String(c.class_id)} onPress={() => setFilterClass(c.class_id ? String(c.class_id) : "")} />
            ))}
          </FilterSection>
          <FilterSection title="Subject">
            {[{ subject_id: "", subject_name: "All Subjects" }, ...subjects].map(s => (
              <FilterChip key={String(s.subject_id)} label={s.subject_name} selected={String(filterSub) === String(s.subject_id)} onPress={() => setFilterSub(s.subject_id ? String(s.subject_id) : "")} />
            ))}
          </FilterSection>
          {chapters.length > 0 && (
            <FilterSection title="Chapter">
              {[{ id: "", chapter_name: "All Chapters" }, ...chapters].map(ch => (
                <FilterChip
                  key={String(ch.id)}
                  label={ch.chapter_name}
                  selected={String(filterChapter) === String(ch.id)}
                  onPress={() => setFilterChapter(ch.id ? String(ch.id) : "")}
                />
              ))}
            </FilterSection>
          )}
          <FilterSection title="Question Type">
            {[["", "All Types"], ...Object.entries(TYPE_LABELS)].map(([k, v]) => (
              <FilterChip key={k} label={v} selected={filterType === k} onPress={() => setFilterType(k)} />
            ))}
          </FilterSection>
          <FilterSection title="Difficulty">
            {DIFFICULTIES.map(d => (
              <FilterChip key={d} label={d || "All Levels"} selected={filterDiff === d} onPress={() => setFilterDiff(d)} />
            ))}
          </FilterSection>
        </ScrollView>
        <View style={st.sheetBtns}>
          <TouchableOpacity style={st.clearBtn} onPress={onClear}><Text style={st.clearTxt}>Clear All</Text></TouchableOpacity>
          <TouchableOpacity style={st.applyBtn} onPress={onApply}><Text style={st.applyTxt}>Apply Filters</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function FilterSection({ title, children }) {
  return (
    <View style={st.filterSec}>
      <Text style={st.filterSecTitle}>{title}</Text>
      <View style={st.filterChips}>{children}</View>
    </View>
  );
}

function FilterChip({ label, selected, onPress }) {
  return (
    <TouchableOpacity style={[st.fChip, selected && st.fChipSel]} onPress={onPress}>
      <Text style={[st.fChipTxt, selected && st.fChipTxtSel]}>{label}</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#f8fafc" },
  header:       { backgroundColor: "#1e3a8a", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 },
  headerTitle:  { fontSize: 20, fontWeight: "900", color: "#fff" },
  headerSub:    { fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  searchRow:    { flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginTop: 12, marginBottom: 6, gap: 8 },
  searchBox:    { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4 },
  searchInput:  { flex: 1, fontSize: 14, color: "#0f172a" },
  filterBtn:    { width: 42, height: 42, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 2 },
  filterBtnActive: { backgroundColor: "#2563eb" },
  importBtn:    { width: 42, height: 42, borderRadius: 10, backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe", alignItems: "center", justifyContent: "center", marginLeft: 6 },
  filterCount:  { color: "#fff", fontSize: 10, fontWeight: "700", marginLeft: 2 },
  chipRow:      { marginBottom: 4, flexGrow: 0 },
  chip:         { flexDirection: "row", alignItems: "center", backgroundColor: "#dbeafe", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  chipTxt:      { fontSize: 12, color: "#1e40af", fontWeight: "600" },
  list:         { padding: 14, paddingBottom: 90 },
  card:         { backgroundColor: "#fff", borderRadius: 12, padding: 13, marginBottom: 10, elevation: 2, shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 4 },
  cardTop:      { flexDirection: "row", alignItems: "center", marginBottom: 6, gap: 6 },
  qNum:         { fontSize: 13, fontWeight: "800", color: "#374151", minWidth: 24 },
  typeBadge:    { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  typeText:     { fontSize: 10, fontWeight: "700", color: "#fff" },
  diffBadge:    { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  diffText:     { fontSize: 10, fontWeight: "600" },
  marks:        { marginLeft: "auto", fontSize: 12, fontWeight: "700", color: "#374151" },
  qPreview:     { fontSize: 13, color: "#1e293b", lineHeight: 19, marginBottom: 8 },
  cardBot:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chapterTag:   { fontSize: 11, color: "#6b7280", fontStyle: "italic" },
  actions:      { flexDirection: "row", alignItems: "center", gap: 8 },
  editBtn:      { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  editTxt:      { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  delBtn:       { backgroundColor: "#fef2f2", borderRadius: 6, padding: 5 },
  empty:        { textAlign: "center", color: "#9ca3af", fontSize: 14, marginTop: 60, lineHeight: 22 },
  fab:          { position: "absolute", right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", elevation: 5 },
  // Filter modal
  overlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", paddingBottom: 30 },
  sheetHandle:  { width: 40, height: 4, backgroundColor: "#d1d5db", borderRadius: 2, alignSelf: "center", marginTop: 10 },
  sheetTitle:   { fontSize: 17, fontWeight: "800", color: "#0f172a", marginHorizontal: 18, marginVertical: 12 },
  filterSec:    { marginHorizontal: 18, marginBottom: 14 },
  filterSecTitle: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  filterChips:  { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  fChip:        { borderRadius: 20, borderWidth: 1, borderColor: "#d1d5db", paddingHorizontal: 12, paddingVertical: 5 },
  fChipSel:     { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  fChipTxt:     { fontSize: 13, color: "#374151" },
  fChipTxtSel:  { color: "#fff", fontWeight: "700" },
  sheetBtns:    { flexDirection: "row", gap: 10, marginHorizontal: 18, marginTop: 10 },
  clearBtn:     { flex: 1, borderRadius: 10, borderWidth: 1.5, borderColor: "#d1d5db", alignItems: "center", paddingVertical: 12 },
  clearTxt:     { fontSize: 14, color: "#374151", fontWeight: "600" },
  applyBtn:     { flex: 2, borderRadius: 10, backgroundColor: "#2563eb", alignItems: "center", paddingVertical: 12 },
  applyTxt:     { fontSize: 14, color: "#fff", fontWeight: "700" },
});
