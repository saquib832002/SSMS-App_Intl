/**
 * screens/Transport/TransportFeeStructureScreen.js
 *
 * Transport fee structure — same logic as ClassFeeStructureScreen
 * but filtered to fee items with category = "Transport".
 *
 * Fee items in "Transport" category (set up via Fee Items screen):
 *   e.g. Bus Fee (Monthly), Van Fee (Monthly), Transport Registration (One Time)
 *
 * Differences from ClassFeeStructureScreen:
 *   - Uses fetchTransportFeeStructure / saveTransportFeeStructure (category=Transport)
 *   - fetchFeeItems(..., "Transport") — only Transport fee items shown
 *   - Teal colour scheme to visually differentiate from Academic fees
 */
import React, {
  useCallback, useContext, useEffect, useMemo, useState, memo,
} from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Modal, FlatList,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchBranches, fetchClasses, fetchSessions } from "../../services/StudentServiceApi";
import {
  fetchFeeItems,
  fetchTransportFeeStructure,
  saveTransportFeeStructure,
} from "../../services/FeeServiceApi";

const TEAL = "#0f766e";

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.75}>
        <Text style={[dd.txt, !sel?.value && dd.ph]} numberOfLines={1}>
          {sel?.label ?? label}
        </Text>
        <Feather name="chevron-down" size={15} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={o => String(o.value)}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[dd.opt, String(o.value) === String(value) && dd.optActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}>
                  <Text style={[dd.optTxt, String(o.value) === String(value) && dd.optTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={13} color={TEAL} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const dd = StyleSheet.create({
  trigger:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10 },
  disabled:   { opacity: 0.45 },
  txt:        { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  ph:         { color: "#94a3b8" },
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:      { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  opt:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optActive:  { backgroundColor: "#f0fdfa" },
  optTxt:     { fontSize: 14, color: "#0f172a" },
  optTxtActive:{ color: TEAL, fontWeight: "700" },
});

const MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

// ── One-time fee row ──────────────────────────────────────────────────────────
const FeeAmountRow = memo(function FeeAmountRow({ item, onCommit, disabled }) {
  const [val, setVal] = useState(item.amount || "");
  useEffect(() => { setVal(item.amount || ""); }, [item.amount]);
  return (
    <View style={s.amountRow}>
      <Text style={s.amountLabel}>{item.feeName}</Text>
      <TextInput
        style={s.amountInput}
        placeholder="0"
        keyboardType="numeric"
        value={val}
        onChangeText={setVal}
        onBlur={() => onCommit(item.id, val)}
        editable={!disabled}
        placeholderTextColor="#94a3b8"
      />
    </View>
  );
});

// ── Monthly amount cell ───────────────────────────────────────────────────────
const MonthCell = memo(function MonthCell({ feeId, month, details, onCommit, disabled }) {
  const [val, setVal] = useState(details?.amount || "");
  useEffect(() => { setVal(details?.amount || ""); }, [details?.amount]);
  return (
    <View style={s.monthCell}>
      <Text style={s.monthLabel}>{month}</Text>
      <TextInput
        style={s.monthInput}
        placeholder="0"
        keyboardType="numeric"
        value={val}
        onChangeText={setVal}
        onBlur={() => onCommit(feeId, month, val)}
        editable={!disabled}
        placeholderTextColor="#94a3b8"
      />
    </View>
  );
});

// ── Monthly fee card ──────────────────────────────────────────────────────────
const MonthlyFeeCard = memo(function MonthlyFeeCard({ fee, onCommit, disabled }) {
  const [applyAll, setApplyAll]     = useState(false);
  const [allVal,   setAllVal]       = useState("");

  const handleApplyAll = (checked) => {
    setApplyAll(checked);
    if (checked && allVal.trim())
      MONTHS.forEach(m => onCommit(fee.id, m, allVal.trim()));
  };
  const handleAllValChange = (v) => {
    setAllVal(v);
    if (applyAll && v.trim())
      MONTHS.forEach(m => onCommit(fee.id, m, v.trim()));
  };

  return (
    <View style={s.monthlyCard}>
      <Text style={s.monthlyTitle}>{fee.feeName}</Text>
      <View style={s.applyAllRow}>
        <TouchableOpacity style={s.checkWrap} onPress={() => handleApplyAll(!applyAll)} activeOpacity={0.7} disabled={disabled}>
          <View style={[s.checkbox, applyAll && s.checkboxOn]}>
            {applyAll && <Feather name="check" size={12} color="#fff" />}
          </View>
          <Text style={s.checkLabel}>Apply same amount to all months</Text>
        </TouchableOpacity>
        {applyAll && (
          <TextInput
            style={s.applyAllInput}
            placeholder="Amount"
            placeholderTextColor="#94a3b8"
            keyboardType="numeric"
            value={allVal}
            onChangeText={handleAllValChange}
            editable={!disabled}
          />
        )}
      </View>
      <View style={s.monthGrid}>
        {MONTHS.map(m => (
          <MonthCell
            key={`${fee.id}-${m}`}
            feeId={fee.id}
            month={m}
            details={fee.months[m]}
            onCommit={onCommit}
            disabled={disabled || applyAll}
          />
        ))}
      </View>
    </View>
  );
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TransportFeeStructureScreen() {
  const { user } = useContext(AuthContext);

  const [filters, setFilters] = useState({ sessionId: "", branchId: "", classId: "" });
  const [branches, setBranches]   = useState([]);
  const [classes,  setClasses]    = useState([]);
  const [sessions, setSessions]   = useState([]);
  const [feeItems, setFeeItems]   = useState([]);

  const [oneTimeMandatory, setOneTimeMandatory] = useState([]);
  const [oneTimeOptional,  setOneTimeOptional]  = useState([]);
  const [monthlyMandatory, setMonthlyMandatory] = useState([]);
  const [monthlyOptional,  setMonthlyOptional]  = useState([]);

  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [structureLoaded,  setStructureLoaded]  = useState(false);

  // ── Merge saved rows into fee-item template ───────────────────────────────
  const mergeIntoTemplate = useCallback((items, savedRows) => {
    const otm = [], oto = [], mm = [], mo = [];
    items.forEach((item, idx) => {
      const id        = String(item.fee_item_id ?? item.id ?? `fi-${idx}`);
      const feeName   = item.fee_item_name ?? item.feeName ?? "";
      const feeType   = item.fee_type ?? item.feeType ?? "";
      const mandatory = String(item.is_mandatory ?? item.isMandatory ?? "Yes").toLowerCase() === "yes";
      const matching  = savedRows.filter(r =>
        String(r.fee_item_id ?? "") === id || r.fee_item_name === feeName
      );

      if (feeType === "Monthly") {
        const months = {};
        MONTHS.forEach(m => {
          const found = matching.find(r => r.month_no === m);
          months[m] = { amount: found ? String(found.fee_amount ?? "") : "", feeId: found ? String(found.fee_id ?? "") : null };
        });
        (mandatory ? mm : mo).push({ id, feeName, months });
      } else {
        const found = matching[0];
        (mandatory ? otm : oto).push({
          id, feeName,
          amount: found ? String(found.fee_amount ?? "") : "",
          feeId:  found ? String(found.fee_id ?? "") : null,
        });
      }
    });
    return { otm, oto, mm, mo };
  }, []);

  const initEmpty = useCallback((items) => {
    const { otm, oto, mm, mo } = mergeIntoTemplate(items, []);
    setOneTimeMandatory(otm); setOneTimeOptional(oto);
    setMonthlyMandatory(mm);  setMonthlyOptional(mo);
  }, [mergeIntoTemplate]);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoadingDropdowns(true);
        const [br, cl, se, fi] = await Promise.all([
          fetchBranches(user),
          fetchClasses(user),
          fetchSessions(user),
          fetchFeeItems(user, "Transport"),   // ← Transport category only
        ]);
        const items = Array.isArray(fi) ? fi : [];
        setBranches(Array.isArray(br) ? br : []);
        setClasses(Array.isArray(cl)  ? cl : []);
        setSessions(Array.isArray(se) ? se : []);
        setFeeItems(items);
        initEmpty(items);
      } catch (e) {
        Alert.alert("Error", e.message ?? "Failed to load setup");
      } finally {
        setLoadingDropdowns(false);
      }
    })();
  }, [user, initEmpty]);

  const handleFilterChange = useCallback((field, val) => {
    setFilters(p => ({ ...p, [field]: String(val) }));
    setStructureLoaded(false);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadStructure = useCallback(async () => {
    if (!filters.sessionId || !filters.branchId || !filters.classId) {
      Alert.alert("Validation", "Please select session, branch and class"); return;
    }
    try {
      setLoadingStructure(true);
      const rows = await fetchTransportFeeStructure(user, filters);
      const { otm, oto, mm, mo } = mergeIntoTemplate(feeItems, Array.isArray(rows) ? rows : []);
      setOneTimeMandatory(otm); setOneTimeOptional(oto);
      setMonthlyMandatory(mm);  setMonthlyOptional(mo);
      setStructureLoaded(true);
    } catch (e) {
      Alert.alert("Error", e.message ?? "Failed to load fee structure");
    } finally {
      setLoadingStructure(false);
    }
  }, [filters, user, feeItems, mergeIntoTemplate]);

  // ── Change handlers ────────────────────────────────────────────────────────
  const commitOTM = useCallback((id, val) =>
    setOneTimeMandatory(p => p.map(i => i.id === id ? { ...i, amount: val } : i)), []);
  const commitOTO = useCallback((id, val) =>
    setOneTimeOptional(p => p.map(i => i.id === id ? { ...i, amount: val } : i)), []);
  const commitMM  = useCallback((feeId, month, val) =>
    setMonthlyMandatory(p => p.map(i => i.id === feeId
      ? { ...i, months: { ...i.months, [month]: { ...i.months[month], amount: val } } } : i)), []);
  const commitMO  = useCallback((feeId, month, val) =>
    setMonthlyOptional(p => p.map(i => i.id === feeId
      ? { ...i, months: { ...i.months, [month]: { ...i.months[month], amount: val } } } : i)), []);

  // ── Build payload ──────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => ({
    filters,
    oneTimeMandatoryFees: oneTimeMandatory.map(i => ({
      feeId: i.feeId || null, feeItemId: i.id, feeName: i.feeName,
      feeType: "One Time", isMandatory: "Yes", amount: i.amount,
    })),
    oneTimeOptionalFees: oneTimeOptional.map(i => ({
      feeId: i.feeId || null, feeItemId: i.id, feeName: i.feeName,
      feeType: "One Time", isMandatory: "No", amount: i.amount,
    })),
    monthlyMandatoryFees: monthlyMandatory.map(i => ({
      feeItemId: i.id, feeName: i.feeName, feeType: "Monthly", isMandatory: "Yes",
      months: Object.fromEntries(Object.entries(i.months).map(([m, d]) => [m, { feeId: d.feeId || null, amount: d.amount }])),
    })),
    monthlyOptionalFees: monthlyOptional.map(i => ({
      feeItemId: i.id, feeName: i.feeName, feeType: "Monthly", isMandatory: "No",
      months: Object.fromEntries(Object.entries(i.months).map(([m, d]) => [m, { feeId: d.feeId || null, amount: d.amount }])),
    })),
  }), [filters, oneTimeMandatory, oneTimeOptional, monthlyMandatory, monthlyOptional]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!filters.sessionId) { Alert.alert("Validation", "Please select session");  return; }
    if (!filters.branchId)  { Alert.alert("Validation", "Please select branch");   return; }
    if (!filters.classId)   { Alert.alert("Validation", "Please select class");    return; }
    try {
      setSaving(true);
      await saveTransportFeeStructure(user, buildPayload());
      Alert.alert("✓ Saved", "Transport fee structure saved successfully.");
    } catch (e) {
      Alert.alert("Error", e.message ?? "Failed to save fee structure");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadingDropdowns) {
    return (
      <View style={s.loaderWrap}>
        <ActivityIndicator size="large" color={TEAL} />
        <Text style={s.loaderTxt}>Loading transport fee setup…</Text>
      </View>
    );
  }

  const noTransportFees = feeItems.length === 0;

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">

        <Text style={s.screenTitle}>Transport Fee Structure</Text>
        <Text style={s.screenSubtitle}>
          Set monthly or one-time transport fees by class, session and branch.
        </Text>

        {noTransportFees && (
          <View style={s.warnCard}>
            <Feather name="alert-circle" size={16} color="#92400e" />
            <Text style={s.warnTxt}>
              No Transport fee items found. Go to{" "}
              <Text style={{ fontWeight: "800" }}>Setup → Fee Items</Text> and create
              fee items with category set to <Text style={{ fontWeight: "800" }}>Transport</Text>.
            </Text>
          </View>
        )}

        {/* Filters */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>SELECT CONTEXT</Text>

          <Dropdown
            label="Select Session"
            value={filters.sessionId}
            options={[
              { label: "Select Session", value: "" },
              ...sessions.map(o => ({ label: o.session_name ?? o.session_year, value: String(o.session_id) })),
            ]}
            onChange={v => handleFilterChange("sessionId", v)}
            disabled={loadingStructure}
          />
          <Dropdown
            label="Select Branch"
            value={filters.branchId}
            options={[
              { label: "Select Branch", value: "" },
              ...branches.map(o => ({ label: o.branch_name, value: String(o.branch_id) })),
            ]}
            onChange={v => handleFilterChange("branchId", v)}
            disabled={loadingStructure}
          />
          <Dropdown
            label="Select Class"
            value={filters.classId}
            options={[
              { label: "Select Class", value: "" },
              ...classes.map(o => ({ label: o.class_name, value: String(o.class_id) })),
            ]}
            onChange={v => handleFilterChange("classId", v)}
            disabled={loadingStructure}
          />

          <TouchableOpacity
            style={[s.loadBtn, (loadingStructure || noTransportFees) && s.btnDisabled]}
            onPress={loadStructure}
            disabled={loadingStructure || noTransportFees}>
            {loadingStructure
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="truck" size={15} color="#fff" />
                 <Text style={s.loadBtnTxt}>Load Transport Fees</Text></>}
          </TouchableOpacity>
        </View>

        {structureLoaded && (
          <>
            {/* One Time Mandatory */}
            {oneTimeMandatory.length > 0 && (
              <View style={s.card}>
                <Text style={s.sectionTitle}>ONE-TIME MANDATORY</Text>
                {oneTimeMandatory.map(item => (
                  <FeeAmountRow key={item.id} item={item} onCommit={commitOTM} disabled={loadingStructure} />
                ))}
              </View>
            )}

            {/* One Time Optional */}
            {oneTimeOptional.length > 0 && (
              <View style={s.card}>
                <Text style={s.sectionTitle}>ONE-TIME OPTIONAL</Text>
                {oneTimeOptional.map(item => (
                  <FeeAmountRow key={item.id} item={item} onCommit={commitOTO} disabled={loadingStructure} />
                ))}
              </View>
            )}

            {/* Monthly Mandatory */}
            {monthlyMandatory.length > 0 && (
              <View style={s.card}>
                <Text style={s.sectionTitle}>MONTHLY MANDATORY</Text>
                {monthlyMandatory.map(fee => (
                  <MonthlyFeeCard key={fee.id} fee={fee} onCommit={commitMM} disabled={loadingStructure} />
                ))}
              </View>
            )}

            {/* Monthly Optional */}
            {monthlyOptional.length > 0 && (
              <View style={s.card}>
                <Text style={s.sectionTitle}>MONTHLY OPTIONAL</Text>
                {monthlyOptional.map(fee => (
                  <MonthlyFeeCard key={fee.id} fee={fee} onCommit={commitMO} disabled={loadingStructure} />
                ))}
              </View>
            )}

            {/* Nothing to show */}
            {oneTimeMandatory.length === 0 && oneTimeOptional.length === 0 &&
             monthlyMandatory.length === 0 && monthlyOptional.length === 0 && (
              <View style={[s.card, { alignItems: "center", padding: 32 }]}>
                <Feather name="inbox" size={36} color="#cbd5e1" />
                <Text style={{ color: "#94a3b8", marginTop: 8, fontSize: 14 }}>
                  No transport fee items to display
                </Text>
              </View>
            )}

            {/* Save */}
            <TouchableOpacity
              style={[s.saveBtn, saving && s.btnDisabled]}
              onPress={handleSave}
              disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check-circle" size={17} color="#fff" />
                   <Text style={s.saveBtnTxt}>Save Transport Fee Structure</Text></>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#f0fdfa" },
  loaderWrap:   { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:    { fontSize: 14, color: "#64748b" },

  screenTitle:    { fontSize: 20, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  screenSubtitle: { fontSize: 13, color: "#64748b", marginBottom: 16, lineHeight: 18 },

  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 14,
                  borderWidth: 1, borderColor: "#e2e8f0", elevation: 1 },
  sectionTitle: { fontSize: 10, fontWeight: "800", color: "#94a3b8",
                  textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },

  warnCard:     { flexDirection: "row", gap: 10, backgroundColor: "#fffbeb",
                  borderRadius: 12, padding: 14, marginBottom: 14,
                  borderWidth: 1, borderColor: "#fde68a" },
  warnTxt:      { flex: 1, fontSize: 13, color: "#92400e", lineHeight: 19 },

  // Buttons
  loadBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, backgroundColor: TEAL, borderRadius: 12, paddingVertical: 13 },
  loadBtnTxt:   { color: "#fff", fontSize: 14, fontWeight: "700" },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, backgroundColor: TEAL, borderRadius: 14, paddingVertical: 15,
                  marginBottom: 16 },
  saveBtnTxt:   { color: "#fff", fontSize: 15, fontWeight: "800" },
  btnDisabled:  { opacity: 0.6 },

  // One-time fee row
  amountRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  amountLabel:  { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  amountInput:  { width: 90, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0",
                  borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
                  fontSize: 14, color: "#0f172a", textAlign: "right" },

  // Monthly card
  monthlyCard:  { backgroundColor: "#f8fafc", borderRadius: 12, padding: 12, marginBottom: 10,
                  borderWidth: 1, borderColor: "#e2e8f0" },
  monthlyTitle: { fontSize: 14, fontWeight: "700", color: TEAL, marginBottom: 10 },
  applyAllRow:  { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 12 },
  checkWrap:    { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  checkbox:     { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#94a3b8",
                  alignItems: "center", justifyContent: "center" },
  checkboxOn:   { backgroundColor: TEAL, borderColor: TEAL },
  checkLabel:   { fontSize: 12, color: "#475569" },
  applyAllInput:{ width: 80, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0",
                  borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6,
                  fontSize: 13, textAlign: "right", color: "#0f172a" },
  monthGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell:    { width: "22%", alignItems: "center" },
  monthLabel:   { fontSize: 11, color: "#64748b", fontWeight: "600", marginBottom: 4 },
  monthInput:   { width: "100%", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0",
                  borderRadius: 8, paddingHorizontal: 6, paddingVertical: 7,
                  fontSize: 13, textAlign: "center", color: "#0f172a" },
});