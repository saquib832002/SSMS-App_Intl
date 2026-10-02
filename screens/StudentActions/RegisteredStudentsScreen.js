import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchBranches, fetchClasses, fetchSections, fetchSessions, getAllRegisteredStudents, enrollStudent } from "../../services/StudentServiceApi";
import { useFocusEffect } from "@react-navigation/native";
import { HOST_NAME } from "../../Environment/EnvironmentConfig";


// ── Course medium options ─────────────────────────────────────────────────────
const MEDIUM_OPTIONS = [
  { label: "Select Medium", value: "" },
  { label: "English",  value: "English"  },
  { label: "Hindi",    value: "Hindi"    },
  { label: "Urdu",     value: "Urdu"     },
  { label: "Arabic",   value: "Arabic"   },
  { label: "Assamese", value: "Assamese" },
  { label: "Bengali",  value: "Bengali"  },
  { label: "Dogri",    value: "Dogri"    },
  { label: "Gujarati", value: "Gujarati" },
  { label: "Kannada",  value: "Kannada"  },
  { label: "Kashmiri", value: "Kashmiri" },
  { label: "Maithili", value: "Maithili" },
  { label: "Malayalam",value: "Malayalam"},
  { label: "Marathi",  value: "Marathi"  },
  { label: "Nepali",   value: "Nepali"   },
  { label: "Odia",     value: "Odia"     },
  { label: "Pali",     value: "Pali"     },
  { label: "Prakrit",  value: "Prakrit"  },
  { label: "Punjabi",  value: "Punjabi"  },
  { label: "Sindhi",   value: "Sindhi"   },
  { label: "Tamil",    value: "Tamil"    },
  { label: "Telugu",   value: "Telugu"   },
  { label: "Others",   value: "Others"   },
];

