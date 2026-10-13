/**
 * screens/timetable/MasterTimetableScreen.js
 * School-wide master timetable: all class-sections (rows) × all periods (columns).
 * Read-only. Filter by session, branch, and day.
 */
import React, { useState, useEffect, useContext, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, FlatList, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchMasterTimetable } from "../../services/TimeTableServiceApi";
import { fetchSessions, fetchBranches } from "../../services/SetupServiceApi";
import { _t, _tx } from "../../services/i18n";

const CLASS_W  = 108;
const PERIOD_W = 108;
const ROW_H    = 68;
const HEADER_H = 54;

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading: isLoading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[mv.dd, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && !isLoading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[mv.ddTxt, !selected?.value && mv.ddPh]} numberOfLines={1}>
          {isLoading ? _t("Loading…") : (_tx(selected?.label) ?? _tx(label))}
        </Text>
        <Feather name="chevron-down" size={12} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={mv.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={mv.ddSheet}>
            <Text style={mv.ddTitle}>{_tx(label)}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => `${i}_${String(o.value)}`}
              renderItem={({ item: o }) => {
                const isSel = String(o.value) === String(value);
                return (
                  <TouchableOpacity
                    style={[mv.ddOpt, isSel && mv.ddOptAct]}
                    onPress={() => { onChange(o.value); setOpen(false); }}
                  >
                    <Text style={[mv.ddOptTxt, isSel && mv.ddOptTxtAct]}>{_tx(o.label)}</Text>
                    {isSel && <Feather name="check" size={13} color="#1e40af" />}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export default function MasterTimetableScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [sessionId,  setSessionId]  = useState("");
  const [branchId,   setBranchId]   = useState("");

  const [sessions,   setSessions]   = useState([]);
  const [branches,   setBranches]   = useState([]);

  const [periods,    setPeriods]    = useState([]);
  const [columns,    setColumns]    = useState([]);
  const [grid,       setGrid]       = useState({});

  const [loadingInit, setLoadingInit] = useState(true);
  const [loading,     setLoading]     = useState(false);
  const [gridHeight,  setGridHeight]  = useState(0);

  // ── Load sessions + branches ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        setLoadingInit(true);
        // allSettled: these services answer 403 with {status:false} (or throw) — keep what loads
        const results = await Promise.allSettled([
          fetchSessions(user),
          fetchBranches(user),
        ]);
        const [sess, br] = results.map(r => (r.status === "fulfilled" ? r.value : null));
        const toArr = (v) => (Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : []);
        const sessArr = toArr(sess);
        const brArr   = toArr(br);
        const failMsg = results.map(r => (r.status === "rejected" ? r.reason?.message : r.value?.status === false ? r.value?.message : null)).find(Boolean);
        if (failMsg) Alert.alert(_t("Error"), _tx(failMsg));
        setSessions(sessArr);
        setBranches(brArr);
        if (sessArr.length > 0) setSessionId(String(sessArr[0].session_id));
      } catch (e) {
        Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to load filters"));
      } finally {
        setLoadingInit(false);
      }
    })();
  }, [user]);

  // ── Load master grid ──────────────────────────────────────────────────────
  const loadGrid = useCallback(async () => {
    try {
      setLoading(true);
      setGridHeight(0);
      const res = await fetchMasterTimetable(user, { sessionId, branchId });
      setPeriods(Array.isArray(res?.periods) ? res.periods : []);
      setColumns(Array.isArray(res?.columns) ? res.columns : []);
      setGrid(res?.grid && typeof res.grid === "object" ? res.grid : {});
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to load master timetable"));
    } finally {
      setLoading(false);
    }
  }, [user, sessionId, branchId]);

  useEffect(() => { if (sessionId || !loadingInit) loadGrid(); }, [sessionId, branchId]);

  const sessionOpts = [
    { label: _t("All Sessions"), value: "" },
    ...sessions.map(s => ({ label: s.session_name ?? s.session_year, value: String(s.session_id) })),
  ];
  const branchOpts = [
    { label: _t("All Branches"), value: "" },
    ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
  ];

  const teachingPeriods = periods.filter(p => p.is_break != 1).length;

  return (
    <View style={mv.container}>

      {/* ── Filter bar ── */}
      <View style={mv.filterBar}>
        <View style={mv.filterItem}>
          <Text style={mv.filterLabel}>{_t("Session")}</Text>
          <Dropdown label={_t("All Sessions")} value={sessionId} options={sessionOpts}
            onChange={setSessionId} loading={loadingInit} />
        </View>
        <View style={mv.filterItem}>
          <Text style={mv.filterLabel}>{_t("Branch")}</Text>
          <Dropdown label={_t("All Branches")} value={branchId} options={branchOpts}
            onChange={setBranchId} loading={loadingInit} />
        </View>
      </View>

      {/* ── Summary bar ── */}
      {columns.length > 0 && (
        <View style={mv.summaryBar}>
          <Feather name="grid" size={12} color="#1e40af" />
          <Text style={mv.summaryTxt}>{_t("{length} class{pl} · {teachingPeriods} teaching period{pl2}", { length: columns.length, pl: columns.length !== 1 ? "es" : "", teachingPeriods, pl2: teachingPeriods !== 1 ? "s" : "" })}</Text>
          {loading && <ActivityIndicator size="small" color="#1e40af" style={{ marginLeft: 8 }} />}
        </View>
      )}

      {/* ── Grid ── */}
      {loading && columns.length === 0 ? (
        <View style={mv.center}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={mv.loadingTxt}>{_t("Loading master timetable…")}</Text>
        </View>
      ) : columns.length === 0 ? (
        <View style={mv.center}>
          <Feather name="grid" size={40} color="#cbd5e1" />
          <Text style={mv.emptyTxt}>{_t("No timetable data for this session")}</Text>
          <Text style={mv.emptyHint}>{_t("Set up the timetable first from the Timetable screen")}</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          nestedScrollEnabled
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            bounces={false}
            nestedScrollEnabled
            style={gridHeight > 0 ? { height: gridHeight } : undefined}
          >
            <View onLayout={e => setGridHeight(e.nativeEvent.layout.height)}>

              {/* ── Column headers: blank + period labels ── */}
              <View style={mv.headerRow}>
                <View style={[mv.classCol, mv.headerCell]}>
                  <Text style={mv.headerClassTxt}>{_t("Class / Section")}</Text>
                </View>
                {periods.map(p => (
                  <View key={String(p.period_id)} style={[mv.periodCol, mv.headerCell, p.is_break == 1 && mv.headerBreak]}>
                    {p.is_break == 1 ? (
                      <Text style={mv.breakHeaderTxt}>{_tx(p.period_name) || _t("Break")}</Text>
                    ) : (
                      <>
                        <Text style={mv.periodNum}>{_t("P{period_number}", { period_number: p.period_number })}</Text>
                        {!!p.period_name && <Text style={mv.periodName} numberOfLines={1}>{_tx(p.period_name)}</Text>}
                        <Text style={mv.periodTime}>
                          {p.start_time?.substring(0, 5)}–{p.end_time?.substring(0, 5)}
                        </Text>
                      </>
                    )}
                  </View>
                ))}
              </View>

              {/* ── Data rows: one per class-section ── */}
              {columns.map((col, idx) => (
                <View key={col.key} style={[mv.dataRow, idx % 2 === 1 && mv.dataRowAlt]}>
                  {/* Class-section label */}
                  <View style={[mv.classCol, mv.classLabelCell]}>
                    <Text style={mv.classLabelTxt} numberOfLines={2}>{_tx(col.label)}</Text>
                  </View>

                  {/* Period cells */}
                  {periods.map(p => {
                    const slot    = grid[String(p.period_id)]?.[col.key];
                    const isBreak = p.is_break == 1;
                    return (
                      <View key={String(p.period_id)} style={[mv.periodCol, mv.cell, isBreak && mv.cellBreak]}>
                        {isBreak ? (
                          <Text style={mv.breakDash}>—</Text>
                        ) : slot?.subject_name ? (
                          <View style={mv.slotContent}>
                            <Text style={mv.slotSubject} numberOfLines={2}>
                              {_tx(slot.subject_name)}
                              {slot.subject_code ? `\n${_tx(slot.subject_code)}` : ""}
                            </Text>
                            {!!slot.staff_name && (
                              <Text style={mv.slotTeacher} numberOfLines={1}>
                                {_tx(slot.staff_name)}
                              </Text>
                            )}
                            {!!slot.room && (
                              <Text style={mv.slotRoom} numberOfLines={1}>
                                <Feather name="map-pin" size={8} /> {_tx(slot.room)}
                              </Text>
                            )}
                          </View>
                        ) : (
                          <Text style={mv.emptyCell}>—</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}

            </View>
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

const mv = StyleSheet.create({
  container:  { flex: 1, backgroundColor: "#f8fafc" },

  // Filter bar
  filterBar:   { flexDirection: "row", gap: 6, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  filterItem:  { flex: 1, minWidth: 0 },
  filterLabel: { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 },

  // Summary bar
  summaryBar:  { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#dbeafe" },
  summaryTxt:  { fontSize: 11, fontWeight: "700", color: "#1e40af" },

  // Empty / loading
  center:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  loadingTxt:  { fontSize: 13, color: "#94a3b8", fontWeight: "600" },
  emptyTxt:    { fontSize: 14, fontWeight: "700", color: "#475569", textAlign: "center" },
  emptyHint:   { fontSize: 12, color: "#94a3b8", textAlign: "center", lineHeight: 18 },

  // Grid header row
  headerRow:       { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "#e2e8f0" },
  headerCell:      { justifyContent: "center", alignItems: "center", padding: 8, backgroundColor: "#f8faff" },
  headerClassTxt:  { fontSize: 10, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.4 },
  headerBreak:     { backgroundColor: "#fffbeb" },
  breakHeaderTxt:  { fontSize: 10, fontWeight: "700", color: "#b45309", textAlign: "center" },
  periodNum:       { fontSize: 12, fontWeight: "800", color: "#0b1f4b", textAlign: "center" },
  periodName:      { fontSize: 9,  color: "#64748b", textAlign: "center", marginTop: 1 },
  periodTime:      { fontSize: 8,  color: "#94a3b8", textAlign: "center", marginTop: 2 },

  // Data rows
  dataRow:         { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  dataRowAlt:      { backgroundColor: "#fafbff" },
  classLabelCell:  { justifyContent: "center", padding: 8, borderRightWidth: 1, borderRightColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  classLabelTxt:   { fontSize: 11, fontWeight: "700", color: "#0b1f4b" },

  // Cells
  cell:         { height: ROW_H, justifyContent: "center", alignItems: "center", borderRightWidth: 1, borderRightColor: "#f1f5f9", padding: 4 },
  cellBreak:    { backgroundColor: "#fffbeb" },
  breakDash:    { fontSize: 14, color: "#d97706", fontWeight: "600", textAlign: "center" },
  emptyCell:    { fontSize: 12, color: "#cbd5e1", textAlign: "center" },
  slotContent:  { width: "100%", alignItems: "center" },
  slotSubject:  { fontSize: 10, fontWeight: "800", color: "#0b1f4b", textAlign: "center", lineHeight: 13 },
  slotTeacher:  { fontSize: 9,  color: "#2f7ef5", fontWeight: "600", textAlign: "center", marginTop: 2 },
  slotRoom:     { fontSize: 8,  color: "#94a3b8", textAlign: "center", marginTop: 1 },

  // Column widths
  classCol:   { width: CLASS_W },
  periodCol:  { width: PERIOD_W },

  // Dropdown
  dd:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 7 },
  ddTxt:       { flex: 1, fontSize: 11, color: "#0f172a" },
  ddPh:        { color: "#94a3b8" },
  ddOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  ddSheet:     { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%", maxHeight: "65%" },
  ddTitle:     { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  ddOpt:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
  ddOptAct:    { backgroundColor: "#eff6ff" },
  ddOptTxt:    { fontSize: 13, color: "#0f172a" },
  ddOptTxtAct: { color: "#1e40af", fontWeight: "700" },
});
