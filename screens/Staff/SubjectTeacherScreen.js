/**
 * screens/Setup/SubjectTeacherScreen.js
 * Assign teachers to subjects per class/section
 * Cascading dropdowns: Branch → Class → Section → Subject → Staff
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";

import { fetchBranches, fetchClasses, fetchSections } from "../../services/SetupServiceApi";
import { fetchSubjectTeachers, createSubjectTeacher,
  updateSubjectTeacher, deleteSubjectTeacher, fetchSubjects } from "../../services/SubjectServiceApi";
import { fetchStaff } from "../../services/StaffServiceApi";

// ── Custom Dropdown ────────────────────────────────────────────────────────────
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

// ── Field wrapper ──────────────────────────────────────────────────────────────
const Field = ({ label, required, children }) => (
  <View style={sc.field}>
    <Text style={sc.fieldLabel}>
      {label}{required && <Text style={{ color: "#ef4444" }}> *</Text>}
    </Text>
    {children}
  </View>
);

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function SubjectTeacherScreen() {
  const { user } = useContext(AuthContext);

  // List data
  const [assignments, setAssignments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [modalVisible,setModalVisible]= useState(false);
  const [editing,     setEditing]     = useState(null);
  const [search,      setSearch]      = useState("");

  // Static options (load once)
  const [branches,  setBranches]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [staffList, setStaffList] = useState([]);

  // Cascading options (load on selection)
  const [sections,  setSections]  = useState([]);
  const [subjects,  setSubjects]  = useState([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  // Form state
  const [form, setForm] = useState({
    branch_id:  "",
    class_id:   "",
    section_id: "",
    subject_id: "",
    staff_id:   "",
  });
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Load list + static dropdowns ──────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [assignData, branchData, classData, staffData] = await Promise.all([
        fetchSubjectTeachers(user),
        fetchBranches(user),
        fetchClasses(user),
        fetchStaff(user),
      ]);
      setAssignments(Array.isArray(assignData) ? assignData : []);
      setBranches(Array.isArray(branchData) ? branchData : branchData?.data ?? []);
      setClasses(Array.isArray(classData)   ? classData  : classData?.data  ?? []);
      setStaffList(Array.isArray(staffData) ? staffData  : staffData?.data  ?? []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Load sections when class changes ─────────────────────────────────────
  useEffect(() => {
    if (!form.class_id) { setSections([]); setField("section_id", ""); return; }
    let cancelled = false;
    setLoadingSections(true);
    setSections([]); setField("section_id", "");
    fetchSections(user, form.class_id)
      .then(d => {
        if (cancelled) return;
        setSections(Array.isArray(d) ? d : d?.data ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSections(false); });
    return () => { cancelled = true; };
  }, [form.class_id]);

  // ── Load subjects when class changes ──────────────────────────────────────
  useEffect(() => {
    if (!form.class_id) { setSubjects([]); setField("subject_id", ""); return; }
    let cancelled = false;
    setLoadingSubjects(true);
    setSubjects([]); setField("subject_id", "");
    fetchSubjects(user, form.class_id)
      .then(d => {
        if (cancelled) return;
        setSubjects(Array.isArray(d) ? d : d?.data ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [form.class_id]);

  // ── Open modals ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setForm({ branch_id: "", class_id: "", section_id: "", subject_id: "", staff_id: "" });
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      branch_id:  item.branch_id  ? String(item.branch_id)  : "",
      class_id:   item.class_id   ? String(item.class_id)   : "",
      section_id: item.section_id ? String(item.section_id) : "",
      subject_id: item.subject_id ? String(item.subject_id) : "",
      staff_id:   item.staff_id   ? String(item.staff_id)   : "",
    });
    setModalVisible(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.class_id)   { Alert.alert("Validation", "Please select a class.");   return; }
    if (!form.subject_id) { Alert.alert("Validation", "Please select a subject."); return; }
    if (!form.staff_id)   { Alert.alert("Validation", "Please select a staff.");   return; }
    try {
      setSaving(true);
      if (editing) {
        await updateSubjectTeacher(user, editing.id, form);
      } else {
        await createSubjectTeacher(user, form);
      }
      setModalVisible(false);
      load();
      Alert.alert("Success", editing ? "Assignment updated." : "Assignment created.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Delete Assignment",
      `Remove ${item.staff_name?.trim()} from "${item.subject_name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteSubjectTeacher(user, item.id);
              load();
            } catch (e) {
              Alert.alert("Error", e.message || "Failed to delete");
            }
          },
        },
      ]
    );
  };

  // ── Options ───────────────────────────────────────────────────────────────
  const branchOptions  = [{ label: "Select Branch",  value: "" }, ...branches.map(b  => ({ label: b.branch_name,   value: String(b.branch_id)   }))];
  const classOptions   = [{ label: "Select Class",   value: "" }, ...classes.map(c   => ({ label: c.class_name,    value: String(c.class_id)    }))];
  const sectionOptions = [{ label: "Select Section", value: "" }, ...sections.map(s  => ({ label: s.section_name,  value: String(s.section_id)  }))];
  const subjectOptions = [{ label: "Select Subject", value: "" }, ...subjects.map(s  => ({ label: s.subject_name,  value: String(s.subject_id)  }))];
  const staffOptions   = [{ label: "Select Staff",   value: "" }, ...staffList.map(s => ({ label: s.display_name ?? `${s.first_name} ${s.last_name}`, value: String(s.staff_id) }))];

  // ── Filter list ───────────────────────────────────────────────────────────
  const filtered = assignments.filter(a => {
    const q = search.toLowerCase();
    return !q ||
      (a.subject_name ?? "").toLowerCase().includes(q) ||
      (a.staff_name   ?? "").toLowerCase().includes(q) ||
      (a.class_name   ?? "").toLowerCase().includes(q) ||
      (a.section_name ?? "").toLowerCase().includes(q);
  });

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => (
    <View style={sc.card}>
      <View style={sc.cardBody}>
        {/* Subject + code */}
        <View style={sc.cardTopRow}>
          <View style={sc.subjectBadge}>
            <Text style={sc.subjectBadgeTxt} numberOfLines={1}>{item.subject_code || "—"}</Text>
          </View>
          <Text style={sc.subjectName} numberOfLines={1}>{item.subject_name}</Text>
        </View>
        {/* Meta */}
        <View style={sc.metaRow}>
          <View style={sc.metaItem}>
            <Feather name="book-open" size={10} color="#94a3b8" />
            <Text style={sc.metaTxt}>{item.class_name ?? "—"}</Text>
          </View>
          <View style={sc.metaItem}>
            <Feather name="layers" size={10} color="#94a3b8" />
            <Text style={sc.metaTxt}>{item.section_name ?? "All Sections"}</Text>
          </View>
          <View style={sc.metaItem}>
            <Feather name="home" size={10} color="#94a3b8" />
            <Text style={sc.metaTxt}>{item.branch_name ?? "—"}</Text>
          </View>
        </View>
        {/* Staff */}
        <View style={sc.staffRow}>
          <View style={sc.staffAvatar}>
            <Text style={sc.staffAvatarTxt}>
              {(item.staff_name?.trim()?.[0] ?? "?").toUpperCase()}
            </Text>
          </View>
          <Text style={sc.staffName}>{item.staff_name?.trim() || "—"}</Text>
        </View>
      </View>
      {/* Actions */}
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
        <Text style={sc.title}>Subject Teachers</Text>
        <Text style={sc.subtitle}>{filtered.length} assignment{filtered.length !== 1 ? "s" : ""}</Text>
        <TouchableOpacity style={sc.addBtn} onPress={openAdd}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={sc.addBtnTxt}>Add Assignment</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={sc.searchWrap}>
        <Feather name="search" size={13} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={sc.searchInput}
          placeholder="Search subject, teacher, class…"
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
                <Feather name="book" size={38} color="#cbd5e1" />
                <Text style={sc.emptyTxt}>No assignments found</Text>
                <Text style={sc.emptySubTxt}>Tap "Add Assignment" to create one</Text>
              </View>
            }
          />}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={sc.modalOverlay}>
          <View style={sc.modalCard}>

            <View style={sc.modalHeader}>
              <Text style={sc.modalTitle}>
                {editing ? "Edit Assignment" : "Add Assignment"}
              </Text>
              <TouchableOpacity style={sc.modalClose} onPress={() => setModalVisible(false)} disabled={saving}>
                <Feather name="x" size={15} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Branch */}
            <Field label="Branch">
              <Dropdown label="Select Branch" value={form.branch_id}
                options={branchOptions} onChange={v => setField("branch_id", v)} disabled={saving} />
            </Field>

            {/* Class — triggers section + subject load */}
            <Field label="Class" required>
              <Dropdown label="Select Class" value={form.class_id}
                options={classOptions}
                onChange={v => { setField("class_id", v); setField("section_id", ""); setField("subject_id", ""); }}
                disabled={saving} />
            </Field>

            {/* Section — loads after class */}
            <Field label="Section">
              <Dropdown label="Select Section" value={form.section_id}
                options={sectionOptions} onChange={v => setField("section_id", v)}
                disabled={saving || !form.class_id} loading={loadingSections} />
            </Field>

            {/* Subject — loads after class */}
            <Field label="Subject" required>
              <Dropdown label="Select Subject" value={form.subject_id}
                options={subjectOptions} onChange={v => setField("subject_id", v)}
                disabled={saving || !form.class_id} loading={loadingSubjects} />
            </Field>

            {/* Staff */}
            <Field label="Staff (Teacher)" required>
              <Dropdown label="Select Staff" value={form.staff_id}
                options={staffOptions} onChange={v => setField("staff_id", v)} disabled={saving} />
            </Field>

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

