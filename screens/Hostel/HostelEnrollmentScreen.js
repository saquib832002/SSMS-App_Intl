/**
 * screens/Hostel/HostelEnrollmentScreen.js
 *
 * Hostel Enrolment for a student.
 * All dropdowns cascade: Building → Room → Seat (available only).
 * De-enrol section shown if student already has an active enrolment.
 */
import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchHostelEnrollment,
  saveHostelEnrollment,
  deEnrollHostel,
  fetchBuildings,
  fetchRooms,
  fetchAvailableSeats,
} from "../../services/HostelServiceApi";
import { fetchClasses, fetchSessions, fetchSections, fetchBranches }
  from "../../services/StudentServiceApi";

// ─── Reusable Dropdown ────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[fm.input, fm.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={selected?.value ? fm.dropTxt : fm.dropPlaceholder} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={15} color="#6366f1" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={fm.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={fm.dropSheet}>
            <Text style={fm.dropTitle}>{label}</Text>
            <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
              {options.map((o, i) => (
                <TouchableOpacity
                  key={`${o.value}-${i}`}
                  style={[fm.dropOption, String(o.value) === String(value) && fm.dropOptionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[fm.dropOptionTxt, String(o.value) === String(value) && fm.dropOptionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#6366f1" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────
function FieldRow({ label, children, required }) {
  return (
    <View style={sc.fieldRow}>
      <Text style={sc.fieldLabel}>{label}{required ? " *" : ""}</Text>
      {children}
    </View>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title, color = "#6366f1" }) {
  return (
    <View style={[sc.sectionHeader, { borderLeftColor: color }]}>
      <Feather name={icon} size={15} color={color} />
      <Text style={[sc.sectionTitle, { color }]}>{title}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HostelEnrollmentScreen({ navigation, route }) {
  const { student } = route.params;
  const { user }    = useContext(AuthContext);

  const isAdminOrOwner = ['admin','owner'].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim()
  );

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── Existing enrollment (if any) ────────────────────────────────────────
  const [existing,      setExisting]     = useState(null);
  const [loadingInit,   setLoadingInit]  = useState(true);

  // ── Form fields ──────────────────────────────────────────────────────────
  const [sessionId,     setSessionId]    = useState("");
  const [classId,       setClassId]      = useState("");
  const [sectionId,     setSectionId]    = useState("");
  const [branchId,      setBranchId]     = useState("");
  const [buildingId,    setBuildingId]   = useState("");
  const [roomId,        setRoomId]       = useState("");
  const [seatId,        setSeatId]       = useState("");
  const [deEnrollDate,  setDeEnrollDate] = useState("");

  // ── Dropdown data ────────────────────────────────────────────────────────
  const [sessions,  setSessions]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [branches,  setBranches]  = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [rooms,     setRooms]     = useState([]);
  const [seats,     setSeats]     = useState([]);

  // Loading states for cascading dropdowns
  const [loadingSessions,  setLoadingSessions]  = useState(false);
  const [loadingClasses,   setLoadingClasses]   = useState(false);
  const [loadingSections,  setLoadingSections]  = useState(false);
  const [loadingBranches,  setLoadingBranches]  = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [loadingRooms,     setLoadingRooms]     = useState(false);
  const [loadingSeats,     setLoadingSeats]     = useState(false);

  const [saving,        setSaving]       = useState(false);
  const [deEnrolling,   setDeEnrolling]  = useState(false);

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingInit(true);
        const [enrollment, sess, cls, br] = await Promise.all([
          fetchHostelEnrollment(userRef.current, student.enrollmentId),
          fetchSessions(userRef.current),
          fetchClasses(userRef.current),
          fetchBranches(userRef.current),
        ]);
        if (cancelled) return;

        setSessions(sess  || []);
        setClasses(cls    || []);
        setBranches(br    || []);

        if (enrollment) {
          setExisting(enrollment);
          // Pre-populate all fields from existing enrollment
          setSessionId( String(enrollment.sessionId  ?? ""));
          setClassId(   String(enrollment.classId    ?? ""));
          setSectionId( String(enrollment.sectionId  ?? enrollment.section ?? ""));
          setBranchId(  String(enrollment.branchId   ?? ""));
          setBuildingId(String(enrollment.buildingId ?? ""));
          setRoomId(    String(enrollment.roomId     ?? ""));
          setSeatId(    String(enrollment.seatId     ?? ""));
          setDeEnrollDate(enrollment.deEnrollDate    ?? "");
        } else {
          // Pre-fill from student enrollment data
          setSessionId(String(student.sessionId ?? ""));
          setClassId(  String(student.classId   ?? ""));
          setSectionId(String(student.sectionId ?? student.section ?? ""));
          setBranchId( String(student.branchId  ?? ""));
        }
      } catch (e) {
        if (!cancelled) Alert.alert("Error", e.message);
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();
    return () => { cancelled = true; };
  }, [student.enrollmentId]);

  // ── Cascade: classId → sections ─────────────────────────────────────────
  useEffect(() => {
    setSections([]); setSectionId("");
    if (!classId) return;
    let cancelled = false;
    setLoadingSections(true);
    fetchSections(userRef.current, classId)
      .then(d  => { if (!cancelled) setSections(d || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSections(false); });
    return () => { cancelled = true; };
  }, [classId]);

  // ── Cascade: branchId → buildings ───────────────────────────────────────
  useEffect(() => {
    setBuildings([]); setBuildingId(""); setRooms([]); setRoomId(""); setSeats([]); setSeatId("");
    if (!branchId) return;
    let cancelled = false;
    setLoadingBuildings(true);
    fetchBuildings(userRef.current)
      .then(d  => { if (!cancelled) setBuildings(d || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingBuildings(false); });
    return () => { cancelled = true; };
  }, [branchId]);

  // ── Cascade: buildingId → rooms ─────────────────────────────────────────
  useEffect(() => {
    setRooms([]); setRoomId(""); setSeats([]); setSeatId("");
    if (!buildingId) return;
    let cancelled = false;
    setLoadingRooms(true);
    fetchRooms(userRef.current, buildingId)
      .then(d  => { if (!cancelled) setRooms(d || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingRooms(false); });
    return () => { cancelled = true; };
  }, [buildingId]);

  // ── Cascade: roomId → available seats ───────────────────────────────────
  useEffect(() => {
    setSeats([]); setSeatId("");
    if (!roomId) return;
    let cancelled = false;
    setLoadingSeats(true);
    fetchAvailableSeats(userRef.current, roomId)
      .then(d  => { if (!cancelled) setSeats(d || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSeats(false); });
    return () => { cancelled = true; };
  }, [roomId]);

  // ── Options ──────────────────────────────────────────────────────────────
  const sessionOptions  = useMemo(() => [
    { label: "— Select Session —", value: "" },
    ...sessions.map(s => ({ label: s.session_name, value: String(s.session_id) })),
  ], [sessions]);

  const classOptions    = useMemo(() => [
    { label: "— Select Class —", value: "" },
    ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
  ], [classes]);

  const sectionOptions  = useMemo(() => [
    { label: classId ? "— Select Section —" : "Select class first", value: "" },
    ...sections.map(s => ({
      label: s.section_name ?? s.section ?? `Section ${s}`,
      value: String(s.section_id ?? s.section_name ?? s.section ?? s),
    })),
  ], [sections, classId]);

  const branchOptions   = useMemo(() => [
    { label: "— Select Branch —", value: "" },
    ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
  ], [branches]);

  const buildingOptions = useMemo(() => [
    { label: branchId ? "— Select Building —" : "Select branch first", value: "" },
    ...buildings.map(b => ({ label: b.building_name, value: String(b.building_id) })),
  ], [buildings, branchId]);

  const roomOptions     = useMemo(() => [
    { label: buildingId ? "— Select Room —" : "Select building first", value: "" },
    ...rooms.map(r => ({ label: r.room_name, value: String(r.room_id) })),
  ], [rooms, buildingId]);

  const seatOptions     = useMemo(() => [
    { label: roomId ? "— Select Seat —" : "Select room first", value: "" },
    ...seats.map(s => ({ label: `${s.seat_number} (${s.status})`, value: String(s.seat_id) })),
  ], [seats, roomId]);

  // ── Save enrolment ───────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!seatId)    { Alert.alert("Validation", "Please select a seat.");    return; }
    if (!sessionId) { Alert.alert("Validation", "Please select a session."); return; }
    if (!classId)   { Alert.alert("Validation", "Please select a class.");   return; }
    try {
      setSaving(true);
      await saveHostelEnrollment(userRef.current, {
        hostelEnrollmentId: existing?.hostelEnrollmentId ?? null,
        enrollmentId:       student.enrollmentId,
        registrationId:       student.registrationNo,
        sessionId,
        classId,
        sectionId,
        branchId,
        buildingId,
        roomId,
        seatId,
        ssmsClientCode: user?.ssmsClientCode,
        currentStatus:  "active",
      });
      Alert.alert("✅ Success", existing ? "Hostel enrolment updated." : "Student enrolled in hostel.",
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert("Save Failed", e.message ?? "Could not save enrolment.");
    } finally {
      setSaving(false);
    }
  };

  // ── De-enrol ─────────────────────────────────────────────────────────────
  const handleDeEnroll = () => {
    if (!deEnrollDate.trim()) {
      Alert.alert("Validation", "Please enter the de-enrolment date.");
      return;
    }
    Alert.alert(
      "Confirm De-enrolment",
      `Remove ${student.firstName} ${student.lastName} from hostel on ${deEnrollDate}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "De-enrol", style: "destructive",
          onPress: async () => {
            try {
              setDeEnrolling(true);
              await deEnrollHostel(
                userRef.current,
                existing.hostelEnrollmentId,
                deEnrollDate
              );
              Alert.alert("✅ De-enrolled", "Student has been removed from hostel.",
                [{ text: "OK", onPress: () => navigation.goBack() }]
              );
            } catch (e) {
              Alert.alert("Error", e.message);
            } finally {
              setDeEnrolling(false);
            }
          },
        },
      ]
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loadingInit) {
    return (
      <SafeAreaView style={sc.safe} edges={["top"]}>
        <View style={sc.loader}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={sc.loaderTxt}>Loading enrolment data…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={sc.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>

        {/* Header */}
        <View style={sc.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={sc.backBtn}>
            <Feather name="arrow-left" size={20} color="#6366f1" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={sc.headerTitle}>Hostel Enrolment</Text>
            <Text style={sc.headerSub}>
              {student.firstName} {student.lastName}  •  {student.enrollmentId}
            </Text>
          </View>
          {/* Status badge */}
          {existing && (
            <View style={[sc.statusBadge,
              existing.currentStatus === "active" ? sc.statusActive : sc.statusInactive]}>
              <Text style={sc.statusBadgeTxt}>
                {existing.currentStatus === "active" ? "Enrolled" : "De-enrolled"}
              </Text>
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={sc.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Student Info card ── */}
          <View style={sc.infoCard}>
            <View style={sc.infoRow}>
              <View style={sc.infoItem}>
                <Text style={sc.infoLabel}>Class</Text>
                <Text style={sc.infoValue}>{student.className ?? "—"}</Text>
              </View>
              <View style={sc.infoItem}>
                <Text style={sc.infoLabel}>Section</Text>
                <Text style={sc.infoValue}>{student.section ?? "—"}</Text>
              </View>
              <View style={sc.infoItem}>
                <Text style={sc.infoLabel}>Reg No</Text>
                <Text style={sc.infoValue}>{student.registrationNo ?? "—"}</Text>
              </View>
            </View>
            {existing && (
              <View style={[sc.infoRow, { marginTop: 8 }]}>
                <View style={sc.infoItem}>
                  <Text style={sc.infoLabel}>Building</Text>
                  <Text style={sc.infoValue}>{existing.buildingName ?? "—"}</Text>
                </View>
                <View style={sc.infoItem}>
                  <Text style={sc.infoLabel}>Room</Text>
                  <Text style={sc.infoValue}>{existing.roomName ?? "—"}</Text>
                </View>
                <View style={sc.infoItem}>
                  <Text style={sc.infoLabel}>Seat</Text>
                  <Text style={sc.infoValue}>{existing.seatNumber ?? "—"}</Text>
                </View>
              </View>
            )}
          </View>

          {/* ── Academic section ── */}
          <View style={sc.card}>
            <SectionHeader icon="book-open" title="Academic Details" color="#6366f1" />

            <FieldRow label="Session" required>
              <Dropdown label="— Select Session —" value={sessionId}
                options={sessionOptions} onChange={setSessionId} disabled={saving} />
            </FieldRow>

            <FieldRow label="Class" required>
              <Dropdown label="— Select Class —" value={classId}
                options={classOptions} onChange={(v) => { setClassId(v); setSectionId(""); }}
                disabled={saving} />
            </FieldRow>

            <FieldRow label="Section">
              <Dropdown label={classId ? "— Select Section —" : "Select class first"}
                value={sectionId} options={sectionOptions}
                onChange={setSectionId}
                disabled={!classId || loadingSections || saving}
                loading={loadingSections} />
            </FieldRow>

            <FieldRow label="Branch">
              <Dropdown label="— Select Branch —" value={branchId}
                options={branchOptions} onChange={setBranchId} disabled={saving} />
            </FieldRow>
          </View>

          {/* ── Hostel section ── */}
          <View style={sc.card}>
            <SectionHeader icon="home" title="Hostel Allocation" color="#059669" />

            <FieldRow label="Building" required>
              <Dropdown label={branchId ? "— Select Building —" : "Select branch first"}
                value={buildingId} options={buildingOptions}
                onChange={(v) => { setBuildingId(v); setRoomId(""); setSeatId(""); }}
                disabled={!branchId || loadingBuildings || saving}
                loading={loadingBuildings} />
            </FieldRow>

            <FieldRow label="Room" required>
              <Dropdown label={buildingId ? "— Select Room —" : "Select building first"}
                value={roomId} options={roomOptions}
                onChange={(v) => { setRoomId(v); setSeatId(""); }}
                disabled={!buildingId || loadingRooms || saving}
                loading={loadingRooms} />
            </FieldRow>

            <FieldRow label="Seat" required>
              <Dropdown label={roomId ? "— Select Seat —" : "Select room first"}
                value={seatId} options={seatOptions}
                onChange={setSeatId}
                disabled={!roomId || loadingSeats || saving}
                loading={loadingSeats} />
            </FieldRow>
          </View>

          {/* ── Save button ── */}
          {isAdminOrOwner && (
            <TouchableOpacity
              style={[sc.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave} disabled={saving}
            >
              {saving
                ? <><ActivityIndicator color="#fff" size="small" />
                    <Text style={sc.saveTxt}> Saving…</Text></>
                : <><Feather name="check-circle" size={18} color="#fff" />
                    <Text style={sc.saveTxt}>
                      {existing ? " Update Enrolment" : " Enrol in Hostel"}
                    </Text></>}
            </TouchableOpacity>
          )}

          {/* ── De-enrol section (only if active enrolment exists) ── */}
          {existing?.currentStatus === "active" && isAdminOrOwner && (
            <View style={sc.card}>
              <SectionHeader icon="user-x" title="De-enrolment" color="#dc2626" />
              <Text style={sc.deEnrollNote}>
                Enter the date the student vacates the hostel seat.
              </Text>
              <FieldRow label="De-enrol Date" required>
                <TextInput
                  style={fm.input}
                  value={deEnrollDate}
                  onChangeText={setDeEnrollDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94a3b8"
                  editable={!deEnrolling}
                />
              </FieldRow>
              <TouchableOpacity
                style={[sc.deEnrollBtn, deEnrolling && { opacity: 0.6 }]}
                onPress={handleDeEnroll} disabled={deEnrolling}
              >
                {deEnrolling
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={sc.saveTxt}> Processing…</Text></>
                  : <><Feather name="user-x" size={18} color="#fff" /><Text style={sc.saveTxt}> De-enrol from Hostel</Text></>}
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#f8fafc" },
  loader:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:     { color: "#6366f1", fontWeight: "600", fontSize: 14 },
  header:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e0e7ff", gap: 12 },
  backBtn:       { width: 38, height: 38, borderRadius: 12, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  headerTitle:   { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  headerSub:     { fontSize: 12, color: "#64748b", marginTop: 1 },
  statusBadge:   { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusActive:  { backgroundColor: "#dcfce7" },
  statusInactive:{ backgroundColor: "#fee2e2" },
  statusBadgeTxt:{ fontSize: 11, fontWeight: "700" },
  scroll:        { padding: 16, gap: 14 },
  infoCard:      { backgroundColor: "#f5f3ff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#e0e7ff" },
  infoRow:       { flexDirection: "row", gap: 8 },
  infoItem:      { flex: 1 },
  infoLabel:     { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoValue:     { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  card:          { backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#e0e7ff", elevation: 1, shadowColor: "#6366f1", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, gap: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, paddingLeft: 10, borderLeftWidth: 3 },
  sectionTitle:  { fontSize: 14, fontWeight: "800" },
  fieldRow:      { marginBottom: 10 },
  fieldLabel:    { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6 },
  saveBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 16, elevation: 2 },
  saveTxt:       { fontSize: 15, fontWeight: "800", color: "#fff" },
  deEnrollNote:  { fontSize: 12, color: "#64748b", marginBottom: 8 },
  deEnrollBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#dc2626", borderRadius: 14, paddingVertical: 14, marginTop: 8 },
});

const fm = StyleSheet.create({
  input:          { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e0e7ff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0f172a" },
  dropTrigger:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropTxt:        { fontSize: 14, color: "#0f172a", flex: 1 },
  dropPlaceholder:{ fontSize: 14, color: "#94a3b8", flex: 1 },
  dropOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  dropSheet:      { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  dropTitle:      { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  dropOptionActive:{ backgroundColor: "#ede9fe" },
  dropOptionTxt:  { fontSize: 14, color: "#334155" },
  dropOptionTxtActive:{ color: "#6366f1", fontWeight: "700" },
});