/**
 * screens/Setup/SessionSetupScreen.js
 *
 * Session management — list, add, edit, delete.
 * Fields: session_name, is_current (Y/N), active (Yes/No)
 * Uses custom JS Dropdown instead of @react-native-picker/picker
 * to avoid Android dark mode white-on-white bug.
 */
import React, { useState, useContext, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchSessions,
  createSession,
  updateSession,
  deleteSession,
} from "../../services/SetupServiceApi";
import { _t, _tx } from "../../services/i18n";

// ── Custom Dropdown ───────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <>
      <TouchableOpacity
        style={[styles.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.dropTriggerTxt, !selected && styles.dropPlaceholder]} numberOfLines={1}>
          {_tx(selected?.label) ?? _tx(label)}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={styles.dropSheet}>
            <Text style={styles.dropTitle}>{_tx(label)}</Text>
            {options.map(o => (
              <TouchableOpacity
                key={o.value}
                style={[styles.dropOption, o.value === value && styles.dropOptionActive]}
                onPress={() => { onChange(o.value); setOpen(false); }}
              >
                <Text style={[styles.dropOptionTxt, o.value === value && styles.dropOptionTxtActive]}>
                  {_tx(o.label)}
                </Text>
                {o.value === value && <Feather name="check" size={14} color="#1e40af" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Options ───────────────────────────────────────────────────────────────────
const IS_CURRENT_OPTIONS = [
  { get label() { return _t("Yes (Current)"); }, value: "Y" },
  { get label() { return _t("No"); },            value: "N" },
];

const ACTIVE_OPTIONS = [
  { get label() { return _t("Yes"); }, value: "Yes" },
  { get label() { return _t("No"); },  value: "No"  },
];

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SessionSetupScreen() {
  const { user } = useContext(AuthContext);

  const [sessions,        setSessions]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [modalVisible,    setModalVisible]    = useState(false);
  const [editingSession,  setEditingSession]  = useState(null);

  const [form, setForm] = useState({
    session_name: "",
    is_current:   "N",
    active:       "Yes",
  });

  const setField = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadSessions = async () => {
    try {
      setLoading(true);
      const data = await fetchSessions(user);
      if (data?.status === false) throw new Error(data.message || _t("Failed to load sessions"));
      const list = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
          ? data
          : [];
      setSessions(list);
    } catch (error) {
      Alert.alert(_t("Error"), _tx(error.message) || _t("Failed to load sessions"));
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { loadSessions(); }, []));

  // ── Open modals ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingSession(null);
    setForm({ session_name: "", is_current: "N", active: "Yes" });
    setModalVisible(true);
  };

  const openEdit = (session) => {
    setEditingSession(session);
    setForm({
      session_name: session.session_name ?? session.Session_name ?? "",
      is_current:   session.is_current   ?? "N",
      active:       session.active       ?? "Yes",
    });
    setModalVisible(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.session_name.trim()) {
      Alert.alert(_t("Validation"), _t("Session name is required."));
      return;
    }
    try {
      setSaving(true);
      const payload = {
        session_name: form.session_name.trim(),
        is_current:   form.is_current,
        active:       form.active,
      };
      if (editingSession) {
        const id = editingSession.session_id ?? editingSession.Session_id;
        const res = await updateSession(user, id, payload);
        if (res?.status === false) throw new Error(res.message || _t("Failed to update session"));
      } else {
        const res = await createSession(user, payload);
        if (res?.status === false) throw new Error(res.message || _t("Failed to create session"));
      }
      setModalVisible(false);
      loadSessions();
      Alert.alert(_t("Success"), editingSession ? _t("Session updated.") : _t("Session added."));
    } catch (error) {
      Alert.alert(_t("Error"), _tx(error.message) || _t("Failed to save session"));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (session) => {
    const id   = session.session_id ?? session.Session_id;
    const name = session.session_name ?? session.Session_name;
    Alert.alert(
      _t("Delete Session"),
      _t("Delete \"{name}\"?", { name }),
      [
        { text: _t("Cancel"), style: "cancel" },
        {
          text: _t("Delete"), style: "destructive",
          onPress: async () => {
            try {
              const res = await deleteSession(user, id);
              if (res?.status === false) throw new Error(res.message || _t("Failed to delete session"));
              loadSessions();
              Alert.alert(_t("Deleted"), _t("Session deleted successfully."));
            } catch (error) {
              Alert.alert(_t("Error"), _tx(error.message) || _t("Failed to delete session"));
            }
          },
        },
      ]
    );
  };

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const name      = item.session_name   ?? item.Session_name ?? "—";
    const isCurrent = item.is_current     ?? "N";
    const active    = item.active         ?? "Yes";
    return (
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.sessionName}>{_tx(name)}</Text>
            {isCurrent === "Y" && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeTxt}>{_t("Current")}</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <View style={[styles.statusBadge,
              { backgroundColor: active === "Yes" ? "#dcfce7" : "#fee2e2" }]}>
              <Text style={[styles.statusBadgeTxt,
                { color: active === "Yes" ? "#16a34a" : "#dc2626" }]}>
                {active === "Yes" ? _t("Active") : _t("Inactive")}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: "#1e40af" }]}
            onPress={() => openEdit(item)}
          >
            <MaterialIcons name="edit" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: "#dc2626" }]}
            onPress={() => handleDelete(item)}
          >
            <MaterialIcons name="delete" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{_t("Sessions")}</Text>
        <TouchableOpacity style={styles.addButton} onPress={openAdd}>
          <MaterialIcons name="add" size={22} color="#fff" />
          <Text style={styles.addButtonText}>{_t("Add Session")}</Text>
        </TouchableOpacity>
      </View>

      {loading
        ? <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={styles.loaderText}>{_t("Loading sessions…")}</Text>
          </View>
        : <FlatList
            data={sessions}
            keyExtractor={item => String(item.session_id ?? item.Session_id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 30 }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>{_t("No sessions found")}</Text>
            }
          />}

      {/* ── Add / Edit Modal ── */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
              {editingSession ? _t("Edit Session") : _t("Add Session")}
            </Text>

            {/* Session Name */}
            <Text style={styles.fieldLabel}>{_t("Session Name *")}</Text>
            <TextInput
              style={styles.input}
              placeholder={_t("e.g. 2024-25")}
              placeholderTextColor="#94a3b8"
              value={form.session_name}
              onChangeText={v => setField("session_name", v)}
            />

            {/* Is Current */}
            <Text style={styles.fieldLabel}>{_t("Is Current Session?")}</Text>
            <Dropdown
              label={_t("Select…")}
              value={form.is_current}
              options={IS_CURRENT_OPTIONS}
              onChange={v => setField("is_current", v)}
              disabled={saving}
            />

            {/* Active */}
            <Text style={styles.fieldLabel}>{_t("Active")}</Text>
            <Dropdown
              label={_t("Select…")}
              value={form.active}
              options={ACTIVE_OPTIONS}
              onChange={v => setField("active", v)}
              disabled={saving}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setModalVisible(false)}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>{_t("Cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveButtonText}>
                      {editingSession ? _t("Update") : _t("Save")}
                    </Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  headerRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title:            { fontSize: 22, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  addButton:        { flexDirection: "row", alignItems: "center", backgroundColor: "#1e40af", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  addButtonText:    { color: "#fff", fontWeight: "700", marginLeft: 6 },
  loaderWrap:       { flex: 1, justifyContent: "center", alignItems: "center" },
  loaderText:       { marginTop: 10, color: "#64748b" },
  emptyText:        { textAlign: "center", color: "#64748b", marginTop: 40 },

  // Card
  card:             { backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTitleRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
  sessionName:      { fontSize: 15, fontWeight: "800", color: "#1946b2", letterSpacing: -0.2 },
  currentBadge:     { backgroundColor: "#1e40af", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  currentBadgeTxt:  { color: "#fff", fontSize: 11, fontWeight: "700" },
  metaRow:          { flexDirection: "row", gap: 8 },
  statusBadge:      { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeTxt:   { fontSize: 11, fontWeight: "700" },
  actionButtons:    { flexDirection: "row", marginLeft: 12 },
  iconButton:       { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center", marginLeft: 8 },

  // Modal
  modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  modalContainer:   { backgroundColor: "#fff", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#e2e8f0" },
  modalTitle:       { fontSize: 18, fontWeight: "800", color: "#0f172a", marginBottom: 16 },
  fieldLabel:       { fontSize: 13, fontWeight: "600", color: "#475569", marginBottom: 6 },
  input:            { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: "#f8fafc", fontSize: 14, color: "#0f172a", marginBottom: 14 },
  modalButtons:     { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  modalButton:      { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, marginLeft: 10 },
  cancelButton:     { backgroundColor: "#e2e8f0" },
  saveButton:       { backgroundColor: "#1e40af" },
  cancelButtonText: { color: "#334155", fontWeight: "700" },
  saveButtonText:   { color: "#fff", fontWeight: "700" },

  // Dropdown
  dropTrigger:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14 },
  dropTriggerTxt:   { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  dropPlaceholder:  { color: "#94a3b8" },
  dropOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 30 },
  dropSheet:        { backgroundColor: "#fff", borderRadius: 18, padding: 16 },
  dropTitle:        { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  dropOptionActive: { backgroundColor: "#eff6ff" },
  dropOptionTxt:    { fontSize: 14, color: "#0f172a" },
  dropOptionTxtActive: { color: "#1e40af", fontWeight: "700" },
});