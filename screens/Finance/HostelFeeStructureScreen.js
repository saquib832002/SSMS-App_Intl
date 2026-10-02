import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  memo,
} from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchBranches,
  fetchClasses,
  fetchSessions,
} from "../../services/StudentServiceApi";
import {
  fetchFeeItems,
  saveClassFeeStructure,
  fetchClassFeeStructure,
} from "../../services/FeeServiceApi";


// ── Custom Dropdown — immune to Android dark mode ────────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[styles.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.dropTriggerTxt, !selected?.value && styles.dropPlaceholder]} numberOfLines={1}>
          {selected?.label ?? label}
        </Text>
        <Feather name="chevron-down" size={15} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={styles.dropSheet}>
            <Text style={styles.dropSheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[styles.dropOption, String(o.value) === String(value) && styles.dropOptionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[styles.dropOptionTxt, String(o.value) === String(value) && styles.dropOptionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#1e40af" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f8fafc" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const MONTHS = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
];

const FeeAmountRow = memo(function FeeAmountRow({
  item,
  onCommit,
  disabled,
}) {
  const [localValue, setLocalValue] = useState(item.amount || "");

  useEffect(() => {
    setLocalValue(item.amount || "");
  }, [item.amount]);

  return (
    <View style={styles.amountRow}>
      <Text style={styles.amountLabel}>{item.feeName}</Text>
      <TextInput
        style={styles.amountInput}
        placeholder="0"
        keyboardType="numeric"
        value={localValue}
        onChangeText={setLocalValue}
        onBlur={() => onCommit(item.id, localValue)}
        editable={!disabled}
      />
    </View>
  );
});

const MonthlyFeeCard = memo(function MonthlyFeeCard({
  fee,
  onCommit,
  disabled,
}) {
  const [applyAll,      setApplyAll]      = useState(false);
  const [applyAllValue, setApplyAllValue] = useState("");

  // When checkbox is ticked and amount is entered — apply to all months
  const handleApplyAll = (checked) => {
    setApplyAll(checked);
    if (checked && applyAllValue.trim()) {
      MONTHS.forEach(month => onCommit(fee.id, month, applyAllValue.trim()));
    }
  };

  const handleApplyAllValueChange = (val) => {
    setApplyAllValue(val);
    if (applyAll && val.trim()) {
      MONTHS.forEach(month => onCommit(fee.id, month, val.trim()));
    }
  };

  return (
    <View style={styles.monthlyCard}>
      <Text style={styles.monthlyFeeTitle}>{fee.feeName}</Text>

      {/* ── Apply all row ── */}
      <View style={styles.applyAllRow}>
        <TouchableOpacity
          style={styles.checkboxWrap}
          onPress={() => handleApplyAll(!applyAll)}
          activeOpacity={0.7}
          disabled={disabled}
        >
          <View style={[styles.checkbox, applyAll && styles.checkboxChecked]}>
            {applyAll && <Feather name="check" size={12} color="#fff" />}
          </View>
          <Text style={styles.checkboxLabel}>Apply same fee to all months</Text>
        </TouchableOpacity>

        {applyAll && (
          <TextInput
            style={styles.applyAllInput}
            placeholder="Amount"
            placeholderTextColor="#94a3b8"
            keyboardType="numeric"
            value={applyAllValue}
            onChangeText={handleApplyAllValueChange}
            editable={!disabled}
          />
        )}
      </View>

      {/* ── Monthly grid ── */}
      <View style={styles.monthGrid}>
        {MONTHS.map((month) => (
          <MonthAmountInput
            key={`${fee.id}-${month}`}
            feeId={fee.id}
            month={month}
            details={fee.months[month]}
            onCommit={onCommit}
            disabled={disabled || applyAll}
          />
        ))}
      </View>
    </View>
  );
});

const MonthAmountInput = memo(function MonthAmountInput({
  feeId,
  month,
  details,
  onCommit,
  disabled,
}) {
  const [localValue, setLocalValue] = useState(details?.amount || "");

  useEffect(() => {
    setLocalValue(details?.amount || "");
  }, [details?.amount]);

  return (
    <View style={styles.monthCell}>
      <Text style={styles.monthLabel}>{month}</Text>
      <TextInput
        style={styles.monthInput}
        placeholder="0"
        keyboardType="numeric"
        value={localValue}
        onChangeText={setLocalValue}
        onBlur={() => onCommit(feeId, month, localValue)}
        editable={!disabled}
      />
    </View>
  );
});

export default function HostelFeeStructureScreen() {
  const { user } = useContext(AuthContext);

  const [filters, setFilters] = useState({
    sessionId: "",
    branchId: "",
    classId: "",
  });

  const [branches, setBranches] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [feeItems, setFeeItems] = useState([]);

  const [oneTimeMandatoryFees, setOneTimeMandatoryFees] = useState([]);
  const [oneTimeOptionalFees, setOneTimeOptionalFees] = useState([]);
  const [monthlyMandatoryFees, setMonthlyMandatoryFees] = useState([]);
  const [monthlyOptionalFees, setMonthlyOptionalFees] = useState([]);

  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [structureLoaded, setStructureLoaded] = useState(false);

  const mergeSavedStructureIntoTemplate = useCallback((feeItemsData, savedRows) => {
    const oneTimeMandatory = [];
    const oneTimeOptional = [];
    const monthlyMandatory = [];
    const monthlyOptional = [];

    feeItemsData.forEach((item, index) => {
      const feeItemId = String(item.fee_item_id ?? item.id ?? `fee-${index}`);
      const feeName = item.fee_item_name || item.feeName || "";
      const feeType = item.fee_type || item.feeType || "";
      const isMandatory =
        String(item.is_mandatory || item.isMandatory || "Yes").toLowerCase() ===
        "yes";

      const matchingRows = savedRows.filter(
        (row) =>
          String(row.fee_item_id ?? "") === feeItemId ||
          row.fee_item_name === feeName
      );

      if (feeType === "Monthly") {
        const months = {};

        MONTHS.forEach((month) => {
          const found = matchingRows.find((r) => r.month_no === month);

          months[month] = {
            amount: found ? String(found.fee_amount ?? "") : "",
            feeId: found ? String(found.fee_id ?? "") : null,
          };
        });

        const monthlyObj = {
          id: feeItemId,
          feeName,
          months,
        };

        if (isMandatory) {
          monthlyMandatory.push(monthlyObj);
        } else {
          monthlyOptional.push(monthlyObj);
        }
      } else {
        const found = matchingRows[0];

        const oneTimeObj = {
          id: feeItemId,
          feeName,
          amount: found ? String(found.fee_amount ?? "") : "",
          feeId: found ? String(found.fee_id ?? "") : null,
        };

        if (isMandatory) {
          oneTimeMandatory.push(oneTimeObj);
        } else {
          oneTimeOptional.push(oneTimeObj);
        }
      }
    });

    return {
      oneTimeMandatory,
      oneTimeOptional,
      monthlyMandatory,
      monthlyOptional,
    };
  }, []);

  const initializeEmptyStructure = useCallback(
    (items) => {
      const merged = mergeSavedStructureIntoTemplate(items, []);
      setOneTimeMandatoryFees(merged.oneTimeMandatory);
      setOneTimeOptionalFees(merged.oneTimeOptional);
      setMonthlyMandatoryFees(merged.monthlyMandatory);
      setMonthlyOptionalFees(merged.monthlyOptional);
    },
    [mergeSavedStructureIntoTemplate]
  );

  useEffect(() => {
    const loadSetup = async () => {
      try {
        setLoadingDropdowns(true);

        const [branchData, classData, sessionData, feeItemData] =
          await Promise.all([
            fetchBranches(user),
            fetchClasses(user),
            fetchSessions(user),
            fetchFeeItems(user, "Hostel"),
          ]);

        const safeBranches = Array.isArray(branchData) ? branchData : [];
        const safeClasses = Array.isArray(classData) ? classData : [];
        const safeSessions = Array.isArray(sessionData) ? sessionData : [];
        const safeFeeItems = Array.isArray(feeItemData) ? feeItemData : [];

        setBranches(safeBranches);
        setClasses(safeClasses);
        setSessions(safeSessions);
        setFeeItems(safeFeeItems);

        initializeEmptyStructure(safeFeeItems);
      } catch (error) {
        Alert.alert("Error", error.message || "Failed to load fee structure setup");
      } finally {
        setLoadingDropdowns(false);
      }
    };

    if (user) {
      loadSetup();
    }
  }, [user, initializeEmptyStructure]);

  const handleFilterChange = useCallback((field, value) => {
    setFilters((prev) => ({
      ...prev,
      [field]: String(value),
    }));
    setStructureLoaded(false);
  }, []);

  const loadFeeStructure = useCallback(async () => {
    if (!filters.sessionId || !filters.branchId || !filters.classId) {
      Alert.alert("Validation", "Please select session, branch and class");
      return;
    }

    try {
      setLoadingStructure(true);

      const rows = await fetchClassFeeStructure(user, { ...filters, category: "Hostel" });
      const merged = mergeSavedStructureIntoTemplate(
        feeItems,
        Array.isArray(rows) ? rows : []
      );

      setOneTimeMandatoryFees(merged.oneTimeMandatory);
      setOneTimeOptionalFees(merged.oneTimeOptional);
      setMonthlyMandatoryFees(merged.monthlyMandatory);
      setMonthlyOptionalFees(merged.monthlyOptional);
      setStructureLoaded(true);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to load fee structure");
    } finally {
      setLoadingStructure(false);
    }
  }, [filters, user, feeItems, mergeSavedStructureIntoTemplate]);

  const handleOneTimeMandatoryChange = useCallback((id, value) => {
    setOneTimeMandatoryFees((prev) =>
      prev.map((item) => (item.id === id ? { ...item, amount: value } : item))
    );
  }, []);

  const handleOneTimeOptionalChange = useCallback((id, value) => {
    setOneTimeOptionalFees((prev) =>
      prev.map((item) => (item.id === id ? { ...item, amount: value } : item))
    );
  }, []);

  const handleMonthlyMandatoryChange = useCallback((feeId, month, value) => {
    setMonthlyMandatoryFees((prev) =>
      prev.map((item) =>
        item.id === feeId
          ? {
              ...item,
              months: {
                ...item.months,
                [month]: {
                  ...item.months[month],
                  amount: value,
                },
              },
            }
          : item
      )
    );
  }, []);

  const handleMonthlyOptionalChange = useCallback((feeId, month, value) => {
    setMonthlyOptionalFees((prev) =>
      prev.map((item) =>
        item.id === feeId
          ? {
              ...item,
              months: {
                ...item.months,
                [month]: {
                  ...item.months[month],
                  amount: value,
                },
              },
            }
          : item
      )
    );
  }, []);

  const validate = () => {
    if (!filters.sessionId) return "Please select session";
    if (!filters.branchId) return "Please select branch";
    if (!filters.classId) return "Please select class";
    return null;
  };

  const buildPayload = useCallback(() => ({
    filters: { ...filters, category: "Hostel" },
    oneTimeMandatoryFees: oneTimeMandatoryFees.map((item) => ({
      feeId: item.feeId || null,
      feeItemId: item.id,
      feeName: item.feeName,
      feeType: "One Time",
      isMandatory: "Yes",
      amount: item.amount,
    })),
    oneTimeOptionalFees: oneTimeOptionalFees.map((item) => ({
      feeId: item.feeId || null,
      feeItemId: item.id,
      feeName: item.feeName,
      feeType: "One Time",
      isMandatory: "No",
      amount: item.amount,
    })),
    monthlyMandatoryFees: monthlyMandatoryFees.map((item) => ({
      feeItemId: item.id,
      feeName: item.feeName,
      feeType: "Monthly",
      isMandatory: "Yes",
      months: Object.fromEntries(
        Object.entries(item.months).map(([month, details]) => [
          month,
          {
            feeId: details.feeId || null,
            amount: details.amount,
          },
        ])
      ),
    })),
    monthlyOptionalFees: monthlyOptionalFees.map((item) => ({
      feeItemId: item.id,
      feeName: item.feeName,
      feeType: "Monthly",
      isMandatory: "No",
      months: Object.fromEntries(
        Object.entries(item.months).map(([month, details]) => [
          month,
          {
            feeId: details.feeId || null,
            amount: details.amount,
          },
        ])
      ),
    })),
  }), [
    filters,
    oneTimeMandatoryFees,
    oneTimeOptionalFees,
    monthlyMandatoryFees,
    monthlyOptionalFees,
  ]);

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Validation", error);
      return;
    }

    try {
      setSaving(true);
      await saveClassFeeStructure(user, buildPayload());
      Alert.alert("Success", "Hostel fee structure saved successfully");
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to save fee structure");
    } finally {
      setSaving(false);
    }
  };

  const sessionOptions = useMemo(() => sessions, [sessions]);
  const branchOptions = useMemo(() => branches, [branches]);
  const classOptions = useMemo(() => classes, [classes]);

  if (loadingDropdowns) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#1e40af" />
        <Text style={styles.loaderText}>Loading hostel fee structure setup...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.screenTitle}>Hostel Fee Structure</Text>
        <Text style={styles.screenSubtitle}>
          Add, list, and update hostel fee amounts for all hostel fee items by class, session, and branch.
        </Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Select Hostel Fee Context</Text>

          <Dropdown
            label="Select Session"
            value={filters.sessionId}
            options={[
              { label: "Select Session", value: "" },
              ...sessionOptions.map(o => ({ label: o.session_name || o.session_year, value: String(o.session_id) }))
            ]}
            onChange={(v) => handleFilterChange("sessionId", v)}
            disabled={loadingStructure}
          />

          <Dropdown
            label="Select Branch"
            value={filters.branchId}
            options={[
              { label: "Select Branch", value: "" },
              ...branchOptions.map(o => ({ label: o.branch_name, value: String(o.branch_id) }))
            ]}
            onChange={(v) => handleFilterChange("branchId", v)}
            disabled={loadingStructure}
          />

          <Dropdown
            label="Select Class"
            value={filters.classId}
            options={[
              { label: "Select Class", value: "" },
              ...classOptions.map(o => ({ label: o.class_name, value: String(o.class_id) }))
            ]}
            onChange={(v) => handleFilterChange("classId", v)}
            disabled={loadingStructure}
          />

          <TouchableOpacity
            style={[styles.primaryBtn, loadingStructure && styles.buttonDisabled]}
            onPress={loadFeeStructure}
            disabled={loadingStructure}
          >
            {loadingStructure ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Load Fee Structure</Text>
            )}
          </TouchableOpacity>
        </View>

        {structureLoaded ? (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>One Time Mandatory Fees</Text>
              {oneTimeMandatoryFees.length > 0 ? (
                oneTimeMandatoryFees.map((item) => (
                  <FeeAmountRow
                    key={item.id}
                    item={item}
                    onCommit={handleOneTimeMandatoryChange}
                    disabled={loadingStructure}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>No fees in this section</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>One Time Optional Fees</Text>
              {oneTimeOptionalFees.length > 0 ? (
                oneTimeOptionalFees.map((item) => (
                  <FeeAmountRow
                    key={item.id}
                    item={item}
                    onCommit={handleOneTimeOptionalChange}
                    disabled={loadingStructure}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>No fees in this section</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Monthly Mandatory Fees</Text>
              {monthlyMandatoryFees.length > 0 ? (
                monthlyMandatoryFees.map((fee) => (
                  <MonthlyFeeCard
                    key={fee.id}
                    fee={fee}
                    onCommit={handleMonthlyMandatoryChange}
                    disabled={loadingStructure}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>No fees in this section</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Monthly Optional Fees</Text>
              {monthlyOptionalFees.length > 0 ? (
                monthlyOptionalFees.map((fee) => (
                  <MonthlyFeeCard
                    key={fee.id}
                    fee={fee}
                    onCommit={handleMonthlyOptionalChange}
                    disabled={loadingStructure}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>No fees in this section</Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving || loadingStructure}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Save Fee Structure</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              Select session, branch, and class, then tap “Load Fee Structure”.
            </Text>
          </View>
        )}
      </ScrollView>

      {loadingStructure ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={styles.loadingText}>Loading hostel fee structure...</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
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
  screenTitle: {
    fontSize: 17,
    color: "#7d5493",
    letterSpacing: -0.3,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 20,
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderLeftWidth: 3,
    borderLeftColor: "#1e40af",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1e40af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  dropTrigger:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 },
  dropTriggerTxt:   { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "500" },
  dropPlaceholder:  { color: "#94a3b8" },
  dropOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  dropSheet:        { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  dropSheetTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  dropOptionActive: { backgroundColor: "#eff6ff" },
  dropOptionTxt:    { fontSize: 14, color: "#0f172a" },
  dropOptionTxtActive: { color: "#1e40af", fontWeight: "700" },
  dropdown: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    backgroundColor: "#fff",
    marginBottom: 12,
    overflow: "hidden",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  amountLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginRight: 10,
  },
  amountInput: {
    width: 110,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
    textAlign: "center",
  },
  monthlyCard: {
    marginBottom: 18,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  applyAllRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 10,
  },
  checkboxWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#1e40af",
    borderColor: "#1e40af",
  },
  checkboxLabel: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "500",
    flex: 1,
  },
  applyAllInput: {
    width: 90,
    borderWidth: 1,
    borderColor: "#1e40af",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#fff",
    textAlign: "center",
    fontWeight: "700",
  },
  monthlyFeeTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 10,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  monthCell: {
    width: "31%",
    marginBottom: 12,
  },
  monthLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
    marginBottom: 6,
  },
  monthInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
    textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: "#1e40af",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: "#1e40af",
    fontWeight: "600",
  },
  emptyText: {
    color: "#64748b",
    fontStyle: "italic",
  },
});