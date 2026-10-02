/**
 * screens/Setup/SubjectSetupScreen.js
 * School-wide subject catalogue.
 * Subjects here have only a name — assign them to classes via Class Subjects.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchSubjects, createSubject, updateSubject, deleteSubject } from "../../services/SubjectServiceApi";

export default function SubjectSetupScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [subjects,       setSubjects]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [modalVisible,   setModalVisible]   = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [subjectName,    setSubjectName]    = useState("");

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await fetchSubjects(user);
      setSubjects(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load subjects");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Header button ─────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={st.headerBtn}
          onPress={() => navigation.navigate("ClassSubject")}
        >
          <Feather name="layers" size={13} color="#6b21a8" />
          <Text style={st.headerBtnTxt}>Class Subjects</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // ── Modals ────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingSubject(null);
    setSubjectName("");
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditingSubject(item);
    setSubjectName(item.subject_name ?? "");
    setModalVisible(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!subjectName.trim()) { Alert.alert("Validation", "Subject name is required."); return; }
    try {
      setSaving(true);
      if (editingSubject) {
        await updateSubject(user, editingSubject.subject_id, { subject_name: subjectName.trim() });
      } else {
        await createSubject(user, { subject_name: subjectName.trim() });
      }
      setModalVisible(false);
      load();
      Alert.alert("Success", editingSubject ? "Subject updated." : "Subject added.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save subject");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Delete Subject",
      `Delete "${item.subject_name}"?\n\nNote: subjects assigned to classes cannot be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteSubject(user, item.subject_id);
              load();
            } catch (e) {
              Alert.alert("Error", e.message || "Failed to delete");
            }
          },
        },
      ]
    );
  };

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const count = parseInt(item.class_count ?? 0, 10);
    return (
      <View style={st.card}>
        <View style={st.cardLeft}>
          {/* Initials avatar */}
          <View style={st.avatar}>
            <Text style={st.avatarTxt}>
              {(item.subject_name ?? "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.subjectName}>{item.subject_name}</Text>
            <View style={st.badgeRow}>
              {count > 0
                ? <View style={st.badgeBlue}>
                    <Feather name="layers" size={9} color="#1e40af" />
                    <Text style={st.badgeBlueTxt}>{count} class{count !== 1 ? "es" : ""}</Text>
                  </View>
                : <View style={st.badgeGray}>
                    <Text style={st.badgeGrayTxt}>Unassigned</Text>
                  </View>}
            </View>
          </View>
        </View>
        <View style={st.actions}>
          <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#eff6ff" }]} onPress={() => openEdit(item)}>
            <MaterialIcons name="edit" size={17} color="#1e40af" />
          </TouchableOpacity>
          <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => handleDelete(item)}>
            <MaterialIcons name="delete-outline" size={17} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={st.container}>

      {/* List */}
      {loading
        ? <View style={st.loader}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={st.loaderTxt}>Loading subjects…</Text>
          </View>
        : <FlatList
            data={subjects}
            keyExtractor={item => String(item.subject_id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 80 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <View style={st.empty}>
                <Feather name="book" size={38} color="#cbd5e1" />
                <Text style={st.emptyTxt}>No subjects yet</Text>
                <Text style={st.emptySubTxt}>Tap "Add Subject" to create one</Text>
              </View>
            }
          />}

      {/* Add Subject — sticky bottom */}
      <View style={st.bottomBar}>
        <TouchableOpacity style={st.addBtn} onPress={openAdd}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={st.addBtnTxt}>Add Subject</Text>
        </TouchableOpacity>
      </View>

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => !saving && setModalVisible(false)}>
        <View style={st.modalOverlay}>
          <View style={st.modalCard}>

            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>{editingSubject ? "Edit Subject" : "Add Subject"}</Text>
              <TouchableOpacity style={st.modalClose} onPress={() => setModalVisible(false)} disabled={saving}>
                <Feather name="x" size={15} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={st.fieldLabel}>Subject Name <Text style={{ color: "#ef4444" }}>*</Text></Text>
            <TextInput
              style={st.input}
              placeholder="e.g. Mathematics"
              placeholderTextColor="#94a3b8"
              value={subjectName}
              onChangeText={setSubjectName}
              editable={!saving}
              autoFocus
            />

            <View style={st.modalBtns}>
              <TouchableOpacity style={st.cancelBtn} onPress={() => setModalVisible(false)} disabled={saving}>
                <Text style={st.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Feather name="check" size={14} color="#fff" />
                      <Text style={st.saveBtnTxt}>{editingSubject ? "Update" : "Save"}</Text>
                    </>}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

    </View>
  );
}

const st = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  // Nav header button
  headerBtn:    { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5, borderColor: "#6b21a8", backgroundColor: "#faf5ff" },
  headerBtnTxt: { fontSize: 12, fontWeight: "700", color: "#6b21a8" },

  // Bottom bar
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 14, backgroundColor: "#f8fafc", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  addBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1e40af", paddingVertical: 11, borderRadius: 12, elevation: 3, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  addBtnTxt:       { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Card
  card:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  cardLeft:   { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, marginRight: 8 },
  avatar:     { width: 38, height: 38, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 16, fontWeight: "800", color: "#1e40af" },
  subjectName:{ fontSize: 13, fontWeight: "700", color: "#1946b2" },
  badgeRow:   { flexDirection: "row", marginTop: 4 },
  badgeBlue:  { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeBlueTxt: { fontSize: 10, fontWeight: "700", color: "#1e40af" },
  badgeGray:  { backgroundColor: "#f1f5f9", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeGrayTxt: { fontSize: 10, fontWeight: "600", color: "#94a3b8" },
  actions:    { flexDirection: "row", gap: 6 },
  iconBtn:    { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  // Loader / empty
  loader:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:  { color: "#64748b", fontSize: 13 },
  empty:      { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:   { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:{ fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modalCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 20, width: "100%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 7 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 13, color: "#0f172a", marginBottom: 14 },
  modalBtns:    { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  cancelBtn:    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },
});
