/**
 * screens/Staff/LeaveTypesScreen.js
 *
 * Admin / Owner — Manage Leave Types
 *   Casual Leave, Medical Leave, Earned Leave, etc.
 *   Create, edit, enable/disable.
 */
import React, {
  useCallback, useContext, useState,
} from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchLeaveTypes, saveLeaveType } from "../../services/LeaveServiceApi";

const C = {
  primary: "#1e40af",
  bg:      "#f1f5f9",
  card:    "#ffffff",
  border:  "#e2e8f0",
  text:    "#1e293b",
  muted:   "#64748b",
  green:   "#16a34a",
  red:     "#dc2626",
};

const BLANK = { id: null, name: "", abbreviation: "", max_days_per_year: "12", carry_forward: false, status: true };

export default function LeaveTypesScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [types,      setTypes]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalV,     setModalV]     = useState(false);
  const [form,       setForm]       = useState(BLANK);
  const [saving,     setSaving]     = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      // fetch all (including inactive) — backend already returns only active; for admin
      // we call without filter (backend returns status=1; admin sees all via edit)
      const data = await fetchLeaveTypes(user);
      setTypes(data);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => { setForm(BLANK); setModalV(true); };
  const openEdit = (t) => {
    setForm({
      id:               t.id,
      name:             t.name,
      abbreviation:     t.abbreviation ?? "",
      max_days_per_year: String(t.max_days_per_year ?? 12),
      carry_forward:    t.carry_forward == 1,
      status:           t.status == 1,
    });
    setModalV(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const abbr = form.abbreviation.trim();
    const days = parseFloat(form.max_days_per_year);

    if (!name) return Alert.alert("Required", "Leave type name is required.");
    if (isNaN(days) || days <= 0) return Alert.alert("Invalid", "Max days must be a positive number.");

    try {
      setSaving(true);
      await saveLeaveType(user, {
        id:                form.id ?? undefined,
        name,
        abbreviation:      abbr,
        max_days_per_year: days,
        carry_forward:     form.carry_forward ? 1 : 0,
        status:            form.status ? 1 : 0,
      });
      setModalV(false);
      load(true);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const renderType = ({ item }) => (
    <View style={st.card}>
      <View style={st.cardLeft}>
        <View style={[st.abbrBadge, item.status != 1 && { backgroundColor: "#f1f5f9" }]}>
          <Text style={[st.abbrTxt, item.status != 1 && { color: C.muted }]}>
            {item.abbreviation || item.name.slice(0,2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.typeName, item.status != 1 && { color: C.muted }]}>
            {item.name}
            {item.status != 1 ? "  (Inactive)" : ""}
          </Text>
          <View style={st.metaRow}>
            <View style={st.metaChip}>
              <Feather name="calendar" size={10} color={C.primary} />
              <Text style={st.metaChipTxt}>{item.max_days_per_year} days/yr</Text>
            </View>
            {item.carry_forward == 1 && (
              <View style={st.metaChip}>
                <Feather name="repeat" size={10} color={C.green} />
                <Text style={[st.metaChipTxt, { color: C.green }]}>Carry forward</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <TouchableOpacity style={st.editBtn} onPress={() => openEdit(item)}>
        <Feather name="edit-2" size={15} color={C.primary} />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={st.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root} edges={["top"]}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Leave Types</Text>
        <TouchableOpacity style={st.addBtn} onPress={openAdd}>
          <Feather name="plus" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={types}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        renderItem={renderType}
        ListEmptyComponent={
          <View style={st.emptyBox}>
            <Feather name="tag" size={48} color={C.border} />
            <Text style={st.emptyTxt}>No leave types yet. Tap + to add.</Text>
          </View>
        }
      />

      {/* Add / Edit Modal */}
      <Modal visible={modalV} transparent animationType="slide" onRequestClose={() => setModalV(false)}>
        <View style={st.modalOverlay}>
          <View style={st.modalSheet}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>{form.id ? "Edit Leave Type" : "New Leave Type"}</Text>
              <TouchableOpacity onPress={() => setModalV(false)}>
                <Feather name="x" size={20} color={C.text} />
              </TouchableOpacity>
            </View>

            <View style={st.modalBody}>
              <Text style={st.label}>Name *</Text>
              <TextInput
                style={st.input}
                placeholder="e.g. Casual Leave"
                placeholderTextColor={C.muted}
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
              />

              <Text style={st.label}>Abbreviation</Text>
              <TextInput
                style={st.input}
                placeholder="e.g. CL"
                placeholderTextColor={C.muted}
                value={form.abbreviation}
                onChangeText={v => setForm(f => ({ ...f, abbreviation: v.toUpperCase().slice(0,5) }))}
                autoCapitalize="characters"
                maxLength={5}
              />

              <Text style={st.label}>Max Days per Year *</Text>
              <TextInput
                style={st.input}
                placeholder="12"
                placeholderTextColor={C.muted}
                value={form.max_days_per_year}
                onChangeText={v => setForm(f => ({ ...f, max_days_per_year: v }))}
                keyboardType="decimal-pad"
              />

              <View style={st.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.switchLabel}>Carry Forward</Text>
                  <Text style={st.switchSub}>Unused days carry to next year</Text>
                </View>
                <Switch
                  value={form.carry_forward}
                  onValueChange={v => setForm(f => ({ ...f, carry_forward: v }))}
                  trackColor={{ false: C.border, true: "#93c5fd" }}
                  thumbColor={form.carry_forward ? C.primary : "#94a3b8"}
                />
              </View>

              <View style={st.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.switchLabel}>Active</Text>
                  <Text style={st.switchSub}>Staff can apply for this leave type</Text>
                </View>
                <Switch
                  value={form.status}
                  onValueChange={v => setForm(f => ({ ...f, status: v }))}
                  trackColor={{ false: C.border, true: "#93c5fd" }}
                  thumbColor={form.status ? C.primary : "#94a3b8"}
                />
              </View>

              <TouchableOpacity
                style={[st.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <Feather name="save" size={16} color="#fff" />
                      <Text style={st.saveBtnTxt}>Save</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.bg },
  center:        { flex: 1, alignItems: "center", justifyContent: "center" },

  header:        { flexDirection: "row", alignItems: "center", backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 14 },
  backBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:   { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: "#fff" },
  addBtn:        { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  card:          { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 12, padding: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  cardLeft:      { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  abbrBadge:     { width: 42, height: 42, borderRadius: 10, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center" },
  abbrTxt:       { fontSize: 12, fontWeight: "800", color: C.primary },
  typeName:      { fontSize: 15, fontWeight: "700", color: C.text },
  metaRow:       { flexDirection: "row", gap: 6, marginTop: 4 },
  metaChip:      { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#eff6ff", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  metaChipTxt:   { fontSize: 10, color: C.primary },
  editBtn:       { padding: 8 },

  emptyBox:      { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyTxt:      { fontSize: 14, color: C.muted, textAlign: "center" },

  modalOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet:    { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle:    { fontSize: 16, fontWeight: "700", color: C.text },
  modalBody:     { padding: 16, gap: 4 },

  label:         { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 6, marginTop: 8 },
  input:         { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text },

  switchRow:     { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  switchLabel:   { fontSize: 14, fontWeight: "600", color: C.text },
  switchSub:     { fontSize: 11, color: C.muted, marginTop: 2 },

  saveBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  saveBtnTxt:    { fontSize: 15, fontWeight: "700", color: "#fff" },
});
