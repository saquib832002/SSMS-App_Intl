import React, { useState, useContext, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchClasses,
  createClass,
  updateClass,
  deleteClass,
} from "../../services/SetupServiceApi";

export default function ClassSetupScreen() {
  const { user } = useContext(AuthContext);

  const [classes, setclasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingclass, setEditingclass] = useState(null);

  const [form, setForm] = useState({
    className: "",
    classDescription: "",
  });

  const loadClasses = useCallback(async () => {
  try {
    console.log("loadClasses called");

    setLoading(true);
    //console.log("class API Response:",  await fetchclasses(user));
    const response = await fetchClasses(user);

    console.log("class API Response:", response);

    const classList = Array.isArray(response)
      ? response
      : Array.isArray(response?.data)
      ? response.data
      : [];

    setclasses(classList);
  } catch (error) {
    console.log("class Load Error:", error);
    Alert.alert("Error", error.message || "Failed to load classes");
  } finally {
    setLoading(false);
  }
}, [user]);

 useFocusEffect(
  useCallback(() => {
    console.log("class screen focused");

    if (user) {
      loadClasses();
    }
  }, [user, loadClasses])
);

  const openAddModal = () => {
    setEditingclass(null);
    setForm({
      className: "",
      classDescription: "",
    });
    setEditingclass(null);
    setModalVisible(true);
  };

  const openEditModal = (ssmsClass) => {
    setEditingclass(ssmsClass);
    setForm({
      className: ssmsClass.class_name || "",
      classDescription: ssmsClass.class_description || "",
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.className.trim()) {
      Alert.alert("Validation", "class name is required");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        class_name: form.className.trim(),
        class_description: form.classDescription.trim(),
      };

      if (editingclass) {
        await updateClass(user, editingclass.class_id, payload);
      } else {
        await createClass(user, payload);
      }

      setModalVisible(false);
      loadClasses();

      Alert.alert(
        "Success",
        editingclass
          ? "Class updated successfully"
          : "Class created successfully with a default Section \"A\"."
      );
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to save class");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (classId) => {
    Alert.alert(
      "Delete class",
      "Are you sure you want to delete this class?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const response = await deleteClass(user, classId);
              loadClasses();
              if (response?.success) {
              Alert.alert("Success", "class deleted successfully");
              } else {
                Alert.alert("Error", response?.message || "Failed to delete class");
              }
            } catch (error) {
              Alert.alert("Error", error.message || "Failed to delete class");
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
   
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.className}>{item.class_name}</Text>
        <Text style={styles.classDescription}>
          {item.class_description || "No description added"}
        </Text>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: "#1e40af" }]}
          onPress={() => openEditModal(item)}
        >
          <MaterialIcons name="edit" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: "#dc2626" }]}
          onPress={() => handleDelete(item.class_id)}
        >
          <MaterialIcons name="delete" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
  <ScrollView
    style={styles.container}
    contentContainerStyle={styles.contentContainer}
    showsVerticalScrollIndicator={false}
  >
    <Text style={styles.pageSubtitle}>
      Add, update and manage all classes for your school.
    </Text>

    <TouchableOpacity style={styles.addClassButton} onPress={openAddModal}>
      <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
      <Text style={styles.addClassButtonText}>Add New Class</Text>
    </TouchableOpacity>

    {loading ? (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#1e40af" />
        <Text style={styles.loaderText}>Loading classes...</Text>
      </View>
    ) : classes.length === 0 ? (
      <View style={styles.emptyCard}>
        <MaterialIcons name="school" size={50} color="#94a3b8" />
        <Text style={styles.emptyTitle}>No Classes Found</Text>
        <Text style={styles.emptyText}>
          Start by adding your first class for the school.
        </Text>
      </View>
    ) : (
      classes.map((item) => (
        <View key={item.class_id} style={styles.classCard}>
          <View style={styles.cardTopRow}>
            <View style={styles.iconWrap}>
              <MaterialIcons name="menu-book" size={26} color="#1e40af" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.className}>{item.class_name}</Text>
              <Text style={styles.classDescription}>
                {item.class_description || "No description added"}
              </Text>
            </View>

            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>
                {item.status || "Active"}
              </Text>
            </View>
          </View>

          <View style={styles.cardFooter}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => openEditModal(item)}
            >
              <MaterialIcons name="edit" size={18} color="#1e40af" />
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDelete(item.class_id)}
            >
              <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))
    )}

    <Modal visible={modalVisible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>
            {editingclass ? "Edit Class" : "Add New Class"}
          </Text>

          <Text style={styles.fieldLabel}>Class Name <Text style={{ color: "#ef4444" }}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="Enter class name"
            placeholderTextColor="#94a3b8"
            value={form.className}
            onChangeText={(value) =>
              setForm((prev) => ({ ...prev, className: value }))
            }
          />

          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter class description"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={4}
            value={form.classDescription}
            onChangeText={(value) =>
              setForm((prev) => ({ ...prev, classDescription: value }))
            }
          />

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalButton, styles.saveButton]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {editingclass ? "Update Class" : "Save Class"}
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
    marginBottom: 4,
  },

  pageSubtitle: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 20,
  },

  addClassButton: {
    backgroundColor: "#1e40af",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: "#1e40af",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },

  addClassButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 10,
  },

  loaderWrap: {
    paddingVertical: 40,
    justifyContent: "center",
    alignItems: "center",
  },

  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },

  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 30,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginTop: 12,
  },

  emptyText: {
    marginTop: 8,
    color: "#64748b",
    textAlign: "center",
  },

  classCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderLeftWidth: 3,
    borderLeftColor: "#1e40af",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  className: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1946b2",
    marginBottom: 4,
  },

  classDescription: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 18,
  },

  statusBadge: {
    backgroundColor: "#dcfce7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginLeft: 10,
  },

  statusText: {
    color: "#16a34a",
    fontWeight: "700",
    fontSize: 12,
  },

  cardInfoSection: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 14,
  },

  infoItem: {
    marginBottom: 10,
  },

  infoLabel: {
    fontSize: 12,
    color: "#94a3b8",
    marginBottom: 2,
    textTransform: "uppercase",
  },

  infoValue: {
    fontSize: 6,
    color: "#334155",
    fontWeight: "600",
  },

  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },

  editButton: {
    flex: 1,
    backgroundColor: "#eff6ff",
    borderRadius: 14,
    paddingVertical: 12,
    marginRight: 8,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },

  editButtonText: {
    color: "#1e40af",
    fontWeight: "700",
    marginLeft: 6,
  },

  deleteButton: {
    flex: 1,
    backgroundColor: "#fef2f2",
    borderRadius: 14,
    paddingVertical: 12,
    marginLeft: 8,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },

  deleteButtonText: {
    color: "#dc2626",
    fontWeight: "700",
    marginLeft: 6,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    padding: 20,
  },

  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 22,
  },

  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 18,
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
    marginBottom: 14,
  },

  textArea: {
    height: 100,
    textAlignVertical: "top",
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

  cancelButtonText: {
    color: "#334155",
    fontWeight: "700",
  },

  saveButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
});