// ── Styles ─────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  headerBlock:  { marginBottom: 12 },
  title:        { fontSize: 17, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  subtitle:     { fontSize: 11, color: "#94a3b8", marginTop: 1, marginBottom: 12 },
  addBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1e40af", paddingVertical: 11, borderRadius: 12, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  addBtnTxt:    { color: "#fff", fontWeight: "700", fontSize: 13 },

  searchWrap:   { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 11, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 },
  searchInput:  { flex: 1, fontSize: 13, color: "#0f172a" },

  // Card
  card:         { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardBody:     { flex: 1, marginRight: 8 },
  cardTopRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  subjectBadge: { backgroundColor: "#eff6ff", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  subjectBadgeTxt: { fontSize: 11, fontWeight: "800", color: "#1e40af" },
  subjectName:  { fontSize: 13, fontWeight: "700", color: "#1946b2", flex: 1 },
  metaRow:      { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  metaItem:     { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:      { fontSize: 11, color: "#64748b" },
  staffRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  staffAvatar:  { width: 24, height: 24, borderRadius: 7, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  staffAvatarTxt: { fontSize: 11, fontWeight: "800", color: "#1e40af" },
  staffName:    { fontSize: 12, fontWeight: "600", color: "#334155" },
  actions:      { gap: 6 },
  iconBtn:      { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  loader:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:    { color: "#64748b", fontSize: 13 },
  empty:        { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:     { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:  { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  modalCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 18, width: "100%", maxHeight: "88%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  field:        { marginBottom: 12 },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  modalBtns:    { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancelBtn:    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Dropdown
  dropTrigger:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
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