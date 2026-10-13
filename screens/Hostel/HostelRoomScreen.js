/**
 * screens/Hostel/HostelRoomScreen.js
 * Rooms within a building — list, add, edit, delete.
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
import { fetchRooms, saveRoom, deleteRoom } from "../../services/HostelServiceApi";
import { _t, _tx } from "../../services/i18n";

// ─── Room Form Modal ──────────────────────────────────────────────────────────
function RoomFormModal({ visible, room, building, onClose, onSave }) {
  const [roomName, setRoomName] = useState("");
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (visible) {
      setRoomName(room?.room_name ?? "");
    } else {
      // Clear when modal closes
      setRoomName("");
      setSaving(false);
    }
  }, [visible, room]);

  const handleSave = async () => {
    if (!roomName.trim()) { Alert.alert(_t("Validation"), _t("Room name is required.")); return; }
    try {
      setSaving(true);
      await onSave({
        room_id:     room?.room_id,
        room_name:   roomName.trim(),
        building_id: building.building_id,
      });
      setRoomName("");
    } catch (e) {
      Alert.alert(_t("Save Failed"), _tx(e.message) ?? _t("Could not save room. Please try again."));
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
              <Text style={fm.title}>{room ? _t("Edit Room") : _t("Add Room")}</Text>
              <View style={fm.buildingBadge}>
                <Feather name="home" size={12} color="#6366f1" />
                <Text style={fm.buildingBadgeTxt}>{_tx(building?.building_name)}</Text>
              </View>

              <Text style={fm.label}>{_t("Room Name *")}</Text>
              <TextInput
                style={fm.input}
                value={roomName}
                onChangeText={setRoomName}
                placeholder={_t("e.g. Room 101")}
                placeholderTextColor="#94a3b8"
                editable={!saving}
                returnKeyType="done"
                autoFocus
              />

              <TouchableOpacity style={[fm.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave} disabled={saving}>
                {saving
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={fm.saveTxt}>{" "}{_t("Saving…")}</Text></>
                  : <><Feather name="check-circle" size={18} color="#fff" /><Text style={fm.saveTxt}> {room ? _t("Update") : _t("Add Room")}</Text></>}
              </TouchableOpacity>
              {!saving && (
                <TouchableOpacity style={fm.cancelBtn} onPress={onClose}>
                  <Text style={fm.cancelTxt}>{_t("Cancel")}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Room Card ────────────────────────────────────────────────────────────────
function RoomCard({ item, isAdmin, onEdit, onDelete, onSeats }) {
  return (
    <View style={st.card}>
      <View style={st.cardRow}>
        <View style={st.iconWrap}>
          <Feather name="square" size={22} color="#6366f1" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={st.roomName}>{_tx(item.room_name)}</Text>
          <Text style={st.roomSub}>{_t("{v} seat{pl}", { v: item.seat_count ?? 0, pl: (item.seat_count ?? 0) !== 1 ? "s" : "" })}</Text>
        </View>
        {isAdmin && (
          <View style={st.actions}>
            <TouchableOpacity style={st.iconBtn} onPress={() => onEdit(item)}>
              <Feather name="edit-2" size={14} color="#6366f1" />
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn, { backgroundColor: "#fef2f2" }]} onPress={() => onDelete(item)}>
              <Feather name="trash-2" size={14} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}
      </View>
      <TouchableOpacity style={st.seatsBtn} onPress={() => onSeats(item)}>
        <Feather name="grid" size={13} color="#6366f1" />
        <Text style={st.seatsBtnTxt}>{_t("Manage Seats")}</Text>
        <Feather name="chevron-right" size={13} color="#6366f1" />
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HostelRoomScreen({ navigation, route }) {
  const { building } = route.params;
  const { user } = useContext(AuthContext);
  const isAdmin = ['admin','owner'].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim()
  );

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const [rooms,   setRooms]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editRoom,     setEditRoom]     = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchRooms(userRef.current, building.building_id);
      setRooms(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e?.message) || _t("Failed to load rooms."));
    } finally {
      setLoading(false);
    }
  }, [building.building_id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async (formData) => {
    try {
      await saveRoom(userRef.current, formData);
      setModalVisible(false);
      setEditRoom(null);
      load();
      Alert.alert(_t("✅ Success"), formData.room_id ? _t("Room updated.") : _t("Room added."));
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message));
    }
  }, [load]);

  const handleDelete = useCallback((item) => {
    Alert.alert(
      _t("Delete Room"),
      _t("Delete \"{room_name}\"? This will fail if seats are assigned to it.", { room_name: item.room_name }),
      [
        { text: _t("Cancel"), style: "cancel" },
        {
          text: _t("Delete"), style: "destructive",
          onPress: async () => {
            try {
              await deleteRoom(userRef.current, item.room_id);
              load();
            } catch (e) {
              Alert.alert(_t("Cannot Delete"), _tx(e.message));
            }
          },
        },
      ]
    );
  }, [load]);

  const filtered = rooms.filter(r =>
    r.room_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={sc.safe} edges={["top"]}>
      <View style={sc.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={sc.backBtn}>
          <Feather name="arrow-left" size={20} color="#6366f1" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={sc.headerTitle}>{_t("Rooms")}</Text>
          <Text style={sc.headerSub}>{_t("{building_name} • {length} room{pl}", { building_name: building.building_name, length: rooms.length, pl: rooms.length !== 1 ? "s" : "" })}</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={sc.addBtn} onPress={() => { setEditRoom(null); setModalVisible(true); }}>
            <Feather name="plus" size={18} color="#fff" />
            <Text style={sc.addBtnTxt}>{_t("Add")}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={sc.searchWrap}>
        <Feather name="search" size={15} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput style={sc.searchInput} placeholder={_t("Search rooms…")}
          placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}><Feather name="x" size={15} color="#94a3b8" /></TouchableOpacity>
        )}
      </View>

      {loading
        ? <View style={sc.loader}><ActivityIndicator size="large" color="#6366f1" /><Text style={sc.loaderTxt}>{_t("Loading rooms…")}</Text></View>
        : <FlatList
            data={filtered}
            keyExtractor={r => String(r.room_id)}
            renderItem={({ item }) => (
              <RoomCard item={item} isAdmin={isAdmin}
                onEdit={r => { setEditRoom(r); setModalVisible(true); }}
                onDelete={handleDelete}
                onSeats={r => navigation.navigate("HostelSeats", { room: r, building })}
              />
            )}
            contentContainerStyle={sc.list}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListEmptyComponent={
              <View style={sc.empty}>
                <Feather name="square" size={44} color="#cbd5e1" />
                <Text style={sc.emptyTitle}>{_t("No rooms yet")}</Text>
                <Text style={sc.emptyTxt}>{isAdmin ? _t("Tap \"Add\" to create a room.") : _t("No rooms added.")}</Text>
              </View>
            }
          />}

      <RoomFormModal visible={modalVisible} room={editRoom} building={building}
        onClose={() => { setModalVisible(false); setEditRoom(null); }}
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
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", margin: 16, marginBottom: 8, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: "#e0e7ff", height: 46 },
  searchInput:{ flex: 1, fontSize: 14, color: "#0f172a" },
  list:       { padding: 16, paddingTop: 8 },
  loader:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:  { color: "#6366f1", fontWeight: "600" },
  empty:      { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#475569" },
  emptyTxt:   { fontSize: 13, color: "#94a3b8", textAlign: "center" },
});

const st = StyleSheet.create({
  card:      { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#e0e7ff", elevation: 2, shadowColor: "#6366f1", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  cardRow:   { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  iconWrap:  { width: 46, height: 46, borderRadius: 14, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  roomName:  { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 2 },
  roomSub:   { fontSize: 12, color: "#64748b" },
  actions:   { flexDirection: "row", gap: 6 },
  iconBtn:   { width: 32, height: 32, borderRadius: 9, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  seatsBtn:  { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 10 },
  seatsBtnTxt:{ fontSize: 13, fontWeight: "700", color: "#6366f1", flex: 1 },
});

const fm = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36, maxHeight: "90%" },
  handle:       { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:        { fontSize: 18, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  buildingBadge:{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ede9fe", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start", marginBottom: 8 },
  buildingBadgeTxt:{ fontSize: 12, color: "#6366f1", fontWeight: "600" },
  label:        { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6, marginTop: 12 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e0e7ff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0f172a" },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 16, marginTop: 24, marginBottom: 10 },
  saveTxt:      { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:    { backgroundColor: "#f1f5f9", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt:    { fontSize: 14, fontWeight: "700", color: "#475569" },
});