/**
 * screens/Setup/ClassSubjectScreen.js
 * Assign subjects to classes — each assignment carries a subject_code
 * and a display_order for consistent ordering on marksheets and reports.
 */
import React, { useState, useContext, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchClassSubjects, createClassSubject,
  updateClassSubject, deleteClassSubject,
  fetchSubjects,
} from "../../services/SubjectServiceApi";
import { fetchClasses } from "../../services/SetupServiceApi";

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading: isLoading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[st.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[st.dropTxt, !selected?.value && st.dropPh]} numberOfLines={1}>
          {isLoading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={14} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={st.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={st.dropSheet}>
            <Text style={st.dropTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => `${i}_${String(o.value)}`}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[st.dropOption, String(o.value) === String(value) && st.dropOptionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[st.dropOptionTxt, String(o.value) === String(value) && st.dropOptionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) &&
                    <Feather name="check" size={13} color="#6b21a8" />}
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

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ClassSubjectScreen() {
  const { user } = useContext(AuthContext);

  const [assignments,   setAssignments]   = useState([]);
  const [subjects,      setSubjects]      = useState([]);
  const [classes,       setClasses]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [modalVisible,  setModalVisible]  = useState(false);
  const [editingItem,   setEditingItem]   = useState(null);
  const [filterClassId, setFilterClassId] = useState("");

  const [form, setForm] = useState({
    class_id:      "",
    subject_id:    "",
    subject_code:  "",
    display_order: "0",
  });
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [asgn, subj, cls] = await Promise.all([
        fetchClassSubjects(user),
        fetchSubjects(user),
        fetchClasses(user),
      ]);
      setAssignments(Array.isArray(asgn) ? asgn : []);
      setSubjects(Array.isArray(subj) ? subj : []);
      const cl = Array.isArray(cls) ? cls : cls?.data ?? [];
      setClasses(cl);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    filterClassId
      ? assignments.filter(a => String(a.class_id) === String(filterClassId))
      : assignments,
  [assignments, filterClassId]);

  // ── Grouped by class ──────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(a => {
      const key = a.class_name ?? `Class ${a.class_id}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // ── Options ───────────────────────────────────────────────────────────────
  const classOptions = useMemo(() => [
    { label: "All Classes", value: "" },
    ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
  ], [classes]);

  const classFormOptions = useMemo(() => [
    { label: "Select Class", value: "" },
    ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
  ], [classes]);

  const subjectOptions = useMemo(() => [
    { label: "Select Subject", value: "" },
    ...subjects.map(s => ({ label: s.subject_name, value: String(s.subject_id) })),
  ], [subjects]);

  // ── Modals ────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingItem(null);
    setForm({ class_id: filterClassId, subject_id: "", subject_code: "", display_order: "0" });
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setForm({
      class_id:      String(item.class_id ?? ""),
      subject_id:    String(item.subject_id ?? ""),
      subject_code:  item.subject_code ?? "",
      display_order: String(item.display_order ?? "0"),
    });
    setModalVisible(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.class_id)   { Alert.alert("Validation", "Please select a class.");   return; }
    if (!form.subject_id) { Alert.alert("Validation", "Please select a subject."); return; }
    try {
      setSaving(true);
      const payload = {
        class_id:      parseInt(form.class_id, 10),
        subject_id:    parseInt(form.subject_id, 10),
        subject_code:  form.subject_code.trim(),
        display_order: parseInt(form.display_order, 10) || 0,
      };
      if (editingItem) {
        await updateClassSubject(user, editingItem.id, payload);
      } else {
        await createClassSubject(user, payload);
      }
      setModalVisible(false);
      load();
      Alert.alert("Success", editingItem ? "Assignment updated." : "Subject assigned to class.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Remove Assignment",
      `Remove "${item.subject_name}" from ${item.class_name ?? "this class"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            try {
              await deleteClassSubject(user, item.id);
              load();
            } catch (e) {
              Alert.alert("Error", e.message || "Failed to delete");
            }
          },
        },
      ]
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={st.container}>

      {/* Header */}
      <View style={st.headerBlock}>
        <Text style={st.title}>Class Subjects</Text>
        <Text style={st.subtitle}>{filtered.length} assignment{filtered.length !== 1 ? "s" : ""}</Text>
        <TouchableOpacity style={st.addBtn} onPress={openAdd}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={st.addBtnTxt}>Assign Subject</Text>
        </TouchableOpacity>
      </View>

      {/* Class filter */}
      <View style={st.filterWrap}>
        <Text style={st.filterLabel}>Filter by Class</Text>
        <Dropdown
          label="All Classes"
          value={filterClassId}
          options={classOptions}
          onChange={setFilterClassId}
          loading={loading}
        />
      </View>

      {/* List */}
      {loading
        ? <View style={st.loader}>
            <ActivityIndicator size="large" color="#6b21a8" />
            <Text style={st.loaderTxt}>Loading assignments…</Text>
          </View>
        : grouped.length === 0
          ? <View style={st.empty}>
              <Feather name="layers" size={38} color="#cbd5e1" />
              <Text style={st.emptyTxt}>No assignments found</Text>
              <Text style={st.emptySubTxt}>
                {filterClassId ? "No subjects assigned to this class yet" : "Tap \"Assign Subject\" to get started"}
              </Text>
            </View>
          : <FlatList
              data={grouped}
              keyExtractor={([className]) => className}
              contentContainerStyle={{ paddingBottom: 40 }}
              renderItem={({ item: [className, rows] }) => (
                <View style={st.group}>
                  {/* Class header */}
                  <View style={st.groupHeader}>
                    <Feather name="book-open" size={13} color="#6b21a8" />
                    <Text style={st.groupTitle}>{className}</Text>
                    <View style={st.groupCount}>
                      <Text style={st.groupCountTxt}>{rows.length}</Text>
                    </View>
                  </View>
                  {/* Subject rows */}
                  {rows.map((item, idx) => (
                    <View key={String(item.id)} style={[st.row, idx === rows.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={st.rowLeft}>
                        <View style={st.orderBadge}>
                          <Text style={st.orderTxt}>{item.display_order ?? 0}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={st.rowSubject}>{item.subject_name}</Text>
                          {!!item.subject_code && (
                            <Text style={st.rowCode}>{item.subject_code}</Text>
                          )}
                        </View>
                      </View>
                      <View style={st.rowActions}>
                        <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#f5f3ff" }]} onPress={() => openEdit(item)}>
                          <MaterialIcons name="edit" size={16} color="#6b21a8" />
                        </TouchableOpacity>
                        <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => handleDelete(item)}>
                          <MaterialIcons name="delete-outline" size={16} color="#dc2626" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            />}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => !saving && setModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={st.modalOverlay}>
            <View style={st.modalCard}>

              <View style={st.modalHeader}>
                <Text style={st.modalTitle}>{editingItem ? "Edit Assignment" : "Assign Subject to Class"}</Text>
                <TouchableOpacity style={st.modalClose} onPress={() => setModalVisible(false)} disabled={saving}>
                  <Feather name="x" size={15} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Class */}
                <Text style={st.fieldLabel}>Class <Text style={{ color: "#ef4444" }}>*</Text></Text>
                <Dropdown label="Select Class" value={form.class_id} options={classFormOptions}
                  onChange={v => setField("class_id", v)} disabled={saving} />

                {/* Subject */}
                <Text style={st.fieldLabel}>Subject <Text style={{ color: "#ef4444" }}>*</Text></Text>
                <Dropdown label="Select Subject" value={form.subject_id} options={subjectOptions}
                  onChange={v => setField("subject_id", v)} disabled={saving} />

                {/* Subject Code */}
                <Text style={st.fieldLabel}>Subject Code</Text>
                <TextInput
                  style={st.input}
                  placeholder="e.g. MATH101"
                  placeholderTextColor="#94a3b8"
                  value={form.subject_code}
                  onChangeText={v => setField("subject_code", v)}
                  autoCapitalize="characters"
                  editable={!saving}
                />

                {/* Display Order */}
                <Text style={st.fieldLabel}>Display Order</Text>
                <TextInput
                  style={st.input}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  value={form.display_order}
                  onChangeText={v => setField("display_order", v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  editable={!saving}
                />

              </ScrollView>

              <View style={st.modalBtns}>
                <TouchableOpacity style={st.cancelBtn} onPress={() => setModalVisible(false)} disabled={saving}>
                  <Text style={st.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                        <Feather name="check" size={14} color="#fff" />
                        <Text style={st.saveBtnTxt}>{editingItem ? "Update" : "Assign"}</Text>
                      </>}
                </TouchableOpacity>
              </View>

            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const PURPLE = "#6b21a8";

const st = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  // Header
  headerBlock: { marginBottom: 14 },
  title:       { fontSize: 17, fontWeight: "800", color: PURPLE, letterSpacing: -0.3 },
  subtitle:    { fontSize: 11, color: "#94a3b8", marginTop: 1, marginBottom: 12 },
  addBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: PURPLE, paddingVertical: 11, borderRadius: 12, elevation: 3, shadowColor: PURPLE, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  addBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Filter
  filterWrap:  { marginBottom: 12 },
  filterLabel: { fontSize: 11, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },

  // Group
  group:       { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 12, overflow: "hidden", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#faf5ff", borderBottomWidth: 1, borderBottomColor: "#ede9fe" },
  groupTitle:  { flex: 1, fontSize: 13, fontWeight: "800", color: PURPLE },
  groupCount:  { backgroundColor: PURPLE, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  groupCountTxt: { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Row
  row:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  rowLeft:     { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, marginRight: 8 },
  orderBadge:  { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f5f3ff", alignItems: "center", justifyContent: "center" },
  orderTxt:    { fontSize: 11, fontWeight: "800", color: PURPLE },
  rowSubject:  { fontSize: 13, fontWeight: "600", color: "#0f172a" },
  rowCode:     { fontSize: 10, color: "#94a3b8", marginTop: 2, fontWeight: "600" },
  rowActions:  { flexDirection: "row", gap: 6 },
  iconBtn:     { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  // Loader / empty
  loader:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:   { color: "#64748b", fontSize: 13 },
  empty:       { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:    { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt: { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modalCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 20, width: "100%", borderWidth: 1, borderColor: "#e2e8f0", maxHeight: "85%" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 7 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 13, color: "#0f172a", marginBottom: 14 },
  modalBtns:    { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  cancelBtn:    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: PURPLE },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Dropdown
  dropTrigger:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 14 },
  dropTxt:          { flex: 1, fontSize: 13, color: "#0f172a" },
  dropPh:           { color: "#94a3b8" },
  dropOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  dropSheet:        { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%", maxHeight: "65%" },
  dropTitle:        { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
  dropOptionActive: { backgroundColor: "#faf5ff" },
  dropOptionTxt:    { fontSize: 13, color: "#0f172a" },
  dropOptionTxtActive: { color: PURPLE, fontWeight: "700" },
});
