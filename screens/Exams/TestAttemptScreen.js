/**
 * screens/Exams/TestAttemptScreen.js
 * Full-screen exam interface for students.
 * Route params: { attemptId, testId, questions, test, existingResponses }
 */
import React, {
  useState, useContext, useEffect, useRef, useCallback, useMemo,
} from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal, FlatList,
  Image, BackHandler, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { saveResponses, submitAttempt } from "../../services/TestSeriesServiceApi";

// ── Constants ─────────────────────────────────────────────────────────────────
const OPTIONS = ["A", "B", "C", "D"];

// Palette status colours
const PALETTE = {
  notVisited: { bg: "#f1f5f9", border: "#cbd5e1", color: "#64748b" },
  unanswered: { bg: "#fee2e2", border: "#f87171", color: "#dc2626" },
  answered:   { bg: "#dcfce7", border: "#86efac", color: "#15803d" },
  reviewed:   { bg: "#ffedd5", border: "#fdba74", color: "#ea580c" },
  answeredReviewed: { bg: "#ede9fe", border: "#a78bfa", color: "#7c3aed" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(secs) {
  if (secs <= 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildInitialResponses(questions, existingResponses) {
  const map = {};
  if (Array.isArray(existingResponses)) {
    existingResponses.forEach((r) => {
      const key = r.test_question_id ?? r.question_id;
      if (key != null) map[String(key)] = {
        selected_option:    r.selected_option ?? r.chosen_option ?? null,
        numerical_answer:   r.numerical_answer ?? null,
        is_marked_for_review: r.is_marked_for_review ? 1 : 0,
        is_attempted:       r.is_attempted ? 1 : 0,
        is_visited:         1,
        time_spent_seconds: r.time_spent_seconds ?? 0,
      };
    });
  }
  questions.forEach((q) => {
    const key = String(q.test_question_id ?? q.id ?? q.question_id);
    if (!map[key]) {
      map[key] = {
        selected_option:    null,
        numerical_answer:   null,
        is_marked_for_review: 0,
        is_attempted:       0,
        is_visited:         0,
        time_spent_seconds: 0,
      };
    }
  });
  return map;
}

function getQuestionKey(q) {
  return String(q.test_question_id ?? q.id ?? q.question_id);
}

function getPaletteStatus(responses, key) {
  const r = responses[key];
  if (!r || !r.is_visited) return "notVisited";
  const hasAnswer = r.selected_option != null || (r.numerical_answer != null && r.numerical_answer !== "");
  const marked    = !!r.is_marked_for_review;
  if (hasAnswer && marked) return "answeredReviewed";
  if (hasAnswer)           return "answered";
  if (marked)              return "reviewed";
  return "unanswered";
}

// ── Question option button — Radio (single-correct) ──────────────────────────
function OptionBtn({ label, text, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[s.optBtn, selected && s.optBtnSelected]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Radio circle */}
      <View style={[s.optIndicator, selected && s.optIndicatorSel]}>
        {selected && <View style={s.optRadioDot} />}
      </View>
      <View style={[s.optLabelBadge, selected && s.optLabelBadgeSel]}>
        <Text style={[s.optLabelTxt, selected && s.optLabelTxtSelected]}>{label}</Text>
      </View>
      <Text style={[s.optText, selected && s.optTextSelected]} numberOfLines={4}>
        {text}
      </Text>
    </TouchableOpacity>
  );
}

// ── Question option button — Checkbox (multi-correct) ─────────────────────────
function CheckboxBtn({ label, text, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[s.optBtn, selected && s.optBtnSelected]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Checkbox square — always square (borderRadius:4), unlike radio circle */}
      <View style={[s.optIndicator, s.optIndicatorSquare, selected && s.optIndicatorSel]}>
        {selected && <Feather name="check" size={11} color="#fff" />}
      </View>
      <View style={[s.optLabelBadge, selected && s.optLabelBadgeSel]}>
        <Text style={[s.optLabelTxt, selected && s.optLabelTxtSelected]}>{label}</Text>
      </View>
      <Text style={[s.optText, selected && s.optTextSelected]} numberOfLines={4}>
        {text}
      </Text>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TestAttemptScreen({ navigation, route }) {
  const {
    attemptId, testId, questions: rawQuestions, test, existingResponses,
    startedAt, serverTime, timeRemaining,
  } = route.params ?? {};
  const { user, activeEnrollmentId } = useContext(AuthContext);
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );
  const insets = useSafeAreaInsets();

  // ── State ────────────────────────────────────────────────────────────────────
  const questions = useMemo(() => Array.isArray(rawQuestions) ? rawQuestions : [], [rawQuestions]);

  // Build sections from question-level section_id/section_name (set by backend JOIN).
  // Falls back to a single "All Questions" group when no sections are assigned.
  const sections = useMemo(() => {
    const hasSections = questions.some((q) => q.section_id);
    if (hasSections) {
      const map = new Map();
      questions.forEach((q) => {
        const key = q.section_id ? String(q.section_id) : "__none__";
        if (!map.has(key)) {
          map.set(key, {
            section_id: key,
            name: q.section_title ?? q.section_name ?? "General",
            questions: [],
          });
        }
        map.get(key).questions.push(q);
      });
      // Named sections first (sorted by id), unsectioned last
      return [...map.entries()]
        .sort(([a], [b]) => (a === "__none__" ? 1 : b === "__none__" ? -1 : Number(a) - Number(b)))
        .map(([, sec]) => sec);
    }
    return [{ section_id: "all", name: "All Questions", questions }];
  }, [questions]);

  const [responses,   setResponses]   = useState(() => buildInitialResponses(questions, existingResponses));
  const [currentIdx,  setCurrentIdx]  = useState(0);
  const [sectionIdx,  setSectionIdx]  = useState(0);
  const [timeLeft,    setTimeLeft]    = useState(() => {
    const total = (test?.duration_minutes ?? 60) * 60;
    // Prefer server-computed remaining time — the server uses strtotime() on both
    // values in the same timezone, so the math is exact and timezone-agnostic.
    // This also handles old records where started_at was NULL (server falls back
    // to created_at), so crashes / reinstalls / sign-outs no longer reset the timer.
    if (timeRemaining != null && Number.isFinite(timeRemaining) && timeRemaining >= 0) {
      return timeRemaining;
    }
    // Legacy fallback: JS-side calculation from server timestamps
    if (startedAt && serverTime) {
      const toMs  = (s) => new Date(String(s).replace(" ", "T")).getTime();
      const elapsed = Math.floor((toMs(serverTime) - toMs(startedAt)) / 1000);
      return Math.max(total - elapsed, 0);
    }
    return total;
  });
  const [showPalette, setShowPalette] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [numInput,    setNumInput]    = useState("");

  const timerRef         = useRef(null);
  const autoSaveRef      = useRef(null);
  const startTimeRef     = useRef(Date.now());
  const questionStartRef = useRef(Date.now());
  const timeLeftRef      = useRef(timeLeft);
  // Always points to the latest handleAutoSubmit — prevents stale-closure bug
  // where the timer setInterval ([] deps, created once) would call the mount-time
  // version of handleAutoSubmit that has the initial (empty) responses state.
  const autoSubmitRef    = useRef(null);

  // keep refs in sync
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);

  // ── Active questions for current section ──────────────────────────────────
  const activeQuestions = sections[sectionIdx]?.questions ?? questions;

  const currentQuestion = activeQuestions[currentIdx];
  const currentKey = currentQuestion ? getQuestionKey(currentQuestion) : null;

  // ── Mark current question visited ────────────────────────────────────────
  useEffect(() => {
    if (!currentKey) return;
    questionStartRef.current = Date.now();
    setResponses((prev) => {
      if (prev[currentKey]?.is_visited) return prev;
      return { ...prev, [currentKey]: { ...prev[currentKey], is_visited: 1 } };
    });
  }, [currentKey]);

  // ── Sync numerical input when question changes ────────────────────────────
  useEffect(() => {
    if (!currentKey) return;
    const r = responses[currentKey];
    setNumInput(r?.numerical_answer ?? "");
  }, [currentKey]);

  // ── Timer ────────────────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          // Use the ref so we always call the *latest* handleAutoSubmit —
          // the interval closure itself is frozen at mount time.
          autoSubmitRef.current?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ── Auto-save every 30 seconds ────────────────────────────────────────────
  useEffect(() => {
    autoSaveRef.current = setInterval(() => {
      doSave(false);
    }, 30000);
    return () => clearInterval(autoSaveRef.current);
  }, [responses]);

  // ── Block hardware back ───────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      promptLeave();
      return true;
    });
    return () => sub.remove();
  }, []);

  // ── Build responses payload ───────────────────────────────────────────────
  const buildPayload = useCallback((resObj) => {
    return questions.map((q) => {
      const key = getQuestionKey(q);
      const r   = resObj[key] ?? {};
      return {
        test_question_id:   q.test_question_id ?? q.id ?? q.question_id,
        question_id:        q.question_id ?? q.id,
        selected_option:    r.selected_option ?? null,
        numerical_answer:   r.numerical_answer ?? null,
        is_marked_for_review: r.is_marked_for_review ? 1 : 0,
        is_attempted:       r.is_attempted ? 1 : 0,
        time_spent_seconds: r.time_spent_seconds ?? 0,
      };
    });
  }, [questions]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const doSave = useCallback(async (showAlert = false) => {
    if (!attemptId) return;
    try {
      await saveResponses(effectiveUser, attemptId, buildPayload(responses));
      if (showAlert) Alert.alert("Saved", "Your responses have been saved.");
    } catch (_) {
      // silent fail on auto-save
    }
  }, [user, attemptId, responses, buildPayload]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleAutoSubmit = useCallback(async () => {
    if (!attemptId) return;
    try {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);

      // If the student was mid-entry on a numerical question when time ran out,
      // commit the typed value so it isn't silently lost.
      let finalResponses = responses;
      if (currentKey && numInput.trim() !== "") {
        const qt = (currentQuestion?.question_type ?? currentQuestion?.type ?? "").toLowerCase();
        if (qt === "numerical" || qt === "integer") {
          finalResponses = {
            ...responses,
            [currentKey]: {
              ...responses[currentKey],
              numerical_answer: numInput.trim(),
              is_attempted: 1,
            },
          };
        }
      }

      // Pass responses directly in submit body — atomic save+score in one call
      await submitAttempt(effectiveUser, attemptId, elapsed, buildPayload(finalResponses));
      navigation.replace("TestResult", { attemptId, test });
    } catch (e) {
      Alert.alert("Submission Error", e.message || "Auto-submit failed.");
    }
  }, [effectiveUser, attemptId, responses, buildPayload, test, currentKey, currentQuestion, numInput]);

  // Keep autoSubmitRef pointing to the latest version so the frozen timer
  // closure always calls the current handleAutoSubmit (with up-to-date state).
  useEffect(() => { autoSubmitRef.current = handleAutoSubmit; }, [handleAutoSubmit]);

  const handleSubmitConfirm = useCallback(() => {
    const unattempted = questions.filter((q) => {
      const r = responses[getQuestionKey(q)];
      return !r?.is_attempted;
    }).length;

    Alert.alert(
      "Submit Test",
      `Are you sure you want to submit?\n\n${unattempted} question${unattempted !== 1 ? "s" : ""} unattempted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          style: "destructive",
          onPress: async () => {
            setShowPalette(false);
            setSubmitting(true);
            clearInterval(timerRef.current);
            try {
              const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
              // Pass responses directly — atomic save+score in one call
              await submitAttempt(effectiveUser, attemptId, elapsed, buildPayload(responses));
              navigation.replace("TestResult", { attemptId, test });
            } catch (e) {
              Alert.alert("Error", e.message || "Submission failed. Please try again.");
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }, [questions, responses, user, attemptId, buildPayload, test]);

  const promptLeave = () => {
    Alert.alert(
      "Leave Test?",
      "Your progress is auto-saved. The timer will keep running if you leave.",
      [
        { text: "Stay", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => navigation.goBack() },
      ]
    );
  };

  // ── Update time spent on current question ─────────────────────────────────
  const accumulateTime = useCallback(() => {
    if (!currentKey) return;
    const spent = Math.floor((Date.now() - questionStartRef.current) / 1000);
    setResponses((prev) => ({
      ...prev,
      [currentKey]: {
        ...prev[currentKey],
        time_spent_seconds: (prev[currentKey]?.time_spent_seconds ?? 0) + spent,
      },
    }));
    questionStartRef.current = Date.now();
  }, [currentKey]);

  // ── Navigation helpers ────────────────────────────────────────────────────
  const goToQuestion = (idx) => {
    accumulateTime();
    setCurrentIdx(Math.max(0, Math.min(idx, activeQuestions.length - 1)));
    setShowPalette(false);
  };

  const goPrev = () => {
    if (currentIdx > 0) goToQuestion(currentIdx - 1);
  };

  const saveAndNext = () => {
    if (!currentKey) return;
    const qType = currentQuestion?.question_type ?? currentQuestion?.type ?? "mcq";
    const isNumerical = qType === "numerical" || qType === "integer";

    setResponses((prev) => ({
      ...prev,
      [currentKey]: {
        ...prev[currentKey],
        is_attempted: 1,
        numerical_answer: isNumerical ? numInput : prev[currentKey]?.numerical_answer,
      },
    }));
    if (currentIdx < activeQuestions.length - 1) {
      goToQuestion(currentIdx + 1);
    }
  };

  // Advance to the next section (called when on last Q of a non-final section)
  const goNextSection = () => {
    if (!currentKey) return;
    const qType = currentQuestion?.question_type ?? currentQuestion?.type ?? "mcq";
    const isNumerical = qType === "numerical" || qType === "integer";
    // Save current answer first
    setResponses((prev) => ({
      ...prev,
      [currentKey]: {
        ...prev[currentKey],
        is_attempted: 1,
        numerical_answer: isNumerical ? numInput : prev[currentKey]?.numerical_answer,
      },
    }));
    accumulateTime();
    setSectionIdx((prev) => prev + 1);
    setCurrentIdx(0);
  };

  // Is the current question the very last one of the entire test?
  const isLastQuestionOverall =
    sectionIdx === sections.length - 1 &&
    currentIdx === activeQuestions.length - 1;

  // Is the current question the last of this section but more sections remain?
  const isLastOfSection =
    currentIdx === activeQuestions.length - 1 &&
    sectionIdx < sections.length - 1;

  const markAndNext = () => {
    if (!currentKey) return;
    setResponses((prev) => ({
      ...prev,
      [currentKey]: {
        ...prev[currentKey],
        is_marked_for_review: prev[currentKey]?.is_marked_for_review ? 0 : 1,
      },
    }));
    if (currentIdx < activeQuestions.length - 1) {
      goToQuestion(currentIdx + 1);
    }
  };

  const clearResponse = () => {
    if (!currentKey) return;
    setNumInput("");
    setResponses((prev) => ({
      ...prev,
      [currentKey]: {
        ...prev[currentKey],
        selected_option: null,
        numerical_answer: null,
        is_attempted: 0,
      },
    }));
  };

  // Single-correct: store option letter (A/B/C/D); tap same option again → deselect
  const selectOption = (optLetter) => {
    if (!currentKey) return;
    setResponses((prev) => {
      const cur = prev[currentKey];
      const alreadySelected = cur?.selected_option === optLetter;
      return {
        ...prev,
        [currentKey]: {
          ...cur,
          selected_option: alreadySelected ? null : optLetter,
          is_attempted:    alreadySelected ? 0 : 1,
        },
      };
    });
  };

  // Multi-correct: toggle one option letter in a sorted comma-separated list (e.g. "A,C")
  const toggleMultiOption = (optLetter) => {
    if (!currentKey) return;
    setResponses((prev) => {
      const cur      = prev[currentKey];
      const existing = cur?.selected_option
        ? cur.selected_option.split(",").map(s => s.trim()).filter(Boolean)
        : [];
      const idx = existing.indexOf(optLetter);
      let updated;
      if (idx >= 0) {
        updated = existing.filter((_, i) => i !== idx);
      } else {
        updated = [...existing, optLetter];
      }
      updated.sort();
      const joinedOrNull = updated.length > 0 ? updated.join(",") : null;
      return {
        ...prev,
        [currentKey]: {
          ...cur,
          selected_option: joinedOrNull,
          is_attempted:    updated.length > 0 ? 1 : 0,
        },
      };
    });
  };

  // ── Section counts ────────────────────────────────────────────────────────
  const sectionStats = useMemo(() =>
    sections.map((sec) => {
      const qs  = sec.questions ?? [];
      const att = qs.filter((q) => responses[getQuestionKey(q)]?.is_attempted).length;
      return { total: qs.length, attempted: att };
    }),
  [sections, responses]);

  // ── Palette stats ─────────────────────────────────────────────────────────
  const paletteStats = useMemo(() => {
    let notVisited = 0, unanswered = 0, answered = 0, reviewed = 0, answeredReviewed = 0;
    questions.forEach((q) => {
      const st = getPaletteStatus(responses, getQuestionKey(q));
      if (st === "notVisited")        notVisited++;
      else if (st === "unanswered")   unanswered++;
      else if (st === "answered")     answered++;
      else if (st === "reviewed")     reviewed++;
      else                            answeredReviewed++;
    });
    return { notVisited, unanswered, answered, reviewed, answeredReviewed };
  }, [questions, responses]);

  // ── Timer colour ──────────────────────────────────────────────────────────
  const timerColor    = timeLeft < 300 ? "#ef4444" : "#f8fafc";
  const qType         = currentQuestion?.question_type ?? currentQuestion?.type ?? "mcq";
  const isNumerical   = qType === "numerical" || qType === "integer";
  const isMultiCorrect = qType === "multi_correct";
  const currentResp = currentKey ? responses[currentKey] : null;
  const isMarked    = !!currentResp?.is_marked_for_review;

  if (!questions.length) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ color: "#64748b", fontSize: 14 }}>No questions found for this test.</Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={promptLeave} style={s.headerIconBtn}>
          <Feather name="menu" size={20} color="#f8fafc" onPress={() => setShowPalette(true)} />
        </TouchableOpacity>

        <Text style={s.headerTitle} numberOfLines={1}>
          {test?.title ?? "Test"}
        </Text>

        <View style={[s.timerWrap, timeLeft < 300 && s.timerWrapRed]}>
          <Feather name="clock" size={12} color={timerColor} />
          <Text style={[s.timerTxt, { color: timerColor }]}>{fmtTime(timeLeft)}</Text>
        </View>

        <TouchableOpacity style={s.headerSubmitBtn} onPress={handleSubmitConfirm}>
          <Text style={s.headerSubmitTxt}>Submit</Text>
        </TouchableOpacity>
      </View>

      {/* Section tabs */}
      {sections.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.sectionTabBar}
          contentContainerStyle={s.sectionTabContent}
        >
          {sections.map((sec, idx) => {
            const stats = sectionStats[idx];
            const active = idx === sectionIdx;
            return (
              <TouchableOpacity
                key={String(sec.section_id ?? idx)}
                style={[s.sectionTab, active && s.sectionTabActive]}
                onPress={() => {
                  accumulateTime();
                  setSectionIdx(idx);
                  setCurrentIdx(0);
                }}
              >
                <Text style={[s.sectionTabTxt, active && s.sectionTabTxtActive]}>
                  {sec.name}
                </Text>
                <Text style={[s.sectionTabCount, active && s.sectionTabCountActive]}>
                  {stats.attempted}/{stats.total}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Question body */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.questionScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {currentQuestion ? (
            <>
              {/* ── Question card ─────────────────────────────────── */}
              <View style={[
                s.qCard,
                currentResp?.is_attempted && s.qCardAnswered,
                isMarked && !currentResp?.is_attempted && s.qCardReview,
              ]}>

                {/* Top meta bar: Q number · status chips · marks */}
                <View style={s.qMeta}>

                  {/* Left — question number */}
                  <View style={s.qNumWrap}>
                    <Text style={s.qNumLabel}>Q</Text>
                    <Text style={s.qNumVal}>{currentIdx + 1}</Text>
                    <Text style={s.qNumOf}>/{activeQuestions.length}</Text>
                  </View>

                  {/* Centre — status chips */}
                  <View style={s.qStatusRow}>
                    {!!currentResp?.is_attempted && (
                      <View style={s.answeredChip}>
                        <Feather name="check-circle" size={10} color="#16a34a" />
                        <Text style={s.answeredChipTxt}>Answered</Text>
                      </View>
                    )}
                    {isMarked && (
                      <View style={s.reviewChip}>
                        <Feather name="bookmark" size={10} color="#ea580c" />
                        <Text style={s.reviewChipTxt}>Review</Text>
                      </View>
                    )}
                  </View>

                  {/* Right — marks */}
                  <View style={s.qMarksGroup}>
                    {currentQuestion.marks != null && (
                      <View style={s.marksTag}>
                        <Text style={s.marksTagPos}>+{currentQuestion.marks}</Text>
                        <Text style={s.marksTagLabel}> pts</Text>
                      </View>
                    )}
                    {Number(currentQuestion.negative_marks) > 0 && (
                      <View style={[s.marksTag, s.marksTagNegWrap]}>
                        <Text style={s.marksTagNeg}>−{currentQuestion.negative_marks}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Divider */}
                <View style={s.qDivider} />

                {/* Question text — hero element */}
                <Text style={s.qText}>
                  {currentQuestion.question_text ?? currentQuestion.text ?? "Question text not available"}
                </Text>

                {/* Question image */}
                {!!currentQuestion.image_url && (
                  <View style={s.qImageWrap}>
                    <Image
                      source={{ uri: currentQuestion.image_url }}
                      style={s.qImage}
                      resizeMode="contain"
                    />
                  </View>
                )}
              </View>
              {/* ── End question card ────────────────────────────── */}

              {/* MCQ / Multi-correct options */}
              {!isNumerical && (
                <View style={s.optionsWrap}>
                  {isMultiCorrect && (
                    <Text style={s.multiHint}>Select all correct options</Text>
                  )}
                  {OPTIONS.map((label, i) => {
                    // Extract option text — supports both {text,…} objects and plain strings
                    const raw     = currentQuestion.options?.[i];
                    const optText = (raw && typeof raw === "object") ? (raw.text ?? "") : String(raw ?? "");
                    if (!optText) return null;

                    // Use the option's original letter (set by backend before shuffling) so that
                    // selected_option is always stored as the original A/B/C/D matching qb.answer.
                    // Falls back to displayed label when _origLetter is absent (non-shuffled / legacy).
                    const origLetter = (raw && typeof raw === "object" && raw._origLetter)
                      ? raw._origLetter
                      : label;

                    // selected_option stores original letters ("A" or "A,C") not display positions
                    const selectedLetters = currentResp?.selected_option
                      ? currentResp.selected_option.split(",").map(s => s.trim())
                      : [];

                    if (isMultiCorrect) {
                      return (
                        <CheckboxBtn
                          key={label}
                          label={label}
                          text={optText}
                          selected={selectedLetters.includes(origLetter)}
                          onPress={() => toggleMultiOption(origLetter)}
                        />
                      );
                    }

                    return (
                      <OptionBtn
                        key={label}
                        label={label}
                        text={optText}
                        selected={currentResp?.selected_option === origLetter}
                        onPress={() => selectOption(origLetter)}
                      />
                    );
                  })}
                </View>
              )}

              {/* Numerical input */}
              {isNumerical && (
                <View style={s.numWrap}>
                  <Text style={s.numLabel}>Enter your answer:</Text>
                  <TextInput
                    style={s.numInput}
                    value={numInput}
                    onChangeText={(t) => {
                      setNumInput(t);
                      if (!currentKey) return;
                      setResponses((prev) => ({
                        ...prev,
                        [currentKey]: {
                          ...prev[currentKey],
                          numerical_answer: t,
                          is_attempted: t !== "" ? 1 : 0,
                        },
                      }));
                    }}
                    keyboardType="numeric"
                    placeholder="Type your numerical answer…"
                    placeholderTextColor="#94a3b8"
                    returnKeyType="done"
                  />
                </View>
              )}

              <View style={{ height: 120 }} />
            </>
          ) : (
            <View style={s.center}>
              <Text style={s.emptyTxt}>No question available</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom navigation bar */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity
          style={[s.bottomBtn, s.prevBtn, currentIdx === 0 && s.btnDisabled]}
          onPress={goPrev}
          disabled={currentIdx === 0}
        >
          <Feather name="chevron-left" size={16} color={currentIdx === 0 ? "#94a3b8" : "#0f172a"} />
          <Text style={[s.bottomBtnTxt, currentIdx === 0 && s.btnDisabledTxt]}>Prev</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.bottomBtn, s.reviewBtn]} onPress={markAndNext}>
          <Feather name="bookmark" size={13} color="#ea580c" />
          <Text style={[s.bottomBtnTxt, { color: "#ea580c" }]}>Review</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.bottomBtn, s.clearBtn]} onPress={clearResponse}>
          <Feather name="x" size={13} color="#64748b" />
          <Text style={[s.bottomBtnTxt, { color: "#64748b" }]}>Clear</Text>
        </TouchableOpacity>

        {isLastQuestionOverall ? (
          // Last question of last section → Submit
          <TouchableOpacity style={[s.bottomBtn, s.saveBtn]} onPress={handleSubmitConfirm}>
            <Feather name="send" size={13} color="#fff" />
            <Text style={[s.bottomBtnTxt, { color: "#fff" }]}>Submit</Text>
          </TouchableOpacity>
        ) : isLastOfSection ? (
          // Last question of a section but more sections remain → Next Section
          <TouchableOpacity style={[s.bottomBtn, s.saveBtn, { backgroundColor: "#7c3aed" }]} onPress={goNextSection}>
            <Feather name="arrow-right-circle" size={13} color="#fff" />
            <Text style={[s.bottomBtnTxt, { color: "#fff" }]}>Next Section</Text>
          </TouchableOpacity>
        ) : (
          // Normal question → Save & Next
          <TouchableOpacity style={[s.bottomBtn, s.saveBtn]} onPress={saveAndNext}>
            <Feather name="check" size={13} color="#fff" />
            <Text style={[s.bottomBtnTxt, { color: "#fff" }]}>Save & Next</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Submit overlay when submitting */}
      {submitting && (
        <View style={s.submitOverlay}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={s.submitOverlayTxt}>Submitting your test…</Text>
        </View>
      )}

      {/* Question Palette Modal */}
      <Modal
        visible={showPalette}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPalette(false)}
      >
        <TouchableOpacity
          style={s.paletteOverlay}
          activeOpacity={1}
          onPress={() => setShowPalette(false)}
        />
        <View style={[s.palette, { paddingBottom: insets.bottom + 16 }]}>
          {/* Palette header */}
          <View style={s.paletteHeader}>
            <Text style={s.paletteTitle}>Question Palette</Text>
            <TouchableOpacity
              onPress={() => setShowPalette(false)}
              style={s.paletteClose}
            >
              <Feather name="x" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Stats row */}
          <View style={s.paletteStats}>
            <View style={[s.statChip, { backgroundColor: PALETTE.answered.bg }]}>
              <Text style={[s.statChipTxt, { color: PALETTE.answered.color }]}>
                {paletteStats.answered} Answered
              </Text>
            </View>
            <View style={[s.statChip, { backgroundColor: PALETTE.unanswered.bg }]}>
              <Text style={[s.statChipTxt, { color: PALETTE.unanswered.color }]}>
                {paletteStats.unanswered} Not Answered
              </Text>
            </View>
            <View style={[s.statChip, { backgroundColor: PALETTE.reviewed.bg }]}>
              <Text style={[s.statChipTxt, { color: PALETTE.reviewed.color }]}>
                {paletteStats.reviewed} For Review
              </Text>
            </View>
          </View>

          {/* Grid */}
          <FlatList
            data={questions}
            keyExtractor={(q, i) => String(q.test_question_id ?? q.id ?? i)}
            numColumns={5}
            style={s.paletteGrid}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingVertical: 8 }}
            columnWrapperStyle={{ gap: 8 }}
            renderItem={({ item, index }) => {
              const key = getQuestionKey(item);
              const st  = getPaletteStatus(responses, key);
              const pal = PALETTE[st];
              const isCurrent = currentKey === key;
              return (
                <TouchableOpacity
                  style={[
                    s.paletteDot,
                    { backgroundColor: pal.bg, borderColor: pal.border },
                    isCurrent && s.paletteDotCurrent,
                  ]}
                  onPress={() => goToQuestion(
                    sections[sectionIdx]?.questions.findIndex(
                      (q) => getQuestionKey(q) === key
                    ) ?? index
                  )}
                >
                  <Text style={[s.paletteDotTxt, { color: pal.color }, isCurrent && { color: "#fff" }]}>
                    {index + 1}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          {/* Legend */}
          <View style={s.legend}>
            {[
              { key: "notVisited",        label: "Not Visited"     },
              { key: "unanswered",        label: "Not Answered"    },
              { key: "answered",          label: "Answered"        },
              { key: "reviewed",          label: "Marked Review"   },
              { key: "answeredReviewed",  label: "Ans + Review"    },
            ].map(({ key, label }) => (
              <View key={key} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: PALETTE[key].bg, borderColor: PALETTE[key].border }]} />
                <Text style={s.legendTxt}>{label}</Text>
              </View>
            ))}
          </View>

          {/* Submit button */}
          <TouchableOpacity
            style={s.paletteSubmitBtn}
            onPress={handleSubmitConfirm}
          >
            <MaterialIcons name="send" size={16} color="#fff" />
            <Text style={s.paletteSubmitTxt}>Submit Test</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: "#f8fafc" },
  center:           { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyTxt:         { color: "#94a3b8", fontSize: 14 },

  // Header
  header:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#0f172a", borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  headerIconBtn:    { padding: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)" },
  headerTitle:      { flex: 1, fontSize: 14, fontWeight: "700", color: "#f8fafc" },
  timerWrap:        { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  timerWrapRed:     { backgroundColor: "rgba(239,68,68,0.2)" },
  timerTxt:         { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  headerSubmitBtn:  { backgroundColor: "#16a34a", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  headerSubmitTxt:  { fontSize: 12, fontWeight: "700", color: "#fff" },

  // Section tabs
  sectionTabBar:    { maxHeight: 50, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  sectionTabContent:{ paddingHorizontal: 12, alignItems: "center", gap: 8 },
  sectionTab:       { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 0, borderBottomWidth: 2, borderBottomColor: "transparent", alignItems: "center" },
  sectionTabActive: { borderBottomColor: "#2563eb" },
  sectionTabTxt:    { fontSize: 13, fontWeight: "600", color: "#64748b" },
  sectionTabTxtActive: { color: "#2563eb" },
  sectionTabCount:  { fontSize: 10, color: "#94a3b8", marginTop: 1 },
  sectionTabCountActive: { color: "#2563eb" },

  // Question scroll
  questionScroll:   { paddingHorizontal: 16, paddingTop: 16 },

  // ── Question card ──────────────────────────────────────────────────────────
  qCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  qCardAnswered: {
    borderColor: "#bbf7d0",
    backgroundColor: "#f9fffe",
  },
  qCardReview: {
    borderColor: "#fed7aa",
    backgroundColor: "#fffbf5",
  },

  // Meta bar (Q number · status chips · marks)
  qMeta:      { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  qNumWrap:   { flexDirection: "row", alignItems: "baseline", gap: 1, marginRight: 10 },
  qNumLabel:  { fontSize: 11, fontWeight: "800", color: "#2563eb", letterSpacing: 0.5 },
  qNumVal:    { fontSize: 20, fontWeight: "900", color: "#2563eb" },
  qNumOf:     { fontSize: 11, color: "#94a3b8", fontWeight: "600" },

  qStatusRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  answeredChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#dcfce7", borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  answeredChipTxt: { fontSize: 10, fontWeight: "700", color: "#16a34a" },
  reviewChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#ffedd5", borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  reviewChipTxt: { fontSize: 10, fontWeight: "700", color: "#ea580c" },

  qMarksGroup:   { flexDirection: "row", gap: 5, alignItems: "center" },
  marksTag: {
    flexDirection: "row", alignItems: "baseline",
    backgroundColor: "#f0fdf4", borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  marksTagPos:     { fontSize: 12, fontWeight: "800", color: "#16a34a" },
  marksTagLabel:   { fontSize: 9,  fontWeight: "600", color: "#86efac" },
  marksTagNeg:     { fontSize: 12, fontWeight: "800", color: "#dc2626" },
  marksTagNegWrap: { backgroundColor: "#fef2f2" },

  // Divider between meta bar and question text
  qDivider: { height: 1, backgroundColor: "#f1f5f9", marginBottom: 14 },

  // Question text & image (inside the card)
  qText:     { fontSize: 15, color: "#0f172a", lineHeight: 24, marginBottom: 12, fontWeight: "500" },
  qImageWrap: { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0", marginTop: 4 },
  qImage:    { width: "100%", height: 200, backgroundColor: "#f1f5f9" },

  // MCQ options
  optionsWrap:         { gap: 10 },
  multiHint:           { fontSize: 12, color: "#7c3aed", fontWeight: "600", marginBottom: 2 },
  optBtn:              { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: "#e2e8f0", padding: 14, elevation: 1, shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  optBtnSelected:      { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  // Indicator = radio circle or checkbox square
  optIndicator:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center" },
  optIndicatorSquare:  { borderRadius: 4 },   // overrides circle for checkbox
  optIndicatorSel:     { borderColor: "#2563eb", backgroundColor: "#2563eb", borderRadius: 4 },
  optRadioDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  // A/B/C/D badge
  optLabelBadge:       { width: 28, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  optLabelBadgeSel:    { backgroundColor: "#2563eb" },
  optLabelTxt:         { fontSize: 12, fontWeight: "800", color: "#475569" },
  optLabelTxtSelected: { color: "#fff" },
  optText:             { flex: 1, fontSize: 14, color: "#0f172a", lineHeight: 20 },
  optTextSelected:     { color: "#1e40af", fontWeight: "600" },

  // Numerical
  numWrap:          { marginTop: 8 },
  numLabel:         { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 8 },
  numInput:         { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, fontWeight: "700", color: "#0f172a", textAlign: "center" },

  // Bottom bar
  bottomBar:        { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 8, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  bottomBtn:        { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#e2e8f0" },
  bottomBtnTxt:     { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  prevBtn:          { backgroundColor: "#fff" },
  reviewBtn:        { backgroundColor: "#fff7ed", borderColor: "#fdba74", flex: 1 },
  clearBtn:         { backgroundColor: "#f8fafc" },
  saveBtn:          { backgroundColor: "#16a34a", borderColor: "#16a34a", flex: 1.2 },
  btnDisabled:      { opacity: 0.4 },
  btnDisabledTxt:   { color: "#94a3b8" },

  // Submit overlay
  submitOverlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center", gap: 16 },
  submitOverlayTxt: { fontSize: 16, fontWeight: "700", color: "#0f172a" },

  // Palette
  paletteOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  palette:          { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 6 },
  paletteHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  paletteTitle:     { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  paletteClose:     { width: 28, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  paletteStats:     { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  statChip:         { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statChipTxt:      { fontSize: 11, fontWeight: "700" },

  paletteGrid:      { maxHeight: 220, paddingHorizontal: 12 },
  paletteDot:       { width: 46, height: 36, borderRadius: 9, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  paletteDotCurrent:{ backgroundColor: "#2563eb", borderColor: "#2563eb" },
  paletteDotTxt:    { fontSize: 12, fontWeight: "700" },

  legend:           { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  legendItem:       { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:        { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5 },
  legendTxt:        { fontSize: 10, color: "#64748b" },

  paletteSubmitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#dc2626", marginHorizontal: 16, marginTop: 10, borderRadius: 14, paddingVertical: 14 },
  paletteSubmitTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
