/**
 * screens/Exams/MyTestSeriesScreen.js
 * Student view — browse enrolled test series and launch tests.
 */
import React, { useState, useContext, useCallback, useRef, useMemo } from "react";
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  Modal, Alert, ActivityIndicator, ScrollView, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getMySeriesList, getMyTests } from "../../services/TestSeriesServiceApi";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(str) {
  if (!str) return "—";
  // MySQL returns "YYYY-MM-DD HH:MM:SS" — replace space with T so all JS engines parse it
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d)) return String(str);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Returns status object for a test given now. */
function getTestStatus(test) {
  const now   = Date.now();
  // Backend columns: scheduled_start / scheduled_end (MySQL DATETIME "YYYY-MM-DD HH:MM:SS")
  // Replace space with T so all JS engines parse it correctly
  const toMs  = (s) => s ? new Date(String(s).replace(' ', 'T')).getTime() : null;
  const start = toMs(test.scheduled_start);
  const end   = toMs(test.scheduled_end);

  // attempt_status and attempt_id come back as flat columns on the test row
  if (test.attempt_status === 'submitted') {
    return { key: "COMPLETED", label: "Completed", color: "#2563eb", bgColor: "#eff6ff", icon: "check-circle" };
  }
  if (test.attempt_status === 'in_progress') {
    return { key: "IN_PROGRESS", label: "In Progress", color: "#d97706", bgColor: "#fffbeb", icon: "rotate-ccw" };
  }
  if (start && now < start) {
    return { key: "UPCOMING", label: "Upcoming", color: "#64748b", bgColor: "#f1f5f9", icon: "clock" };
  }
  if (start && end && now >= start && now <= end) {
    return { key: "LIVE", label: "Live Now", color: "#16a34a", bgColor: "#f0fdf4", icon: "zap" };
  }
  if (!start && !end) {
    // No schedule set — always open (treat as live if attempt not started)
    return { key: "LIVE", label: "Open", color: "#16a34a", bgColor: "#f0fdf4", icon: "zap" };
  }
  if (end && now > end) {
    return { key: "ENDED", label: "Ended", color: "#dc2626", bgColor: "#fef2f2", icon: "x-circle" };
  }
  return { key: "UPCOMING", label: "Upcoming", color: "#64748b", bgColor: "#f1f5f9", icon: "clock" };
}

// ── Exam type badge colours ───────────────────────────────────────────────────
const TYPE_COLORS = {
  JEE:    { bg: "#eff6ff", fg: "#2563eb" },
  NEET:   { bg: "#fdf4ff", fg: "#9333ea" },
  Board:  { bg: "#f0fdf4", fg: "#16a34a" },
  School: { bg: "#fff7ed", fg: "#ea580c" },
  Other:  { bg: "#f8fafc", fg: "#475569" },
};

function ExamTypeBadge({ type }) {
  if (!type) return null;
  const upper = type.toUpperCase();
  const { bg, fg } = TYPE_COLORS[upper] ?? TYPE_COLORS[type] ?? TYPE_COLORS.Other;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeTxt, { color: fg }]}>{upper}</Text>
    </View>
  );
}

// ── Pulsing dot for LIVE status ───────────────────────────────────────────────
function LiveDot() {
  const anim = useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[s.liveDot, { opacity: anim }]} />
  );
}

