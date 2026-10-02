/**
 * screens/timetable/TeacherTimetableScreen.js
 * Read-only weekly schedule for a selected teacher across all classes.
 */
import React, { useState, useContext, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, Modal, Alert, ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchTeacherTimetable, fetchPeriods } from "../../services/TimeTableServiceApi";
import { fetchSessions } from "../../services/SetupServiceApi";
import { fetchStaff } from "../../services/StaffServiceApi";

const DAYS = [
  { label: "Monday",    short: "Mon", value: 1 },
  { label: "Tuesday",   short: "Tue", value: 2 },
  { label: "Wednesday", short: "Wed", value: 3 },
  { label: "Thursday",  short: "Thu", value: 4 },
  { label: "Friday",    short: "Fri", value: 5 },
  { label: "Saturday",  short: "Sat", value: 6 },
];

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading: isLoading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[tv.dd, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && !isLoading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[tv.ddTxt, !selected?.value && tv.ddPh]} numberOfLines={1}>
          {isLoading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={tv.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={tv.ddSheet}>
            <Text style={tv.ddTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => `${i}_${String(o.value)}`}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[tv.ddOpt, String(o.value) === String(value) && tv.ddOptAct]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[tv.ddOptTxt, String(o.value) === String(value) && tv.ddOptTxtAct]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={13} color="#6b21a8" />}
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

export default function TeacherTimetableScreen() {
  const { user } = useContext(AuthContext);

  const [staffId,   setStaffId]   = useState("");
  const [sessionId, setSessionId] = useState("");
  const [staff,     setStaff]     = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [periods,   setPeriods]   = useState([]);
  const [slots,     setSlots]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [loadingGrid, setLoadingGrid] = useState(false);

  // ── Load static data ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [stf, sess, per] = await Promise.all([
          fetchStaff(user),
          fetchSessions(user),
          fetchPeriods(user),
        ]);
        setStaff(Array.isArray(stf)   ? stf   : stf?.data   ?? []);
        setSessions(Array.isArray(sess) ? sess : sess?.data  ?? []);
        setPeriods(Array.isArray(per)  ? per   : per?.data   ?? []);
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // ── Load teacher's timetable ──────────────────────────────────────────────
  useEffect(() => {
    if (!staffId) { setSlots([]); return; }
    let cancelled = false;
    setLoadingGrid(true);
    setSlots([]);
    fetchTeacherTimetable(user, { staffId, sessionId })
      .then(d => { if (!cancelled) setSlots(Array.isArray(d) ? d : []); })
      .catch(e => Alert.alert("Error", e.message || "Failed to load timetable"))
      .finally(() => { if (!cancelled) setLoadingGrid(false); });
    return () => { cancelled = true; };
  }, [staffId, sessionId]);

  // ── Grid map: { "day_period": slot } ─────────────────────────────────────
  const gridMap = useMemo(() => {
    const m = {};
    slots.forEach(s => { m[`${s.day_of_week}_${s.period_id}`] = s; });
    return m;
  }, [slots]);

  // ── Summary counts ────────────────────────────────────────────────────────
  const totalPeriods = slots.length;
  const uniqueClasses = [...new Set(slots.map(s => s.class_name))].length;

  // ── Options ───────────────────────────────────────────────────────────────
  const staffOpts   = [{ label: "Select Teacher", value: "" }, ...staff.map(s => ({
    label: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || s.display_name || `Staff #${s.staff_id}`,
    value: String(s.staff_id),
  }))];
  const sessionOpts = [{ label: "All Sessions", value: "" }, ...sessions.map(s => ({
    label: s.session_name ?? s.session_year, value: String(s.session_id),
  }))];

  const selStaff = staff.find(s => String(s.staff_id) === String(staffId));
  const selTeacherName = selStaff
    ? (`${selStaff.first_name ?? ""} ${selStaff.last_name ?? ""}`.trim() || selStaff.display_name)
    : "";

  return (
    <View style={tv.container}>

      {/* Filter bar */}
      <View style={tv.filterBar}>
        <View style={{ flex: 2 }}>
          <Text style={tv.filterLabel}>Teacher *</Text>
          <Dropdown label="Select Teacher" value={staffId} options={staffOpts}
            onChange={setStaffId} loading={loading} />
        </View>
        <View style={{ width: 10 }} />
        <View style={{ flex: 1 }}>
          <Text style={tv.filterLabel}>Session</Text>
          <Dropdown label="All" value={sessionId} options={sessionOpts}
            onChange={setSessionId} loading={loading} />
        </View>
      </View>

      {/* Summary bar */}
      {staffId && !loadingGrid && (
        <View style={tv.summaryBar}>
          <Feather name="user" size={13} color="#6b21a8" />
          <Text style={tv.summaryName} numberOfLines={1}>{selTeacherName}</Text>
          <View style={tv.summaryChip}>
            <Text style={tv.summaryChipTxt}>{totalPeriods} periods</Text>
          </View>
          <View style={tv.summaryChip}>
            <Text style={tv.summaryChipTxt}>{uniqueClasses} classes</Text>
          </View>
          {loadingGrid && <ActivityIndicator size="small" color="#6b21a8" style={{ marginLeft: 6 }} />}
        </View>
      )}

      {/* Empty / no selection */}
      {!staffId ? (
        <View style={tv.noSelect}>
          <Feather name="user" size={40} color="#cbd5e1" />
          <Text style={tv.noSelectTxt}>Select a teacher to view their schedule</Text>
        </View>
      ) : loadingGrid ? (
        <View style={tv.noSelect}>
          <ActivityIndicator size="large" color="#6b21a8" />
          <Text style={tv.noSelectTxt}>Loading schedule…</Text>
        </View>
      ) : (
        /* Grid */
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>

            {/* Day headers */}
            <View style={tv.headerRow}>
              <View style={tv.periodCol} />
              {DAYS.map(d => (
                <View key={d.value} style={tv.dayCol}>
                  <Text style={tv.dayTxt}>{d.short}</Text>
                </View>
              ))}
            </View>

            {/* Period rows */}
            {periods.map(period => (
              <View key={String(period.period_id)} style={tv.gridRow}>

                {/* Period label */}
                <View style={[tv.periodCol, period.is_break == 1 && tv.periodColBreak]}>
                  <Text style={tv.periodNum}>{period.period_number}</Text>
                  <Text style={tv.periodNameTxt} numberOfLines={1}>{period.period_name}</Text>
                  <Text style={tv.periodTime}>{period.start_time}</Text>
                </View>

                {/* Day cells */}
                {DAYS.map(day => {
                  const key  = `${day.value}_${period.period_id}`;
                  const slot = gridMap[key];
                  const isBreak = period.is_break == 1;

                  return (
                    <View
                      key={day.value}
                      style={[tv.dayCol, tv.cell, isBreak && tv.cellBreak, !!slot && tv.cellFilled]}
                    >
                      {isBreak ? (
                        <Text style={tv.breakTxt}>BREAK</Text>
                      ) : slot ? (
                        <View style={tv.slotContent}>
                          <Text style={tv.slotSubject} numberOfLines={2}>
                            {slot.subject_name}
                            {slot.subject_code ? `\n${slot.subject_code}` : ""}
                          </Text>
                          <View style={tv.classBadge}>
                            <Text style={tv.classBadgeTxt}>
                              {slot.class_name}
                              {slot.section_name ? ` · ${slot.section_name}` : ""}
                            </Text>
                          </View>
                          {!!slot.room && (
                            <Text style={tv.roomTxt} numberOfLines={1}>
                              <Feather name="map-pin" size={8} /> {slot.room}
                            </Text>
                          )}
                        </View>
                      ) : (
                        <Text style={tv.freeTxt}>—</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}

          </ScrollView>
        </ScrollView>
      )}

    </View>
  );
}

const CELL_W   = 110;
const PERIOD_W = 72;

const tv = StyleSheet.create({
  container:  { flex: 1, backgroundColor: "#f8fafc" },

  filterBar:   { flexDirection: "row", padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  filterLabel: { fontSize: 10, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },

  summaryBar:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#faf5ff", borderBottomWidth: 1, borderBottomColor: "#ede9fe" },
  summaryName: { flex: 1, fontSize: 12, fontWeight: "800", color: "#6b21a8" },
  summaryChip: { backgroundColor: "#ede9fe", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  summaryChipTxt: { fontSize: 11, fontWeight: "700", color: "#6b21a8" },

  noSelect:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  noSelectTxt: { fontSize: 13, color: "#94a3b8", fontWeight: "600", textAlign: "center", paddingHorizontal: 32 },

  // Grid
  headerRow:  { flexDirection: "row" },
  gridRow:    { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  periodCol:  { width: PERIOD_W, backgroundColor: "#f8fafc", borderRightWidth: 1, borderRightColor: "#e2e8f0", padding: 6, justifyContent: "center" },
  periodColBreak: { backgroundColor: "#fef3c7" },
  periodNum:  { fontSize: 11, fontWeight: "800", color: "#6b21a8" },
  periodNameTxt: { fontSize: 10, color: "#374151", fontWeight: "600", marginTop: 1 },
  periodTime: { fontSize: 9, color: "#94a3b8", marginTop: 2 },
  dayCol:     { width: CELL_W, borderRightWidth: 1, borderRightColor: "#e2e8f0" },
  dayTxt:     { fontSize: 11, fontWeight: "800", color: "#6b21a8", textAlign: "center", padding: 8, backgroundColor: "#faf5ff" },

  cell:        { minHeight: 72, padding: 6, justifyContent: "center", alignItems: "center" },
  cellBreak:   { backgroundColor: "#fffbeb" },
  cellFilled:  { backgroundColor: "#f0fdf4" },
  breakTxt:    { fontSize: 9, fontWeight: "800", color: "#f59e0b", letterSpacing: 0.5 },
  freeTxt:     { fontSize: 14, color: "#e2e8f0", fontWeight: "600" },
  slotContent: { width: "100%", alignItems: "center" },
  slotSubject: { fontSize: 10, fontWeight: "700", color: "#15803d", textAlign: "center" },
  classBadge:  { backgroundColor: "#dbeafe", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginTop: 4 },
  classBadgeTxt: { fontSize: 9, fontWeight: "700", color: "#1e40af" },
  roomTxt:     { fontSize: 9, color: "#94a3b8", textAlign: "center", marginTop: 3 },

  // Dropdown
  dd:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9 },
  ddTxt:       { flex: 1, fontSize: 12, color: "#0f172a" },
  ddPh:        { color: "#94a3b8" },
  ddOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  ddSheet:     { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%", maxHeight: "65%" },
  ddTitle:     { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  ddOpt:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
  ddOptAct:    { backgroundColor: "#faf5ff" },
  ddOptTxt:    { fontSize: 13, color: "#0f172a" },
  ddOptTxtAct: { color: "#6b21a8", fontWeight: "700" },
});
