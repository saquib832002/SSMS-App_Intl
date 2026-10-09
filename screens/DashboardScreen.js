import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Dimensions, RefreshControl, Modal, TextInput, Switch,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  FlatList, Linking, Image, Animated, Easing,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { useFeatureLock, LockBadge } from "../components/FeatureLock";
import { fetchDashboardMetrics } from "../services/DashboardServiceApi";
import { HOST_NAME } from "../Environment/EnvironmentConfig";
import {
  fetchUpcomingEvents, createEvent, updateEvent, deleteEvent,
} from "../services/SchoolEventsServiceApi";
import { fetchNotices } from "../services/NoticeServiceApi";
import {
  scheduleClassReminders,
  getLeadTime, saveLeadTime,
  getEnabled, setEnabled as saveEnabled,
  cancelAllReminders, DEFAULT_LEAD,
} from "../services/NotificationService";
import { fetchGalleryPhotos } from "../services/GalleryServiceApi";
import { fetchInstituteDetails } from "../services/UserServiceApi";

// ── Constants ─────────────────────────────────────────────────────────────────
const COLORS = [
  "#2f7ef5", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#f472b6", "#14b8a6", "#0b1f4b",
];
const EVENT_CATEGORIES = [
  "Sports", "Cultural", "Exam", "National Holiday",
  "Religious", "Academic", "Other",
];
const EVENT_TYPES    = ["event", "holiday"];
const MONTH_NAMES    = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];
const MONTH_SHORT    = ["Jan","Feb","Mar","Apr","May","Jun",
                        "Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_LABELS     = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (d) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const daysLeft = (dateStr) => {
  if (!dateStr) return null;
  const diff = Math.ceil(
    (new Date(dateStr + "T00:00:00") - new Date(new Date().toDateString())) / 86400000
  );
  if (diff < 0)  return null;
  if (diff === 0) return { label: "Today",    urgent: true  };
  if (diff === 1) return { label: "Tomorrow", urgent: true  };
  if (diff <= 3)  return { label: `In ${diff} days`, urgent: true  };
  return              { label: `In ${diff} days`, urgent: false };
};

const toYMD = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const parseYMD = (str) => {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return isNaN(y) ? null : { y, m: m - 1, d };
};

const today = () => new Date().toISOString().split("T")[0];

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const firstDayOfMonth = (y, m) => new Date(y, m, 1).getDay();

// ── NoticeTicker ──────────────────────────────────────────────────────────────
const TICKER_SPEED = 80; // px per second

function NoticeTicker({ notices, onPress }) {
  const x       = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);

  const label = (notices ?? [])
    .map(n => n.notice_title ?? n.title ?? "")
    .filter(Boolean)
    .join("     •     ") + "     •     ";

  const notice   = notices?.[0];
  const dotColor = notice?.priority === "urgent"    ? "#dc2626"
    : notice?.priority === "important" ? "#f59e0b" : "#7c3aed";

  // Start (or restart) a seamless infinite scroll using Animated.loop.
  // Called from onLayout whenever the measured text width is known.
  const startAnim = useCallback((w) => {
    if (animRef.current) animRef.current.stop();
    x.setValue(0);
    animRef.current = Animated.loop(
      Animated.timing(x, {
        toValue:         -w,                       // scroll one full label-width to the left
        duration:        (w / TICKER_SPEED) * 1000, // px/s → ms
        easing:          Easing.linear,
        useNativeDriver: false,
      })
    );
    animRef.current.start();
  }, [x]);

  // Stop animation on unmount
  useEffect(() => () => { if (animRef.current) animRef.current.stop(); }, []);

  if (!notices?.length) return null;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={tk.wrapper}>
      <View style={[tk.dot, { backgroundColor: dotColor }]} />
      <View style={tk.clip}>
        <Animated.View
          style={{ position: "absolute", transform: [{ translateX: x }] }}
        >
          {/* No fixed width — the View sizes to its content so onLayout returns
              the real text width, not the container's width. */}
          <Text
            style={tk.txt}
            numberOfLines={1}
            onLayout={e => {
              // layout.width = full width of "label + label"; half = one copy
              const w = Math.round(e.nativeEvent.layout.width / 2);
              if (w > 0) startAnim(w);
            }}
          >
            {label + label}
          </Text>
        </Animated.View>
      </View>
      <Feather name="chevron-right" size={12} color="#7c3aed" style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}

