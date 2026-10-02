/**
 * screens/Staff/StaffCategoryScreen.js
 * Staff Category management — list, add, edit, delete
 * Table: staff_category (category_id, category_name, ssms_client_code)
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
  fetchStaffCategories,
  createStaffCategory,
  updateStaffCategory,
  deleteStaffCategory,
} from "../../services/StaffServiceApi";

export default function StaffCategoryScreen() {
  const { user } = useContext(AuthContext);

  const [categories,       setCategories]       = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [modalVisible,     setModalVisible]     = useState(false);
  const [editingCategory,  setEditingCategory]  = useState(null);
  const [categoryName,     setCategoryName]     = useState("");

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchStaffCategories(user);
      setCategories(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { loadCategories(); }, [loadCategories]));

  // ── Open modals ──────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingCategory(null);
    setCategoryName("");
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditingCategory(item);
    setCategoryName(item.category_name ?? "");
    setModalVisible(true);
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!categoryName.trim()) {
      Alert.alert("Validation", "Category name is required.");
      return;
    }
    try {
      setSaving(true);
      if (editingCategory) {
        await updateStaffCategory(user, editingCategory.category_id, {
          category_name: categoryName.trim(),
        });
      } else {
        await createStaffCategory(user, { category_name: categoryName.trim() });
      }
      setModalVisible(false);
      loadCategories();
      Alert.alert("Success", editingCategory ? "Category updated." : "Category added.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Delete Category",
      `Delete "${item.category_name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteStaffCategory(user, item.category_id);
              loadCategories();
              Alert.alert("Deleted", "Category deleted successfully.");
            } catch (e) {
              Alert.alert("Error", e.message || "Failed to delete category");
            }
          },
        },
      ]
    );
  };

  // ── Card ──────────────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }) => (
    <View style={st.card}>
      <View style={st.cardLeft}>
        <View style={st.indexBadge}>
          <Text style={st.indexTxt}>{index + 1}</Text>
        </View>
        <Text style={st.categoryName}>{item.category_name}</Text>
      </View>
      <View style={st.actions}>
        <TouchableOpacity
          style={[st.iconBtn, { backgroundColor: "#eff6ff" }]}
          onPress={() => openEdit(item)}
        >
          <MaterialIcons name="edit" size={18} color="#1e40af" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.iconBtn, { backgroundColor: "#fef2f2" }]}
          onPress={() => handleDelete(item)}
        >
          <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={st.container}>

      {/* Header */}
      <View style={st.headerBlock}>
        <Text style={st.title}>Staff Categories</Text>
        <Text style={st.subtitle}>
          {categories.length} {categories.length === 1 ? "category" : "categories"}
        </Text>
        <TouchableOpacity style={st.addBtn} onPress={openAdd}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={st.addBtnTxt}>Add Category</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading
        ? <View style={st.loader}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={st.loaderTxt}>Loading categories…</Text>
          </View>
        : <FlatList
            data={categories}
            keyExtractor={item => String(item.category_id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <View style={st.empty}>
                <Feather name="tag" size={40} color="#cbd5e1" />
                <Text style={st.emptyTxt}>No categories yet</Text>
                <Text style={st.emptySubTxt}>Tap "Add Category" to create one</Text>
              </View>
            }
          />}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={st.modalOverlay}>
          <View style={st.modalCard}>

            {/* Modal header */}
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>
                {editingCategory ? "Edit Category" : "Add Category"}
              </Text>
              <TouchableOpacity
                style={st.modalClose}
                onPress={() => setModalVisible(false)}
                disabled={saving}
              >
                <Feather name="x" size={16} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Input */}
            <Text style={st.fieldLabel}>
              Category Name <Text style={{ color: "#ef4444" }}>*</Text>
            </Text>
            <TextInput
              style={st.input}
              placeholder="e.g. Teacher, Admin, Support Staff"
              placeholderTextColor="#94a3b8"
              value={categoryName}
              onChangeText={setCategoryName}
              autoFocus
            />

            {/* Buttons */}
            <View style={st.modalBtns}>
              <TouchableOpacity
                style={st.cancelBtn}
                onPress={() => setModalVisible(false)}
                disabled={saving}
              >
                <Text style={st.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[st.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Feather name="check" size={15} color="#fff" />
                      <Text style={st.saveBtnTxt}>
                        {editingCategory ? "Update" : "Save"}
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

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  // Header
  headerBlock:  { marginBottom: 16 },
  title:        { fontSize: 17, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  subtitle:     { fontSize: 11, color: "#94a3b8", marginTop: 1, marginBottom: 12 },
  addBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1e40af", paddingVertical: 11, borderRadius: 12, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  addBtnTxt:    { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Card
  card:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardLeft:     { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  indexBadge:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  indexTxt:     { fontSize: 11, fontWeight: "800", color: "#1e40af" },
  categoryName: { fontSize: 13, fontWeight: "700", color: "#1946b2", flex: 1 },
  actions:      { flexDirection: "row", gap: 6 },
  iconBtn:      { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  // Loader / empty
  loader:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:    { color: "#64748b", fontSize: 13 },
  empty:        { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:     { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:  { fontSize: 12, color: "#cbd5e1" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modalCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 20, width: "100%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 7 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 13, color: "#0f172a", marginBottom: 16 },
  modalBtns:    { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  cancelBtn:    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },
});