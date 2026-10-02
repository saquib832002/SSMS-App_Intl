/**
 * screens/timetable/PeriodSetupScreen.js
 * Manage school periods — sort order, name, times, break flag.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator, Switch,
  ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchPeriods, createPeriod, updatePeriod, deletePeriod } from "../../services/TimeTableServiceApi";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Time picker (simple HH:MM spinner) ───────────────────────────────────────
function TimeInput({ label, value, onChange, disabled }) {
  return (
    <View style={st.timeWrap}>
      <Text style={st.timeLabel}>{label}</Text>
      <TextInput
        style={st.timeInput}
        value={value}
        onChangeText={onChange}
        placeholder="HH:MM"
        placeholderTextColor="#94a3b8"
        keyboardType="numbers-and-punctuation"
        editable={!disabled}
        maxLength={5}
      />
    </View>
  );
}

export default function PeriodSetupScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [periods,      setPeriods]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing,      setEditing]      = useState(null);

  const [form, setForm] = useState({
    period_number: "",
    period_name:   "",
    start_time:    "",
    end_time:      "",
    is_break:      false,
  });
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchPeriods(user);
      setPeriods(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load periods");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Header nav button ──────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity style={st.headerBtn} onPress={() => navigation.navigate("Timetable")}>
          <Feather name="grid" size={13} color="#6b21a8" />
          <Text style={st.headerBtnTxt}>Timetable</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // ── Modals ─────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    const nextNum = periods.length ? Math.max(...periods.map(p => parseInt(p.period_number) || 0)) + 1 : 1;
    setForm({ period_number: String(nextNum), period_name: `Period ${nextNum}`, start_time: "", end_time: "", is_break: false });
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      period_number: String(item.period_number ?? ""),
      period_name:   item.period_name  ?? "",
      start_time:    item.start_time   ?? "",
      end_time:      item.end_time     ?? "",
      is_break:      !!parseInt(item.is_break),
    });
    setModalVisible(true);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.period_number.trim()) { Alert.alert("Validation", "Period number is required."); return; }
    if (!form.period_name.trim())   { Alert.alert("Validation", "Period name is required.");   return; }
    if (!form.start_time.trim())    { Alert.alert("Validation", "Start time is required.");    return; }
    if (!form.end_time.trim())      { Alert.alert("Validation", "End time is required.");      return; }

    try {
      setSaving(true);
      const payload = {
        period_number: parseInt(form.period_number),
        period_name:   form.period_name.trim(),
        start_time:    form.start_time.trim(),
        end_time:      form.end_time.trim(),
        is_break:      form.is_break ? 1 : 0,
      };
      if (editing) {
        await updatePeriod(user, editing.period_id, payload);
      } else {
        await createPeriod(user, payload);
      }
      setModalVisible(false);
      load();
      Alert.alert("Success", editing ? "Period updated." : "Period created.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Alert.alert(
      "Delete Period",
      `Delete "${item.period_name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try { await deletePeriod(user, item.period_id); load(); }
            catch (e) { Alert.alert("Error", e.message || "Failed to delete"); }
          },
        },
      ]
    );
  };

  // ── Row render ─────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => (
    <View style={[st.card, item.is_break == 1 && st.cardBreak]}>
      <View style={st.cardLeft}>
        <View style={[st.numBadge, item.is_break == 1 && st.numBadgeBreak]}>
          <Text style={st.numTxt}>{item.period_number}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={st.cardTitleRow}>
            <Text style={st.periodName}>{item.period_name}</Text>
            {item.is_break == 1 &&
              <View style={st.breakBadge}><Text style={st.breakTxt}>BREAK</Text></View>}
          </View>
          <Text style={st.timeRange}>
            <Feather name="clock" size={11} color="#94a3b8" />
            {"  "}{item.start_time} – {item.end_time}
          </Text>
        </View>
      </View>
      <View style={st.actions}>
        <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#f5f3ff" }]} onPress={() => openEdit(item)}>
          <MaterialIcons name="edit" size={16} color="#6b21a8" />
        </TouchableOpacity>
        <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => handleDelete(item)}>
          <MaterialIcons name="delete-outline" size={16} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={st.container}>

      {/* Add button */}
      <TouchableOpacity style={st.addBtn} onPress={openAdd}>
        <Feather name="plus" size={16} color="#fff" />
        <Text style={st.addBtnTxt}>Add Period</Text>
      </TouchableOpacity>

      {/* List */}
      {loading
        ? <View style={st.loader}><ActivityIndicator size="large" color="#6b21a8" /></View>
        : <FlatList
            data={periods}
            keyExtractor={item => String(item.period_id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <View style={st.empty}>
                <Feather name="clock" size={38} color="#cbd5e1" />
                <Text style={st.emptyTxt}>No periods yet</Text>
                <Text style={st.emptySubTxt}>Tap "Add Period" to get started</Text>
              </View>
            }
          />}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => !saving && setModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={st.modalOverlay}>
            <View style={st.modalCard}>

              <View style={st.modalHeader}>
                <Text style={st.modalTitle}>{editing ? "Edit Period" : "Add Period"}</Text>
                <TouchableOpacity style={st.modalClose} onPress={() => setModalVisible(false)} disabled={saving}>
                  <Feather name="x" size={15} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Period Number */}
                <Text style={st.fieldLabel}>Sort Order (Period #) <Text style={{ color: "#ef4444" }}>*</Text></Text>
                <TextInput
                  style={st.input}
                  value={form.period_number}
                  onChangeText={v => setField("period_number", v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor="#94a3b8"
                  editable={!saving}
                />

                {/* Period Name */}
                <Text style={st.fieldLabel}>Period Name <Text style={{ color: "#ef4444" }}>*</Text></Text>
                <TextInput
                  style={st.input}
                  value={form.period_name}
                  onChangeText={v => setField("period_name", v)}
                  placeholder="e.g. Period 1, Lunch Break"
                  placeholderTextColor="#94a3b8"
                  editable={!saving}
                />

                {/* Times */}
                <View style={st.timeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.fieldLabel}>Start Time <Text style={{ color: "#ef4444" }}>*</Text></Text>
                    <TextInput
                      style={st.input}
                      value={form.start_time}
                      onChangeText={v => setField("start_time", v)}
                      placeholder="08:00"
                      placeholderTextColor="#94a3b8"
                      keyboardType="numbers-and-punctuation"
                      editable={!saving}
                      maxLength={5}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.fieldLabel}>End Time <Text style={{ color: "#ef4444" }}>*</Text></Text>
                    <TextInput
                      style={st.input}
                      value={form.end_time}
                      onChangeText={v => setField("end_time", v)}
                      placeholder="08:45"
                      placeholderTextColor="#94a3b8"
                      keyboardType="numbers-and-punctuation"
                      editable={!saving}
                      maxLength={5}
                    />
                  </View>
                </View>

                {/* Is Break */}
                <View style={st.switchRow}>
                  <View>
                    <Text style={st.fieldLabel}>Break Slot</Text>
                    <Text style={st.switchDesc}>Break periods cannot be assigned a teacher</Text>
                  </View>
                  <Switch
                    value={form.is_break}
                    onValueChange={v => setField("is_break", v)}
                    trackColor={{ false: "#e2e8f0", true: "#a78bfa" }}
                    thumbColor={form.is_break ? "#6b21a8" : "#fff"}
                    disabled={saving}
                  />
                </View>

              </ScrollView>

              <View style={st.modalBtns}>
                <TouchableOpacity style={st.cancelBtn} onPress={() => setModalVisible(false)} disabled={saving}>
                  <Text style={st.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="check" size={14} color="#fff" /><Text style={st.saveBtnTxt}>{editing ? "Update" : "Save"}</Text></>}
                </TouchableOpacity>
              </View>

            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const PURPLE = "#6b21a8";

const st = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  headerBtn:    { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5, borderColor: PURPLE, backgroundColor: "#faf5ff" },
  headerBtnTxt: { fontSize: 12, fontWeight: "700", color: PURPLE },

  addBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: PURPLE, paddingVertical: 12, borderRadius: 12, marginBottom: 14, elevation: 3, shadowColor: PURPLE, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  addBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Card
  card:        { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: PURPLE, elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  cardBreak:   { borderLeftColor: "#f59e0b", backgroundColor: "#fffbeb" },
  cardLeft:    { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, marginRight: 8 },
  cardTitleRow:{ flexDirection: "row", alignItems: "center", gap: 8 },
  numBadge:    { width: 34, height: 34, borderRadius: 9, backgroundColor: "#f5f3ff", alignItems: "center", justifyContent: "center" },
  numBadgeBreak: { backgroundColor: "#fef3c7" },
  numTxt:      { fontSize: 14, fontWeight: "800", color: PURPLE },
  periodName:  { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  timeRange:   { fontSize: 11, color: "#94a3b8", marginTop: 3 },
  breakBadge:  { backgroundColor: "#f59e0b", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  breakTxt:    { fontSize: 9, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },

  actions:     { flexDirection: "row", gap: 6 },
  iconBtn:     { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  loader:      { flex: 1, alignItems: "center", justifyContent: "center" },
  empty:       { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:    { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt: { fontSize: 12, color: "#cbd5e1" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modalCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 20, width: "100%", maxHeight: "85%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalClose:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, color: "#0f172a", marginBottom: 14 },
  timeRow:      { flexDirection: "row" },
  switchRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  switchDesc:   { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  modalBtns:    { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancelBtn:    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: PURPLE },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },
});