// ── CalendarPicker ─────────────────────────────────────────────────────────────
function CalendarPicker({ visible, onClose, value, onChange, title = "Select Date", minDate }) {
  const todayStr = today();
  const parsed   = parseYMD(value) ?? parseYMD(todayStr);

  const [viewYear,  setViewYear]  = useState(parsed?.y  ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.m  ?? new Date().getMonth());
  const [mode,      setMode]      = useState("days"); // "days" | "months" | "years"

  // Sync view to value whenever picker opens
  useEffect(() => {
    if (visible) {
      const p = parseYMD(value) ?? parseYMD(todayStr);
      setViewYear(p.y);
      setViewMonth(p.m);
      setMode("days");
    }
  }, [visible]);

  const minParsed = parseYMD(minDate);

  const isDisabled = (y, m, d) => {
    if (!minParsed) return false;
    if (y < minParsed.y) return true;
    if (y === minParsed.y && m < minParsed.m) return true;
    if (y === minParsed.y && m === minParsed.m && d < minParsed.d) return true;
    return false;
  };

  const selectDay = (d) => {
    onChange(toYMD(viewYear, viewMonth, d));
    onClose();
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // Build day cells
  const totalDays  = daysInMonth(viewYear, viewMonth);
  const startDay   = firstDayOfMonth(viewYear, viewMonth);
  const cells      = [];
  for (let i = 0; i < startDay; i++)      cells.push(null);
  for (let d = 1; d <= totalDays; d++)    cells.push(d);
  // pad to full rows
  while (cells.length % 7 !== 0)          cells.push(null);

  // Years grid: ±12 from current view year
  const yearList = [];
  for (let y = viewYear - 12; y <= viewYear + 12; y++) yearList.push(y);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cal.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={cal.sheet}>

          {/* ── Title ── */}
          <View style={cal.titleRow}>
            <Text style={cal.titleTxt}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={cal.closeBtn}>
              <Feather name="x" size={14} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* ── Nav header ── */}
          <View style={cal.navRow}>
            <TouchableOpacity style={cal.navArrow} onPress={mode === "years" ? () => setViewYear(y => y - 10) : prevMonth}>
              <Feather name="chevron-left" size={18} color="#1e40af" />
            </TouchableOpacity>

            <View style={cal.navCenter}>
              {mode === "years" ? (
                <Text style={cal.navYearTxt}>{viewYear - 12} – {viewYear + 12}</Text>
              ) : (
                <>
                  <TouchableOpacity onPress={() => setMode(mode === "months" ? "days" : "months")} style={cal.navMonthBtn}>
                    <Text style={cal.navMonthTxt}>{MONTH_NAMES[viewMonth]}</Text>
                    <Feather name={mode === "months" ? "chevron-up" : "chevron-down"} size={12} color="#1e40af" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setMode(mode === "years" ? "days" : "years")} style={cal.navYearBtn}>
                    <Text style={cal.navYearSmTxt}>{viewYear}</Text>
                    <Feather name={mode === "years" ? "chevron-up" : "chevron-down"} size={11} color="#64748b" />
                  </TouchableOpacity>
                </>
              )}
            </View>

            <TouchableOpacity style={cal.navArrow} onPress={mode === "years" ? () => setViewYear(y => y + 10) : nextMonth}>
              <Feather name="chevron-right" size={18} color="#1e40af" />
            </TouchableOpacity>
          </View>

          {/* ── Month grid ── */}
          {mode === "months" && (
            <View style={cal.monthGrid}>
              {MONTH_SHORT.map((mn, idx) => {
                const isCur = idx === viewMonth;
                return (
                  <TouchableOpacity key={mn} style={[cal.monthCell, isCur && cal.monthCellSel]}
                    onPress={() => { setViewMonth(idx); setMode("days"); }}>
                    <Text style={[cal.monthCellTxt, isCur && cal.monthCellSelTxt]}>{mn}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* ── Year grid ── */}
          {mode === "years" && (
            <FlatList
              data={yearList}
              keyExtractor={y => String(y)}
              numColumns={4}
              style={{ maxHeight: 220 }}
              renderItem={({ item: y }) => {
                const isCur = y === viewYear;
                return (
                  <TouchableOpacity style={[cal.yearCell, isCur && cal.yearCellSel]}
                    onPress={() => { setViewYear(y); setMode("days"); }}>
                    <Text style={[cal.yearCellTxt, isCur && cal.yearCellSelTxt]}>{y}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {/* ── Day grid ── */}
          {mode === "days" && (
            <>
              {/* Day-of-week header */}
              <View style={cal.dowRow}>
                {DAY_LABELS.map(dl => (
                  <Text key={dl} style={cal.dowTxt}>{dl}</Text>
                ))}
              </View>

              {/* Day cells */}
              <View style={cal.daysGrid}>
                {cells.map((d, i) => {
                  if (!d) return <View key={`e${i}`} style={cal.dayCell} />;
                  const ymd      = toYMD(viewYear, viewMonth, d);
                  const isSel    = ymd === value;
                  const isToday  = ymd === todayStr;
                  const disabled = isDisabled(viewYear, viewMonth, d);
                  return (
                    <TouchableOpacity
                      key={ymd}
                      style={[cal.dayCell, isSel && cal.dayCellSel, isToday && !isSel && cal.dayCellToday, disabled && cal.dayCellDis]}
                      onPress={() => !disabled && selectDay(d)}
                      disabled={disabled}
                    >
                      <Text style={[cal.dayCellTxt, isSel && cal.dayCellSelTxt, isToday && !isSel && cal.dayCellTodayTxt, disabled && cal.dayCellDisTxt]}>
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Selected display ── */}
          {value ? (
            <Text style={cal.selectedTxt}>Selected: {fmt(value)}</Text>
          ) : null}

        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── DateField — tappable date button ─────────────────────────────────────────
function DateField({ label, required, value, onChange, minDate, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text style={st.fLabel}>
        {label}{required && <Text style={{ color: "#ef4444" }}> *</Text>}
      </Text>
      <TouchableOpacity
        style={[st.datePicker, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <Feather name="calendar" size={14} color={value ? "#1e40af" : "#94a3b8"} />
        <Text style={[st.datePickerTxt, !value && st.datePickerPh]}>
          {value ? fmt(value) : "Tap to pick date"}
        </Text>
        {value && (
          <TouchableOpacity onPress={() => !disabled && onChange("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x-circle" size={14} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      <CalendarPicker
        visible={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={(v) => { onChange(v); setOpen(false); }}
        title={label}
        minDate={minDate}
      />
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function DashboardScreen({ navigation }) {
  const { user, hasModule } = useContext(AuthContext);
  const { isLocked, guard } = useFeatureLock();
  // Subscription schools see paid modules WITH a lock icon instead of hiding them
  const showPaid = (key) => hasModule(key) || user?.billingModel === "subscription";
  const isAdmin  = ["admin", "owner"].includes((user?.ssmsUserRole ?? user?.role ?? "").toLowerCase());
  const canManage = ["admin", "owner", "user"].includes((user?.ssmsUserRole ?? user?.role ?? "").toLowerCase());

  const [metrics,    setMetrics]    = useState({ students: 0, teachers: 0, branches: 0, classes: 0, sections: 0, attendance: 0 });
  const [schoolName, setSchoolName] = useState("");
  const [schoolLogo, setSchoolLogo] = useState("");
  const [events,     setEvents]     = useState([]);
  const [evLoading,  setEvLoading]  = useState(false);
  const [evError,    setEvError]    = useState("");
  const [notices,    setNotices]    = useState([]);
  const [gallery,       setGallery]       = useState([]);
  const [communityLink, setCommunityLink] = useState(null);
  const [channelLink,   setChannelLink]   = useState(null);
  const [refreshing,    setRefreshing]    = useState(false);
  const screenWidth = Dimensions.get("window").width;

  // ── Notification state (teacher/user roles only) ───────────────────────────
  const userRole  = (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase();
  const isTeacher = ["user", "teacher"].includes(userRole) || !!(user?.staffId);

  // ── Module-based quick actions ────────────────────────────────────────────
  const quickModules = useMemo(() => {
    const r       = userRole;
    const isAdm   = ["admin", "owner"].includes(r);
    const isStaff = ["admin", "owner", "user"].includes(r);
    const isFin   = ["admin", "owner", "accountant"].includes(r);
    // nav() opens the screen; .target = the real screen name (for lock icons)
    const go      = (screen, params) => {
      const nav = () => navigation.navigate(screen, params);
      nav.target = params?.screen ?? screen;
      return nav;
    };

    return [
      {
        key: "students", label: "Students", icon: "school",
        color: "#1d4ed8", bg: "#eff6ff", show: isStaff,
        links: [
          isStaff && { icon: "person-add",     label: "Add Student",  nav: go("School", { screen: "Registration"        }) },
          isStaff && { icon: "group",           label: "Students",     nav: go("School", { screen: "StudentsList"        }) },
          isStaff && { icon: "how-to-reg",      label: "Enrollment",   nav: go("School", { screen: "EnrolledStudents"    }) },
          (isStaff && !isAdm) && { icon: "calendar-view-day", label: "My Classes", nav: go("Setup",  { screen: "TeacherTimetable"   }) },
          isAdm   && { icon: "badge",           label: "ID Cards",     nav: go("School", { screen: "StudentIdCard"       }) },
          isAdm   && { icon: "manage-accounts", label: "Accounts",     nav: go("School", { screen: "StudentUserAccounts" }) },
        ].filter(Boolean),
      },
      {
        key: "attendance", label: "Attendance", icon: "fact-check",
        color: "#15803d", bg: "#f0fdf4", show: isStaff,
        links: [
          isStaff && { icon: "check-circle", label: "Mark Attend.", nav: go("School",          { screen: "Attendance" }) },
          isStaff && { icon: "bar-chart",    label: "Report",       nav: go("AttendanceReport"                        ) },
          !isAdm  && { icon: "person",       label: "My Attendance",nav: go("MyAttendance"                            ) },
        ].filter(Boolean),
      },
      {
        key: "examination", label: "Examination", icon: "assignment",
        color: "#7c3aed", bg: "#f5f3ff", show: isStaff,
        links: [
          isAdm   && { icon: "list-alt",     label: "Exams",       nav: go("School", { screen: "Exam"              }) },
          isStaff && { icon: "edit",         label: "Enter Marks", nav: go("School", { screen: "AddMarks"          }) },
          isStaff && { icon: "description",  label: "Marksheet",   nav: go("School", { screen: "GenerateMarksheet" }) },
          isAdm   && { icon: "emoji-events", label: "Rankings",    nav: go("School", { screen: "ExamResultsRank"   }) },
          isStaff && { icon: "quiz",         label: "Quick Test",  nav: go("School", { screen: "QuickTestSetup"    }) },
          isStaff && { icon: "book",         label: "Homework",    nav: go("School", { screen: "Homework"          }) },
        ].filter(Boolean),
      },
      isFin && {
        key: "finance", label: "Finance", icon: "account-balance-wallet",
        color: "#059669", bg: "#ecfdf5",
        links: [
          { icon: "payment",   label: "Fee Collection", nav: go("School", { screen: "FeeCollection"        }) },
          { icon: "receipt",   label: "Fee Items",      nav: go("School", { screen: "FeeItem"               }) },
          isAdm && { icon: "discount", label: "Discount",       nav: go("School", { screen: "StudentDiscount"       }) },
          isAdm && { icon: "task-alt", label: "Approval",       nav: go("School", { screen: "FeeCollectionApproval" }) },
        ].filter(Boolean),
      },
      isStaff && {
        key: "timetable", label: "Timetable", icon: "event-note",
        color: "#b45309", bg: "#fffbeb",
        links: [
          isAdm  && { icon: "table-chart", label: "Timetable", nav: go("Setup", { screen: "Timetable"       }) },
          isAdm  && { icon: "schedule",    label: "Master TT", nav: go("Setup", { screen: "MasterTimetable" }) },
          isAdm  && { icon: "timer",             label: "Periods",    nav: go("Setup", { screen: "PeriodSetup"      }) },
        ].filter(Boolean),
      },
      isAdm && {
        key: "staff", label: "Staff & HR", icon: "people",
        color: "#4338ca", bg: "#eef2ff",
        links: [
          { icon: "person-add", label: "Add Staff",    nav: go("School", { screen: "StaffRegistration" }) },
          { icon: "groups",     label: "Hired Staff",  nav: go("School", { screen: "HiredStaff"        }) },
          { icon: "work",       label: "Categories",   nav: go("Setup",  { screen: "StaffCategory"     }) },
          { icon: "school",     label: "Sub. Teacher", nav: go("School", { screen: "SubjectTeacher"    }) },
        ],
      },
      isAdm && showPaid("hostel") && {
        key: "hostel", label: "Hostel", icon: "hotel",
        color: "#0369a1", bg: "#f0f9ff",
        links: [
          { icon: "apartment",  label: "Buildings",  nav: go("Hostel", { screen: "HostelBuildings" }) },
          { icon: "door-front", label: "Rooms",      nav: go("Hostel", { screen: "HostelRooms"     }) },
          { icon: "how-to-reg", label: "Enrollment", nav: go("Hostel", { screen: "HostelEnrollment"}) },
          { icon: "payment",    label: "Hostel Fee", nav: go("Hostel", { screen: "HostelFee"       }) },
        ],
      },
      (isAdm || isFin) && {
        key: "setup", label: "Setup", icon: "settings",
        color: "#475569", bg: "#f8fafc",
        links: [
          isAdm && { icon: "corporate-fare",  label: "School",       nav: go("Setup", { screen: "SchoolSettings"       }) },
          isAdm && { icon: "account-tree",    label: "Branch",       nav: go("Setup", { screen: "BranchSetup"          }) },
          isAdm && { icon: "class",           label: "Classes",      nav: go("Setup", { screen: "ClassSetup"           }) },
          isAdm && { icon: "subject",         label: "Subjects",     nav: go("Setup", { screen: "SubjectSetup"         }) },
          isAdm && { icon: "manage-accounts", label: "Users",        nav: go("Setup", { screen: "UserSetup"            }) },
          { icon: "monetization-on",          label: "Fee Struct",   nav: go("Setup", { screen: "ClassFeeStructure"    }) },
          { icon: "receipt-long",             label: "Fee Items",    nav: go("School", { screen: "FeeItem"             }) },
          isAdm && showPaid("hostel") && { icon: "hotel",            label: "Hostel Fee", nav: go("Setup", { screen: "HostelFeeStructure"    }) },
          isAdm && showPaid("transport") && { icon: "directions-bus", label: "Trans. Fee", nav: go("Setup", { screen: "TransportFeeStructure" }) },
        ].filter(Boolean),
      },
    ].filter(m => m && m.show !== false && m.links && m.links.length > 0);
  }, [userRole, hasModule, navigation, user?.billingModel]);
  const [leadMins,        setLeadMins]        = useState(DEFAULT_LEAD);
  const [notifEnabled,    setNotifEnabled]    = useState(true);
  const [notifSettingsVis,setNotifSettingsVis]= useState(false);
  const [savingNotif,     setSavingNotif]     = useState(false);

  // ── Event modal state ─────────────────────────────────────────────────────
  const [modal,    setModal]    = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [title,    setTitle]    = useState("");
  const [evType,   setEvType]   = useState("event");
  const [category, setCategory] = useState("");
  const [evDate,   setEvDate]   = useState(today());
  const [endDate,  setEndDate]  = useState("");
  const [desc,     setDesc]     = useState("");
  const [color,    setColor]    = useState(COLORS[0]);
  const [isPublic, setIsPublic] = useState(true);

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadDashboard = useCallback(async () => {
    if (!user) return;
    if (!user?.token) return;
    try {
      const data = await fetchDashboardMetrics(user);
      setMetrics({
        students:   data?.students   || 0,
        teachers:   data?.teachers   || 0,
        branches:   data?.branches   || 0,
        classes:    data?.classes    || 0,
        sections:   data?.sections   || 0,
        attendance: data?.attendance || 0,
      });
      if (data?.schoolName) setSchoolName(data.schoolName);
      if (data?.logoName) {
        const base = HOST_NAME.endsWith("/") ? HOST_NAME : HOST_NAME + "/";
        setSchoolLogo(`${base}clients/${user?.ssmsClientCode ?? ""}/${data.logoName}`);
              //console.log("Dashboard metrics loaded:", data.logoName);

      }
    } catch (e) { console.log("Dashboard error:", e); }
  }, [user]);

  const loadEvents = useCallback(async () => {
    if (!user) return;
    if (!user?.token) return;
    // Subscription schools without the Notice Board & Events module: skip
    if (!hasModule("notices")) { setEvents([]); setEvLoading(false); return; }
    try {
      setEvLoading(true);
      setEvError("");
      const data = await fetchUpcomingEvents(user, 20);
      setEvents(data);
    } catch (e) {
      console.log("Events error:", e);
      setEvError(e.message || "Failed to load events");
    } finally { setEvLoading(false); }
  }, [user, hasModule]);

  const loadNotices = useCallback(async () => {
    if (!user) return;
    if (!user?.token) return;
    if (hasModule("notices")) {
      try {
        const data = await fetchNotices(user, { limit: 5 });
        setNotices(data);
      } catch (e) { console.log("Notices error:", e); }
    } else {
      setNotices([]);
    }
    // Gallery preview (non-critical — silent fail)
    if (hasModule("communication")) {
      fetchGalleryPhotos(user).then(({ photos }) => setGallery(photos.slice(0, 6))).catch(() => {});
    } else {
      setGallery([]);
    }
    // WhatsApp community + channel links (non-critical — silent fail)
    fetchInstituteDetails(user)
      .then(d => {
        setCommunityLink(d?.whatsapp_community_link || null);
        setChannelLink(d?.whatsapp_channel_link || null);
      })
      .catch(() => {});
  }, [user, hasModule]);

  useEffect(() => { loadDashboard(); loadEvents(); loadNotices(); }, [loadDashboard, loadEvents, loadNotices]);

  // ── Load notification prefs once ───────────────────────────────────────────
  useEffect(() => {
    if (!isTeacher) return;
    Promise.all([getLeadTime(), getEnabled()]).then(([mins, en]) => {
      setLeadMins(mins);
      setNotifEnabled(en);
    });
  }, [isTeacher]);

  // ── Schedule class reminders every time the screen gains focus ────────────
  useFocusEffect(
    useCallback(() => {
      if (!isTeacher || !notifEnabled) return;
      scheduleClassReminders(user, leadMins).catch(() => {});
    }, [isTeacher, notifEnabled, leadMins, user])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadDashboard(), loadEvents(), loadNotices()]);
    setRefreshing(false);
  }, [loadDashboard, loadEvents, loadNotices]);

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setTitle(""); setEvType("event"); setCategory("");
    setEvDate(today()); setEndDate(""); setDesc("");
    setColor(COLORS[0]); setIsPublic(true);
    setModal(true);
  };

  const openEdit = (ev) => {
    setEditing(ev);
    setTitle(ev.event_title ?? "");
    setEvType(ev.event_type ?? "event");
    setCategory(ev.event_category ?? "");
    setEvDate(ev.event_date?.split(" ")[0] ?? today());
    setEndDate(ev.event_end_date?.split(" ")[0] ?? "");
    setDesc(ev.event_description ?? "");
    setColor(ev.event_color ?? COLORS[0]);
    setIsPublic(ev.is_public == 1);
    setModal(true);
  };

  const handleSave = async () => {
    if (!title.trim()) { Alert.alert("Required", "Event title is required."); return; }
    if (!evDate)       { Alert.alert("Required", "Event date is required.");  return; }
    try {
      setSaving(true);
      const payload = {
        event_title:       title.trim(),
        event_type:        evType,
        event_category:    category,
        event_date:        evDate,
        event_end_date:    endDate || null,
        event_description: desc.trim(),
        event_color:       color,
        is_public:         isPublic ? 1 : 0,
        created_by:        user?.ssmsUserName ?? "",
      };
      if (editing) await updateEvent(user, editing.event_id, payload);
      else         await createEvent(user, payload);
      setModal(false);
      loadEvents();
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save event.");
    } finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert("Delete Event", `Delete "${editing?.event_title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            setSaving(true);
            await deleteEvent(user, editing.event_id);
            setModal(false);
            loadEvents();
          } catch (e) {
            Alert.alert("Error", e.message || "Failed to delete.");
          } finally { setSaving(false); }
        },
      },
    ]);
  };

  return (
    <>
      <ScrollView
        style={st.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={["#1e40af"]} tintColor="#1e40af" />
        }
      >
        {/* Hero */}
        {/* <LinearGradient colors={["#1e3a8a", "#1e40af"]} style={st.hero}>
          <Text style={st.heroTitle}>Inspire. Learn. Grow.</Text>
          <Text style={st.heroSub}>Building global citizens for tomorrow</Text>
          <TouchableOpacity style={st.heroBtn} onPress={() => Linking.openURL("https://managemyacademy.com/")}>
            <Text style={st.heroBtnText}>Explore</Text>
          </TouchableOpacity>
        </LinearGradient> */}

        {/* School Identity */}
        {(schoolLogo || schoolName) ? (
          <View style={st.schoolCard}>
            {schoolLogo ? (
              <TouchableOpacity
                onPress={() => Linking.openURL("https://managemyacademy.com/login")}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: schoolLogo }}
                  style={st.schoolLogo}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            ) : null}
            {schoolName ? (
              <Text style={st.schoolNameTxt}>{schoolName}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Notice Ticker */}
        {notices.length > 0 && (
          <NoticeTicker
            notices={notices.slice(0, 5)}
            onPress={() => navigation.navigate("NoticeBoard")}
          />
        )}

        {/* Stats */}
        <View style={st.grid}>
          <Stat icon="school"   label="Students" value={metrics.students}      colors={["#4f46e5","#6366f1"]} />
          <Stat icon="person"   label="Teachers" value={metrics.teachers}      colors={["#16a34a","#22c55e"]} />
          <Stat icon="business" label="Branches" value={metrics.branches}      colors={["#0ea5e9","#38bdf8"]} />
          <Stat icon="class"    label="Classes / Sec"  value={`${metrics.classes} / ${metrics.sections}`} colors={["#f59e0b","#fbbf24"]} />
        </View>

        {/* Attendance */}
        <View style={st.attCard}>
          {/* Title + percentage */}
          <View style={st.attHeader}>
            <View style={st.attTitleRow}>
              <MaterialIcons name="bar-chart" size={15} color="#1e40af" />
              <Text style={st.sectionTitle}>Attendance Overview</Text>
            </View>
            <Text style={st.attPct}>{metrics.attendance}%</Text>
          </View>
          {/* Progress bar */}
          <View style={st.attBarBg}>
            <View style={[st.attBarFill, { flex: metrics.attendance }]} />
            <View style={[st.attBarAbsent, { flex: Math.max(0, 100 - metrics.attendance) }]} />
          </View>
          {/* Legend */}
          <View style={st.attLegend}>
            <View style={st.attLegendItem}>
              <View style={[st.attDot, { backgroundColor: "#16a34a" }]} />
              <Text style={st.attLegendTxt}>Present {metrics.attendance}%</Text>
            </View>
            <View style={st.attLegendItem}>
              <View style={[st.attDot, { backgroundColor: "#f87171" }]} />
              <Text style={st.attLegendTxt}>Absent {Math.max(0, 100 - metrics.attendance)}%</Text>
            </View>
          </View>
        </View>

        {/* ── Module Quick Actions ── */}
        <View style={st.qaHeader}>
          <MaterialIcons name="flash-on" size={15} color="#1d4ed8" />
          <Text style={st.qaHeaderTxt}>Quick Actions</Text>
        </View>

        {quickModules.map(mod => (
          <View key={mod.key} style={[st.modCard, { borderLeftColor: mod.color }]}>
            {/* Module header */}
            <View style={st.modHeader}>
              <View style={[st.modIconWrap, { backgroundColor: mod.bg }]}>
                <MaterialIcons name={mod.icon} size={15} color={mod.color} />
              </View>
              <Text style={[st.modTitle, { color: mod.color }]}>{mod.label}</Text>
            </View>
            {/* Links grid */}
            <View style={st.modLinks}>
              {mod.links.map((link, i) => {
                const locked = isLocked(link.nav?.target);
                return (
                  <TouchableOpacity key={i} style={st.modLink} onPress={guard(link.nav?.target, link.nav)} activeOpacity={0.75}>
                    <View style={[st.modLinkIcon, { backgroundColor: mod.bg }]}>
                      <MaterialIcons name={link.icon} size={20} color={locked ? "#94a3b8" : mod.color} />
                      {locked && <LockBadge />}
                    </View>
                    <Text style={[st.modLinkTxt, locked && { color: "#94a3b8" }]} numberOfLines={2}>{link.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {/* Class reminder pill — teachers only */}
        {isTeacher && (
          <TouchableOpacity style={st.notifPill} onPress={() => setNotifSettingsVis(true)}>
            <Feather name={notifEnabled ? "bell" : "bell-off"} size={12} color={notifEnabled ? "#7c3aed" : "#94a3b8"} />
            <Text style={[st.notifPillTxt, !notifEnabled && { color: "#94a3b8" }]}>
              {notifEnabled ? `Class reminders: ${leadMins} min before` : "Class reminders: off"}
            </Text>
            <Feather name="settings" size={11} color="#94a3b8" />
          </TouchableOpacity>
        )}

        {/* Notification settings modal */}
        {isTeacher && (
          <Modal visible={notifSettingsVis} transparent animationType="fade" onRequestClose={() => setNotifSettingsVis(false)}>
            <View style={st.notifOverlay}>
              <View style={st.notifSheet}>
                <Text style={st.notifSheetTitle}>Class Reminder Settings</Text>
                <Text style={st.notifSheetSub}>Notify me before each period starts</Text>

                <View style={st.notifRow}>
                  <Text style={st.notifRowLabel}>Enable reminders</Text>
                  <Switch
                    value={notifEnabled}
                    onValueChange={async v => {
                      setNotifEnabled(v);
                      await saveEnabled(v);
                      if (!v) cancelAllReminders();
                    }}
                    trackColor={{ false: "#e2e8f0", true: "#7c3aed" }}
                    thumbColor="#fff"
                  />
                </View>

                {notifEnabled && (
                  <View style={st.notifRow}>
                    <Text style={st.notifRowLabel}>Minutes before period</Text>
                    <View style={st.notifStepper}>
                      {[2, 5, 10, 15].map(m => (
                        <TouchableOpacity
                          key={m}
                          style={[st.notifStep, leadMins === m && st.notifStepSel]}
                          onPress={() => setLeadMins(m)}
                        >
                          <Text style={[st.notifStepTxt, leadMins === m && st.notifStepSelTxt]}>{m}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                <View style={st.notifBtns}>
                  <TouchableOpacity style={st.notifCancelBtn} onPress={() => setNotifSettingsVis(false)}>
                    <Text style={st.notifCancelTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={st.notifSaveBtn}
                    disabled={savingNotif}
                    onPress={async () => {
                      setSavingNotif(true);
                      await saveLeadTime(leadMins);
                      if (notifEnabled) scheduleClassReminders(user, leadMins).catch(() => {});
                      setSavingNotif(false);
                      setNotifSettingsVis(false);
                    }}
                  >
                    {savingNotif
                      ? <ActivityIndicator size={14} color="#fff" />
                      : <Text style={st.notifSaveTxt}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {/* ── Notice Board Widget ── */}
        <View style={st.noticeCard}>
          <View style={st.noticeHead}>
            <View style={st.noticeHeadLeft}>
              <Feather name="bell" size={15} color="#7c3aed" />
              <Text style={st.noticeHeadTitle}>Notices &amp; Circulars</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate("NoticeBoard")} style={st.noticeViewAll}>
              <Text style={st.noticeViewAllTxt}>View All</Text>
              <Feather name="chevron-right" size={12} color="#7c3aed" />
            </TouchableOpacity>
          </View>
          {notices.length === 0 ? (
            <View style={st.noticeEmpty}>
              <Text style={st.noticeEmptyTxt}>No notices posted yet</Text>
            </View>
          ) : (
            notices.slice(0, 4).map((n, i) => {
              const dotColor = n.priority === "urgent" ? "#dc2626"
                : n.priority === "important" ? "#f59e0b" : "#3b82f6";
              return (
                <TouchableOpacity
                  key={String(n.notice_id)}
                  style={[st.noticeRow, i < notices.slice(0,4).length - 1 && st.noticeRowBorder]}
                  onPress={() => navigation.navigate("NoticeBoard")}
                  activeOpacity={0.7}
                >
                  <View style={[st.noticeDot, { backgroundColor: dotColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.noticeTitle} numberOfLines={1}>{n.title}</Text>
                    <Text style={st.noticeDate}>{n.category}  ·  {
                      (() => {
                        const dt = new Date(String(n.created_at ?? "").replace(" ", "T"));
                        return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                      })()
                    }</Text>
                  </View>
                  {n.is_pinned == 1 && <Feather name="bookmark" size={11} color="#b45309" />}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── School Memories Gallery widget ── */}
        {gallery.length > 0 && (
          <View style={st.galCard}>
            <View style={st.galHead}>
              <View style={st.galHeadLeft}>
                <Feather name="image" size={15} color="#db2777" />
                <Text style={st.galHeadTitle}>School Gallery</Text>
              </View>
              <TouchableOpacity style={st.galViewAll} onPress={() => navigation.navigate("SchoolMemories")} activeOpacity={0.7}>
                <Text style={st.galViewAllTxt}>See all</Text>
                <Feather name="chevron-right" size={12} color="#db2777" />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.galRow}>
              {gallery.map((p) => (
                <TouchableOpacity key={String(p.id)} onPress={() => navigation.navigate("SchoolMemories")} activeOpacity={0.85}>
                  <Image source={{ uri: p.url }} style={st.galThumb} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── WhatsApp Community banner — always visible; grayed when no link ── */}
        <TouchableOpacity
          style={st.waBanner}
          onPress={() => communityLink && Linking.openURL(communityLink).catch(() => {})}
          activeOpacity={communityLink ? 0.82 : 1}
          disabled={!communityLink}
        >
          <View style={st.waBannerIcon}>
            <Text style={st.waEmoji}>💬</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.waBannerTitle}>Join our WhatsApp Community</Text>
            <Text style={st.waBannerSub}>Stay updated with school announcements</Text>
          </View>
          <View style={[st.waJoinBtn, !communityLink && st.waBtnDisabled]}>
            <Text style={[st.waJoinTxt, !communityLink && st.waBtnDisabledTxt]}>Join</Text>
            <Feather name="arrow-right" size={12} color={communityLink ? "#fff" : "#94a3b8"} />
          </View>
        </TouchableOpacity>

        {/* ── WhatsApp Channel banner — always visible; grayed when no link ── */}
        <TouchableOpacity
          style={st.waChBanner}
          onPress={() => channelLink && Linking.openURL(channelLink).catch(() => {})}
          activeOpacity={channelLink ? 0.82 : 1}
          disabled={!channelLink}
        >
          <View style={st.waChBannerIcon}>
            <Text style={st.waEmoji}>📢</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.waChBannerTitle}>Follow our WhatsApp Channel</Text>
            <Text style={st.waChBannerSub}>Get school updates &amp; announcements</Text>
          </View>
          <View style={[st.waChFollowBtn, !channelLink && st.waBtnDisabled]}>
            <Text style={[st.waChFollowTxt, !channelLink && st.waBtnDisabledTxt]}>Follow</Text>
            <Feather name="arrow-right" size={12} color={channelLink ? "#fff" : "#94a3b8"} />
          </View>
        </TouchableOpacity>

        {/* ── Upcoming Events & Holidays ── */}
        <View style={st.evCard}>
          <View style={st.evHead}>
            <View style={st.evHeadLeft}>
              <Feather name="calendar" size={15} color="#2f7ef5" />
              <Text style={st.evHeadTitle}>Upcoming Events &amp; Holidays</Text>
            </View>
            {isAdmin && (
              <TouchableOpacity style={st.evAddBtn} onPress={openAdd}>
                <Feather name="plus" size={13} color="#2f7ef5" />
                <Text style={st.evAddBtnTxt}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {evLoading ? (
            <View style={st.evEmpty}><ActivityIndicator color="#2f7ef5" /></View>
          ) : evError ? (
            <View style={st.evEmpty}>
              <Feather name="alert-circle" size={28} color="#ef4444" />
              <Text style={[st.evEmptyTxt, { color: "#ef4444" }]}>{evError}</Text>
              <TouchableOpacity style={st.evEmptyAdd} onPress={loadEvents}>
                <Text style={st.evEmptyAddTxt}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : events.length === 0 ? (
            <View style={st.evEmpty}>
              <Feather name="calendar" size={32} color="#cbd5e1" />
              <Text style={st.evEmptyTxt}>No upcoming events</Text>
              {isAdmin && (
                <TouchableOpacity style={st.evEmptyAdd} onPress={openAdd}>
                  <Text style={st.evEmptyAddTxt}>Add one now</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={st.evGrid}>
              {events.map(ev => {
                const dl    = daysLeft(ev.event_date);
                const isHol = ev.event_type === "holiday";
                return (
                  <TouchableOpacity
                    key={String(ev.event_id)}
                    style={st.evItem}
                    onPress={() => isAdmin && openEdit(ev)}
                    activeOpacity={isAdmin ? 0.7 : 1}
                  >
                    <View style={st.evTitleRow}>
                      <View style={[st.evDot, { backgroundColor: ev.event_color || "#2f7ef5" }]} />
                      <Text style={st.evTitle} numberOfLines={2}>{ev.event_title}</Text>
                    </View>
                    <View style={st.evDateRow}>
                      <Feather name="calendar" size={10} color="#94a3b8" />
                      <Text style={st.evDate}>{fmt(ev.event_date)}</Text>
                      {!!ev.event_end_date && ev.event_end_date !== ev.event_date && (
                        <Text style={st.evDate}> – {fmt(ev.event_end_date)}</Text>
                      )}
                    </View>
                    <View style={st.evBadges}>
                      <View style={[st.evBadge, isHol ? st.evBadgeHol : st.evBadgeEv]}>
                        <Text style={[st.evBadgeTxt, isHol ? st.evBadgeTxtHol : st.evBadgeTxtEv]}>
                          {isHol ? "Holiday" : "Event"}
                        </Text>
                      </View>
                      {!!ev.event_category && (
                        <View style={st.evCatBadge}>
                          <Text style={st.evCatTxt}>{ev.event_category}</Text>
                        </View>
                      )}
                      {dl && (
                        <Text style={[st.evDaysLeft, dl.urgent && st.evDaysLeftUrgent]}>
                          {dl.label}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Add / Edit Event Modal ── */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => !saving && setModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={st.modalOverlay}>
            <View style={st.modalCard}>

              <View style={st.modalHead}>
                <Text style={st.modalTitle}>{editing ? "Edit Event" : "New Event"}</Text>
                <TouchableOpacity onPress={() => setModal(false)} disabled={saving} style={st.modalClose}>
                  <Feather name="x" size={15} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Title */}
                <Text style={st.fLabel}>Event Title <Text style={{ color: "#ef4444" }}>*</Text></Text>
                <TextInput style={st.input} value={title} onChangeText={setTitle}
                  placeholder="e.g. Annual Sports Day" placeholderTextColor="#94a3b8" editable={!saving} />

                {/* Type */}
                <Text style={st.fLabel}>Type</Text>
                <View style={st.toggleRow}>
                  {EVENT_TYPES.map(t => (
                    <TouchableOpacity key={t} style={[st.toggleBtn, evType === t && st.toggleBtnAct]}
                      onPress={() => setEvType(t)}>
                      <Text style={[st.toggleTxt, evType === t && st.toggleTxtAct]}>
                        {t === "holiday" ? "Holiday" : "Event"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Category */}
                <Text style={st.fLabel}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {EVENT_CATEGORIES.map(c => (
                      <TouchableOpacity key={c} style={[st.chipBtn, category === c && st.chipBtnAct]}
                        onPress={() => setCategory(category === c ? "" : c)}>
                        <Text style={[st.chipTxt, category === c && st.chipTxtAct]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Event Date — calendar picker */}
                <DateField
                  label="Event Date"
                  required
                  value={evDate}
                  onChange={setEvDate}
                  disabled={saving}
                />

                {/* End Date — calendar picker, minDate = evDate */}
                <DateField
                  label="End Date (optional, for multi-day)"
                  value={endDate}
                  onChange={setEndDate}
                  minDate={evDate || undefined}
                  disabled={saving}
                />

                {/* Description */}
                <Text style={st.fLabel}>Description</Text>
                <TextInput style={[st.input, { height: 72, textAlignVertical: "top" }]}
                  value={desc} onChangeText={setDesc} multiline
                  placeholder="Optional description…" placeholderTextColor="#94a3b8" editable={!saving} />

                {/* Color */}
                <Text style={st.fLabel}>Event Colour</Text>
                <View style={st.palette}>
                  {COLORS.map(c => (
                    <TouchableOpacity key={c} style={[st.paletteDot, { backgroundColor: c }, color === c && st.paletteDotSel]}
                      onPress={() => setColor(c)} />
                  ))}
                </View>

                {/* Public toggle */}
                <View style={st.switchRow}>
                  <Text style={st.fLabel}>Visible to Students/Parents</Text>
                  <Switch value={isPublic} onValueChange={setIsPublic}
                    trackColor={{ false: "#e2e8f0", true: "#bfdbfe" }}
                    thumbColor={isPublic ? "#2f7ef5" : "#94a3b8"} disabled={saving} />
                </View>

              </ScrollView>

              {/* Footer */}
              <View style={st.modalFoot}>
                {editing && (
                  <TouchableOpacity style={st.deleteBtn} onPress={handleDelete} disabled={saving}>
                    <Feather name="trash-2" size={14} color="#dc2626" />
                    <Text style={st.deleteBtnTxt}>Delete</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={st.cancelBtn} onPress={() => setModal(false)} disabled={saving}>
                  <Text style={st.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="check" size={14} color="#fff" /><Text style={st.saveBtnTxt}>Save</Text></>}
                </TouchableOpacity>
              </View>

            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

/* ── Sub-components ───────────────────────────────────────────────────────── */
const Stat = ({ icon, label, value, colors }) => (
  <LinearGradient colors={colors} style={st.statCard}>
    <MaterialIcons name={icon} size={18} color="rgba(255,255,255,0.85)" />
    <Text style={st.statValue}>{value}</Text>
    <Text style={st.statLabel}>{label}</Text>
  </LinearGradient>
);

const Action = ({ icon, title, onPress, disabled }) => (
  <TouchableOpacity style={[st.action, disabled && { opacity: 0.45 }]} onPress={onPress} activeOpacity={disabled ? 1 : 0.8} disabled={!onPress}>
    <MaterialIcons name={icon} size={22} color="#fff" />
    <Text style={st.actionText}>{title}</Text>
  </TouchableOpacity>
);

/* ── Styles ───────────────────────────────────────────────────────────────── */
const st = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#f8fafc", paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16 },
  greeting:       { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  subText:        { fontSize: 13, color: "#64748b", marginTop: 2 },

  hero:           { padding: 20, borderRadius: 18, marginBottom: 16 },

  schoolCard:     { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 16, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  schoolLogo:     { width: 100, height: 100, borderRadius: 10 },
  schoolNameTxt:  { fontSize: 15, fontWeight: "800", color: "#0f172a", marginTop: 8, textAlign: "center" },

  heroTitle:      { color: "#fff", fontSize: 20, fontWeight: "800" },
  heroSub:        { color: "#c7d2fe", marginVertical: 8, fontSize: 13 },
  heroBtn:        { backgroundColor: "#facc15", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, alignSelf: "flex-start" },
  heroBtnText:    { fontWeight: "700", fontSize: 13 },

  grid:           { flexDirection: "row", gap: 6, marginBottom: 10 },
  statCard:       { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" },
  statValue:      { color: "#fff", fontSize: 15, fontWeight: "800", marginTop: 4 },
  statLabel:      { color: "rgba(255,255,255,0.8)", fontSize: 9, marginTop: 1, textAlign: "center" },

  card:           { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginTop: 12, borderLeftWidth: 3, borderLeftColor: "#1e40af", borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  sectionTitle:   { fontSize: 13, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6 },

  // Compact attendance card
  attCard:       { backgroundColor: "#fff", borderRadius: 14, padding: 12, marginTop: 10, borderLeftWidth: 3, borderLeftColor: "#1e40af", borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  attHeader:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  attTitleRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  attPct:        { fontSize: 20, fontWeight: "900", color: "#1e40af" },
  attBarBg:      { flexDirection: "row", height: 10, borderRadius: 6, overflow: "hidden", backgroundColor: "#f1f5f9", marginBottom: 8 },
  attBarFill:    { backgroundColor: "#16a34a" },
  attBarAbsent:  { backgroundColor: "#fca5a5" },
  attLegend:     { flexDirection: "row", gap: 16 },
  attLegendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  attDot:        { width: 8, height: 8, borderRadius: 4 },
  attLegendTxt:  { fontSize: 11, color: "#475569", fontWeight: "600" },

  actions:        { flexDirection: "row", justifyContent: "space-between" },
  action:         { backgroundColor: "#1e40af", padding: 14, borderRadius: 14, width: "30%", alignItems: "center" },
  actionText:     { color: "#fff", marginTop: 5, fontSize: 11, textAlign: "center" },

  // Notices widget
  noticeCard:       { backgroundColor: "#fff", borderRadius: 18, marginTop: 14, borderWidth: 1, borderColor: "#e8edf5", overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  noticeHead:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, backgroundColor: "#faf5ff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  noticeHeadLeft:   { flexDirection: "row", alignItems: "center", gap: 6 },
  noticeHeadTitle:  { fontSize: 14, fontWeight: "800", color: "#4c1d95" },
  noticeViewAll:    { flexDirection: "row", alignItems: "center", gap: 2 },
  noticeViewAllTxt: { fontSize: 12, fontWeight: "700", color: "#7c3aed" },
  // Gallery widget
  galCard:          { backgroundColor: "#fff", borderRadius: 18, marginTop: 14, marginBottom: 0, paddingTop: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, overflow: "hidden" },
  galHead:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, marginBottom: 10 },
  galHeadLeft:      { flexDirection: "row", alignItems: "center", gap: 6 },
  galHeadTitle:     { fontSize: 14, fontWeight: "800", color: "#831843" },
  galViewAll:       { flexDirection: "row", alignItems: "center", gap: 2 },
  galViewAllTxt:    { fontSize: 12, fontWeight: "700", color: "#db2777" },
  galRow:           { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  galThumb:         { width: 90, height: 90, borderRadius: 10, backgroundColor: "#e2e8f0" },

  noticeEmpty:      { paddingHorizontal: 14, paddingVertical: 18, alignItems: "center" },
  noticeEmptyTxt:   { fontSize: 12, color: "#94a3b8" },
  noticeRow:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  noticeRowBorder:  { borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  noticeDot:        { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  noticeTitle:      { fontSize: 13, fontWeight: "700", color: "#0b1f4b" },
  noticeDate:       { fontSize: 10, color: "#94a3b8", marginTop: 1 },

  // Events card
  evCard:      { backgroundColor: "#fff", borderRadius: 18, marginTop: 16, borderWidth: 1, borderColor: "#e8edf5", overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  evHead:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fafbff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  evHeadLeft:  { flexDirection: "row", alignItems: "center", gap: 6 },
  evHeadTitle: { fontSize: 14, fontWeight: "800", color: "#0b1f4b" },
  evAddBtn:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: "#dbeafe", backgroundColor: "#fff" },
  evAddBtnTxt: { fontSize: 12, fontWeight: "700", color: "#2f7ef5" },

  evEmpty:       { alignItems: "center", padding: 32, gap: 8 },
  evEmptyTxt:    { fontSize: 13, color: "#94a3b8", fontWeight: "600" },
  evEmptyAdd:    { marginTop: 4, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8, backgroundColor: "#eff6ff" },
  evEmptyAddTxt: { fontSize: 12, fontWeight: "700", color: "#2f7ef5" },

  evGrid:     { flexDirection: "row", flexWrap: "wrap" },
  evItem:     { width: "50%", padding: 12, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#f1f5f9", gap: 4 },
  evTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  evDot:      { width: 9, height: 9, borderRadius: 5, marginTop: 3, flexShrink: 0 },
  evTitle:    { flex: 1, fontSize: 12, fontWeight: "800", color: "#0b1f4b", lineHeight: 16 },
  evDateRow:  { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 15 },
  evDate:     { fontSize: 10, color: "#64748b" },
  evBadges:   { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, paddingLeft: 15 },
  evBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  evBadgeHol: { backgroundColor: "#fef9c3" },
  evBadgeEv:  { backgroundColor: "#eff6ff" },
  evBadgeTxt: { fontSize: 9, fontWeight: "700" },
  evBadgeTxtHol: { color: "#b45309" },
  evBadgeTxtEv:  { color: "#1355c1" },
  evCatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99, backgroundColor: "#f1f5f9" },
  evCatTxt:   { fontSize: 9, fontWeight: "600", color: "#475569" },
  evDaysLeft:       { fontSize: 9, fontWeight: "700", color: "#64748b" },
  evDaysLeftUrgent: { color: "#dc2626" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard:    { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "92%", paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  modalHead:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle:   { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  modalClose:   { width: 28, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  fLabel:     { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input:      { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: "#0f172a", marginBottom: 14 },

  // Date picker button
  datePicker:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 14 },
  datePickerTxt: { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "500" },
  datePickerPh:  { color: "#94a3b8", fontWeight: "400" },

  toggleRow:    { flexDirection: "row", gap: 8, marginBottom: 14 },
  toggleBtn:    { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center", backgroundColor: "#f8fafc" },
  toggleBtnAct: { backgroundColor: "#eff6ff", borderColor: "#2f7ef5" },
  toggleTxt:    { fontSize: 12, fontWeight: "600", color: "#64748b" },
  toggleTxtAct: { color: "#2f7ef5", fontWeight: "700" },

  chipBtn:    { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  chipBtnAct: { backgroundColor: "#eff6ff", borderColor: "#2f7ef5" },
  chipTxt:    { fontSize: 11, fontWeight: "600", color: "#64748b" },
  chipTxtAct: { color: "#2f7ef5", fontWeight: "700" },

  palette:       { flexDirection: "row", gap: 10, marginBottom: 14 },
  paletteDot:    { width: 28, height: 28, borderRadius: 14 },
  paletteDotSel: { borderWidth: 3, borderColor: "#0b1f4b" },

  switchRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },

  // WhatsApp community banner (green)
  waBanner:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#dcfce7", borderRadius: 16, marginTop: 14, padding: 14, borderWidth: 1, borderColor: "#bbf7d0" },
  waBannerIcon:   { width: 42, height: 42, borderRadius: 21, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  waBannerTitle:  { fontSize: 14, fontWeight: "800", color: "#14532d" },
  waBannerSub:    { fontSize: 11, color: "#166534", marginTop: 1 },
  waJoinBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#16a34a", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  waJoinTxt:      { fontSize: 12, fontWeight: "700", color: "#fff" },
  waEmoji:        { fontSize: 20 },
  waBtnDisabled:    { backgroundColor: "#e2e8f0" },
  waBtnDisabledTxt: { color: "#94a3b8" },

  // WhatsApp channel banner (purple)
  waChBanner:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#f3e8ff", borderRadius: 16, marginTop: 10, padding: 14, borderWidth: 1, borderColor: "#e9d5ff" },
  waChBannerIcon:  { width: 42, height: 42, borderRadius: 21, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
  waChBannerTitle: { fontSize: 14, fontWeight: "800", color: "#3b0764" },
  waChBannerSub:   { fontSize: 11, color: "#6b21a8", marginTop: 1 },
  waChFollowBtn:   { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#7c3aed", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  waChFollowTxt:   { fontSize: 12, fontWeight: "700", color: "#fff" },

  // ── Module quick-action widgets ──────────────────────────────────────────
  qaHeader:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 4 },
  qaHeaderTxt: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  modCard:     { marginBottom: 10, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, overflow: "hidden" },
  modHeader:   { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  modIconWrap: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  modTitle:    { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  modLinks:    { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6, paddingBottom: 8, paddingTop: 2 },
  modLink:     { width: "25%", alignItems: "center", paddingVertical: 8, paddingHorizontal: 2 },
  modLinkIcon: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  modLinkTxt:  { fontSize: 10, color: "#374151", fontWeight: "600", textAlign: "center", lineHeight: 13 },

  // ── Notification pill & modal ────────────────────────────────────────────
  notifPill:      { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginHorizontal: 14, marginTop: 2, marginBottom: 10, backgroundColor: "#f5f3ff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "#ede9fe" },
  notifPillTxt:   { fontSize: 11, color: "#7c3aed", fontWeight: "600" },
  notifOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  notifSheet:     { backgroundColor: "#fff", borderRadius: 18, padding: 20, width: "100%", maxWidth: 360 },
  notifSheetTitle:{ fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 2 },
  notifSheetSub:  { fontSize: 12, color: "#64748b", marginBottom: 16 },
  notifRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  notifRowLabel:  { fontSize: 13, color: "#374151", fontWeight: "600" },
  notifStepper:   { flexDirection: "row", gap: 6 },
  notifStep:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  notifStepSel:   { backgroundColor: "#7c3aed", borderColor: "#7c3aed" },
  notifStepTxt:   { fontSize: 13, color: "#374151", fontWeight: "700" },
  notifStepSelTxt:{ color: "#fff" },
  notifBtns:      { flexDirection: "row", gap: 8, marginTop: 4, justifyContent: "flex-end" },
  notifCancelBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9, backgroundColor: "#f1f5f9" },
  notifCancelTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  notifSaveBtn:   { paddingHorizontal: 20, paddingVertical: 9, borderRadius: 9, backgroundColor: "#7c3aed", minWidth: 64, alignItems: "center" },
  notifSaveTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },

  modalFoot:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  deleteBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  deleteBtnTxt: { color: "#dc2626", fontWeight: "700", fontSize: 12 },
  cancelBtn:    { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelBtnTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 9, backgroundColor: "#2f7ef5" },
  saveBtnTxt:   { color: "#fff", fontWeight: "700", fontSize: 13 },
});

// ── NoticeTicker styles ────────────────────────────────────────────────────────
const tk = StyleSheet.create({
  wrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "#f5f3ff", marginTop: 6, marginBottom: 2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "#ede9fe" },
  dot:     { width: 7, height: 7, borderRadius: 4, marginRight: 8, flexShrink: 0 },
  clip:    { flex: 1, overflow: "hidden", height: 18 },
  txt:     { fontSize: 12, fontWeight: "700", color: "#5b21b6" },
});

// ── Calendar styles ────────────────────────────────────────────────────────────
const CAL_W = Dimensions.get("window").width - 48;
const DAY_W = Math.floor(CAL_W / 7);

const cal = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  sheet:    { backgroundColor: "#fff", borderRadius: 20, padding: 16, width: "100%", maxWidth: 380 },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  titleTxt: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  closeBtn: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  // Nav
  navRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  navArrow:    { width: 34, height: 34, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  navCenter:   { flex: 1, alignItems: "center", gap: 2 },
  navMonthBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  navMonthTxt: { fontSize: 15, fontWeight: "800", color: "#0b1f4b" },
  navYearBtn:  { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#f1f5f9" },
  navYearSmTxt:{ fontSize: 12, fontWeight: "700", color: "#475569" },
  navYearTxt:  { fontSize: 14, fontWeight: "800", color: "#0b1f4b" },

  // Month grid
  monthGrid:     { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 8 },
  monthCell:     { width: "22%", margin: "1.5%", paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: "#f8fafc" },
  monthCellSel:  { backgroundColor: "#1e40af" },
  monthCellTxt:  { fontSize: 13, fontWeight: "700", color: "#374151" },
  monthCellSelTxt:{ color: "#fff" },

  // Year grid
  yearCell:     { flex: 1, margin: 4, paddingVertical: 9, borderRadius: 10, alignItems: "center", backgroundColor: "#f8fafc" },
  yearCellSel:  { backgroundColor: "#1e40af" },
  yearCellTxt:  { fontSize: 12, fontWeight: "600", color: "#374151" },
  yearCellSelTxt:{ color: "#fff", fontWeight: "800" },

  // Day grid
  dowRow:    { flexDirection: "row", marginBottom: 4 },
  dowTxt:    { width: DAY_W, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#94a3b8" },

  daysGrid:      { flexDirection: "row", flexWrap: "wrap" },
  dayCell:       { width: DAY_W, height: DAY_W, alignItems: "center", justifyContent: "center" },
  dayCellSel:    { backgroundColor: "#1e40af", borderRadius: DAY_W / 2 },
  dayCellToday:  { borderWidth: 1.5, borderColor: "#1e40af", borderRadius: DAY_W / 2 },
  dayCellDis:    { opacity: 0.3 },
  dayCellTxt:    { fontSize: 13, color: "#0f172a", fontWeight: "500" },
  dayCellSelTxt: { color: "#fff", fontWeight: "800" },
  dayCellTodayTxt:{ color: "#1e40af", fontWeight: "700" },
  dayCellDisTxt: { color: "#94a3b8" },

  selectedTxt: { textAlign: "center", fontSize: 11, color: "#64748b", marginTop: 10, fontWeight: "600" },
});
