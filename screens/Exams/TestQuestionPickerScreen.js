/**
 * screens/Exams/TestQuestionPickerScreen.js
 * Admin picks questions from the question bank to add to a test.
 * Route params: { test, sections }
 */
import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchQuestions } from "../../services/QuestionPaperServiceApi";
import {
  getTestQuestions, addQuestions, removeQuestion, getSections,
} from "../../services/TestSeriesServiceApi";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DIFFICULTIES = ["easy", "medium", "hard"];

const DIFF_COLORS = {
  easy:   { bg: "#dcfce7", text: "#15803d" },
  medium: { bg: "#fef9c3", text: "#a16207" },
  hard:   { bg: "#fee2e2", text: "#b91c1c" },
};

const TYPE_COLORS = {
  mcq:           { bg: "#dbeafe", text: "#1d4ed8" },
  multi_correct: { bg: "#ede9fe", text: "#6d28d9" },
  integer:       { bg: "#fef3c7", text: "#92400e" },
  true_false:    { bg: "#d1fae5", text: "#065f46" },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);

function Badge({ label, colors }) {
  const c = colors ?? { bg: "#f1f5f9", text: "#374151" };
  return (
    <View style={[b.badge, { backgroundColor: c.bg }]}>
      <Text style={[b.txt, { color: c.text }]}>{label}</Text>
    </View>
  );
}

// ─── Section picker sheet ──────────────────────────────────────────────────────

