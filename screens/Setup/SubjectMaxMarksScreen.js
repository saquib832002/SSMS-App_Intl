/**
 * screens/Setup/SubjectMaxMarksScreen.js
 * Define max marks per subject per class.
 * max_marks auto-calculated from theory + internal + practical.
 */
import React, { useState, useContext, useCallback, useEffect, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchMaxMarks, createMaxMarks, updateMaxMarks, deleteMaxMarks,
  fetchClassSubjects,
} from "../../services/SubjectServiceApi";
import { fetchClasses } from "../../services/SetupServiceApi";

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[sc.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[sc.dropTxt, !selected?.value && sc.dropPh]} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={14} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={sc.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={sc.dropSheet}>
            <Text style={sc.dropTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[sc.dropOption, String(o.value) === String(value) && sc.dropOptionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[sc.dropOptionTxt, String(o.value) === String(value) && sc.dropOptionTxtActive]}>
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

// ── Marks input row ───────────────────────────────────────────────────────────
const MarksInput = ({ label, value, onChangeText, disabled }) => (
  <View style={sc.marksRow}>
    <Text style={sc.marksLabel}>{label}</Text>
    <TextInput
      style={sc.marksInput}
      placeholder="0"
      placeholderTextColor="#94a3b8"
      value={value}
      onChangeText={onChangeText}
      keyboardType="numeric"
      editable={!disabled}
    />
  </View>
);

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SubjectMaxMarksScreen() {
  const { user } = useContext(AuthContext);

  const [records,      setRecords]      = useState([]);
  const [classes,      setClasses]      = useState([]);
  const [subjects,     setSubjects]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [loadingSubj,  setLoadingSubj]  = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [filterClass,  setFilterClass]  = useState("");

  const [form, setForm] = useState({
    class_id:              "",
    subject_id:            "",
    theory_max_marks:      "",
    internal_max_marks:    "",
    practical_max_marks:   "",
  });

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Auto-calculated max_marks
  const maxMarks = useMemo(() => {
    const t = parseFloat(form.theory_max_marks)    || 0;
    const i = parseFloat(form.internal_max_marks)  || 0;
    const p = parseFloat(form.practical_max_marks) || 0;
    return t + i + p;
  }, [form.theory_max_marks, form.internal_max_marks, form.practical_max_marks]);

  // ── Load records + classes ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [recData, classData] = await Promise.all([
        fetchMaxMarks(user),
        fetchClasses(user),
      ]);
      setRecords(Array.isArray(recData) ? recData : []);
      setClasses(Array.isArray(classData) ? classData : classData?.data ?? []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Load subjects when class changes ──────────────────────────────────────
  useEffect(() => {
    if (!form.class_id) { setSubjects([]); setField("subject_id", ""); return; }
    let cancelled = false;
    setLoadingSubj(true);
    setSubjects([]); setField("subject_id", "");
    fetchClassSubjects(user, form.class_id)
      .then(d => { if (!cancelled) setSubjects(Array.isArray(d) ? d : d?.data ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSubj(false); });
    return () => { cancelled = true; };
  }, [form.class_id]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = filterClass
    ? records.filter(r => String(r.class_id) === String(filterClass))
    : records;

  // ── Open modals ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setForm({ class_id: filterClass, subject_id: "", theory_max_marks: "", internal_max_marks: "", practical_max_marks: "" });
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      class_id:            item.class_id   ? String(item.class_id)   : "",
      subject_id:          item.subject_id ? String(item.subject_id) : "",
      theory_max_marks:    item.theory_max_marks    != null ? String(item.theory_max_marks)    : "",
      internal_max_marks:  item.internal_max_marks  != null ? String(item.internal_max_marks)  : "",
      practical_max_marks: item.practical_max_marks != null ? String(item.practical_max_marks) : "",
    });
    setModalVisible(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.class_id)   { Alert.alert("Validation", "Please select a class.");   return; }
    if (!form.subject_id) { Alert.alert("Validation", "Please select a subject."); return; }
    if (maxMarks <= 0)    { Alert.alert("Validation", "Total marks must be greater than 0."); return; }
    try {
      setSaving(true);
      const payload = { ...form, max_marks: maxMarks };
      if (editing) {
        await updateMaxMarks(user, editing.id, payload);
      } else {
        await createMaxMarks(user, payload);
      }
      setModalVisible(false);
      load();
      Alert.alert("Success", editing ? "Max marks updated." : "Max marks added.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Delete",
      `Delete max marks for "${item.subject_name}" (${item.class_name})?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try { await deleteMaxMarks(user, item.id); load(); }
            catch (e) { Alert.alert("Error", e.message || "Failed to delete"); }
          },
        },
      ]
    );
  };

  // ── Options ───────────────────────────────────────────────────────────────
  const classOptions      = [{ label: "All Classes",  value: "" }, ...classes.map(c  => ({ label: c.class_name,   value: String(c.class_id)   }))];
  const classFormOptions  = [{ label: "Select Class", value: "" }, ...classes.map(c  => ({ label: c.class_name,   value: String(c.class_id)   }))];
  const subjectFormOptions = [{ label: "Select Subject", value: "" }, ...subjects.map(s => ({
    label: s.subject_code ? `${s.subject_name} - ${s.subject_code}` : s.subject_name,
    value: String(s.subject_id),
  }))];

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => (
    <View style={sc.card}>
      <View style={sc.cardBody}>
        {/* Header row */}
        <View style={sc.cardHead}>
          <Text style={sc.subjectName} numberOfLines={1}>{item.subject_name}</Text>
          {item.subject_code ? <View style={sc.codeBadge}><Text style={sc.codeTxt}>{item.subject_code}</Text></View> : null}
        </View>
        <Text style={sc.className}>{item.class_name}</Text>

        {/* Marks breakdown */}
        <View style={sc.marksStrip}>
          <View style={sc.markChip}>
            <Text style={sc.markChipLabel}>Theory</Text>
            <Text style={sc.markChipVal}>{item.theory_max_marks ?? 0}</Text>
          </View>
          <View style={sc.markChip}>
            <Text style={sc.markChipLabel}>Internal</Text>
            <Text style={sc.markChipVal}>{item.internal_max_marks ?? 0}</Text>
          </View>
          <View style={sc.markChip}>
            <Text style={sc.markChipLabel}>Practical</Text>
            <Text style={sc.markChipVal}>{item.practical_max_marks ?? 0}</Text>
          </View>
          <View style={[sc.markChip, sc.markChipTotal]}>
            <Text style={[sc.markChipLabel, { color: "#fff" }]}>Total</Text>
            <Text style={[sc.markChipVal, { color: "#fff", fontSize: 15 }]}>{item.max_marks ?? 0}</Text>
          </View>
        </View>
      </View>
      <View style={sc.actions}>
        <TouchableOpacity style={[sc.iconBtn, { backgroundColor: "#eff6ff" }]} onPress={() => openEdit(item)}>
          <MaterialIcons name="edit" size={16} color="#1e40af" />
        </TouchableOpacity>
        <TouchableOpacity style={[sc.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => handleDelete(item)}>
          <MaterialIcons name="delete-outline" size={16} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={sc.container}>

      {/* Header */}
      <View style={sc.headerBlock}>
        {/* <Text style={sc.title}>Max Marks</Text>
        <Text style={sc.subtitle}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</Text> */}
        <TouchableOpacity style={sc.addBtn} onPress={openAdd}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={sc.addBtnTxt}>Add Max Marks</Text>
        </TouchableOpacity>
      </View>

      {/* Class filter */}
      <View style={sc.filterWrap}>
        <Text style={sc.filterLabel}>Filter by Class</Text>
        <Dropdown
          label="All Classes"
          value={filterClass}
          options={classOptions}
          onChange={setFilterClass}
          loading={loading}
        />
      </View>

      {/* List */}
      {loading
        ? <View style={sc.loader}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={sc.loaderTxt}>Loading…</Text>
          </View>
        : <FlatList
            data={filtered}
            keyExtractor={item => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <View style={sc.empty}>
                <Feather name="edit-3" size={38} color="#cbd5e1" />
                <Text style={sc.emptyTxt}>No records found</Text>
                <Text style={sc.emptySubTxt}>
                  {filterClass ? "Try selecting a different class" : 'Tap "Add Max Marks" to create one'}
                </Text>
              </View>
            }
          />}

      {/* Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={sc.modalOverlay}>
          <View style={sc.modalCard}>

            <View style={sc.modalHeader}>
              <Text style={sc.modalTitle}>{editing ? "Edit Max Marks" : "Add Max Marks"}</Text>
              <TouchableOpacity style={sc.modalClose} onPress={() => setModalVisible(false)} disabled={saving}>
                <Feather name="x" size={15} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >

            {/* Class */}
            <Text style={sc.fieldLabel}>Class <Text style={{ color: "#ef4444" }}>*</Text></Text>
            <Dropdown
              label="Select Class"
              value={form.class_id}
              options={classFormOptions}
              onChange={v => { setField("class_id", v); setField("subject_id", ""); }}
              disabled={saving}
            />

            {/* Subject — cascades from class */}
            <Text style={sc.fieldLabel}>Subject <Text style={{ color: "#ef4444" }}>*</Text></Text>
            <Dropdown
              label="Select Subject"
              value={form.subject_id}
              options={subjectFormOptions}
              onChange={v => setField("subject_id", v)}
              disabled={saving || !form.class_id}
              loading={loadingSubj}
            />

            {/* Marks inputs */}
            <View style={sc.marksCard}>
              <Text style={sc.marksSectionLabel}>Marks Breakdown</Text>
              <MarksInput
                label="Theory"
                value={form.theory_max_marks}
                onChangeText={v => setField("theory_max_marks", v)}
                disabled={saving}
              />
              <MarksInput
                label="Internal"
                value={form.internal_max_marks}
                onChangeText={v => setField("internal_max_marks", v)}
                disabled={saving}
              />
              <MarksInput
                label="Practical"
                value={form.practical_max_marks}
                onChangeText={v => setField("practical_max_marks", v)}
                disabled={saving}
              />

              {/* Auto-calculated total */}
              <View style={[sc.marksRow, sc.totalRow]}>
                <Text style={sc.totalLabel}>Total (Max Marks)</Text>
                <View style={sc.totalValueWrap}>
                  <Text style={sc.totalValue}>{maxMarks}</Text>
                </View>
              </View>
            </View>

            </ScrollView>

            <View style={sc.modalBtns}>
              <TouchableOpacity style={sc.cancelBtn} onPress={() => setModalVisible(false)} disabled={saving}>
                <Text style={sc.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sc.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="check" size={14} color="#fff" /><Text style={sc.saveBtnTxt}>{editing ? "Update" : "Save"}</Text></>}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  headerBlock:    { marginBottom: 12 },
  title:          { fontSize: 17, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  subtitle:       { fontSize: 11, color: "#94a3b8", marginTop: 1, marginBottom: 12 },
  addBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1e40af", paddingVertical: 11, borderRadius: 12, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  addBtnTxt:      { color: "#fff", fontWeight: "700", fontSize: 13 },

  filterWrap:     { marginBottom: 12 },
  filterLabel:    { fontSize: 11, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },

  // Card
  card:           { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardBody:       { flex: 1, marginRight: 8 },
  cardHead:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  subjectName:    { fontSize: 13, fontWeight: "700", color: "#1946b2", flex: 1 },
  codeBadge:      { backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  codeTxt:        { fontSize: 10, fontWeight: "800", color: "#1e40af" },
  className:      { fontSize: 11, color: "#94a3b8", marginBottom: 10 },

  marksStrip:     { flexDirection: "row", gap: 6 },
  markChip:       { flex: 1, backgroundColor: "#f8fafc", borderRadius: 9, padding: 8, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  markChipTotal:  { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  markChipLabel:  { fontSize: 9, fontWeight: "600", color: "#94a3b8", textTransform: "uppercase", marginBottom: 3 },
  markChipVal:    { fontSize: 13, fontWeight: "800", color: "#0f172a" },

  actions:        { gap: 6 },
  iconBtn:        { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  loader:         { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:      { color: "#64748b", fontSize: 13 },
  empty:          { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:       { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:    { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Modal
  modalOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  modalCard:      { backgroundColor: "#fff", borderRadius: 20, padding: 18, width: "100%", maxHeight: "88%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  modalTitle:     { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:     { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:     { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 7 },

  // Marks card
  marksCard:           { backgroundColor: "#f8fafc", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 14 },
  marksSectionLabel:   { fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  marksRow:            { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  marksLabel:          { fontSize: 13, color: "#374151", fontWeight: "500", flex: 1 },
  marksInput:          { width: 90, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: "#0f172a", backgroundColor: "#fff", textAlign: "center" },
  totalRow:            { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#e2e8f0", marginBottom: 0 },
  totalLabel:          { fontSize: 13, color: "#0f172a", fontWeight: "700", flex: 1 },
  totalValueWrap:      { width: 90, backgroundColor: "#1e40af", borderRadius: 9, paddingVertical: 8, alignItems: "center" },
  totalValue:          { fontSize: 14, fontWeight: "800", color: "#fff" },

  modalBtns:      { flexDirection: "row", justifyContent: "flex-end", gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#f1f5f9", marginTop: 4 },
  cancelBtn:      { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt:   { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:        { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:     { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Dropdown
  dropTrigger:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 14 },
  dropTxt:          { flex: 1, fontSize: 13, color: "#0f172a" },
  dropPh:           { color: "#94a3b8" },
  dropOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  dropSheet:        { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%", maxHeight: "65%" },
  dropTitle:        { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
  dropOptionActive: { backgroundColor: "#eff6ff" },
  dropOptionTxt:    { fontSize: 13, color: "#0f172a" },
  dropOptionTxtActive: { color: "#1e40af", fontWeight: "700" },
});