// ── Test card inside the sheet ────────────────────────────────────────────────
function TestCard({ test, onPress }) {
  const status = getTestStatus(test);
  const isLive       = status.key === "LIVE";
  const isCompleted  = status.key === "COMPLETED";
  const isInProgress = status.key === "IN_PROGRESS";
  const isEnded      = status.key === "ENDED";
  const canTap       = isLive || isCompleted || isInProgress;

  return (
    <TouchableOpacity
      style={[s.testCard, !canTap && s.testCardDimmed]}
      onPress={() => canTap && onPress(test, status)}
      activeOpacity={canTap ? 0.75 : 1}
    >
      <View style={s.testCardLeft}>
        <View style={s.testCardHeader}>
          <Text style={s.testTitle} numberOfLines={2}>{test.title ?? "Untitled Test"}</Text>
          <View style={[s.statusPill, { backgroundColor: status.bgColor }]}>
            {isLive && <LiveDot />}
            <Feather name={status.icon} size={10} color={status.color} />
            <Text style={[s.statusTxt, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        <View style={s.testMeta}>
          <View style={s.metaItem}>
            <Feather name="clock" size={11} color="#94a3b8" />
            <Text style={s.metaTxt}>{test.duration_minutes ?? "—"} min</Text>
          </View>
          <View style={s.metaDivider} />
          <View style={s.metaItem}>
            <Feather name="award" size={11} color="#94a3b8" />
            <Text style={s.metaTxt}>{test.total_marks ?? "—"} marks</Text>
          </View>
          {(test.question_count ?? test.total_questions) != null && (
            <>
              <View style={s.metaDivider} />
              <View style={s.metaItem}>
                <Feather name="list" size={11} color="#94a3b8" />
                <Text style={s.metaTxt}>{test.question_count ?? test.total_questions} Qs</Text>
              </View>
            </>
          )}
        </View>

        <View style={s.scheduleRow}>
          <Feather name="calendar" size={10} color="#94a3b8" />
          <Text style={s.scheduleTxt}>
            {fmtDateTime(test.scheduled_start)}
            {test.scheduled_end ? ` – ${fmtDateTime(test.scheduled_end)}` : ""}
          </Text>
        </View>
      </View>

      {canTap && (
        <View style={[s.testAction, {
          backgroundColor: isCompleted ? "#eff6ff" : isInProgress ? "#fffbeb" : "#f0fdf4"
        }]}>
          <Feather
            name={isCompleted ? "bar-chart-2" : isInProgress ? "rotate-ccw" : "play-circle"}
            size={20}
            color={isCompleted ? "#2563eb" : isInProgress ? "#d97706" : "#16a34a"}
          />
          <Text style={[s.testActionTxt, {
            color: isCompleted ? "#2563eb" : isInProgress ? "#d97706" : "#16a34a"
          }]}>
            {isCompleted ? "Result" : isInProgress ? "Resume" : "Start"}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function MyTestSeriesScreen({ navigation }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);
  // For parent users viewing a child's portal, inject the child's enrollment ID
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [series,       setSeries]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [activeSeries, setActiveSeries] = useState(null);
  const [tests,        setTests]        = useState([]);
  const [testsLoading, setTestsLoading] = useState(false);

  // ── Load series ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!effectiveUser) return;
    try {
      setLoading(true);
      const res = await getMySeriesList(effectiveUser);
      setSeries(Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load test series");
    } finally {
      setLoading(false);
    }
  }, [effectiveUser]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Open series sheet ────────────────────────────────────────────────────────
  const openSeries = async (item) => {
    setActiveSeries(item);
    setSheetVisible(true);
    setTests([]);
    try {
      setTestsLoading(true);
      const res = await getMyTests(effectiveUser, item.id ?? item.series_id);
      setTests(Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : []);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load tests");
    } finally {
      setTestsLoading(false);
    }
  };

  // ── Handle test tap ──────────────────────────────────────────────────────────
  const handleTestTap = (test, status) => {
    if (status.key === "COMPLETED") {
      // attempt_id comes back as a flat column from the getMyTests query
      const attemptId = test.attempt_id ?? test.my_attempt?.attempt_id ?? test.my_attempt?.id;
      if (!attemptId) {
        Alert.alert("No result", "Result data is not available yet.");
        return;
      }
      setSheetVisible(false);
      navigation.navigate("TestResult", { attemptId, test });
    } else if (status.key === "LIVE" || status.key === "IN_PROGRESS") {
      setSheetVisible(false);
      navigation.navigate("TestLobby", { test });
    }
  };

  // ── Series card ──────────────────────────────────────────────────────────────
  const renderSeries = ({ item }) => (
    <TouchableOpacity style={s.seriesCard} onPress={() => openSeries(item)} activeOpacity={0.8}>
      <View style={s.seriesCardAccent} />
      <View style={s.seriesCardBody}>
        <View style={s.seriesRow}>
          <Text style={s.seriesTitle} numberOfLines={1}>{item.name ?? item.title ?? "Series"}</Text>
          <ExamTypeBadge type={item.exam_type} />
        </View>
        {!!item.description && (
          <Text style={s.seriesDesc} numberOfLines={2}>{item.description}</Text>
        )}
        <View style={s.seriesMeta}>
          {item.total_tests != null && (
            <View style={s.metaItem}>
              <Feather name="layers" size={11} color="#94a3b8" />
              <Text style={s.metaTxt}>{item.total_tests} Tests</Text>
            </View>
          )}
          {item.class_name && (
            <>
              {item.total_tests != null && <View style={s.metaDivider} />}
              <View style={s.metaItem}>
                <Feather name="users" size={11} color="#94a3b8" />
                <Text style={s.metaTxt}>{item.class_name}</Text>
              </View>
            </>
          )}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color="#cbd5e1" />
    </TouchableOpacity>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color="#2563eb" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>My Test Series</Text>
          <Text style={s.headerSub}>Tap a series to view its tests</Text>
        </View>
        <TouchableOpacity onPress={load} style={s.refreshBtn}>
          <Feather name="refresh-cw" size={16} color="#64748b" />
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={s.loadingTxt}>Loading series…</Text>
        </View>
      ) : (
        <FlatList
          data={series}
          keyExtractor={(item, i) => String(item.id ?? item.series_id ?? i)}
          renderItem={renderSeries}
          contentContainerStyle={s.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="library-books" size={48} color="#cbd5e1" />
              <Text style={s.emptyTxt}>No test series assigned</Text>
              <Text style={s.emptySub}>Your enrolled series will appear here</Text>
            </View>
          }
        />
      )}

      {/* Tests bottom sheet */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <TouchableOpacity
          style={s.sheetOverlay}
          activeOpacity={1}
          onPress={() => setSheetVisible(false)}
        />
        <View style={s.sheet}>
          {/* Sheet header */}
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetTitle} numberOfLines={1}>
                {activeSeries?.name ?? activeSeries?.title ?? "Tests"}
              </Text>
              {activeSeries?.exam_type && (
                <ExamTypeBadge type={activeSeries.exam_type} />
              )}
            </View>
            <TouchableOpacity
              onPress={() => setSheetVisible(false)}
              style={s.sheetClose}
            >
              <Feather name="x" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Tests list */}
          {testsLoading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color="#2563eb" />
              <Text style={s.loadingTxt}>Loading tests…</Text>
            </View>
          ) : tests.length === 0 ? (
            <View style={s.empty}>
              <Feather name="inbox" size={40} color="#cbd5e1" />
              <Text style={s.emptyTxt}>No tests yet</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={s.sheetContent} showsVerticalScrollIndicator={false}>
              {tests.map((test, idx) => (
                <TestCard
                  key={String(test.test_id ?? test.id ?? idx)}
                  test={test}
                  onPress={handleTestTap}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: "#f8fafc" },

  // Header
  header:         { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:        { padding: 4 },
  headerTitle:    { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  headerSub:      { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  refreshBtn:     { padding: 8, borderRadius: 10, backgroundColor: "#f1f5f9" },

  // Series card
  listContent:    { padding: 16, paddingBottom: 40 },
  seriesCard:     { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  seriesCardAccent: { width: 4, alignSelf: "stretch", backgroundColor: "#2563eb" },
  seriesCardBody: { flex: 1, padding: 14 },
  seriesRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" },
  seriesTitle:    { flex: 1, fontSize: 14, fontWeight: "800", color: "#0f172a" },
  seriesDesc:     { fontSize: 12, color: "#64748b", lineHeight: 17, marginBottom: 8 },
  seriesMeta:     { flexDirection: "row", alignItems: "center", gap: 6 },

  badge:          { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  badgeTxt:       { fontSize: 10, fontWeight: "700" },

  metaItem:       { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:        { fontSize: 11, color: "#64748b" },
  metaDivider:    { width: 3, height: 3, borderRadius: 2, backgroundColor: "#cbd5e1" },

  // Loading / empty
  center:         { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 60 },
  loadingTxt:     { color: "#64748b", fontSize: 13 },
  empty:          { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:       { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySub:       { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Sheet
  sheetOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet:          { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%", paddingBottom: 30 },
  sheetHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: "#cbd5e1", alignSelf: "center", marginTop: 10, marginBottom: 6 },
  sheetHeader:    { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  sheetTitle:     { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  sheetClose:     { width: 28, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  sheetContent:   { padding: 16, gap: 10 },

  // Test card
  testCard:       { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 14, flexDirection: "row", alignItems: "center", gap: 12, elevation: 1, shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  testCardDimmed: { opacity: 0.75 },
  testCardLeft:   { flex: 1 },
  testCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  testTitle:      { flex: 1, fontSize: 13, fontWeight: "700", color: "#0f172a", lineHeight: 18 },
  statusPill:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusTxt:      { fontSize: 10, fontWeight: "700" },
  liveDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: "#16a34a" },
  testMeta:       { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  scheduleRow:    { flexDirection: "row", alignItems: "center", gap: 4 },
  scheduleTxt:    { fontSize: 10, color: "#94a3b8" },

  testAction:     { alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 4, minWidth: 54 },
  testActionTxt:  { fontSize: 10, fontWeight: "700" },
});
