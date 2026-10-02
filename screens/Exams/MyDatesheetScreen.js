/**
 * screens/Exams/MyDatesheetScreen.js
 *
 * Student / Parent view — published exam date sheets for their class.
 * Shows all published exams with a day-by-day schedule + countdown.
 */
import React, { useState, useContext, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import { AuthContext }        from "../../context/AuthContext";
import { fetchMyDatesheet }   from "../../services/DatesheetServiceApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(ymd) {
  if (!ymd) return "—";
  const d = new Date(ymd + "T00:00:00");
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtTime(t) {
  if (!t) return null;
  // Convert 24h "09:00" → "9:00 AM"
  const [hh, mm] = t.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h    = hh % 12 || 12;
  return `${h}:${String(mm ?? 0).padStart(2,"0")} ${ampm}`;
}

function daysUntil(ymd) {
  if (!ymd) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const exam  = new Date(ymd + "T00:00:00");
  const diff  = Math.round((exam - today) / 86400000);
  return diff;
}

// Subject color palette (cycles)
const COLORS = [
  ["#4f46e5","#ede9fe"], ["#0ea5e9","#e0f2fe"], ["#16a34a","#dcfce7"],
  ["#f59e0b","#fef3c7"], ["#dc2626","#fee2e2"], ["#7c3aed","#f5f3ff"],
  ["#0891b2","#cffafe"], ["#d97706","#fef9c3"],
];

function subjectColor(idx) {
  return COLORS[idx % COLORS.length];
}

// ── Subject row ───────────────────────────────────────────────────────────────

function SubjectRow({ entry, idx, isNext }) {
  const [accent, bg] = subjectColor(idx);
  const days  = daysUntil(entry.exam_date);
  const isPast = days !== null && days < 0;

  return (
    <View style={[dr.card, isPast && dr.cardPast, isNext && { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      {/* Left: date block */}
      <View style={[dr.dateBlock, { backgroundColor: isPast ? "#f1f5f9" : bg }]}>
        {entry.exam_date ? (
          <>
            <Text style={[dr.dateDay, { color: isPast ? "#94a3b8" : accent }]}>
              {new Date(entry.exam_date + "T00:00:00").getDate()}
            </Text>
            <Text style={[dr.dateMon, { color: isPast ? "#94a3b8" : accent }]}>
              {MONTHS[new Date(entry.exam_date + "T00:00:00").getMonth()]}
            </Text>
          </>
        ) : (
          <Text style={dr.dateNone}>—</Text>
        )}
      </View>

      {/* Right: info */}
      <View style={dr.info}>
        <Text style={[dr.subjectName, isPast && { color: "#94a3b8" }]} numberOfLines={2}>
          {entry.subject_name}
        </Text>
        <Text style={dr.dayName}>
          {entry.exam_date ? new Date(entry.exam_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" }) : ""}
        </Text>
        {(entry.start_time || entry.end_time) && (
          <View style={dr.timeRow}>
            <Feather name="clock" size={12} color="#64748b" />
            <Text style={dr.timeTxt}>
              {entry.start_time ? fmtTime(entry.start_time) : ""}
              {entry.start_time && entry.end_time ? " – " : ""}
              {entry.end_time   ? fmtTime(entry.end_time)   : ""}
            </Text>
          </View>
        )}
        {entry.venue ? (
          <View style={dr.timeRow}>
            <Feather name="map-pin" size={12} color="#64748b" />
            <Text style={dr.timeTxt}>{entry.venue}</Text>
          </View>
        ) : null}
      </View>

      {/* Countdown badge */}
      {!isPast && days !== null && (
        <View style={[dr.badge, { backgroundColor: days === 0 ? "#dc2626" : days <= 3 ? "#f59e0b" : "#e0f2fe" }]}>
          <Text style={[dr.badgeTxt, { color: days === 0 ? "#fff" : days <= 3 ? "#fff" : "#0369a1" }]}>
            {days === 0 ? "Today" : `${days}d`}
          </Text>
        </View>
      )}
      {isPast && (
        <View style={[dr.badge, { backgroundColor: "#f1f5f9" }]}>
          <Text style={[dr.badgeTxt, { color: "#94a3b8" }]}>Done</Text>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function MyDatesheetScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [exams,       setExams]       = useState([]);  // [{exam_id, exam_name, entries[]}]
  const [activeIdx,   setActiveIdx]   = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true); else setLoading(true);
      const data = await fetchMyDatesheet(user);
      setExams(Array.isArray(data) ? data : []);
      setActiveIdx(0);
    } catch (e) {
      // Silently fail — show empty state
      setExams([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const activeExam = exams[activeIdx] ?? null;

  // Find next upcoming exam slot
  const nextEntry = activeExam?.entries?.find(e => {
    const d = daysUntil(e.exam_date);
    return d !== null && d >= 0;
  }) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: "#f8fafc" }}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <Text style={st.headerTitle}>My Exam Schedule</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1e40af" style={{ marginTop: 60 }} />
      ) : exams.length === 0 ? (
        <View style={st.empty}>
          <MaterialIcons name="event-note" size={52} color="#c7d2fe" />
          <Text style={st.emptyTitle}>No Date Sheet Yet</Text>
          <Text style={st.emptySubtitle}>
            Your school hasn't published an exam schedule yet. Check back soon.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={["#1e40af"]} />}
        >
          {/* Exam tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.examTabs}>
            {exams.map((ex, i) => (
              <TouchableOpacity
                key={ex.exam_id}
                style={[st.examTab, i === activeIdx && st.examTabActive]}
                onPress={() => setActiveIdx(i)}
              >
                <Text style={[st.examTabTxt, i === activeIdx && st.examTabTxtActive]}>
                  {ex.exam_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Next exam countdown */}
          {nextEntry && (
            <View style={st.nextBanner}>
              <View style={st.nextLeft}>
                <Text style={st.nextLabel}>NEXT EXAM</Text>
                <Text style={st.nextSubject}>{nextEntry.subject_name}</Text>
                <Text style={st.nextDate}>{fmtDate(nextEntry.exam_date)}</Text>
                {nextEntry.start_time && (
                  <Text style={st.nextTime}>
                    {fmtTime(nextEntry.start_time)}
                    {nextEntry.end_time ? ` – ${fmtTime(nextEntry.end_time)}` : ""}
                  </Text>
                )}
              </View>
              <View style={st.countdownBox}>
                <Text style={st.countdownNum}>{daysUntil(nextEntry.exam_date)}</Text>
                <Text style={st.countdownLabel}>days{"\n"}to go</Text>
              </View>
            </View>
          )}

          {/* Full schedule list */}
          <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 32 }}>
            <Text style={st.scheduleTitle}>
              Full Schedule  ·  {activeExam?.entries?.length ?? 0} subjects
            </Text>
            {activeExam?.entries?.map((entry, idx) => (
              <SubjectRow
                key={entry.subject_id}
                entry={entry}
                idx={idx}
                isNext={entry === nextEntry}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 14, paddingTop: 52, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:      { padding: 4, marginRight: 8 },
  headerTitle:  { fontSize: 17, fontWeight: "800", color: "#0f172a" },

  empty:        { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingTop: 60, gap: 12 },
  emptyTitle:   { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  emptySubtitle:{ fontSize: 13, color: "#64748b", textAlign: "center", lineHeight: 20 },

  examTabs:     { paddingHorizontal: 12, paddingVertical: 10 },
  examTab:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 8, borderWidth: 1, borderColor: "#e2e8f0" },
  examTabActive:{ backgroundColor: "#1e40af", borderColor: "#1e40af" },
  examTabTxt:   { fontSize: 13, fontWeight: "600", color: "#475569" },
  examTabTxtActive: { color: "#fff" },

  nextBanner:   { flexDirection: "row", alignItems: "center", backgroundColor: "#1e40af", marginHorizontal: 12, borderRadius: 16, padding: 16, marginBottom: 8 },
  nextLeft:     { flex: 1 },
  nextLabel:    { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.7)", letterSpacing: 1, marginBottom: 4 },
  nextSubject:  { fontSize: 18, fontWeight: "900", color: "#fff", marginBottom: 2 },
  nextDate:     { fontSize: 13, color: "rgba(255,255,255,0.85)", marginBottom: 2 },
  nextTime:     { fontSize: 12, color: "rgba(255,255,255,0.7)" },
  countdownBox: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  countdownNum: { fontSize: 36, fontWeight: "900", color: "#fff" },
  countdownLabel:{ fontSize: 11, color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 16 },

  scheduleTitle:{ fontSize: 11, fontWeight: "700", color: "#94a3b8", letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
});

const dr = StyleSheet.create({
  card:        { flexDirection: "row", backgroundColor: "#fff", borderRadius: 14, marginBottom: 8, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 2, borderLeftColor: "#e2e8f0" },
  cardPast:    { opacity: 0.65 },
  dateBlock:   { width: 56, alignItems: "center", justifyContent: "center", paddingVertical: 14 },
  dateDay:     { fontSize: 22, fontWeight: "900" },
  dateMon:     { fontSize: 11, fontWeight: "700" },
  dateNone:    { fontSize: 18, color: "#94a3b8" },
  info:        { flex: 1, paddingVertical: 12, paddingHorizontal: 12 },
  subjectName: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 2 },
  dayName:     { fontSize: 11, color: "#64748b", marginBottom: 4 },
  timeRow:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  timeTxt:     { fontSize: 12, color: "#475569" },
  badge:       { alignSelf: "center", marginRight: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeTxt:    { fontSize: 11, fontWeight: "700" },
});
