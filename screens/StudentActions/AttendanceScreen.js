/**
 * screens/Attendance/AttendanceScreen.js
 * Scrollable attendance screen with auto-loaded 10-day history matrix at bottom.
 * After saving, offers WhatsApp absent notifications to parents.
 */
import React, {
  useState, useEffect, useContext, useCallback, useRef,
} from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Modal, FlatList, Platform,
  Linking, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { Feather } from "@expo/vector-icons";
import {
  fetchStudents, saveAttendance, fetchClasses, fetchSections,
  fetchRecentAttendance,
} from "../../services/StudentServiceApi";
import { fetchSessions, fetchBranches } from "../../services/SetupServiceApi";

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS = {
  P: { label: "Present", short: "P", color: "#16a34a", bg: "#dcfce7", border: "#86efac" },
  A: { label: "Absent",  short: "A", color: "#dc2626", bg: "#fee2e2", border: "#fca5a5" },
  L: { label: "Late",    short: "L", color: "#d97706", bg: "#fef3c7", border: "#fcd34d" },
};

const HIST_STATUS = {
  P:   { bg: "#dcfce7", fg: "#15803d", label: "P" },
  A:   { bg: "#fee2e2", fg: "#dc2626", label: "A" },
  L:   { bg: "#fef9c3", fg: "#92400e", label: "L" },
  H:   { bg: "#e0f2fe", fg: "#0369a1", label: "H" },
  S:   { bg: "#f1f5f9", fg: "#94a3b8", label: "S" },
  "-": { bg: "#fff",    fg: "#fff",    label: ""  },
};

const DAY_W  = 26;
const NAME_W = 110;
const TOT_W  = 46;

const pctColor = (p) => p >= 75 ? "#15803d" : p >= 50 ? "#b45309" : "#dc2626";

// ── Phone helpers ─────────────────────────────────────────────────────────────
const normalizePhone = (raw) => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.startsWith("0") ? "92" + digits.slice(1) : digits;
};

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[dd.triggerTxt, !selected?.value && dd.placeholder]} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={14} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[dd.option, String(o.value) === String(value) && dd.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[dd.optionTxt, String(o.value) === String(value) && dd.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) &&
                    <Feather name="check" size={14} color="#2563eb" />}
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

