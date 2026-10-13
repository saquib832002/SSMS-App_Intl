/**
 * screens/timetable/TimetableScreen.js
 * Master timetable view — week grid (days × periods) for a selected class/section.
 * Tap any non-break cell to assign or edit a subject + teacher.
 */
import React, { useState, useContext, useCallback, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, Modal, Alert, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchTimetable, saveTimetableSlot, deleteTimetableSlot, fetchPeriods, copyDay, fetchBusyMap } from "../../services/TimeTableServiceApi";
import { fetchClasses, fetchSessions, fetchBranches } from "../../services/SetupServiceApi";
import { fetchSections } from "../../services/StudentServiceApi";
import { fetchClassSubjects } from "../../services/SubjectServiceApi";
import { fetchStaff } from "../../services/StaffServiceApi";
import { fetchSchoolSettings } from "../../services/SchoolSettingsServiceApi";
import { _t, _tx } from "../../services/i18n";

// All possible days — working days are filtered from this at runtime
const ALL_DAYS = [
  { get label() { return _t("Mon"); }, value: 1 },
  { get label() { return _t("Tue"); }, value: 2 },
  { get label() { return _t("Wed"); }, value: 3 },
  { get label() { return _t("Thu"); }, value: 4 },
  { get label() { return _t("Fri"); }, value: 5 },
  { get label() { return _t("Sat"); }, value: 6 },
  { get label() { return _t("Sun"); }, value: 7 },
];

