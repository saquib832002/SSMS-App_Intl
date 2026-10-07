/**
 * screens/StudentDashboardScreen.js
 * Personal dashboard shown to students and parents.
 * Replaces the admin DashboardScreen for these roles.
 *
 * Sections:
 *  1. Welcome card
 *  2. Quick links (Attendance · Marksheet · Homework · Fee)
 *  3. Attendance stat (this month %)
 *  4. Fee alert (dues or all-clear)
 *  5. Recent homework (last 3)
 *  6. Notices & circulars (top 3)
 *  7. Upcoming events & holidays
 */
import React, { useContext, useState, useCallback, useEffect, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, StatusBar, Image, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { fetchMyAttendance, fetchLinkedStudents } from "../services/StudentServiceApi";
import { fetchStudentFeeData } from "../services/FeeServiceApi";
import { getStudentHomework } from "../services/HomeworkServiceApi";
import { fetchNotices } from "../services/NoticeServiceApi";
import { fetchUpcomingEvents } from "../services/SchoolEventsServiceApi";
import { fetchGalleryPhotos } from "../services/GalleryServiceApi";
import { fetchInstituteDetails } from "../services/UserServiceApi";

// ── Helpers ───────────────────────────────────────────────────────────────────
const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(String(d).replace(" ", "T"));
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const PRIORITY_DOT = { urgent: "#dc2626", important: "#f59e0b", normal: "#3b82f6" };

// ── Quick link tile ───────────────────────────────────────────────────────────
function QuickTile({ icon, label, color, bg, onPress }) {
  return (
    <TouchableOpacity style={[s.tile, { backgroundColor: bg }]} onPress={onPress} activeOpacity={0.75}>
      <View style={[s.tileIcon, { backgroundColor: color + "22" }]}>
        <Feather name={icon} size={20} color={color} />
      </View>
      <Text style={[s.tileLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────────
function SectionCard({ icon, title, accent = "#1e40af", onViewAll, children }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={s.cardHeadLeft}>
          <Feather name={icon} size={14} color={accent} />
          <Text style={[s.cardTitle, { color: accent }]}>{title}</Text>
        </View>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll} style={s.viewAllBtn}>
            <Text style={[s.viewAllTxt, { color: accent }]}>View All</Text>
            <Feather name="chevron-right" size={12} color={accent} />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StudentDashboardScreen({ navigation }) {
  const {
    user, hasModule,
    activeEnrollmentId, setActiveEnrollmentId,
    linkedStudents, setLinkedStudents,
  } = useContext(AuthContext);

  const role         = (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim();
  const isParent     = role === "parent";
  const firstName    = user?.firstName || user?.ssmsUserName || "there";
  // When a parent has switched to a child's view, use that child's enrollment.
  // Otherwise fall back to the logged-in user's own enrollment ID.
  const enrollmentId = activeEnrollmentId ?? user?.enrollmentId ?? user?.ssmsUserName ?? "";
  const hasMultiple  = Array.isArray(linkedStudents) && linkedStudents.length > 1;

  // When a parent views a child's portal, override enrollmentId in request headers
  // so backend auth checks receive a valid enrollment_id instead of empty string.
  const effectiveUser = useMemo(
    () => (activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user),
    [user, activeEnrollmentId]
  );

  // ── State ──────────────────────────────────────────────────────────────────
  const [refreshing,   setRefreshing]   = useState(false);

  const [attendance,   setAttendance]   = useState(null);  // { present, total, pct }
  const [attLoading,   setAttLoading]   = useState(true);

  const [fees,         setFees]         = useState([]);     // due fee rows
  const [feeLoading,   setFeeLoading]   = useState(true);
  const [classInfo,    setClassInfo]    = useState(null);  // { class_name, section_name, session_name, branch_name }

  const [homework,     setHomework]     = useState([]);
  const [hwLoading,    setHwLoading]    = useState(true);

  const [notices,      setNotices]      = useState([]);
  const [notLoading,   setNotLoading]   = useState(true);

  const [gallery,      setGallery]      = useState([]);

  const [events,       setEvents]       = useState([]);
  const [evLoading,    setEvLoading]    = useState(true);

  const [communityLink, setCommunityLink] = useState(null); // WhatsApp community link
  const [channelLink,   setChannelLink]   = useState(null); // WhatsApp channel link

  // ── Loaders ────────────────────────────────────────────────────────────────
  // Subscription schools only load the modules they have; legacy schools
  // always pass these hasModule() checks (unchanged behaviour).
  const loadAttendance = useCallback(async () => {
    if (!effectiveUser?.token) return;
    if (!hasModule("attendance")) { setAttendance(null); setAttLoading(false); return; }
    try {
      setAttLoading(true);
      const res = await fetchMyAttendance(effectiveUser);
      // Backend returns { status, days: [{ date, dayName, attendance }] }
      // dayName is 'Mon'–'Sun' (PHP date('D')).
      //
      // Counting rules (per product requirement):
      //  • Mon–Fri are always counted in the total (unrecorded = absent).
      //  • Sat/Sun are only counted if attendance === 'P' (school ran a
      //    special session); then they add to both total AND present.
      const days = Array.isArray(res?.days) ? res.days : [];
      const isWeekend = (d) => d.dayName === 'Sat' || d.dayName === 'Sun';
      const weekdays       = days.filter(d => !isWeekend(d));
      const weekendPresent = days.filter(d =>  isWeekend(d) && d.attendance === 'P');
      const total   = weekdays.length + weekendPresent.length;
      const present = weekdays.filter(d => d.attendance === 'P').length + weekendPresent.length;
      const pct     = total > 0 ? Math.round((present / total) * 100) : null;
      setAttendance({ present, total, pct });
    } catch { setAttendance(null); }
    finally { setAttLoading(false); }
  }, [effectiveUser, hasModule]);

  const loadFees = useCallback(async () => {
    if (!effectiveUser?.token || !enrollmentId) return;
    if (!hasModule("fees")) { setFees([]); setFeeLoading(false); return; }
    try {
      setFeeLoading(true);
      // Use the same endpoint as MyFeeScreen so dashboard and detail view are consistent
      const data = await fetchStudentFeeData(enrollmentId, {}, effectiveUser);
      const due = Array.isArray(data?.due) ? data.due : [];
      setFees(due);
      // Capture class / section / session info returned by the same endpoint
      if (data?.enrollment_info) {
        setClassInfo(data.enrollment_info);
      }
    } catch { setFees([]); }
    finally { setFeeLoading(false); }
  }, [effectiveUser, enrollmentId, hasModule]);

  const loadHomework = useCallback(async () => {
    if (!effectiveUser?.token || !enrollmentId) return;
    if (!hasModule("academics")) { setHomework([]); setHwLoading(false); return; }
    try {
      setHwLoading(true);
      const res = await getStudentHomework(effectiveUser, enrollmentId, null);
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setHomework(rows.slice(0, 3));
    } catch { setHomework([]); }
    finally { setHwLoading(false); }
  }, [effectiveUser, enrollmentId, hasModule]);

  const loadNotices = useCallback(async () => {
    if (!effectiveUser?.token) return;
    if (hasModule("notices")) {
      try {
        setNotLoading(true);
        const data = await fetchNotices(effectiveUser, { limit: 4 });
        setNotices(data);
      } catch { setNotices([]); }
      finally { setNotLoading(false); }
    } else {
      setNotices([]); setNotLoading(false);
    }
    // Gallery — non-critical, silent fail
    if (hasModule("communication")) {
      fetchGalleryPhotos(effectiveUser)
        .then(({ photos }) => setGallery(photos.slice(0, 6)))
        .catch(() => {});
    } else {
      setGallery([]);
    }
  }, [effectiveUser, hasModule]);

  const loadEvents = useCallback(async () => {
    if (!effectiveUser?.token) return;
    if (!hasModule("notices")) { setEvents([]); setEvLoading(false); return; }
    try {
      setEvLoading(true);
      const data = await fetchUpcomingEvents(effectiveUser, 6);
      setEvents(data);
    } catch { setEvents([]); }
    finally { setEvLoading(false); }
  }, [effectiveUser, hasModule]);

  useEffect(() => {
    loadAttendance();
    loadFees();
    loadHomework();
    loadNotices();
    loadEvents();
    // Fetch WhatsApp community + channel links (non-critical, silent fail)
    if (user?.token) {
      fetchInstituteDetails(user)
        .then(d => {
          setCommunityLink(d?.whatsapp_community_link || null);
          setChannelLink(d?.whatsapp_channel_link || null);
        })
        .catch(() => {});
    }
  }, [loadAttendance, loadFees, loadHomework, loadNotices, loadEvents, user]);

  // ── Multi-child check: fetch linked students once on first dashboard load ──
  useEffect(() => {
    if (!user?.token || linkedStudents !== null) return; // already fetched or not logged in
    let cancelled = false;
    (async () => {
      try {
        const students = await fetchLinkedStudents(user); // use raw user (parent's own identity)
        if (cancelled) return;
        setLinkedStudents(students);
        if (!activeEnrollmentId) {
          if (students.length === 1) {
            // Only one child — select automatically, no picker needed
            setActiveEnrollmentId(students[0].enrollment_id);
          } else if (students.length > 1) {
            // Multiple children — let parent choose
            navigation.navigate('SelectStudent');
          }
        }
      } catch {
        if (!cancelled) setLinkedStudents([]); // prevent infinite retries
      }
    })();
    return () => { cancelled = true; };
  }, [user, linkedStudents, activeEnrollmentId, setLinkedStudents, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadAttendance(), loadFees(), loadHomework(), loadNotices(), loadEvents(),
    ]);
    setRefreshing(false);
  }, [loadAttendance, loadFees, loadHomework, loadNotices, loadEvents]);

  // ── Attendance colour ──────────────────────────────────────────────────────
  const attColor = attendance?.pct == null ? "#94a3b8"
    : attendance.pct >= 80 ? "#16a34a"
    : attendance.pct >= 60 ? "#f59e0b"
    : "#dc2626";

  // ── Total dues ─────────────────────────────────────────────────────────────
  const totalDue = fees.reduce((sum, f) => sum + (parseFloat(f.balance_due ?? f.net_fee_amount ?? f.fee_amount ?? 0) || 0), 0);

  // ── Homework status colour ─────────────────────────────────────────────────
  const hwStatusColor = (s) => {
    const v = String(s ?? "").toLowerCase();
    if (v === "submitted" || v === "done") return "#16a34a";
    if (v === "pending")   return "#f59e0b";
    return "#94a3b8";
  };

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={["#1e40af"]} tintColor="#1e40af" />
        }
      >

        {/* ── 1. Welcome card ── */}
        <View style={s.welcomeCard}>
          <View style={s.welcomeIconWrap}>
            <Text style={s.welcomeEmoji}>{isParent ? "👨‍👩‍👧" : "🎓"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.greetingTxt}>{greeting()},</Text>
            <Text style={s.nameTxt} numberOfLines={1}>
              {classInfo?.student_name || firstName}
            </Text>
            <View style={s.rolePill}>
              <Text style={s.rolePillTxt}>{isParent ? "Parent" : "Student"}</Text>
              {!!enrollmentId && <Text style={s.enrollTxt}>  ·  {enrollmentId}</Text>}
            </View>
            {/* Class / Section / Session row */}
            {classInfo && (
              <View style={s.classRow}>
                {!!classInfo.class_name && (
                  <View style={s.classChip}>
                    <Feather name="book-open" size={10} color="#1e40af" />
                    <Text style={s.classChipTxt}>{classInfo.class_name}</Text>
                  </View>
                )}
                {!!classInfo.section_name && (
                  <View style={s.classChip}>
                    <Feather name="users" size={10} color="#7c3aed" />
                    <Text style={[s.classChipTxt, { color: "#7c3aed" }]}>{classInfo.section_name}</Text>
                  </View>
                )}
                {!!classInfo.session_name && (
                  <View style={s.classChip}>
                    <Feather name="calendar" size={10} color="#0369a1" />
                    <Text style={[s.classChipTxt, { color: "#0369a1" }]}>{classInfo.session_name}</Text>
                  </View>
                )}
              </View>
            )}
            {/* Switch child button — shown only when parent has multiple children */}
            {hasMultiple && (
              <TouchableOpacity
                style={s.switchBtn}
                onPress={() => navigation.navigate("SelectStudent")}
                activeOpacity={0.75}
              >
                <Feather name="repeat" size={11} color="#1e40af" />
                <Text style={s.switchTxt}>Switch Student</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── 2. Quick links ── */}
        <View style={s.tilesRow}>
          <QuickTile icon="check-square" label="Attendance" color="#16a34a" bg="#f0fdf4"
            onPress={() => navigation.navigate("MyAttendance")} />
          <QuickTile icon="file-text"   label="View Marks" color="#7c3aed" bg="#faf5ff"
            onPress={() => navigation.navigate("MyMarksheet")} />
          <QuickTile icon="book"        label="Homework"   color="#0369a1" bg="#f0f9ff"
            onPress={() => navigation.navigate("My Portal", { screen: "MyHomework" })} />
          <QuickTile icon="dollar-sign" label="Fee"        color="#b45309" bg="#fffbeb"
            onPress={() => navigation.navigate("MyFee")} />
          <QuickTile icon="layers"      label="My Tests"  color="#0891b2" bg="#f0f9ff"
            onPress={() => navigation.navigate("My Portal", { screen: "MyTestSeries" })} />
        </View>

        {/* ── 2b. WhatsApp Community banner ── */}
        {!!communityLink && (
          <TouchableOpacity
            style={s.waBanner}
            onPress={() => Linking.openURL(communityLink).catch(() => {})}
            activeOpacity={0.82}
          >
            <View style={s.waBannerIcon}>
              <Text style={s.waEmoji}>💬</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.waBannerTitle}>Join our WhatsApp Community</Text>
              <Text style={s.waBannerSub}>Stay updated with school announcements</Text>
            </View>
            <View style={s.waJoinBtn}>
              <Text style={s.waJoinTxt}>Join</Text>
              <Feather name="arrow-right" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* ── 2c. WhatsApp Channel banner ── */}
        {!!channelLink && (
          <TouchableOpacity
            style={s.waChBanner}
            onPress={() => Linking.openURL(channelLink).catch(() => {})}
            activeOpacity={0.82}
          >
            <View style={s.waChBannerIcon}>
              <Text style={s.waEmoji}>📢</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.waChBannerTitle}>Follow our WhatsApp Channel</Text>
              <Text style={s.waChBannerSub}>Get school updates & announcements</Text>
            </View>
            <View style={s.waChFollowBtn}>
              <Text style={s.waChFollowTxt}>Follow</Text>
              <Feather name="arrow-right" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* ── 3. Attendance stat ── */}
        <SectionCard icon="bar-chart-2" title="My Attendance" accent="#16a34a"
          onViewAll={() => navigation.navigate("MyAttendance")}>
          {attLoading ? (
            <ActivityIndicator color="#16a34a" style={{ paddingVertical: 16 }} />
          ) : attendance?.pct == null ? (
            <Text style={s.emptyTxt}>No attendance data available</Text>
          ) : (
            <View style={s.attRow}>
              <View style={s.attCircle}>
                <Text style={[s.attPct, { color: attColor }]}>{attendance.pct}%</Text>
                <Text style={s.attLabel}>Last 30 days</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.attBar}>
                  <View style={[s.attBarFill, { width: `${attendance.pct}%`, backgroundColor: attColor }]} />
                </View>
                <View style={s.attCounts}>
                  <View style={s.attStat}>
                    <Text style={[s.attStatNum, { color: "#16a34a" }]}>{attendance.present}</Text>
                    <Text style={s.attStatLabel}>Present</Text>
                  </View>
                  <View style={s.attStat}>
                    <Text style={[s.attStatNum, { color: "#dc2626" }]}>{attendance.total - attendance.present}</Text>
                    <Text style={s.attStatLabel}>Absent</Text>
                  </View>
                  <View style={s.attStat}>
                    <Text style={[s.attStatNum, { color: "#64748b" }]}>{attendance.total}</Text>
                    <Text style={s.attStatLabel}>Total</Text>
                  </View>
                </View>
              </View>
            </View>
          )}
        </SectionCard>

        {/* ── 4. Fee alert ── */}
        <SectionCard icon="dollar-sign" title="Fee Status" accent="#b45309"
          onViewAll={() => navigation.navigate("MyFee")}>
          {feeLoading ? (
            <ActivityIndicator color="#b45309" style={{ paddingVertical: 16 }} />
          ) : totalDue > 0 ? (
            <TouchableOpacity style={s.feeAlert} onPress={() => navigation.navigate("MyFee")} activeOpacity={0.8}>
              <Feather name="alert-circle" size={20} color="#dc2626" />
              <View style={{ flex: 1 }}>
                <Text style={s.feeAlertTitle}>Outstanding Fee</Text>
                <Text style={s.feeAlertAmt}>₹ {totalDue.toLocaleString("en-IN")}</Text>
              </View>
              <View style={s.feePayBtn}>
                <Text style={s.feePayTxt}>View</Text>
                <Feather name="arrow-right" size={12} color="#fff" />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={s.feeAllClear}>
              <Feather name="check-circle" size={20} color="#16a34a" />
              <Text style={s.feeAllClearTxt}>No outstanding dues — you're all clear!</Text>
            </View>
          )}
        </SectionCard>

        {/* ── 5. Recent homework ── */}
        <SectionCard icon="book" title="Recent Homework" accent="#0369a1"
          onViewAll={() => navigation.navigate("My Portal", { screen: "MyHomework" })}>
          {hwLoading ? (
            <ActivityIndicator color="#0369a1" style={{ paddingVertical: 16 }} />
          ) : homework.length === 0 ? (
            <Text style={s.emptyTxt}>No homework assigned yet</Text>
          ) : (
            homework.map((hw, i) => (
              <View key={String(hw.homework_id ?? i)} style={[s.hwRow, i < homework.length - 1 && s.hwRowBorder]}>
                <View style={[s.hwSubjectDot, { backgroundColor: "#0369a1" }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.hwTitle} numberOfLines={1}>{hw.title ?? hw.homework_title ?? "Homework"}</Text>
                  <Text style={s.hwMeta}>
                    {hw.subject_name ?? ""}
                    {hw.due_date ? `  ·  Due ${fmtDate(hw.due_date)}` : ""}
                  </Text>
                </View>
                {hw.status && (
                  <View style={[s.hwStatusBadge, { backgroundColor: hwStatusColor(hw.status) + "18" }]}>
                    <Text style={[s.hwStatusTxt, { color: hwStatusColor(hw.status) }]}>
                      {String(hw.status).charAt(0).toUpperCase() + String(hw.status).slice(1)}
                    </Text>
                  </View>
                )}
              </View>
            ))
          )}
        </SectionCard>

        {/* ── 6. Notices ── */}
        <SectionCard icon="bell" title="Notices & Circulars" accent="#7c3aed"
          onViewAll={() => navigation.navigate("NoticeBoard")}>
          {notLoading ? (
            <ActivityIndicator color="#7c3aed" style={{ paddingVertical: 16 }} />
          ) : notices.length === 0 ? (
            <Text style={s.emptyTxt}>No notices posted yet</Text>
          ) : (
            notices.map((n, i) => (
              <TouchableOpacity key={String(n.notice_id ?? i)}
                style={[s.noticeRow, i < notices.length - 1 && s.noticeRowBorder]}
                onPress={() => navigation.navigate("NoticeBoard")} activeOpacity={0.7}>
                <View style={[s.noticeDot, { backgroundColor: PRIORITY_DOT[n.priority] ?? "#3b82f6" }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.noticeTitle} numberOfLines={2}>{n.title}</Text>
                  <Text style={s.noticeMeta}>{n.category}  ·  {fmtDate(n.created_at)}</Text>
                </View>
                {n.is_pinned == 1 && <Feather name="bookmark" size={11} color="#b45309" />}
              </TouchableOpacity>
            ))
          )}
        </SectionCard>

        {/* ── 7. School Memories gallery ── */}
        {gallery.length > 0 && (
          <View style={s.galCard}>
            <View style={s.galHead}>
              <View style={s.galHeadLeft}>
                <Feather name="image" size={15} color="#db2777" />
                <Text style={s.galHeadTitle}>School Gallery</Text>
              </View>
              <TouchableOpacity
                style={s.galViewAll}
                onPress={() => navigation.navigate("SchoolMemories")}
                activeOpacity={0.7}
              >
                <Text style={s.galViewAllTxt}>See all</Text>
                <Feather name="chevron-right" size={12} color="#db2777" />
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.galRow}
            >
              {gallery.map((p) => (
                <TouchableOpacity
                  key={String(p.id)}
                  onPress={() => navigation.navigate("SchoolMemories")}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: p.url }} style={s.galThumb} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── 8. Events & holidays ── */}
        <SectionCard icon="calendar" title="Upcoming Events & Holidays" accent="#0891b2">
          {evLoading ? (
            <ActivityIndicator color="#0891b2" style={{ paddingVertical: 16 }} />
          ) : events.length === 0 ? (
            <Text style={s.emptyTxt}>No upcoming events</Text>
          ) : (
            events.map((ev, i) => {
              const isHol = ev.event_type === "holiday";
              return (
                <View key={String(ev.event_id ?? i)} style={[s.evRow, i < events.length - 1 && s.evRowBorder]}>
                  <View style={[s.evDateBox, { backgroundColor: isHol ? "#fef9c3" : "#e0f2fe" }]}>
                    <Text style={[s.evDay,  { color: isHol ? "#b45309" : "#0369a1" }]}>
                      {new Date(String(ev.event_date).replace(" ", "T")).getDate()}
                    </Text>
                    <Text style={[s.evMon,  { color: isHol ? "#b45309" : "#0369a1" }]}>
                      {MONTHS[new Date(String(ev.event_date).replace(" ", "T")).getMonth()]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.evTitle} numberOfLines={1}>{ev.event_title}</Text>
                    <View style={s.evBadges}>
                      <View style={[s.evBadge, { backgroundColor: isHol ? "#fef9c3" : "#e0f2fe" }]}>
                        <Text style={[s.evBadgeTxt, { color: isHol ? "#b45309" : "#0369a1" }]}>
                          {isHol ? "Holiday" : "Event"}
                        </Text>
                      </View>
                      {!!ev.event_category && (
                        <Text style={s.evCat}>{ev.event_category}</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </SectionCard>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#f8fafc" },
  scroll: { padding: 14 },

  // Welcome
  welcomeCard:     { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff", borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  welcomeIconWrap: { width: 52, height: 52, borderRadius: 16, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  welcomeEmoji:    { fontSize: 26 },
  greetingTxt:     { fontSize: 12, color: "#94a3b8", fontWeight: "600" },
  nameTxt:         { fontSize: 18, fontWeight: "800", color: "#0f172a", marginTop: 1 },
  rolePill:        { flexDirection: "row", alignItems: "center", marginTop: 4 },
  rolePillTxt:     { fontSize: 11, fontWeight: "700", color: "#1e40af", backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  enrollTxt:       { fontSize: 11, color: "#94a3b8", marginLeft: 4 },
  classRow:        { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  classChip:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#bfdbfe" },
  classChipTxt:    { fontSize: 10, fontWeight: "700", color: "#1e40af" },
  switchBtn:       { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8,
                     alignSelf: "flex-start", backgroundColor: "#eff6ff",
                     borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
                     borderWidth: 1, borderColor: "#bfdbfe" },
  switchTxt:       { fontSize: 11, fontWeight: "600", color: "#1e40af" },

  // WhatsApp community banner
  waBanner:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#dcfce7", borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#86efac" },
  waBannerIcon:  { width: 42, height: 42, borderRadius: 12, backgroundColor: "#16a34a22", alignItems: "center", justifyContent: "center" },
  waEmoji:       { fontSize: 22 },
  waBannerTitle: { fontSize: 13, fontWeight: "800", color: "#15803d" },
  waBannerSub:   { fontSize: 11, color: "#16a34a", marginTop: 2 },
  waJoinBtn:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#16a34a", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  waJoinTxt:     { fontSize: 12, fontWeight: "700", color: "#fff" },

  // WhatsApp Channel banner (purple)
  waChBanner:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#faf5ff", borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#d8b4fe" },
  waChBannerIcon:   { width: 42, height: 42, borderRadius: 12, backgroundColor: "#7c3aed22", alignItems: "center", justifyContent: "center" },
  waChBannerTitle:  { fontSize: 13, fontWeight: "800", color: "#6b21a8" },
  waChBannerSub:    { fontSize: 11, color: "#7c3aed", marginTop: 2 },
  waChFollowBtn:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#7c3aed", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  waChFollowTxt:    { fontSize: 12, fontWeight: "700", color: "#fff" },

  // Quick tiles
  tilesRow:   { flexDirection: "row", gap: 8, marginBottom: 14 },
  tile:       { flex: 1, alignItems: "center", borderRadius: 14, padding: 10, gap: 6, borderWidth: 1, borderColor: "#e2e8f0" },
  tileIcon:   { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tileLabel:  { fontSize: 10, fontWeight: "700", textAlign: "center" },

  // Section card
  card:       { backgroundColor: "#fff", borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  cardHead:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", backgroundColor: "#fafbff" },
  cardHeadLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardTitle:  { fontSize: 13, fontWeight: "800" },
  viewAllBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  viewAllTxt: { fontSize: 11, fontWeight: "700" },

  emptyTxt:   { fontSize: 12, color: "#94a3b8", textAlign: "center", paddingVertical: 18, paddingHorizontal: 14 },

  // Attendance
  attRow:     { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  attCircle:  { alignItems: "center", width: 72 },
  attPct:     { fontSize: 26, fontWeight: "800" },
  attLabel:   { fontSize: 10, color: "#94a3b8", fontWeight: "600", marginTop: 2 },
  attBar:     { height: 8, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden", marginBottom: 12 },
  attBarFill: { height: "100%", borderRadius: 4 },
  attCounts:  { flexDirection: "row", gap: 12 },
  attStat:    { alignItems: "center" },
  attStatNum: { fontSize: 16, fontWeight: "800" },
  attStatLabel: { fontSize: 10, color: "#94a3b8" },

  // Fee
  feeAlert:      { flexDirection: "row", alignItems: "center", gap: 12, margin: 14, backgroundColor: "#fef2f2", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#fecaca" },
  feeAlertTitle: { fontSize: 11, fontWeight: "700", color: "#dc2626" },
  feeAlertAmt:   { fontSize: 18, fontWeight: "800", color: "#991b1b", marginTop: 2 },
  feePayBtn:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#dc2626", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  feePayTxt:     { fontSize: 12, fontWeight: "700", color: "#fff" },
  feeAllClear:   { flexDirection: "row", alignItems: "center", gap: 10, margin: 14, backgroundColor: "#f0fdf4", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#bbf7d0" },
  feeAllClearTxt:{ fontSize: 13, fontWeight: "600", color: "#15803d", flex: 1 },

  // Homework
  hwRow:         { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  hwRowBorder:   { borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  hwSubjectDot:  { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  hwTitle:       { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  hwMeta:        { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  hwStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  hwStatusTxt:   { fontSize: 10, fontWeight: "700" },

  // Notices
  noticeRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  noticeRowBorder: { borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  noticeDot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  noticeTitle:     { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  noticeMeta:      { fontSize: 10, color: "#94a3b8", marginTop: 2 },

  // Events
  evRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  evRowBorder: { borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  evDateBox:   { width: 44, alignItems: "center", borderRadius: 10, paddingVertical: 6 },
  evDay:       { fontSize: 18, fontWeight: "800" },
  evMon:       { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  evTitle:     { fontSize: 13, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  evBadges:    { flexDirection: "row", alignItems: "center", gap: 6 },
  evBadge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  evBadgeTxt:  { fontSize: 9, fontWeight: "700" },
  evCat:       { fontSize: 10, color: "#94a3b8", fontWeight: "600" },

  // Gallery widget
  galCard:      { backgroundColor: "#fff", borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  galHead:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", backgroundColor: "#fff5f9" },
  galHeadLeft:  { flexDirection: "row", alignItems: "center", gap: 6 },
  galHeadTitle: { fontSize: 13, fontWeight: "800", color: "#831843" },
  galViewAll:   { flexDirection: "row", alignItems: "center", gap: 2 },
  galViewAllTxt:{ fontSize: 11, fontWeight: "700", color: "#db2777" },
  galRow:       { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  galThumb:     { width: 90, height: 90, borderRadius: 10, backgroundColor: "#e2e8f0" },
});
