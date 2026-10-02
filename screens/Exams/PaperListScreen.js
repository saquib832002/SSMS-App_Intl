/**
 * screens/Exams/PaperListScreen.js
 * List all question papers. Entry point for the paper builder flow.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchPapers, deletePaper, publishPaper } from "../../services/QuestionPaperServiceApi";
import { fetchBranches, fetchSessions } from "../../services/SetupServiceApi";

const STATUS_COLOR = { draft: "#f59e0b", published: "#10b981", archived: "#9ca3af" };
const STATUS_BG    = { draft: "#fef9c3", published: "#d1fae5", archived: "#f3f4f6" };

// ── Compact inline dropdown for the filter bar ─────────────────────────────────
function FilterPicker({ icon, label, value, items, labelKey, valueKey, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => String(i[valueKey]) === String(value));
  const isSet = !!value;
  return (
    <>
      <TouchableOpacity
        style={[st.filterBtn, isSet && st.filterBtnActive]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <Feather name={icon} size={12} color={isSet ? "#2563eb" : "#64748b"} />
        <Text style={[st.filterBtnTxt, isSet && st.filterBtnTxtActive]} numberOfLines={1}>
          {selected ? selected[labelKey] : label}
        </Text>
        <Feather name="chevron-down" size={12} color={isSet ? "#2563eb" : "#64748b"} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={st.modalOverlay} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={st.modalSheet}>
          <View style={st.modalHandle} />
          <Text style={st.modalTitle}>{label}</Text>
          <TouchableOpacity style={st.clearRow} onPress={() => { onChange(""); setOpen(false); }}>
            <Feather name="x-circle" size={14} color="#9ca3af" />
            <Text style={st.clearTxt}>Clear filter</Text>
          </TouchableOpacity>
          <FlatList
            data={items}
            keyExtractor={i => String(i[valueKey])}
            renderItem={({ item }) => {
              const isSel = String(item[valueKey]) === String(value);
              return (
                <TouchableOpacity
                  style={[st.modalItem, isSel && st.modalItemSel]}
                  onPress={() => { onChange(String(item[valueKey])); setOpen(false); }}
                >
                  <Text style={[st.modalItemTxt, isSel && st.modalItemTxtSel]}>
                    {item[labelKey]}
                  </Text>
                  {isSel && <Feather name="check" size={15} color="#2563eb" />}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={st.modalSep} />}
          />
        </View>
      </Modal>
    </>
  );
}

export default function PaperListScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [papers,  setPapers]  = useState([]);
  const [loading, setLoading] = useState(true);

  // Filter state — resolved to branch_id / session_id
  const [filterBranchId,  setFilterBranchId]  = useState("");
  const [filterSessionId, setFilterSessionId] = useState("");

  // Available options for filter dropdowns
  const [branches, setBranches] = useState([]);
  const [sessions, setSessions] = useState([]);

  // Load branches and sessions once for the filter dropdowns
  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetchBranches(user).catch(() => []),
      fetchSessions(user).catch(() => []),
    ]).then(([br, sess]) => {
      const norm = (r) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
      setBranches(norm(br));
      setSessions(norm(sess));
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterBranchId)  filters.branch_id  = filterBranchId;
      if (filterSessionId) filters.session_id = filterSessionId;
      const data = await fetchPapers(user, filters);
      setPapers(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load papers");
    } finally {
      setLoading(false);
    }
  }, [user, filterBranchId, filterSessionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDelete = (item) => {
    if (item.status === "published") { Alert.alert("Cannot Delete", "Published papers cannot be deleted. Archive it first."); return; }
    Alert.alert("Delete Paper", `Delete "${item.title}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await deletePaper(user, item.id); load(); } catch (e) { Alert.alert("Error", e.message); } } },
    ]);
  };

  const handlePublish = (item) => {
    Alert.alert("Publish Paper", `Publish "${item.title}"? It will become read-only.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Publish", onPress: async () => { try { await publishPaper(user, item.id); load(); } catch (e) { Alert.alert("Error", e.message); } } },
    ]);
  };

  const activeFilters = (filterBranchId ? 1 : 0) + (filterSessionId ? 1 : 0);

  const renderItem = ({ item }) => {
    const sc = STATUS_COLOR[item.status] ?? "#374151";
    const sb = STATUS_BG[item.status]   ?? "#f3f4f6";
    // Resolve branch name: prefer header_config (already has it) over raw branch_id
    const branchName = item.header_config?.branchName ?? "";
    return (
      <TouchableOpacity
        style={st.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate("PaperBuilder", { paper: item })}
      >
        <View style={st.cardTop}>
          <Text style={st.cardTitle} numberOfLines={1}>{item.title ?? "Untitled Paper"}</Text>
          <View style={[st.statusBadge, { backgroundColor: sb }]}>
            <Text style={[st.statusTxt, { color: sc }]}>{item.status ?? "draft"}</Text>
          </View>
        </View>
        <View style={st.cardMeta}>
          {!!branchName        && <MetaTag icon="git-branch" label={branchName} />}
          {!!item.class_name   && <MetaTag icon="book-open"  label={item.class_name} />}
          {!!item.subject_name && <MetaTag icon="book"       label={item.subject_name} />}
          {!!item.session      && <MetaTag icon="calendar"   label={item.session} />}
          {item.total_marks > 0 && <MetaTag icon="award"    label={`${item.total_marks} marks`} />}
        </View>
        <View style={st.cardBtns}>
          <TouchableOpacity style={st.editBtn} onPress={() => navigation.navigate("PaperBuilder", { paper: item })}>
            <Feather name="edit-3" size={13} color="#2563eb" />
            <Text style={st.editTxt}>{item.status === "published" ? "Preview" : "Edit / Build"}</Text>
          </TouchableOpacity>
          {item.status === "draft" && (
            <TouchableOpacity style={st.publishBtn} onPress={() => handlePublish(item)}>
              <Feather name="upload" size={13} color="#fff" />
              <Text style={st.publishTxt}>Publish</Text>
            </TouchableOpacity>
          )}
          {item.status !== "published" && (
            <TouchableOpacity style={st.delBtn} onPress={() => handleDelete(item)}>
              <Feather name="trash-2" size={14} color="#dc2626" />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={st.root}>
      <View style={st.header}>
        <View style={st.headerRow}>
          <Text style={st.headerTitle}>Question Papers</Text>
          <Text style={st.headerSub}>{papers.length} paper{papers.length !== 1 ? "s" : ""}</Text>
        </View>

        {/* Filter bar */}
        <View style={st.filterBar}>
          <FilterPicker
            icon="git-branch"
            label="All Branches"
            value={filterBranchId}
            items={branches}
            labelKey="branch_name"
            valueKey="branch_id"
            onChange={setFilterBranchId}
          />
          <FilterPicker
            icon="calendar"
            label="All Sessions"
            value={filterSessionId}
            items={sessions}
            labelKey="session_name"
            valueKey="session_id"
            onChange={setFilterSessionId}
          />
          {activeFilters > 0 && (
            <TouchableOpacity
              style={st.clearAllBtn}
              onPress={() => { setFilterBranchId(""); setFilterSessionId(""); }}
            >
              <Feather name="x" size={12} color="#dc2626" />
              <Text style={st.clearAllTxt}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={papers}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={st.list}
          ListEmptyComponent={
            <Text style={st.empty}>
              {activeFilters > 0
                ? "No papers match the selected filters."
                : "No papers yet.\nTap + to create your first paper."}
            </Text>
          }
        />
      )}

      <TouchableOpacity style={st.fab} onPress={() => navigation.navigate("PaperHeader", {})}>
        <Feather name="plus" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

