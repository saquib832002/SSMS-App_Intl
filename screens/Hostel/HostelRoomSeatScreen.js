/**
 * screens/Hostel/HostelRoomSeatScreen.js
 * Seats within a room — list, add, edit, delete, status toggle.
 */
import React, {
  useCallback, useContext, useEffect, useRef, useState,
} from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchSeats, saveSeat, deleteSeat } from "../../services/HostelServiceApi";

const SEAT_STATUSES = ["available", "occupied", "reserved", "maintenance"];

const STATUS_COLORS = {
  available:   { bg: "#f0fdf4", border: "#86efac", text: "#16a34a", dot: "#16a34a" },
  occupied:    { bg: "#fef2f2", border: "#fca5a5", text: "#dc2626", dot: "#dc2626" },
  reserved:    { bg: "#fffbeb", border: "#fde68a", text: "#d97706", dot: "#d97706" },
  maintenance: { bg: "#f8fafc", border: "#cbd5e1", text: "#64748b", dot: "#94a3b8" },
};

function CustomDropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={[fm.input, fm.dropRow, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)} activeOpacity={0.7}>
        <Text style={value ? fm.dropTxt : fm.dropPlaceholder}>{value || label}</Text>
        <Feather name="chevron-down" size={15} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={fm.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={fm.dropSheet}>
            <Text style={fm.dropTitle}>{label}</Text>
            {options.map(o => {
              const c = STATUS_COLORS[o] ?? {};
              return (
                <TouchableOpacity key={o} style={[fm.dropOption, o === value && fm.dropOptionActive]}
                  onPress={() => { onChange(o); setOpen(false); }}>
                  <View style={[fm.statusDot, { backgroundColor: c.dot ?? "#64748b" }]} />
                  <Text style={[fm.dropOptionTxt, o === value && { color: "#6366f1", fontWeight: "700" }]}>
                    {o.charAt(0).toUpperCase() + o.slice(1)}
                  </Text>
                  {o === value && <Feather name="check" size={13} color="#6366f1" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── Seat Form Modal ──────────────────────────────────────────────────────────
function SeatFormModal({ visible, seat, room, building, onClose, onSave }) {
  const [seatNumber, setSeatNumber] = useState("");
  const [status,     setStatus]     = useState("available");
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    if (visible) {
      setSeatNumber(seat?.seat_number ?? "");
      setStatus(seat?.status ?? "available");
    } else {
      // Clear when modal closes
      setSeatNumber("");
      setStatus("available");
      setSaving(false);
    }
  }, [visible, seat]);

  const handleSave = async () => {
    if (!seatNumber.trim()) { Alert.alert("Validation", "Seat number is required."); return; }
    try {
      setSaving(true);
      await onSave({
        seat_id:     seat?.seat_id,
        seat_number: seatNumber.trim(),
        status,
        room_id:     room.room_id,
        building_id: building.building_id,
      });
      setSeatNumber("");
      setStatus("available");
    } catch (e) {
      Alert.alert("Save Failed", e.message ?? "Could not save seat. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity style={fm.overlay} onPress={!saving ? onClose : undefined} activeOpacity={1}>
          <TouchableOpacity style={fm.sheet} onPress={() => {}} activeOpacity={1}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              <View style={fm.handle} />
              <Text style={fm.title}>{seat ? "Edit Seat" : "Add Seat"}</Text>

              <View style={fm.breadcrumb}>
                <Feather name="home" size={11} color="#6366f1" />
                <Text style={fm.breadcrumbTxt}>{building?.building_name}</Text>
                <Feather name="chevron-right" size={11} color="#94a3b8" />
                <Feather name="square" size={11} color="#6366f1" />
                <Text style={fm.breadcrumbTxt}>{room?.room_name}</Text>
              </View>

              <Text style={fm.label}>Seat Number *</Text>
              <TextInput
                style={fm.input}
                value={seatNumber}
                onChangeText={setSeatNumber}
                placeholder="e.g. S-01"
                placeholderTextColor="#94a3b8"
                editable={!saving}
                returnKeyType="done"
                autoFocus
              />

              <Text style={fm.label}>Status *</Text>
              <CustomDropdown
                label="Select status…"
                value={status}
                options={SEAT_STATUSES}
                onChange={setStatus}
                disabled={saving}
              />

              <TouchableOpacity style={[fm.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave} disabled={saving}>
                {saving
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={fm.saveTxt}> Saving…</Text></>
                  : <><Feather name="check-circle" size={18} color="#fff" /><Text style={fm.saveTxt}> {seat ? "Update" : "Add Seat"}</Text></>}
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

// ─── Seat Card ────────────────────────────────────────────────────────────────
function SeatCard({ item, isAdmin, onEdit, onDelete }) {
  const c = STATUS_COLORS[item.status] ?? STATUS_COLORS.maintenance;
  return (
    <View style={[st.card, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={st.cardRow}>
        <View style={[st.seatNum, { borderColor: c.border }]}>
          <Text style={[st.seatNumTxt, { color: c.text }]}>{item.seat_number}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={st.statusRow}>
            <View style={[st.statusDot, { backgroundColor: c.dot }]} />
            <Text style={[st.statusTxt, { color: c.text }]}>
              {(item.status ?? "available").charAt(0).toUpperCase() + (item.status ?? "available").slice(1)}
            </Text>
          </View>
          {item.student_name ? (
            <Text style={st.studentTxt} numberOfLines={1}>
              <Feather name="user" size={10} color="#64748b" /> {item.student_name}
            </Text>
          ) : (
            <Text style={st.noStudentTxt}>Not assigned</Text>
          )}
        </View>
        {isAdmin && (
          <View style={st.actions}>
            <TouchableOpacity style={st.iconBtn} onPress={() => onEdit(item)}>
              <Feather name="edit-2" size={13} color="#6366f1" />
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => onDelete(item)}>
              <Feather name="trash-2" size={13} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Summary Bar ──────────────────────────────────────────────────────────────
function SummaryBar({ seats }) {
  const counts = seats.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
  }, {});
  const items = [
    { label: "Available",   count: counts.available   ?? 0, color: "#16a34a" },
    { label: "Occupied",    count: counts.occupied    ?? 0, color: "#dc2626" },
    { label: "Reserved",    count: counts.reserved    ?? 0, color: "#d97706" },
    { label: "Maintenance", count: counts.maintenance ?? 0, color: "#94a3b8" },
  ];
  return (
    <View style={sum.wrap}>
      {items.map(i => (
        <View key={i.label} style={sum.item}>
          <Text style={[sum.count, { color: i.color }]}>{i.count}</Text>
          <Text style={sum.label}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HostelRoomSeatScreen({ navigation, route }) {
  const { room, building } = route.params;
  const { user } = useContext(AuthContext);
  const isAdmin = ['admin','owner'].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim()
  );

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const [seats,   setSeats]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editSeat,     setEditSeat]     = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSeats(userRef.current, room.room_id);
      setSeats(data);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [room.room_id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async (formData) => {
    try {
      await saveSeat(userRef.current, formData);
      setModalVisible(false);
      setEditSeat(null);
      load();
      Alert.alert("✅ Success", formData.seat_id ? "Seat updated." : "Seat added.");
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  }, [load]);

  const handleDelete = useCallback((item) => {
    Alert.alert(
      "Delete Seat",
      `Delete seat "${item.seat_number}"? This will fail if a student is assigned to it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteSeat(userRef.current, item.seat_id);
              load();
            } catch (e) {
              Alert.alert("Cannot Delete", e.message);
            }
          },
        },
      ]
    );
  }, [load]);

  const filtered = seats.filter(s => {
    const matchSearch = s.seat_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <SafeAreaView style={sc.safe} edges={["top"]}>
      <View style={sc.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={sc.backBtn}>
          <Feather name="arrow-left" size={20} color="#6366f1" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={sc.headerTitle}>{room.room_name}</Text>
          <Text style={sc.headerSub}>{building.building_name} • {seats.length} seat{seats.length !== 1 ? "s" : ""}</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={sc.addBtn} onPress={() => { setEditSeat(null); setModalVisible(true); }}>
            <Feather name="plus" size={18} color="#fff" />
            <Text style={sc.addBtnTxt}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Summary */}
      {seats.length > 0 && <SummaryBar seats={seats} />}

      {/* Search + status filter */}
      <View style={sc.filterRow}>
        <View style={sc.searchWrap}>
          <Feather name="search" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
          <TextInput style={sc.searchInput} placeholder="Search seats…"
            placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}><Feather name="x" size={14} color="#94a3b8" /></TouchableOpacity>
          )}
        </View>
      </View>

      {/* Status filter chips */}
      <View style={sc.chipRow}>
        {["", ...SEAT_STATUSES].map(s => (
          <TouchableOpacity key={s || "all"} style={[sc.chip, statusFilter === s && sc.chipActive]}
            onPress={() => setStatusFilter(s)}>
            <Text style={[sc.chipTxt, statusFilter === s && sc.chipTxtActive]}>
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : "All"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={sc.loader}><ActivityIndicator size="large" color="#6366f1" /><Text style={sc.loaderTxt}>Loading seats…</Text></View>
        : <FlatList
            data={filtered}
            keyExtractor={s => String(s.seat_id)}
            renderItem={({ item }) => (
              <SeatCard item={item} isAdmin={isAdmin}
                onEdit={s => { setEditSeat(s); setModalVisible(true); }}
                onDelete={handleDelete}
              />
            )}
            contentContainerStyle={sc.list}
            showsVerticalScrollIndicator={false}
            numColumns={2}
            columnWrapperStyle={{ gap: 10 }}
            ListEmptyComponent={
              <View style={sc.empty}>
                <Feather name="layout" size={44} color="#cbd5e1" />
                <Text style={sc.emptyTitle}>No seats yet</Text>
                <Text style={sc.emptyTxt}>{isAdmin ? 'Tap "Add" to add seats.' : "No seats in this room."}</Text>
              </View>
            }
          />}

      <SeatFormModal visible={modalVisible} seat={editSeat} room={room} building={building}
        onClose={() => { setModalVisible(false); setEditSeat(null); }}
        onSave={handleSave} />
    </SafeAreaView>
  );
}

const sc = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#f8fafc" },
  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e0e7ff", gap: 12 },
  backBtn:    { width: 38, height: 38, borderRadius: 12, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  headerTitle:{ fontSize: 18, fontWeight: "800", color: "#0f172a" },
  headerSub:  { fontSize: 12, color: "#94a3b8", marginTop: 1 },
  addBtn:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#6366f1", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  addBtnTxt:  { color: "#fff", fontWeight: "700", fontSize: 14 },
  filterRow:  { flexDirection: "row", paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  searchWrap: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: "#e0e7ff", height: 42 },
  searchInput:{ flex: 1, fontSize: 13, color: "#0f172a" },
  chipRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
  chipTxt:    { fontSize: 11, fontWeight: "600", color: "#64748b" },
  chipTxtActive:{ color: "#fff" },
  list:       { padding: 16, paddingTop: 4 },
  loader:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:  { color: "#6366f1", fontWeight: "600" },
  empty:      { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#475569" },
  emptyTxt:   { fontSize: 13, color: "#94a3b8", textAlign: "center" },
});

const st = StyleSheet.create({
  card:      { flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 12, marginBottom: 0 },
  cardRow:   { flexDirection: "row", alignItems: "center" },
  seatNum:   { width: 42, height: 42, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  seatNumTxt:{ fontSize: 13, fontWeight: "900" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 11, fontWeight: "700" },
  studentTxt:{ fontSize: 10, color: "#64748b" },
  noStudentTxt:{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" },
  actions:   { gap: 4 },
  iconBtn:   { width: 28, height: 28, borderRadius: 8, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
});

const sum = StyleSheet.create({
  wrap:  { flexDirection: "row", backgroundColor: "#fff", marginHorizontal: 16, marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: "#e0e7ff", padding: 14 },
  item:  { flex: 1, alignItems: "center" },
  count: { fontSize: 22, fontWeight: "900", marginBottom: 2 },
  label: { fontSize: 9, fontWeight: "600", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" },
});

const fm = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36, maxHeight: "90%" },
  handle:       { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:        { fontSize: 18, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  breadcrumb:   { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10 },
  breadcrumbTxt:{ fontSize: 11, color: "#6366f1", fontWeight: "600" },
  label:        { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6, marginTop: 12 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e0e7ff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0f172a" },
  dropRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropTxt:      { fontSize: 14, color: "#0f172a", flex: 1, textTransform: "capitalize" },
  dropPlaceholder:{ fontSize: 14, color: "#94a3b8", flex: 1 },
  dropOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 30 },
  dropSheet:    { backgroundColor: "#fff", borderRadius: 18, padding: 16 },
  dropTitle:    { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:   { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 10 },
  dropOptionActive:{ backgroundColor: "#ede9fe" },
  dropOptionTxt:{ fontSize: 14, color: "#334155", flex: 1, textTransform: "capitalize" },
  statusDot:    { width: 8, height: 8, borderRadius: 4 },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 16, marginTop: 24, marginBottom: 10 },
  saveTxt:      { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:    { backgroundColor: "#f1f5f9", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt:    { fontSize: 14, fontWeight: "700", color: "#475569" },
});