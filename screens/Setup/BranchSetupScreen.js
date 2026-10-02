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
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchBranches,
  createBranch,
  updateBranch,
  deleteBranch,
} from "../../services/SetupServiceApi";

export default function BranchSetupScreen() {
  const { user } = useContext(AuthContext);

  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);

  const [form, setForm] = useState({
    branchName: "",
    branchAddress: "",
  });

  const loadBranches = async () => {
    try {
      setLoading(true);
      const data = await fetchBranches(user);
      setBranches(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to load branches");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadBranches();
    }, [])
  );

  const openAddModal = () => {
    setEditingBranch(null);
    setForm({
      branchName: "",
      branchAddress: "",
    });
    setModalVisible(true);
  };

  const openEditModal = (branch) => {
    setEditingBranch(branch);
    setForm({
      branchName: branch.branch_name || "",
      branchAddress: branch.branch_address || "",
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.branchName.trim()) {
      Alert.alert("Validation", "Branch name is required");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        branch_name: form.branchName.trim(),
        branch_address: form.branchAddress.trim(),
      };

      if (editingBranch) {
        await updateBranch(user, editingBranch.branch_id, payload);
      } else {
        await createBranch(user, payload);
      }

      setModalVisible(false);
      loadBranches();

      Alert.alert(
        "Success",
        editingBranch
          ? "Branch updated successfully"
          : "Branch added successfully"
      );
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to save branch");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (branchId) => {
    Alert.alert(
      "Delete Branch",
      "Are you sure you want to delete this branch?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteBranch(user, branchId);
              loadBranches();
              Alert.alert("Success", "Branch deleted successfully");
            } catch (error) {
              Alert.alert("Error", error.message || "Failed to delete branch");
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.branchName}>{item.branch_name}</Text>
        <Text style={styles.branchAddress}>
          {item.branch_address || "No address added"}
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
          onPress={() => handleDelete(item.branch_id)}
        >
          <MaterialIcons name="delete" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Branch</Text>

        <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
          <MaterialIcons name="add" size={22} color="#fff" />
          <Text style={styles.addButtonText}>Add Branch</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={styles.loaderText}>Loading branches...</Text>
        </View>
      ) : (
        <FlatList
          data={branches}
          keyExtractor={(item) => String(item.branch_id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 30 }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No branches found</Text>
          }
        />
      )}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
              {editingBranch ? "Edit Branch" : "Add Branch"}
            </Text>

            <Text style={styles.fieldLabel}>Branch Name <Text style={{ color: "#ef4444" }}>*</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="Enter branch name"
              placeholderTextColor="#94a3b8"
              value={form.branchName}
              onChangeText={(value) =>
                setForm((prev) => ({ ...prev, branchName: value }))
              }
            />

            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter branch address"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={4}
              value={form.branchAddress}
              onChangeText={(value) =>
                setForm((prev) => ({ ...prev, branchAddress: value }))
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
                    {editingBranch ? "Update" : "Save"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#7d5493",
    letterSpacing: -0.3,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e40af",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: "#1e40af",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "700",
    marginLeft: 6,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },
  emptyText: {
    textAlign: "center",
    color: "#64748b",
    marginTop: 40,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderLeftWidth: 3,
    borderLeftColor: "#1e40af",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  branchName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1946b2",
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  branchAddress: {
    fontSize: 13,
    color: "#64748b",
  },
  actionButtons: {
    flexDirection: "row",
    marginLeft: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
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
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "#f8fafc",
    fontSize: 14,
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
    marginTop: 8,
  },
  modalButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
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