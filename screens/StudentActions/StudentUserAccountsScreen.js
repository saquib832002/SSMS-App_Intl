/**
 * screens/StudentActions/StudentUserAccountsScreen.js
 *
 * Admin / Owner screen — manage student & parent login accounts.
 * Lists all accounts, shows activation status, allows instant toggle.
 * Only admin and owner roles can reach this screen.
 */
import React, { useContext, useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, ActivityIndicator, Alert, Switch,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchStudentUsers, toggleStudentUserStatus } from "../../services/UserServiceApi";

const STATUS_FILTERS = [
  { label: "All",      value: "" },
  { label: "Active",   value: "active" },
  { label: "Inactive", value: "Inactive" },
];

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(String(d).replace(" ", "T"));
  return isNaN(dt) ? d : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// ── Account card ──────────────────────────────────────────────────────────────
function AccountCard({ item, onToggle, toggling }) {
  const isActive   = (item.ssms_user_status ?? "").toLowerCase() === "active";
  const fullName   = `${item.ssms_user_firstname ?? ""} ${item.ssms_user_lastname ?? ""}`.trim() || item.ssms_user_name;
  const roleColor  = item.ssms_user_role === "Parent" ? "#7c3aed" : "#1e40af";
  const roleBg     = item.ssms_user_role === "Parent" ? "#f5f3ff" : "#eff6ff";

  return (
    <View style={[st.card, isActive ? st.cardActive : st.cardInactive]}>
      {/* Left — status stripe */}
      <View style={[st.stripe, { backgroundColor: isActive ? "#22c55e" : "#e2e8f0" }]} />

      <View style={st.cardBody}>
        {/* Top row — name + role badge */}
        <View style={st.cardTop}>
          <View style={st.nameWrap}>
            <View style={[st.avatar, { backgroundColor: roleColor + "22" }]}>
              <Text style={[st.avatarTxt, { color: roleColor }]}>
                {(fullName[0] ?? "?").toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.name} numberOfLines={1}>{fullName}</Text>
              <Text style={st.userId} numberOfLines={1}>
                <Feather name="hash" size={10} color="#94a3b8" /> {item.ssms_user_name}
              </Text>
            </View>
          </View>
          <View style={[st.roleBadge, { backgroundColor: roleBg }]}>
            <Text style={[st.roleText, { color: roleColor }]}>{item.ssms_user_role}</Text>
          </View>
        </View>

        {/* Details row */}
        <View style={st.detailRow}>
          {item.branch_name ? (
            <View style={st.detail}>
              <Feather name="git-branch" size={11} color="#94a3b8" />
              <Text style={st.detailTxt} numberOfLines={1}>{item.branch_name}</Text>
            </View>
          ) : null}
          {item.ssms_user_email ? (
            <View style={st.detail}>
              <Feather name="mail" size={11} color="#94a3b8" />
              <Text style={st.detailTxt} numberOfLines={1}>{item.ssms_user_email}</Text>
            </View>
          ) : null}
        </View>

        {/* Bottom row — last login + toggle */}
        <View style={st.cardBottom}>
          <View>
            <Text style={st.loginLabel}>Registered</Text>
            <Text style={st.loginDate}>{fmtDate(item.created)}</Text>
            {item.last_login_date ? (
              <Text style={st.lastLogin}>Last login: {fmtDate(item.last_login_date)}</Text>
            ) : (
              <Text style={st.neverLogin}>Never logged in</Text>
            )}
          </View>

          <View style={st.toggleWrap}>
            <Text style={[st.statusLabel, { color: isActive ? "#16a34a" : "#94a3b8" }]}>
              {isActive ? "Active" : "Inactive"}
            </Text>
            {toggling ? (
              <ActivityIndicator size="small" color="#2563eb" style={{ marginLeft: 8 }} />
            ) : (
              <Switch
                value={isActive}
                onValueChange={(val) => onToggle(item, val ? "active" : "Inactive")}
                trackColor={{ false: "#e2e8f0", true: "#bbf7d0" }}
                thumbColor={isActive ? "#22c55e" : "#94a3b8"}
                ios_backgroundColor="#e2e8f0"
              />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StudentUserAccountsScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [accounts, setAccounts]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [togglingId, setTogglingId]     = useState(null); // userName being toggled

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchStudentUsers(user, statusFilter);
      setAccounts(data);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load accounts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const handleToggle = useCallback(async (item, newStatus) => {
    const label    = newStatus === "active" ? "activate" : "deactivate";
    const fullName = `${item.ssms_user_firstname ?? ""} ${item.ssms_user_lastname ?? ""}`.trim() || item.ssms_user_name;

    Alert.alert(
      `${label.charAt(0).toUpperCase() + label.slice(1)} Account`,
      `${label.charAt(0).toUpperCase() + label.slice(1)} login for ${fullName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: label.charAt(0).toUpperCase() + label.slice(1),
          style: newStatus === "active" ? "default" : "destructive",
          onPress: async () => {
            setTogglingId(item.ssms_user_name);
            try {
              await toggleStudentUserStatus(user, item.ssms_user_name, newStatus);
              // Optimistic local update
              setAccounts((prev) =>
                prev.map((a) =>
                  a.ssms_user_name === item.ssms_user_name
                    ? { ...a, ssms_user_status: newStatus }
                    : a
                )
              );
            } catch (e) {
              Alert.alert("Error", e.message || "Failed to update status");
            } finally {
              setTogglingId(null);
            }
          },
        },
      ]
    );
  }, [user]);

  // Filter locally by search text
  const visible = accounts.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.ssms_user_name      ?? "").toLowerCase().includes(q) ||
      (a.ssms_user_firstname ?? "").toLowerCase().includes(q) ||
      (a.ssms_user_lastname  ?? "").toLowerCase().includes(q) ||
      (a.ssms_user_email     ?? "").toLowerCase().includes(q) ||
      (a.branch_name         ?? "").toLowerCase().includes(q)
    );
  });

  const activeCount   = accounts.filter((a) => (a.ssms_user_status ?? "").toLowerCase() === "active").length;
  const inactiveCount = accounts.length - activeCount;

  return (
    <SafeAreaView style={st.safe} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Student Accounts</Text>
          <Text style={st.subtitle}>
            {accounts.length} accounts · {activeCount} active · {inactiveCount} inactive
          </Text>
        </View>
        <TouchableOpacity onPress={() => load()} style={st.refreshBtn}>
          <Feather name="refresh-cw" size={18} color="#1e40af" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={st.searchRow}>
        <View style={st.searchBox}>
          <Feather name="search" size={15} color="#94a3b8" style={{ marginRight: 8 }} />
          <TextInput
            style={st.searchInput}
            placeholder="Search by name, ID, email, branch…"
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Status filter chips */}
      <View style={st.chipRow}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[st.chip, statusFilter === f.value && st.chipActive]}
            onPress={() => setStatusFilter(f.value)}
            activeOpacity={0.75}
          >
            <Text style={[st.chipTxt, statusFilter === f.value && st.chipTxtActive]}>
              {f.label}
              {f.value === ""        ? ` (${accounts.length})`   :
               f.value === "active"  ? ` (${activeCount})`      :
                                       ` (${inactiveCount})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Info banner for inactive */}
      {statusFilter !== "active" && inactiveCount > 0 && (
        <View style={st.infoBanner}>
          <Feather name="info" size={14} color="#92400e" />
          <Text style={st.infoBannerTxt}>
            {inactiveCount} account{inactiveCount !== 1 ? "s" : ""} pending activation. Toggle the switch to allow login.
          </Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={st.loadingTxt}>Loading accounts…</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={st.center}>
          <Feather name="users" size={44} color="#cbd5e1" />
          <Text style={st.emptyTxt}>
            {search ? "No accounts match your search" : "No student / parent accounts yet"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(a) => a.ssms_user_name}
          renderItem={({ item }) => (
            <AccountCard
              item={item}
              onToggle={handleToggle}
              toggling={togglingId === item.ssms_user_name}
            />
          )}
          contentContainerStyle={st.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#2563eb"]} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#f1f5f9" },

  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 10 },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  title:      { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  subtitle:   { fontSize: 12, color: "#64748b", marginTop: 1 },

  searchRow:  { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, backgroundColor: "#fff" },
  searchBox:  { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput:{ flex: 1, color: "#0f172a", fontSize: 14 },

  chipRow:    { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff", gap: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  chip:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  chipTxt:    { fontSize: 12, fontWeight: "600", color: "#64748b" },
  chipTxtActive: { color: "#fff" },

  infoBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 10, backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#fcd34d", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  infoBannerTxt: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 17 },

  list:       { padding: 16, gap: 12, paddingBottom: 40 },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { fontSize: 14, color: "#64748b" },
  emptyTxt:   { fontSize: 14, color: "#94a3b8", textAlign: "center", maxWidth: 240, lineHeight: 20 },

  // Card
  card:        { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2, borderWidth: 1, borderColor: "#e2e8f0" },
  cardActive:  { borderColor: "#bbf7d0" },
  cardInactive:{ borderColor: "#e2e8f0", opacity: 0.85 },
  stripe:      { width: 5 },
  cardBody:    { flex: 1, padding: 14 },

  cardTop:    { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  nameWrap:   { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, marginRight: 8 },
  avatar:     { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarTxt:  { fontSize: 16, fontWeight: "800" },
  name:       { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  userId:     { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  roleBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  roleText:   { fontSize: 11, fontWeight: "700" },

  detailRow:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  detail:     { flexDirection: "row", alignItems: "center", gap: 4 },
  detailTxt:  { fontSize: 11, color: "#64748b", maxWidth: 150 },

  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 10 },
  loginLabel: { fontSize: 10, color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  loginDate:  { fontSize: 12, color: "#334155", fontWeight: "600", marginTop: 2 },
  lastLogin:  { fontSize: 11, color: "#64748b", marginTop: 2 },
  neverLogin: { fontSize: 11, color: "#f59e0b", marginTop: 2, fontWeight: "600" },

  toggleWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusLabel:{ fontSize: 12, fontWeight: "700" },
});
