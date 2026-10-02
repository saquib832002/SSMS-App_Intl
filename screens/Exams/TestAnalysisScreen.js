/**
 * screens/Exams/TestAnalysisScreen.js
 * Per-question analysis for a completed test attempt.
 * Tabs: All | Wrong | Unattempted | Correct
 */
import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getAnalysis } from "../../services/TestSeriesServiceApi";

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: "all",         label: "All" },
  { key: "wrong",       label: "Wrong" },
  { key: "unattempted", label: "Skipped" },
  { key: "correct",     label: "Correct" },
];

const DIFFICULTY_COLORS = {
  easy:   { bg: "#dcfce7", fg: "#15803d" },
  medium: { bg: "#fef9c3", fg: "#a16207" },
  hard:   { bg: "#fee2e2", fg: "#dc2626" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Normalise a selection/answer for comparison: split on comma, trim, sort, re-join.
function normaliseAnswer(s) {
  return (s ?? "")
    .toUpperCase()
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

function questionStatus(q) {
  if (!q.is_attempted) return "unattempted";

  // Re-derive from correct_answer vs selected_option whenever both are available.
  // This fixes display for submissions scored before the isCorrect-flag fix,
  // where is_correct in the DB may be stale/wrong.
  const correctAns  = normaliseAnswer(q.correct_answer);
  const selectedAns = normaliseAnswer(q.selected_option);
  if (correctAns && selectedAns) {
    return selectedAns === correctAns ? "correct" : "wrong";
  }

  // Fallback to DB flag for numerical / fill-blank where comparison is fuzzy.
  return q.is_correct ? "correct" : "wrong";
}

function marksDisplay(q) {
  const marks = q.marks_awarded ?? q.marks_obtained ?? 0;
  if (marks > 0) return { text: `+${marks}`, color: "#16a34a" };
  if (marks < 0) return { text: `${marks}`, color: "#dc2626" };
  return { text: "0", color: "#94a3b8" };
}

function statusCardStyle(status) {
  switch (status) {
    case "correct":     return { bg: "#f0fdf4", border: "#bbf7d0", left: "#16a34a" };
    case "wrong":       return { bg: "#fff5f5", border: "#fecaca", left: "#dc2626" };
    case "unattempted": return { bg: "#f8fafc", border: "#e2e8f0", left: "#94a3b8" };
    default:            return { bg: "#fff", border: "#e2e8f0", left: "#2563eb" };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryBar({ summary }) {
  const { correct = 0, wrong = 0, unattempted = 0, obtained = 0, total = 0 } = summary;
  return (
    <View style={s.summaryBar}>
      <View style={s.summaryItem}>
        <Text style={[s.summaryVal, { color: "#16a34a" }]}>{correct}</Text>
        <Text style={s.summaryLbl}>Correct</Text>
      </View>
      <View style={s.summaryDivider} />
      <View style={s.summaryItem}>
        <Text style={[s.summaryVal, { color: "#dc2626" }]}>{wrong}</Text>
        <Text style={s.summaryLbl}>Wrong</Text>
      </View>
      <View style={s.summaryDivider} />
      <View style={s.summaryItem}>
        <Text style={[s.summaryVal, { color: "#94a3b8" }]}>{unattempted}</Text>
        <Text style={s.summaryLbl}>Skipped</Text>
      </View>
      <View style={s.summaryDivider} />
      <View style={s.summaryItem}>
        <Text style={[s.summaryVal, { color: "#2563eb" }]}>
          {obtained}/{total}
        </Text>
        <Text style={s.summaryLbl}>Score</Text>
      </View>
    </View>
  );
}

function TabBar({ active, tabs, onSelect, counts }) {
  return (
    <View style={s.tabBar}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const count = counts[tab.key] ?? 0;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, isActive && s.tabActive]}
            onPress={() => onSelect(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[s.tabTxt, isActive && s.tabTxtActive]}>
              {tab.label}
            </Text>
            <View style={[s.tabBadge, isActive && s.tabBadgeActive]}>
              <Text style={[s.tabBadgeTxt, isActive && s.tabBadgeTxtActive]}>
                {count}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function OptionItem({ option, optLetter, isYourAnswer, isCorrectAnswer, isMultiCorrect, status }) {
  let bg = "transparent";
  let border = "#e2e8f0";
  let textColor = "#374151";
  let icon = null;
  let tag = null;

  if (isCorrectAnswer && status === "correct") {
    bg = "#dcfce7"; border = "#86efac"; textColor = "#15803d";
    icon = <Feather name={isMultiCorrect ? "check-square" : "check-circle"} size={14} color="#16a34a" />;
    tag = <Text style={s.correctAnsTag}>Correct</Text>;
  } else if (isCorrectAnswer && status === "wrong") {
    bg = "#dcfce7"; border = "#86efac"; textColor = "#15803d";
    icon = <Feather name={isMultiCorrect ? "check-square" : "check-circle"} size={14} color="#16a34a" />;
    tag = <Text style={s.correctAnsTag}>Correct answer</Text>;
  } else if (isCorrectAnswer && status === "unattempted") {
    bg = "#eff6ff"; border = "#bfdbfe"; textColor = "#1d4ed8";
    icon = <Feather name={isMultiCorrect ? "check-square" : "info"} size={14} color="#3b82f6" />;
    tag = <Text style={s.answerTag}>Answer</Text>;
  } else if (isYourAnswer && !isCorrectAnswer && status === "wrong") {
    // Student selected this but it's wrong
    bg = "#fee2e2"; border = "#fca5a5"; textColor = "#dc2626";
    icon = <Feather name={isMultiCorrect ? "x-square" : "x-circle"} size={14} color="#dc2626" />;
    tag = <Text style={s.yourAnsTag}>Your choice</Text>;
  } else if (isYourAnswer && isCorrectAnswer) {
    // Already styled as correct above — this branch won't be reached but kept for clarity
  } else {
    // Unselected, non-correct option — show empty checkbox or dot
    icon = isMultiCorrect
      ? <Feather name="square" size={14} color="#cbd5e1" />
      : <View style={s.optionDot} />;
  }

  return (
    <View style={[s.optionRow, { backgroundColor: bg, borderColor: border }]}>
      <View style={s.optionLeft}>
        {icon}
        {!!optLetter && (
          <Text style={[s.optionLetter, { color: textColor }]}>{optLetter}.</Text>
        )}
        <Text style={[s.optionTxt, { color: textColor }]}>
          {option.option_text ?? option.text ?? ""}
        </Text>
      </View>
      {tag}
    </View>
  );
}

function QuestionCard({ q, index }) {
  const status = questionStatus(q);
  const cardColors = statusCardStyle(status);
  const { text: marksText, color: marksColor } = marksDisplay(q);
  const difficulty = (q.difficulty ?? "").toLowerCase();
  const diffStyle = DIFFICULTY_COLORS[difficulty];
  const options = q.options ?? [];

  // selected_option and correct_answer are now letter codes ("A" or "A,C").
  // Match each option by its letter (index 0 → "A", 1 → "B", …).
  const qTypeNorm      = (q.q_type ?? q.question_type ?? "").toLowerCase();
  const isMultiCorrect = qTypeNorm === "multi_correct";

  const correctRaw  = (q.correct_answer  ?? "").toUpperCase().trim();
  const selectedRaw = (q.selected_option ?? "").toUpperCase().trim();

  const correctSet  = new Set(correctRaw  ? correctRaw.split(",").map(s => s.trim()).filter(Boolean)  : []);
  const selectedSet = new Set(selectedRaw ? selectedRaw.split(",").map(s => s.trim()).filter(Boolean) : []);

  // Section name: backend returns section_title
  const sectionLabel = q.section_title ?? q.section_name ?? "";
  // Question type: backend returns q_type
  const qType = q.q_type ?? q.question_type ?? "";
  // question_order defaults to 0 in the DB, so use || (falsy-check) not ?? (nullish-check)
  const qNum = q.question_order || q.order || (index + 1);
  // For fill_blank / numerical questions (no MCQ options):
  // text the student typed / selected
  const selectedText = q.selected_option ?? "";
  // correct answer text sent from the backend
  const correctText  = q.correct_answer  ?? "";

  return (
    <View
      style={[
        s.qCard,
        {
          backgroundColor: cardColors.bg,
          borderColor: cardColors.border,
          borderLeftColor: cardColors.left,
        },
      ]}
    >
      {/* Header row */}
      <View style={s.qHeader}>
        <View style={s.qNumBadge}>
          <Text style={[s.qNumTxt, { color: cardColors.left }]}>
            Q.{qNum}
          </Text>
        </View>

        {/* Type badge */}
        {!!qType && (
          <View style={s.typeBadge}>
            <Text style={s.typeTxt}>
              {String(qType).toUpperCase().replace("_", " ")}
            </Text>
          </View>
        )}

        {/* Difficulty */}
        {diffStyle && (
          <View style={[s.diffBadge, { backgroundColor: diffStyle.bg }]}>
            <Text style={[s.diffTxt, { color: diffStyle.fg }]}>
              {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </Text>
          </View>
        )}

        {/* Section name */}
        {!!sectionLabel && (
          <View style={s.sectionBadge}>
            <Text style={s.sectionBadgeTxt} numberOfLines={1}>
              {sectionLabel}
            </Text>
          </View>
        )}

        {/* Status label */}
        {status === "correct" && (
          <View style={s.statusBadgeCorrect}>
            <Feather name="check-circle" size={10} color="#16a34a" />
            <Text style={[s.statusBadgeTxt, { color: "#16a34a" }]}>Correct</Text>
          </View>
        )}
        {status === "wrong" && (
          <View style={s.statusBadgeWrong}>
            <Feather name="x-circle" size={10} color="#dc2626" />
            <Text style={[s.statusBadgeTxt, { color: "#dc2626" }]}>Wrong</Text>
          </View>
        )}
        {status === "unattempted" && (
          <View style={s.statusBadgeSkipped}>
            <Feather name="minus-circle" size={10} color="#64748b" />
            <Text style={[s.statusBadgeTxt, { color: "#64748b" }]}>Skipped</Text>
          </View>
        )}

        {/* Marks awarded */}
        <View style={[s.marksBadge, { backgroundColor: `${marksColor}18` }]}>
          <Text style={[s.marksTxt, { color: marksColor }]}>{marksText}</Text>
        </View>
      </View>

      {/* Question text */}
      <Text style={s.qText}>{q.question_text ?? q.text ?? ""}</Text>

      {/* Question image */}
      {(q.image_url || q.image_path) && (
        <Image
          source={{ uri: q.image_url ?? q.image_path }}
          style={s.qImage}
          resizeMode="contain"
        />
      )}

      {/* Options (MCQ / true_false / multi_correct) — letter-based matching */}
      {options.length > 0 && (
        <View style={s.optionsList}>
          {options.map((opt, oi) => {
            // Each option's letter: index 0 → "A", 1 → "B", etc.
            const optLetter = String.fromCharCode(65 + oi);
            // Correct: letter in correctSet (from qb.answer like "A" or "A,C")
            const isCorrectAnswer = correctSet.has(optLetter);
            // Student's choice: letter in selectedSet (from selected_option like "A" or "A,C")
            const isYourAnswer =
              status !== "unattempted" && selectedSet.has(optLetter);
            return (
              <OptionItem
                key={oi}
                option={opt}
                optLetter={optLetter}
                isCorrectAnswer={isCorrectAnswer}
                isYourAnswer={isYourAnswer}
                isMultiCorrect={isMultiCorrect}
                status={status}
              />
            );
          })}
        </View>
      )}

      {/* Non-MCQ (fill_blank, numerical): show student answer + correct answer */}
      {options.length === 0 && (
        <View style={s.freeAnsBlock}>
          {status !== "unattempted" && (
            <View
              style={[
                s.freeAnsRow,
                { backgroundColor: status === "correct" ? "#dcfce7" : "#fee2e2" },
              ]}
            >
              <Text style={s.freeAnsLabel}>Your Answer:</Text>
              <Text
                style={[
                  s.freeAnsVal,
                  { color: status === "correct" ? "#16a34a" : "#dc2626" },
                ]}
              >
                {selectedText ||
                  (q.numerical_answer != null ? String(q.numerical_answer) : "—")}
              </Text>
            </View>
          )}
          {/* Always show correct answer */}
          <View style={[s.freeAnsRow, { backgroundColor: "#dcfce7" }]}>
            <Text style={s.freeAnsLabel}>Correct Answer:</Text>
            <Text style={[s.freeAnsVal, { color: "#16a34a" }]}>
              {correctText || "—"}
            </Text>
          </View>
        </View>
      )}

      {/* Explanation (if provided) */}
      {!!q.explanation && (
        <View style={s.explanationBlock}>
          <Text style={s.explanationLabel}>Explanation</Text>
          <Text style={s.explanationTxt}>{q.explanation}</Text>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function TestAnalysisScreen({ route, navigation }) {
  const { attemptId, testTitle, initialTab } = route.params ?? {};
  const { user, activeEnrollmentId } = useContext(AuthContext);
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [loading, setLoading]   = useState(true);
  const [questions, setQuestions] = useState([]);
  const [summary, setSummary]   = useState({});
  const [activeTab, setActiveTab] = useState(initialTab ?? "all");

  const load = useCallback(async () => {
    if (!attemptId) return;
    try {
      setLoading(true);
      const res = await getAnalysis(effectiveUser, attemptId);
      const data = res?.data ?? res;
      // getAnalysis returns a flat array in data; handle both flat and wrapped shapes
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.questions) ? data.questions : []);
      setQuestions(rows);
      // Compute summary directly from question rows
      const correct     = rows.filter((q) => q.is_attempted == 1 && q.is_correct == 1).length;
      const wrong       = rows.filter((q) => q.is_attempted == 1 && !q.is_correct).length;
      const unattempted = rows.filter((q) => !q.is_attempted || q.is_attempted == 0).length;
      const obtained    = rows.reduce((s, q) => s + parseFloat(q.marks_awarded ?? 0), 0);
      const total       = rows.reduce((s, q) => s + parseFloat(q.max_marks ?? 0), 0);
      setSummary({
        correct,
        wrong,
        unattempted,
        obtained: Math.round(obtained * 100) / 100,
        total:    Math.round(total * 100) / 100,
      });
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load analysis");
    } finally {
      setLoading(false);
    }
  }, [user, attemptId]);

  useEffect(() => {
    load();
  }, [load]);

  // Derive filtered list + tab counts from questions
  const { filtered, counts } = useMemo(() => {
    const all         = questions;
    const correct     = questions.filter((q) => questionStatus(q) === "correct");
    const wrong       = questions.filter((q) => questionStatus(q) === "wrong");
    const unattempted = questions.filter((q) => questionStatus(q) === "unattempted");

    const map = { all, correct, wrong, unattempted };
    const filtered = map[activeTab] ?? all;
    const counts = {
      all:         all.length,
      correct:     correct.length,
      wrong:       wrong.length,
      unattempted: unattempted.length,
    };
    return { filtered, counts };
  }, [questions, activeTab]);

  const renderItem = useCallback(
    ({ item, index }) => <QuestionCard q={item} index={index} />,
    []
  );

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      {/* Nav bar */}
      <View style={s.navBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={s.navTitle} numberOfLines={1}>
          {testTitle ? `${testTitle} — Analysis` : "Test Analysis"}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={s.loadWrap}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={s.loadTxt}>Loading analysis…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => String(item.question_id ?? item.id ?? i)}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Fixed summary bar */}
              <SummaryBar summary={summary} />
              {/* Tab bar */}
              <TabBar
                active={activeTab}
                tabs={TABS}
                onSelect={setActiveTab}
                counts={counts}
              />
            </>
          }
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <MaterialIcons name="quiz" size={44} color="#cbd5e1" />
              <Text style={s.emptyTxt}>No questions in this category</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },

  // Nav
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
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
    marginHorizontal: 8,
  },

  loadWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadTxt: { color: "#64748b", fontSize: 14 },

  // Summary bar
  summaryBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 14,
    marginHorizontal: 14,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryVal: { fontSize: 16, fontWeight: "900" },
  summaryLbl: { fontSize: 9, color: "#94a3b8", fontWeight: "700", textTransform: "uppercase", marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: "#f1f5f9", marginVertical: 4 },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  tabActive: { backgroundColor: "#eff6ff" },
  tabTxt: { fontSize: 12, fontWeight: "600", color: "#94a3b8" },
  tabTxtActive: { color: "#2563eb", fontWeight: "800" },
  tabBadge: {
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: "center",
  },
  tabBadgeActive: { backgroundColor: "#dbeafe" },
  tabBadgeTxt: { fontSize: 10, fontWeight: "700", color: "#94a3b8" },
  tabBadgeTxtActive: { color: "#2563eb" },

  // List
  listContent: { paddingHorizontal: 14, paddingBottom: 40 },

  // Question card
  qCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderLeftWidth: 4,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  qHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  qNumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  qNumTxt: { fontSize: 11, fontWeight: "800" },
  typeBadge: {
    backgroundColor: "#e0f2fe",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typeTxt: { fontSize: 9, fontWeight: "700", color: "#0369a1" },
  diffBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  diffTxt: { fontSize: 9, fontWeight: "700" },
  sectionBadge: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#f8fafc",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionBadgeTxt: { fontSize: 9, color: "#64748b", fontWeight: "600" },
  marksBadge: {
    marginLeft: "auto",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  marksTxt: { fontSize: 13, fontWeight: "900" },

  // Question text
  qText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 21,
    marginBottom: 10,
  },
  qImage: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: "#f1f5f9",
  },

  // Options
  optionsList: { gap: 7 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  optionLeft: { flexDirection: "row", alignItems: "flex-start", gap: 6, flex: 1 },
  optionLetter: { fontSize: 12, fontWeight: "800", minWidth: 16 },
  optionDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    marginTop: 1,
    flexShrink: 0,
  },
  optionTxt: { fontSize: 13, lineHeight: 19, flex: 1 },
  yourAnsTag:    { fontSize: 9, fontWeight: "700", color: "#dc2626", marginLeft: 6 },
  correctAnsTag: { fontSize: 9, fontWeight: "700", color: "#16a34a", marginLeft: 6 },
  answerTag:     { fontSize: 9, fontWeight: "700", color: "#2563eb", marginLeft: 6 },

  // Status badges (Correct / Wrong / Skipped)
  statusBadgeCorrect: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#dcfce7", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statusBadgeWrong: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#fee2e2", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statusBadgeSkipped: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#f1f5f9", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statusBadgeTxt: { fontSize: 10, fontWeight: "800" },

  // Free-text answer block
  freeAnsBlock: { gap: 6, marginTop: 4 },
  freeAnsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  freeAnsLabel: { fontSize: 11, fontWeight: "700", color: "#475569", minWidth: 100 },
  freeAnsVal: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 19 },

  // Explanation
  explanationBlock: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#fefce8",
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#facc15",
  },
  explanationLabel: { fontSize: 10, fontWeight: "800", color: "#a16207", marginBottom: 4, textTransform: "uppercase" },
  explanationTxt: { fontSize: 13, color: "#713f12", lineHeight: 19 },

  // Empty
  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt: { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
});