// ── Student row ───────────────────────────────────────────────────────────────
const StudentRow = React.memo(function StudentRow({ item, onUpdate, locked }) {
  const statusCfg = STATUS[item.status] ?? STATUS.P;
  return (
    <View style={sc.studentRow}>
      <View style={[sc.avatar, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
        <Text style={[sc.avatarTxt, { color: statusCfg.color }]}>
          {(item.firstName?.[0] ?? item.student_first_name?.[0] ?? "?").toUpperCase()}
        </Text>
      </View>
      <View style={sc.studentInfo}>
        <Text style={sc.studentName} numberOfLines={1}>
          {item.firstName ?? item.student_first_name ?? "Unknown"}
          {item.lastName ? ` ${item.lastName}` : ""}
        </Text>
        <Text style={sc.studentRoll}>Roll #{item.rollNumber ?? item.roll_no ?? "—"}</Text>
      </View>
      <View style={sc.statusBtns}>
        {Object.entries(STATUS).map(([key, cfg]) => {
          const active = item.status === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                sc.statusBtn,
                active
                  ? { backgroundColor: cfg.bg, borderColor: cfg.border }
                  : { backgroundColor: "#f8fafc", borderColor: "#e2e8f0" },
                locked && { opacity: 0.5 },
              ]}
              onPress={() => !locked && onUpdate(item.rollNumber ?? item.roll_no, key)}
              activeOpacity={0.7}
            >
              <Text style={[sc.statusBtnTxt, { color: active ? cfg.color : "#94a3b8" }]}>
                {cfg.short}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
});

// ── History matrix ────────────────────────────────────────────────────────────
function HistoryMatrix({ columns, dayNames, students, loading }) {
  if (loading) {
    return (
      <View style={hm.loadingBox}>
        <ActivityIndicator size="small" color="#2563eb" />
        <Text style={hm.loadingTxt}>Loading attendance history…</Text>
      </View>
    );
  }
  if (!columns?.length || !students?.length) {
    return (
      <View style={hm.loadingBox}>
        <Feather name="calendar" size={16} color="#cbd5e1" />
        <Text style={hm.loadingTxt}>No attendance records for the last 10 days</Text>
      </View>
    );
  }

  const dayHeader = columns.map((col, i) => ({
    col,
    abbr: dayNames?.[i] ?? "",
    isSun: (dayNames?.[i] ?? "").startsWith("Sun"),
  }));

  return (
    <View style={hm.card}>
      <View style={hm.titleRow}>
        <Feather name="clock" size={13} color="#2563eb" />
        <Text style={hm.title}>Last 10 Days Attendance</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={hm.row}>
            <View style={[hm.nameCell, { width: NAME_W }, hm.headerCell]}>
              <Text style={hm.headerTxt}>Student</Text>
            </View>
            {dayHeader.map(({ col, abbr, isSun }) => (
              <View key={col} style={[hm.dayCell, { width: DAY_W }, hm.headerCell,
                isSun && { backgroundColor: "#e8edf5" }]}>
                <Text style={[hm.dayAbbr, isSun && { color: "#94a3b8" }]}>{abbr}</Text>
                <Text style={[hm.dayNum,  isSun && { color: "#94a3b8" }]}>{col.split(" ")[0]}</Text>
              </View>
            ))}
            <View style={[hm.totCell, { width: TOT_W }, hm.headerCell]}>
              <Text style={hm.headerTxt}>P/T</Text>
            </View>
            <View style={[hm.totCell, { width: TOT_W }, hm.headerCell]}>
              <Text style={hm.headerTxt}>%</Text>
            </View>
          </View>
          {students.map((stu, idx) => (
            <View key={stu.id ?? idx}
              style={[hm.row, idx % 2 === 1 && { backgroundColor: "#fafafa" }]}>
              <View style={[hm.nameCell, { width: NAME_W }]}>
                <Text style={hm.nameTxt} numberOfLines={1}>{stu.firstName}</Text>
                <Text style={hm.enrollTxt}>Roll #{stu.rollNumber}</Text>
              </View>
              {columns.map((col) => {
                const v  = stu.days?.[col] ?? "-";
                const st = HIST_STATUS[v] ?? HIST_STATUS["-"];
                return (
                  <View key={col} style={[hm.dayCell, { width: DAY_W, backgroundColor: st.bg }]}>
                    <Text style={[hm.dayVal, { color: st.fg }]}>{st.label}</Text>
                  </View>
                );
              })}
              <View style={[hm.totCell, { width: TOT_W }]}>
                <Text style={hm.totTxt}>{stu.present}/{stu.total}</Text>
              </View>
              <View style={[hm.totCell, { width: TOT_W }]}>
                <Text style={[hm.pctTxt, { color: pctColor(stu.percent) }]}>
                  {stu.percent}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={hm.legend}>
        {Object.entries(HIST_STATUS).filter(([k]) => k !== "-").map(([code, st]) => (
          <View key={code} style={hm.legendItem}>
            <View style={[hm.legendDot, { backgroundColor: st.bg, borderColor: st.fg + "66" }]} />
            <Text style={hm.legendTxt}>{code}</Text>
          </View>
        ))}
        <Text style={hm.legendNote}>  P=Present  A=Absent  L=Leave  H=Holiday  S=Sunday</Text>
      </View>
    </View>
  );
}

// ── Save Success Sheet ────────────────────────────────────────────────────────
function SaveSuccessSheet({ visible, onClose, onNotify, summary, waCount, noPhoneCount, dateLabel, classLabel }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={ss.sheet}>
          {/* Handle */}
          <View style={ss.handle} />

          {/* Success header */}
          <View style={ss.successHeader}>
            <View style={ss.checkCircle}>
              <Feather name="check" size={26} color="#fff" />
            </View>
            <Text style={ss.successTitle}>Attendance Saved!</Text>
            <Text style={ss.successSub}>{classLabel}{classLabel ? "  ·  " : ""}{dateLabel}</Text>
          </View>

          {/* Stats row */}
          <View style={ss.statsRow}>
            {[
              { key: "P", label: "Present", color: "#16a34a", bg: "#dcfce7" },
              { key: "A", label: "Absent",  color: "#dc2626", bg: "#fee2e2" },
              { key: "L", label: "Late",    color: "#d97706", bg: "#fef3c7" },
            ].map(({ key, label, color, bg }) => (
              <View key={key} style={[ss.statChip, { backgroundColor: bg }]}>
                <Text style={[ss.statNum, { color }]}>{summary?.[key] ?? 0}</Text>
                <Text style={[ss.statLbl, { color }]}>{label}</Text>
              </View>
            ))}
            <View style={[ss.statChip, { backgroundColor: "#f1f5f9" }]}>
              <Text style={[ss.statNum, { color: "#0f172a" }]}>{summary?.total ?? 0}</Text>
              <Text style={[ss.statLbl, { color: "#64748b" }]}>Total</Text>
            </View>
          </View>

          {/* WhatsApp CTA */}
          {waCount > 0 ? (
            <TouchableOpacity style={ss.waBtn} onPress={onNotify} activeOpacity={0.85}>
              <View style={ss.waBtnIcon}>
                <Feather name="message-circle" size={18} color="#25d366" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.waBtnTitle}>Notify Absent Parents via WhatsApp</Text>
                <Text style={ss.waBtnSub}>
                  {waCount} parent{waCount !== 1 ? "s" : ""} to notify
                  {noPhoneCount > 0 ? `  ·  ${noPhoneCount} no phone` : ""}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#0f172a" />
            </TouchableOpacity>
          ) : (summary?.A ?? 0) > 0 ? (
            <View style={ss.noPhoneNote}>
              <Feather name="alert-circle" size={14} color="#94a3b8" />
              <Text style={ss.noPhoneTxt}>
                {summary.A} absent student{summary.A !== 1 ? "s" : ""} — no parent phone on record
              </Text>
            </View>
          ) : (
            <View style={ss.allPresentNote}>
              <Feather name="star" size={14} color="#16a34a" />
              <Text style={ss.allPresentTxt}>All students present — great day!</Text>
            </View>
          )}

          {/* Done button */}
          <TouchableOpacity style={ss.doneBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={ss.doneTxt}>Done</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── WhatsApp Notify Modal (full-screen) ───────────────────────────────────────
function WaNotifyModal({ visible, onClose, students, dateLabel, classLabel, buildMessage }) {
  const withPhone    = students.filter(s => normalizePhone(s.phone));
  const withoutPhone = students.filter(s => !normalizePhone(s.phone));

  const openWa = async (student) => {
    const phone = normalizePhone(student.phone);
    if (!phone) return;
    const msg = encodeURIComponent(buildMessage(student));
    Linking.openURL(`https://wa.me/${phone}?text=${msg}`).catch(() =>
      Alert.alert("Error", "Could not open WhatsApp. Please make sure it is installed.")
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f0fdf4" }} edges={["top"]}>

        {/* Header */}
        <View style={wm.header}>
          <TouchableOpacity onPress={onClose} style={wm.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={20} color="#0f172a" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={wm.headerTitle}>WhatsApp Absent Notifications</Text>
            <Text style={wm.headerSub}>
              {classLabel}{classLabel ? "  ·  " : ""}{dateLabel}
            </Text>
          </View>
          <View style={wm.badge}>
            <Text style={wm.badgeTxt}>{withPhone.length}</Text>
          </View>
        </View>

        {/* Info banner */}
        <View style={wm.infoBanner}>
          <Feather name="info" size={13} color="#2563eb" />
          <Text style={wm.infoTxt}>
            Tap <Text style={{ fontWeight: "800" }}>Send</Text> next to each student to open WhatsApp with a pre-filled absent notification.
          </Text>
        </View>

        <FlatList
          data={students}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 12, paddingBottom: Platform.OS === "ios" ? 80 : 60, gap: 8 }}
          renderItem={({ item }) => {
            const phone = normalizePhone(item.phone);
            const hasPhone = !!phone;
            return (
              <View style={[wm.row, !hasPhone && wm.rowNoPhone]}>
                {/* Avatar */}
                <View style={[wm.avatar, { backgroundColor: hasPhone ? "#fee2e2" : "#f1f5f9" }]}>
                  <Text style={[wm.avatarTxt, { color: hasPhone ? "#dc2626" : "#94a3b8" }]}>
                    {(item.name?.[0] ?? "?").toUpperCase()}
                  </Text>
                </View>

                {/* Info */}
                <View style={{ flex: 1 }}>
                  <Text style={wm.rowName}>{item.name}</Text>
                  <Text style={wm.rowSub}>
                    Roll #{item.rollNumber}
                    {phone ? `  ·  ${phone}` : "  ·  No phone on record"}
                  </Text>
                </View>

                {/* Send button */}
                {hasPhone ? (
                  <TouchableOpacity
                    style={wm.sendBtn}
                    onPress={() => openWa(item)}
                    activeOpacity={0.75}
                  >
                    <Feather name="send" size={13} color="#fff" />
                    <Text style={wm.sendTxt}>Send</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={wm.noPhoneTag}>
                    <Text style={wm.noPhoneTagTxt}>No phone</Text>
                  </View>
                )}
              </View>
            );
          }}
          ListHeaderComponent={withPhone.length > 1 ? (
            <View style={wm.bulkHint}>
              <Feather name="zap" size={13} color="#d97706" />
              <Text style={wm.bulkHintTxt}>
                {withPhone.length} parents to notify — tap Send for each one individually.
              </Text>
            </View>
          ) : null}
          ListFooterComponent={withoutPhone.length > 0 ? (
            <View style={wm.footerNote}>
              <Feather name="alert-circle" size={13} color="#94a3b8" />
              <Text style={wm.footerNoteTxt}>
                {withoutPhone.length} student{withoutPhone.length !== 1 ? "s" : ""} have no parent phone — update their profile to enable notifications.
              </Text>
            </View>
          ) : null}
        />

        {/* Close bar */}
        <View style={wm.closeBar}>
          <TouchableOpacity style={wm.closeBarBtn} onPress={onClose} activeOpacity={0.8}>
            <Feather name="check-circle" size={16} color="#fff" />
            <Text style={wm.closeBarTxt}>Done</Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AttendanceScreen() {
  const { user } = useContext(AuthContext);
  const isAdmin = ["admin", "owner"].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim()
  );

  const [classes,         setClasses]         = useState([]);
  const [sections,        setSections]        = useState([]);
  const [sessions,        setSessions]        = useState([]);
  const [branches,        setBranches]        = useState([]);
  const [selectedClass,   setSelectedClass]   = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [selectedBranch,  setSelectedBranch]  = useState("");
  const [date,            setDate]            = useState(new Date());
  const [showDatePicker,  setShowDatePicker]  = useState(false);
  const [students,        setStudents]        = useState([]);
  const [loading,         setLoading]         = useState(false);
  const [loadingSections, setLoadingSections] = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [toastMsg,        setToastMsg]        = useState("");

  // History matrix state
  const [histColumns,  setHistColumns]  = useState([]);
  const [histDayNames, setHistDayNames] = useState([]);
  const [histStudents, setHistStudents] = useState([]);
  const [histLoading,  setHistLoading]  = useState(false);

  // WhatsApp notification state
  const [showSaveSheet, setShowSaveSheet] = useState(false);
  const [saveSummary,   setSaveSummary]   = useState(null);
  const [waAbsent,      setWaAbsent]      = useState([]);
  const [showWaModal,   setShowWaModal]   = useState(false);
  const [schoolName,    setSchoolName]    = useState("");
  const [schoolPhone,   setSchoolPhone]   = useState("");

  const toastOpacity = useRef(new Animated.Value(0)).current;
  const cache        = useRef({});
  const histCache    = useRef({});

  const dateStr  = date.toISOString().split("T")[0];
  const cacheKey = `${selectedBranch}_${selectedSession}_${selectedClass}_${selectedSection}_${dateStr}`;

  const isPast = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const sel   = new Date(date); sel.setHours(0, 0, 0, 0);
    return sel < today;
  })();
  const isLocked = isPast && !isAdmin;

  // ── Load classes / sessions / branches ───────────────────────────────────
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const [cd, sd, bd] = await Promise.all([
          fetchClasses(user), fetchSessions(user), fetchBranches(user),
        ]);
        const cl = Array.isArray(cd) ? cd : cd?.data ?? [];
        const sl = Array.isArray(sd) ? sd : sd?.data ?? [];
        const bl = Array.isArray(bd) ? bd : bd?.data ?? [];
        setClasses(cl); setSessions(sl); setBranches(bl);
        if (cl.length > 0) setSelectedClass(String(cl[0].class_id));
        if (sl.length > 0) setSelectedSession(String(sl[0].session_id));
        if (bl.length > 0) setSelectedBranch(String(bl[0].branch_id));
      } catch {}
    })();
  }, []));

  // ── Load sections when class changes ─────────────────────────────────────
  useEffect(() => {
    if (!selectedClass) return;
    let cancelled = false;
    setLoadingSections(true);
    setSections([]); setSelectedSection("");
    fetchSections(user, selectedClass)
      .then(data => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.data ?? [];
        setSections(list);
        if (list.length > 0) setSelectedSection(String(list[0].section_id));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSections(false); });
    return () => { cancelled = true; };
  }, [selectedClass]);

  // ── Load students + history ───────────────────────────────────────────────
  useEffect(() => {
    if (!selectedClass || !selectedSection) {
      setStudents([]);
      setHistColumns([]); setHistDayNames([]); setHistStudents([]);
      return;
    }
    let cancelled = false;

    if (cache.current[cacheKey]) {
      setStudents(cache.current[cacheKey]);
    } else {
      setStudents([]);
      setLoading(true);
      fetchStudents(user, selectedClass, selectedSection, dateStr, selectedSession, selectedBranch)
        .then(data => {
          if (cancelled) return;
          const list = Array.isArray(data) ? data : data?.data ?? [];
          setStudents(list);
          cache.current[cacheKey] = list;
          if (data?.schoolName  != null) setSchoolName(data.schoolName);
          if (data?.schoolPhone != null) setSchoolPhone(data.schoolPhone);
          console.log('[AttendanceScreen] school info:', { name: data?.schoolName, phone: data?.schoolPhone });
        })
        .catch(e => { console.error('[AttendanceScreen] fetch error:', e?.message ?? e); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    const histKey = `${selectedClass}_${selectedSection}_${selectedBranch}_${selectedSession}`;
    if (histCache.current[histKey]) {
      const c = histCache.current[histKey];
      setHistColumns(c.columns); setHistDayNames(c.dayNames); setHistStudents(c.students);
    } else {
      setHistLoading(true);
      setHistColumns([]); setHistDayNames([]); setHistStudents([]);
      fetchRecentAttendance(user, {
        classId:   selectedClass,
        sectionId: selectedSection,
        branchId:  selectedBranch,
        sessionId: selectedSession,
        days:      10,
      })
        .then(res => {
          if (cancelled) return;
          const data = {
            columns:  res.columns  ?? [],
            dayNames: res.dayNames ?? [],
            students: res.students ?? [],
          };
          histCache.current[histKey] = data;
          setHistColumns(data.columns);
          setHistDayNames(data.dayNames);
          setHistStudents(data.students);
        })
        .catch(e => { console.warn("[Attendance] history error:", e.message); })
        .finally(() => { if (!cancelled) setHistLoading(false); });
    }

    return () => { cancelled = true; };
  }, [selectedClass, selectedSection, selectedBranch, selectedSession, dateStr]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const showToast = (msg) => {
    setToastMsg(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const updateStatus = useCallback((rollNumber, status) => {
    if (isLocked) return;
    setStudents(prev => prev.map(s =>
      String(s.rollNumber ?? s.roll_no) === String(rollNumber) ? { ...s, status } : s
    ));
  }, [isLocked]);

  const markAll = (status) => {
    if (isLocked) return;
    setStudents(prev => prev.map(s => ({ ...s, status })));
  };

  const handleSave = async () => {
    if (saving || isLocked || !students.length) return;
    try {
      setSaving(true);
      await saveAttendance(user, {
        class_id:   selectedClass,
        section_id: selectedSection,
        branch_id:  selectedBranch,
        session_id: selectedSession,
        date:       dateStr,
        attendance: students.map(s => ({
          id:         s.id,
          status:     s.status,
          rollNumber: s.rollNumber ?? s.roll_no,
        })),
      });
      cache.current[cacheKey] = students;

      // Refresh history cache
      const histKey = `${selectedClass}_${selectedSection}_${selectedBranch}_${selectedSession}`;
      delete histCache.current[histKey];
      setHistLoading(true);
      setHistColumns([]); setHistDayNames([]); setHistStudents([]);
      fetchRecentAttendance(user, {
        classId:   selectedClass,
        sectionId: selectedSection,
        branchId:  selectedBranch,
        sessionId: selectedSession,
        days:      10,
      }).then(res => {
        const data = {
          columns:  res.columns  ?? [],
          dayNames: res.dayNames ?? [],
          students: res.students ?? [],
        };
        histCache.current[histKey] = data;
        setHistColumns(data.columns);
        setHistDayNames(data.dayNames);
        setHistStudents(data.students);
      }).catch(() => {}).finally(() => setHistLoading(false));

      // Build absent list for WhatsApp
      const P = students.filter(s => s.status === "P").length;
      const A = students.filter(s => s.status === "A").length;
      const L = students.filter(s => s.status === "L").length;

      const absentList = students
        .filter(s => s.status === "A")
        .map(s => ({
          name:       `${s.firstName ?? s.student_first_name ?? ""}${s.lastName ? " " + s.lastName : ""}`.trim(),
          rollNumber: s.rollNumber ?? s.roll_no ?? "",
          phone:      s.parent_phone ?? "",
          medium:     s.medium ?? "",   // enrolled language (course_medium)
        }));

      setWaAbsent(absentList);
      setSaveSummary({ P, A, L, total: students.length });
      setShowSaveSheet(true);

    } catch {
      showToast("Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  // ── WhatsApp message builder — multilingual ───────────────────────────────
  // Language selection based on student's enrolled medium (course_medium):
  //   Hindi            → Hindi message
  //   Urdu / Arabic    → Urdu message
  //   Everything else  → English (default)
  const buildWaMessage = useCallback((student) => {
    const cls  = classes.find(c  => String(c.class_id)   === selectedClass)?.class_name   ?? "";
    const sec  = sections.find(s => String(s.section_id) === selectedSection)?.section_name ?? "";
    const loc  = [cls, sec].filter(Boolean).join(" / ");
    const schoolEn = schoolName ? `\n\n${schoolName}${schoolPhone ? `\nContact: ${schoolPhone}` : ''}` : '';
    const schoolHi = schoolName ? `\n\n${schoolName}${schoolPhone ? `\nसंपर्क: ${schoolPhone}` : ''}` : '';
    const schoolUr = schoolName ? `\n\n${schoolName}${schoolPhone ? `\nرابطہ: ${schoolPhone}` : ''}` : '';

    // Build date strings manually per language to avoid BiDi reordering inside RTL text
    const day   = date.getDate();
    const month = date.getMonth(); // 0-indexed
    const year  = date.getFullYear();
    const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const HI_MONTHS = ['जनवरी','फ़रवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितम्बर','अक्टूबर','नवम्बर','दिसम्बर'];
    const UR_MONTHS = ['جنوری','فروری','مارچ','اپریل','مئی','جون','جولائی','اگست','ستمبر','اکتوبر','نومبر','دسمبر'];
    const dEn = `${String(day).padStart(2, '0')} ${EN_MONTHS[month]} ${year}`;
    const dHi = `${day} ${HI_MONTHS[month]} ${year}`;
    const dUr = `${day} ${UR_MONTHS[month]} ${year}`;

    const med = (student.medium ?? "").toLowerCase().trim();
    const isHindi = med.includes("hindi");
    const isUrdu  = med.includes("urdu") || med.includes("arabic");

    if (isHindi) {
      const rollH = student.rollNumber ? ` (रोल नं. ${student.rollNumber})` : "";
      const ctxH  = loc ? ` — ${loc}` : "";
      return (
        `प्रिय अभिभावक/संरक्षक,\n\n` +
        `यह सूचित किया जाता है कि आपका बच्चा *${student.name}*${rollH}${ctxH} ` +
        `दिनांक ${dHi} को *अनुपस्थित* रहा/रही।\n\n` +
        `कृपया नियमित एवं समयपूर्वक उपस्थिति सुनिश्चित करें।\n\n` +
        `धन्यवाद,${schoolHi}`
      );
    }

    if (isUrdu) {
      const rollU = student.rollNumber ? ` (رول نمبر ${student.rollNumber})` : "";
      const ctxU  = loc ? ` — ${loc}` : "";
      return (
        `محترم والدین/سرپرست،\n\n` +
        `یہ اطلاع دی جاتی ہے کہ آپ کا بچہ *${student.name}*${rollU}${ctxU} ` +
        `تاریخ ${dUr} کو *غیر حاضر* رہا۔\n\n` +
        `براہ کرم باقاعدہ اور وقت پر حاضری یقینی بنائیں۔\n\n` +
        `شکریہ،${schoolUr}`
      );
    }

    // English (default)
    const roll = student.rollNumber ? ` (Roll #${student.rollNumber})` : "";
    const ctx  = loc ? ` — ${loc}` : "";
    return (
      `Dear Parent/Guardian,\n\n` +
      `This is to inform you that your child *${student.name}*${roll}${ctx} ` +
      `was marked *ABSENT* on ${dEn}.\n\n` +
      `Please ensure regular and timely attendance.\n\n` +
      `Thank you,${schoolEn}`
    );
  }, [classes, sections, selectedClass, selectedSection, date, schoolName, schoolPhone]);

  // ── Labels ────────────────────────────────────────────────────────────────
  const summary = {
    P: students.filter(s => s.status === "P").length,
    A: students.filter(s => s.status === "A").length,
    L: students.filter(s => s.status === "L").length,
  };
  const pct = students.length
    ? Math.round((summary.P / students.length) * 100) : 0;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sel   = new Date(date); sel.setHours(0, 0, 0, 0);
  const isToday   = sel.getTime() === today.getTime();
  const dateLabel = isToday
    ? "Today"
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const classLabel = (() => {
    const cn = classes.find(c  => String(c.class_id)   === selectedClass)?.class_name   ?? "";
    const sn = sections.find(s => String(s.section_id) === selectedSection)?.section_name ?? "";
    return [cn, sn].filter(Boolean).join(" / ");
  })();

  const showHistory = !!(selectedClass && selectedSection) && (histLoading || histColumns.length > 0);

  const waCount      = waAbsent.filter(s => normalizePhone(s.phone)).length;
  const noPhoneCount = waAbsent.filter(s => !normalizePhone(s.phone)).length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>

      {/* ── Filters card ── */}
      <View style={sc.filtersCard}>
        <View style={sc.filterGrid}>
          <View style={sc.filterCell}>
            <Text style={sc.filterLabel}>Branch</Text>
            <Dropdown label="Branch" value={selectedBranch}
              options={branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) }))}
              onChange={setSelectedBranch} disabled={loading} />
          </View>
          <View style={sc.filterCell}>
            <Text style={sc.filterLabel}>Session</Text>
            <Dropdown label="Session" value={selectedSession}
              options={[{ label: "All", value: "" }, ...sessions.map(s => ({ label: s.session_name ?? s.session_year ?? String(s.session_id), value: String(s.session_id) }))]}
              onChange={setSelectedSession} disabled={loading} />
          </View>
          <View style={sc.filterCell}>
            <Text style={sc.filterLabel}>Class</Text>
            <Dropdown label="Class" value={selectedClass}
              options={[{ label: "Select", value: "" }, ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) }))]}
              onChange={setSelectedClass} disabled={loading} />
          </View>
          <View style={sc.filterCell}>
            <Text style={sc.filterLabel}>Section</Text>
            <Dropdown label="Section" value={selectedSection}
              options={[{ label: "All", value: "" }, ...sections.map(s => ({ label: s.section_name, value: String(s.section_id) }))]}
              onChange={setSelectedSection} disabled={loading || loadingSections} loading={loadingSections} />
          </View>
        </View>

        <TouchableOpacity style={sc.dateRow} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
          <Feather name="calendar" size={13} color="#2563eb" />
          <Text style={sc.dateLabel}>Date:</Text>
          <Text style={sc.dateValue}>{dateLabel}</Text>
          <Feather name="chevron-down" size={13} color="#64748b" style={{ marginLeft: "auto" }} />
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={date} mode="date" maximumDate={new Date()}
            onChange={(e, d) => { setShowDatePicker(false); if (d) setDate(d); }}
          />
        )}
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Summary strip */}
        {students.length > 0 && (
          <View style={sc.summaryStrip}>
            {Object.entries(STATUS).map(([key, cfg]) => (
              <View key={key} style={[sc.summaryItem, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                <Text style={[sc.summaryCount, { color: cfg.color }]}>{summary[key]}</Text>
                <Text style={[sc.summaryLabel, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            ))}
            <View style={sc.summaryItem}>
              <Text style={sc.summaryCount}>{pct}%</Text>
              <Text style={sc.summaryLabel}>Present</Text>
            </View>
          </View>
        )}

        {/* Toolbar */}
        {students.length > 0 && !isLocked && (
          <View style={sc.toolbar}>
            <Text style={sc.toolbarLabel}>{students.length} students</Text>
            <View style={sc.toolbarActions}>
              {Object.entries(STATUS).map(([key, cfg]) => (
                <TouchableOpacity
                  key={key}
                  style={[sc.markAllBtn, { backgroundColor: cfg.bg, borderColor: cfg.border }]}
                  onPress={() => markAll(key)}
                >
                  <Text style={[sc.markAllTxt, { color: cfg.color }]}>All {cfg.short}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Lock banner */}
        {isLocked && (
          <View style={sc.lockBanner}>
            <Feather name="lock" size={14} color="#92400e" />
            <Text style={sc.lockTxt}>Past date — read only. Admin can edit.</Text>
          </View>
        )}

        {/* Student rows */}
        {loading ? (
          <View style={sc.loader}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={sc.loaderTxt}>Loading students…</Text>
          </View>
        ) : students.length === 0 && selectedClass && selectedSection ? (
          <View style={sc.emptyWrap}>
            <Feather name="users" size={40} color="#cbd5e1" />
            <Text style={sc.emptyTxt}>No students found</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 8, paddingTop: 6, gap: 4 }}>
            {students.map((item, idx) => (
              <View key={String(item.id ?? item.enrollmentId ?? idx)}>
                <StudentRow item={item} onUpdate={updateStatus} locked={isLocked} />
              </View>
            ))}
          </View>
        )}

        {/* Save button */}
        {students.length > 0 && (
          <View style={sc.saveWrap}>
            <TouchableOpacity
              style={[sc.saveBtn, (saving || isLocked) && sc.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving || isLocked}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Feather name={isLocked ? "lock" : "check"} size={18} color="#fff" />
                    <Text style={sc.saveTxt}>
                      {isLocked ? "Locked — Read Only" : "Save Attendance"}
                    </Text>
                  </>}
            </TouchableOpacity>
          </View>
        )}

        {/* 10-day history */}
        {showHistory && (
          <HistoryMatrix
            columns={histColumns}
            dayNames={histDayNames}
            students={histStudents}
            loading={histLoading}
          />
        )}
      </ScrollView>

      {/* Toast */}
      <Animated.View style={[sc.toast, { opacity: toastOpacity }]}>
        <Feather
          name={toastMsg.includes("Failed") ? "x-circle" : "check-circle"}
          size={16} color="#fff" style={{ marginRight: 8 }}
        />
        <Text style={sc.toastTxt}>{toastMsg}</Text>
      </Animated.View>

      {/* ── Save Success Sheet ── */}
      <SaveSuccessSheet
        visible={showSaveSheet}
        onClose={() => setShowSaveSheet(false)}
        onNotify={() => { setShowSaveSheet(false); setShowWaModal(true); }}
        summary={saveSummary}
        waCount={waCount}
        noPhoneCount={noPhoneCount}
        dateLabel={dateLabel}
        classLabel={classLabel}
      />

      {/* ── WhatsApp Notify Modal ── */}
      <WaNotifyModal
        visible={showWaModal}
        onClose={() => setShowWaModal(false)}
        students={waAbsent}
        dateLabel={dateLabel}
        classLabel={classLabel}
        buildMessage={buildWaMessage}
      />

    </SafeAreaView>
  );
}

// ── Screen styles ─────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#f8fafc" },

  filtersCard:     { backgroundColor: "#fff", paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  filterGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  filterCell:      { width: "47%" },
  filterLabel:     { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },

  dateRow:         { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  dateLabel:       { fontSize: 10, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" },
  dateValue:       { fontSize: 12, fontWeight: "700", color: "#0f172a" },

  summaryStrip:    { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 6, gap: 6, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  summaryItem:     { flex: 1, alignItems: "center", paddingVertical: 4, borderRadius: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0" },
  summaryCount:    { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  summaryLabel:    { fontSize: 8, fontWeight: "600", color: "#64748b", textTransform: "uppercase" },

  toolbar:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#f8fafc" },
  toolbarLabel:    { fontSize: 11, fontWeight: "600", color: "#64748b" },
  toolbarActions:  { flexDirection: "row", gap: 4 },
  markAllBtn:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  markAllTxt:      { fontSize: 10, fontWeight: "700" },

  lockBanner:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fffbeb", paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#fde68a" },
  lockTxt:         { fontSize: 11, color: "#92400e", fontWeight: "600" },

  loader:          { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  loaderTxt:       { color: "#64748b", fontSize: 14 },
  emptyWrap:       { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt:        { color: "#94a3b8", fontSize: 15, fontWeight: "600" },

  studentRow:      { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  avatar:          { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, marginRight: 8 },
  avatarTxt:       { fontSize: 12, fontWeight: "800" },
  studentInfo:     { flex: 1, marginRight: 6 },
  studentName:     { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  studentRoll:     { fontSize: 10, color: "#94a3b8" },
  statusBtns:      { flexDirection: "row", gap: 4 },
  statusBtn:       { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  statusBtnTxt:    { fontSize: 11, fontWeight: "800" },

  saveWrap:        { paddingHorizontal: 12, paddingVertical: 10 },
  saveBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 13, shadowColor: "#2563eb", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  saveBtnDisabled: { backgroundColor: "#94a3b8", shadowOpacity: 0 },
  saveTxt:         { fontSize: 13, fontWeight: "800", color: "#fff" },

  toast:           { position: "absolute", bottom: 24, left: 20, right: 20, backgroundColor: "#0f172a", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, flexDirection: "row", alignItems: "center", zIndex: 999 },
  toastTxt:        { color: "#fff", fontSize: 14, fontWeight: "600" },
});

// ── History matrix styles ─────────────────────────────────────────────────────
const hm = StyleSheet.create({
  card:       { margin: 10, marginTop: 14, backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0b1f4b", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  titleRow:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  title:      { fontSize: 12, fontWeight: "800", color: "#0f172a" },

  loadingBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 20, justifyContent: "center", margin: 10, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  loadingTxt: { fontSize: 12, color: "#64748b" },

  row:        { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  headerCell: { backgroundColor: "#f1f5f9", justifyContent: "center", alignItems: "center", borderRightWidth: 0.5, borderRightColor: "#e2e8f0", paddingVertical: 5 },
  headerTxt:  { fontSize: 9, fontWeight: "800", color: "#0b1f4b" },

  nameCell:   { justifyContent: "center", paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 2, borderRightColor: "#cbd5e1" },
  nameTxt:    { fontSize: 10, fontWeight: "700", color: "#0f172a" },
  enrollTxt:  { fontSize: 8, color: "#94a3b8", marginTop: 1 },

  dayCell:    { justifyContent: "center", alignItems: "center", paddingVertical: 5, borderRightWidth: 0.5, borderRightColor: "#e2e8f0" },
  dayAbbr:    { fontSize: 7, fontWeight: "600", color: "#64748b" },
  dayNum:     { fontSize: 9, fontWeight: "800", color: "#0b1f4b" },
  dayVal:     { fontSize: 9, fontWeight: "900" },

  totCell:    { justifyContent: "center", alignItems: "center", paddingHorizontal: 2, paddingVertical: 5, borderLeftWidth: 2, borderLeftColor: "#cbd5e1", backgroundColor: "#f8faff" },
  totTxt:     { fontSize: 9, fontWeight: "700", color: "#0b1f4b" },
  pctTxt:     { fontSize: 10, fontWeight: "900" },

  legend:     { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, padding: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", backgroundColor: "#fafafa" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendDot:  { width: 14, height: 14, borderRadius: 3, borderWidth: 1 },
  legendTxt:  { fontSize: 9, fontWeight: "700", color: "#374151" },
  legendNote: { fontSize: 8, color: "#94a3b8" },
});

// ── Dropdown styles ───────────────────────────────────────────────────────────
const dd = StyleSheet.create({
  trigger:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7 },
  disabled:        { opacity: 0.45 },
  triggerTxt:      { flex: 1, fontSize: 11, color: "#0f172a", fontWeight: "500" },
  placeholder:     { color: "#94a3b8" },
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:           { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:    { backgroundColor: "#eff6ff" },
  optionTxt:       { fontSize: 14, color: "#0f172a" },
  optionTxtActive: { color: "#2563eb", fontWeight: "700" },
});

// ── Save Success Sheet styles ─────────────────────────────────────────────────
const ss = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:          { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: Platform.OS === "ios" ? 36 : 24, paddingTop: 12 },
  handle:         { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },

  successHeader:  { alignItems: "center", marginBottom: 18 },
  checkCircle:    { width: 56, height: 56, borderRadius: 28, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center", marginBottom: 10, shadowColor: "#16a34a", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  successTitle:   { fontSize: 20, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  successSub:     { fontSize: 12, color: "#64748b", fontWeight: "500" },

  statsRow:       { flexDirection: "row", gap: 8, marginBottom: 18 },
  statChip:       { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12 },
  statNum:        { fontSize: 20, fontWeight: "900" },
  statLbl:        { fontSize: 9, fontWeight: "700", textTransform: "uppercase", marginTop: 2 },

  waBtn:          { flexDirection: "row", alignItems: "center", backgroundColor: "#f0fdf4", borderWidth: 1.5, borderColor: "#86efac", borderRadius: 14, padding: 14, marginBottom: 10, gap: 10 },
  waBtnIcon:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "#dcfce7", alignItems: "center", justifyContent: "center" },
  waBtnTitle:     { fontSize: 13, fontWeight: "800", color: "#0f172a" },
  waBtnSub:       { fontSize: 11, color: "#64748b", marginTop: 2 },

  noPhoneNote:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderRadius: 10, padding: 12, marginBottom: 10 },
  noPhoneTxt:     { fontSize: 12, color: "#64748b", flex: 1 },
  allPresentNote: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12, marginBottom: 10 },
  allPresentTxt:  { fontSize: 12, color: "#16a34a", fontWeight: "600", flex: 1 },

  doneBtn:        { backgroundColor: "#f1f5f9", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  doneTxt:        { fontSize: 14, fontWeight: "700", color: "#475569" },
});

// ── WhatsApp modal styles ─────────────────────────────────────────────────────
const wm = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  closeBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  headerTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  headerSub:     { fontSize: 11, color: "#64748b", marginTop: 1 },
  badge:         { backgroundColor: "#fee2e2", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt:      { fontSize: 13, fontWeight: "900", color: "#dc2626" },

  infoBanner:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#eff6ff", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#bfdbfe" },
  infoTxt:       { flex: 1, fontSize: 12, color: "#1d4ed8", lineHeight: 18 },

  row:           { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#e2e8f0", gap: 10, shadowColor: "#0b1f4b", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  rowNoPhone:    { opacity: 0.6 },
  avatar:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 16, fontWeight: "900" },
  rowName:       { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  rowSub:        { fontSize: 11, color: "#64748b", marginTop: 2 },

  sendBtn:       { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#25d366", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  sendTxt:       { fontSize: 12, fontWeight: "800", color: "#fff" },
  noPhoneTag:    { backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  noPhoneTagTxt: { fontSize: 11, color: "#94a3b8", fontWeight: "600" },

  bulkHint:      { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: "#fde68a" },
  bulkHintTxt:   { flex: 1, fontSize: 12, color: "#92400e" },

  footerNote:    { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "#f8fafc", borderRadius: 10, padding: 12, marginTop: 4 },
  footerNoteTxt: { flex: 1, fontSize: 12, color: "#94a3b8" },

  closeBar:      { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: Platform.OS === "ios" ? 32 : 16, paddingTop: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  closeBarBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0f172a", borderRadius: 12, paddingVertical: 13 },
  closeBarTxt:   { fontSize: 14, fontWeight: "800", color: "#fff" },
});
