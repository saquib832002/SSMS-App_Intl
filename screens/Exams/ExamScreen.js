/**
 * screens/Setup/ExamScreen.js
 * Exam management — list, add, edit, delete
 * Table: ssms_exams (exam_id, exam_name, ssms_client_code)
 */
import React, { useState, useContext, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchExams, createExam, updateExam, deleteExam, toggleExamRelease,
} from "../../services/ExamServiceApi";

export default function ExamScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [exams,        setExams]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [togglingId,   setTogglingId]   = useState(null); // exam_id being toggled
  const [modalVisible, setModalVisible] = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [examName,     setExamName]     = useState("");
  const [examCategory, setExamCategory] = useState("Annual");
  const [isReleased,   setIsReleased]   = useState(false);
  const [search,       setSearch]       = useState("");

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await fetchExams(user);
      setExams(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load exams");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Open modals ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setExamName("");
    setExamCategory("Annual");
    setIsReleased(false);
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setExamName(item.exam_name ?? "");
    setExamCategory(item.exam_category ?? "Annual");
    setIsReleased(item.is_released == 1);
    setModalVisible(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!examName.trim()) {
      Alert.alert("Validation", "Exam name is required.");
      return;
    }
    try {
      setSaving(true);
      const payload = { exam_name: examName.trim(), exam_category: examCategory, is_released: isReleased ? 1 : 0 };
      if (editing) {
        await updateExam(user, editing.exam_id, payload);
      } else {
        await createExam(user, payload);
      }
      setModalVisible(false);
      load();
      Alert.alert("Success", editing ? "Exam updated." : "Exam added.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save exam");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Delete Exam",
      `Delete "${item.exam_name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteExam(user, item.exam_id);
              load();
              Alert.alert("Deleted", "Exam deleted successfully.");
            } catch (e) {
              Alert.alert("Error", e.message || "Failed to delete exam");
            }
          },
        },
      ]
    );
  };

  // ── Toggle release ────────────────────────────────────────────────────────
  const handleToggleRelease = async (item) => {
    setTogglingId(item.exam_id);
    try {
      const res = await toggleExamRelease(user, item.exam_id);
      // Optimistically update local list so UI reflects immediately
      setExams(prev => prev.map(e =>
        e.exam_id === item.exam_id ? { ...e, is_released: res.is_released } : e
      ));
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to update exam visibility");
    } finally {
      setTogglingId(null);
    }
  };

  // ── Filtered ──────────────────────────────────────────────────────────────
  const filtered = exams.filter(e =>
    !search || (e.exam_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }) => {
    const cat = item.exam_category ?? "Annual";
    const { bg, fg } = CAT_COLORS[cat] ?? CAT_COLORS.Annual;
    return (
    <View style={sc.card}>
      <View style={sc.cardLeft}>
        <View style={sc.indexBadge}>
          <Text style={sc.indexTxt}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={sc.examName}>{item.exam_name}</Text>
            <View style={[sc.catBadge, { backgroundColor: bg }]}>
              <Text style={[sc.catBadgeTxt, { color: fg }]}>{cat}</Text>
            </View>
          </View>
          {item.created ? (
            <Text style={sc.examDate}>Created {item.created.slice(0, 10)}</Text>
          ) : null}
        </View>
      </View>
      <View style={sc.actions}>
        {/* Release toggle */}
        <TouchableOpacity
          style={[
            sc.releasePill,
            item.is_released == 1 ? sc.releasedPill : sc.hiddenPill,
          ]}
          onPress={() => handleToggleRelease(item)}
          disabled={togglingId === item.exam_id}
        >
          {togglingId === item.exam_id
            ? <ActivityIndicator size={10} color={item.is_released == 1 ? "#15803d" : "#64748b"} />
            : <Feather
                name={item.is_released == 1 ? "unlock" : "lock"}
                size={11}
                color={item.is_released == 1 ? "#15803d" : "#64748b"}
              />}
          <Text style={[sc.releasePillTxt, item.is_released == 1 ? { color: "#15803d" } : { color: "#64748b" }]}>
            {item.is_released == 1 ? "Released" : "Hidden"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[sc.iconBtn, { backgroundColor: "#eff6ff" }]}
          onPress={() => openEdit(item)}
        >
          <MaterialIcons name="edit" size={17} color="#1e40af" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[sc.iconBtn, { backgroundColor: "#fef2f2" }]}
          onPress={() => handleDelete(item)}
        >
          <MaterialIcons name="delete-outline" size={17} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );};   // end renderItem

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={sc.container}>

      {/* Header */}
      <View style={sc.headerBlock}>
        <TouchableOpacity
          onPress={() => navigation.navigate("StudentsList")}
          style={sc.backBtn}
        >
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <Text style={sc.headerTitle}>Exams</Text>
        <TouchableOpacity style={sc.addBtn} onPress={openAdd}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={sc.addBtnTxt}>Add Exam</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={sc.searchWrap}>
        <Feather name="search" size={13} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={sc.searchInput}
          placeholder="Search exams…"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={13} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading
        ? <View style={sc.loader}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={sc.loaderTxt}>Loading exams…</Text>
          </View>
        : <FlatList
            data={filtered}
            keyExtractor={item => String(item.exam_id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <View style={sc.empty}>
                <Feather name="edit-3" size={38} color="#cbd5e1" />
                <Text style={sc.emptyTxt}>No exams found</Text>
                <Text style={sc.emptySubTxt}>
                  {search ? "Try a different search term" : 'Tap "Add Exam" to create one'}
                </Text>
              </View>
            }
          />}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={sc.modalOverlay}>
          <View style={sc.modalCard}>

            <View style={sc.modalHeader}>
              <Text style={sc.modalTitle}>
                {editing ? "Edit Exam" : "Add Exam"}
              </Text>
              <TouchableOpacity
                style={sc.modalClose}
                onPress={() => setModalVisible(false)}
                disabled={saving}
              >
                <Feather name="x" size={15} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={sc.fieldLabel}>
              Exam Name <Text style={{ color: "#ef4444" }}>*</Text>
            </Text>
            <TextInput
              style={sc.input}
              placeholder="e.g. Annual Exam, Mid Term"
              placeholderTextColor="#94a3b8"
              value={examName}
              onChangeText={setExamName}
              autoFocus
              editable={!saving}
            />

            <Text style={sc.fieldLabel}>Category <Text style={{ color: "#ef4444" }}>*</Text></Text>
            <View style={sc.catGrid}>
              {CATEGORIES.map(cat => {
                const active = examCategory === cat;
                const { bg, fg } = CAT_COLORS[cat];
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[sc.catChip, active && { backgroundColor: fg, borderColor: fg }]}
                    onPress={() => setExamCategory(cat)}
                    disabled={saving}
                  >
                    <Text style={[sc.catChipTxt, { color: active ? "#fff" : fg }]}>{cat}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Release toggle */}
            <TouchableOpacity
              style={[sc.releaseToggle, isReleased && sc.releaseToggleOn]}
              onPress={() => setIsReleased(v => !v)}
              disabled={saving}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[sc.releaseToggleTitle, isReleased && { color: "#15803d" }]}>
                  {isReleased ? "Visible to students" : "Hidden from students"}
                </Text>
                <Text style={sc.releaseToggleSub}>
                  {isReleased
                    ? "Results & marksheet visible in student/parent portal"
                    : "Exam is in preparation — not shown in student portal"}
                </Text>
              </View>
              <View style={[sc.togglePill, isReleased && sc.togglePillOn]}>
                <View style={[sc.toggleThumb, isReleased && sc.toggleThumbOn]} />
              </View>
            </TouchableOpacity>

            <View style={sc.modalBtns}>
              <TouchableOpacity
                style={sc.cancelBtn}
                onPress={() => setModalVisible(false)}
                disabled={saving}
              >
                <Text style={sc.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[sc.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Feather name="check" size={14} color="#fff" />
                      <Text style={sc.saveBtnTxt}>
                        {editing ? "Update" : "Save"}
                      </Text>
                    </>}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

    </View>
  );
}

const CATEGORIES = ["Annual", "Term", "Major", "Minor", "Weekly", "Monthly"];
const CAT_COLORS = {
  Annual:  { bg: "#f3e8ff", fg: "#7c3aed" },
  Term:    { bg: "#e0f2fe", fg: "#0369a1" },
  Major:   { bg: "#f1f5f9", fg: "#475569" },
  Minor:   { bg: "#fef9c3", fg: "#b45309" },
  Weekly:  { bg: "#dbeafe", fg: "#1d4ed8" },
  Monthly: { bg: "#dcfce7", fg: "#15803d" },
};

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  container:     { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  headerBlock:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  backBtn:       { padding: 4 },
  headerTitle:   { flex: 1, fontSize: 16, fontWeight: "800", color: "#0f172a" },
  title:         { fontSize: 17, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  subtitle:      { fontSize: 11, color: "#94a3b8", marginTop: 1, marginBottom: 12 },
  addBtn:        { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1e40af", paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  addBtnTxt:     { color: "#fff", fontWeight: "700", fontSize: 13 },

  searchWrap:    { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 11, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 },
  searchInput:   { flex: 1, fontSize: 13, color: "#0f172a" },

  // Card
  card:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardLeft:      { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, marginRight: 8 },
  indexBadge:    { width: 32, height: 32, borderRadius: 9, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  indexTxt:      { fontSize: 12, fontWeight: "800", color: "#1e40af" },
  examName:      { fontSize: 13, fontWeight: "700", color: "#1946b2" },
  examDate:      { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  catBadge:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  catBadgeTxt:   { fontSize: 10, fontWeight: "700" },
  catGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  catChip:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  catChipTxt:    { fontSize: 12, fontWeight: "700" },
  actions:       { flexDirection: "row", gap: 6, alignItems: "center" },
  iconBtn:       { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  releasePill:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  releasedPill:  { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  hiddenPill:    { backgroundColor: "#f8fafc", borderColor: "#cbd5e1" },
  releasePillTxt:{ fontSize: 10, fontWeight: "700" },

  loader:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:     { color: "#64748b", fontSize: 13 },
  empty:         { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:      { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:   { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Modal
  modalOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modalCard:     { backgroundColor: "#fff", borderRadius: 20, padding: 20, width: "100%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle:    { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:    { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:    { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 7 },
  input:         { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 13, color: "#0f172a", marginBottom: 18 },
  releaseToggle:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 12, marginBottom: 18 },
  releaseToggleOn:    { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  releaseToggleTitle: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 2 },
  releaseToggleSub:   { fontSize: 11, color: "#94a3b8", lineHeight: 15 },
  togglePill:         { width: 40, height: 22, borderRadius: 11, backgroundColor: "#cbd5e1", justifyContent: "center", paddingHorizontal: 2 },
  togglePillOn:       { backgroundColor: "#16a34a" },
  toggleThumb:        { width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff", alignSelf: "flex-start" },
  toggleThumbOn:      { alignSelf: "flex-end" },

  modalBtns:     { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  cancelBtn:     { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt:  { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:    { color: "#fff", fontWeight: "700", fontSize: 13 },
});