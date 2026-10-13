/**
 * screens/Staff/HiredStaffScreen.js
 * Displays all hired (active) staff as cards.
 * Tapping a card shows the full staff detail modal.
 */
import React, { useState, useContext, useCallback, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, ScrollView, ActivityIndicator,
  Image, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { HOST_NAME } from "../../Environment/EnvironmentConfig";
import { fetchHiredStaff } from "../../services/StaffServiceApi";
import { _t, _tx } from "../../services/i18n";

// ── Detail row ────────────────────────────────────────────────────────────────
const DetailRow = ({ icon, label, value }) => {
  if (!value) return null;
  return (
    <View style={st.detailRow}>
      <View style={st.detailIconWrap}>
        <Feather name={icon} size={13} color="#1e40af" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.detailLabel}>{_tx(label)}</Text>
        <Text style={st.detailValue}>{_tx(value)}</Text>
      </View>
    </View>
  );
};

// ── Section heading ───────────────────────────────────────────────────────────
const SectionHead = ({ icon, title }) => (
  <View style={st.sectionHead}>
    <View style={st.sectionIconWrap}>
      <Feather name={icon} size={12} color="#1e40af" />
    </View>
    <Text style={st.sectionTitle}>{_tx(title)}</Text>
  </View>
);

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function HiredStaffScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [staff,        setStaff]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [search,       setSearch]       = useState("");
  const [selected,     setSelected]     = useState(null);
  const [detailVisible,setDetailVisible]= useState(false);
  const [optionsVisible,setOptionsVisible]= useState(false);
  const [optionStaff,   setOptionStaff]   = useState(null);
  const selectedRef    = useRef(null);
  const optionStaffRef = useRef(null);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const data = await fetchHiredStaff(user);
      setStaff(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log("HiredStaff error:", e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = staff.filter(s => {
    const q = search.toLowerCase();
    return !q ||
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      (s.specialty     ?? "").toLowerCase().includes(q) ||
      (s.category_name ?? "").toLowerCase().includes(q) ||
      (s.branch_name   ?? "").toLowerCase().includes(q);
  });

  const openDetail = (item) => {
    selectedRef.current = item;
    setSelected(item);
    setDetailVisible(true);
  };

  const openOptions = (item) => {
    optionStaffRef.current = item;
    setOptionStaff(item);
    setOptionsVisible(true);
  };

  // ── Staff card ───────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const initials  = `${item.first_name?.[0] ?? ""}${item.last_name?.[0] ?? ""}`.toUpperCase();
    const fullName  = `${item.staff_title ? item.staff_title + " " : ""}${item.first_name} ${item.last_name}`;
    const photoUri  = item.staff_photo
      ? (`${HOST_NAME}/clients/${user?.ssmsClientCode}/Staffs/${item.staff_photo}`|| "https://via.placeholder.com/200x200.png?text=ST")
      : null;
    return (
      <TouchableOpacity style={st.card} onPress={() => openOptions(item)} activeOpacity={0.75}>
        {/* Photo / Avatar */}
        <View style={st.cardTop}>
          {photoUri
            ? <Image source={{ uri: photoUri }} style={st.photo} />
            : <View style={st.avatarWrap}>
                <Text style={st.avatarTxt}>{_tx(initials)}</Text>
              </View>}

          {/* Name & category */}
          <View style={st.cardTopInfo}>
            <Text style={st.cardName} numberOfLines={1}>{_tx(fullName)}</Text>
            <View style={st.categoryPill}>
              <Text style={st.categoryPillTxt}>{_tx(item.category_name) ?? _t("Staff")}</Text>
            </View>
          </View>
        </View>

        {/* Details strip */}
        <View style={st.cardStrip}>
          <View style={st.stripItem}>
            <Feather name="briefcase" size={11} color="#64748b" />
            <Text style={st.stripTxt} numberOfLines={1}>{_tx(item.specialty) || "—"}</Text>
          </View>
          <View style={st.stripItem}>
            <Feather name="home" size={11} color="#64748b" />
            <Text style={st.stripTxt} numberOfLines={1}>{_tx(item.branch_name) || "—"}</Text>
          </View>
          <View style={st.stripItem}>
            <Feather name="phone" size={11} color="#64748b" />
            <Text style={st.stripTxt}>{_tx(item.mobile_number) || "—"}</Text>
          </View>
          {item.date_of_hiring && (
            <View style={st.stripItem}>
              <Feather name="calendar" size={11} color="#64748b" />
              <Text style={st.stripTxt}>{_tx(item.date_of_hiring)}</Text>
            </View>
          )}
        </View>

        {/* Options hint */}
        <View style={st.cardFooter}>
          <Feather name="more-horizontal" size={12} color="#1e40af" />
          <Text style={st.cardFooterTxt}>{_t("Tap to view more options")}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Detail Modal ─────────────────────────────────────────────────────────────
  const s = selectedRef.current ?? selected;
  const fullName = s
    ? `${s.staff_title ? s.staff_title + " " : ""}${s.first_name} ${s.last_name}`
    : "";
  const initials = s
    ? `${s.first_name?.[0] ?? ""}${s.last_name?.[0] ?? ""}`.toUpperCase()
    : "";

  return (
    <SafeAreaView style={st.safe} edges={["bottom"]}>

      {/* Search bar */}
      <View style={st.searchWrap}>
        <Feather name="search" size={14} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={st.searchInput}
          placeholder={_t("Search by name, specialty, branch…")}
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

      {/* Count */}
      <Text style={st.countTxt}>{_t("{length} hired staff{pl}", { length: filtered.length, pl: filtered.length !== 1 ? "" : "" })}</Text>

      {/* List */}
      {loading
        ? <View style={st.loader}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={st.loaderTxt}>{_t("Loading staff…")}</Text>
          </View>
        : <FlatList
            data={filtered}
            keyExtractor={item => String(item.staff_id)}
            renderItem={renderItem}
            numColumns={2}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={st.list}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load(true)}
                colors={["#1e40af"]}
                tintColor="#1e40af"
              />
            }
            ListEmptyComponent={
              <View style={st.empty}>
                <Feather name="users" size={40} color="#cbd5e1" />
                <Text style={st.emptyTxt}>{_t("No hired staff found")}</Text>
                <Text style={st.emptySubTxt}>{_t("Staff must be marked as Hired in Hiring Review")}</Text>
              </View>
            }
          />}


      {/* ── Options Modal ── */}
      <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={() => setOptionsVisible(false)}>
        <TouchableOpacity style={st.optOverlay} onPress={() => setOptionsVisible(false)} activeOpacity={1}>
          <View style={st.optSheet}>

            {/* Staff quick info */}
            <View style={st.optHeader}>
              {optionStaff?.staff_photo
                ? <Image
                    source={{ uri: optionStaff.staff_photo?.startsWith("http") ? optionStaff.staff_photo : HOST_NAME + optionStaff.staff_photo }}
                    style={st.optPhoto}
                  />
                : <View style={st.optAvatar}>
                    <Text style={st.optAvatarTxt}>
                      {`${optionStaff?.first_name?.[0] ?? ""}${optionStaff?.last_name?.[0] ?? ""}`.toUpperCase()}
                    </Text>
                  </View>}
              <View style={{ flex: 1 }}>
                <Text style={st.optName} numberOfLines={1}>
                  {`${optionStaff?.staff_title ? optionStaff.staff_title + " " : ""}${_tx(optionStaff?.first_name) ?? ""} ${_tx(optionStaff?.last_name) ?? ""}`}
                </Text>
                <Text style={st.optRole}>{_tx(optionStaff?.category_name) ?? _t("Staff")}</Text>
              </View>
            </View>

            <View style={st.optDivider} />

            {/* Option 1 — View Profile */}
            <TouchableOpacity
              style={st.optItem}
              onPress={() => {
                setOptionsVisible(false);
                setTimeout(() => { setSelected(optionStaffRef.current ?? optionStaff); setDetailVisible(true); }, 200);
              }}
            >
              <View style={[st.optItemIcon, { backgroundColor: "#eff6ff" }]}>
                <Feather name="user" size={16} color="#1e40af" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.optItemLabel}>{_t("View Complete Profile")}</Text>
                <Text style={st.optItemSub}>{_t("See all staff details and documents")}</Text>
              </View>
              <Feather name="chevron-right" size={14} color="#94a3b8" />
            </TouchableOpacity>

            {/* Option 2 — Update Profile */}
            <TouchableOpacity
              style={st.optItem}
              onPress={() => {
                setOptionsVisible(false);
                setOptionsVisible(false);
                navigation.push("StaffRegistration", {
                  staff: {
                    staff_id:            optionStaff?.staff_id            ?? null,
                    staff_title:         optionStaff?.staff_title         ?? "",
                    first_name:          optionStaff?.first_name          ?? "",
                    last_name:           optionStaff?.last_name           ?? "",
                    email_address:       optionStaff?.email_address       ?? "",
                    mobile_number:       optionStaff?.mobile_number != null ? String(optionStaff.mobile_number) : "",
                    address:             optionStaff?.address             ?? "",
                    state:               optionStaff?.state               ?? "",
                    father_name:         optionStaff?.father_name         ?? "",
                    mother_name:         optionStaff?.mother_name         ?? "",
                    date_of_birth:       optionStaff?.date_of_birth       ?? "",
                    gender:              optionStaff?.gender              ?? "",
                    date_of_hiring:      optionStaff?.date_of_hiring      ?? "",
                    years_of_experience: optionStaff?.years_of_experience != null ? String(optionStaff.years_of_experience) : "",
                    specialty:           optionStaff?.specialty           ?? "",
                    expected_salary:     optionStaff?.expected_salary != null ? String(optionStaff.expected_salary) : "",
                    category_id:         optionStaff?.category_id        ? String(optionStaff.category_id) : "",
                    branch_id:           optionStaff?.branch_id          ? String(optionStaff.branch_id)   : "",
                  }
                });
              }}
            >
              <View style={[st.optItemIcon, { backgroundColor: "#fef3c7" }]}>
                <Feather name="edit-2" size={16} color="#d97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.optItemLabel}>{_t("Update Profile")}</Text>
                <Text style={st.optItemSub}>{_t("Edit staff registration details")}</Text>
              </View>
              <Feather name="chevron-right" size={14} color="#94a3b8" />
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity style={st.optCancel} onPress={() => setOptionsVisible(false)}>
              <Text style={st.optCancelTxt}>{_t("Cancel")}</Text>
            </TouchableOpacity>

          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Detail Modal ── */}
      <Modal visible={detailVisible} transparent animationType="slide" onRequestClose={() => setDetailVisible(false)}>
        <View style={st.detailOverlay}>
          <View style={st.detailSheet}>

            {/* Header */}
            <View style={st.detailHeader}>
              {s?.staff_photo
                ? <Image source={{ uri: s.staff_photo?.startsWith("http") ? s.staff_photo : HOST_NAME + s.staff_photo }} style={st.detailPhoto} />
                : <View style={st.detailAvatar}><Text style={st.detailAvatarTxt}>{_tx(initials)}</Text></View>}
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={st.detailName}>{_tx(fullName)}</Text>
                <View style={st.categoryPill}>
                  <Text style={st.categoryPillTxt}>{_tx(s?.category_name) ?? _t("Staff")}</Text>
                </View>
                {s?.specialty
                  ? <Text style={st.detailSpecialty}>{_tx(s.specialty)}</Text>
                  : null}
              </View>
              <TouchableOpacity style={st.detailClose} onPress={() => setDetailVisible(false)}>
                <Feather name="x" size={16} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={true} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>

              {/* ── Personal Info ── */}
              <SectionHead icon="user" title={_t("Personal Information")} />
              <View style={st.detailGrid}>
                <DetailRow icon="hash"       label={_t("Staff ID")}       value={s?.staff_id ? `#${s.staff_id}` : null} />
                <DetailRow icon="user"       label={_t("Gender")}         value={s?.gender} />
                <DetailRow icon="calendar"   label={_t("Date of Birth")}  value={s?.date_of_birth} />
                <DetailRow icon="users"      label={_t("Father Name")}    value={s?.father_name} />
                <DetailRow icon="users"      label={_t("Mother Name")}    value={s?.mother_name} />
              </View>

              {/* ── Contact ── */}
              <SectionHead icon="phone" title={_t("Contact Details")} />
              <View style={st.detailGrid}>
                <DetailRow icon="phone"    label={_t("Mobile")}   value={s?.mobile_number} />
                <DetailRow icon="mail"     label={_t("Email")}    value={s?.email_address} />
                <DetailRow icon="map-pin"  label={_t("Address")}  value={s?.address} />
                <DetailRow icon="map"      label={_t("State")}    value={s?.state} />
              </View>

              {/* ── Employment ── */}
              <SectionHead icon="briefcase" title={_t("Employment Details")} />
              <View style={st.detailGrid}>
                <DetailRow icon="home"         label={_t("Branch")}           value={s?.branch_name} />
                <DetailRow icon="tag"          label={_t("Category")}         value={s?.category_name} />
                <DetailRow icon="book-open"    label={_t("Specialty")}        value={s?.specialty} />
                <DetailRow icon="calendar"     label={_t("Date of Hiring")}   value={s?.date_of_hiring} />
                <DetailRow icon="award"        label={_t("Experience")}       value={s?.years_of_experience ? `${s.years_of_experience} years` : null} />
                <DetailRow icon="trending-up"  label={_t("Expected Salary")}  value={s?.expected_salary ? `${s.expected_salary}` : null} />
                <DetailRow icon="dollar-sign"  label={_t("Hiring Salary")}    value={s?.salary ? `${s.salary}` : null} />
              </View>

              {/* ── Documents ── */}
              {(s?.id_proof || s?.address_proof || s?.experience_letter) && (
                <>
                  <SectionHead icon="file-text" title={_t("Documents")} />
                  <View style={st.detailGrid}>
                    {s?.id_proof && (
                      <View style={st.docChip}>
                        <Feather name="file" size={13} color="#1e40af" />
                        <Text style={st.docChipTxt}>{_t("ID Proof")}</Text>
                        <View style={[st.docBadge, { backgroundColor: "#dcfce7" }]}>
                          <Text style={[st.docBadgeTxt, { color: "#16a34a" }]}>{_t("Uploaded")}</Text>
                        </View>
                      </View>
                    )}
                    {s?.address_proof && (
                      <View style={st.docChip}>
                        <Feather name="file" size={13} color="#1e40af" />
                        <Text style={st.docChipTxt}>{_t("Address Proof")}</Text>
                        <View style={[st.docBadge, { backgroundColor: "#dcfce7" }]}>
                          <Text style={[st.docBadgeTxt, { color: "#16a34a" }]}>{_t("Uploaded")}</Text>
                        </View>
                      </View>
                    )}
                    {s?.experience_letter && (
                      <View style={st.docChip}>
                        <Feather name="file" size={13} color="#1e40af" />
                        <Text style={st.docChipTxt}>{_t("Exp. Letter")}</Text>
                        <View style={[st.docBadge, { backgroundColor: "#dcfce7" }]}>
                          <Text style={[st.docBadgeTxt, { color: "#16a34a" }]}>{_t("Uploaded")}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                </>
              )}

              <View style={{ height: 24 }} />
            </ScrollView>

          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#f8fafc" },

  // Search
  searchWrap:   { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 14, marginTop: 10, marginBottom: 6 },
  searchInput:  { flex: 1, fontSize: 13, color: "#0f172a" },
  countTxt:     { fontSize: 11, color: "#94a3b8", fontWeight: "600", paddingHorizontal: 14, marginBottom: 8 },

  // List
  list:         { paddingHorizontal: 14, paddingBottom: 40 },
  loader:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:    { color: "#64748b", fontSize: 13 },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:  { fontSize: 12, color: "#cbd5e1", textAlign: "center", paddingHorizontal: 30 },

  // Card — 2 per row
  card:         { flex: 1, backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#e2e8f0", borderTopWidth: 3, borderTopColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3, overflow: "hidden" },
  cardTop:      { padding: 14, alignItems: "center" },
  photo:        { width: 64, height: 64, borderRadius: 20, marginBottom: 10 },
  avatarWrap:   { width: 64, height: 64, borderRadius: 20, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  avatarTxt:    { fontSize: 22, fontWeight: "800", color: "#1e40af" },
  cardTopInfo:  { alignItems: "center", width: "100%" },
  cardName:     { fontSize: 13, fontWeight: "800", color: "#1946b2", textAlign: "center", marginBottom: 5 },
  categoryPill: { backgroundColor: "#eff6ff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  categoryPillTxt: { fontSize: 10, fontWeight: "700", color: "#1e40af" },

  // Strip
  cardStrip:    { paddingHorizontal: 12, paddingBottom: 10, gap: 4 },
  stripItem:    { flexDirection: "row", alignItems: "center", gap: 5 },
  stripTxt:     { fontSize: 11, color: "#64748b", flex: 1 },

  // Footer
  cardFooter:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#f8fafc", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  cardFooterTxt:{ fontSize: 10, color: "#1e40af", fontWeight: "600" },

  // Options modal
  optOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  optSheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, overflow: "hidden" },
  optHeader:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 18, backgroundColor: "#f8fafc" },
  optPhoto:      { width: 46, height: 46, borderRadius: 14 },
  optAvatar:     { width: 46, height: 46, borderRadius: 14, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  optAvatarTxt:  { fontSize: 16, fontWeight: "800", color: "#1e40af" },
  optName:       { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  optRole:       { fontSize: 12, color: "#64748b", marginTop: 2 },
  optDivider:    { height: 1, backgroundColor: "#f1f5f9" },
  optItem:       { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  optItemIcon:   { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optItemLabel:  { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  optItemSub:    { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  optCancel:     { marginHorizontal: 18, marginTop: 12, paddingVertical: 13, backgroundColor: "#f1f5f9", borderRadius: 12, alignItems: "center" },
  optCancelTxt:  { fontSize: 14, fontWeight: "700", color: "#475569" },

  // Detail Modal
  detailOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", paddingTop: 60 },
  detailSheet:  { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, height: "92%", paddingBottom: 20 },

  // Detail Header
  detailHeader: { flexDirection: "row", alignItems: "flex-start", padding: 18, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  detailPhoto:  { width: 70, height: 70, borderRadius: 18 },
  detailAvatar: { width: 70, height: 70, borderRadius: 18, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  detailAvatarTxt: { fontSize: 24, fontWeight: "800", color: "#1e40af" },
  detailName:   { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 5 },
  detailSpecialty: { fontSize: 12, color: "#64748b", marginTop: 4 },
  detailClose:  { width: 30, height: 30, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  // Section heading
  sectionHead:     { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  sectionIconWrap: { width: 24, height: 24, borderRadius: 7, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  sectionTitle:    { fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6 },

  // Detail Grid
  detailGrid:   { paddingHorizontal: 16, paddingTop: 8, gap: 2 },
  detailRow:    { flexDirection: "row", alignItems: "flex-start", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f8fafc", gap: 10 },
  detailIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#f0f4ff", alignItems: "center", justifyContent: "center", marginTop: 2 },
  detailLabel:  { fontSize: 10, fontWeight: "600", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 },
  detailValue:  { fontSize: 13, color: "#0f172a", fontWeight: "500" },

  // Documents
  docChip:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 6 },
  docChipTxt:   { flex: 1, fontSize: 12, color: "#334155", fontWeight: "500" },
  docBadge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  docBadgeTxt:  { fontSize: 10, fontWeight: "700" },
});