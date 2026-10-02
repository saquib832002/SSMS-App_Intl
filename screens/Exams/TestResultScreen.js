/**
 * screens/Exams/TestResultScreen.js
 * Shows the result of a submitted test attempt — score card, stats, section
 * breakdown, action buttons, and a wrong-answer preview.
 */
import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getResult } from "../../services/TestSeriesServiceApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(obtained, total) {
  if (!total) return 0;
  return ((obtained / total) * 100).toFixed(1);
}

function percentileLabel(percentile) {
  if (percentile == null) return null;
  const p = Number(percentile);
  if (p >= 99) return "Top 1%";
  if (p >= 95) return "Top 5%";
  if (p >= 90) return "Top 10%";
  if (p >= 75) return "Top 25%";
  if (p >= 50) return "Top 50%";
  return `Bottom ${(100 - p).toFixed(0)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreCard({ result, testTitle }) {
  const {
    obtained_marks,
    total_marks,
    passing_marks,
    rank,
    total_students,
    percentile,
  } = result;

  const percentage = pct(obtained_marks, total_marks);
  const passed = obtained_marks >= (passing_marks ?? 0);
  const pctLabel = percentileLabel(percentile);

  return (
    <View style={s.scoreCard}>
      {/* gradient-like layered bg */}
      <View style={s.scoreBgLayer} />

      <Text style={s.scoreTitle} numberOfLines={2}>
        {testTitle}
      </Text>

      {/* Big score */}
      <View style={s.scoreBig}>
        <Text style={s.scoreObtained}>{obtained_marks ?? 0}</Text>
        <Text style={s.scoreSlash}> / </Text>
        <Text style={s.scoreTotal}>{total_marks ?? 0}</Text>
      </View>

      {/* Percentage */}
      <Text style={s.scorePct}>{percentage}%</Text>

      {/* PASS / FAIL badge */}
      <View style={[s.passBadge, passed ? s.passBadgePass : s.passBadgeFail]}>
        <Text style={[s.passBadgeTxt, passed ? s.passBadgeTxtPass : s.passBadgeTxtFail]}>
          {passed ? "PASSED" : "FAILED"}
        </Text>
      </View>

      {/* Rank + Percentile row */}
      <View style={s.scoreMetaRow}>
        {rank != null && (
          <View style={s.scoreMeta}>
            <Feather name="award" size={14} color="rgba(255,255,255,0.75)" />
            <Text style={s.scoreMetaTxt}>
              #{rank} of {total_students ?? "?"} students
            </Text>
          </View>
        )}
        {pctLabel && (
          <View style={s.scoreMeta}>
            <Feather name="trending-up" size={14} color="rgba(255,255,255,0.75)" />
            <Text style={s.scoreMetaTxt}>{pctLabel}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <View style={[s.statCard, { borderTopColor: color }]}>
      <Text style={[s.statIcon]}>{icon}</Text>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function SectionRow({ sec }) {
  // MySQL aggregate values (SUM/COUNT) arrive as strings in JSON.
  // Coerce to Number before arithmetic to avoid "2" + "1" = "21" (string concat).
  const correct   = Number(sec.correct_count ?? 0);
  const wrong     = Number(sec.wrong_count   ?? 0);
  const attempted = correct + wrong;
  const accuracy  = attempted > 0
    ? (correct / attempted * 100).toFixed(0)
    : "—";
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionName} numberOfLines={1}>
        {sec.section_name ?? sec.name}
      </Text>
      <Text style={s.sectionCell}>
        {sec.obtained_marks ?? 0}/{sec.total_marks ?? 0}
      </Text>
      <Text style={[s.sectionCell, { color: "#16a34a" }]}>
        {sec.correct_count ?? 0}
      </Text>
      <Text style={[s.sectionCell, { color: "#dc2626" }]}>
        {sec.wrong_count ?? 0}
      </Text>
      <Text style={s.sectionCell}>{accuracy}%</Text>
    </View>
  );
}

function WrongPreviewCard({ q, index }) {
  return (
    <View style={s.wrongCard}>
      <View style={s.wrongHeader}>
        <View style={s.wrongNumBadge}>
          <Text style={s.wrongNumTxt}>Q.{q.order ?? index + 1}</Text>
        </View>
        <Text style={s.wrongQuestionTxt} numberOfLines={3}>
          {q.question_text ?? q.text ?? ""}
        </Text>
      </View>
      <View style={s.wrongAnsRow}>
        <View style={[s.wrongAnsChip, s.wrongAnsChipCorrect]}>
          <Feather name="check" size={10} color="#16a34a" />
          <Text style={s.wrongAnsCorrectTxt}>
            {q.correct_option_text ?? q.correct_answer ?? "—"}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function TestResultScreen({ route, navigation }) {
  const { attemptId, testTitle, test } = route.params ?? {};
  const { user, activeEnrollmentId } = useContext(AuthContext);
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    if (!attemptId) return;
    try {
      setLoading(true);
      const res = await getResult(effectiveUser, attemptId);
      // Backend returns { attempt: {...}, sections: [...] }
      // Flatten so ScoreCard can read obtained_marks, total_marks etc. directly
      const raw = res?.data ?? res;
      const attempt  = raw?.attempt  ?? raw;
      const sections = raw?.sections ?? [];
      setResult({ ...attempt, sections });
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load result");
    } finally {
      setLoading(false);
    }
  }, [user, attemptId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["bottom"]}>
        <View style={s.loadWrap}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={s.loadTxt}>Loading your result…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!result) {
    return (
      <SafeAreaView style={s.safe} edges={["bottom"]}>
        <View style={s.loadWrap}>
          <Feather name="alert-circle" size={40} color="#cbd5e1" />
          <Text style={s.emptyTxt}>Result not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sections = result.sections ?? [];
  const wrongQuestions = result.wrong_questions ?? result.incorrect_questions ?? [];
  const wrongPreview = wrongQuestions.slice(0, 5);

  const correct = result.correct_count ?? 0;
  const wrong = result.wrong_count ?? 0;
  const unattempted = result.unattempted_count ?? 0;

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      {/* Top nav bar */}
      <View style={s.navBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={s.navTitle} numberOfLines={1}>
          Test Result
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
      >
        {/* ── Score Card ── */}
        <ScoreCard result={result} testTitle={testTitle ?? result.test_title ?? "Test"} />

        {/* ── Stats Row ── */}
        <View style={s.statsRow}>
          <StatCard icon="✅" label="Correct" value={correct} color="#16a34a" />
          <StatCard icon="❌" label="Wrong" value={wrong} color="#dc2626" />
          <StatCard icon="⬜" label="Skipped" value={unattempted} color="#94a3b8" />
        </View>

        {/* ── Section Breakdown ── */}
        {sections.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Section-wise Breakdown</Text>
            {/* Table header */}
            <View style={[s.sectionRow, s.sectionHeaderRow]}>
              <Text style={[s.sectionName, s.sectionHeaderTxt]}>Section</Text>
              <Text style={[s.sectionCell, s.sectionHeaderTxt]}>Score</Text>
              <Text style={[s.sectionCell, s.sectionHeaderTxt]}>Correct</Text>
              <Text style={[s.sectionCell, s.sectionHeaderTxt]}>Wrong</Text>
              <Text style={[s.sectionCell, s.sectionHeaderTxt]}>Acc%</Text>
            </View>
            {sections.map((sec, i) => (
              <SectionRow key={String(sec.section_id ?? i)} sec={sec} />
            ))}
          </View>
        )}

        {/* ── Action Buttons ── */}
        <View style={s.actionsCard}>
          <TouchableOpacity
            style={s.primaryBtn}
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate("TestAnalysis", {
                attemptId,
                testTitle: testTitle ?? result.test_title,
              })
            }
          >
            <MaterialIcons name="analytics" size={18} color="#fff" />
            <Text style={s.primaryBtnTxt}>View Detailed Analysis</Text>
          </TouchableOpacity>

          {["admin", "owner", "super"].includes((user?.ssmsUserRole ?? "").toLowerCase().trim()) && (
            <TouchableOpacity
              style={s.secondaryBtn}
              activeOpacity={0.85}
              onPress={() =>
                navigation.navigate("TestLeaderboard", {
                  testId: result.test_id,
                  testTitle: testTitle ?? result.test_title,
                  testDate: test?.scheduled_start ?? result.scheduled_start ?? result.test_date ?? null,
                })
              }
            >
              <Feather name="award" size={16} color="#2563eb" />
              <Text style={s.secondaryBtnTxt}>View Leaderboard</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={s.ghostBtn}
            activeOpacity={0.85}
            onPress={() => navigation.popToTop()}
          >
            <Feather name="home" size={16} color="#64748b" />
            <Text style={s.ghostBtnTxt}>Go to Test Series</Text>
          </TouchableOpacity>
        </View>

        {/* ── Wrong Answers Preview ── */}
        {wrongPreview.length > 0 && (
          <View style={s.card}>
            <View style={s.cardTitleRow}>
              <Text style={s.cardTitle}>Wrong Answers</Text>
              <Text style={s.cardBadge}>{wrongQuestions.length}</Text>
            </View>

            {wrongPreview.map((q, i) => (
              <WrongPreviewCard key={String(q.question_id ?? i)} q={q} index={i} />
            ))}

            {wrongQuestions.length > 5 && (
              <TouchableOpacity
                style={s.viewAllLink}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate("TestAnalysis", {
                    attemptId,
                    testTitle: testTitle ?? result.test_title,
                    initialTab: "Wrong",
                  })
                }
              >
                <Text style={s.viewAllLinkTxt}>
                  View all {wrongQuestions.length} wrong answers in Analysis
                </Text>
                <Feather name="arrow-right" size={13} color="#2563eb" />
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },

  // Nav bar
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    marginHorizontal: 8,
  },

  scroll: { paddingBottom: 40 },

  loadWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadTxt: { color: "#64748b", fontSize: 14 },
  emptyTxt: { fontSize: 15, fontWeight: "700", color: "#94a3b8", marginTop: 8 },

  // Score card
  scoreCard: {
    backgroundColor: "#2563eb",
    marginHorizontal: 14,
    marginTop: 16,
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "#2563eb",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  scoreBgLayer: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  scoreTitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  scoreBig: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 4,
  },
  scoreObtained: {
    fontSize: 56,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -2,
  },
  scoreSlash: { fontSize: 28, color: "rgba(255,255,255,0.5)", fontWeight: "300" },
  scoreTotal: { fontSize: 28, color: "rgba(255,255,255,0.7)", fontWeight: "700" },
  scorePct: {
    fontSize: 22,
    fontWeight: "800",
    color: "rgba(255,255,255,0.9)",
    marginBottom: 14,
  },
  passBadge: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 30,
    marginBottom: 16,
  },
  passBadgePass: { backgroundColor: "rgba(22,163,74,0.2)", borderWidth: 1, borderColor: "#4ade80" },
  passBadgeFail: { backgroundColor: "rgba(220,38,38,0.2)", borderWidth: 1, borderColor: "#f87171" },
  passBadgeTxt: { fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  passBadgeTxtPass: { color: "#86efac" },
  passBadgeTxtFail: { color: "#fca5a5" },
  scoreMetaRow: { flexDirection: "row", gap: 16, marginTop: 4, flexWrap: "wrap", justifyContent: "center" },
  scoreMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  scoreMetaTxt: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" },

  // Stats row
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 14,
    marginTop: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderTopWidth: 3,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statIcon: { fontSize: 20, marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { fontSize: 10, color: "#94a3b8", fontWeight: "700", marginTop: 3, textTransform: "uppercase" },

  // Card
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 14,
    marginTop: 14,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 12 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  cardBadge: {
    backgroundColor: "#fee2e2",
    color: "#dc2626",
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },

  // Section table
  sectionHeaderRow: { backgroundColor: "#f8fafc", borderRadius: 8, marginBottom: 4 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  sectionHeaderTxt: { color: "#475569", fontWeight: "700", fontSize: 10, textTransform: "uppercase" },
  sectionName: { flex: 2, fontSize: 12, fontWeight: "600", color: "#0f172a" },
  sectionCell: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600", color: "#475569" },

  // Action buttons
  actionsCard: {
    marginHorizontal: 14,
    marginTop: 14,
    gap: 10,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: "#2563eb",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#eff6ff",
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: "#bfdbfe",
  },
  secondaryBtnTxt: { color: "#2563eb", fontSize: 14, fontWeight: "700" },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  ghostBtnTxt: { color: "#64748b", fontSize: 14, fontWeight: "600" },

  // Wrong answer preview
  wrongCard: {
    backgroundColor: "#fff5f5",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  wrongHeader: { flexDirection: "row", gap: 8, marginBottom: 8 },
  wrongNumBadge: {
    backgroundColor: "#fee2e2",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  wrongNumTxt: { fontSize: 10, fontWeight: "800", color: "#dc2626" },
  wrongQuestionTxt: { flex: 1, fontSize: 13, color: "#0f172a", lineHeight: 19 },
  wrongAnsRow: { flexDirection: "row" },
  wrongAnsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  wrongAnsChipCorrect: { backgroundColor: "#dcfce7" },
  wrongAnsCorrectTxt: { fontSize: 12, fontWeight: "600", color: "#16a34a" },
  viewAllLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingTop: 6,
  },
  viewAllLinkTxt: { color: "#2563eb", fontSize: 13, fontWeight: "700" },
});
