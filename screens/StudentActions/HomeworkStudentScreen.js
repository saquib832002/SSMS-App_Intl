/**
 * screens/StudentActions/HomeworkStudentScreen.js
 *
 * Student / Parent:
 *   Two tabs — Pending (pending + submitted + incomplete) and Completed.
 *   All homework is loaded at once (no date filter); cards show assigned & due dates.
 *
 * Teacher / Admin / Owner:
 *   Class + section picker + date navigator → same day-by-day view as before.
 */
import React, { useState, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
  Modal, FlatList, Animated,
} from "react-native";
import { SafeAreaView }   from "react-native-safe-area-context";
import DateTimePicker     from "@react-native-community/datetimepicker";
import { Feather }        from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { AuthContext }    from "../../context/AuthContext";
import { getStudentHomework, listHomework } from "../../services/HomeworkServiceApi";
import { fetchSections, fetchClasses } from "../../services/StudentServiceApi";
import { fetchTeacherAssignments }     from "../../services/SubjectServiceApi";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtISO  = (d) => d.toISOString().split("T")[0];
const TODAY   = fmtISO(new Date());

const fmtDisplay = (s) => {
  if (!s) return "";
  const d = new Date(String(s).replace(" ", "T") + (s.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const STATUS_CFG = {
  pending:    { label: "Pending",    icon: "clock",        color: "#92400e", bg: "#fef3c7", border: "#fcd34d", barColor: "#f59e0b" },
  submitted:  { label: "Submitted",  icon: "upload",       color: "#1d4ed8", bg: "#eff6ff", border: "#93c5fd", barColor: "#3b82f6" },
  completed:  { label: "Completed",  icon: "check-circle", color: "#15803d", bg: "#dcfce7", border: "#86efac", barColor: "#22c55e" },
  incomplete: { label: "Incomplete", icon: "x-circle",     color: "#dc2626", bg: "#fee2e2", border: "#fca5a5", barColor: "#ef4444" },
};

const PENDING_STATUSES   = new Set(["pending", "submitted", "incomplete"]);
const COMPLETED_STATUSES = new Set(["completed"]);

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={sel ? dd.val : dd.ph} numberOfLines={1}>
          {sel ? sel.label : (placeholder ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={o => String(o.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[dd.opt, String(item.value) === String(value) && dd.optSel]}
                  onPress={() => { onChange(item.value); setOpen(false); }}
                >
                  <Text style={[dd.optTxt, String(item.value) === String(value) && dd.optSelTxt]}>
                    {item.label}
                  </Text>
                  {String(item.value) === String(value) &&
                    <Feather name="check" size={14} color="#2563eb" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Homework card (student view) ──────────────────────────────────────────────
function HomeworkCard({ item }) {
  const status  = item.completionStatus ?? item.status ?? "pending";
  const cfg     = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const isOverdue = (item.dueDate ?? item.due_date ?? "") < TODAY && !COMPLETED_STATUSES.has(status);
  const dueDate = item.dueDate ?? item.due_date ?? "";
  const assignedDate = item.assignedDate ?? item.assigned_date ?? "";

  return (
    <View style={[sc.card, { borderLeftColor: cfg.barColor }]}>
      <View style={sc.cardHead}>
        <View style={{ flex: 1, gap: 3 }}>
          {(item.subjectName ?? item.subject_name)
            ? <Text style={sc.subject}>📚 {item.subjectName ?? item.subject_name}</Text>
            : null}
          <Text style={sc.title}>{item.title}</Text>
        </View>
        <View style={[sc.statusPill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
          <Feather name={cfg.icon} size={12} color={cfg.color} />
          <Text style={[sc.statusTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>

      {item.description ? <Text style={sc.desc}>{item.description}</Text> : null}

      <View style={sc.metaRow}>
        {assignedDate ? (
          <View style={sc.metaChip}>
            <Feather name="edit-3" size={10} color="#64748b" />
            <Text style={sc.metaTxt}>Assigned: {fmtDisplay(assignedDate)}</Text>
          </View>
        ) : null}
        {dueDate ? (
          <View style={[sc.metaChip, isOverdue && sc.metaChipOverdue]}>
            <Feather name="calendar" size={10} color={isOverdue ? "#dc2626" : "#64748b"} />
            <Text style={[sc.metaTxt, isOverdue && { color: "#dc2626", fontWeight: "700" }]}>
              Due: {fmtDisplay(dueDate)}
            </Text>
            {isOverdue ? <Text style={sc.overdueTag}>OVERDUE</Text> : null}
          </View>
        ) : null}
      </View>

      {item.completionPercentage != null && (
        <View style={sc.pctRow}>
          <Text style={[sc.pctTxt, { color: cfg.color }]}>{item.completionPercentage}% done</Text>
          <View style={sc.pctBar}>
            <View style={[sc.pctFill, { width: `${item.completionPercentage}%`, backgroundColor: cfg.barColor }]} />
          </View>
        </View>
      )}

      {item.teacherRemarks ? (
        <View style={sc.remarksBox}>
          <Feather name="message-square" size={12} color="#7c3aed" />
          <Text style={sc.remarks}>{item.teacherRemarks}</Text>
        </View>
      ) : null}

      {item.markedAt && !PENDING_STATUSES.has(status) ? (
        <Text style={sc.markedAt}>Marked: {fmtDisplay(item.markedAt)}</Text>
      ) : null}
    </View>
  );
}

// ── Teacher homework card (compact) ──────────────────────────────────────────
function TeacherCard({ item }) {
  const cfg = STATUS_CFG[item.completionStatus ?? item.status] ?? STATUS_CFG.pending;
  const isOverdue = (item.dueDate ?? "") < TODAY && (item.completionStatus ?? item.status) !== "completed";
  return (
    <View style={[sc.card, { borderLeftColor: cfg.barColor }]}>
      {(item.subjectName) ? <Text style={sc.subject}>📚 {item.subjectName}</Text> : null}
      <Text style={sc.title}>{item.title}</Text>
      {item.description ? <Text style={sc.desc}>{item.description}</Text> : null}
      <View style={sc.metaRow}>
        <View style={[sc.metaChip, isOverdue && sc.metaChipOverdue]}>
          <Feather name="calendar" size={10} color={isOverdue ? "#dc2626" : "#64748b"} />
          <Text style={[sc.metaTxt, isOverdue && { color: "#dc2626", fontWeight: "700" }]}>
            Due: {fmtDisplay(item.dueDate)}
          </Text>
          {isOverdue ? <Text style={sc.overdueTag}>OVERDUE</Text> : null}
        </View>
      </View>
      {item.totalMarked != null && (
        <Text style={sc.teacherMeta}>
          {item.totalCompleted ?? 0} completed · {item.totalSubmitted ?? 0} submitted · {item.totalPending ?? 0} pending
        </Text>
      )}
    </View>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function Empty({ tab }) {
  const cfg = tab === "completed"
    ? { icon: "check-circle", title: "No completed homework", desc: "Homework you finish will appear here." }
    : { icon: "book-open",    title: "All clear!",            desc: "No pending homework right now." };
  return (
    <View style={sc.empty}>
      <Feather name={cfg.icon} size={48} color="#cbd5e1" />
      <Text style={sc.emptyTitle}>{cfg.title}</Text>
      <Text style={sc.emptyDesc}>{cfg.desc}</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function HomeworkStudentScreen({ navigation }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);

  const role         = (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim();
  const isTeacher    = role !== "student" && role !== "parent";
  const isAdminOwner = role === "admin" || role === "owner";
  const staffId      = user?.staffId ?? null;
  // For parents viewing a child's portal, activeEnrollmentId holds the child's ID.
  const enrollmentId  = activeEnrollmentId ?? user?.enrollmentId ?? user?.ssmsUserName ?? "";
  // useMemo prevents infinite re-render: inline object = new ref every render
  // → useCallback rebuilds → useFocusEffect re-fires → fetch → setState → repeat.
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  // ── Shared state ──
  const [homework,   setHomework]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── Student tab state ──
  const [activeTab,  setActiveTab]  = useState("pending");  // "pending" | "completed"
  const underlineX = useRef(new Animated.Value(0)).current;

  // ── Teacher state ──
  const [date,       setDate]       = useState(fmtISO(new Date()));
  const [showPicker, setShowPicker] = useState(false);
  const [classes,    setClasses]    = useState([]);
  const [sections,   setSections]   = useState([]);
  const [classId,    setClassId]    = useState("");
  const [sectionId,  setSectionId]  = useState("");

  // ── Tab animation ──
  const switchTab = (tab) => {
    setActiveTab(tab);
    Animated.spring(underlineX, {
      toValue: tab === "pending" ? 0 : 1,
      useNativeDriver: false,
    }).start();
  };

  // ── Load classes (teacher) ──
  useEffect(() => {
    if (!isTeacher) return;
    if (isAdminOwner) {
      fetchClasses(user).catch(() => []).then(cls =>
        setClasses(cls.map(c => ({ value: String(c.class_id ?? c.id), label: c.class_name ?? c.name })))
      );
    } else if (staffId) {
      fetchTeacherAssignments(user, staffId).catch(() => []).then(rows => {
        const seen = new Set();
        const cls  = [];
        rows.forEach(r => {
          if (r.class_id && !seen.has(r.class_id)) {
            seen.add(r.class_id);
            cls.push({ value: String(r.class_id), label: r.class_name ?? String(r.class_id) });
          }
        });
        setClasses(cls);
        if (cls.length > 0) setClassId(String(cls[0].value));
      });
    }
  }, [isTeacher, isAdminOwner, staffId]);

  // ── Load sections (teacher) ──
  useEffect(() => {
    if (!isTeacher || !classId) { setSections([]); setSectionId(""); return; }
    fetchSections(user, classId).catch(() => []).then(s => {
      const opts = s.map(x => ({ value: String(x.section_id ?? x.id), label: x.section_name ?? x.name }));
      setSections(opts);
      setSectionId(opts.length > 0 ? String(opts[0].value) : "");
    });
  }, [classId, isTeacher]);

  // ── Fetch ──
  const load = useCallback(async (d = date, quiet = false) => {
    if (!quiet) setLoading(true);
    else        setRefreshing(true);
    try {
      let rows = [];
      if (isTeacher) {
        if (!classId) { setHomework([]); return; }
        rows = await listHomework(user, { classId, sectionId: sectionId || undefined, date: d });
      } else {
        // No date passed → backend returns all active homework for the class
        rows = await getStudentHomework(effectiveUser, enrollmentId, null);
      }
      setHomework(rows);
    } catch {
      setHomework([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date, enrollmentId, effectiveUser, isTeacher, classId, sectionId]);

  useFocusEffect(useCallback(() => { load(date); }, [date, classId, sectionId]));

  const shift = (days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    const next = fmtISO(d);
    setDate(next);
    load(next);
  };

  // ── Split for student tabs ──
  const pendingList   = homework.filter(h => PENDING_STATUSES.has(h.completionStatus ?? h.status ?? "pending"));
  const completedList = homework.filter(h => COMPLETED_STATUSES.has(h.completionStatus ?? h.status));

  // Sort pending by due date ASC (most urgent first), overdue first
  pendingList.sort((a, b) => {
    const da = a.dueDate ?? a.due_date ?? "";
    const db = b.dueDate ?? b.due_date ?? "";
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
  });
  // Sort completed by markedAt DESC
  completedList.sort((a, b) => {
    const ma = a.markedAt ?? "";
    const mb = b.markedAt ?? "";
    if (ma > mb) return -1;
    if (ma < mb) return 1;
    return 0;
  });

  const overdueCount = pendingList.filter(h => (h.dueDate ?? h.due_date ?? "") < TODAY).length;
  const tabList = activeTab === "pending" ? pendingList : completedList;

  const teacherSummary = {
    total:   homework.length,
    done:    homework.filter(h => (h.completionStatus ?? h.status) === "completed").length,
    pending: homework.filter(h => (h.completionStatus ?? h.status) === "pending").length,
    overdue: homework.filter(h => (h.dueDate ?? "") < TODAY && (h.completionStatus ?? h.status) !== "completed").length,
  };

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>

      {/* Header */}
      <View style={sc.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <Text style={sc.headerTitle}>My Homework</Text>
      </View>

      {/* ── TEACHER UI ── */}
      {isTeacher && (
        <>
          <View style={sc.filters}>
            <View style={sc.filterCell}>
              <Text style={sc.filterLabel}>Class</Text>
              <Dropdown label="Class" value={classId} options={classes}
                onChange={v => { setClassId(v); setSectionId(""); }} placeholder="Select class" />
            </View>
            <View style={sc.filterCell}>
              <Text style={sc.filterLabel}>Section</Text>
              <Dropdown label="Section" value={sectionId} options={sections}
                onChange={setSectionId} disabled={!classId} placeholder="Select" />
            </View>
          </View>

          <View style={sc.dateNav}>
            <TouchableOpacity style={sc.arrowBtn} onPress={() => shift(-1)}>
              <Feather name="chevron-left" size={20} color="#1e40af" />
            </TouchableOpacity>
            <TouchableOpacity style={sc.dateBtn} onPress={() => setShowPicker(true)}>
              <Feather name="calendar" size={14} color="#2563eb" />
              <Text style={sc.dateTxt}>{date === TODAY ? "Today" : date}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sc.arrowBtn} onPress={() => shift(1)} disabled={date >= TODAY}>
              <Feather name="chevron-right" size={20} color={date >= TODAY ? "#cbd5e1" : "#1e40af"} />
            </TouchableOpacity>
          </View>

          {showPicker && (
            <DateTimePicker value={new Date(date)} mode="date" maximumDate={new Date()} display="default"
              onChange={(_, d) => { setShowPicker(false); if (d) { const s = fmtISO(d); setDate(s); load(s); } }} />
          )}

          {!loading && homework.length > 0 && (
            <View style={sc.strip}>
              {[
                { n: teacherSummary.total,   l: "Tasks",  c: "#334155" },
                { n: teacherSummary.done,    l: "Done",   c: "#15803d" },
                { n: teacherSummary.pending, l: "Pending",c: "#92400e" },
                ...(teacherSummary.overdue > 0 ? [{ n: teacherSummary.overdue, l: "Overdue", c: "#dc2626" }] : []),
              ].map(s => (
                <View key={s.l} style={sc.stripItem}>
                  <Text style={[sc.stripN, { color: s.c }]}>{s.n}</Text>
                  <Text style={sc.stripL}>{s.l}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* ── STUDENT / PARENT: Tab bar ── */}
      {!isTeacher && (
        <View style={sc.tabBar}>
          <TouchableOpacity style={sc.tab} onPress={() => switchTab("pending")} activeOpacity={0.7}>
            <View style={sc.tabInner}>
              <Text style={[sc.tabTxt, activeTab === "pending" && sc.tabTxtActive]}>Pending</Text>
              {pendingList.length > 0 && (
                <View style={[sc.tabBadge, activeTab === "pending" ? sc.tabBadgeActive : sc.tabBadgeInactive]}>
                  <Text style={[sc.tabBadgeTxt, activeTab === "pending" && { color: "#fff" }]}>
                    {pendingList.length}
                  </Text>
                </View>
              )}
              {overdueCount > 0 && activeTab !== "pending" && (
                <View style={sc.overdueIndicator} />
              )}
            </View>
            {activeTab === "pending" && <View style={sc.tabUnderline} />}
          </TouchableOpacity>

          <TouchableOpacity style={sc.tab} onPress={() => switchTab("completed")} activeOpacity={0.7}>
            <View style={sc.tabInner}>
              <Text style={[sc.tabTxt, activeTab === "completed" && sc.tabTxtActive]}>Completed</Text>
              {completedList.length > 0 && (
                <View style={[sc.tabBadge, activeTab === "completed" ? sc.tabBadgeGreen : sc.tabBadgeInactive]}>
                  <Text style={[sc.tabBadgeTxt, activeTab === "completed" && { color: "#fff" }]}>
                    {completedList.length}
                  </Text>
                </View>
              )}
            </View>
            {activeTab === "completed" && <View style={[sc.tabUnderline, { backgroundColor: "#22c55e" }]} />}
          </TouchableOpacity>
        </View>
      )}

      {/* ── STUDENT: overdue banner ── */}
      {!isTeacher && overdueCount > 0 && activeTab === "pending" && (
        <View style={sc.overdueBanner}>
          <Feather name="alert-triangle" size={13} color="#fff" />
          <Text style={sc.overdueBannerTxt}>
            {overdueCount} overdue homework{overdueCount > 1 ? "s" : ""} — submit as soon as possible
          </Text>
        </View>
      )}

      {/* Content */}
      {loading
        ? <ActivityIndicator style={{ marginTop: 60 }} size="large" color="#2563eb" />
        : (
          <ScrollView
            contentContainerStyle={sc.scroll}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load(date, true)}
                colors={["#2563eb"]} tintColor="#2563eb"
              />
            }
          >
            {isTeacher
              ? (
                !classId
                  ? (
                    <View style={sc.empty}>
                      <Feather name="book" size={48} color="#cbd5e1" />
                      <Text style={sc.emptyTitle}>Select a class</Text>
                      <Text style={sc.emptyDesc}>Choose a class above to view homework.</Text>
                    </View>
                  )
                  : homework.length === 0
                    ? (
                      <View style={sc.empty}>
                        <Feather name="book-open" size={48} color="#cbd5e1" />
                        <Text style={sc.emptyTitle}>No homework for this day</Text>
                        <Text style={sc.emptyDesc}>{date === TODAY ? "Nothing assigned today." : "Nothing was assigned on this date."}</Text>
                      </View>
                    )
                    : homework.map(hw => <TeacherCard key={hw.id} item={hw} />)
              )
              : (
                tabList.length === 0
                  ? <Empty tab={activeTab} />
                  : tabList.map((hw, i) => <HomeworkCard key={hw.id ?? i} item={hw} />)
              )
            }
          </ScrollView>
        )
      }
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },
  header:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: "#0f172a" },

  // ── Teacher filters ──
  filters:     { flexDirection: "row", gap: 8, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  filterCell:  { flex: 1 },
  filterLabel: { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase", marginBottom: 4 },
  dateNav:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  arrowBtn:    { padding: 6 },
  dateBtn:     { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#eff6ff", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  dateTxt:     { fontSize: 14, fontWeight: "700", color: "#1e40af" },
  strip:       { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingVertical: 8 },
  stripItem:   { flex: 1, alignItems: "center" },
  stripN:      { fontSize: 20, fontWeight: "800" },
  stripL:      { fontSize: 9, color: "#94a3b8", marginTop: 1 },
  teacherMeta: { fontSize: 11, color: "#64748b", marginTop: 2 },

  // ── Student tabs ──
  tabBar:            { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tab:               { flex: 1, alignItems: "center", paddingTop: 12, paddingBottom: 0 },
  tabInner:          { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 10 },
  tabTxt:            { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  tabTxtActive:      { color: "#2563eb" },
  tabUnderline:      { height: 3, width: "80%", borderRadius: 2, backgroundColor: "#2563eb", marginTop: 0 },
  tabBadge:          { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  tabBadgeActive:    { backgroundColor: "#2563eb" },
  tabBadgeGreen:     { backgroundColor: "#22c55e" },
  tabBadgeInactive:  { backgroundColor: "#e2e8f0" },
  tabBadgeTxt:       { fontSize: 11, fontWeight: "800", color: "#64748b" },
  overdueIndicator:  { width: 8, height: 8, borderRadius: 4, backgroundColor: "#dc2626", position: "absolute", top: -4, right: -4 },

  // ── Overdue banner ──
  overdueBanner:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#dc2626", paddingHorizontal: 14, paddingVertical: 8 },
  overdueBannerTxt: { fontSize: 12, fontWeight: "700", color: "#fff", flex: 1 },

  scroll:  { padding: 14, paddingBottom: 40, gap: 0 },

  // ── Card ──
  card:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 4, gap: 8, marginBottom: 10, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardHead:   { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  subject:    { fontSize: 11, fontWeight: "700", color: "#2563eb" },
  title:      { fontSize: 15, fontWeight: "800", color: "#0f172a", lineHeight: 21 },
  desc:       { fontSize: 13, color: "#475569", lineHeight: 19 },

  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  statusTxt:  { fontSize: 11, fontWeight: "700" },

  metaRow:        { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f8fafc", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#e2e8f0" },
  metaChipOverdue:{ backgroundColor: "#fff1f2", borderColor: "#fecaca" },
  metaTxt:        { fontSize: 11, color: "#64748b" },
  overdueTag:     { fontSize: 9, fontWeight: "800", color: "#dc2626", textTransform: "uppercase" },

  pctRow:   { gap: 4 },
  pctTxt:   { fontSize: 11, fontWeight: "700" },
  pctBar:   { height: 6, backgroundColor: "#f1f5f9", borderRadius: 3, overflow: "hidden" },
  pctFill:  { height: "100%", borderRadius: 3 },

  remarksBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "#faf5ff", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#e9d5ff" },
  remarks:    { flex: 1, fontSize: 12, color: "#5b21b6", lineHeight: 17 },
  markedAt:   { fontSize: 10, color: "#94a3b8" },

  empty:      { paddingTop: 80, alignItems: "center", gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#64748b" },
  emptyDesc:  { fontSize: 13, color: "#94a3b8" },
});

const dd = StyleSheet.create({
  trigger:    { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#f8fafc", gap: 4 },
  disabled:   { opacity: 0.5 },
  val:        { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "600" },
  ph:         { flex: 1, fontSize: 13, color: "#94a3b8" },
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 30, maxHeight: "60%" },
  sheetTitle: { fontSize: 14, fontWeight: "800", color: "#0f172a", padding: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  opt:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  optSel:     { backgroundColor: "#eff6ff" },
  optTxt:     { flex: 1, fontSize: 14, color: "#334155" },
  optSelTxt:  { color: "#2563eb", fontWeight: "700" },
});
