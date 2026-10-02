/**
 * screens/Staff/StaffLeaveScreen.js
 *
 * Staff Leave Management — Teacher / Staff view
 *   • Balance cards at the top (CL, ML, EL…)
 *   • "Apply" tab  — date range picker + reason
 *   • "My Leaves"  — list with status badges, cancel option
 */
import React, {
  useCallback, useContext, useMemo, useState,
} from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchLeaveTypes, fetchMyLeaves, fetchLeaveBalance,
  applyLeave, cancelLeave,
} from "../../services/LeaveServiceApi";
import { fetchSchoolSettings } from "../../services/SchoolSettingsServiceApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary: "#1e40af",
  accent:  "#3b82f6",
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

// ── Status badge ──────────────────────────────────────────────────────────────
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

// ── Balance card ──────────────────────────────────────────────────────────────
const BalanceCard = ({ item }) => {
  const total      = item.total_days + (item.carried_days ?? 0);
  const pending    = item.pending_days ?? 0;
  const approved   = item.used_days ?? 0;
  const remaining  = item.remaining_days ?? 0;

  // Bar: green = remaining, amber = pending, red = approved
  const remPct  = total > 0 ? (remaining / total) * 100 : 0;
  const pendPct = total > 0 ? (pending   / total) * 100 : 0;
  const barColor = remPct > 50 ? C.green : remPct > 20 ? C.amber : C.red;

  return (
    <View style={st.balCard}>
      <Text style={st.balAbbr}>{item.abbreviation || item.leave_type_name.slice(0,2)}</Text>
      <Text style={st.balName} numberOfLines={1}>{item.leave_type_name}</Text>
      <Text style={st.balRemain}>{remaining % 1 === 0 ? remaining.toFixed(0) : remaining.toFixed(1)}</Text>
      <Text style={st.balSub}>available</Text>

      {/* Stacked progress bar: approved (red) + pending (amber) + remaining (green) */}
      <View style={st.balBarBg}>
        <View style={[st.balBarFg, { width: `${Math.min(100, remPct + pendPct)}%`, backgroundColor: C.amber }]} />
        <View style={[st.balBarFg, st.balBarAbsolute, { width: `${Math.min(100, remPct)}%`, backgroundColor: barColor }]} />
      </View>

      <Text style={st.balUsed}>
        {approved > 0 ? `${approved % 1 === 0 ? approved.toFixed(0) : approved.toFixed(1)} approved` : ""}
        {approved > 0 && pending > 0 ? "  ·  " : ""}
        {pending > 0 ? `${pending % 1 === 0 ? pending.toFixed(0) : pending.toFixed(1)} pending` : ""}
        {(approved > 0 || pending > 0) ? "  ·  " : ""}
        {`${total % 1 === 0 ? total.toFixed(0) : total.toFixed(1)} total`}
      </Text>
    </View>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const toISO = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ── Working-day calculator (mirrors backend logic) ────────────────────────────
// School format: 1=Mon, 2=Tue, …, 6=Sat, 7=Sun  (same as PHP DateTime::format('N'))
// JS Date.getDay():  0=Sun, 1=Mon, …, 6=Sat
const jsToSchoolDay = (jsDay) => jsDay === 0 ? 7 : jsDay;

const calcWorkingDays = (from, to, workNums) => {
  if (!from || !to || workNums.length === 0) return 0;
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  let count = 0;
  while (d <= end) {
    if (workNums.includes(jsToSchoolDay(d.getDay()))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
};

// Native date-picker button — opens OS calendar on Android, spinner sheet on iOS
function DatePickerField({ label, value, onChange, minDate }) {
  const [show, setShow] = useState(false);
  // parse safely — avoid timezone shift from bare "YYYY-MM-DD"
  const date = value ? new Date(value + "T00:00:00") : new Date();

  const handleChange = (_event, selected) => {
    if (Platform.OS === "android") setShow(false);
    if (selected) onChange(toISO(selected));
  };

  return (
    <View style={st.dpWrap}>
      <Text style={st.dpLabel}>{label}</Text>
      <TouchableOpacity style={st.dpButton} onPress={() => setShow(true)} activeOpacity={0.75}>
        <Feather name="calendar" size={15} color={C.primary} />
        <Text style={st.dpButtonTxt}>{fmtDate(value)}</Text>
        <Feather name="chevron-down" size={14} color={C.muted} />
      </TouchableOpacity>

      {/* Android — native dialog */}
      {Platform.OS !== "ios" && show && (
        <DateTimePicker
          value={date}
          mode="date"
          display="default"
          onChange={handleChange}
          minimumDate={minDate}
        />
      )}

      {/* iOS — bottom-sheet spinner */}
      {Platform.OS === "ios" && (
        <Modal visible={show} transparent animationType="slide" onRequestClose={() => setShow(false)}>
          <View style={st.iosOverlay}>
            <View style={st.iosSheet}>
              <View style={st.iosSheetHeader}>
                <Text style={st.iosSheetTitle}>{label}</Text>
                <TouchableOpacity onPress={() => setShow(false)}>
                  <Text style={st.iosDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={date}
                mode="date"
                display="spinner"
                onChange={handleChange}
                minimumDate={minDate}
                style={{ width: "100%" }}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function StaffLeaveScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [tab,            setTab]            = useState("apply");   // "apply" | "history"
  const [leaveTypes,     setLeaveTypes]     = useState([]);
  const [balance,        setBalance]        = useState([]);
  const [myLeaves,       setMyLeaves]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  // School working-day numbers (1=Mon … 7=Sun); default Mon–Sat
  const [workingDayNums, setWorkingDayNums] = useState([1, 2, 3, 4, 5, 6]);

  // Apply form state
  const [selTypeId,   setSelTypeId]   = useState(null);
  const [fromDate,    setFromDate]    = useState(toISO(new Date()));
  const [toDate,      setToDate]      = useState(toISO(new Date()));
  const [reason,      setReason]      = useState("");
  const [isHalf,      setIsHalf]      = useState(false);
  const [halfSlot,    setHalfSlot]    = useState("morning");
  const [typePickerV, setTypePickerV] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      // Fetch leave types first — this must always succeed
      const types = await fetchLeaveTypes(user);
      setLeaveTypes(types);
      if (types.length > 0) setSelTypeId(t => t ?? types[0].id);

      // Fetch in parallel; balance/leaves return empty for admin without a staff row
      const [balResult, leavesResult, settingsResult] = await Promise.allSettled([
        fetchLeaveBalance(user),
        fetchMyLeaves(user),
        fetchSchoolSettings(user),
      ]);
      setBalance(balResult.status    === "fulfilled" ? balResult.value    : []);
      setMyLeaves(leavesResult.status === "fulfilled" ? leavesResult.value : []);
      if (settingsResult.status === "fulfilled" && settingsResult.value?.working_days) {
        const nums = settingsResult.value.working_days
          .split(",").map(Number).filter(n => n >= 1 && n <= 7);
        if (nums.length > 0) setWorkingDayNums(nums);
      }
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Live working-day count ───────────────────────────────────────────────
  const leaveDayCount = useMemo(() => {
    if (isHalf) return 0.5;
    return calcWorkingDays(fromDate, toDate, workingDayNums);
  }, [fromDate, toDate, isHalf, workingDayNums]);

  // ── Adjusted balance: subtract pending applications (from already-loaded
  //    myLeaves) so the cards update immediately after applying, without
  //    waiting for a server-side pending_days field.
  const adjustedBalance = useMemo(() => {
    if (!balance.length) return balance;
    const curYear = new Date().getFullYear();
    return balance.map(b => {
      const pendingDays = myLeaves
        .filter(l =>
          Number(l.leave_type_id) === Number(b.leave_type_id) &&
          l.status === "pending" &&
          new Date(l.from_date + "T00:00:00").getFullYear() === curYear
        )
        .reduce((sum, l) => sum + parseFloat(l.days ?? 0), 0);

      const total     = (b.total_days ?? 0) + (b.carried_days ?? 0);
      const remaining = Math.max(0, total - (b.used_days ?? 0) - pendingDays);
      return { ...b, pending_days: pendingDays, remaining_days: remaining };
    });
  }, [balance, myLeaves]);

  // ── Submit leave application ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selTypeId)  return Alert.alert("Required", "Please select a leave type.");
    if (!reason.trim()) return Alert.alert("Required", "Please provide a reason.");
    if (fromDate > toDate) return Alert.alert("Invalid", "From date cannot be after To date.");

    try {
      setSubmitting(true);
      await applyLeave(user, {
        leave_type_id: selTypeId,
        from_date:     fromDate,
        to_date:       toDate,
        reason:        reason.trim(),
        is_half_day:   isHalf ? 1 : 0,
        half_day_slot: isHalf ? halfSlot : undefined,
      });
      Alert.alert("Success", "Leave application submitted successfully!");
      setReason("");
      setIsHalf(false);
      load(true);
      setTab("history");
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Cancel application ───────────────────────────────────────────────────
  const handleCancel = (item) => {
    Alert.alert(
      "Cancel Leave",
      `Cancel your ${item.leave_type_name} application from ${fmtDate(item.from_date)} to ${fmtDate(item.to_date)}?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            try {
              await cancelLeave(user, item.id);
              load(true);
            } catch (e) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ]
    );
  };

  // ── Selected type info ───────────────────────────────────────────────────
  const selType    = leaveTypes.find(t => t.id === selTypeId);
  const selBalance = adjustedBalance.find(b => b.leave_type_id === selTypeId);

  // ── Render leave card ────────────────────────────────────────────────────
  const renderLeave = ({ item }) => (
    <View style={st.leaveCard}>
      <View style={st.leaveCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={st.leaveTypeName}>{item.leave_type_name}
            {item.is_half_day == 1
              ? <Text style={st.halfTag}> · Half Day ({item.half_day_slot})</Text>
              : null}
          </Text>
          <Text style={st.leaveDates}>
            {fmtDate(item.from_date)}
            {item.from_date !== item.to_date ? ` → ${fmtDate(item.to_date)}` : ""}
            {"  ·  "}{item.days} day{item.days != 1 ? "s" : ""}
          </Text>
        </View>
        <Badge status={item.status} />
      </View>
      <Text style={st.leaveReason} numberOfLines={2}>{item.reason}</Text>
      {!!item.remarks && (
        <View style={st.remarksBox}>
          <Feather name="message-square" size={11} color={C.muted} />
          <Text style={st.remarksText}>{item.remarks}</Text>
        </View>
      )}
      {item.status === "pending" && (
        <TouchableOpacity style={st.cancelBtn} onPress={() => handleCancel(item)}>
          <Feather name="x-circle" size={13} color={C.red} />
          <Text style={st.cancelBtnTxt}>Cancel Application</Text>
        </TouchableOpacity>
      )}
      <Text style={st.leaveAppliedOn}>Applied: {fmtDate(item.created_at)}</Text>
    </View>
  );

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
        <Text style={st.headerTitle}>My Leave</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Balance strip */}
      {adjustedBalance.length > 0 && (
        <View>
          <FlatList
            data={adjustedBalance}
            keyExtractor={i => String(i.leave_type_id)}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={st.balList}
            renderItem={({ item }) => <BalanceCard item={item} />}
            extraData={adjustedBalance}
          />
        </View>
      )}

      {/* Tabs */}
      <View style={st.tabs}>
        <TouchableOpacity
          style={[st.tab, tab === "apply" && st.tabActive]}
          onPress={() => setTab("apply")}
        >
          <Feather name="plus-circle" size={14} color={tab === "apply" ? C.primary : C.muted} />
          <Text style={[st.tabTxt, tab === "apply" && st.tabTxtActive]}>Apply</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.tab, tab === "history" && st.tabActive]}
          onPress={() => setTab("history")}
        >
          <Feather name="list" size={14} color={tab === "history" ? C.primary : C.muted} />
          <Text style={[st.tabTxt, tab === "history" && st.tabTxtActive]}>
            My Applications {myLeaves.length > 0 ? `(${myLeaves.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Apply Tab ─────────────────────────────────────────────────────── */}
      {tab === "apply" && (
        <ScrollView
          contentContainerStyle={st.applyScroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {/* Leave type picker */}
          <Text style={st.fieldLabel}>Leave Type *</Text>
          <TouchableOpacity style={st.selector} onPress={() => setTypePickerV(true)}>
            <Text style={[st.selectorTxt, !selType && { color: C.muted }]}>
              {selType ? `${selType.name} (max ${selType.max_days_per_year} days/yr)` : "Select leave type"}
            </Text>
            <Feather name="chevron-down" size={16} color={C.muted} />
          </TouchableOpacity>
          {selBalance && (
            <Text style={st.balHint}>
              Balance: {selBalance.remaining_days.toFixed(1)} day(s) remaining
            </Text>
          )}

          {/* Date pickers */}
          <View style={st.dateRow}>
            <DatePickerField
              label="From Date"
              value={fromDate}
              onChange={(v) => {
                setFromDate(v);
                if (toDate < v) setToDate(v);
              }}
            />
            <View style={{ width: 12 }} />
            <DatePickerField
              label="To Date"
              value={toDate}
              onChange={setToDate}
              minDate={new Date(fromDate + "T00:00:00")}
            />
          </View>

          {/* Working-day count pill */}
          <View style={st.dayCountRow}>
            <Feather name="clock" size={13} color={leaveDayCount === 0 ? C.red : C.primary} />
            <Text style={[st.dayCountTxt, leaveDayCount === 0 && { color: C.red }]}>
              {leaveDayCount === 0
                ? "No working days in selected range"
                : `${leaveDayCount} working day${leaveDayCount !== 1 ? "s" : ""} of leave`}
            </Text>
          </View>

          {/* Half day toggle */}
          <TouchableOpacity style={st.halfToggle} onPress={() => setIsHalf(!isHalf)}>
            <View style={[st.checkbox, isHalf && st.checkboxOn]}>
              {isHalf && <Feather name="check" size={11} color="#fff" />}
            </View>
            <Text style={st.halfTxt}>Half Day</Text>
          </TouchableOpacity>
          {isHalf && (
            <View style={st.slotRow}>
              {["morning", "afternoon"].map(s => (
                <TouchableOpacity
                  key={s}
                  style={[st.slotBtn, halfSlot === s && st.slotBtnOn]}
                  onPress={() => setHalfSlot(s)}
                >
                  <Text style={[st.slotBtnTxt, halfSlot === s && st.slotBtnTxtOn]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Reason */}
          <Text style={st.fieldLabel}>Reason *</Text>
          <TextInput
            style={st.textArea}
            placeholder="Briefly describe the reason for your leave..."
            placeholderTextColor={C.muted}
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={[st.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Feather name="send" size={16} color="#fff" />
                  <Text style={st.submitBtnTxt}>Submit Application</Text>
                </>
            }
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── History Tab ───────────────────────────────────────────────────── */}
      {tab === "history" && (
        myLeaves.length === 0
          ? (
            <ScrollView
              contentContainerStyle={st.center}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
            >
              <Feather name="calendar" size={48} color={C.border} />
              <Text style={st.emptyTxt}>No leave applications yet</Text>
            </ScrollView>
          )
          : (
            <FlatList
              data={myLeaves}
              keyExtractor={i => String(i.id)}
              contentContainerStyle={{ padding: 16 }}
              renderItem={renderLeave}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            />
          )
      )}

      {/* Leave Type Picker Modal */}
      <Modal visible={typePickerV} transparent animationType="slide" onRequestClose={() => setTypePickerV(false)}>
        <View style={st.modalOverlay}>
          <View style={st.modalSheet}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Select Leave Type</Text>
              <TouchableOpacity onPress={() => setTypePickerV(false)}>
                <Feather name="x" size={20} color={C.text} />
              </TouchableOpacity>
            </View>
            {leaveTypes.map(t => (
              <TouchableOpacity
                key={t.id}
                style={[st.typeItem, selTypeId === t.id && st.typeItemSel]}
                onPress={() => { setSelTypeId(t.id); setTypePickerV(false); }}
              >
                <View style={st.typeLeft}>
                  <View style={[st.typeAbbrBadge, selTypeId === t.id && { backgroundColor: C.primary }]}>
                    <Text style={[st.typeAbbrTxt, selTypeId === t.id && { color: "#fff" }]}>
                      {t.abbreviation || t.name.slice(0,2)}
                    </Text>
                  </View>
                  <View>
                    <Text style={st.typeItemName}>{t.name}</Text>
                    <Text style={st.typeItemSub}>{t.max_days_per_year} days / year
                      {t.carry_forward == 1 ? " · Carry forward" : ""}</Text>
                  </View>
                </View>
                {selTypeId === t.id && <Feather name="check" size={16} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.bg },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },

  // Header
  header:       { flexDirection: "row", alignItems: "center", backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 14 },
  backBtn:      { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:  { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: "#fff" },

  // Balance strip
  balList:      { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  balCard:      { backgroundColor: C.card, borderRadius: 12, padding: 12, width: 130, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4 },
  balAbbr:      { fontSize: 11, fontWeight: "700", color: C.primary, textTransform: "uppercase" },
  balName:      { fontSize: 10, color: C.muted, marginTop: 2, marginBottom: 4 },
  balRemain:    { fontSize: 26, fontWeight: "800", color: C.text },
  balSub:       { fontSize: 9, color: C.muted },
  balBarBg:        { height: 4, backgroundColor: C.border, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  balBarFg:        { height: "100%", borderRadius: 2 },
  balBarAbsolute:  { position: "absolute", left: 0, top: 0 },
  balUsed:      { fontSize: 9, color: C.muted, marginTop: 4 },

  // Tabs
  tabs:         { flexDirection: "row", backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  tab:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: C.primary },
  tabTxt:       { fontSize: 13, color: C.muted, fontWeight: "500" },
  tabTxtActive: { color: C.primary, fontWeight: "700" },

  // Apply form
  applyScroll:  { padding: 16, gap: 4 },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 6, marginTop: 8 },
  selector:     { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  selectorTxt:  { flex: 1, fontSize: 14, color: C.text },
  balHint:      { fontSize: 11, color: C.green, marginTop: 4, marginLeft: 2 },

  // Date picker
  dateRow:       { flexDirection: "row", marginTop: 4 },
  dpWrap:        { flex: 1 },
  dpLabel:       { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 6 },
  dpButton:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  dpButtonTxt:   { flex: 1, fontSize: 13, fontWeight: "600", color: C.text },
  // iOS date picker sheet
  iosOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  iosSheet:      { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  iosSheetHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  iosSheetTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  iosDone:       { fontSize: 15, fontWeight: "700", color: C.primary },

  // Day count
  dayCountRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  dayCountTxt:   { fontSize: 13, fontWeight: "600", color: C.primary },

  // Half day
  halfToggle:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  checkbox:     { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  checkboxOn:   { backgroundColor: C.primary, borderColor: C.primary },
  halfTxt:      { fontSize: 14, color: C.text },
  slotRow:      { flexDirection: "row", gap: 8, marginTop: 8 },
  slotBtn:      { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  slotBtnOn:    { backgroundColor: C.primary, borderColor: C.primary },
  slotBtnTxt:   { fontSize: 13, color: C.muted },
  slotBtnTxtOn: { color: "#fff", fontWeight: "600" },

  // Reason
  textArea:     { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 14, color: C.text, minHeight: 100, marginTop: 4 },

  // Submit
  submitBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  submitBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff" },

  // Leave card
  leaveCard:    { backgroundColor: C.card, borderRadius: 12, padding: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  leaveCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  leaveTypeName:{ fontSize: 14, fontWeight: "700", color: C.text },
  halfTag:      { fontSize: 11, fontWeight: "400", color: C.muted },
  leaveDates:   { fontSize: 12, color: C.muted, marginTop: 2 },
  leaveReason:  { fontSize: 13, color: C.slate, marginTop: 4 },
  remarksBox:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, backgroundColor: "#f8fafc", borderRadius: 6, padding: 8 },
  remarksText:  { fontSize: 12, color: C.muted, flex: 1 },
  cancelBtn:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-start", padding: 6 },
  cancelBtnTxt: { fontSize: 12, color: C.red, fontWeight: "600" },
  leaveAppliedOn: { fontSize: 10, color: C.muted, marginTop: 8, textAlign: "right" },

  // Badge
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeTxt:     { fontSize: 11, fontWeight: "700" },

  // Empty
  emptyTxt:     { fontSize: 14, color: C.muted, marginTop: 12 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, maxHeight: "75%" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle:   { fontSize: 16, fontWeight: "700", color: C.text },
  typeItem:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  typeItemSel:  { backgroundColor: "#eff6ff" },
  typeLeft:     { flexDirection: "row", alignItems: "center", gap: 12 },
  typeAbbrBadge:{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#e0e7ff", alignItems: "center", justifyContent: "center" },
  typeAbbrTxt:  { fontSize: 11, fontWeight: "800", color: C.primary },
  typeItemName: { fontSize: 14, fontWeight: "600", color: C.text },
  typeItemSub:  { fontSize: 11, color: C.muted, marginTop: 1 },
});
