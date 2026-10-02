// SectionManagementScreen.js

import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Dimensions,
  FlatList,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchClasses } from "../../services/StudentServiceApi";
import { fetchStaff } from "../../services/StaffServiceApi";

import {
  fetchSections,
  createSection,
  updateSection,
  deleteSection,
} from "../../services/SetupServiceApi";

const { width } = Dimensions.get("window");
const isTablet = width > 768;


// ── Custom Dropdown — no native Picker, dark mode safe ───────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[ddSt.trigger, disabled && ddSt.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[ddSt.triggerTxt, !selected?.value && ddSt.placeholder]} numberOfLines={1}>
          {selected?.label ?? label}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={ddSt.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={ddSt.sheet}>
            <Text style={ddSt.title}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[ddSt.option, String(o.value) === String(value) && ddSt.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[ddSt.optionTxt, String(o.value) === String(value) && ddSt.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#1e40af" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f8fafc" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const ddSt = StyleSheet.create({
  trigger:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14 },
  disabled:       { opacity: 0.45 },
  triggerTxt:     { flex: 1, fontSize: 15, color: "#0f172a" },
  placeholder:    { color: "#94a3b8" },
  overlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:          { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  title:          { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:   { backgroundColor: "#eff6ff" },
  optionTxt:      { fontSize: 15, color: "#0f172a" },
  optionTxtActive:{ color: "#1e40af", fontWeight: "700" },
});

export default function SectionSetupScreen() {
  const { user } = useContext(AuthContext);

  const [sections, setSections] = useState([]);
  const [classes,  setClasses]  = useState([]);
  const [staff,       setStaff]       = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSection, setEditingSection] = useState(null);

  const [form, setForm] = useState({
    sectionName: "",
    capacity: "",
    classId: "",
    staffId: "",
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [sectionResponse, classResponse] = await Promise.all([
        fetchSections(user),
        fetchClasses(user),
      ]);

      const normalizedSections = Array.isArray(sectionResponse)
        ? sectionResponse
        : sectionResponse?.data || [];

      const normalizedClasses = Array.isArray(classResponse)
        ? classResponse
        : classResponse?.data || [];

      setSections(normalizedSections);
      setClasses(normalizedClasses);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to load section data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setForm({
      sectionName: "",
      capacity: "",
      classId: "",
      staffId: "",
    });
    setEditingSection(null);
  };


  // ── Fetch staff fresh when modal opens ───────────────────────────────────
  const loadStaff = async () => {
    try {
      setLoadingStaff(true);
      const data = await fetchStaff(user);
      const list = Array.isArray(data) ? data : data?.data ?? [];
      setStaff(list);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load staff list");
    } finally {
      setLoadingStaff(false);
    }
  };

  const openAddModal = () => {
    resetForm();
    setStaff([]);       // clear previous staff list
    setModalVisible(true);
    loadStaff();        // fetch fresh on modal open
  };

  const openEditModal = (item) => {
    setEditingSection(item);

    setForm({
      sectionName: item.section_name || "",
      capacity: String(item.capacity || ""),
      classId: String(item.class_id || ""),
      staffId: String(item.staff_id || ""),
    });

    setStaff([]);       // clear previous staff list
    setModalVisible(true);
    loadStaff();        // fetch fresh on modal open
  };

  const handleSave = async () => {
    if (!form.sectionName.trim()) {
      Alert.alert("Validation", "Please enter section name");
      return;
    }

    if (!form.classId) {
      Alert.alert("Validation", "Please select class");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        section_name: form.sectionName,
        capacity: form.capacity,
        class_id: form.classId,
        staff_id: form.staffId,
      };

      if (editingSection) {
        const response = await updateSection(editingSection.section_id, user, payload);
        if (response?.status) {
            Alert.alert("Success", "Section updated successfully");
          } 
        else {
             Alert.alert("Error", response?.message || "Failed to update section");
         }
      } else {
        const response = await createSection(user, payload);
        if (response?.status) {
          Alert.alert("Success", "Section created successfully");
        } else {
          Alert.alert("Error", response?.message || "Failed to create section");
        }
      }

      setModalVisible(false);
      resetForm();
      loadData();
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to save section");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (sectionId) => {
    Alert.alert(
      "Delete Section",
      "Are you sure you want to delete this section?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const response = await deleteSection(sectionId, user);
              if (response?.status) {
                Alert.alert("Success", "Section deleted successfully");
              } else {
                Alert.alert("Error", response?.message || "Failed to delete section");
              }
              loadData();
            } catch (error) {
              Alert.alert("Error", error.message || "Failed to delete section");
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageSubtitle}>
        Create, update and manage school sections and capacity.
      </Text>

      <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
        <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.addButtonText}>Add New Section</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={styles.loaderText}>Loading sections...</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialIcons name="view-module" size={50} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No Sections Found</Text>
          <Text style={styles.emptyText}>
            Start by creating your first section.
          </Text>
        </View>
      ) : (
        <View style={styles.cardGrid}>
          {sections.map((item) => {
            const className =
              classes.find(
                (cls) => String(cls.class_id) === String(item.class_id)
              )?.class_name || "Unknown Class";

            return (
              <View key={item.section_id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconBox}>
                    <MaterialIcons
                      name="meeting-room"
                      size={24}
                      color="#1e40af"
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionName}>{item.section_name}</Text>
                    <Text style={styles.classText}>{className}</Text>
                  </View>

                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Active</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Capacity</Text>
                  <Text style={styles.infoValue}>{item.capacity || 0}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Class Teacher</Text>
                  <Text style={styles.infoValue}>{item.first_name} {item.last_name || ""}</Text>
                </View>

                <View style={styles.footerButtons}>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => openEditModal(item)}
                  >
                    <MaterialIcons name="edit" size={18} color="#1e40af" />
                    <Text style={styles.editButtonText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDelete(item.section_id)}
                  >
                    <MaterialIcons
                      name="delete-outline"
                      size={18}
                      color="#dc2626"
                    />
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
              {editingSection ? "Edit Section" : "Add New Section"}
            </Text>

            <Text style={styles.fieldLabel}>
              Section Name <Text style={{ color: "#ef4444" }}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. A, B, Red"
              placeholderTextColor="#94a3b8"
              value={form.sectionName}
              onChangeText={(value) =>
                setForm((prev) => ({ ...prev, sectionName: value }))
              }
            />

            <Text style={styles.fieldLabel}>Capacity</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 40"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={form.capacity}
              onChangeText={(value) =>
                setForm((prev) => ({ ...prev, capacity: value }))
              }
            />

            <Text style={styles.fieldLabel}>Class <Text style={{ color: "#ef4444" }}>*</Text></Text>
            <Dropdown
              label="Select Class"
              value={form.classId}
              options={[
                { label: "Select Class", value: "" },
                ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
              ]}
              onChange={(value) => setForm((prev) => ({ ...prev, classId: value }))}
              disabled={saving}
            />

            <Text style={styles.fieldLabel}>Staff (Class Teacher)</Text>
            <Dropdown
              label={loadingStaff ? "Loading staff…" : "Select Staff"}
              value={form.staffId}
              options={[
                { label: loadingStaff ? "Loading…" : "Select Staff", value: "" },
                ...staff.map(s => ({
                  label: s.display_name ?? `${s.first_name} ${s.last_name} (${s.staff_id})`,
                  value: String(s.staff_id),
                })),
              ]}
              onChange={(v) => setForm((prev) => ({ ...prev, staffId: v }))}
              disabled={saving || loadingStaff}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveText}>
                    {editingSection ? "Update" : "Save"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#7d5493",
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 4,
    marginBottom: 20,
  },
  addButton: {
    backgroundColor: "#1e40af",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "700",
    marginLeft: 8,
  },
  loaderWrap: {
    alignItems: "center",
    marginTop: 50,
  },
  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },
  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 30,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginTop: 12,
  },
  emptyText: {
    color: "#64748b",
    textAlign: "center",
    marginTop: 8,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  card: {
    width: isTablet ? "48%" : "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  sectionName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1946b2",
  },
  classText: {
    color: "#64748b",
    marginTop: 2,
  },
  badge: {
    backgroundColor: "#dcfce7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  badgeText: {
    color: "#16a34a",
    fontSize: 12,
    fontWeight: "700",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  infoLabel: {
    color: "#64748b",
  },
  infoValue: {
    color: "#0f172a",
    fontWeight: "700",
  },
  footerButtons: {
    flexDirection: "row",
    marginTop: 14,
  },
  editButton: {
    flex: 1,
    backgroundColor: "#eff6ff",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    marginRight: 8,
  },
  editButtonText: {
    color: "#1e40af",
    fontWeight: "700",
    marginLeft: 6,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: "#fef2f2",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
  },
  deleteButtonText: {
    color: "#dc2626",
    fontWeight: "700",
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  dropdownWrap: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
    marginBottom: 14,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
  },
  modalButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginLeft: 10,
  },
  cancelButton: {
    backgroundColor: "#e2e8f0",
  },
  saveButton: {
    backgroundColor: "#1e40af",
  },
  cancelText: {
    color: "#334155",
    fontWeight: "700",
  },
  saveText: {
    color: "#fff",
    fontWeight: "700",
  },
});