function MetaTag({ icon, label }) {
  return (
    <View style={st.metaTag}>
      <Feather name={icon} size={11} color="#6b7280" />
      <Text style={st.metaTagTxt}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f8fafc" },
  header:      { backgroundColor: "#1e3a8a", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12 },
  headerRow:   { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  headerSub:   { fontSize: 13, color: "rgba(255,255,255,0.7)" },

  // Filter bar
  filterBar:        { flexDirection: "row", alignItems: "center", gap: 8 },
  filterBtn:        { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 140 },
  filterBtnActive:  { backgroundColor: "#fff" },
  filterBtnTxt:     { fontSize: 12, color: "rgba(255,255,255,0.85)", flex: 1 },
  filterBtnTxtActive:{ color: "#2563eb", fontWeight: "600" },
  clearAllBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  clearAllTxt:      { fontSize: 12, color: "#fca5a5", fontWeight: "600" },

  // Modal picker
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "60%", paddingBottom: 20 },
  modalHandle:  { width: 38, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginTop: 10, marginBottom: 8 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#1e293b", paddingHorizontal: 16, marginBottom: 4 },
  clearRow:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: "#f1f5f9" },
  clearTxt:     { fontSize: 13, color: "#9ca3af" },
  modalItem:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 },
  modalItemSel: { backgroundColor: "#eff6ff" },
  modalItemTxt: { fontSize: 14, color: "#374151" },
  modalItemTxtSel: { color: "#2563eb", fontWeight: "700" },
  modalSep:     { height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 16 },

  list:        { padding: 14, paddingBottom: 90 },
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, elevation: 2, shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 4 },
  cardTop:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  cardTitle:   { flex: 1, fontSize: 15, fontWeight: "800", color: "#0f172a", marginRight: 8 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusTxt:   { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  cardMeta:    { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  metaTag:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f1f5f9", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  metaTagTxt:  { fontSize: 11, color: "#374151" },
  cardBtns:    { flexDirection: "row", alignItems: "center", gap: 8 },
  editBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, borderWidth: 1, borderColor: "#2563eb", paddingHorizontal: 10, paddingVertical: 6 },
  editTxt:     { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  publishBtn:  { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, backgroundColor: "#10b981", paddingHorizontal: 10, paddingVertical: 6 },
  publishTxt:  { fontSize: 12, color: "#fff", fontWeight: "700" },
  delBtn:      { marginLeft: "auto", backgroundColor: "#fef2f2", borderRadius: 8, padding: 6 },
  empty:       { textAlign: "center", color: "#9ca3af", fontSize: 14, marginTop: 60, lineHeight: 22 },
  fab:         { position: "absolute", right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", elevation: 5 },
});
