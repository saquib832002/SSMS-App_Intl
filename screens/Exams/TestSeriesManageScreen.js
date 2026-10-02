/**
 * screens/Exams/TestSeriesManageScreen.js
 * Admin: List, create, edit, and delete Test Series.
 * Tapping "Manage Tests →" navigates to TestManageScreen.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, TextInput,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getSeriesList, createSeries, updateSeries, deleteSeries,
} from "../../services/TestSeriesServiceApi";
import { fetchBranches, fetchSessions, fetchClasses } from "../../services/SetupServiceApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);

const EXAM_TYPES = ["JEE", "NEET", "General", "Custom"];

const EXAM_TYPE_COLORS = {
  JEE:     { bg: "#dbeafe", text: "#1d4ed8" },
  NEET:    { bg: "#dcfce7", text: "#15803d" },
  General: { bg: "#fef9c3", text: "#a16207" },
  Custom:  { bg: "#f3e8ff", text: "#7c3aed" },
};

function ExamTypeBadge({ type }) {
  const c = EXAM_TYPE_COLORS[type] ?? { bg: "#f1f5f9", text: "#374151" };
  return (
    <View style={[st.badge, { backgroundColor: c.bg }]}>
      <Text style={[st.badgeTxt, { color: c.text }]}>{type ?? "—"}</Text>
    </View>
  );
}

// ─── Inline bottom-sheet picker ────────────────────────────────────────────────

function SheetPicker({ visible, title, items, labelKey, valueKey, selected, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.sheetHandle} />
        <Text style={st.sheetTitle}>{title}</Text>
        <FlatList
          data={items}
          keyExtractor={(i) => String(i[valueKey])}
          renderItem={({ item }) => {
            const isSel = String(item[valueKey]) === String(selected);
            return (
              <TouchableOpacity
                style={[st.sheetItem, isSel && st.sheetItemSel]}
                onPress={() => { onSelect(item); onClose(); }}
              >
                <Text style={[st.sheetItemTxt, isSel && st.sheetItemTxtSel]}>
                  {item[labelKey]}
                </Text>
                {isSel && <Feather name="check" size={15} color="#2563eb" />}
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={st.sheetSep} />}
        />
      </View>
    </Modal>
  );
}

// ─── Create / Edit Modal ───────────────────────────────────────────────────────

// ─── Scope options ─────────────────────────────────────────────────────────────

const SCOPE_OPTIONS = [
  { value: "full_syllabus", label: "Full Syllabus",  icon: "book",    desc: "All questions for the subject" },
  { value: "chapter_wise",  label: "Chapter-wise",   icon: "layers",  desc: "Filter questions by chapter" },
];

function SeriesFormModal({ visible, initial, branches, sessions, classes, onSave, onClose }) {
  const [title,        setTitle]        = useState("");
  const [description,  setDescription]  = useState("");
  const [examType,     setExamType]     = useState("General");
  const [seriesScope,  setSeriesScope]  = useState("full_syllabus");
  const [branch,       setBranch]       = useState(null);
  const [session,      setSession]      = useState(null);
  const [cls,          setCls]          = useState(null);
  const [saving,       setSaving]       = useState(false);

  const [pickerTarget, setPickerTarget] = useState(null); // "branch" | "session" | "class"

  useEffect(() => {
    if (visible) {
      setTitle(initial?.title ?? "");
      setDescription(initial?.description ?? "");
      setExamType(initial?.exam_type ?? "General");
      setSeriesScope(initial?.series_scope ?? "full_syllabus");
      setBranch(initial?.branch_id
        ? branches.find((b) => String(b.branch_id) === String(initial.branch_id)) ?? null
        : null);
      setSession(initial?.session_id
        ? sessions.find((s) => String(s.session_id) === String(initial.session_id)) ?? null
        : null);
      setCls(initial?.class_id
        ? classes.find((c) => String(c.class_id) === String(initial.class_id)) ?? null
        : null);
      setSaving(false);
    }
  }, [visible, initial]);

  const handleSave = async () => {
    if (!title.trim()) { Alert.alert("Validation", "Title is required."); return; }
    setSaving(true);
    try {
      await onSave({
        title:        title.trim(),
        description:  description.trim(),
        exam_type:    examType,
        series_scope: seriesScope,
        branch_id:    branch?.branch_id ?? "",
        session_id:   session?.session_id ?? "",
        class_id:     cls?.class_id ?? "",
      });
    } finally {
      setSaving(false);
    }
  };

  const pickerProps = {
    branch:  { title: "Select Branch",  items: branches, labelKey: "branch_name",  valueKey: "branch_id",  selected: branch?.branch_id,   onSelect: setBranch },
    session: { title: "Select Session", items: sessions, labelKey: "session_name", valueKey: "session_id", selected: session?.session_id, onSelect: setSession },
    class:   { title: "Select Class",   items: classes,  labelKey: "class_name",   valueKey: "class_id",   selected: cls?.class_id,        onSelect: setCls },
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.modalWrap}>
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />
        <View style={st.formSheet}>
          <View style={st.sheetHandle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={st.formTitle}>{initial ? "Edit Series" : "New Test Series"}</Text>

            {/* Title */}
            <Text style={st.label}>Title *</Text>
            <TextInput
              style={st.input}
              placeholder="e.g. JEE Mains 2025 Full Course"
              placeholderTextColor="#94a3b8"
              value={title}
              onChangeText={setTitle}
            />

            {/* Description */}
            <Text style={st.label}>Description</Text>
            <TextInput
              style={[st.input, st.inputMulti]}
              placeholder="Brief description of this series…"
              placeholderTextColor="#94a3b8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Exam Type chips */}
            <Text style={st.label}>Exam Type</Text>
            <View style={st.chipRow}>
              {EXAM_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[st.chip, examType === t && st.chipSel]}
                  onPress={() => setExamType(t)}
                >
                  <Text style={[st.chipTxt, examType === t && st.chipTxtSel]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Series Scope */}
            <Text style={st.label}>Series Type</Text>
            <View style={st.scopeRow}>
              {SCOPE_OPTIONS.map((opt) => {
                const isSel = seriesScope === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[st.scopeCard, isSel && st.scopeCardSel]}
                    onPress={() => setSeriesScope(opt.value)}
                  >
                    <Feather name={opt.icon} size={16} color={isSel ? "#2563eb" : "#64748b"} />
                    <Text style={[st.scopeLabel, isSel && st.scopeLabelSel]}>{opt.label}</Text>
                    <Text style={st.scopeDesc}>{opt.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Branch */}
            <Text style={st.label}>Branch</Text>
            <TouchableOpacity style={st.selectBtn} onPress={() => setPickerTarget("branch")}>
              <Feather name="git-branch" size={14} color="#64748b" />
              <Text style={[st.selectTxt, !branch && st.selectPlaceholder]}>
                {branch ? branch.branch_name : "Select branch…"}
              </Text>
              <Feather name="chevron-down" size={14} color="#64748b" />
            </TouchableOpacity>

            {/* Session */}
            <Text style={st.label}>Session</Text>
            <TouchableOpacity style={st.selectBtn} onPress={() => setPickerTarget("session")}>
              <Feather name="calendar" size={14} color="#64748b" />
              <Text style={[st.selectTxt, !session && st.selectPlaceholder]}>
                {session ? session.session_name : "Select session…"}
              </Text>
              <Feather name="chevron-down" size={14} color="#64748b" />
            </TouchableOpacity>

            {/* Class */}
            <Text style={st.label}>Class</Text>
            <TouchableOpacity style={st.selectBtn} onPress={() => setPickerTarget("class")}>
              <Feather name="book-open" size={14} color="#64748b" />
              <Text style={[st.selectTxt, !cls && st.selectPlaceholder]}>
                {cls ? cls.class_name : "Select class…"}
              </Text>
              <Feather name="chevron-down" size={14} color="#64748b" />
            </TouchableOpacity>

            {/* Buttons */}
            <View style={st.formBtnRow}>
              <TouchableOpacity style={st.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={st.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={st.saveBtnTxt}>{initial ? "Update Series" : "Create Series"}</Text>
                }
              </TouchableOpacity>
            </View>
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>

      {/* Nested pickers */}
      {pickerTarget && pickerProps[pickerTarget] && (
        <SheetPicker
          visible={!!pickerTarget}
          title={pickerProps[pickerTarget].title}
          items={pickerProps[pickerTarget].items}
          labelKey={pickerProps[pickerTarget].labelKey}
          valueKey={pickerProps[pickerTarget].valueKey}
          selected={pickerProps[pickerTarget].selected}
          onSelect={pickerProps[pickerTarget].onSelect}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </Modal>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function TestSeriesManageScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [series,   setSeries]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [branches, setBranches] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [classes,  setClasses]  = useState([]);

  const [formVisible, setFormVisible] = useState(false);
  const [editTarget,  setEditTarget]  = useState(null); // null = create

  // Load dropdown options once
  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetchBranches(user).catch(() => []),
      fetchSessions(user).catch(() => []),
      fetchClasses(user).catch(() => []),
    ]).then(([br, se, cl]) => {
      setBranches(norm(br));
      setSessions(norm(se));
      setClasses(norm(cl));
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await getSeriesList(user);
      setSeries(norm(res) ?? []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load test series");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openCreate = () => { setEditTarget(null); setFormVisible(true); };
  const openEdit   = (item) => { setEditTarget(item); setFormVisible(true); };

  const handleSave = async (data) => {
    try {
      if (editTarget) {
        await updateSeries(user, editTarget.id, data);
      } else {
        await createSeries(user, data);
      }
      setFormVisible(false);
      load();
    } catch (e) {
      Alert.alert("Error", e.message || "Save failed");
      throw e; // re-throw so modal keeps spinner off
    }
  };

  const handleDelete = (item) => {
    Alert.alert(
      "Delete Series",
      `Delete "${item.title}"? All tests inside will also be removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteSeries(user, item.id);
              load();
            } catch (e) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
    <View style={st.card}>
      <View style={st.cardTop}>
        <Text style={st.cardTitle} numberOfLines={1}>{item.title}</Text>
        <ExamTypeBadge type={item.exam_type} />
      </View>

      {!!item.description && (
        <Text style={st.cardDesc} numberOfLines={2}>{item.description}</Text>
      )}

      <View style={st.metaRow}>
        {!!item.test_count && (
          <MetaTag icon="file-text" label={`${item.test_count} test${item.test_count !== 1 ? "s" : ""}`} />
        )}
        {item.series_scope === "chapter_wise" && (
          <MetaTag icon="layers" label="Chapter-wise" color="#6366f1" />
        )}
        {!!item.branch_name   && <MetaTag icon="git-branch" label={item.branch_name} />}
        {!!item.session_name  && <MetaTag icon="calendar"   label={item.session_name} />}
        {!!item.class_name    && <MetaTag icon="book-open"  label={item.class_name} />}
        {!!item.series_start && (
          <MetaTag icon="play" label={`Starts ${new Date(item.series_start).toLocaleDateString()}`} />
        )}
        {!!item.series_end && (
          <MetaTag icon="stop-circle" label={`Ends ${new Date(item.series_end).toLocaleDateString()}`} />
        )}
        {!item.series_start && !!item.created_at && (
          <MetaTag icon="clock" label={`Created ${new Date(item.created_at).toLocaleDateString()}`} />
        )}
      </View>

      <View style={st.cardBtns}>
        <TouchableOpacity
          style={st.manageBtn}
          onPress={() => navigation.navigate("TestManage", { series: item })}
        >
          <Feather name="list" size={13} color="#2563eb" />
          <Text style={st.manageBtnTxt}>Manage Tests</Text>
          <Feather name="arrow-right" size={13} color="#2563eb" />
        </TouchableOpacity>

        <View style={st.iconBtns}>
          <TouchableOpacity style={st.iconBtn} onPress={() => openEdit(item)}>
            <Feather name="edit-2" size={15} color="#2563eb" />
          </TouchableOpacity>
          <TouchableOpacity style={[st.iconBtn, st.iconBtnRed]} onPress={() => handleDelete(item)}>
            <Feather name="trash-2" size={15} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={st.root}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Test Series</Text>
          <Text style={st.headerSub}>{series.length} series</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={series}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={st.list}
          ListEmptyComponent={
            <Text style={st.empty}>{"No test series yet.\nTap + to create your first series."}</Text>
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={st.fab} onPress={openCreate}>
        <Feather name="plus" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Create / Edit modal */}
      <SeriesFormModal
        visible={formVisible}
        initial={editTarget}
        branches={branches}
        sessions={sessions}
        classes={classes}
        onSave={handleSave}
        onClose={() => setFormVisible(false)}
      />
    </View>
  );
}

function MetaTag({ icon, label, color }) {
  const c = color ?? "#6b7280";
  return (
    <View style={[st.metaTag, color && { backgroundColor: "#ede9fe" }]}>
      <Feather name={icon} size={11} color={c} />
      <Text style={[st.metaTagTxt, color && { color: c, fontWeight: "700" }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#f8fafc" },
  header:       { backgroundColor: "#1e3a8a", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:      { padding: 4 },
  headerTitle:  { fontSize: 20, fontWeight: "900", color: "#fff" },
  headerSub:    { fontSize: 13, color: "rgba(255,255,255,0.65)", marginTop: 1 },

  list:         { padding: 14, paddingBottom: 90 },
  empty:        { textAlign: "center", color: "#9ca3af", fontSize: 14, marginTop: 60, lineHeight: 22 },

  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, elevation: 2, shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 4 },
  cardTop:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  cardTitle:    { flex: 1, fontSize: 15, fontWeight: "800", color: "#0f172a", marginRight: 8 },
  cardDesc:     { fontSize: 13, color: "#64748b", marginBottom: 8, lineHeight: 18 },

  badge:        { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt:     { fontSize: 11, fontWeight: "700" },

  metaRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  metaTag:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f1f5f9", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  metaTagTxt:   { fontSize: 11, color: "#374151" },

  cardBtns:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  manageBtn:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, borderWidth: 1, borderColor: "#2563eb", paddingHorizontal: 10, paddingVertical: 7 },
  manageBtnTxt: { fontSize: 12, color: "#2563eb", fontWeight: "700" },
  iconBtns:     { flexDirection: "row", gap: 8 },
  iconBtn:      { backgroundColor: "#eff6ff", borderRadius: 8, padding: 7 },
  iconBtnRed:   { backgroundColor: "#fef2f2" },

  fab:          { position: "absolute", right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", elevation: 6 },

  // Modal / sheet
  modalWrap:    { flex: 1, justifyContent: "flex-end" },
  overlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60%", paddingBottom: 20 },
  formSheet:    { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%", paddingHorizontal: 18, paddingBottom: 20 },
  sheetHandle:  { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginTop: 10, marginBottom: 10 },
  sheetTitle:   { fontSize: 15, fontWeight: "800", color: "#1e293b", paddingHorizontal: 16, marginBottom: 8 },
  sheetItem:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 },
  sheetItemSel: { backgroundColor: "#eff6ff" },
  sheetItemTxt: { fontSize: 14, color: "#374151" },
  sheetItemTxtSel: { color: "#2563eb", fontWeight: "700" },
  sheetSep:     { height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 16 },

  // Form
  formTitle:    { fontSize: 17, fontWeight: "900", color: "#0f172a", marginBottom: 16, marginTop: 4 },
  label:        { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 14 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0f172a" },
  inputMulti:   { minHeight: 72 },
  chipRow:      { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip:         { borderRadius: 20, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#f8fafc" },
  chipSel:      { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipTxt:      { fontSize: 13, color: "#374151", fontWeight: "600" },
  chipTxtSel:   { color: "#fff" },
  selectBtn:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  selectTxt:    { flex: 1, fontSize: 14, color: "#0f172a" },
  selectPlaceholder: { color: "#94a3b8" },
  formBtnRow:   { flexDirection: "row", gap: 10, marginTop: 24 },
  cancelBtn:    { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  cancelBtnTxt: { color: "#374151", fontSize: 15, fontWeight: "700" },
  saveBtn:      { flex: 1, backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnTxt:   { color: "#fff", fontSize: 15, fontWeight: "800" },

  // Series scope cards
  scopeRow:     { flexDirection: "row", gap: 10 },
  scopeCard:    { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: "#e2e8f0", padding: 12, alignItems: "center", gap: 4, backgroundColor: "#f8fafc" },
  scopeCardSel: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  scopeLabel:   { fontSize: 13, fontWeight: "700", color: "#374151" },
  scopeLabelSel:{ color: "#2563eb" },
  scopeDesc:    { fontSize: 10, color: "#94a3b8", textAlign: "center" },
});
