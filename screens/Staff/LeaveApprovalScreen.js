/**
 * screens/Staff/LeaveApprovalScreen.js
 *
 * Principal / Admin — Staff Leave Approval
 *   • "Pending" tab  — approve or reject with optional remarks
 *   • "All Leaves"   — filter by year, searchable, full history
 */
import React, {
  useCallback, useContext, useState,
} from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchPendingLeaves, fetchAllLeaves, approveLeave } from "../../services/LeaveServiceApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary: "#1e40af",
  bg:      "#f1f5f9",
  card:    "#ffffff",
  border:  "#e2e8f0",
  text:    "#1e293b",
  muted:   "#64748b",
  green:   "#16a34a",
  red:     "#dc2626",
  amber:   "#d97706",
  slate:   "#475569",
};

const STATUS_META = {
  pending:   { label: "Pending",   bg: "#fef3c7", color: C.amber },
  approved:  { label: "Approved",  bg: "#dcfce7", color: C.green },
  rejected:  { label: "Rejected",  bg: "#fee2e2", color: C.red   },
  cancelled: { label: "Cancelled", bg: "#f1f5f9", color: C.slate },
};

const Badge = ({ status }) => {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <View style={[st.badge, { backgroundColor: m.bg }]}>
      <Text style={[st.badgeTxt, { color: m.color }]}>{m.label}</Text>
    </View>
  );
};

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// ── Leave Card ─────────────────────────────────────────────────────────────────
function LeaveCard({ item, onAction }) {
  return (
    <View style={st.card}>
      {/* Staff info */}
      <View style={st.cardTop}>
        <View style={st.avatarCircle}>
          <Text style={st.avatarTxt}>
            {(item.staff_name ?? "?").split(" ").map(n => n[0]).slice(0,2).join("").toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.staffName}>{item.staff_name}</Text>
          <Text style={st.designation}>{item.designation}</Text>
        </View>
        <Badge status={item.status} />
      </View>

      {/* Leave details */}
      <View style={st.detailRow}>
        <View style={st.detailChip}>
          <Feather name="tag" size={11} color={C.primary} />
          <Text style={st.detailChipTxt}>{item.leave_type_name}</Text>
        </View>
        <View style={st.detailChip}>
          <Feather name="calendar" size={11} color={C.primary} />
          <Text style={st.detailChipTxt}>
            {fmtDate(item.from_date)}
            {item.from_date !== item.to_date ? ` → ${fmtDate(item.to_date)}` : ""}
          </Text>
        </View>
        <View style={st.detailChip}>
          <Feather name="clock" size={11} color={C.primary} />
          <Text style={st.detailChipTxt}>
            {item.days} day{item.days != 1 ? "s" : ""}
            {item.is_half_day == 1 ? " (half)" : ""}
          </Text>
        </View>
      </View>

      {/* Reason */}
      <Text style={st.reasonTxt}>{item.reason}</Text>

      {/* Approver remarks */}
      {!!item.remarks && (
        <View style={st.remarksBox}>
          <Feather name="message-square" size={11} color={C.muted} />
          <Text style={st.remarksTxt}>{item.remarks}</Text>
        </View>
      )}
      {item.status === "approved" && !!item.approved_by_name && (
        <Text style={st.approvedBy}>Approved by {item.approved_by_name} · {fmtDate(item.approved_at)}</Text>
      )}

      {/* Action buttons (pending only) */}
      {item.status === "pending" && onAction && (
        <View style={st.actionRow}>
          <TouchableOpacity
            style={[st.actionBtn, { backgroundColor: "#dcfce7", borderColor: C.green }]}
            onPress={() => onAction(item, "approved")}
          >
            <Feather name="check" size={14} color={C.green} />
            <Text style={[st.actionBtnTxt, { color: C.green }]}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.actionBtn, { backgroundColor: "#fee2e2", borderColor: C.red }]}
            onPress={() => onAction(item, "rejected")}
          >
            <Feather name="x" size={14} color={C.red} />
            <Text style={[st.actionBtnTxt, { color: C.red }]}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={st.appliedOn}>Applied: {fmtDate(item.created_at)}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function LeaveApprovalScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [tab,        setTab]        = useState("pending");
  const [pending,    setPending]    = useState([]);
  const [allLeaves,  setAllLeaves]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [filterSt,   setFilterSt]   = useState("");   // "" | pending | approved | rejected | cancelled

  // Remarks modal
  const [actionModal,  setActionModal]  = useState(false);
  const [actionItem,   setActionItem]   = useState(null);
  const [actionType,   setActionType]   = useState(""); // "approved" | "rejected"
  const [remarks,      setRemarks]      = useState("");
  const [submitting,   setSubmitting]   = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const [p, all] = await Promise.all([
        fetchPendingLeaves(user),
        fetchAllLeaves(user, {}),
      ]);
      setPending(p);
      setAllLeaves(all);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Open action modal ────────────────────────────────────────────────────
  const handleAction = (item, action) => {
    setActionItem(item);
    setActionType(action);
    setRemarks("");
    setActionModal(true);
  };

  // ── Confirm action ───────────────────────────────────────────────────────
  const confirmAction = async () => {
    if (!actionItem) return;
    try {
      setSubmitting(true);
      await approveLeave(user, {
        id:      actionItem.id,
        action:  actionType,
        remarks: remarks.trim() || undefined,
      });
      setActionModal(false);
      Alert.alert(
        actionType === "approved" ? "Approved!" : "Rejected",
        `${actionItem.staff_name}'s leave has been ${actionType}.`
      );
      load(true);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Filtered lists ───────────────────────────────────────────────────────
  const filteredAll = allLeaves.filter(l => {
    const matchSearch = !search ||
      (l.staff_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (l.leave_type_name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = !filterSt || l.status === filterSt;
    return matchSearch && matchStatus;
  });

  const STATUS_FILTERS = [
    { key: "",           label: "All"       },
    { key: "pending",    label: "Pending"   },
    { key: "approved",   label: "Approved"  },
    { key: "rejected",   label: "Rejected"  },
    { key: "cancelled",  label: "Cancelled" },
  ];

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
        <Text style={st.headerTitle}>Leave Approval</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Tabs */}
      <View style={st.tabs}>
        <TouchableOpacity
          style={[st.tab, tab === "pending" && st.tabActive]}
          onPress={() => setTab("pending")}
        >
          <Feather name="inbox" size={14} color={tab === "pending" ? C.primary : C.muted} />
          <Text style={[st.tabTxt, tab === "pending" && st.tabTxtActive]}>
            Pending {pending.length > 0 ? `(${pending.length})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.tab, tab === "all" && st.tabActive]}
          onPress={() => setTab("all")}
        >
          <Feather name="list" size={14} color={tab === "all" ? C.primary : C.muted} />
          <Text style={[st.tabTxt, tab === "all" && st.tabTxtActive]}>All Leaves</Text>
        </TouchableOpacity>
      </View>

      {/* ── Pending Tab ───────────────────────────────────────────────────── */}
      {tab === "pending" && (
        pending.length === 0
          ? (
            <ScrollView
              contentContainerStyle={st.emptyBox}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
            >
              <Feather name="check-circle" size={52} color={C.border} />
              <Text style={st.emptyTitle}>All caught up!</Text>
              <Text style={st.emptySubtitle}>No pending leave applications</Text>
            </ScrollView>
          )
          : (
            <FlatList
              data={pending}
              keyExtractor={i => String(i.id)}
              contentContainerStyle={{ padding: 16 }}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
              renderItem={({ item }) => (
                <LeaveCard item={item} onAction={handleAction} />
              )}
            />
          )
      )}

      {/* ── All Leaves Tab ────────────────────────────────────────────────── */}
      {tab === "all" && (
        <>
          {/* Search */}
          <View style={st.searchWrap}>
            <Feather name="search" size={16} color={C.muted} />
            <TextInput
              style={st.searchInput}
              placeholder="Search by staff name or leave type..."
              placeholderTextColor={C.muted}
              value={search}
              onChangeText={setSearch}
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Feather name="x" size={14} color={C.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Status filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
            {STATUS_FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[st.chip, filterSt === f.key && st.chipActive]}
                onPress={() => setFilterSt(f.key)}
              >
                <Text style={[st.chipTxt, filterSt === f.key && st.chipTxtActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {filteredAll.length === 0
            ? (
              <ScrollView
                contentContainerStyle={st.emptyBox}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
              >
                <Feather name="calendar" size={48} color={C.border} />
                <Text style={st.emptySubtitle}>No records found</Text>
              </ScrollView>
            )
            : (
              <FlatList
                data={filteredAll}
                keyExtractor={i => String(i.id)}
                contentContainerStyle={{ padding: 16 }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
                renderItem={({ item }) => (
                  <LeaveCard
                    item={item}
                    onAction={item.status === "pending" ? handleAction : null}
                  />
                )}
              />
            )
          }
        </>
      )}

      {/* ── Action Modal (Approve / Reject) ───────────────────────────────── */}
      <Modal visible={actionModal} transparent animationType="slide" onRequestClose={() => setActionModal(false)}>
        <View style={st.modalOverlay}>
          <View style={st.modalSheet}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>
                {actionType === "approved" ? "Approve Leave" : "Reject Leave"}
              </Text>
              <TouchableOpacity onPress={() => setActionModal(false)}>
                <Feather name="x" size={20} color={C.text} />
              </TouchableOpacity>
            </View>

            {actionItem && (
              <View style={st.modalBody}>
                <Text style={st.modalStaffName}>{actionItem.staff_name}</Text>
                <Text style={st.modalMeta}>
                  {actionItem.leave_type_name}  ·  {fmtDate(actionItem.from_date)}
                  {actionItem.from_date !== actionItem.to_date ? ` → ${fmtDate(actionItem.to_date)}` : ""}
                  {"  ·  "}{actionItem.days} day{actionItem.days != 1 ? "s" : ""}
                </Text>
                <Text style={st.modalReason}>{actionItem.reason}</Text>

                <Text style={st.remarksLabel}>Remarks (optional)</Text>
                <TextInput
                  style={st.remarksInput}
                  placeholder={
                    actionType === "approved"
                      ? "Any message for the staff member..."
                      : "Reason for rejection..."
                  }
                  placeholderTextColor={C.muted}
                  value={remarks}
                  onChangeText={setRemarks}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={[
                    st.confirmBtn,
                    { backgroundColor: actionType === "approved" ? C.green : C.red },
                    submitting && { opacity: 0.6 },
                  ]}
                  onPress={confirmAction}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <Feather name={actionType === "approved" ? "check" : "x"} size={16} color="#fff" />
                        <Text style={st.confirmBtnTxt}>
                          {actionType === "approved" ? "Confirm Approval" : "Confirm Rejection"}
                        </Text>
                      </>
                  }
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.bg },
  center:        { flex: 1, alignItems: "center", justifyContent: "center" },

  header:        { flexDirection: "row", alignItems: "center", backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 14 },
  backBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:   { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: "#fff" },

  tabs:          { flexDirection: "row", backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  tab:           { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  tabActive:     { borderBottomWidth: 2, borderBottomColor: C.primary },
  tabTxt:        { fontSize: 13, color: C.muted, fontWeight: "500" },
  tabTxtActive:  { color: C.primary, fontWeight: "700" },

  searchWrap:    { flexDirection: "row", alignItems: "center", backgroundColor: C.card, margin: 12, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, elevation: 1 },
  searchInput:   { flex: 1, fontSize: 14, color: C.text },

  chipRow:       { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive:    { backgroundColor: C.primary, borderColor: C.primary },
  chipTxt:       { fontSize: 12, color: C.muted },
  chipTxtActive: { color: "#fff", fontWeight: "700" },

  // Card
  card:          { backgroundColor: C.card, borderRadius: 12, padding: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  cardTop:       { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatarCircle:  { width: 40, height: 40, borderRadius: 20, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 13, fontWeight: "800", color: C.primary },
  staffName:     { fontSize: 15, fontWeight: "700", color: C.text },
  designation:   { fontSize: 12, color: C.muted, marginTop: 1 },

  detailRow:     { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  detailChip:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  detailChipTxt: { fontSize: 11, color: C.primary },

  reasonTxt:     { fontSize: 13, color: C.slate, lineHeight: 18 },
  remarksBox:    { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, backgroundColor: "#f8fafc", borderRadius: 6, padding: 8 },
  remarksTxt:    { fontSize: 12, color: C.muted, flex: 1 },
  approvedBy:    { fontSize: 11, color: C.muted, marginTop: 6, fontStyle: "italic" },

  actionRow:     { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  actionBtnTxt:  { fontSize: 13, fontWeight: "700" },
  appliedOn:     { fontSize: 10, color: C.muted, marginTop: 8, textAlign: "right" },

  badge:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeTxt:      { fontSize: 11, fontWeight: "700" },

  emptyBox:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 32 },
  emptyTitle:    { fontSize: 18, fontWeight: "700", color: C.text },
  emptySubtitle: { fontSize: 14, color: C.muted },

  // Modal
  modalOverlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet:    { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" },
  modalHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle:    { fontSize: 16, fontWeight: "700", color: C.text },
  modalBody:     { padding: 16 },
  modalStaffName:{ fontSize: 16, fontWeight: "700", color: C.text, marginBottom: 4 },
  modalMeta:     { fontSize: 12, color: C.primary, marginBottom: 8 },
  modalReason:   { fontSize: 13, color: C.slate, marginBottom: 16, backgroundColor: "#f8fafc", padding: 10, borderRadius: 8 },
  remarksLabel:  { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 6 },
  remarksInput:  { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, fontSize: 13, color: C.text, minHeight: 80, marginBottom: 16 },
  confirmBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14 },
  confirmBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