function SectionSheet({ visible, sections, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={b.overlay} activeOpacity={1} onPress={onClose} />
      <View style={b.sheet}>
        <View style={b.handle} />
        <Text style={b.sheetTitle}>Select Section</Text>
        <TouchableOpacity
          style={b.sheetItem}
          onPress={() => { onSelect(null); onClose(); }}
        >
          <Text style={b.sheetItemTxt}>No section (general)</Text>
        </TouchableOpacity>
        {sections.map((s) => (
          <TouchableOpacity key={s.id} style={b.sheetItem} onPress={() => { onSelect(s); onClose(); }}>
            <Text style={b.sheetItemTxt}>{s.section_name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

// ─── Question Row ──────────────────────────────────────────────────────────────

function QuestionRow({ item, isAdded, onAdd, onRemove, defaultMarks }) {
  const [marks, setMarks] = useState(String(defaultMarks ?? 4));

  // Keep marks in sync if defaultMarks changes (section switch)
  useEffect(() => { setMarks(String(defaultMarks ?? 4)); }, [defaultMarks]);

  return (
    <View style={b.qCard}>
      <View style={b.qTop}>
        <Text style={b.qText} numberOfLines={2}>{item.question_text ?? item.text ?? "—"}</Text>
        {isAdded && <Feather name="check-circle" size={18} color="#10b981" style={{ marginLeft: 6 }} />}
      </View>

      <View style={b.qMeta}>
        <Badge label={(item.type ?? "mcq").replace("_", " ")} colors={TYPE_COLORS[item.type] ?? null} />
        <Badge label={item.difficulty ?? "medium"} colors={DIFF_COLORS[item.difficulty] ?? null} />
        {!!item.subject_name && (
          <Badge label={item.subject_name} colors={{ bg: "#f0fdf4", text: "#166534" }} />
        )}
      </View>

      {isAdded ? (
        <TouchableOpacity style={b.removeBtn} onPress={() => onRemove(item)}>
          <Feather name="minus-circle" size={13} color="#dc2626" />
          <Text style={b.removeBtnTxt}>Remove</Text>
        </TouchableOpacity>
      ) : (
        <View style={b.addRow}>
          <TextInput
            style={b.marksInput}
            placeholder="Marks"
            placeholderTextColor="#94a3b8"
            keyboardType="decimal-pad"
            value={marks}
            onChangeText={setMarks}
          />
          <TouchableOpacity
            style={b.addBtn}
            onPress={() => onAdd(item, parseFloat(marks) || 4)}
          >
            <Feather name="plus" size={14} color="#fff" />
            <Text style={b.addBtnTxt}>Add</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

const TABS = ["Bank", "Added"];

export default function TestQuestionPickerScreen({ navigation, route }) {
  const { test, series } = route.params ?? {};
  const { user } = useContext(AuthContext);

  // series_scope: 'full_syllabus' | 'chapter_wise'
  const seriesScope = series?.series_scope ?? test?.series_scope ?? "full_syllabus";
  const isChapterWise = seriesScope === "chapter_wise";

  // Sections loaded from API
  const [sections, setSections] = useState([]);

  useEffect(() => {
    if (!test?.id) return;
    getSections(user, test.id)
      .then((res) => setSections(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {/* non-critical — section picker just won't show */});
  }, [test?.id]);

  // Tab
  const [activeTab, setActiveTab] = useState("Bank");

  // Question bank
  const [bankQuestions, setBankQuestions] = useState([]);
  const [bankLoading,   setBankLoading]   = useState(false);

  // Already-in-test questions
  const [testQuestions, setTestQuestions] = useState([]);
  const [testLoading,   setTestLoading]   = useState(false);

  // Pending additions (selected but not yet sent to server)
  const [pendingAdds, setPendingAdds] = useState([]); // { question_id, marks, section_id }

  // Filters
  const [search,           setSearch]           = useState("");
  const [difficulty,       setDifficulty]       = useState("");
  const [activeSectionIdx, setActiveSectionIdx] = useState(0); // index into sections[]
  const [saving,           setSaving]           = useState(false);

  // Active section drives filtering + section_id on add
  const activeSection = sections.length > 0 ? (sections[activeSectionIdx] ?? sections[0]) : null;

  // Reset to first section when sections load
  useEffect(() => { setActiveSectionIdx(0); }, [sections]);

  // ── Chapter filter ─────────────────────────────────────────────────────────
  const [activeChapterIdx, setActiveChapterIdx] = useState(0); // 0 = "All Chapters"
  const [sectionSheetOpen, setSectionSheetOpen] = useState(false);
  const [chapterSheetOpen, setChapterSheetOpen] = useState(false);

  // Reset chapter selection when section changes
  useEffect(() => { setActiveChapterIdx(0); }, [activeSection]);

  // Derive chapter list from already-loaded bank questions for the active section.
  // This avoids a separate API call, name-matching issues, and route registration problems.
  const chapters = useMemo(() => {
    if (!activeSection) return [];
    const sectionName = (activeSection.section_name ?? activeSection.name ?? "").trim().toLowerCase();
    const seen = new Set();
    const result = [];
    bankQuestions
      .filter(q =>
        (q.subject_name ?? "").trim().toLowerCase() === sectionName &&
        q.chapter_id && q.chapter_name
      )
      .forEach(q => {
        if (!seen.has(String(q.chapter_id))) {
          seen.add(String(q.chapter_id));
          result.push({
            id:           q.chapter_id,
            chapter_name: q.chapter_name,
            chapter_no:   q.chapter_no ?? null,
          });
        }
      });
    // Sort by chapter_no, then name
    result.sort((a, b) => ((a.chapter_no ?? 999) - (b.chapter_no ?? 999)) || a.chapter_name.localeCompare(b.chapter_name));
    return result;
  }, [activeSection, bankQuestions]);

  // Active chapter (index 0 = "All", 1+ = chapters[idx-1])
  const activeChapter = activeChapterIdx === 0 ? null : (chapters[activeChapterIdx - 1] ?? null);

  // Set of question IDs already in test (server-confirmed)
  const addedIds = useMemo(
    () => new Set(testQuestions.map((q) => String(q.question_id ?? q.id))),
    [testQuestions]
  );

  // Set of question IDs pending addition
  const pendingIds = useMemo(
    () => new Set(pendingAdds.map((p) => String(p.question_id))),
    [pendingAdds]
  );

  // Per-section question count (server-confirmed + pending combined)
  const sectionCountMap = useMemo(() => {
    const map = {};
    testQuestions.forEach((q) => {
      const sId = String(q.section_id ?? "none");
      map[sId] = (map[sId] ?? 0) + 1;
    });
    pendingAdds.forEach((p) => {
      const sId = String(p.section_id ?? "none");
      map[sId] = (map[sId] ?? 0) + 1;
    });
    return map;
  }, [testQuestions, pendingAdds]);

  // Get count for a given section object
  const getSectionCount = (sec) => sectionCountMap[String(sec?.id ?? "none")] ?? 0;

  // ── Load bank ────────────────────────────────────────────────────────────────

  const loadBank = useCallback(async () => {
    if (!user) return;
    setBankLoading(true);
    try {
      const filters = {};
      if (search)     filters.keyword    = search;
      if (difficulty) filters.difficulty = difficulty;
      const data = await fetchQuestions(user, filters);
      setBankQuestions(norm(data));
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load questions");
    } finally {
      setBankLoading(false);
    }
  }, [user, search, difficulty]);

  // ── Load test questions ───────────────────────────────────────────────────────

  const loadTestQuestions = useCallback(async () => {
    if (!user || !test?.id) return;
    setTestLoading(true);
    try {
      const res = await getTestQuestions(user, test.id);
      setTestQuestions(norm(res));
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load test questions");
    } finally {
      setTestLoading(false);
    }
  }, [user, test]);

  useEffect(() => { loadBank(); }, [loadBank]);
  useEffect(() => { loadTestQuestions(); }, [loadTestQuestions]);

  // ── Debounced search ─────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => loadBank(), 400);
    return () => clearTimeout(t);
  }, [search]);

  // ── Add question (pending) ────────────────────────────────────────────────────

  const handleAdd = (item, marks) => {
    const qId = String(item.id ?? item.question_id);
    if (addedIds.has(qId) || pendingIds.has(qId)) return;

    // Enforce num_questions limit for the active section
    if (activeSection) {
      const limit = parseInt(activeSection.num_questions ?? 0) || 0;
      if (limit > 0) {
        const current = getSectionCount(activeSection);
        if (current >= limit) {
          Alert.alert(
            "Section Full",
            `"${activeSection.section_name}" allows only ${limit} question${limit !== 1 ? "s" : ""}. ` +
            `You've already added ${current}. Remove a question first or increase the section limit.`
          );
          return;
        }
      }
    }

    setPendingAdds((prev) => [
      ...prev,
      { question_id: qId, marks, section_id: activeSection?.id ?? null, _item: item },
    ]);
  };

  // ── Remove from server ────────────────────────────────────────────────────────

  const handleRemove = async (item) => {
    const tqId = item.test_question_id ?? item.id;
    Alert.alert("Remove Question", "Remove this question from the test?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try {
            await removeQuestion(user, tqId);
            loadTestQuestions();
          } catch (e) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  // ── Remove from pending ───────────────────────────────────────────────────────

  const removePending = (questionId) => {
    setPendingAdds((prev) => prev.filter((p) => String(p.question_id) !== String(questionId)));
  };

  // ── Submit pending additions ──────────────────────────────────────────────────

  const handleDone = async () => {
    if (pendingAdds.length === 0) { navigation.goBack(); return; }
    setSaving(true);
    try {
      const payload = pendingAdds.map(({ question_id, marks, section_id }) => ({
        question_id, marks, section_id,
      }));
      await addQuestions(user, test.id, payload);
      navigation.goBack();
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to add questions");
    } finally {
      setSaving(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  const renderBankItem = ({ item }) => {
    const qId = String(item.id ?? item.question_id);
    const isAdded   = addedIds.has(qId);
    const isPending = pendingIds.has(qId);

    if (isPending) {
      // Show in bank as "pending" (will be sent on Done)
      return (
        <View style={b.qCard}>
          <View style={b.qTop}>
            <Text style={b.qText} numberOfLines={2}>{item.question_text ?? item.text ?? "—"}</Text>
            <Feather name="clock" size={16} color="#f59e0b" style={{ marginLeft: 6 }} />
          </View>
          <View style={b.qMeta}>
            <Badge label={(item.type ?? "mcq").replace("_", " ")} colors={TYPE_COLORS[item.type] ?? null} />
            <Badge label={item.difficulty ?? "medium"} colors={DIFF_COLORS[item.difficulty] ?? null} />
            <Badge label="Pending" colors={{ bg: "#fef3c7", text: "#92400e" }} />
          </View>
          <TouchableOpacity style={b.removeBtn} onPress={() => removePending(qId)}>
            <Feather name="x-circle" size={13} color="#dc2626" />
            <Text style={b.removeBtnTxt}>Undo</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <QuestionRow
        item={item}
        isAdded={isAdded}
        onAdd={handleAdd}
        onRemove={() => {
          const tq = testQuestions.find((q) => String(q.question_id ?? q.id) === qId);
          if (tq) handleRemove(tq);
        }}
        defaultMarks={activeSection?.marks_per_question ?? 4}
      />
    );
  };

  const renderAddedItem = ({ item }) => {
    const displayText = item.question_text ?? item.text ?? "—";
    return (
      <View style={b.qCard}>
        <View style={b.qTop}>
          <Text style={b.qText} numberOfLines={2}>{displayText}</Text>
          <Feather name="check-circle" size={16} color="#10b981" style={{ marginLeft: 6 }} />
        </View>
        <View style={b.qMeta}>
          {!!item.marks && <Badge label={`${item.marks} marks`} colors={{ bg: "#dbeafe", text: "#1d4ed8" }} />}
          {!!item.section_name && <Badge label={item.section_name} colors={{ bg: "#f3e8ff", text: "#7c3aed" }} />}
        </View>
        <TouchableOpacity style={b.removeBtn} onPress={() => handleRemove(item)}>
          <Feather name="minus-circle" size={13} color="#dc2626" />
          <Text style={b.removeBtnTxt}>Remove</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const totalSelected = testQuestions.length + pendingAdds.length;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={b.root}>
      {/* Header */}
      <View style={b.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={b.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={b.headerTitle} numberOfLines={1}>Add Questions</Text>
          {!!test?.title && (
            <Text style={b.headerSub} numberOfLines={1}>{test.title}</Text>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={b.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[b.tab, activeTab === tab && b.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[b.tabTxt, activeTab === tab && b.tabTxtActive]}>
              {tab === "Added"
                ? `Added (${testQuestions.length + pendingAdds.length})`
                : "Question Bank"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filter bar (Bank tab only) */}
      {activeTab === "Bank" && (
        <View style={b.filterBar}>
          {/* Search */}
          <View style={b.searchBox}>
            <Feather name="search" size={14} color="#94a3b8" />
            <TextInput
              style={b.searchInput}
              placeholder="Search questions…"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Feather name="x" size={14} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Subject / Section selector */}
          {sections.length > 0 && (
            <TouchableOpacity style={b.filterDropdown} onPress={() => setSectionSheetOpen(true)}>
              <Feather name="book-open" size={14} color="#1e3a8a" style={{ marginRight: 6 }} />
              <Text style={b.filterDropdownLabel}>Subject</Text>
              <Text style={b.filterDropdownValue} numberOfLines={1}>
                {activeSection ? (activeSection.section_name ?? activeSection.name) : "Select subject"}
              </Text>
              <Feather name="chevron-down" size={14} color="#64748b" />
            </TouchableOpacity>
          )}

          {/* Capacity pill — shown when section has a num_questions limit */}
          {activeSection && (() => {
            const limit = parseInt(activeSection.num_questions ?? 0) || 0;
            if (!limit) return null;
            const count = getSectionCount(activeSection);
            const remaining = limit - count;
            const isFull = remaining <= 0;
            return (
              <View style={[b.capacityPill, isFull && b.capacityPillFull]}>
                <Feather name={isFull ? "alert-circle" : "check-circle"} size={12} color={isFull ? "#b91c1c" : "#15803d"} />
                <Text style={[b.capacityTxt, isFull && b.capacityTxtFull]}>
                  {isFull
                    ? `Section full — ${count}/${limit} questions added`
                    : `${remaining} slot${remaining !== 1 ? "s" : ""} remaining (${count}/${limit})`}
                </Text>
              </View>
            );
          })()}

          {/* Chapter selector — appears once subject is selected and has chapters */}
          {activeSection && (
            <TouchableOpacity
              style={[b.filterDropdown, { marginTop: 6 }]}
              onPress={() => setChapterSheetOpen(true)}
            >
              <Feather name="layers" size={14} color="#6366f1" style={{ marginRight: 6 }} />
              <Text style={b.filterDropdownLabel}>Chapter</Text>
              <Text style={b.filterDropdownValue} numberOfLines={1}>
                {activeChapterIdx === 0
                  ? (chapters.length > 0 ? "All chapters" : "No chapters found")
                  : `Ch.${chapters[activeChapterIdx - 1]?.chapter_no ?? ""} ${chapters[activeChapterIdx - 1]?.chapter_name ?? ""}`}
              </Text>
              {chapters.length > 0 && <Feather name="chevron-down" size={14} color="#64748b" />}
            </TouchableOpacity>
          )}

          {/* Difficulty chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[b.diffRow, { marginTop: 8 }]} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
            <TouchableOpacity
              style={[b.diffChip, !difficulty && b.diffChipSel]}
              onPress={() => setDifficulty("")}
            >
              <Text style={[b.diffChipTxt, !difficulty && b.diffChipTxtSel]}>All Levels</Text>
            </TouchableOpacity>
            {DIFFICULTIES.map((d) => (
              <TouchableOpacity
                key={d}
                style={[b.diffChip, difficulty === d && b.diffChipSel]}
                onPress={() => setDifficulty(difficulty === d ? "" : d)}
              >
                <Text style={[b.diffChipTxt, difficulty === d && b.diffChipTxtSel]}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Section picker modal */}
      <Modal visible={sectionSheetOpen} transparent animationType="slide" onRequestClose={() => setSectionSheetOpen(false)}>
        <TouchableOpacity style={b.overlay} activeOpacity={1} onPress={() => setSectionSheetOpen(false)} />
        <View style={b.sheet}>
          <View style={b.handle} />
          <Text style={b.sheetTitle}>Select Subject / Section</Text>
          {sections.map((sec, idx) => {
            const isActive = idx === activeSectionIdx;
            const count = getSectionCount(sec);
            const limit = parseInt(sec.num_questions ?? 0) || 0;
            const isFull = limit > 0 && count >= limit;
            return (
              <TouchableOpacity
                key={sec.id}
                style={[b.sheetItem, isActive && { backgroundColor: "#eff6ff" }]}
                onPress={() => { setActiveSectionIdx(idx); setSectionSheetOpen(false); }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[b.sheetItemTxt, isActive && { color: "#1e3a8a", fontWeight: "700" }]}>
                    {sec.section_name ?? sec.name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {limit > 0 && (
                      <View style={[b.secBadge, isFull && { backgroundColor: "#fee2e2" }]}>
                        <Text style={[b.secBadgeTxt, isFull && { color: "#b91c1c" }]}>
                          {count}/{limit}
                        </Text>
                      </View>
                    )}
                    {isActive && <Feather name="check" size={16} color="#1e3a8a" />}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {/* Chapter picker modal */}
      <Modal visible={chapterSheetOpen} transparent animationType="slide" onRequestClose={() => setChapterSheetOpen(false)}>
        <TouchableOpacity style={b.overlay} activeOpacity={1} onPress={() => setChapterSheetOpen(false)} />
        <View style={b.sheet}>
          <View style={b.handle} />
          <Text style={b.sheetTitle}>
            Select Chapter{activeSection ? ` — ${activeSection.section_name ?? activeSection.name}` : ""}
          </Text>
          {chapters.length === 0 ? (
            <Text style={{ color: "#9ca3af", fontSize: 14, textAlign: "center", paddingVertical: 24 }}>
              No chapters found for this subject.{"\n"}Add chapters in Setup → Chapter Management.
            </Text>
          ) : (
            <>
              <TouchableOpacity
                style={[b.sheetItem, activeChapterIdx === 0 && { backgroundColor: "#f5f3ff" }]}
                onPress={() => { setActiveChapterIdx(0); setChapterSheetOpen(false); }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[b.sheetItemTxt, activeChapterIdx === 0 && { color: "#6366f1", fontWeight: "700" }]}>
                    All Chapters
                  </Text>
                  {activeChapterIdx === 0 && <Feather name="check" size={16} color="#6366f1" />}
                </View>
              </TouchableOpacity>
              {chapters.map((ch, idx) => {
                const isActive = activeChapterIdx === idx + 1;
                return (
                  <TouchableOpacity
                    key={ch.id}
                    style={[b.sheetItem, isActive && { backgroundColor: "#f5f3ff" }]}
                    onPress={() => { setActiveChapterIdx(idx + 1); setChapterSheetOpen(false); }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={[b.sheetItemTxt, isActive && { color: "#6366f1", fontWeight: "700" }]}>
                        {ch.chapter_no ? `Ch.${ch.chapter_no}  ` : ""}{ch.chapter_name}
                      </Text>
                      {isActive && <Feather name="check" size={16} color="#6366f1" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      </Modal>

      {activeTab === "Bank" ? (
        bankLoading ? (
          <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={bankQuestions.filter(q => {
              if (activeSection && (q.subject_name ?? "").trim().toLowerCase() !== (activeSection.section_name ?? "").trim().toLowerCase()) return false;
              if (activeChapter && String(q.chapter_id ?? "") !== String(activeChapter.id ?? "")) return false;
              return true;
            })}
            keyExtractor={(item) => String(item.id ?? item.question_id)}
            renderItem={renderBankItem}
            contentContainerStyle={b.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={b.empty}>
                {activeSection
                  ? `No questions found for ${activeSection.section_name}.\nAdd questions to the bank for this subject first.`
                  : "No questions in the bank yet."}
              </Text>
            }
          />
        )
      ) : (
        testLoading ? (
          <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={[
              ...testQuestions,
              ...pendingAdds.map((p) => ({ ...p._item, _pending: true, marks: p.marks })),
            ]}
            keyExtractor={(item, i) => String(item.id ?? item.question_id ?? i)}
            renderItem={({ item }) => {
              if (item._pending) {
                return (
                  <View style={b.qCard}>
                    <View style={b.qTop}>
                      <Text style={b.qText} numberOfLines={2}>{item.question_text ?? item.text ?? "—"}</Text>
                      <Feather name="clock" size={16} color="#f59e0b" style={{ marginLeft: 6 }} />
                    </View>
                    <View style={b.qMeta}>
                      <Badge label={`${item.marks} marks`} colors={{ bg: "#dbeafe", text: "#1d4ed8" }} />
                      <Badge label="Pending" colors={{ bg: "#fef3c7", text: "#92400e" }} />
                    </View>
                    <TouchableOpacity
                      style={b.removeBtn}
                      onPress={() => removePending(item.question_id ?? item.id)}
                    >
                      <Feather name="x-circle" size={13} color="#dc2626" />
                      <Text style={b.removeBtnTxt}>Undo</Text>
                    </TouchableOpacity>
                  </View>
                );
              }
              return renderAddedItem({ item });
            }}
            contentContainerStyle={b.list}
            ListEmptyComponent={
              <Text style={b.empty}>No questions added yet. Go to Bank tab to add some.</Text>
            }
          />
        )
      )}

      {/* Bottom action bar */}
      <View style={b.bottomBar}>
        <Text style={b.bottomCount}>
          {totalSelected} question{totalSelected !== 1 ? "s" : ""} in test
          {pendingAdds.length > 0 ? ` · ${pendingAdds.length} unsaved` : ""}
        </Text>
        <TouchableOpacity
          style={[b.doneBtn, saving && { opacity: 0.7 }]}
          onPress={handleDone}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={b.doneBtnTxt}>
                {pendingAdds.length > 0 ? `Save & Done` : "Done"}
              </Text>
              <Feather name="check" size={16} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const b = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#f8fafc" },

  // Header
  header:       { backgroundColor: "#1e3a8a", paddingTop: 14, paddingBottom: 14, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn:      { padding: 4 },
  headerTitle:  { fontSize: 17, fontWeight: "900", color: "#fff" },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 1 },

  // Tabs
  tabBar:       { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#e2e8f0" },
  tab:          { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabActive:    { borderBottomWidth: 2, borderColor: "#2563eb" },
  tabTxt:       { fontSize: 13, color: "#64748b", fontWeight: "600" },
  tabTxtActive: { color: "#2563eb" },

  // Filter bar
  filterBar:    { backgroundColor: "#fff", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: "#e2e8f0" },
  searchBox:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  searchInput:  { flex: 1, fontSize: 14, color: "#0f172a" },

  // Subject / chapter dropdown rows
  filterDropdown: { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  filterDropdownLabel: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 8, minWidth: 54 },
  filterDropdownValue: { flex: 1, fontSize: 13, color: "#1e293b", fontWeight: "600" },

  // Difficulty chips
  diffRow:      { flexDirection: "row" },
  diffChip:     { borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 5, backgroundColor: "#f8fafc" },
  diffChipSel:  { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  diffChipTxt:  { fontSize: 12, color: "#374151", fontWeight: "600" },
  diffChipTxtSel:{ color: "#fff" },

  // Section badge (used in picker modal)
  secBadge:     { backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  secBadgeTxt:  { fontSize: 10, color: "#fff", fontWeight: "700" },

  // Capacity pill (filter bar)
  capacityPill:    { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#86efac", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 6, marginBottom: 2 },
  capacityPillFull:{ backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  capacityTxt:     { fontSize: 12, color: "#15803d", fontWeight: "600", flex: 1 },
  capacityTxtFull: { color: "#b91c1c" },

  // List
  list:         { padding: 12, paddingBottom: 100 },
  empty:        { textAlign: "center", color: "#9ca3af", fontSize: 14, marginTop: 60, lineHeight: 22 },

  // Question card
  qCard:        { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "#e2e8f0", elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  qTop:         { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  qText:        { flex: 1, fontSize: 13, color: "#0f172a", lineHeight: 19 },
  qMeta:        { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },

  addRow:       { flexDirection: "row", alignItems: "center", gap: 6 },
  marksInput:   { width: 60, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: "#0f172a", textAlign: "center" },
  sectionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  sectionBtnTxt:{ fontSize: 12, color: "#374151", flex: 1 },
  addBtn:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnTxt:    { fontSize: 12, color: "#fff", fontWeight: "700" },
  removeBtn:    { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "#fef2f2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  removeBtnTxt: { fontSize: 12, color: "#dc2626", fontWeight: "600" },

  // Badge
  badge:        { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  txt:          { fontSize: 10, fontWeight: "700", textTransform: "capitalize" },

  // Bottom bar
  bottomBar:    { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopWidth: 1, borderColor: "#e2e8f0", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, elevation: 8 },
  bottomCount:  { flex: 1, fontSize: 13, color: "#374151", fontWeight: "600" },
  doneBtn:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  doneBtnTxt:   { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Section sheet (inside QuestionRow)
  overlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24, paddingHorizontal: 16 },
  handle:       { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginTop: 10, marginBottom: 10 },
  sheetTitle:   { fontSize: 15, fontWeight: "800", color: "#1e293b", marginBottom: 10 },
  sheetItem:    { paddingVertical: 13, borderBottomWidth: 1, borderColor: "#f1f5f9" },
  sheetItemTxt: { fontSize: 14, color: "#374151" },
});
