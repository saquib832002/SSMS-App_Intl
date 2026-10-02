/**
 * screens/Exams/TestLobbyScreen.js
 * Pre-exam lobby shown before the student starts a test.
 * Route params: { test }
 */
import React, { useState, useContext, useMemo, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { startAttempt, getSections } from "../../services/TestSeriesServiceApi";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Detail row card ───────────────────────────────────────────────────────────
function DetailCard({ icon, label, value, iconColor = "#2563eb" }) {
  return (
    <View style={s.detailCard}>
      <View style={[s.detailIcon, { backgroundColor: iconColor + "18" }]}>
        <Feather name={icon} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={s.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TestLobbyScreen({ navigation, route }) {
  const { test } = route.params ?? {};
  const { user, activeEnrollmentId } = useContext(AuthContext);
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [starting,        setStarting]        = useState(false);
  const [sections,        setSections]        = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  const testId = test?.test_id ?? test?.id;

  useEffect(() => {
    if (!testId) return;
    setSectionsLoading(true);
    getSections(user, testId)
      .then((res) => setSections(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {})
      .finally(() => setSectionsLoading(false));
  }, [testId]);

  const alreadySubmitted =
    test?.attempt_status === "submitted" || test?.my_attempt?.is_submitted == 1;

  const hasInProgressAttempt = test?.attempt_status === "in_progress";

  // ── Start attempt ────────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!test) return;
    try {
      setStarting(true);
      const res = await startAttempt(effectiveUser, test.test_id ?? test.id);
      const data = res.data ?? res;
      navigation.replace("TestAttempt", {
        attemptId:         data.attempt_id ?? data.id,
        testId:            test.test_id ?? test.id,
        questions:         Array.isArray(data.questions) ? data.questions : [],
        test,
        existingResponses: data.saved_responses ?? data.responses ?? [],
        startedAt:         data.started_at   ?? null,
        serverTime:        data.server_time  ?? null,
        // Server pre-computes the remaining seconds (works for old records too)
        timeRemaining:     typeof data.time_remaining_seconds === "number"
                             ? data.time_remaining_seconds
                             : null,
      });
    } catch (e) {
      Alert.alert("Error", e.message || "Could not start test. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const handleViewResult = () => {
    const attemptId = test?.my_attempt?.attempt_id ?? test?.my_attempt?.id;
    if (!attemptId) {
      Alert.alert("Not available", "Result data is not available yet.");
      return;
    }
    navigation.navigate("TestResult", { attemptId, test });
  };

  if (!test) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={{ color: "#fff", fontSize: 15 }}>No test data found.</Text>
      </View>
    );
  }

  const negRatio = parseFloat(test.negative_marking_ratio ?? 0);

  // Derive negative marking display from sections (more accurate) or fall back to test-level field
  const negativeMarkingText = (() => {
    if (sections.length > 0) {
      // Collect unique negative_per_question values > 0 across sections
      const negVals = [
        ...new Set(
          sections
            .map(s => parseFloat(s.negative_per_question ?? 0))
            .filter(v => v > 0)
            .map(v => String(v))
        ),
      ];
      if (negVals.length === 0) return "No negative marking";
      if (negVals.length === 1) return `Yes (−${negVals[0]} per wrong answer)`;
      return `Yes (varies by section: −${negVals.join(", −")})`;
    }
    // Sections not yet loaded — fall back to test-level field while loading
    if (sectionsLoading) return "Loading…";
    if (negRatio > 0) return `Yes (−${negRatio} per wrong answer)`;
    return "No negative marking";
  })();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* Back */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color="#94a3b8" />
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Title block */}
          <View style={s.titleBlock}>
            <View style={s.titleIconWrap}>
              <MaterialIcons name="assignment" size={28} color="#2563eb" />
            </View>
            <Text style={s.testTitle}>{test.title ?? "Test"}</Text>
            {!!test.series_name && (
              <Text style={s.seriesName}>{test.series_name}</Text>
            )}
          </View>

          {/* Exam details */}
          <Text style={s.sectionLabel}>Exam Details</Text>
          <View style={s.detailsGrid}>
            <DetailCard
              icon="clock"
              label="Duration"
              value={`${test.duration_minutes ?? "—"} minutes`}
              iconColor="#2563eb"
            />
            <DetailCard
              icon="list"
              label="Total Questions"
              value={String(test.question_count ?? test.total_questions ?? "—")}
              iconColor="#7c3aed"
            />
            <DetailCard
              icon="award"
              label="Total Marks"
              value={String(test.total_marks ?? "—")}
              iconColor="#ea580c"
            />
            <DetailCard
              icon="check-square"
              label="Passing Marks"
              value={String(test.passing_marks ?? "—")}
              iconColor="#16a34a"
            />
            {sections.length > 0 && (
              <DetailCard
                icon="layers"
                label="Sections"
                value={`${sections.length} section${sections.length !== 1 ? "s" : ""}`}
                iconColor="#7c3aed"
              />
            )}
            <DetailCard
              icon="minus-circle"
              label="Negative Marking"
              value={negativeMarkingText}
              iconColor={negRatio > 0 ? "#dc2626" : "#64748b"}
            />
            <DetailCard
              icon="calendar"
              label="Scheduled"
              value={`${fmtDateTime(test.scheduled_start)} → ${fmtDateTime(test.scheduled_end)}`}
              iconColor="#0891b2"
            />
          </View>

          {/* Instructions */}
          {!!test.instructions && (
            <>
              <Text style={s.sectionLabel}>Instructions</Text>
              <View style={s.instrBox}>
                <Text style={s.instrTxt}>{test.instructions}</Text>
              </View>
            </>
          )}

          {/* Sections */}
          {sections.length > 0 && (
            <>
              <Text style={s.sectionLabel}>Sections</Text>
              {sections.map((sec, idx) => (
                <View key={String(sec.id ?? idx)} style={s.sectionRow}>
                  <View style={s.sectionDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.sectionName}>{sec.section_name ?? sec.name}</Text>
                    <Text style={s.sectionInstr}>
                      {sec.question_count ?? 0} question{(sec.question_count ?? 0) !== 1 ? "s" : ""}
                      {" · "}+{sec.marks_per_question ?? 1} / Q
                      {parseFloat(sec.negative_per_question ?? 0) > 0
                        ? `  ·  −${sec.negative_per_question} / wrong`
                        : ""}
                    </Text>
                  </View>
                  <View style={s.sectionBadge}>
                    <Text style={s.sectionBadgeTxt}>
                      {(sec.question_count ?? 0)} Qs
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {/* Warning */}
          <View style={s.warningBox}>
            <Feather name="alert-triangle" size={16} color="#b45309" />
            <Text style={s.warningTxt}>
              Once started, the timer cannot be paused. Make sure you are in a stable
              environment before starting. Submit before time runs out — the test
              auto-submits when the timer reaches zero.
            </Text>
          </View>

          {/* CTA */}
          <View style={s.ctaBlock}>
            {alreadySubmitted ? (
              <TouchableOpacity style={s.resultBtn} onPress={handleViewResult}>
                <Feather name="bar-chart-2" size={18} color="#fff" />
                <Text style={s.ctaBtnTxt}>View Result</Text>
              </TouchableOpacity>
            ) : hasInProgressAttempt ? (
              <>
                {/* Resume banner */}
                <View style={s.resumeBanner}>
                  <Feather name="alert-circle" size={15} color="#fbbf24" />
                  <Text style={s.resumeBannerTxt}>
                    You have an unfinished attempt. Resume to continue from where you left off.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[s.resumeBtn, starting && { opacity: 0.7 }]}
                  onPress={handleStart}
                  disabled={starting}
                  activeOpacity={0.85}
                >
                  {starting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="rotate-ccw" size={20} color="#fff" />
                      <Text style={s.ctaBtnTxt}>Resume Test</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[s.startBtn, starting && { opacity: 0.7 }]}
                onPress={handleStart}
                disabled={starting}
                activeOpacity={0.85}
              >
                {starting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Feather name="play-circle" size={20} color="#fff" />
                    <Text style={s.ctaBtnTxt}>Start Test</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const DARK = "#0f172a";

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: DARK },
  center:         { alignItems: "center", justifyContent: "center" },
  scroll:         { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },

  backBtn:        { marginLeft: 16, marginTop: 10, marginBottom: 4, alignSelf: "flex-start", padding: 8, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)" },

  // Title
  titleBlock:     { alignItems: "center", paddingVertical: 28, gap: 10 },
  titleIconWrap:  { width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(37,99,235,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  testTitle:      { fontSize: 22, fontWeight: "900", color: "#f8fafc", textAlign: "center", lineHeight: 28 },
  seriesName:     { fontSize: 13, color: "#64748b", textAlign: "center" },

  // Section label
  sectionLabel:   { fontSize: 11, fontWeight: "700", color: "#64748b", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 24, marginBottom: 10 },

  // Details grid
  detailsGrid:    { gap: 8 },
  detailCard:     { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  detailIcon:     { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  detailLabel:    { fontSize: 11, color: "#64748b", marginBottom: 2 },
  detailValue:    { fontSize: 13, fontWeight: "700", color: "#e2e8f0" },

  // Instructions
  instrBox:       { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  instrTxt:       { fontSize: 13, color: "#94a3b8", lineHeight: 20 },

  // Sections
  sectionRow:     { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  sectionDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2563eb", marginTop: 5 },
  sectionName:    { fontSize: 13, fontWeight: "700", color: "#e2e8f0" },
  sectionInstr:   { fontSize: 11, color: "#64748b", marginTop: 2 },
  sectionBadge:   { backgroundColor: "rgba(37,99,235,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sectionBadgeTxt:{ fontSize: 10, fontWeight: "700", color: "#93c5fd" },

  // Warning
  warningBox:     { flexDirection: "row", gap: 10, backgroundColor: "#451a03", borderRadius: 14, padding: 14, marginTop: 24, borderWidth: 1, borderColor: "#92400e" },
  warningTxt:     { flex: 1, fontSize: 12, color: "#fde68a", lineHeight: 18 },

  // CTA
  ctaBlock:       { marginTop: 28 },
  startBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#2563eb", borderRadius: 16, paddingVertical: 18, shadowColor: "#2563eb", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  resumeBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#d97706", borderRadius: 16, paddingVertical: 18, shadowColor: "#d97706", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  resumeBanner:   { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#451a03", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#92400e" },
  resumeBannerTxt:{ flex: 1, fontSize: 12, color: "#fde68a", lineHeight: 18 },
  resultBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#7c3aed", borderRadius: 16, paddingVertical: 18 },
  ctaBtnTxt:      { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.3 },
});
