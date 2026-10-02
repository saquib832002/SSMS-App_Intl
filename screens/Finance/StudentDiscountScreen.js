/**
 * screens/Finance/StudentDiscountScreen.js
 * Assign per-fee-item discounts to an enrolled student.
 * Admin / Owner only.
 *
 * Layout:
 *  1. Filter row  — Session, Branch, Class, Section
 *  2. Student dropdown — "Name — Enrollment ID"
 *  3. Fee items list — each with % input + reason + live net calc
 *  4. Totals summary + Save button
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, Modal, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchStudentDiscounts, saveStudentDiscounts,
  fetchEnrolledForDiscount, fetchFeeItems,
} from "../../services/FeeServiceApi";
import { fetchSessions, fetchBranches, fetchClasses, fetchSections } from "../../services/SetupServiceApi";

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function DD({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[sc.dd, (disabled || loading) && { opacity: 0.45 }]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[sc.ddTxt, !sel?.value && sc.ddPh]} numberOfLines={1}>
          {loading ? "Loading…" : (sel?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={sc.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={sc.sheet}>
            <View style={sc.sheetHead}>
              <Text style={sc.sheetTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={sc.sheetClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[sc.opt, String(o.value) === String(value) && sc.optAct]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[sc.optTxt, String(o.value) === String(value) && sc.optTxtAct]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) &&
                    <Feather name="check" size={13} color="#1e40af" />}
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

// ── Fee Item Discount Row ─────────────────────────────────────────────────────
function DiscountRow({ item, index, onChange }) {
  const pct     = parseFloat(item.discount_percent) || 0;
  const hasDis  = pct > 0;

  return (
    <View style={[sc.feeRow, hasDis && sc.feeRowActive]}>
      {/* Fee item header */}
      <View style={sc.feeRowTop}>
        <View style={sc.feeNameWrap}>
          <View style={[sc.feeDot, hasDis && sc.feeDotActive]} />
          <Text style={sc.feeName}>{item.fee_item_name}</Text>
          {item.fee_type ? <Text style={sc.feeType}>{item.fee_type}</Text> : null}
        </View>
        <View style={sc.feeAmtWrap}>
          {hasDis && (
            <Text style={sc.feeNetBadge}>{pct}% off</Text>
          )}
        </View>
      </View>

      {/* Inputs */}
      <View style={sc.feeInputRow}>
        {/* Percent input */}
        <View style={sc.pctBox}>
          <TextInput
            style={sc.pctInput}
            value={item.discount_percent === 0 ? "" : String(item.discount_percent)}
            onChangeText={v => onChange(index, "discount_percent", v.replace(/[^0-9.]/g, ""))}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#94a3b8"
            maxLength={5}
          />
          <Text style={sc.pctSign}>%</Text>
        </View>

        {/* Reason */}
        <TextInput
          style={sc.reasonInput}
          value={item.reason ?? ""}
          onChangeText={v => onChange(index, "reason", v)}
          placeholder="Reason  e.g. EWS / Scholarship / Staff ward"
          placeholderTextColor="#94a3b8"
        />
      </View>

      {/* Discount breakdown */}
      {hasDis && (
        <View style={sc.feeBreakdown}>
          <Text style={sc.breakdownTxt}>
            <Text style={sc.breakdownGreen}>{pct}% discount</Text>
            {"  "}applied to every instalment at collection time
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function StudentDiscountScreen() {
  const { user } = useContext(AuthContext);

  // Filter state
  const [sessions,    setSessions]    = useState([]);
  const [branches,    setBranches]    = useState([]);
  const [classes,     setClasses]     = useState([]);
  const [sections,    setSections]    = useState([]);
  const [selSession,  setSelSession]  = useState("");
  const [selBranch,   setSelBranch]   = useState("");
  const [selClass,    setSelClass]    = useState("");
  const [selSection,  setSelSection]  = useState("");

  // Student state
  const [students,      setStudents]      = useState([]);
  const [selEnrollId,   setSelEnrollId]   = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Discount state
  const [discounts,     setDiscounts]     = useState([]);
  const [loadingDis,    setLoadingDis]    = useState(false);
  const [saving,        setSaving]        = useState(false);

  const [loadingFilters, setLoadingFilters] = useState(true);

  // ── Load filter dropdowns ───────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [se, br, cl] = await Promise.all([
          fetchSessions(user), fetchBranches(user), fetchClasses(user),
        ]);
        setSessions(Array.isArray(se) ? se : se?.data ?? []);
        setBranches(Array.isArray(br) ? br : br?.data ?? []);
        setClasses( Array.isArray(cl) ? cl : cl?.data ?? []);
      } catch {}
      finally { setLoadingFilters(false); }
    })();
  }, [user]);

  // ── Load sections when class changes ───────────────────────────────────────
  useEffect(() => {
    if (!selClass) { setSections([]); return; }
    fetchSections(user, selClass)
      .then(d => setSections(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => {});
  }, [selClass]);

  // ── Load students ───────────────────────────────────────────────────────────
  const handleFindStudents = useCallback(async () => {
    if (!user) return;
    if (!selSession || !selClass) {
      Alert.alert("Required", "Please select Session and Class first.");
      return;
    }
    setLoadingStudents(true);
    setStudents([]); setSelEnrollId(""); setDiscounts([]);
    try {
      const list = await fetchEnrolledForDiscount(user, {
        classId:   selClass,
        sectionId: selSection,
        sessionId: selSession,
        branchId:  selBranch,
      });
      setStudents(list);
      if (!list.length)
        Alert.alert("No Students", "No enrolled students found for the selected filters.");
    } catch (e) { Alert.alert("Error", e.message); }
    finally { setLoadingStudents(false); }
  }, [user, selSession, selBranch, selClass, selSection]);

  // ── Load fee structure + existing discounts when student selected ───────────
  const handleSelectStudent = useCallback(async (enrollId) => {
    if (!user) return;
    setSelEnrollId(enrollId);
    if (!enrollId) { setDiscounts([]); return; }
    setLoadingDis(true);
    try {
      // Fetch ALL fee items (master list, no duplicates)
      // Discount is % only — applied to each monthly instalment at collection time
      const [allItems, existing] = await Promise.all([
        fetchFeeItems(user),
        fetchStudentDiscounts(user, enrollId, selSession),
      ]);
      const itemList = Array.isArray(allItems) ? allItems : [];
      if (!itemList.length) {
        Alert.alert("No Fee Items", "No fee items found. Set up Fee Items first.");
        setDiscounts([]);
        return;
      }
      // Merge with any existing discounts for this student
      const merged = itemList.map(fi => {
        const ex = existing.find(d => String(d.fee_item_id) === String(fi.fee_item_id));
        return {
          fee_item_id:      fi.fee_item_id,
          fee_item_name:    fi.fee_item_name,
          fee_type:         fi.fee_type ?? "",
          discount_percent: ex ? parseFloat(ex.discount_percent) : 0,
          reason:           ex?.reason ?? "",
        };
      });
      setDiscounts(merged);
    } catch (e) { Alert.alert("Error", e.message); }
    finally { setLoadingDis(false); }
  }, [user, selClass, selSession, selBranch]);

  // ── Update a single discount row ────────────────────────────────────────────
  const updateRow = (idx, field, value) =>
    setDiscounts(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selEnrollId) return;
    try {
      setSaving(true);
      const items = discounts.map(d => ({
        fee_item_id:      d.fee_item_id,
        discount_percent: parseFloat(d.discount_percent) || 0,
        reason:           d.reason ?? "",
      }));
      // Pass session/class/branch so discount is scoped correctly
      const student = students.find(s => String(s.enrollment_id) === String(selEnrollId));
      const res = await saveStudentDiscounts(
        user, selEnrollId, selSession,
        student?.class_id  ?? selClass,
        student?.branch_id ?? selBranch,
        items
      );
      if (res.status === false) throw new Error(res.message);
      Alert.alert("✓ Saved", "Discounts saved successfully.");
    } catch (e) { Alert.alert("Error", e.message); }
    finally { setSaving(false); }
  };

  // ── Totals ──────────────────────────────────────────────────────────────────
  const discountedItems = discounts.filter(d => parseFloat(d.discount_percent) > 0).length;
  const totalItems      = discounts.length;

  // ── Dropdown options ────────────────────────────────────────────────────────
  const sessionOpts = [{ label: "Select Session", value: "" },
    ...sessions.map(s => ({ label: s.session_name ?? s.session_year ?? String(s.session_id), value: String(s.session_id) }))];
  const branchOpts  = [{ label: "All Branches",   value: "" },
    ...branches.map(b  => ({ label: b.branch_name,  value: String(b.branch_id)  }))];
  const classOpts   = [{ label: "Select Class",   value: "" },
    ...classes.map(c   => ({ label: c.class_name,   value: String(c.class_id)   }))];
  const sectionOpts = [{ label: "All Sections",   value: "" },
    ...sections.map(s  => ({ label: s.section_name, value: String(s.section_id) }))];
  const studentOpts = [{ label: "Select Student", value: "" },
    ...students.map(s  => ({
      label: `${s.student_name}  —  ${s.enrollment_id}`,
      value: String(s.enrollment_id),
    }))];

  const selStudent = students.find(s => String(s.enrollment_id) === String(selEnrollId));

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={sc.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Page header ── */}
          <View style={sc.pageHead}>
            <View style={sc.pageHeadIcon}>
              <Feather name="percent" size={18} color="#1e40af" />
            </View>
            <View>
              <Text style={sc.pageTitle}>Fee Discounts</Text>
              <Text style={sc.pageSub}>Assign EWS / scholarship discounts per student</Text>
            </View>
          </View>

          {/* ── Filter card ── */}
          <View style={sc.card}>
            <Text style={sc.cardTitle}>FILTERS</Text>
            <View style={sc.filterGrid}>
              <View style={sc.filterCell}>
                <Text style={sc.lbl}>Session <Text style={sc.req}>*</Text></Text>
                <DD label="Select Session" value={selSession} options={sessionOpts}
                  onChange={setSelSession} loading={loadingFilters} />
              </View>
              <View style={sc.filterCell}>
                <Text style={sc.lbl}>Branch</Text>
                <DD label="All Branches" value={selBranch} options={branchOpts}
                  onChange={setSelBranch} loading={loadingFilters} />
              </View>
              <View style={sc.filterCell}>
                <Text style={sc.lbl}>Class <Text style={sc.req}>*</Text></Text>
                <DD label="Select Class" value={selClass} options={classOpts}
                  onChange={v => { setSelClass(v); setSelEnrollId(""); setDiscounts([]); }}
                  loading={loadingFilters} />
              </View>
              <View style={sc.filterCell}>
                <Text style={sc.lbl}>Section</Text>
                <DD label="All Sections" value={selSection} options={sectionOpts}
                  onChange={setSelSection} disabled={!selClass} />
              </View>
            </View>
            <TouchableOpacity
              style={[sc.findBtn, (!selSession || !selClass || loadingStudents) && { opacity: 0.5 }]}
              onPress={handleFindStudents}
              disabled={!selSession || !selClass || loadingStudents}
              activeOpacity={0.85}
            >
              {loadingStudents
                ? <><ActivityIndicator color="#fff" size="small" /><Text style={sc.findBtnTxt}>Loading…</Text></>
                : <><Feather name="users" size={14} color="#fff" /><Text style={sc.findBtnTxt}>Find Students</Text></>}
            </TouchableOpacity>
          </View>

          {/* ── Student selector ── */}
          {students.length > 0 && (
            <View style={sc.card}>
              <Text style={sc.cardTitle}>SELECT STUDENT</Text>
              <DD
                label="Select Student — Enrollment ID"
                value={selEnrollId}
                options={studentOpts}
                onChange={handleSelectStudent}
              />
              {selStudent && (
                <View style={sc.stuInfo}>
                  <View style={sc.stuAvatar}>
                    <Text style={sc.stuAvatarTxt}>
                      {(selStudent.student_name?.[0] ?? "S").toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sc.stuName}>{selStudent.student_name}</Text>
                    <Text style={sc.stuMeta}>
                      {selStudent.class_name}{selStudent.section_name ? ` · ${selStudent.section_name}` : ""}
                      {"  ·  Enroll: "}{selStudent.enrollment_id}
                      {selStudent.roll_number ? `  ·  Roll: ${selStudent.roll_number}` : ""}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ── Loading fee items ── */}
          {loadingDis && (
            <View style={sc.loadingWrap}>
              <ActivityIndicator color="#1e40af" size="small" />
              <Text style={sc.loadingTxt}>Loading fee structure…</Text>
            </View>
          )}

          {/* ── Fee items + discounts ── */}
          {!loadingDis && discounts.length > 0 && (
            <View style={sc.card}>
              <Text style={sc.cardTitle}>FEE ITEMS & DISCOUNTS</Text>
              <Text style={sc.cardSub}>Enter discount % for each fee item. Leave 0 for no discount.</Text>

              {discounts.map((d, i) => (
                <DiscountRow key={d.fee_item_id} item={d} index={i} onChange={updateRow} />
              ))}

              {/* ── Totals ── */}
              <View style={sc.totals}>
                <View style={sc.totalRow}>
                  <Text style={sc.totalLbl}>Total Fee Items</Text>
                  <Text style={sc.totalVal}>{totalItems}</Text>
                </View>
                <View style={sc.totalRow}>
                  <Text style={[sc.totalLbl, { color: "#16a34a" }]}>Items with Discount</Text>
                  <Text style={[sc.totalVal, { color: "#16a34a" }]}>{discountedItems}</Text>
                </View>
                <View style={sc.totalDivider} />
                <View style={sc.totalRow}>
                  <Text style={sc.totalNetLbl}>Discount applied at collection time</Text>
                </View>
              </View>

              {/* ── Save ── */}
              <TouchableOpacity
                style={[sc.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={sc.saveBtnTxt}>Saving…</Text></>
                  : <><Feather name="check-circle" size={16} color="#fff" /><Text style={sc.saveBtnTxt}>Save Discounts</Text></>}
              </TouchableOpacity>
            </View>
          )}

          {/* ── Empty state ── */}
          {!loadingDis && selEnrollId && discounts.length === 0 && (
            <View style={sc.emptyWrap}>
              <Feather name="alert-circle" size={32} color="#cbd5e1" />
              <Text style={sc.emptyTxt}>No fee structure found</Text>
              <Text style={sc.emptySub}>Set up Class Fees for this class and session first.</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#f8fafc" },
  scroll: { padding: 14 },

  // Page header
  pageHead:     { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  pageHeadIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  pageTitle:    { fontSize: 17, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  pageSub:      { fontSize: 11, color: "#94a3b8", marginTop: 1 },

  // Card
  card:      { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTitle: { fontSize: 10, fontWeight: "800", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  cardSub:   { fontSize: 11, color: "#64748b", marginBottom: 12, marginTop: -6 },

  // Filters
  filterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  filterCell: { width: "47%" },
  lbl:        { fontSize: 10, fontWeight: "700", color: "#475569", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 },
  req:        { color: "#ef4444" },
  findBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1e40af", borderRadius: 12, paddingVertical: 13, shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  findBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Student selector
  stuInfo:      { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, backgroundColor: "#f8fafc", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#e2e8f0" },
  stuAvatar:    { width: 42, height: 42, borderRadius: 21, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center" },
  stuAvatarTxt: { fontSize: 18, fontWeight: "800", color: "#fff" },
  stuName:      { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  stuMeta:      { fontSize: 11, color: "#64748b", marginTop: 2 },

  // Loading
  loadingWrap: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", paddingVertical: 24 },
  loadingTxt:  { fontSize: 13, color: "#64748b" },

  // Fee row
  feeRow:       { borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, marginBottom: 8, backgroundColor: "#f8fafc" },
  feeRowActive: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  feeRowTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  feeNameWrap:  { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  feeDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: "#cbd5e1" },
  feeDotActive: { backgroundColor: "#16a34a" },
  feeName:      { fontSize: 13, fontWeight: "700", color: "#0f172a", flex: 1 },
  feeType:      { fontSize: 9, color: "#94a3b8", backgroundColor: "#f1f5f9", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  feeAmtWrap:   { alignItems: "flex-end" },
  feeNetBadge:  { fontSize: 11, color: "#16a34a", fontWeight: "700", backgroundColor: "#dcfce7", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  feeInputRow:  { flexDirection: "row", gap: 10 },
  pctBox:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 9, borderWidth: 1.5, borderColor: "#c7d2fe", paddingHorizontal: 10, paddingVertical: 8, width: 80 },
  pctInput:     { flex: 1, fontSize: 15, fontWeight: "800", color: "#1e40af", padding: 0 },
  pctSign:      { fontSize: 14, color: "#6366f1", fontWeight: "700" },
  reasonInput:  { flex: 1, backgroundColor: "#fff", borderRadius: 9, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 11, paddingVertical: 8, fontSize: 12, color: "#475569" },
  feeBreakdown: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#dcfce7" },
  breakdownTxt: { fontSize: 11, color: "#64748b" },
  breakdownGreen: { color: "#16a34a", fontWeight: "700" },
  breakdownBlue:  { color: "#1e40af", fontWeight: "700" },

  // Totals
  totals:      { backgroundColor: "#f8fafc", borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: "#e2e8f0" },
  totalRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  totalLbl:    { fontSize: 13, color: "#64748b" },
  totalVal:    { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  totalDivider:{ height: 1, backgroundColor: "#e2e8f0", marginVertical: 6 },
  totalNetLbl: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  totalNetVal: { fontSize: 16, fontWeight: "800", color: "#1e40af" },

  // Save
  saveBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1e40af", borderRadius: 12, paddingVertical: 14, marginTop: 14, shadowColor: "#1e40af", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  saveBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // Empty state
  emptyWrap: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTxt:  { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySub:  { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Dropdown
  dd:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 11, paddingVertical: 11 },
  ddTxt:     { flex: 1, fontSize: 13, color: "#0f172a" },
  ddPh:      { color: "#94a3b8" },
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  sheet:     { backgroundColor: "#fff", borderRadius: 18, width: "100%", maxHeight: "70%", overflow: "hidden" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  sheetTitle:{ fontSize: 14, fontWeight: "800", color: "#0f172a" },
  sheetClose:{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  opt:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16 },
  optAct:    { backgroundColor: "#eff6ff" },
  optTxt:    { fontSize: 13, color: "#0f172a", flex: 1 },
  optTxtAct: { color: "#1e40af", fontWeight: "700" },
});