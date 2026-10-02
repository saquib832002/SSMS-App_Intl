/**
 * screens/Staff/HiringPendingScreen.js
 * Admin reviews registered staff and updates hiring details.
 * When marked Hired=Y a user account is created and welcome email sent.
 */
import React, { useState, useContext, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Alert, ActivityIndicator,
  ScrollView, RefreshControl, Image,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchHiringList, updateHiringDetails } from "../../services/StaffServiceApi";
import { fetchBranches } from "../../services/SetupServiceApi";

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Custom DateField ──────────────────────────────────────────────────────────
function DateField({ label, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const now    = new Date();
  const parsed = value ? new Date(value + "T00:00:00") : null;
  const [yr, setYr] = useState(parsed?.getFullYear()  ?? now.getFullYear());
  const [mo, setMo] = useState(parsed?.getMonth()     ?? now.getMonth());
  const [dy, setDy] = useState(parsed?.getDate()      ?? now.getDate());

  const years   = Array.from({ length: 30 }, (_, i) => now.getFullYear() - i);
  const daysInM = new Date(yr, mo + 1, 0).getDate();
  const days    = Array.from({ length: daysInM }, (_, i) => i + 1);

  const display = value
    ? `${String(parsed?.getDate()).padStart(2,"0")} ${MONTHS[parsed?.getMonth()]} ${parsed?.getFullYear()}`
    : null;

  const onOpen = () => {
    if (disabled) return;
    if (value) { const p = new Date(value + "T00:00:00"); setYr(p.getFullYear()); setMo(p.getMonth()); setDy(p.getDate()); }
    setOpen(true);
  };

  const confirm = () => {
    const d = Math.min(dy, daysInM);
    onChange(`${yr}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={[hst.input, disabled && {opacity:0.45}]} onPress={onOpen} activeOpacity={0.7}>
        <Text style={[hst.inputTxt, !display && {color:"#94a3b8"}]}>{display || `Select ${label}`}</Text>
        <Feather name="calendar" size={13} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={hst.dpOverlay}>
          <View style={hst.dpSheet}>
            <View style={hst.dpHeader}>
              <Text style={hst.dpTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={hst.dpClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={hst.dpPreviewRow}>
              <Text style={hst.dpPreview}>{String(dy).padStart(2,"0")} {MONTHS[mo]} {yr}</Text>
            </View>
            <View style={hst.dpCols}>
              <View style={hst.dpCol}>
                <Text style={hst.dpColLabel}>Day</Text>
                <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}}>
                  {days.map(d => (
                    <TouchableOpacity key={d} style={[hst.dpItem, dy===d && hst.dpItemActive]} onPress={() => setDy(d)}>
                      <Text style={[hst.dpItemTxt, dy===d && hst.dpItemTxtActive]}>{String(d).padStart(2,"0")}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={[hst.dpCol, {flex:1.8}]}>
                <Text style={hst.dpColLabel}>Month</Text>
                <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}}>
                  {MONTHS.map((m,i) => (
                    <TouchableOpacity key={m} style={[hst.dpItem, mo===i && hst.dpItemActive]} onPress={() => setMo(i)}>
                      <Text style={[hst.dpItemTxt, mo===i && hst.dpItemTxtActive]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={[hst.dpCol, {flex:1.3}]}>
                <Text style={hst.dpColLabel}>Year</Text>
                <ScrollView showsVerticalScrollIndicator={false} style={{flex:1}}>
                  {years.map(y => (
                    <TouchableOpacity key={y} style={[hst.dpItem, yr===y && hst.dpItemActive]} onPress={() => setYr(y)}>
                      <Text style={[hst.dpItemTxt, yr===y && hst.dpItemTxtActive]}>{y}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
            <TouchableOpacity style={hst.dpConfirm} onPress={confirm}>
              <Feather name="check" size={14} color="#fff" />
              <Text style={hst.dpConfirmTxt}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Toggle button ─────────────────────────────────────────────────────────────
function Toggle({ value, onChange, yesLabel = "Yes", noLabel = "No", disabled }) {
  return (
    <View style={hst.toggleRow}>
      {[{v:"Y", label:yesLabel, bg:"#dcfce7", color:"#16a34a", border:"#86efac"},
        {v:"N", label:noLabel,  bg:"#fee2e2", color:"#dc2626", border:"#fca5a5"}
       ].map(opt => (
        <TouchableOpacity
          key={opt.v}
          style={[hst.toggleBtn,
            value === opt.v
              ? { backgroundColor: opt.bg, borderColor: opt.border }
              : { backgroundColor: "#f8fafc", borderColor: "#e2e8f0" },
            disabled && { opacity: 0.45 },
          ]}
          onPress={() => !disabled && onChange(opt.v)}
          activeOpacity={0.7}
        >
          <Text style={[hst.toggleTxt, value === opt.v && { color: opt.color, fontWeight: "700" }]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ hired, resigned, hasAccount }) {
  if (resigned === "Y")  return <View style={[hst.badge, { backgroundColor: "#fee2e2" }]}><Text style={[hst.badgeTxt, { color: "#dc2626" }]}>Resigned</Text></View>;
  if (hired    === "Y")  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      <View style={[hst.badge, { backgroundColor: "#dcfce7" }]}><Text style={[hst.badgeTxt, { color: "#16a34a" }]}>Hired</Text></View>
      {hasAccount === "1" || hasAccount === 1
        ? <View style={[hst.badge, { backgroundColor: "#eff6ff" }]}><Text style={[hst.badgeTxt, { color: "#1e40af" }]}>Account ✓</Text></View>
        : null}
    </View>
  );
  return <View style={[hst.badge, { backgroundColor: "#fef3c7" }]}><Text style={[hst.badgeTxt, { color: "#d97706" }]}>Pending</Text></View>;
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function HiringPendingScreen() {
  const { user } = useContext(AuthContext);

  const [staff,         setStaff]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [branches,      setBranches]      = useState([]);
  const [modalVisible,  setModalVisible]  = useState(false);
  const [selected,      setSelected]      = useState(null);
  const [search,        setSearch]        = useState("");

  // Hiring form state
  const [form, setForm] = useState({
    date_of_hiring:   "",
    expected_salary:  "",
    hired:            "N",
    resigned:         "N",
    resignation_date: "",
  });
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const [data, branchData] = await Promise.all([
        fetchHiringList(user),
        fetchBranches(user),
      ]);
      setStaff(Array.isArray(data) ? data : []);
      const bl = Array.isArray(branchData) ? branchData : branchData?.data ?? [];
      setBranches(bl);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load staff list");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Open review modal ───────────────────────────────────────────────────────
  const openModal = (item) => {
    setSelected(item);
    setForm({
      date_of_hiring:   item.date_of_hiring   ?? "",
      expected_salary:  item.expected_salary  ?? "",
      salary:           item.salary           ?? "",
      branch_id:        item.branch_id        ? String(item.branch_id) : "",
      hired:            item.hired            ?? "N",
      resigned:         item.resigned         ?? "N",
      resignation_date: item.resignation_date ?? "",
    });
    setModalVisible(true);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (form.hired === "Y" && !form.date_of_hiring) {
      Alert.alert("Validation", "Please set a Hiring Date before marking as Hired.");
      return;
    }
    if (form.resigned === "Y" && !form.resignation_date) {
      Alert.alert("Validation", "Please set a Resignation Date.");
      return;
    }

    const isNewHire = form.hired === "Y" &&
                      (selected?.hired ?? "N") !== "Y" &&
                      !Number(selected?.has_account);

    if (isNewHire) {
      Alert.alert(
        "Confirm Hiring",
        `Marking ${selected?.first_name} ${selected?.last_name} as Hired will:\n\n` +
        `• Create a user account (username: ${selected?.first_name?.toLowerCase()}.${selected?.last_name?.toLowerCase()})\n` +
        `• Send welcome email to ${selected?.email_address}\n\n` +
        `Proceed?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Confirm & Hire", onPress: save },
        ]
      );
    } else {
      save();
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      const result = await updateHiringDetails(user, selected.staff_id, form);
      setModalVisible(false);
      load();

      let msg = result.message ?? "Updated successfully.";
      if (result.account_created) {
        msg += result.email_sent
          ? "\n\nWelcome email sent to the staff member."
          : "\n\nAccount created but email could not be sent. Please share credentials manually.";
      }
      Alert.alert("Success", msg);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to update hiring details");
    } finally {
      setSaving(false);
    }
  };

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = staff.filter(s => {
    const q = search.toLowerCase();
    return !q ||
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      (s.specialty ?? "").toLowerCase().includes(q) ||
      (s.category_name ?? "").toLowerCase().includes(q);
  });

  // ── Card ────────────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const name    = `${item.staff_title ? item.staff_title + " " : ""}${item.first_name} ${item.last_name}`;
    const initials = `${item.first_name?.[0] ?? ""}${item.last_name?.[0] ?? ""}`.toUpperCase();
    return (
      <View style={hst.card}>
        {/* Left — avatar + info */}
        <View style={hst.cardLeft}>
          {item.staff_photo
            ? <Image source={{ uri: item.staff_photo }} style={hst.avatar} />
            : <View style={hst.avatarFallback}><Text style={hst.avatarTxt}>{initials}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={hst.staffName} numberOfLines={1}>{name}</Text>
            <Text style={hst.staffMeta} numberOfLines={1}>
              {item.category_name ?? "—"}
              {item.specialty ? ` · ${item.specialty}` : ""}
            </Text>
            <Text style={hst.staffMeta}>{item.email_address ?? "No email"}</Text>
            <View style={{ marginTop: 5 }}>
              <StatusBadge hired={item.hired} resigned={item.resigned} hasAccount={item.has_account} />
            </View>
          </View>
        </View>

        {/* Right — review button */}
        <TouchableOpacity style={hst.reviewBtn} onPress={() => openModal(item)}>
          <Feather name="edit-2" size={13} color="#1e40af" />
          <Text style={hst.reviewBtnTxt}>Review</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={hst.container}>

      {/* Search */}
      <View style={hst.searchWrap}>
        <Feather name="search" size={14} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={hst.searchInput}
          placeholder="Search by name, specialty, category…"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={14} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Counts */}
      <View style={hst.statsRow}>
        {[
          { label: "Total",   count: staff.length,                             color: "#1e40af", bg: "#eff6ff" },
          { label: "Pending", count: staff.filter(s => s.hired !== "Y" && s.resigned !== "Y").length, color: "#d97706", bg: "#fef3c7" },
          { label: "Hired",   count: staff.filter(s => s.hired === "Y").length, color: "#16a34a", bg: "#dcfce7" },
          { label: "Resigned",count: staff.filter(s => s.resigned === "Y").length, color: "#dc2626", bg: "#fee2e2" },
        ].map(s => (
          <View key={s.label} style={[hst.statChip, { backgroundColor: s.bg }]}>
            <Text style={[hst.statCount, { color: s.color }]}>{s.count}</Text>
            <Text style={[hst.statLabel, { color: s.color }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* List */}
      {loading
        ? <View style={hst.loader}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={hst.loaderTxt}>Loading staff…</Text>
          </View>
        : <FlatList
            data={filtered}
            keyExtractor={item => String(item.staff_id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)}
                colors={["#1e40af"]} tintColor="#1e40af" />
            }
            ListEmptyComponent={
              <View style={hst.empty}>
                <Feather name="users" size={36} color="#cbd5e1" />
                <Text style={hst.emptyTxt}>No staff found</Text>
              </View>
            }
          />}

      {/* Review Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={hst.modalOverlay}>
          <View style={hst.modalCard}>

            {/* Modal header */}
            <View style={hst.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={hst.modalTitle} numberOfLines={1}>
                  {selected?.first_name} {selected?.last_name}
                </Text>
                <Text style={hst.modalSub}>{selected?.email_address}</Text>
              </View>
              <TouchableOpacity style={hst.modalClose} onPress={() => setModalVisible(false)} disabled={saving}>
                <Feather name="x" size={15} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>

              {/* ── Registration Info (read-only) ── */}
              <Text style={hst.sectionHead}>Registration Details</Text>

              <View style={hst.infoGrid}>
                <InfoRow label="Full Name"    value={`${selected?.staff_title ? selected.staff_title + " " : ""}${selected?.first_name ?? ""} ${selected?.last_name ?? ""}`} />
                <InfoRow label="Gender"       value={selected?.gender} />
                <InfoRow label="Date of Birth"value={selected?.date_of_birth} />
                <InfoRow label="Mobile"       value={selected?.mobile_number} />
                <InfoRow label="Email"        value={selected?.email_address} />
                <InfoRow label="Address"      value={selected?.address} wide />
                <InfoRow label="State"        value={selected?.state} />
                <InfoRow label="Father Name"  value={selected?.father_name} />
                <InfoRow label="Mother Name"  value={selected?.mother_name} />

                <InfoRow label="Category"     value={selected?.category_name} />
                <InfoRow label="Specialty"    value={selected?.specialty} />
                <InfoRow label="Experience"   value={selected?.years_of_experience ? `${selected.years_of_experience} yrs` : null} />
                <InfoRow label="Expected Salary" value={selected?.expected_salary ? `${selected.expected_salary}` : null} />
              </View>

              <View style={hst.divider} />

              {/* ── Hiring Decision ── */}
              <Text style={hst.sectionHead}>Hiring Decision</Text>

              {/* Hiring Date */}
              <Text style={hst.fieldLabel}>Hiring Date</Text>
              <DateField
                label="Hiring Date"
                value={form.date_of_hiring}
                onChange={v => setField("date_of_hiring", v)}
                disabled={saving}
              />

              {/* Branch */}
              <Text style={hst.fieldLabel}>Branch</Text>
              <BranchDropdown
                value={form.branch_id}
                branches={branches}
                onChange={v => setField("branch_id", v)}
                disabled={saving}
              />

              {/* Hiring Salary */}
              <Text style={hst.fieldLabel}>Hiring Salary</Text>
              <TextInput
                style={hst.input}
                placeholder="Enter confirmed salary"
                placeholderTextColor="#94a3b8"
                value={String(form.salary)}
                onChangeText={v => setField("salary", v)}
                keyboardType="numeric"
                editable={!saving}
              />

              {/* Hired toggle */}
              <Text style={hst.fieldLabel}>Hired</Text>
              {Number(selected?.has_account) > 0
                ? <View style={hst.accountBanner}>
                    <Feather name="check-circle" size={14} color="#16a34a" />
                    <Text style={hst.accountBannerTxt}>Account already created</Text>
                  </View>
                : <Toggle
                    value={form.hired}
                    onChange={v => setField("hired", v)}
                    yesLabel="Yes — Hire"
                    noLabel="No — Pending"
                    disabled={saving}
                  />}

              {/* Resigned toggle */}
              <Text style={[hst.fieldLabel, { marginTop: 10 }]}>Resigned</Text>
              <Toggle
                value={form.resigned}
                onChange={v => { setField("resigned", v); if (v === "N") setField("resignation_date", ""); }}
                yesLabel="Yes"
                noLabel="No"
                disabled={saving}
              />

              {/* Resignation Date */}
              {form.resigned === "Y" && (
                <>
                  <Text style={[hst.fieldLabel, { marginTop: 10 }]}>Resignation Date</Text>
                  <DateField
                    label="Resignation Date"
                    value={form.resignation_date}
                    onChange={v => setField("resignation_date", v)}
                    disabled={saving}
                  />
                </>
              )}

              {/* Account creation notice */}
              {form.hired === "Y" && !Number(selected?.has_account) && (
                <View style={hst.noticeBanner}>
                  <Feather name="info" size={13} color="#1e40af" />
                  <Text style={hst.noticeTxt}>
                    Saving will create a user account and send a welcome email to{" "}
                    {selected?.email_address || "staff email"}.
                  </Text>
                </View>
              )}

            </ScrollView>

            {/* Action buttons */}
            <View style={hst.modalBtns}>
              <TouchableOpacity style={hst.cancelBtn} onPress={() => setModalVisible(false)} disabled={saving}>
                <Text style={hst.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[hst.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Feather name="check" size={14} color="#fff" />
                      <Text style={hst.saveBtnTxt}>Save</Text>
                    </>}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

    </View>
  );
}

// ── BranchDropdown ────────────────────────────────────────────────────────────
function BranchDropdown({ value, branches, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const selected = branches.find(b => String(b.branch_id) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[hst.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[{ fontSize: 13, color: selected ? "#0f172a" : "#94a3b8", flex: 1 }]} numberOfLines={1}>
          {selected?.branch_name ?? "Select Branch"}
        </Text>
        <Feather name="chevron-down" size={13} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={hst.dpOverlay}>
          <View style={[hst.dpSheet, { maxHeight: "60%" }]}>
            <View style={hst.dpHeader}>
              <Text style={hst.dpTitle}>Select Branch</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={hst.dpClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {branches.map(b => (
                <TouchableOpacity
                  key={b.branch_id}
                  style={[hst.dpItem, String(b.branch_id) === String(value) && hst.dpItemActive, { paddingHorizontal: 16, borderRadius: 0 }]}
                  onPress={() => { onChange(String(b.branch_id)); setOpen(false); }}
                >
                  <Text style={[hst.dpItemTxt, String(b.branch_id) === String(value) && hst.dpItemTxtActive, { fontSize: 13 }]}>
                    {b.branch_name}
                  </Text>
                  {String(b.branch_id) === String(value) &&
                    <Feather name="check" size={13} color="#fff" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── InfoRow — read-only registration field display ────────────────────────────
function InfoRow({ label, value, wide }) {
  return (
    <View style={[hst.infoRowItem, wide && { width: "100%" }]}>
      <Text style={hst.infoLabel}>{label}</Text>
      <Text style={hst.infoVal}>{value || "—"}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const hst = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f8fafc", padding: 14 },

  // Search
  searchWrap:  { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 13, color: "#0f172a" },

  // Stats
  statsRow:    { flexDirection: "row", gap: 6, marginBottom: 12 },
  statChip:    { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  statCount:   { fontSize: 16, fontWeight: "800" },
  statLabel:   { fontSize: 10, fontWeight: "600", textTransform: "uppercase" },

  // Card
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardLeft:    { flexDirection: "row", gap: 10, flex: 1, marginRight: 8 },
  avatar:      { width: 44, height: 44, borderRadius: 12 },
  avatarFallback: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  avatarTxt:   { fontSize: 14, fontWeight: "800", color: "#1e40af" },
  staffName:   { fontSize: 13, fontWeight: "800", color: "#1946b2" },
  staffMeta:   { fontSize: 11, color: "#64748b", marginTop: 2 },
  reviewBtn:   { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: "#dbeafe" },
  reviewBtnTxt:{ fontSize: 11, fontWeight: "700", color: "#1e40af" },

  // Badge
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeTxt:    { fontSize: 10, fontWeight: "700" },

  // Loader / empty
  loader:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:   { color: "#64748b", fontSize: 13 },
  empty:       { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:    { fontSize: 14, color: "#94a3b8", fontWeight: "600" },

  // Modal
  modalOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  modalCard:   { backgroundColor: "#fff", borderRadius: 20, padding: 18, width: "100%", maxHeight: "88%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 },
  modalTitle:  { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalSub:    { fontSize: 11, color: "#64748b", marginTop: 2 },
  modalClose:  { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  // Section heading in modal
  sectionHead:  { fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },

  // Info grid — 2 column read-only display
  infoGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  infoRowItem:  { width: "47%", backgroundColor: "#f8fafc", borderRadius: 10, padding: 10 },
  infoLabel:    { fontSize: 10, color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", marginBottom: 3 },
  infoVal:      { fontSize: 12, color: "#0f172a", fontWeight: "600" },
  divider:     { height: 1, backgroundColor: "#f1f5f9", marginBottom: 14 },

  // Field
  fieldLabel:  { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input:       { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, color: "#0f172a", marginBottom: 12 },
  inputTxt:    { flex: 1, fontSize: 13, color: "#0f172a" },

  // Toggle
  toggleRow:   { flexDirection: "row", gap: 8, marginBottom: 12 },
  toggleBtn:   { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  toggleTxt:   { fontSize: 12, color: "#64748b", fontWeight: "500" },

  // Banners
  noticeBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#eff6ff", borderRadius: 10, padding: 10, marginTop: 10, marginBottom: 4 },
  noticeTxt:    { flex: 1, fontSize: 11, color: "#1e40af", lineHeight: 16 },
  accountBanner:{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#dcfce7", borderRadius: 10, padding: 10, marginBottom: 12 },
  accountBannerTxt: { fontSize: 12, color: "#16a34a", fontWeight: "600" },

  // Modal buttons
  modalBtns:   { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  cancelBtn:   { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt:{ color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:  { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Date picker
  dpOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  dpSheet:     { backgroundColor: "#fff", borderRadius: 18, width: "100%", maxHeight: "75%", overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0" },
  dpHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  dpTitle:     { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  dpClose:     { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  dpPreviewRow:{ alignItems: "center", paddingVertical: 10, backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#dbeafe" },
  dpPreview:   { fontSize: 16, fontWeight: "800", color: "#1e40af" },
  dpCols:      { flexDirection: "row", height: 180, padding: 8 },
  dpCol:       { flex: 1, marginHorizontal: 3 },
  dpColLabel:  { fontSize: 10, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", textAlign: "center", marginBottom: 4 },
  dpItem:      { paddingVertical: 8, paddingHorizontal: 4, borderRadius: 7, alignItems: "center", marginBottom: 2 },
  dpItemActive:{ backgroundColor: "#1e40af" },
  dpItemTxt:   { fontSize: 12, color: "#334155" },
  dpItemTxtActive: { color: "#fff", fontWeight: "700" },
  dpConfirm:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, margin: 12, backgroundColor: "#1e40af", borderRadius: 10, paddingVertical: 11 },
  dpConfirmTxt:{ color: "#fff", fontSize: 13, fontWeight: "700" },
});