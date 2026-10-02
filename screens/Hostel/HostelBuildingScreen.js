/**
 * screens/Hostel/HostelBuildingScreen.js
 *
 * Hostel Building management — list, add, edit, delete.
 * Admin / owner only for mutations. All roles can view.
 */
import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchBuildings, saveBuilding, deleteBuilding } from "../../services/HostelServiceApi";

// ─── Building type options ────────────────────────────────────────────────────
const BUILDING_TYPES = ["Hostel", "School"];

// ─── Custom Dropdown ──────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={[fm.input, fm.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)} activeOpacity={0.7}
      >
        <Text style={value ? fm.dropTxt : fm.dropPlaceholder}>{value || label}</Text>
        <Feather name="chevron-down" size={16} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={fm.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={fm.dropSheet}>
            <Text style={fm.dropTitle}>{label}</Text>
            {options.map(o => (
              <TouchableOpacity key={o} style={[fm.dropOption, o === value && fm.dropOptionActive]}
                onPress={() => { onChange(o); setOpen(false); }}>
                <Text style={[fm.dropOptionTxt, o === value && fm.dropOptionTxtActive]}>{o}</Text>
                {o === value && <Feather name="check" size={14} color="#6366f1" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
function BuildingFormModal({ visible, building, onClose, onSave }) {
  const [form, setForm] = useState({
    building_number: "",
    building_name:   "",
    building_type:   "",
  });
  const [saving, setSaving] = useState(false);

  // Reset form every time modal opens (add) or building changes (edit)
  useEffect(() => {
    if (visible) {
      setForm({
        building_number: building?.building_number ?? "",
        building_name:   building?.building_name   ?? "",
        building_type:   building?.building_type   ?? "",
      });
    } else {
      // Clear when modal closes so next open starts fresh
      setForm({ building_number: "", building_name: "", building_type: "" });
      setSaving(false);
    }
  }, [visible, building]);

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!form.building_name.trim())   { Alert.alert("Validation", "Building name is required.");   return; }
    if (!form.building_number.trim()) { Alert.alert("Validation", "Building number is required."); return; }
    if (!form.building_type)          { Alert.alert("Validation", "Building type is required.");   return; }
    try {
      setSaving(true);
      await onSave({ ...form, building_id: building?.building_id });
      setForm({ building_number: "", building_name: "", building_type: "" });
    } catch (e) {
      Alert.alert("Save Failed", e.message ?? "Could not save building. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity
          style={fm.overlay}
          onPress={!saving ? onClose : undefined}
          activeOpacity={1}
        >
          <TouchableOpacity style={fm.sheet} onPress={() => {}} activeOpacity={1}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={fm.handle} />
              <Text style={fm.title}>{building ? "Edit Building" : "Add Building"}</Text>

              <Text style={fm.label}>Building Name *</Text>
              <TextInput
                style={fm.input}
                value={form.building_name}
                onChangeText={v => set("building_name", v)}
                placeholder="e.g. Block A"
                placeholderTextColor="#94a3b8"
                editable={!saving}
                returnKeyType="next"
              />

              <Text style={fm.label}>Building Number *</Text>
              <TextInput
                style={fm.input}
                value={form.building_number}
                onChangeText={v => set("building_number", v)}
                placeholder="e.g. B-01"
                placeholderTextColor="#94a3b8"
                editable={!saving}
                returnKeyType="done"
              />

              <Text style={fm.label}>Building Type *</Text>
              <Dropdown
                label="Select type…"
                value={form.building_type}
                options={BUILDING_TYPES}
                onChange={v => set("building_type", v)}
                disabled={saving}
              />

              <TouchableOpacity
                style={[fm.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={fm.saveTxt}> Saving…</Text></>
                  : <><Feather name="check-circle" size={18} color="#fff" /><Text style={fm.saveTxt}> {building ? "Update" : "Add Building"}</Text></>}
              </TouchableOpacity>

              {!saving && (
                <TouchableOpacity style={fm.cancelBtn} onPress={onClose}>
                  <Text style={fm.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Building Card ────────────────────────────────────────────────────────────
const BUILDING_TYPE_COLORS = {
  Boys:  { bg: "#eff6ff", border: "#bfdbfe", icon: "#2563eb" },
  Girls: { bg: "#fdf4ff", border: "#e9d5ff", icon: "#9333ea" },
  Mixed: { bg: "#f0fdf4", border: "#bbf7d0", icon: "#16a34a" },
  Staff: { bg: "#fffbeb", border: "#fde68a", icon: "#d97706" },
  Other: { bg: "#f8fafc", border: "#e2e8f0", icon: "#64748b" },
};

function BuildingCard({ item, isAdmin, onEdit, onDelete, onRooms }) {
  const colors = BUILDING_TYPE_COLORS[item.building_type] ?? BUILDING_TYPE_COLORS.Other;
  return (
    <View style={[st.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <View style={st.cardTop}>
        <View style={[st.iconCircle, { backgroundColor: colors.icon + "22" }]}>
          <Feather name="home" size={24} color={colors.icon} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={st.cardName}>{item.building_name}</Text>
          <Text style={st.cardSub}>No. {item.building_number}</Text>
          <View style={[st.typeBadge, { backgroundColor: colors.icon }]}>
            <Text style={st.typeBadgeTxt}>{item.building_type}</Text>
          </View>
        </View>
        {isAdmin && (
          <View style={st.cardActions}>
            <TouchableOpacity style={st.iconBtn} onPress={() => onEdit(item)}>
              <Feather name="edit-2" size={15} color="#6366f1" />
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => onDelete(item)}>
              <Feather name="trash-2" size={15} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}
      </View>
      <TouchableOpacity style={[st.roomsBtn, { borderColor: colors.border }]} onPress={() => onRooms(item)}>
        <Feather name="grid" size={14} color={colors.icon} />
        <Text style={[st.roomsBtnTxt, { color: colors.icon }]}>View Rooms</Text>
        <Feather name="chevron-right" size={14} color={colors.icon} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HostelBuildingScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const isAdmin = ['admin','owner'].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim()
  );

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const [buildings, setBuildings] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editBuilding, setEditBuilding] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchBuildings(userRef.current);
      setBuildings(data);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async (formData) => {
    try {
      await saveBuilding(userRef.current, formData);
      setModalVisible(false);
      setEditBuilding(null);
      load();
      Alert.alert("✅ Success", formData.building_id ? "Building updated." : "Building added.");
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  }, [load]);

  const handleDelete = useCallback((item) => {
    Alert.alert(
      "Delete Building",
      `Delete "${item.building_name}"? This will fail if rooms are assigned to it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteBuilding(userRef.current, item.building_id);
              load();
            } catch (e) {
              Alert.alert("Cannot Delete", e.message);
            }
          },
        },
      ]
    );
  }, [load]);

  const filtered = useMemo(() =>
    buildings.filter(b =>
      b.building_name?.toLowerCase().includes(search.toLowerCase()) ||
      b.building_number?.toLowerCase().includes(search.toLowerCase()) ||
      b.building_type?.toLowerCase().includes(search.toLowerCase())
    ),
  [buildings, search]);

  const renderItem = useCallback(({ item }) => (
    <BuildingCard
      item={item} isAdmin={isAdmin}
      onEdit={b => { setEditBuilding(b); setModalVisible(true); }}
      onDelete={handleDelete}
      onRooms={b => navigation.navigate("HostelRooms", { building: b })}
    />
  ), [isAdmin, handleDelete, navigation]);

  return (
    <SafeAreaView style={sc.safe} edges={["top"]}>
      {/* Header */}
      <View style={sc.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={sc.backBtn}>
          <Feather name="arrow-left" size={20} color="#6366f1" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={sc.headerTitle}>Hostel Buildings</Text>
          <Text style={sc.headerSub}>{buildings.length} building{buildings.length !== 1 ? "s" : ""}</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={sc.addBtn} onPress={() => { setEditBuilding(null); setModalVisible(true); }}>
            <Feather name="plus" size={18} color="#fff" />
            <Text style={sc.addBtnTxt}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search */}
      <View style={sc.searchWrap}>
        <Feather name="search" size={15} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput style={sc.searchInput} placeholder="Search buildings…"
          placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={15} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {loading
        ? <View style={sc.loader}><ActivityIndicator size="large" color="#6366f1" /><Text style={sc.loaderTxt}>Loading buildings…</Text></View>
        : <FlatList
            data={filtered}
            keyExtractor={b => String(b.building_id)}
            renderItem={renderItem}
            contentContainerStyle={sc.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={sc.empty}>
                <Feather name="home" size={44} color="#cbd5e1" />
                <Text style={sc.emptyTitle}>No buildings yet</Text>
                <Text style={sc.emptyTxt}>{isAdmin ? 'Tap "Add" to create your first building.' : "No buildings have been added."}</Text>
              </View>
            }
          />}

      <BuildingFormModal
        visible={modalVisible} building={editBuilding}
        onClose={() => { setModalVisible(false); setEditBuilding(null); }}
        onSave={handleSave}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#f8fafc" },
  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e0e7ff", gap: 12 },
  backBtn:    { width: 38, height: 38, borderRadius: 12, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  headerTitle:{ fontSize: 18, fontWeight: "800", color: "#0f172a" },
  headerSub:  { fontSize: 12, color: "#94a3b8", marginTop: 1 },
  addBtn:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#6366f1", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  addBtnTxt:  { color: "#fff", fontWeight: "700", fontSize: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", margin: 16, marginBottom: 8, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#e0e7ff", height: 46 },
  searchInput:{ flex: 1, fontSize: 14, color: "#0f172a" },
  list:       { padding: 16, paddingTop: 8, gap: 12 },
  loader:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:  { color: "#6366f1", fontWeight: "600" },
  empty:      { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#475569" },
  emptyTxt:   { fontSize: 13, color: "#94a3b8", textAlign: "center", maxWidth: 260 },
});

const st = StyleSheet.create({
  card:        { borderRadius: 18, borderWidth: 1.5, padding: 14, marginBottom: 0, elevation: 2, shadowColor: "#6366f1", shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  cardTop:     { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  iconCircle:  { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardName:    { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 2 },
  cardSub:     { fontSize: 12, color: "#64748b", marginBottom: 6 },
  typeBadge:   { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeTxt:{ fontSize: 10, fontWeight: "700", color: "#fff" },
  cardActions: { gap: 6 },
  iconBtn:     { width: 34, height: 34, borderRadius: 10, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  roomsBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  roomsBtnTxt: { fontSize: 13, fontWeight: "700", flex: 1 },
});

const fm = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:            { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36, maxHeight: "90%" },
  handle:           { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:            { fontSize: 18, fontWeight: "800", color: "#0f172a", marginBottom: 16 },
  label:            { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6, marginTop: 12 },
  input:            { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e0e7ff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0f172a" },
  dropTrigger:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropTxt:          { fontSize: 14, color: "#0f172a", flex: 1 },
  dropPlaceholder:  { fontSize: 14, color: "#94a3b8", flex: 1 },
  dropOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 30 },
  dropSheet:        { backgroundColor: "#fff", borderRadius: 18, padding: 16 },
  dropTitle:        { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 6, borderRadius: 10 },
  dropOptionActive: { backgroundColor: "#ede9fe" },
  dropOptionTxt:    { fontSize: 14, color: "#334155" },
  dropOptionTxtActive:{ color: "#6366f1", fontWeight: "700" },
  saveBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 16, marginTop: 24, marginBottom: 10 },
  saveTxt:          { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:        { backgroundColor: "#f1f5f9", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt:        { fontSize: 14, fontWeight: "700", color: "#475569" },
});