// Default: Mon–Sat (matches previous behaviour before settings are loaded)
const DEFAULT_WORKING_DAYS = ALL_DAYS.slice(0, 6);

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading: isLoading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[tt.dd, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && !isLoading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[tt.ddTxt, !selected?.value && tt.ddPh]} numberOfLines={1}>
          {isLoading ? _t("Loading…") : (_tx(selected?.label) ?? _tx(label))}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={tt.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={tt.ddSheet}>
            <Text style={tt.ddTitle}>{_tx(label)}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => `${i}_${String(o.value)}`}
              renderItem={({ item: o }) => {
                const isSelected = String(o.value) === String(value);
                return (
                  <TouchableOpacity
                    style={[tt.ddOpt, isSelected && tt.ddOptAct, o.busy && tt.ddOptBusy]}
                    onPress={() => { onChange(o.value); setOpen(false); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[tt.ddOptTxt, isSelected && tt.ddOptTxtAct, o.busy && tt.ddOptTxtBusy]}>
                        {o.busy ? "⛔ " : ""}{_tx(o.label)}
                      </Text>
                      {o.busy && !!o.busyLabel && (
                        <Text style={tt.ddOptBusyHint}>{_tx(o.busyLabel)}</Text>
                      )}
                    </View>
                    {isSelected && <Feather name="check" size={13} color={o.busy ? "#dc2626" : "#1e40af"} />}
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

export default function TimetableScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [classId,   setClassId]   = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [branchId,  setBranchId]  = useState("");

  const [schoolDays, setSchoolDays] = useState(DEFAULT_WORKING_DAYS); // dynamic from settings

  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [branches,  setBranches]  = useState([]);
  const [periods,   setPeriods]   = useState([]);
  const [slots,     setSlots]     = useState([]);   // flat timetable rows
  const [subjects,  setSubjects]  = useState([]);   // class-subjects for selected class
  const [staff,     setStaff]     = useState([]);

  const [loadingInit,     setLoadingInit]     = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingGrid,     setLoadingGrid]     = useState(false);

  // ── Slot editor modal ─────────────────────────────────────────────────────
  const [slotModal,      setSlotModal]      = useState(false);
  const [editingSlot,    setEditingSlot]    = useState(null); // existing timetable row or null
  const [slotDay,        setSlotDay]        = useState(null);
  const [slotPeriod,     setSlotPeriod]     = useState(null);
  const [slotSubjectId,  setSlotSubjectId]  = useState("");
  const [slotStaffId,    setSlotStaffId]    = useState("");
  const [slotRoom,       setSlotRoom]       = useState("");
  const [saving,         setSaving]         = useState(false);
  const [allowMerge,    setAllowMerge]    = useState(false); // bypass teacher conflict for merged classes
  const [gridHeight,     setGridHeight]     = useState(0);

  // ── Copy Day ──────────────────────────────────────────────────────────────
  const [copySourceDay,  setCopySourceDay]  = useState(1);
  const [copying,        setCopying]        = useState(false);
  const [busyMap,        setBusyMap]        = useState({});  // { staff_id: { day: { period_id: label } } }

  // ── Load static data ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        setLoadingInit(true);
        // allSettled: a 403 on one list (e.g. staff) must not blank the whole screen
        const results = await Promise.allSettled([
          fetchClasses(user),
          fetchSessions(user),
          fetchPeriods(user),
          fetchStaff(user),
          fetchBranches(user),
          fetchSchoolSettings(user).catch(() => null),
        ]);
        const [cls, sess, per, stf, br, settings] = results.map(r => (r.status === "fulfilled" ? r.value : null));
        const toArr = (v) => (Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : []);
        const failMsg = results.map(r => (r.status === "rejected" ? r.reason?.message : r.value?.status === false ? r.value?.message : null)).find(Boolean);
        if (failMsg) Alert.alert(_t("Error"), _tx(failMsg));
        setClasses(toArr(cls));
        setPeriods(toArr(per));
        setStaff(toArr(stf));

        const sessArr = toArr(sess);
        setSessions(sessArr);
        if (sessArr.length === 1) setSessionId(String(sessArr[0].session_id));

        const brArr = toArr(br);
        setBranches(brArr);
        if (brArr.length === 1) setBranchId(String(brArr[0].branch_id));

        // Apply working days from school settings
        if (settings?.working_days) {
          const dayNums = String(settings.working_days).split(",").map(Number).filter(n => n >= 1 && n <= 7);
          const filtered = ALL_DAYS.filter(d => dayNums.includes(d.value));
          if (filtered.length > 0) setSchoolDays(filtered);
        }
      } catch (e) {
        Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to load data"));
      } finally {
        setLoadingInit(false);
      }
    })();
  }, [user]);

  // ── Sections when class changes ───────────────────────────────────────────
  useEffect(() => {
    if (!classId) { setSections([]); setSectionId(""); return; }
    let cancelled = false;
    setLoadingSections(true);
    setSections([]); setSectionId("");
    fetchSections(user, classId)
      .then(d => {
        if (!cancelled) {
          const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
          setSections(arr);
          if (arr.length === 1) setSectionId(String(arr[0].section_id));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSections(false); });
    return () => { cancelled = true; };
  }, [classId]);

  // ── Subjects when class changes ───────────────────────────────────────────
  useEffect(() => {
    if (!classId) { setSubjects([]); return; }
    let cancelled = false;
    setLoadingSubjects(true);
    setSubjects([]);
    fetchClassSubjects(user, classId)
      .then(d => { if (!cancelled) setSubjects(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [classId]);

  // ── Load timetable grid ───────────────────────────────────────────────────
  const loadGrid = useCallback(async () => {
    if (!classId) return;
    try {
      setLoadingGrid(true);
      setGridHeight(0);
      // allSettled: the busy map is optional — its failure must not hide the timetable
      const [dataR, busyR] = await Promise.allSettled([
        fetchTimetable(user, { classId, sectionId, sessionId, branchId }),
        fetchBusyMap(user,   { classId, sectionId, sessionId, branchId }),
      ]);
      if (dataR.status === "rejected") throw dataR.reason;
      const data = dataR.value;
      const busy = busyR.status === "fulfilled" ? busyR.value : null;
      setSlots(Array.isArray(data) ? data : []);
      setBusyMap(busy && typeof busy === "object" ? busy : {});
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e?.message) || _t("Failed to load timetable"));
    } finally {
      setLoadingGrid(false);
    }
  }, [user, classId, sectionId, sessionId, branchId]);

  // useFocusEffect already re-runs when loadGrid changes (filters) while focused;
  // a second useEffect on the same filters fired a duplicate fetch (and duplicate error alert).
  useFocusEffect(useCallback(() => { loadGrid(); }, [loadGrid]));

  // ── Build grid map: { "day_period": slot } ───────────────────────────────
  const gridMap = useMemo(() => {
    const m = {};
    slots.forEach(s => { m[`${s.day_of_week}_${s.period_id}`] = s; });
    return m;
  }, [slots]);

  // ── Open slot editor ──────────────────────────────────────────────────────
  const openSlot = (day, period) => {
    if (!classId)   { Alert.alert(_t("Required"), _t("Please select a class.")); return; }
    if (!sectionId) { Alert.alert(_t("Required"), _t("Please select a section.")); return; }
    if (!sessionId) { Alert.alert(_t("Required"), _t("Please select a session.")); return; }
    const key  = `${day.value}_${period.period_id}`;
    const slot = gridMap[key] ?? null;
    setEditingSlot(slot);
    setSlotDay(day);
    setSlotPeriod(period);
    setSlotSubjectId(String(slot?.class_subject_id ?? ""));
    setSlotStaffId(String(slot?.staff_id ?? ""));
    setSlotRoom(slot?.room ?? "");
    setAllowMerge(false);
    setSlotModal(true);
  };

  // ── Save slot ─────────────────────────────────────────────────────────────
  const handleSaveSlot = async () => {
    if (!slotSubjectId) { Alert.alert(_t("Validation"), _t("Please select a subject.")); return; }
    try {
      setSaving(true);
      await saveTimetableSlot(user, {
        class_id:        parseInt(classId),
        section_id:      sectionId ? parseInt(sectionId) : null,
        session_id:      sessionId ? parseInt(sessionId) : null,
        branch_id:       branchId  ? parseInt(branchId)  : null,
        day_of_week:     slotDay.value,
        period_id:       slotPeriod.period_id,
        class_subject_id:parseInt(slotSubjectId),
        staff_id:        slotStaffId ? parseInt(slotStaffId) : null,
        room:            slotRoom.trim(),
      });
      setSlotModal(false);
      loadGrid();
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to save slot"));
    } finally {
      setSaving(false);
    }
  };

  // ── Clear slot ────────────────────────────────────────────────────────────
  const handleClearSlot = () => {
    if (!editingSlot) { setSlotModal(false); return; }
    Alert.alert(_t("Clear Slot"), _t("Remove this assignment?"), [
      { text: _t("Cancel"), style: "cancel" },
      {
        text: _t("Clear"), style: "destructive",
        onPress: async () => {
          try {
            setSaving(true);
            await deleteTimetableSlot(user, editingSlot.timetable_id);
            setSlotModal(false);
            loadGrid();
          } catch (e) {
            Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to clear slot"));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  // ── Copy Day ─────────────────────────────────────────────────────────────
  const handleCopyDay = (mode) => {
    if (!classId)   { Alert.alert(_t("Required"), _t("Please select a class.")); return; }
    if (!sectionId) { Alert.alert(_t("Required"), _t("Please select a section.")); return; }
    if (!sessionId) { Alert.alert(_t("Required"), _t("Please select a session.")); return; }
    const sourceName = schoolDays.find(d => d.value === copySourceDay)?.label ?? `Day ${copySourceDay}`;
    const modeLabel  = mode === "weekdays" ? "Mon–Fri" : "Mon–Sat";
    Alert.alert(
      _t("Copy Schedule"),
      _t("Copy {sourceName}'s schedule to all {modeLabel}?\n\nExisting slots on target days will be replaced.", { sourceName, modeLabel }),
      [
        { text: _t("Cancel"), style: "cancel" },
        {
          text: _t("Copy"), style: "default",
          onPress: async () => {
            try {
              setCopying(true);
              const res = await copyDay(user, {
                class_id:   parseInt(classId),
                section_id: sectionId ? parseInt(sectionId) : null,
                session_id: sessionId ? parseInt(sessionId) : null,
                branch_id:  branchId  ? parseInt(branchId)  : null,
                source_day: copySourceDay,
                mode,
              });
              Alert.alert(_t("Done"), _tx(res?.message) ?? _t("Schedule copied."));
              loadGrid();
            } catch (e) {
              Alert.alert(_t("Error"), _tx(e.message) || _t("Copy failed."));
            } finally {
              setCopying(false);
            }
          },
        },
      ]
    );
  };

  // ── Options ───────────────────────────────────────────────────────────────
  const classOpts   = [{ label: _t("Select Class"), value: "" }, ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) }))];
  const sectionOpts = [
    ...(sections.length !== 1 ? [{ label: _t("All Sections"), value: "" }] : []),
    ...sections.map(s => ({ label: s.section_name, value: String(s.section_id) })),
  ];
  const sessionOpts = [
    ...(sessions.length !== 1 ? [{ label: _t("All Sessions"), value: "" }] : []),
    ...sessions.map(s => ({ label: s.session_name ?? s.session_year, value: String(s.session_id) })),
  ];
  const branchOpts = [
    ...(branches.length !== 1 ? [{ label: _t("All Branches"), value: "" }] : []),
    ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
  ];
  const subjectOpts = [{ label: _t("Select Subject"), value: "" }, ...subjects.map(s => ({
    label: s.subject_code ? `${s.subject_name} - ${s.subject_code}` : s.subject_name,
    value: String(s.id),
  }))];
  // Helper: look up busy conflict label for a given teacher at the current slot
  const getSlotBusy = (staffId) => {
    if (!staffId || !slotDay || !slotPeriod) return null;
    return busyMap?.[String(staffId)]?.[String(slotDay.value)]?.[String(slotPeriod.period_id)] ?? null;
  };

  const staffOpts = [
    { label: _t("Select Teacher (optional)"), value: "" },
    ...staff.map(s => {
      const name      = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || s.display_name || `Staff #${s.staff_id}`;
      const busyLabel = getSlotBusy(s.staff_id);
      return {
        label:     name,
        value:     String(s.staff_id),
        busy:      !!busyLabel,
        busyLabel: busyLabel ? _t("Already assigned to {busyLabel} at this period", { busyLabel }) : null,
      };
    }),
  ];

  const selectedStaffBusy = getSlotBusy(slotStaffId);

  // ── Cell content ──────────────────────────────────────────────────────────
  const CellContent = ({ slot, isBreak }) => {
    if (isBreak) return (
      <View style={tt.breakCell}>
        <Text style={tt.breakCellTxt}>{_t("BREAK")}</Text>
      </View>
    );
    if (!slot) return (
      <View style={tt.emptyCell}>
        <Feather name="plus" size={12} color="#cbd5e1" />
      </View>
    );
    return (
      <View style={tt.filledCell}>
        <Text style={tt.cellSubject} numberOfLines={2}>
          {_tx(slot.subject_name)}{slot.subject_code ? `\n${_tx(slot.subject_code)}` : ""}
        </Text>
        {!!slot.teacher_name?.trim() &&
          <Text style={tt.cellTeacher} numberOfLines={1}>{slot.teacher_name.trim()}</Text>}
        {!!slot.room &&
          <Text style={tt.cellRoom} numberOfLines={1}><Feather name="map-pin" size={8} /> {_tx(slot.room)}</Text>}
      </View>
    );
  };

  const selClass   = classes.find(c  => String(c.class_id)   === String(classId));
  const selSection = sections.find(s => String(s.section_id) === String(sectionId));

  return (
    <View style={tt.container}>

      {/* ── Filter bar — two rows ── */}
      <View style={tt.filterBar}>
        {/* Row 1: Branch + Session */}
        <View style={tt.filterRow}>
          <View style={tt.filterItem}>
            <Text style={tt.filterLabel}>{_t("Branch")}</Text>
            <Dropdown label={_t("All Branches")} value={branchId} options={branchOpts}
              onChange={setBranchId} loading={loadingInit} />
          </View>
          <View style={tt.filterItem}>
            <Text style={tt.filterLabel}>{_t("Session")}</Text>
            <Dropdown label={_t("All Sessions")} value={sessionId} options={sessionOpts}
              onChange={setSessionId} loading={loadingInit} />
          </View>
        </View>
        {/* Row 2: Class + Section */}
        <View style={tt.filterRow}>
          <View style={tt.filterItem}>
            <Text style={tt.filterLabel}>{_t("Class *")}</Text>
            <Dropdown label={_t("Select Class")} value={classId} options={classOpts}
              onChange={v => { setClassId(v); setSectionId(""); }}
              loading={loadingInit} />
          </View>
          <View style={tt.filterItem}>
            <Text style={tt.filterLabel}>{_t("Section")}</Text>
            <Dropdown label={_t("All Sections")} value={sectionId} options={sectionOpts}
              onChange={setSectionId} disabled={!classId} loading={loadingSections} />
          </View>
        </View>
      </View>

      {/* ── Copy Day strip ── */}
      {classId && (
        <View style={tt.copyBar}>
          <Feather name="copy" size={12} color="#1e40af" />
          <Text style={tt.copyBarLabel}>{_t("Copy from:")}</Text>
          <TouchableOpacity
            style={tt.copyDayPicker}
            onPress={() => {
              Alert.alert(
                _t("Select Source Day"),
                undefined,
                schoolDays.map(d => ({
                  text: d.label,
                  onPress: () => setCopySourceDay(d.value),
                  style: d.value === copySourceDay ? "destructive" : "default",
                }))
              );
            }}
          >
            <Text style={tt.copyDayPickerTxt}>
              {_tx(schoolDays.find(d => d.value === copySourceDay)?.label) ?? _t("Mon")}
            </Text>
            <Feather name="chevron-down" size={11} color="#1e40af" />
          </TouchableOpacity>
          <Text style={tt.copyBarLabel}>{_t("to:")}</Text>
          <TouchableOpacity
            style={[tt.copyBtn, copying && { opacity: 0.5 }]}
            onPress={() => !copying && handleCopyDay("all")}
            disabled={copying}
          >
            {copying
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={tt.copyBtnTxt}>{_t("All Days")}</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[tt.copyBtn, tt.copyBtnSecondary, copying && { opacity: 0.5 }]}
            onPress={() => !copying && handleCopyDay("weekdays")}
            disabled={copying}
          >
            <Text style={[tt.copyBtnTxt, { color: "#1e40af" }]}>{_t("Mon–Fri")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Scrollable body ── */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        nestedScrollEnabled
      >

        {/* Title */}
        {classId ? (
          <View style={tt.gridTitle}>
            <Text style={tt.gridTitleTxt}>
              {_tx(selClass?.class_name) ?? ""}
              {selSection ? ` — ${_tx(selSection.section_name)}` : ""}
            </Text>
            {loadingGrid && <ActivityIndicator size="small" color="#1e40af" style={{ marginLeft: 8 }} />}
            <TouchableOpacity
              style={tt.teacherViewBtn}
              onPress={() => navigation.navigate("MasterTimetable")}
            >
              <Feather name="grid" size={12} color="#1e40af" />
              <Text style={tt.teacherViewBtnTxt}>{_t("Master View")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={tt.teacherViewBtn}
              onPress={() => navigation.navigate("TeacherTimetable")}
            >
              <Feather name="user" size={12} color="#1e40af" />
              <Text style={tt.teacherViewBtnTxt}>{_t("Teacher View")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={tt.noClass}>
            <Feather name="grid" size={36} color="#cbd5e1" />
            <Text style={tt.noClassTxt}>{_t("Select a class to view timetable")}</Text>
          </View>
        )}

        {/* Grid — horizontal scroll, height measured from inner content */}
        {classId && !loadingGrid && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            bounces={false}
            nestedScrollEnabled
            style={gridHeight > 0 ? { height: gridHeight } : undefined}
          >
            <View onLayout={e => setGridHeight(e.nativeEvent.layout.height)}>

              {/* Day headers */}
              <View style={tt.headerRow}>
                <View style={tt.periodCol} />
                {schoolDays.map(d => (
                  <View key={d.value} style={tt.dayCol}>
                    <Text style={tt.dayTxt}>{_tx(d.label)}</Text>
                  </View>
                ))}
              </View>

              {/* Period rows */}
              {periods.map(period => (
                <View key={String(period.period_id)} style={tt.gridRow}>
                  <View style={[tt.periodCol, period.is_break == 1 && tt.periodColBreak]}>
                    <Text style={tt.periodNum}>{_tx(period.period_number)}</Text>
                    <Text style={tt.periodNameTxt} numberOfLines={1}>{_tx(period.period_name)}</Text>
                    <Text style={tt.periodTime}>{_tx(period.start_time)}</Text>
                  </View>

                  {schoolDays.map(day => {
                    const key     = `${day.value}_${period.period_id}`;
                    const slot    = gridMap[key];
                    const isBreak = period.is_break == 1;
                    return (
                      <TouchableOpacity
                        key={day.value}
                        style={[tt.dayCol, tt.cell, isBreak && tt.cellBreak, !!slot && tt.cellFilled]}
                        onPress={() => !isBreak && openSlot(day, period)}
                        activeOpacity={isBreak ? 1 : 0.7}
                      >
                        <CellContent slot={slot} isBreak={isBreak} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

            </View>
          </ScrollView>
        )}

      </ScrollView>

      {/* Slot editor modal */}
      <Modal visible={slotModal} transparent animationType="fade" onRequestClose={() => !saving && setSlotModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={tt.modalOverlay}>
            <View style={tt.modalCard}>

              <View style={tt.modalHeader}>
                <View>
                  <Text style={tt.modalTitle}>
                    {_tx(slotDay?.label)} · {_tx(slotPeriod?.period_name)}
                  </Text>
                  <Text style={tt.modalSub}>
                    {_tx(slotPeriod?.start_time)} – {_tx(slotPeriod?.end_time)}
                  </Text>
                </View>
                <TouchableOpacity style={tt.modalClose} onPress={() => setSlotModal(false)} disabled={saving}>
                  <Feather name="x" size={15} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                <Text style={tt.fieldLabel}>{_t("Subject")}{" "}<Text style={{ color: "#ef4444" }}>*</Text></Text>
                <Dropdown label={_t("Select Subject")} value={slotSubjectId}
                  options={subjectOpts} onChange={setSlotSubjectId}
                  disabled={saving} loading={loadingSubjects} />

                <Text style={tt.fieldLabel}>{_t("Teacher")}</Text>
                <Dropdown label={_t("Select Teacher (optional)")} value={slotStaffId}
                  options={staffOpts} onChange={setSlotStaffId} disabled={saving} />
                {!!selectedStaffBusy && (
                  <>
                    <View style={tt.conflictBox}>
                      <Feather name="alert-circle" size={13} color="#dc2626" />
                      <Text style={tt.conflictTxt}>{_t("This teacher is already assigned to {selectedStaffBusy} at this period.", { selectedStaffBusy })}</Text>
                    </View>
                    <TouchableOpacity
                      style={[tt.mergeToggle, allowMerge && tt.mergeToggleOn]}
                      onPress={() => setAllowMerge(v => !v)}
                      activeOpacity={0.75}
                    >
                      <Feather
                        name={allowMerge ? "check-square" : "square"}
                        size={15}
                        color={allowMerge ? "#15803d" : "#94a3b8"}
                      />
                      <Text style={[tt.mergeToggleTxt, allowMerge && tt.mergeToggleTxtOn]}>{_t("Merged class — allow this teacher to take both classes simultaneously")}</Text>
                    </TouchableOpacity>
                  </>
                )}

                <Text style={tt.fieldLabel}>{_t("Room / Lab")}</Text>
                <TextInput
                  style={tt.input}
                  value={slotRoom}
                  onChangeText={setSlotRoom}
                  placeholder={_t("e.g. Room 101, Science Lab")}
                  placeholderTextColor="#94a3b8"
                  editable={!saving}
                />

              </ScrollView>

              <View style={tt.modalBtns}>
                {editingSlot && (
                  <TouchableOpacity style={tt.clearBtn} onPress={handleClearSlot} disabled={saving}>
                    <Feather name="trash-2" size={14} color="#dc2626" />
                    <Text style={tt.clearBtnTxt}>{_t("Clear")}</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={tt.cancelBtn} onPress={() => setSlotModal(false)} disabled={saving}>
                  <Text style={tt.cancelBtnTxt}>{_t("Cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[tt.saveBtn, (saving || (!!selectedStaffBusy && !allowMerge)) && { opacity: 0.5 }]} onPress={handleSaveSlot} disabled={saving || (!!selectedStaffBusy && !allowMerge)}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="check" size={14} color="#fff" /><Text style={tt.saveBtnTxt}>{_t("Save")}</Text></>}
                </TouchableOpacity>
              </View>

            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const CELL_W    = 110;
const PERIOD_W  = 72;
const CELL_H    = 70;   // matches minHeight: 68 + 1px border
const HEADER_H  = 36;   // day-label header row

const tt = StyleSheet.create({
  container:  { flex: 1, backgroundColor: "#f8fafc" },

  // Filter bar
  filterBar:   { flexDirection: "column", gap: 4, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  filterRow:   { flexDirection: "row", gap: 6, alignItems: "flex-end" },
  filterItem:  { flex: 1, minWidth: 0 },
  filterLabel: { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 },

  // Copy Day strip
  copyBar:           { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#dbeafe", flexWrap: "wrap" },
  copyBarLabel:      { fontSize: 11, fontWeight: "700", color: "#1e40af" },
  copyDayPicker:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: "#93c5fd", backgroundColor: "#fff" },
  copyDayPickerTxt:  { fontSize: 12, fontWeight: "700", color: "#1e40af" },
  copyBtn:           { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: "#1e40af" },
  copyBtnSecondary:  { backgroundColor: "#fff", borderWidth: 1, borderColor: "#93c5fd" },
  copyBtnTxt:        { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Grid title
  gridTitle:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#dbeafe" },
  gridTitleTxt:   { fontSize: 13, fontWeight: "800", color: "#1e40af", flex: 1 },
  teacherViewBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: "#1e40af", backgroundColor: "#fff" },
  teacherViewBtnTxt: { fontSize: 11, fontWeight: "700", color: "#1e40af" },

  noClass:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  noClassTxt: { fontSize: 13, color: "#94a3b8", fontWeight: "600" },

  // Grid
  headerRow:  { flexDirection: "row" },
  gridRow:    { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  periodCol:  { width: PERIOD_W, backgroundColor: "#f8fafc", borderRightWidth: 1, borderRightColor: "#e2e8f0", padding: 6, justifyContent: "center" },
  periodColBreak: { backgroundColor: "#fef3c7" },
  periodNum:  { fontSize: 11, fontWeight: "800", color: "#6b21a8" },
  periodNameTxt: { fontSize: 10, color: "#374151", fontWeight: "600", marginTop: 1 },
  periodTime: { fontSize: 9, color: "#94a3b8", marginTop: 2 },
  dayCol:     { width: CELL_W, borderRightWidth: 1, borderRightColor: "#e2e8f0" },
  dayTxt:     { fontSize: 11, fontWeight: "800", color: "#1e40af", textAlign: "center", padding: 8, backgroundColor: "#eff6ff" },

  // Cells
  cell:       { height: CELL_H, padding: 4, justifyContent: "center", alignItems: "center" },
  cellBreak:  { backgroundColor: "#fffbeb" },
  cellFilled: { backgroundColor: "#f0fdf4" },
  breakCell:  { alignItems: "center" },
  breakCellTxt: { fontSize: 9, fontWeight: "800", color: "#f59e0b", letterSpacing: 0.5 },
  emptyCell:  { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  filledCell: { width: "100%", paddingHorizontal: 4 },
  cellSubject:  { fontSize: 10, fontWeight: "700", color: "#15803d", textAlign: "center" },
  cellTeacher:  { fontSize: 9, color: "#64748b", textAlign: "center", marginTop: 2 },
  cellRoom:     { fontSize: 9, color: "#94a3b8", textAlign: "center", marginTop: 1 },

  // Dropdown
  dd:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 7, marginBottom: 0 },
  ddTxt:       { flex: 1, fontSize: 11, color: "#0f172a" },
  ddPh:        { color: "#94a3b8" },
  ddOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  ddSheet:     { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%", maxHeight: "65%" },
  ddTitle:     { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  ddOpt:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
  ddOptAct:     { backgroundColor: "#eff6ff" },
  ddOptBusy:    { backgroundColor: "#fff5f5" },
  ddOptTxt:     { fontSize: 13, color: "#0f172a" },
  ddOptTxtAct:  { color: "#1e40af", fontWeight: "700" },
  ddOptTxtBusy: { color: "#dc2626" },
  ddOptBusyHint:{ fontSize: 10, color: "#dc2626", marginTop: 2 },

  // Conflict warning
  conflictBox:  { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 9, padding: 10, marginBottom: 6 },
  conflictTxt:  { flex: 1, fontSize: 12, color: "#dc2626", fontWeight: "600", lineHeight: 17 },
  mergeToggle:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 9, padding: 10, marginBottom: 12 },
  mergeToggleOn:  { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  mergeToggleTxt: { flex: 1, fontSize: 12, color: "#64748b", fontWeight: "500", lineHeight: 17 },
  mergeToggleTxtOn: { color: "#15803d", fontWeight: "600" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modalCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 20, width: "100%", maxHeight: "85%", borderWidth: 1, borderColor: "#e2e8f0" },
  modalHeader:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  modalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalSub:     { fontSize: 11, color: "#64748b", marginTop: 2 },
  modalClose:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  fieldLabel:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input:        { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, color: "#0f172a", marginBottom: 12 },
  modalBtns:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  clearBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  clearBtnTxt:  { color: "#dc2626", fontWeight: "700", fontSize: 12 },
  cancelBtn:    { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },
});