// ── Custom Dropdown — replaces @react-native-picker/picker ───────────────────
// Fully JS-based: immune to Android dark mode, no native thread blocking.
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[_ddSt.trigger, disabled && _ddSt.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[_ddSt.triggerTxt, !selected?.value && _ddSt.placeholder]} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={_ddSt.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={_ddSt.sheet}>
            <Text style={_ddSt.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[_ddSt.option, String(o.value) === String(value) && _ddSt.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[_ddSt.optionTxt, String(o.value) === String(value) && _ddSt.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#2563eb" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const _ddSt = StyleSheet.create({
  trigger:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 0 },
  disabled:        { opacity: 0.45 },
  triggerTxt:      { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  placeholder:     { color: "#94a3b8" },
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:           { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:    { backgroundColor: "#eff6ff" },
  optionTxt:       { fontSize: 14, color: "#0f172a" },
  optionTxtActive: { color: "#2563eb", fontWeight: "700" },
});

export default function RegisteredStudentsScreen({ navigation }) {
  //console.log("HOST_NAME in RegisteredStudentsScreen:", {HOST_NAME});
  const { user } = useContext(AuthContext);

  // Debug — remove once token confirmed working
  useEffect(() => {
    // console.log('RegisteredStudents user.token:', user?.token ? 'PRESENT ✓' : 'MISSING ✗');
    // console.log('RegisteredStudents user.ssmsUserName:', user?.ssmsUserName);
  }, [user]);

  const [students, setStudents] = useState([]);
  const [classes,  setClasses]  = useState([]);
  const [sessions, setSessions] = useState([]);

  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [classId,   setClassId]   = useState("");
  const [sessionId, setSessionId] = useState("");

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [hasNextPage, setHasNextPage] = useState(true);

  const [loading, setLoading] = useState(true);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── Bulk enrollment ───────────────────────────────────────────────────────────
  const [selectedIds,        setSelectedIds]        = useState(new Set());
  const [bulkModal,          setBulkModal]          = useState(false);
  const [bulkBranchId,       setBulkBranchId]       = useState("");
  const [bulkClassId,        setBulkClassId]        = useState("");
  const [bulkSectionId,      setBulkSectionId]      = useState("");
  const [bulkSessionId,      setBulkSessionId]      = useState("");
  const [bulkMedium,         setBulkMedium]         = useState("");
  const [bulkSections,       setBulkSections]       = useState([]);
  const [bulkLoadingSections,setBulkLoadingSections]= useState(false);
  const [bulkEnrolling,      setBulkEnrolling]      = useState(false);
  const [bulkProgress,       setBulkProgress]       = useState({ done: 0, total: 0 });
  const [branches,           setBranches]           = useState([]);
  const [loadingBranches,    setLoadingBranches]    = useState(false);


useFocusEffect(
  useCallback(() => {
    if (user) loadStudents({ nextPage: 1, reset: true });
  }, [user, loadStudents])
);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText.trim());
    }, 500);

    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoadingFilters(true);
        const [classData, sessionData] = await Promise.all([
          fetchClasses(user),
          fetchSessions(user),
        ]);
        const clsList  = Array.isArray(classData)        ? classData
                       : Array.isArray(classData?.data)  ? classData.data  : [];
        const sessList = Array.isArray(sessionData)       ? sessionData
                       : Array.isArray(sessionData?.data) ? sessionData.data : [];
        setClasses(clsList);
        setSessions(sessList);
      } catch (error) {
        Alert.alert("Error", error.message || "Failed to load filters");
      } finally {
        setLoadingFilters(false);
      }
    })();
  }, [user]);

  const classOptions = useMemo(() => {
    return [
      { label: "All Classes", value: "" },
      ...classes.map((item) => ({
        label: item.class_name,
        value: String(item.class_id),
      })),
    ];
  }, [classes]);

  const sessionOptions = useMemo(() => [
    { label: "All Sessions", value: "" },
    ...sessions
      .filter(s => s.session_id != null)
      .map(s => ({
        label: s.session_name ?? s.session_year ?? `Session ${s.session_id}`,
        value: String(s.session_id),
      })),
  ], [sessions]);

  const loadStudents = useCallback(
    async ({ nextPage = 1, reset = false } = {}) => {
      try {
        if (reset) {
          setLoading(nextPage === 1 && !refreshing);
        } else {
          setLoadingMore(true);
        }

        const result = await getAllRegisteredStudents(user, {
          page: nextPage,
          limit,
          search: debouncedSearch,
          classId,
          sessionId,
        });

        const newStudents = result.students || [];
        const pagination = result.pagination || {};

        setStudents((prev) => (reset ? newStudents : [...prev, ...newStudents]));
        setPage(nextPage);
        setHasNextPage(Boolean(pagination.hasNextPage));
      } catch (error) {
        Alert.alert("Error", error.message || "Failed to load students");
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [user, limit, debouncedSearch, classId, sessionId, refreshing]
  );

  useEffect(() => {
    loadStudents({ nextPage: 1, reset: true });
  }, [debouncedSearch, classId, sessionId, loadStudents]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadStudents({ nextPage: 1, reset: true });
  };

  const handleLoadMore = () => {
    if (loading || loadingMore || !hasNextPage) return;
    loadStudents({ nextPage: page + 1, reset: false });
  };

  const clearSearchChip = () => setSearchText("");
  const clearClassChip = () => setClassId("");
  const clearSessionChip = () => setSessionId("");

  // ── Load branches once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setLoadingBranches(true);
    fetchBranches(user)
      .then(data => setBranches(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  }, [user]);

  // ── Load sections when bulk class changes ─────────────────────────────────────
  useEffect(() => {
    if (!user || !bulkClassId) { setBulkSections([]); return; }
    let alive = true;
    setBulkLoadingSections(true);
    setBulkSectionId("");
    fetchSections(user, bulkClassId)
      .then(raw => {
        if (!alive) return;
        setBulkSections(
          Array.isArray(raw)
            ? raw.map((it, i) => ({
                id:   String(it.section_id ?? it.id ?? i),
                name: it.section_name ?? it.name ?? `Section ${i + 1}`,
              }))
            : []
        );
      })
      .catch(() => { if (alive) setBulkSections([]); })
      .finally(() => { if (alive) setBulkLoadingSections(false); });
    return () => { alive = false; };
  }, [user, bulkClassId]);

  // ── Toggle card selection ─────────────────────────────────────────────────────
  const toggleSelect = useCallback((regNo) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(regNo) ? next.delete(regNo) : next.add(regNo);
      return next;
    });
  }, []);

  // ── Bulk enroll handler ───────────────────────────────────────────────────────
  const handleBulkEnroll = async () => {
    if (!bulkBranchId)       return Alert.alert("Validation", "Please select a branch");
    if (!bulkClassId)        return Alert.alert("Validation", "Please select a class");
    if (!bulkSectionId)      return Alert.alert("Validation", "Please select a section");
    if (!bulkSessionId)      return Alert.alert("Validation", "Please select a session");
    if (!bulkMedium)         return Alert.alert("Validation", "Please select course medium");

    const ids = [...selectedIds];
    setBulkProgress({ done: 0, total: ids.length });
    setBulkEnrolling(true);

    let succeeded = 0, failed = 0;
    for (const regNo of ids) {
      try {
        await enrollStudent(user, {
          registration_no: regNo,
          enrollment_id:   "To be generated",
          roll_number:     "To be generated",
          branch_id:       bulkBranchId,
          class_id:        bulkClassId,
          section_id:      bulkSectionId,
          session_id:      bulkSessionId,
          course_medium:   bulkMedium,
        }, regNo);
        succeeded++;
      } catch {
        failed++;
      }
      setBulkProgress(p => ({ ...p, done: p.done + 1 }));
    }

    setBulkEnrolling(false);
    setBulkModal(false);
    setSelectedIds(new Set());
    setBulkBranchId(""); setBulkClassId(""); setBulkSectionId("");
    setBulkSessionId(""); setBulkMedium("");

    Alert.alert(
      "Bulk Enrollment",
      `${succeeded} student${succeeded !== 1 ? "s" : ""} enrolled successfully` +
      (failed > 0 ? `, ${failed} failed.` : ".")
    );
  };

  const renderChip = (label, onRemove) => (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
      <Pressable onPress={onRemove}>
        <Text style={styles.chipClose}>✕</Text>
      </Pressable>
    </View>
  );

  const renderStudentCard = ({ item }) => {
    const isSelected = selectedIds.has(item.registrationNo);
    return (
    <View style={[styles.card, isSelected && styles.cardSelected]}>
      <View style={{ position: "relative" }}>
        <Image
          source={{ uri: `${HOST_NAME}/clients/${user?.ssmsClientCode}/Students/${item.registrationNo}/${item.photo}`|| "https://via.placeholder.com/200x200.png?text=ST" }}
          style={styles.avatar}
        />
        {/* Checkbox overlay */}
        <TouchableOpacity
          style={styles.checkbox}
          onPress={() => toggleSelect(item.registrationNo)}
          hitSlop={{ top: 8, left: 8, bottom: 8, right: 8 }}
        >
          {isSelected
            ? <View style={styles.checkboxChecked}><Feather name="check" size={11} color="#fff" /></View>
            : <View style={styles.checkboxUnchecked} />
          }
        </TouchableOpacity>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.name} numberOfLines={2}>
          {item.firstName} {item.lastName}
        </Text>

        <Text style={styles.meta} numberOfLines={1}>
          Reg No: {item.registrationNo}
        </Text>

        <Text style={styles.meta} numberOfLines={1}>
          {item.className || `Class ${item.classId || ""}`}
          {" • "}
          Section {item.section || "-"}
        </Text>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionButton, styles.detailsButton]}
            onPress={() => navigation.navigate("StudentProfile", { regId: item.registrationNo })}
          >
            <Feather name="eye" size={14} color="#2563eb" />
            <Text style={[styles.actionButtonText, styles.detailsButtonText]}>
              View Details
            </Text>
          </Pressable>

          <Pressable
            style={[styles.actionButton, styles.enrollButton]}
            onPress={() => navigation.navigate("Enrollment", {
              regId: item.id,
              registrationNo: item.registrationNo,
            })}
          >
            <Feather name="user-check" size={14} color="#16a34a" />
            <Text style={[styles.actionButtonText, styles.enrollButtonText]}>
              Enroll
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
  };

  const renderFooter = () => {
    if (!loadingMore) return <View style={{ height: 16 }} />;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#2563eb" />
        <Text style={styles.footerText}>Loading more...</Text>
      </View>
    );
  };

  if (loading && page === 1) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loaderText}>Loading students...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        placeholder="Search by name, reg no, class"
        placeholderTextColor="#94a3b8"
        value={searchText}
        onChangeText={setSearchText}
        style={styles.searchInput}
      />

      <View style={styles.filterRow}>
        <View style={styles.filterBox}>
          <Dropdown
            label="All Classes"
            value={classId}
            options={classOptions}
            onChange={setClassId}
            disabled={!!loadingFilters}
          />
        </View>

        <View style={styles.filterBox}>
          <Dropdown
            label="All Sessions"
            value={sessionId}
            options={sessionOptions}
            onChange={setSessionId}
            disabled={!!loadingFilters}
            loading={loadingFilters}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {debouncedSearch
          ? renderChip(`Search: ${debouncedSearch}`, clearSearchChip)
          : null}
        {classId
          ? renderChip(
              `Class: ${classOptions.find((c) => c.value === classId)?.label}`,
              clearClassChip
            )
          : null}
        {sessionId ? renderChip(`Session: ${sessionId}`, clearSessionChip) : null}
      </ScrollView>

      <FlatList
        data={students}
        keyExtractor={(item, index) =>
          String(item.registrationNo ?? item.id ?? `student-${index}`)
        }
        renderItem={renderStudentCard}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, selectedIds.size >= 1 && { paddingBottom: 90 }]}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No students found</Text>
        }
      />

      {/* ── Floating bulk enroll button ─────────────────────────────────────── */}
      {selectedIds.size >= 1 && (
        <TouchableOpacity
          style={styles.floatBtn}
          onPress={() => setBulkModal(true)}
          activeOpacity={0.85}
        >
          <Feather name="user-check" size={17} color="#fff" />
          <Text style={styles.floatBtnText}>
            Enroll {selectedIds.size} Student{selectedIds.size !== 1 ? "s" : ""}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Bulk enrollment modal ───────────────────────────────────────────── */}
      <Modal
        visible={bulkModal}
        transparent
        animationType="slide"
        onRequestClose={() => !bulkEnrolling && setBulkModal(false)}
      >
        <View style={bm.overlay}>
          <View style={bm.sheet}>
            {/* Header */}
            <View style={bm.header}>
              <View style={{ flex: 1 }}>
                <Text style={bm.title}>Bulk Enrollment</Text>
                <Text style={bm.sub}>{selectedIds.size} student{selectedIds.size !== 1 ? "s" : ""} selected</Text>
              </View>
              {!bulkEnrolling && (
                <TouchableOpacity onPress={() => setBulkModal(false)} style={bm.closeBtn}>
                  <Feather name="x" size={22} color="#64748b" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Branch */}
              <Text style={bm.label}>Branch</Text>
              <Dropdown
                label="Select Branch"
                value={bulkBranchId}
                options={[
                  { label: "Select Branch", value: "" },
                  ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
                ]}
                onChange={setBulkBranchId}
                disabled={bulkEnrolling || loadingBranches}
                loading={loadingBranches}
              />

              {/* Session */}
              <Text style={bm.label}>Session</Text>
              <Dropdown
                label="Select Session"
                value={bulkSessionId}
                options={[
                  { label: "Select Session", value: "" },
                  ...sessions.map(s => ({ label: s.session_name || s.session_year, value: String(s.session_id) })),
                ]}
                onChange={setBulkSessionId}
                disabled={bulkEnrolling}
              />

              {/* Class */}
              <Text style={bm.label}>Class</Text>
              <Dropdown
                label="Select Class"
                value={bulkClassId}
                options={[
                  { label: "Select Class", value: "" },
                  ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
                ]}
                onChange={(v) => { setBulkClassId(v); setBulkSectionId(""); }}
                disabled={bulkEnrolling}
              />

              {/* Section */}
              <Text style={bm.label}>Section</Text>
              <Dropdown
                label={!bulkClassId ? "Select Class First" : bulkLoadingSections ? "Loading…" : "Select Section"}
                value={bulkSectionId}
                options={[
                  { label: "Select Section", value: "" },
                  ...bulkSections.map(s => ({ label: s.name, value: s.id })),
                ]}
                onChange={setBulkSectionId}
                disabled={!bulkClassId || bulkLoadingSections || bulkEnrolling}
              />

              {/* Course Medium */}
              <Text style={bm.label}>Course Medium</Text>
              <Dropdown
                label="Select Medium"
                value={bulkMedium}
                options={MEDIUM_OPTIONS}
                onChange={setBulkMedium}
                disabled={bulkEnrolling}
              />

              {/* Progress bar */}
              {bulkEnrolling && (
                <View style={bm.progressWrap}>
                  <ActivityIndicator size="small" color="#2563eb" />
                  <Text style={bm.progressTxt}>
                    Enrolling {bulkProgress.done} / {bulkProgress.total}…
                  </Text>
                </View>
              )}

              {/* Submit */}
              <TouchableOpacity
                style={[bm.submitBtn, bulkEnrolling && { opacity: 0.6 }]}
                onPress={handleBulkEnroll}
                disabled={bulkEnrolling}
              >
                {bulkEnrolling
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Feather name="user-check" size={16} color="#fff" />
                      <Text style={bm.submitTxt}>
                        Enroll {selectedIds.size} Student{selectedIds.size !== 1 ? "s" : ""}
                      </Text>
                    </>
                  )
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    padding: 16,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },
  searchInput: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  filterBox: {
    flex: 1,
  },
  chipRow: {
    paddingBottom: 10,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  },
  chipText: {
    color: "#1d4ed8",
    fontWeight: "600",
    marginRight: 8,
  },
  chipClose: {
    color: "#1d4ed8",
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 20,
  },
  columnWrapper: {
    justifyContent: "space-between",
  },
  emptyText: {
    textAlign: "center",
    color: "#64748b",
    marginTop: 40,
  },
  card: {
    width: "48%",
    backgroundColor: "white",
    borderRadius: 18,
    padding: 12,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  avatar: {
    width: "100%",
    height: 120,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: "#e2e8f0",
  },
  cardBody: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 6,
    minHeight: 40,
  },
  meta: {
    color: "#64748b",
    marginBottom: 4,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    marginHorizontal: 2,
  },
  detailsButton: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  enrollButton: {
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  actionButtonText: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "700",
  },
  detailsButtonText: {
    color: "#2563eb",
  },
  enrollButtonText: {
    color: "#16a34a",
  },
  footerLoader: {
    alignItems: "center",
    paddingVertical: 14,
    width: "100%",
  },
  footerText: {
    marginTop: 6,
    color: "#64748b",
  },
  // ── Selection styles ────────────────────────────────────────────────────────
  cardSelected: {
    borderWidth: 2,
    borderColor: "#2563eb",
    shadowColor: "#2563eb",
    shadowOpacity: 0.2,
  },
  checkbox: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 10,
  },
  checkboxChecked: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  checkboxUnchecked: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 2,
    borderColor: "#cbd5e1",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  // ── Floating button ─────────────────────────────────────────────────────────
  floatBtn: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: "#2563eb",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    gap: 10,
    shadowColor: "#2563eb",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },
  floatBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
});

// ── Bulk modal styles ─────────────────────────────────────────────────────────
const bm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 24,
    maxHeight: "88%",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
  },
  sub: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
    marginTop: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    marginBottom: 6,
    marginTop: 4,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 12,
  },
  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#eff6ff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  progressTxt: {
    color: "#2563eb",
    fontWeight: "600",
    fontSize: 14,
  },
  submitBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    gap: 8,
    marginTop: 10,
    marginBottom: 10,
  },
  submitTxt: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
});