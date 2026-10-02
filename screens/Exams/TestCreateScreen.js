/**
 * screens/Exams/TestCreateScreen.js
 * Admin creates or edits a single test within a series.
 * Route params: { series, test }   — test is undefined/null for new.
 */
import React, { useState, useContext, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, Switch, FlatList, Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  createTest, updateTest, publishTest,
  addSection, getSections, deleteSection,
} from "../../services/TestSeriesServiceApi";
import { fetchSubjects } from "../../services/SubjectServiceApi";

// ─── Constants ─────────────────────────────────────────────────────────────────

const NEG_OPTIONS = [
  { label: "None",     value: 0 },
  { label: "−¼",      value: -0.25 },
  { label: "−⅓",      value: -0.333 },
  { label: "−½",      value: -0.5 },
];

// ─── Section Manager Modal ─────────────────────────────────────────────────────

function SectionModal({ visible, testId, classId, onClose }) {
  const { user } = useContext(AuthContext);
  const [sections,        setSections]        = useState([]);
  const [subjects,        setSubjects]        = useState([]);
  const [loading,         setLoading]         = useState(false);
  const [selectedSubject, setSelectedSubject] = useState(null); // { subject_id, subject_name }
  const [showSubjPicker,  setShowSubjPicker]  = useState(false);
  const [secMarks,        setSecMarks]        = useState("4");
  const [secNeg,          setSecNeg]          = useState("0");
  const [secNumQ,         setSecNumQ]         = useState("30");
  const [saving,          setSaving]          = useState(false);

  const existingNames = new Set(sections.map(s => (s.section_name ?? s.name ?? "").trim().toLowerCase()));

  const load = useCallback(async () => {
    if (!testId) return;
    setLoading(true);
    try {
      const res = await getSections(user, testId);
      setSections(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [testId, user]);

  useEffect(() => {
    if (!visible || !classId || !user) return;
    fetchSubjects(user, classId)
      .then(res => {
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setSubjects(list);
      })
      .catch(() => {});
  }, [visible, classId, user]);

  useEffect(() => {
    if (visible) { load(); setSelectedSubject(null); setSecMarks("4"); setSecNeg("0"); setSecNumQ("30"); }
  }, [visible]);

  const handleAdd = async () => {
    const name = (selectedSubject?.subject_name ?? "").trim();
    if (!name) { Alert.alert("Validation", "Please select a subject."); return; }
    if (existingNames.has(name.toLowerCase())) {
      Alert.alert("Already added", `"${name}" is already a section.`); return;
    }
    setSaving(true);
    try {
      await addSection(user, {
        test_id:               testId,
        name,
        marks_per_question:    parseFloat(secMarks) || 4,
        negative_per_question: parseFloat(secNeg)   || 0,
        num_questions:         parseInt(secNumQ)    || 0,
      });
      setSelectedSubject(null);
      load();
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (sec) => {
    Alert.alert("Delete Section", `Delete "${sec.section_name ?? sec.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try { await deleteSection(user, sec.id); load(); } catch (e) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  // Available subjects = not yet added as a section
  const availableSubjects = subjects.filter(
    s => !existingNames.has((s.subject_name ?? s.name ?? "").trim().toLowerCase())
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={onClose} />
      <View style={ss.sheet}>
        <View style={ss.handle} />
        <Text style={ss.title}>Manage Sections</Text>
        <Text style={ss.subtitle}>Each section maps to a subject (e.g. Physics, Chemistry).</Text>

        {/* ── Subject dropdown ── */}
        <View style={ss.addBlock}>
          <Text style={ss.fieldLabel}>Subject (Section Name)</Text>
          <TouchableOpacity
            style={ss.selectBtn}
            onPress={() => setShowSubjPicker(true)}
            disabled={availableSubjects.length === 0}
          >
            <Feather name="book-open" size={14} color="#2563eb" />
            <Text style={[ss.selectTxt, !selectedSubject && ss.selectPlaceholder]}>
              {selectedSubject
                ? selectedSubject.subject_name
                : availableSubjects.length === 0
                  ? "All subjects already added"
                  : "Select subject…"}
            </Text>
            <Feather name="chevron-down" size={14} color="#64748b" />
          </TouchableOpacity>

          {/* Row 1: No. of Questions + Marks/Q */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={ss.fieldLabel}>No. of Questions</Text>
              <TextInput
                style={ss.input}
                placeholder="e.g. 30"
                placeholderTextColor="#94a3b8"
                value={secNumQ}
                onChangeText={setSecNumQ}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ss.fieldLabel}>Marks / Question</Text>
              <TextInput
                style={ss.input}
                placeholder="e.g. 4"
                placeholderTextColor="#94a3b8"
                value={secMarks}
                onChangeText={setSecMarks}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {/* Row 2: Neg. Marks + auto-total */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Text style={ss.fieldLabel}>Neg. Marks / Question</Text>
              <TextInput
                style={ss.input}
                placeholder="0 or -0.25"
                placeholderTextColor="#94a3b8"
                value={secNeg}
                onChangeText={setSecNeg}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1, paddingBottom: 2 }}>
              {(parseFloat(secNumQ) > 0 && parseFloat(secMarks) > 0) ? (
                <View style={ss.totalBadge}>
                  <Text style={ss.totalBadgeLabel}>Total Marks</Text>
                  <Text style={ss.totalBadgeValue}>
                    {(parseInt(secNumQ) || 0) * (parseFloat(secMarks) || 0)}
                  </Text>
                </View>
              ) : (
                <View style={[ss.totalBadge, { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" }]}>
                  <Text style={[ss.totalBadgeLabel, { color: "#94a3b8" }]}>Total Marks</Text>
                  <Text style={[ss.totalBadgeValue, { color: "#94a3b8" }]}>—</Text>
                </View>
              )}
            </View>
          </View>
          <View style={{ height: 10 }} />

          <TouchableOpacity
            style={[ss.addBtn, (!selectedSubject || saving) && { opacity: 0.5 }]}
            onPress={handleAdd}
            disabled={saving || !selectedSubject}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="plus" size={16} color="#fff" /><Text style={ss.addBtnTxt}>Add Section</Text></>
            }
          </TouchableOpacity>
        </View>

        {/* ── Existing sections list ── */}
        {loading
          ? <ActivityIndicator color="#2563eb" style={{ marginTop: 20 }} />
          : (
            <FlatList
              data={sections}
              keyExtractor={(s) => String(s.id)}
              style={{ maxHeight: 200 }}
              renderItem={({ item }) => {
                const nQ   = parseInt(item.num_questions)    || 0;
                const mPQ  = parseFloat(item.marks_per_question) || 0;
                const total = nQ * mPQ;
                return (
                  <View style={ss.secRow}>
                    <Feather name="layers" size={13} color="#6b7280" />
                    <View style={{ flex: 1 }}>
                      <Text style={ss.secName}>{item.section_name ?? item.name}</Text>
                      <Text style={ss.secMeta}>
                        {nQ > 0 ? `${nQ} Qs` : "—"} · +{mPQ} / {item.negative_per_question ?? item.negative_marks ?? 0}
                        {total > 0 ? `  ·  Total: ${total} marks` : ""}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleDelete(item)}>
                      <Feather name="trash-2" size={15} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
              ListEmptyComponent={<Text style={ss.empty}>No sections yet. Select a subject above.</Text>}
            />
          )
        }

        <TouchableOpacity style={ss.doneBtn} onPress={onClose}>
          <Text style={ss.doneBtnTxt}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* Subject picker sheet */}
      <Modal visible={showSubjPicker} transparent animationType="slide" onRequestClose={() => setShowSubjPicker(false)}>
        <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={() => setShowSubjPicker(false)} />
        <View style={ss.pickerSheet}>
          <View style={ss.handle} />
          <Text style={ss.pickerTitle}>Select Subject</Text>
          <FlatList
            data={availableSubjects}
            keyExtractor={s => String(s.subject_id ?? s.id)}
            renderItem={({ item }) => {
              const isSel = selectedSubject?.subject_id === item.subject_id;
              return (
                <TouchableOpacity
                  style={[ss.pickerItem, isSel && ss.pickerItemSel]}
                  onPress={() => { setSelectedSubject(item); setShowSubjPicker(false); }}
                >
                  <Text style={[ss.pickerItemTxt, isSel && ss.pickerItemTxtSel]}>
                    {item.subject_name ?? item.name}
                  </Text>
                  {isSel && <Feather name="check" size={15} color="#2563eb" />}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 16 }} />}
            ListEmptyComponent={<Text style={ss.empty}>No subjects available for this class.</Text>}
            style={{ maxHeight: 320 }}
          />
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function TestCreateScreen({ navigation, route }) {
  const { series, test } = route.params ?? {};
  const { user } = useContext(AuthContext);

  const isEdit = !!test;

  // Core fields
  const [title,            setTitle]            = useState(test?.title            ?? "");
  const [instructions,     setInstructions]     = useState(test?.instructions     ?? "");
  const [duration,         setDuration]         = useState(String(test?.duration_minutes   ?? "180"));
  const [totalMarks,       setTotalMarks]       = useState(String(test?.total_marks        ?? "300"));
  const [passingMarks,     setPassingMarks]     = useState(String(test?.passing_marks       ?? ""));
  const [negMarking,       setNegMarking]       = useState(parseFloat(test?.negative_marking_ratio ?? 0));
  const [randomizeQ,       setRandomizeQ]       = useState(!!test?.question_randomize);
  const [randomizeOpts,    setRandomizeOpts]    = useState(!!test?.answer_randomize);
  const [showResult,       setShowResult]       = useState(!!test?.show_result_immediately);

  // Date/time pickers
  const [schedStart,       setSchedStart]       = useState(test?.scheduled_start ? new Date(test.scheduled_start) : null);
  const [schedEnd,         setSchedEnd]         = useState(test?.scheduled_end   ? new Date(test.scheduled_end)   : null);
  const [showStartPicker,  setShowStartPicker]  = useState(false);
  const [showEndPicker,    setShowEndPicker]    = useState(false);
  const [startPickerMode,  setStartPickerMode]  = useState("date"); // "date" | "time"
  const [endPickerMode,    setEndPickerMode]    = useState("date");

  const [saving,           setSaving]           = useState(false);
  const [publishing,       setPublishing]       = useState(false);
  const [sectionModal,     setSectionModal]     = useState(false);
  const [savedTestId,      setSavedTestId]      = useState(test?.id ?? null);

  // ── Save ──────────────────────────────────────────────────────────────────────

  const handleSave = async ({ thenNavigate = false } = {}) => {
    if (!title.trim()) { Alert.alert("Validation", "Title is required."); return; }

    const payload = {
      series_id:                series?.id,
      title:                    title.trim(),
      instructions:             instructions.trim(),
      duration_minutes:         parseInt(duration)     || 180,
      total_marks:              parseInt(totalMarks)   || 300,
      passing_marks:            parseInt(passingMarks) || 0,
      negative_marking_ratio:   negMarking,
      question_randomize:       randomizeQ    ? 1 : 0,
      answer_randomize:         randomizeOpts ? 1 : 0,
      show_result_immediately:  showResult    ? 1 : 0,
      scheduled_start:          schedStart ? schedStart.toISOString() : "",
      scheduled_end:            schedEnd   ? schedEnd.toISOString()   : "",
    };

    setSaving(true);
    try {
      let resultTest;
      if (savedTestId) {
        const res = await updateTest(user, savedTestId, payload);
        resultTest = res?.data ?? { ...test, ...payload, id: savedTestId };
      } else {
        const res = await createTest(user, payload);
        resultTest = res?.data ?? { ...payload, id: res?.id };
        if (resultTest?.id) setSavedTestId(resultTest.id);
      }

      if (thenNavigate) {
        navigation.navigate("TestQuestionPicker", { test: resultTest, sections: [] });
      } else {
        Alert.alert(
          savedTestId ? "Updated" : "Test Created",
          savedTestId
            ? "Test updated successfully."
            : "Test saved! You can now manage sections and questions below, or tap Back to return to the list.",
        );
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Publish ───────────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!savedTestId) { Alert.alert("Save First", "Save the test before publishing."); return; }
    Alert.alert("Publish Test", "This will make the test visible to enrolled students. Continue?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Publish", onPress: async () => {
          setPublishing(true);
          try {
            await publishTest(user, savedTestId);
            Alert.alert("Published!", "The test is now live.", [{ text: "OK", onPress: () => navigation.goBack() }]);
          } catch (e) {
            Alert.alert("Error", e.message);
          } finally {
            setPublishing(false);
          }
        },
      },
    ]);
  };

  // ── Date Picker helpers ────────────────────────────────────────────────────────

  const formatDT = (dt) => {
    if (!dt) return "Not set";
    return dt.toLocaleDateString() + "  " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const onStartChange = (event, selectedDate) => {
    if (Platform.OS === "android") {
      if (startPickerMode === "date") {
        setShowStartPicker(false);
        if (selectedDate) {
          setSchedStart(selectedDate);
          setStartPickerMode("time");
          setTimeout(() => setShowStartPicker(true), 100);
        }
      } else {
        setShowStartPicker(false);
        setStartPickerMode("date");
        if (selectedDate) setSchedStart(selectedDate);
      }
    } else {
      if (selectedDate) setSchedStart(selectedDate);
    }
  };

  const onEndChange = (event, selectedDate) => {
    if (Platform.OS === "android") {
      if (endPickerMode === "date") {
        setShowEndPicker(false);
        if (selectedDate) {
          setSchedEnd(selectedDate);
          setEndPickerMode("time");
          setTimeout(() => setShowEndPicker(true), 100);
        }
      } else {
        setShowEndPicker(false);
        setEndPickerMode("date");
        if (selectedDate) setSchedEnd(selectedDate);
      }
    } else {
      if (selectedDate) setSchedEnd(selectedDate);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <View style={st.root}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle} numberOfLines={1}>
            {isEdit ? "Edit Test" : "New Test"}
          </Text>
          {!!series?.title && (
            <Text style={st.headerSub} numberOfLines={1}>{series.title}</Text>
          )}
        </View>
        {saving && <ActivityIndicator color="#fff" style={{ marginRight: 4 }} />}
      </View>

      <ScrollView style={st.scroll} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">

        {/* Title */}
        <Text style={st.label}>Test Title *</Text>
        <TextInput
          style={st.input}
          placeholder="e.g. Full Syllabus Mock Test 1"
          placeholderTextColor="#94a3b8"
          value={title}
          onChangeText={setTitle}
        />

        {/* Instructions */}
        <Text style={st.label}>Instructions for Students</Text>
        <TextInput
          style={[st.input, st.inputMulti]}
          placeholder="Read all questions carefully. Each correct answer carries 4 marks…"
          placeholderTextColor="#94a3b8"
          value={instructions}
          onChangeText={setInstructions}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Numeric row: Duration / Total Marks / Passing Marks */}
        <View style={st.numRow}>
          <View style={st.numField}>
            <Text style={st.label}>Duration (min)</Text>
            <TextInput
              style={st.input}
              keyboardType="number-pad"
              value={duration}
              onChangeText={setDuration}
              placeholder="180"
              placeholderTextColor="#94a3b8"
            />
          </View>
          <View style={st.numField}>
            <Text style={st.label}>Total Marks</Text>
            <TextInput
              style={st.input}
              keyboardType="number-pad"
              value={totalMarks}
              onChangeText={setTotalMarks}
              placeholder="300"
              placeholderTextColor="#94a3b8"
            />
          </View>
          <View style={st.numField}>
            <Text style={st.label}>Passing Marks</Text>
            <TextInput
              style={st.input}
              keyboardType="number-pad"
              value={passingMarks}
              onChangeText={setPassingMarks}
              placeholder="120"
              placeholderTextColor="#94a3b8"
            />
          </View>
        </View>

        {/* Negative Marking chips */}
        <Text style={st.label}>Negative Marking</Text>
        <View style={st.chipRow}>
          {NEG_OPTIONS.map((o) => {
            const isSelected = Math.abs(parseFloat(negMarking) - o.value) < 0.001;
            return (
              <TouchableOpacity
                key={o.value}
                style={[st.chip, isSelected && st.chipSel]}
                onPress={() => setNegMarking(o.value)}
              >
                <Text style={[st.chipTxt, isSelected && st.chipTxtSel]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Toggle switches */}
        <View style={st.toggleCard}>
          <ToggleRow label="Randomize Questions"       value={randomizeQ}    onChange={setRandomizeQ} />
          <View style={st.divider} />
          <ToggleRow label="Randomize Answer Options"  value={randomizeOpts} onChange={setRandomizeOpts} />
          <View style={st.divider} />
          <ToggleRow label="Show Result Immediately"   value={showResult}    onChange={setShowResult} />
        </View>

        {/* Scheduled Start */}
        <Text style={st.label}>Scheduled Start</Text>
        <TouchableOpacity
          style={st.dateBtn}
          onPress={() => { setStartPickerMode("date"); setShowStartPicker(true); }}
        >
          <Feather name="calendar" size={15} color="#2563eb" />
          <Text style={[st.dateBtnTxt, !schedStart && st.dateBtnPlaceholder]}>
            {formatDT(schedStart)}
          </Text>
          {schedStart && (
            <TouchableOpacity onPress={() => setSchedStart(null)}>
              <Feather name="x" size={14} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {/* Scheduled End */}
        <Text style={st.label}>Scheduled End</Text>
        <TouchableOpacity
          style={st.dateBtn}
          onPress={() => { setEndPickerMode("date"); setShowEndPicker(true); }}
        >
          <Feather name="calendar" size={15} color="#2563eb" />
          <Text style={[st.dateBtnTxt, !schedEnd && st.dateBtnPlaceholder]}>
            {formatDT(schedEnd)}
          </Text>
          {schedEnd && (
            <TouchableOpacity onPress={() => setSchedEnd(null)}>
              <Feather name="x" size={14} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {/* Date pickers */}
        {showStartPicker && (
          <DateTimePicker
            value={schedStart ?? new Date()}
            mode={startPickerMode}
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={onStartChange}
            minimumDate={new Date()}
          />
        )}
        {showEndPicker && (
          <DateTimePicker
            value={schedEnd ?? new Date()}
            mode={endPickerMode}
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={onEndChange}
            minimumDate={schedStart ?? new Date()}
          />
        )}

        {/* Action buttons — visible once the test has been saved */}
        {!!savedTestId && (
          <View style={st.editActions}>
            <TouchableOpacity style={st.actionBtn} onPress={() => setSectionModal(true)}>
              <Feather name="layers" size={15} color="#2563eb" />
              <Text style={st.actionBtnTxt}>Manage Sections</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={st.actionBtn}
              onPress={() => navigation.navigate("TestQuestionPicker", {
                test: isEdit ? test : { ...(test ?? {}), id: savedTestId, title },
              })}
            >
              <Feather name="list" size={15} color="#2563eb" />
              <Text style={st.actionBtnTxt}>Manage Questions</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Primary CTA row */}
        <View style={st.ctaRow}>
          <TouchableOpacity
            style={[st.saveBtn, saving && { opacity: 0.7 }]}
            onPress={() => handleSave()}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={st.saveBtnTxt}>{savedTestId ? "Update Test" : "Save Test"}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[st.qBtn, saving && { opacity: 0.7 }]}
            onPress={() => handleSave({ thenNavigate: true })}
            disabled={saving}
          >
            <Text style={st.qBtnTxt}>Save & Add Questions</Text>
            <Feather name="arrow-right" size={15} color="#2563eb" />
          </TouchableOpacity>
        </View>

        {/* Publish (edit + draft only) */}
        {isEdit && test?.status === "draft" && (
          <TouchableOpacity
            style={[st.publishBtn, publishing && { opacity: 0.7 }]}
            onPress={handlePublish}
            disabled={publishing}
          >
            {publishing
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <Feather name="upload" size={16} color="#fff" />
                  <Text style={st.publishBtnTxt}>Publish Test</Text>
                </>
              )
            }
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Section manager modal */}
      <SectionModal
        visible={sectionModal}
        testId={savedTestId}
        classId={series?.class_id ?? null}
        onClose={() => setSectionModal(false)}
      />
    </View>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <View style={st.toggleRow}>
      <Text style={st.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#e2e8f0", true: "#93c5fd" }}
        thumbColor={value ? "#2563eb" : "#f4f4f5"}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#f8fafc" },
  header:       { backgroundColor: "#1e3a8a", paddingTop: 14, paddingBottom: 14, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn:      { padding: 4 },
  headerTitle:  { fontSize: 17, fontWeight: "900", color: "#fff" },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 1 },

  scroll:       { flex: 1 },
  content:      { padding: 16 },

  label:        { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 16 },
  input:        { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, color: "#0f172a" },
  inputMulti:   { minHeight: 90, textAlignVertical: "top" },

  numRow:       { flexDirection: "row", gap: 10 },
  numField:     { flex: 1 },

  chipRow:      { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip:         { borderRadius: 20, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#fff" },
  chipSel:      { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipTxt:      { fontSize: 13, color: "#374151", fontWeight: "600" },
  chipTxtSel:   { color: "#fff" },

  toggleCard:   { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", marginTop: 16, overflow: "hidden" },
  toggleRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  toggleLabel:  { fontSize: 14, color: "#0f172a", fontWeight: "500" },
  divider:      { height: 1, backgroundColor: "#f1f5f9" },

  dateBtn:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12 },
  dateBtnTxt:   { flex: 1, fontSize: 14, color: "#0f172a" },
  dateBtnPlaceholder: { color: "#94a3b8" },

  editActions:  { flexDirection: "row", gap: 10, marginTop: 20 },
  actionBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1.5, borderColor: "#2563eb", paddingVertical: 10 },
  actionBtnTxt: { fontSize: 13, color: "#2563eb", fontWeight: "700" },

  ctaRow:       { gap: 10, marginTop: 24 },
  saveBtn:      { backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnTxt:   { color: "#fff", fontSize: 15, fontWeight: "800" },
  qBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, borderColor: "#2563eb", paddingVertical: 12 },
  qBtnTxt:      { fontSize: 14, color: "#2563eb", fontWeight: "700" },

  publishBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, backgroundColor: "#10b981", borderRadius: 12, paddingVertical: 14 },
  publishBtnTxt:{ color: "#fff", fontSize: 15, fontWeight: "800" },
});

// ─── Section Modal Styles ──────────────────────────────────────────────────────

const ss = StyleSheet.create({
  overlay:   { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: 24 },
  handle:    { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginTop: 10, marginBottom: 12 },
  title:     { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 2 },
  subtitle:  { fontSize: 12, color: "#64748b", marginBottom: 14 },
  addRow:    { flexDirection: "row", gap: 6, marginBottom: 12 },
  addBlock:  { marginBottom: 12 },
  fieldLabel:{ fontSize: 11, fontWeight: "600", color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  // Subject dropdown
  selectBtn:         { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1.5, borderColor: "#2563eb", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  selectTxt:         { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "600" },
  selectPlaceholder: { color: "#94a3b8", fontWeight: "400" },
  // Picker sheet
  pickerSheet:       { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, paddingHorizontal: 0 },
  pickerTitle:       { fontSize: 15, fontWeight: "800", color: "#1e293b", paddingHorizontal: 16, marginBottom: 8 },
  pickerItem:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 },
  pickerItemSel:     { backgroundColor: "#eff6ff" },
  pickerItemTxt:     { fontSize: 14, color: "#374151" },
  pickerItemTxtSel:  { color: "#2563eb", fontWeight: "700" },
  addBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 14, marginLeft: 6 },
  input:     { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: "#0f172a" },
  addBtn:    { backgroundColor: "#2563eb", borderRadius: 9, paddingVertical: 10, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  secRow:    { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 8 },
  secName:   { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "600" },
  secMeta:   { fontSize: 12, color: "#64748b" },
  empty:     { textAlign: "center", color: "#9ca3af", fontSize: 13, marginTop: 16, marginBottom: 8 },
  doneBtn:   { marginTop: 14, backgroundColor: "#2563eb", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  doneBtnTxt:{ color: "#fff", fontSize: 14, fontWeight: "700" },
  totalBadge:      { backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7, alignItems: "center" },
  totalBadgeLabel: { fontSize: 10, fontWeight: "600", color: "#1e3a8a", textTransform: "uppercase", letterSpacing: 0.4 },
  totalBadgeValue: { fontSize: 18, fontWeight: "900", color: "#1e3a8a", marginTop: 1 },
});
