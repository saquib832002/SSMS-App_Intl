/**
 * screens/Exams/ChapterManageScreen.js
 * Admin manages chapters per class + subject.
 * Entry point: SetupScreen → Question Bank section → "Chapters"
 * Route params: none (user picks class + subject on screen)
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, Modal, TextInput, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchClasses } from "../../services/SetupServiceApi";
import { fetchClassSubjects } from "../../services/SubjectServiceApi";
import {
  fetchChapters, createChapter, updateChapter, deleteChapter,
} from "../../services/TestSeriesServiceApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);

// ─── Chapter Form Modal ────────────────────────────────────────────────────────

function ChapterFormModal({ visible, initial, onSave, onClose }) {
  const [chapterNo,   setChapterNo]   = useState("");
  const [chapterName, setChapterName] = useState("");
  const [unitName,    setUnitName]    = useState("");
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    if (visible) {
      setChapterNo(initial ? String(initial.chapter_no ?? "") : "");
      setChapterName(initial?.chapter_name ?? "");
      setUnitName(initial?.unit_name ?? "");
      setSaving(false);
    }
  }, [visible, initial]);

  const handleSave = async () => {
    if (!chapterName.trim()) { Alert.alert("Validation", "Chapter name is required."); return; }
    setSaving(true);
    try {
      await onSave({
        chapter_no:   parseInt(chapterNo) || 0,
        chapter_name: chapterName.trim(),
        unit_name:    unitName.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.modalWrap}>
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />
        <View style={st.formSheet}>
          <View style={st.sheetHandle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={st.formTitle}>{initial ? "Edit Chapter" : "Add Chapter"}</Text>

            <Text style={st.label}>Chapter No.</Text>
            <TextInput
              style={st.input}
              placeholder="e.g. 1"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={chapterNo}
              onChangeText={setChapterNo}
            />

            <Text style={st.label}>Chapter Name *</Text>
            <TextInput
              style={st.input}
              placeholder="e.g. Electric Charges and Fields"
              placeholderTextColor="#94a3b8"
              value={chapterName}
              onChangeText={setChapterName}
            />

            <Text style={st.label}>Unit Name (optional)</Text>
            <TextInput
              style={st.input}
              placeholder="e.g. Unit 1: Electrostatics"
              placeholderTextColor="#94a3b8"
              value={unitName}
              onChangeText={setUnitName}
            />

            <View style={st.formBtnRow}>
              <TouchableOpacity style={st.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={st.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={st.saveBtnTxt}>{initial ? "Update" : "Add Chapter"}</Text>
                }
              </TouchableOpacity>
            </View>
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Picker sheet ──────────────────────────────────────────────────────────────

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
            const isSel = String(item[valueKey]) === String(selected ?? "");
            return (
              <TouchableOpacity
                style={[st.sheetItem, isSel && st.sheetItemSel]}
                onPress={() => { onSelect(item); onClose(); }}
              >
                <Text style={[st.sheetItemTxt, isSel && st.sheetItemTxtSel]}>{item[labelKey]}</Text>
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

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function ChapterManageScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [classes,    setClasses]    = useState([]);
  const [subjects,   setSubjects]   = useState([]);
  const [chapters,   setChapters]   = useState([]);
  const [loading,    setLoading]    = useState(false);

  const [selectedClass,   setSelectedClass]   = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);

  const [pickerTarget, setPickerTarget] = useState(null); // "class" | "subject"
  const [formVisible,  setFormVisible]  = useState(false);
  const [editTarget,   setEditTarget]   = useState(null);

  // Load classes once
  useEffect(() => {
    if (!user) return;
    fetchClasses(user).then((res) => setClasses(norm(res))).catch(() => {});
  }, [user]);

  // Load subjects when class changes
  useEffect(() => {
    if (!user || !selectedClass) { setSubjects([]); setSelectedSubject(null); return; }
    fetchClassSubjects(user, selectedClass.class_id)
      .then((res) => setSubjects(norm(res)))
      .catch(() => setSubjects([]));
    setSelectedSubject(null);
    setChapters([]);
  }, [user, selectedClass]);

  // Load chapters when class + subject are both selected
  const loadChapters = useCallback(async () => {
    if (!user || !selectedClass || !selectedSubject) return;
    setLoading(true);
    try {
      const res = await fetchChapters(user, selectedClass.class_id, selectedSubject.subject_id);
      setChapters(res);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load chapters");
    } finally {
      setLoading(false);
    }
  }, [user, selectedClass, selectedSubject]);

  useFocusEffect(useCallback(() => { loadChapters(); }, [loadChapters]));

  const openCreate = () => { setEditTarget(null); setFormVisible(true); };
  const openEdit   = (item) => { setEditTarget(item); setFormVisible(true); };

  const handleSave = async (data) => {
    if (!selectedClass || !selectedSubject) {
      Alert.alert("Select class and subject first.");
      return;
    }
    try {
      const payload = {
        ...data,
        class_id:   selectedClass.class_id,
        subject_id: selectedSubject.subject_id,
      };
      if (editTarget) {
        await updateChapter(user, editTarget.id, payload);
      } else {
        await createChapter(user, payload);
      }
      setFormVisible(false);
      loadChapters();
    } catch (e) {
      Alert.alert("Error", e.message || "Save failed");
      throw e;
    }
  };

  const handleDelete = (item) => {
    Alert.alert(
      "Delete Chapter",
      `Delete "${item.chapter_name}"? Questions tagged to this chapter will become untagged.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteChapter(user, item.id);
              loadChapters();
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
      <View style={st.cardLeft}>
        <View style={st.chNoCircle}>
          <Text style={st.chNoTxt}>{item.chapter_no || "—"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.chName}>{item.chapter_name}</Text>
          {!!item.unit_name && (
            <Text style={st.unitName}>{item.unit_name}</Text>
          )}
        </View>
      </View>
      <View style={st.iconBtns}>
        <TouchableOpacity style={st.iconBtn} onPress={() => openEdit(item)}>
          <Feather name="edit-2" size={15} color="#2563eb" />
        </TouchableOpacity>
        <TouchableOpacity style={[st.iconBtn, st.iconBtnRed]} onPress={() => handleDelete(item)}>
          <Feather name="trash-2" size={15} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const canAdd = !!selectedClass && !!selectedSubject;

  return (
    <View style={st.root}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Chapter Manager</Text>
          <Text style={st.headerSub}>Add chapters for chapter-wise test series</Text>
        </View>
      </View>

      {/* Class + Subject selectors */}
      <View style={st.selRow}>
        <TouchableOpacity
          style={[st.selBtn, { flex: 1 }]}
          onPress={() => setPickerTarget("class")}
        >
          <Feather name="book-open" size={13} color="#64748b" />
          <Text style={[st.selTxt, !selectedClass && st.selPlaceholder]} numberOfLines={1}>
            {selectedClass ? selectedClass.class_name : "Select Class"}
          </Text>
          <Feather name="chevron-down" size={13} color="#64748b" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[st.selBtn, { flex: 1 }, !selectedClass && st.selBtnDisabled]}
          onPress={() => { if (selectedClass) setPickerTarget("subject"); }}
        >
          <Feather name="layers" size={13} color="#64748b" />
          <Text style={[st.selTxt, !selectedSubject && st.selPlaceholder]} numberOfLines={1}>
            {selectedSubject ? selectedSubject.subject_name : "Select Subject"}
          </Text>
          <Feather name="chevron-down" size={13} color="#64748b" />
        </TouchableOpacity>
      </View>

      {/* Chapter list */}
      {!canAdd ? (
        <View style={st.emptyWrap}>
          <Feather name="book" size={40} color="#cbd5e1" />
          <Text style={st.emptyTxt}>Select a class and subject{"\n"}to manage its chapters.</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={chapters}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={st.list}
          ListEmptyComponent={
            <Text style={st.empty}>
              {"No chapters yet.\nTap + to add chapters for\n"}
              {selectedSubject?.subject_name} → {selectedClass?.class_name}
            </Text>
          }
        />
      )}

      {/* FAB */}
      {canAdd && (
        <TouchableOpacity style={st.fab} onPress={openCreate}>
          <Feather name="plus" size={24} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Chapter form modal */}
      <ChapterFormModal
        visible={formVisible}
        initial={editTarget}
        onSave={handleSave}
        onClose={() => setFormVisible(false)}
      />

      {/* Pickers */}
      <SheetPicker
        visible={pickerTarget === "class"}
        title="Select Class"
        items={classes}
        labelKey="class_name"
        valueKey="class_id"
        selected={selectedClass?.class_id}
        onSelect={setSelectedClass}
        onClose={() => setPickerTarget(null)}
      />
      <SheetPicker
        visible={pickerTarget === "subject"}
        title="Select Subject"
        items={subjects}
        labelKey="subject_name"
        valueKey="subject_id"
        selected={selectedSubject?.subject_id}
        onSelect={setSelectedSubject}
        onClose={() => setPickerTarget(null)}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f8fafc" },

  header:      { backgroundColor: "#1e3a8a", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 19, fontWeight: "900", color: "#fff" },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 1 },

  selRow:      { flexDirection: "row", gap: 10, padding: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#e2e8f0" },
  selBtn:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  selBtnDisabled: { opacity: 0.45 },
  selTxt:      { flex: 1, fontSize: 13, color: "#0f172a" },
  selPlaceholder: { color: "#94a3b8" },

  list:        { padding: 14, paddingBottom: 90 },
  emptyWrap:   { flex: 1, alignItems: "center", justifyContent: "center", marginTop: 80, gap: 14 },
  emptyTxt:    { textAlign: "center", color: "#94a3b8", fontSize: 14, lineHeight: 22 },
  empty:       { textAlign: "center", color: "#9ca3af", fontSize: 14, marginTop: 60, lineHeight: 22 },

  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", elevation: 1, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3 },
  cardLeft:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  chNoCircle:  { width: 38, height: 38, borderRadius: 19, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  chNoTxt:     { fontSize: 13, fontWeight: "800", color: "#6d28d9" },
  chName:      { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  unitName:    { fontSize: 11, color: "#6366f1", marginTop: 2, fontStyle: "italic" },

  iconBtns:    { flexDirection: "row", gap: 8 },
  iconBtn:     { backgroundColor: "#eff6ff", borderRadius: 8, padding: 7 },
  iconBtnRed:  { backgroundColor: "#fef2f2" },

  fab:         { position: "absolute", right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: "#6366f1", alignItems: "center", justifyContent: "center", elevation: 6 },

  // Modal
  modalWrap:   { flex: 1, justifyContent: "flex-end" },
  overlay:     { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  formSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%", paddingHorizontal: 18, paddingBottom: 20 },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60%", paddingBottom: 20 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginTop: 10, marginBottom: 10 },
  sheetTitle:  { fontSize: 15, fontWeight: "800", color: "#1e293b", paddingHorizontal: 16, marginBottom: 8 },
  sheetItem:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 },
  sheetItemSel:{ backgroundColor: "#eff6ff" },
  sheetItemTxt:{ fontSize: 14, color: "#374151" },
  sheetItemTxtSel: { color: "#2563eb", fontWeight: "700" },
  sheetSep:    { height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 16 },

  formTitle:   { fontSize: 17, fontWeight: "900", color: "#0f172a", marginBottom: 14, marginTop: 4 },
  label:       { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 14 },
  input:       { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0f172a" },

  formBtnRow:  { flexDirection: "row", gap: 10, marginTop: 24 },
  cancelBtn:   { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  cancelBtnTxt:{ color: "#374151", fontSize: 15, fontWeight: "700" },
  saveBtn:     { flex: 1, backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnTxt:  { color: "#fff", fontSize: 15, fontWeight: "800" },
});
