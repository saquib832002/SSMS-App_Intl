/**
 * screens/Exams/AddEditQuestionScreen.js
 * Create or edit a question for any of the 8 supported types.
 * Supports LaTeX math via $...$ delimiters — use the construct buttons to insert
 * fractions, roots, powers, and subscripts without typing LaTeX by hand.
 * Pass route.params.question to edit an existing one; empty object for new.
 */
import React, { useState, useContext, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image, Modal,
  FlatList, Platform, PanResponder, KeyboardAvoidingView,
} from "react-native";
import { WebView } from "react-native-webview";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { AuthContext } from "../../context/AuthContext";
import { createQuestion, updateQuestion } from "../../services/QuestionPaperServiceApi";
import { fetchClasses, fetchBranches, fetchSessions } from "../../services/SetupServiceApi";
import { fetchSubjects } from "../../services/SubjectServiceApi";
import { fetchChapters } from "../../services/TestSeriesServiceApi";
import { HOST_NAME } from "../../Environment/EnvironmentConfig";

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPES = [
  { key: "mcq",          label: "MCQ (Single)",   icon: "list" },
  { key: "multi_correct",label: "Multi-Select",   icon: "check-square" },
  { key: "fill_blank",   label: "Fill Blank",     icon: "minus" },
  { key: "true_false",   label: "True/False",     icon: "check-circle" },
  { key: "short",        label: "Short Ans",      icon: "file-text" },
  { key: "long",         label: "Long Ans",       icon: "align-left" },
  { key: "match",      label: "Match",       icon: "shuffle" },
  { key: "passage",    label: "Passage",     icon: "book-open" },
  { key: "figure",     label: "Figure",      icon: "image" },
];
const DIFFICULTIES = ["easy", "medium", "hard"];

// Extended symbol set — Greek, operators, geometry, set theory
const MATH_SYMBOLS = [
  "△", "∠", "∥", "°", "≅", "~",
  "α", "β", "γ", "θ", "π", "∞",
  "≤", "≥", "≠", "±", "×", "÷",
  "√", "²", "³", "∑", "∈", "∉",
];

// Math construct types shown as buttons
const CONSTRUCTS = [
  { key: "fraction", label: "a/b  Fraction" },
  { key: "sqrt",     label: "√  Root"       },
  { key: "power",    label: "xⁿ  Power"    },
  { key: "sub",      label: "xₙ  Sub"      },
];

// ── Dropdown (matches PaperHeaderScreen style) ────────────────────────────────
function QDropdown({ value, placeholder, items, labelKey, valueKey, onChange, required = false }) {
  const [open, setOpen] = useState(false);
  const allItems = required ? items : [{ [labelKey]: "Any", [valueKey]: "" }, ...items];
  const selected = allItems.find(i => String(i[valueKey]) === String(value ?? ""));
  const label    = selected ? selected[labelKey] : placeholder;
  const isEmpty  = !value;
  return (
    <>
      <TouchableOpacity style={st.ddBox} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <Text style={isEmpty ? st.ddPlaceholder : st.ddText} numberOfLines={1}>{label}</Text>
        <Feather name="chevron-down" size={14} color="#6b7280" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={st.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={st.ddSheet}>
          <View style={st.ddHandle} />
          <Text style={st.ddTitle}>{placeholder}</Text>
          <FlatList
            data={allItems}
            keyExtractor={i => String(i[valueKey])}
            renderItem={({ item }) => {
              const isSel = String(item[valueKey]) === String(value ?? "");
              return (
                <TouchableOpacity
                  style={[st.ddItem, isSel && st.ddItemSel]}
                  onPress={() => { onChange(String(item[valueKey])); setOpen(false); }}
                >
                  <Text style={[st.ddItemTxt, isSel && st.ddItemTxtSel]}>{item[labelKey]}</Text>
                  {isSel && <Feather name="check" size={16} color="#2563eb" />}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={st.ddSep} />}
          />
        </View>
      </Modal>
    </>
  );
}

// ── Crop Modal ────────────────────────────────────────────────────────────────
const HANDLE_SZ = 40; // generous touch target
const HS = HANDLE_SZ / 2;

/**
 * One PanResponder factory per drag mode.
 * All state lives in refs so no stale-closure issues regardless of render cycle.
 */
function makeCropPR(mode, cropRef, startRef, naturalSizeRef, boundsRef, onUpdate) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: () => {
      startRef.current = { ...cropRef.current };
    },
    onPanResponderMove: (_, gs) => {
      const s = startRef.current;
      if (!s) return;
      const { w: NW, h: NH } = naturalSizeRef.current;
      const { sc } = boundsRef.current;
      const dnx = gs.dx / sc, dny = gs.dy / sc;
      const MIN = 60 / sc; // minimum 60 display-px
      let { x, y, w, h } = s;
      switch (mode) {
        case 'move':
          x = Math.max(0, Math.min(NW - w, s.x + dnx));
          y = Math.max(0, Math.min(NH - h, s.y + dny));
          break;
        case 'tl': {
          const ex = s.x + s.w, ey = s.y + s.h;
          x = Math.max(0, Math.min(ex - MIN, s.x + dnx));
          y = Math.max(0, Math.min(ey - MIN, s.y + dny));
          w = ex - x; h = ey - y;
          break;
        }
        case 'tr': {
          const ey = s.y + s.h;
          y = Math.max(0, Math.min(ey - MIN, s.y + dny));
          w = Math.max(MIN, Math.min(NW - s.x, s.w + dnx));
          h = ey - y;
          break;
        }
        case 'bl': {
          const ex = s.x + s.w;
          x = Math.max(0, Math.min(ex - MIN, s.x + dnx));
          w = ex - x;
          h = Math.max(MIN, Math.min(NH - s.y, s.h + dny));
          break;
        }
        case 'br':
          w = Math.max(MIN, Math.min(NW - s.x, s.w + dnx));
          h = Math.max(MIN, Math.min(NH - s.y, s.h + dny));
          break;
      }
      cropRef.current = { x, y, w, h };
      onUpdate();
    },
    onPanResponderRelease: () => { startRef.current = null; },
  });
}

function CropModal({ visible, uri, onDone, onCancel }) {
  // All mutable state lives in refs to avoid stale closures in PanResponders
  const naturalSizeRef = useRef({ w: 1, h: 1 });
  const conSizeRef     = useRef({ w: 1, h: 1 });
  const boundsRef      = useRef({ ox: 0, oy: 0, sc: 1 });
  const cropRef        = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const startRef       = useRef(null);
  // Holds the EXIF-baked URI. applyCrop MUST crop this URI, not the raw `uri` prop,
  // so that its pixel coordinate space matches the dimensions we computed here.
  const normUriRef     = useRef(null);

  const [tick,        setTick]        = useState(0);
  const [ready,       setReady]       = useState(false);
  const [applying,    setApplying]    = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  // Separate display URI so the Image component re-renders when normalization is done
  const [displayUri,  setDisplayUri]  = useState(null);

  const update = () => setTick(t => t + 1);

  // 5 PanResponders — one per interactive zone
  const movePR = useRef(makeCropPR('move', cropRef, startRef, naturalSizeRef, boundsRef, update)).current;
  const tlPR   = useRef(makeCropPR('tl',   cropRef, startRef, naturalSizeRef, boundsRef, update)).current;
  const trPR   = useRef(makeCropPR('tr',   cropRef, startRef, naturalSizeRef, boundsRef, update)).current;
  const blPR   = useRef(makeCropPR('bl',   cropRef, startRef, naturalSizeRef, boundsRef, update)).current;
  const brPR   = useRef(makeCropPR('br',   cropRef, startRef, naturalSizeRef, boundsRef, update)).current;

  const recompute = useCallback((nw, nh, cw, ch) => {
    const sc = Math.min(cw / nw, ch / nh);
    boundsRef.current      = { ox: (cw - nw * sc) / 2, oy: (ch - nh * sc) / 2, sc };
    naturalSizeRef.current = { w: nw, h: nh };
    cropRef.current        = { x: 0, y: 0, w: nw, h: nh };
    setReady(true);
    setTick(t => t + 1);
  }, []);

  // On every open: normalize EXIF by running a double horizontal flip through
  // ImageManipulator. Two flips cancel out visually but the full
  // decode → process → encode pipeline runs, baking any EXIF rotation flag into
  // the pixel data. The result's .width/.height are therefore guaranteed to be the
  // VISUAL (post-rotation) dimensions — exactly what the final crop will use.
  useEffect(() => {
    if (!visible || !uri) {
      setReady(false);
      setDisplayUri(null);
      normUriRef.current = null;
      return;
    }
    setReady(false);
    setDisplayUri(uri);          // show original immediately while normalizing
    normUriRef.current = uri;    // safe fallback until normalization done
    setNormalizing(true);

    let cancelled = false;

    ImageManipulator.manipulateAsync(
      uri,
      [{ flip: 'horizontal' }, { flip: 'horizontal' }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    ).then(norm => {
      if (cancelled) return;
      normUriRef.current = norm.uri;
      setDisplayUri(norm.uri);
      setNormalizing(false);
      const nw = norm.width, nh = norm.height;
      naturalSizeRef.current = { w: nw, h: nh };
      const { w: cw, h: ch } = conSizeRef.current;
      if (cw > 1) recompute(nw, nh, cw, ch);
    }).catch(() => {
      if (cancelled) return;
      // Fallback: original URI + Image.getSize (gallery images are always EXIF-baked)
      setNormalizing(false);
      Image.getSize(uri, (nw, nh) => {
        if (cancelled) return;
        naturalSizeRef.current = { w: nw, h: nh };
        const { w: cw, h: ch } = conSizeRef.current;
        if (cw > 1) recompute(nw, nh, cw, ch);
      }, () => {});
    });

    return () => { cancelled = true; };
  }, [visible, uri, recompute]);

  const onLayout = useCallback((e) => {
    const { width: cw, height: ch } = e.nativeEvent.layout;
    conSizeRef.current = { w: cw, h: ch };
    const { w: nw, h: nh } = naturalSizeRef.current;
    if (nw > 1) recompute(nw, nh, cw, ch);
  }, [recompute]);

  const applyCrop = async () => {
    const { x, y, w, h } = cropRef.current;
    setApplying(true);
    try {
      // Crop the NORMALIZED uri — its pixels are in the same coordinate space
      // as the dimensions we computed above, so the crop box lines up exactly.
      const r = await ImageManipulator.manipulateAsync(
        normUriRef.current,
        [{ crop: { originX: Math.round(x), originY: Math.round(y), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      onDone(r.uri);
    } catch (err) {
      Alert.alert('Crop Error', err?.message ?? String(err));
    } finally {
      setApplying(false);
    }
  };

  const cr = cropRef.current;
  const { ox, oy, sc } = boundsRef.current;
  const dL = ox + cr.x * sc;
  const dT = oy + cr.y * sc;
  const dW = cr.w * sc;
  const dH = cr.h * sc;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
        {/* Header */}
        <View style={cropSt.header}>
          <TouchableOpacity onPress={onCancel} style={cropSt.headerBtn}>
            <Text style={cropSt.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
          <Text style={cropSt.title}>Crop Image</Text>
          <TouchableOpacity onPress={applyCrop} disabled={applying || normalizing} style={cropSt.headerBtn}>
            {(applying || normalizing)
              ? <ActivityIndicator color="#60a5fa" size="small" />
              : <Text style={cropSt.doneTxt}>Done</Text>}
          </TouchableOpacity>
        </View>

        {/* Canvas — normalized image behind, handles on top */}
        <View style={{ flex: 1 }} onLayout={onLayout}>
          {displayUri ? (
            <Image
              source={{ uri: displayUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              pointerEvents="none"
            />
          ) : null}

          {/* Loading overlay while EXIF normalization runs */}
          {normalizing && (
            <View style={[StyleSheet.absoluteFill, cropSt.normOverlay]}>
              <ActivityIndicator color="#60a5fa" size="large" />
              <Text style={cropSt.normTxt}>Preparing image…</Text>
            </View>
          )}

          {ready && !normalizing && (
            <>
              {/* Dim strips outside the crop rect */}
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: dT, backgroundColor: 'rgba(0,0,0,0.6)' }} />
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: dT + dH, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: dL, top: dT, height: dH, backgroundColor: 'rgba(0,0,0,0.6)' }} />
              <View pointerEvents="none" style={{ position: 'absolute', left: dL + dW, right: 0, top: dT, height: dH, backgroundColor: 'rgba(0,0,0,0.6)' }} />

              {/* Crop border + rule-of-thirds */}
              <View pointerEvents="none" style={{ position: 'absolute', left: dL, top: dT, width: dW, height: dH, borderWidth: 1.5, borderColor: '#fff' }}>
                <View style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                <View style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                <View style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                <View style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.35)' }} />
              </View>

              {/* Drag-to-move zone */}
              <View
                style={{ position: 'absolute', left: dL + HS, top: dT + HS, width: Math.max(1, dW - HS * 2), height: Math.max(1, dH - HS * 2) }}
                {...movePR.panHandlers}
              />

              {/* Corner handles */}
              <View style={[cropSt.handle, { left: dL - HS, top: dT - HS, borderRightWidth: 0, borderBottomWidth: 0 }]} {...tlPR.panHandlers} />
              <View style={[cropSt.handle, { left: dL + dW - HS, top: dT - HS, borderLeftWidth: 0, borderBottomWidth: 0 }]} {...trPR.panHandlers} />
              <View style={[cropSt.handle, { left: dL - HS, top: dT + dH - HS, borderRightWidth: 0, borderTopWidth: 0 }]} {...blPR.panHandlers} />
              <View style={[cropSt.handle, { left: dL + dW - HS, top: dT + dH - HS, borderLeftWidth: 0, borderTopWidth: 0 }]} {...brPR.panHandlers} />
            </>
          )}
        </View>

        <Text style={cropSt.hint}>Drag corners or inside box to adjust</Text>
      </View>
    </Modal>
  );
}

const cropSt = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14, backgroundColor: '#1e293b' },
  headerBtn: { minWidth: 70 },
  title:     { color: '#f9fafb', fontSize: 16, fontWeight: '700' },
  cancelTxt: { color: '#94a3b8', fontSize: 15 },
  doneTxt:   { color: '#60a5fa', fontSize: 15, fontWeight: '700', textAlign: 'right' },
  handle:      { position: 'absolute', width: HANDLE_SZ, height: HANDLE_SZ, borderWidth: 3, borderColor: '#fff' },
  hint:        { color: '#64748b', textAlign: 'center', fontSize: 12, paddingVertical: 14, backgroundColor: '#1e293b' },
  normOverlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.7)' },
  normTxt:     { color: '#94a3b8', fontSize: 12, marginTop: 10 },
});

// ── Persisted dropdown selections (survive screen unmount, reset on app restart) ──
// When the user adds multiple questions in a row, these remember the last
// branch / session / class / subject so the user doesn't have to re-select.
const _lastSel = { branchId: "", sessionId: "", classId: "", subjectId: "" };

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AddEditQuestionScreen({ navigation, route }) {
  const { question: editing } = route.params ?? {};
  const { user } = useContext(AuthContext);
  const isEdit = !!editing?.id;

  // ── Shared fields ─────────────────────────────────────────────────────────
  const [type,         setType]         = useState(editing?.type          ?? "mcq");
  const [questionText, setQuestionText] = useState(editing?.question_text ?? "");
  const [answer,       setAnswer]       = useState(editing?.answer        ?? "");
  const [explanation,  setExplanation]  = useState(editing?.explanation   ?? "");
  const [marks,        setMarks]        = useState(String(editing?.marks  ?? "2"));
  const [difficulty,   setDifficulty]   = useState(editing?.difficulty    ?? "medium");
  // chapter_id links the question to ssms_chapters (chapter-wise test series)
  const [chapterId,    setChapterId]    = useState(isEdit ? String(editing?.chapter_id ?? "") : "");
  const [chapters,     setChapters]     = useState([]);
  // For new questions use the last-used values; for edit use the question's values
  const [classId,   setClassId]   = useState(isEdit ? String(editing.class_id   ?? "") : _lastSel.classId);
  const [subjectId, setSubjectId] = useState(isEdit ? String(editing.subject_id ?? "") : _lastSel.subjectId);
  const [branchId,  setBranchId]  = useState(isEdit ? String(editing.branch_id  ?? "") : _lastSel.branchId);
  const [sessionId, setSessionId] = useState(isEdit ? String(editing.session_id ?? "") : _lastSel.sessionId);
  const [branches,     setBranches]     = useState([]);
  const [sessions,     setSessions]     = useState([]);
  const [answerLines,  setAnswerLines]  = useState(String(editing?.answer_lines ?? "0"));
  const [imageUri,     setImageUri]     = useState(() => {
    const url = editing?.image_url ?? null;
    if (!url) return null;
    return url.startsWith("http") ? url : `${HOST_NAME}${url}`;
  });
  const [classes,      setClasses]      = useState([]);
  const [subjects,     setSubjects]     = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [showCrop,     setShowCrop]     = useState(false);

  // ── Math construct state ──────────────────────────────────────────────────
  const [mathModal, setMathModal] = useState(null); // 'fraction' | 'sqrt' | 'power' | 'sub'
  const [mathA,     setMathA]     = useState("");   // numerator / radicand / base
  const [mathB,     setMathB]     = useState("");   // denominator / index / exponent / subscript

  // Debounced preview text — WebView only updates 700ms after last keystroke
  const [previewText,  setPreviewText]  = useState(editing?.question_text ?? "");
  const previewTimer = useRef(null);

  // Cleanup timer on unmount
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current); }, []);

  // ── MCQ fields ────────────────────────────────────────────────────────────
  const parseOptions = () => {
    try {
      const o = typeof editing?.options === "string" ? JSON.parse(editing.options) : editing?.options;
      if (Array.isArray(o) && o.length === 4) return o.map(x => ({ text: x.text ?? "", isCorrect: !!x.isCorrect }));
    } catch {}
    return [{ text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }];
  };
  const [options, setOptions] = useState(parseOptions);

  // ── Match fields ──────────────────────────────────────────────────────────
  const parsePairs = () => {
    try {
      const p = typeof editing?.match_pairs === "string" ? JSON.parse(editing.match_pairs) : editing?.match_pairs;
      if (Array.isArray(p)) return p;
    } catch {}
    return [{ left: "", right: "" }, { left: "", right: "" }];
  };
  const [pairs, setPairs] = useState(parsePairs);

  // ── Load dropdowns ────────────────────────────────────────────────────────
  const norm = (r) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
  useEffect(() => {
    const load = async () => {
      try {
        const [cls, subs, brs, sess] = await Promise.all([
          fetchClasses(user),
          fetchSubjects(user),
          fetchBranches(user),
          fetchSessions(user),
        ]);
        setClasses (Array.isArray(cls)  ? cls  : []);
        setSubjects(Array.isArray(subs) ? subs : []);
        setBranches(norm(brs));
        setSessions(norm(sess));
      } catch {}
    };
    load();
  }, [user]);

  // ── Load chapters when class + subject are set ───────────────────────────
  useEffect(() => {
    if (!user || !classId || !subjectId) { setChapters([]); return; }
    fetchChapters(user, classId, subjectId)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [user, classId, subjectId]);

  // ── Question text change (debounces preview) ──────────────────────────────
  const handleQTextChange = useCallback((text) => {
    setQuestionText(text);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewText(text), 700);
  }, []);

  // ── Selection tracking (for question text formatting) ────────────────────
  const qSelRef = useRef({ start: 0, end: 0 });
  // Per-option selection tracking (A, B, C, D)
  const optSelRefs = useRef([{start:0,end:0},{start:0,end:0},{start:0,end:0},{start:0,end:0}]);

  // ── Generic question-text formatter — wraps selection with open/close tags ──
  const applyQFmt = useCallback((open, close) => {
    const { start, end } = qSelRef.current;
    const updated = start !== end
      ? questionText.slice(0, start) + open + questionText.slice(start, end) + close + questionText.slice(end)
      : questionText.slice(0, start) + open + close + questionText.slice(start);
    handleQTextChange(updated);
  }, [questionText, handleQTextChange]);

  const handleBold      = useCallback(() => applyQFmt("**", "**"), [applyQFmt]);
  const handleItalic    = useCallback(() => applyQFmt("*",  "*"),  [applyQFmt]);
  const handleUnderline = useCallback(() => applyQFmt("__", "__"), [applyQFmt]);

  // ── Per-option formatter ──────────────────────────────────────────────────
  const applyOptFmt = useCallback((idx, open, close) => {
    const sel  = optSelRefs.current[idx] ?? { start: 0, end: 0 };
    const text = options[idx]?.text ?? "";
    const { start, end } = sel;
    const updated = start !== end
      ? text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end)
      : text.slice(0, start) + open + close + text.slice(start);
    setOptionText(idx, updated);
  }, [options]);

  // ── MathJax preview HTML ──────────────────────────────────────────────────
  const previewHtml = useMemo(() => {
    const escaped = previewText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // bold (before italic so ** isn't caught by single-* rule)
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      // italic
      .replace(/\*([^*\n]+)\*/g, "<i>$1</i>")
      // underline markers → <u> (must come before blank-fill which also uses underscores)
      .replace(/__([^_\n]+)__/g, "<u>$1</u>")
      .replace(/___+/g, '<span style="border-bottom:1px solid #000;display:inline-block;min-width:60px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>')
      .replace(/\n/g, "<br>");
    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<script>MathJax={tex:{inlineMath:[['$','$']],displayMath:[['$$','$$']]}};</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>
<style>body{font-family:sans-serif;font-size:15px;padding:8px 12px;margin:0;color:#0f172a;line-height:1.8;word-break:break-word}</style>
</head><body>${escaped}</body></html>`;
  }, [previewText]);

  // ── Math construct helpers ────────────────────────────────────────────────
  const openMath = (type) => { setMathA(""); setMathB(""); setMathModal(type); };

  const insertMath = (latex) => {
    const newText = questionText.trimEnd();
    const updated = (newText ? newText + " " : "") + "$" + latex + "$ ";
    setQuestionText(updated);
    setPreviewText(updated);
    setMathModal(null);
    setMathA("");
    setMathB("");
  };

  // ── Image picker ──────────────────────────────────────────────────────────
  // Use string literal 'images' instead of ImagePicker.MediaType.Images —
  // the enum can be undefined in ProGuard-minified production builds,
  // causing a silent crash. String literals are always safe.
  const pickImage = () => {
    Alert.alert("Attach Figure", "Choose image source", [
      {
        text: "Photo Library",
        onPress: async () => {
          try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== "granted") { Alert.alert("Permission needed", "Allow photo library access to attach images."); return; }
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
            if (!result.canceled) { setImageUri(result.assets[0].uri); setShowCrop(true); }
          } catch (e) {
            Alert.alert("Gallery Error", e?.message ?? String(e));
          }
        },
      },
      {
        text: "Camera",
        onPress: async () => {
          try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== "granted") { Alert.alert("Permission needed", "Allow camera access to take a photo."); return; }
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 });
            if (!result.canceled) {
              // Pass raw URI straight to CropModal — it normalizes EXIF internally
              setImageUri(result.assets[0].uri);
              setShowCrop(true);
            }
          } catch (e) {
            Alert.alert("Camera Error", e?.message ?? String(e));
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // ── MCQ helpers ───────────────────────────────────────────────────────────
  const OPT_LETTERS = ["A", "B", "C", "D", "E", "F"];
  const setOptionText  = (idx, text) => setOptions(prev => prev.map((o, i) => i === idx ? { ...o, text } : o));
  // Single-correct: only one option can be correct at a time; also sync the answer field
  const setCorrect = (idx) => {
    setOptions(prev => prev.map((o, i) => ({ ...o, isCorrect: i === idx })));
    setAnswer(OPT_LETTERS[idx] ?? String(idx + 1));
  };
  // Multi-correct: toggle individual option; also sync the answer field
  const toggleCorrect = (idx) => {
    setOptions(prev => {
      const next = prev.map((o, i) => i === idx ? { ...o, isCorrect: !o.isCorrect } : o);
      const letters = next
        .map((o, i) => (o.isCorrect ? (OPT_LETTERS[i] ?? String(i + 1)) : null))
        .filter(Boolean);
      setAnswer(letters.join(","));
      return next;
    });
  };

  // ── Pair helpers ──────────────────────────────────────────────────────────
  const setPairField = (idx, field, val) => setPairs(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  const addPair      = () => setPairs(prev => [...prev, { left: "", right: "" }]);
  const removePair   = (idx) => setPairs(prev => prev.filter((_, i) => i !== idx));

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!questionText.trim()) { Alert.alert("Validation", "Question text is required."); return; }
    if (!branchId)            { Alert.alert("Validation", "Please select a branch.");   return; }
    if (!sessionId)           { Alert.alert("Validation", "Please select a session.");  return; }
    if (!classId)             { Alert.alert("Validation", "Please select a class.");    return; }
    if (!subjectId)           { Alert.alert("Validation", "Please select a subject.");  return; }

    // ── Validate the answer field — qb.answer is the authoritative source ─
    // The admin types the correct letter (A/B/C/D) in the Answer text box.
    const VALID_LETTERS = ["A", "B", "C", "D", "E", "F"];
    const derivedAnswer = answer.trim().toUpperCase();
    if (type === "mcq" || type === "true_false") {
      if (!VALID_LETTERS.includes(derivedAnswer)) {
        Alert.alert("Validation", "Please enter the correct answer letter (A, B, C, or D) in the Answer field.");
        return;
      }
    } else if (type === "multi_correct") {
      const letters = derivedAnswer.split(",").map((l) => l.trim()).filter(Boolean);
      if (letters.length === 0 || letters.some((l) => !VALID_LETTERS.includes(l))) {
        Alert.alert("Validation", "Please enter valid answer letters separated by commas (e.g. A,C) in the Answer field.");
        return;
      }
    }

    const payload = {
      type, question_text: questionText.trim(), answer: derivedAnswer,
      explanation: explanation.trim(),
      marks: parseInt(marks) || 1, difficulty,
      chapter_id:   chapterId ? parseInt(chapterId) : null,
      branch_id:    parseInt(branchId),
      session_id:   parseInt(sessionId),
      class_id:     parseInt(classId),
      subject_id:   parseInt(subjectId),
      answer_lines: parseInt(answerLines) || 0,
      options:      (type === "mcq" || type === "true_false" || type === "multi_correct") ? options : undefined,
      match_pairs:  type === "match" ? pairs : undefined,
    };
    if (imageUri && !imageUri.startsWith("http")) payload.imageUri = imageUri;
    try {
      setSaving(true);
      if (isEdit) {
        await updateQuestion(user, editing.id, payload);
        Alert.alert("Success", "Question updated.", [{ text: "OK", onPress: () => navigation.goBack() }]);
      } else {
        await createQuestion(user, payload);
        // Stay on screen — reset question fields but keep dropdowns + type + difficulty
        setQuestionText("");
        setAnswer("");
        setExplanation("");
        setMarks("2");
        setChapterId("");
        setAnswerLines("0");
        setImageUri(null);
        setPreviewText("");
        setOptions([
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
        ]);
        setPairs([{ left: "", right: "" }, { left: "", right: "" }]);
        Alert.alert("✓ Question Added", "Question saved successfully. You can add the next one.");
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={st.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Branch / Session / Class / Subject — at top so user sets context first */}
        <Text style={st.sectionLabel}>Branch &amp; Session *</Text>
        <View style={st.ddRow}>
          <View style={st.ddCell}>
            <QDropdown required value={branchId} placeholder="Select Branch"
              items={branches} labelKey="branch_name" valueKey="branch_id"
              onChange={v => { setBranchId(v);  _lastSel.branchId  = v; }} />
          </View>
          <View style={st.ddCell}>
            <QDropdown required value={sessionId} placeholder="Select Session"
              items={sessions} labelKey="session_name" valueKey="session_id"
              onChange={v => { setSessionId(v); _lastSel.sessionId = v; }} />
          </View>
        </View>

        <Text style={st.sectionLabel}>Class &amp; Subject *</Text>
        <View style={st.ddRow}>
          <View style={st.ddCell}>
            <QDropdown required value={classId} placeholder="Select Class"
              items={classes} labelKey="class_name" valueKey="class_id"
              onChange={v => { setClassId(v); setChapterId(""); _lastSel.classId = v; }} />
          </View>
          <View style={st.ddCell}>
            <QDropdown required value={subjectId} placeholder="Select Subject"
              items={subjects} labelKey="subject_name" valueKey="subject_id"
              onChange={v => { setSubjectId(v); setChapterId(""); _lastSel.subjectId = v; }} />
          </View>
        </View>

        {/* Chapter picker — appears once class + subject are selected AND chapters exist */}
        {classId && subjectId && chapters.length > 0 && (
          <>
            <Text style={st.sectionLabel}>Chapter (optional)</Text>
            <QDropdown
              value={chapterId}
              placeholder="Select chapter…"
              items={chapters}
              labelKey="chapter_name"
              valueKey="id"
              onChange={setChapterId}
            />
          </>
        )}

        {/* Type selector */}
        <Text style={st.sectionLabel}>Question Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.typeRow} contentContainerStyle={{ gap: 8, paddingRight: 14 }}>
          {TYPES.map(t => (
            <TouchableOpacity key={t.key} style={[st.typeChip, type === t.key && st.typeChipSel]} onPress={() => setType(t.key)}>
              <Feather name={t.icon} size={13} color={type === t.key ? "#fff" : "#374151"} />
              <Text style={[st.typeChipTxt, type === t.key && st.typeChipTxtSel]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Question text */}
        <Text style={st.sectionLabel}>Question Text {type === "fill_blank" ? "(use ___ for blanks)" : ""}</Text>
        <TextInput
          style={st.textArea}
          multiline
          numberOfLines={4}
          placeholder={type === "fill_blank"
            ? "e.g. All circles are _______________ (congruent / similar)"
            : "Enter question here… use $ $ for math, e.g. $\\frac{1}{2}$"}
          placeholderTextColor="#9ca3af"
          value={questionText}
          onChangeText={handleQTextChange}
          onSelectionChange={e => { qSelRef.current = e.nativeEvent.selection; }}
          textAlignVertical="top"
        />

        {/* Formatting toolbar */}
        <Text style={st.toolbarLabel}>Formatting — select text then tap</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
          <TouchableOpacity style={[st.constructBtn, { paddingHorizontal: 16 }]} onPress={handleBold}>
            <Text style={[st.constructBtnTxt, { fontWeight: "900" }]}>B</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.constructBtn, { paddingHorizontal: 16 }]} onPress={handleItalic}>
            <Text style={[st.constructBtnTxt, { fontStyle: "italic" }]}>I</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.constructBtn, { paddingHorizontal: 16 }]} onPress={handleUnderline}>
            <Text style={[st.constructBtnTxt, { textDecorationLine: "underline" }]}>U</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center", flex: 1 }}>
            Bold **text**, Italic *text*, Underline __text__
          </Text>
        </View>

        {/* Symbol toolbar */}
        <Text style={st.toolbarLabel}>Symbols</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.symbolRow} contentContainerStyle={{ gap: 6, paddingRight: 14 }}>
          {MATH_SYMBOLS.map(sym => (
            <TouchableOpacity key={sym} style={st.symBtn} onPress={() => handleQTextChange(questionText + sym)}>
              <Text style={st.symTxt}>{sym}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Math construct buttons */}
        <Text style={st.toolbarLabel}>Math constructs</Text>
        <View style={st.constructRow}>
          {CONSTRUCTS.map(c => (
            <TouchableOpacity key={c.key} style={st.constructBtn} onPress={() => openMath(c.key)}>
              <Text style={st.constructBtnTxt}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Live preview — shows when question contains $...$ math or formatting markers */}
        {(previewText.includes("$") || previewText.includes("__") || previewText.includes("*")) && (
          <View style={st.mathPreviewWrap}>
            <Text style={st.mathPreviewLabel}>Rendered preview</Text>
            <WebView
              source={{ html: previewHtml }}
              style={st.mathPreviewView}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              originWhitelist={["*"]}
            />
          </View>
        )}

        {/* ── MCQ options (single-correct — radio) ────────────────── */}
        {type === "mcq" && (
          <>
            <Text style={st.sectionLabel}>Options — tap the circle to mark the ONE correct answer</Text>
            {options.map((opt, idx) => (
              <View key={idx} style={{ marginBottom: 8 }}>
                <View style={[st.optRow, { marginBottom: 2 }]}>
                  <TouchableOpacity style={[st.optRadio, opt.isCorrect && st.optRadioSel]} onPress={() => setCorrect(idx)}>
                    {opt.isCorrect && <View style={st.optRadioDot} />}
                  </TouchableOpacity>
                  <Text style={st.optLabel}>{["A", "B", "C", "D"][idx]}.</Text>
                  <TextInput
                    style={st.optInput}
                    placeholder={`Option ${["A","B","C","D"][idx]}`}
                    placeholderTextColor="#9ca3af"
                    value={opt.text}
                    onChangeText={t => setOptionText(idx, t)}
                    onSelectionChange={e => { optSelRefs.current[idx] = e.nativeEvent.selection; }}
                  />
                </View>
                <View style={st.optFmtRow}>
                  <TouchableOpacity style={st.optFmtBtn} onPress={() => applyOptFmt(idx, "**", "**")}>
                    <Text style={[st.optFmtTxt, { fontWeight: "900" }]}>B</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.optFmtBtn} onPress={() => applyOptFmt(idx, "*", "*")}>
                    <Text style={[st.optFmtTxt, { fontStyle: "italic" }]}>I</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.optFmtBtn} onPress={() => applyOptFmt(idx, "__", "__")}>
                    <Text style={[st.optFmtTxt, { textDecorationLine: "underline" }]}>U</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Multi-Select options (multiple-correct) ──────────────── */}
        {type === "multi_correct" && (
          <>
            <Text style={st.sectionLabel}>Options (enter text for each option)</Text>
            {options.map((opt, idx) => (
              <View key={idx} style={{ marginBottom: 8 }}>
                <View style={[st.optRow, { marginBottom: 2 }]}>
                  <Text style={st.optLabel}>{["A", "B", "C", "D"][idx]}.</Text>
                  <TextInput
                    style={st.optInput}
                    placeholder={`Option ${["A","B","C","D"][idx]}`}
                    placeholderTextColor="#9ca3af"
                    value={opt.text}
                    onChangeText={t => setOptionText(idx, t)}
                    onSelectionChange={e => { optSelRefs.current[idx] = e.nativeEvent.selection; }}
                  />
                </View>
                <View style={st.optFmtRow}>
                  <TouchableOpacity style={st.optFmtBtn} onPress={() => applyOptFmt(idx, "**", "**")}>
                    <Text style={[st.optFmtTxt, { fontWeight: "900" }]}>B</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.optFmtBtn} onPress={() => applyOptFmt(idx, "*", "*")}>
                    <Text style={[st.optFmtTxt, { fontStyle: "italic" }]}>I</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.optFmtBtn} onPress={() => applyOptFmt(idx, "__", "__")}>
                    <Text style={[st.optFmtTxt, { textDecorationLine: "underline" }]}>U</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <Text style={[st.sectionLabel, { marginTop: 10 }]}>Correct Answers</Text>
            <TextInput
              style={st.textInput}
              placeholder="Enter correct option letters separated by commas — e.g. A,C or A,B,D"
              placeholderTextColor="#9ca3af"
              value={answer}
              onChangeText={setAnswer}
              autoCapitalize="characters"
            />
          </>
        )}

        {/* ── True/False ──────────────────────────────────────────── */}
        {type === "true_false" && (
          <>
            <Text style={st.sectionLabel}>Correct Answer</Text>
            <View style={st.tfRow}>
              {["True", "False"].map((val, idx) => (
                <TouchableOpacity key={val} style={[st.tfBtn, options[idx]?.isCorrect && st.tfBtnSel]}
                  onPress={() => setOptions([{ text: "True", isCorrect: idx === 0 }, { text: "False", isCorrect: idx === 1 }])}>
                  <Text style={[st.tfTxt, options[idx]?.isCorrect && st.tfTxtSel]}>{val}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ── Match pairs ─────────────────────────────────────────── */}
        {type === "match" && (
          <>
            <Text style={st.sectionLabel}>Match Pairs</Text>
            {pairs.map((pair, idx) => (
              <View key={idx} style={st.pairRow}>
                <Text style={st.pairNum}>{idx + 1}.</Text>
                <TextInput style={[st.pairInput, { flex: 1 }]} placeholder="Column A" placeholderTextColor="#9ca3af" value={pair.left}  onChangeText={v => setPairField(idx, "left",  v)} />
                <Feather name="arrow-right" size={14} color="#9ca3af" style={{ marginHorizontal: 6 }} />
                <TextInput style={[st.pairInput, { flex: 1 }]} placeholder="Column B" placeholderTextColor="#9ca3af" value={pair.right} onChangeText={v => setPairField(idx, "right", v)} />
                {pairs.length > 2 && (
                  <TouchableOpacity onPress={() => removePair(idx)} style={st.pairDel}>
                    <Feather name="x" size={14} color="#dc2626" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity style={st.addPairBtn} onPress={addPair}>
              <Feather name="plus" size={14} color="#2563eb" />
              <Text style={st.addPairTxt}>Add Pair</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Answer lines ────────────────────────────────────────── */}
        {(type === "short" || type === "long") && (
          <>
            <Text style={st.sectionLabel}>Answer Lines in Print</Text>
            <View style={st.ansRow}>
              {(type === "short" ? ["0", "4", "5", "6"] : ["0", "8", "10", "12", "15"]).map(n => (
                <TouchableOpacity key={n} style={[st.ansChip, answerLines === n && st.ansChipSel]} onPress={() => setAnswerLines(n)}>
                  <Text style={[st.ansChipTxt, answerLines === n && st.ansChipTxtSel]}>{n === "0" ? "No lines" : `${n} lines`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Image attachment */}
        <Text style={st.sectionLabel}>Attach Figure / Image (optional)</Text>
        <TouchableOpacity style={st.imagePick} onPress={pickImage}>
          {imageUri ? (
            <View style={st.imagePreviewWrap}>
              <Image source={{ uri: imageUri }} style={st.imagePreview} resizeMode="contain" />
              <View style={st.imageActions}>
                <TouchableOpacity style={st.imageActionBtn} onPress={() => setShowCrop(true)}>
                  <Feather name="crop" size={16} color="#2563eb" />
                  <Text style={st.imageActionTxt}>Crop</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.imageActionBtn, { borderColor: '#fca5a5' }]} onPress={() => setImageUri(null)}>
                  <Feather name="x" size={16} color="#dc2626" />
                  <Text style={[st.imageActionTxt, { color: '#dc2626' }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={st.imagePlaceholder}>
              <Feather name="image" size={28} color="#9ca3af" />
              <Text style={st.imagePlaceholderTxt}>Tap to attach a figure or diagram</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Model answer */}
        <Text style={st.sectionLabel}>Correct Answer (for auto-scoring)</Text>
        <TextInput style={[st.textArea, { minHeight: 70 }]} multiline placeholder="For fill-in-the-blank: enter the exact correct answer. For MCQ/Multi-correct: leave blank (isCorrect flags on options are used)." placeholderTextColor="#9ca3af" value={answer} onChangeText={setAnswer} textAlignVertical="top" />

        {/* Explanation */}
        <Text style={st.sectionLabel}>Explanation (shown to student after submission)</Text>
        <TextInput style={[st.textArea, { minHeight: 80 }]} multiline placeholder="Explain why this is the correct answer, solution steps, concept notes…" placeholderTextColor="#9ca3af" value={explanation} onChangeText={setExplanation} textAlignVertical="top" />

        {/* Metadata */}
        <View style={st.metaGrid}>
          <View style={st.metaCell}>
            <Text style={st.metaLabel}>Marks</Text>
            <TextInput style={st.metaInput} keyboardType="numeric" value={marks} onChangeText={setMarks} />
          </View>
        </View>

        {/* Difficulty */}
        <Text style={st.sectionLabel}>Difficulty</Text>
        <View style={st.diffRow}>
          {DIFFICULTIES.map(d => (
            <TouchableOpacity key={d} style={[st.diffChip, difficulty === d && st.diffChipSel(d)]} onPress={() => setDifficulty(d)}>
              <Text style={[st.diffTxt, difficulty === d && { color: "#fff", fontWeight: "700" }]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Save button — inside scroll so keyboard never hides it */}
        <View style={st.footer}>
          <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <><Feather name="save" size={18} color="#fff" /><Text style={st.saveTxt}>{isEdit ? "Update Question" : "Add to Question Bank"}</Text></>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Crop modal ───────────────────────────────────────────── */}
      <CropModal
        visible={showCrop}
        uri={imageUri}
        onDone={(croppedUri) => { setImageUri(croppedUri); setShowCrop(false); }}
        onCancel={() => setShowCrop(false)}
      />

      {/* ── Math construct modal ──────────────────────────────────── */}
      <Modal visible={!!mathModal} transparent animationType="slide" onRequestClose={() => setMathModal(null)}>
        <TouchableOpacity style={st.ddOverlay} activeOpacity={1} onPress={() => setMathModal(null)} />
        <View style={st.mathSheet}>
          <View style={st.ddHandle} />

          {/* Fraction */}
          {mathModal === "fraction" && <>
            <Text style={st.mathTitle}>Insert fraction</Text>
            <View style={st.fracBuilder}>
              <TextInput style={st.mathInput} value={mathA} onChangeText={setMathA}
                placeholder="Numerator" placeholderTextColor="#9ca3af" autoFocus textAlign="center" />
              <View style={st.fracLine} />
              <TextInput style={st.mathInput} value={mathB} onChangeText={setMathB}
                placeholder="Denominator" placeholderTextColor="#9ca3af" textAlign="center" />
            </View>
            {!!(mathA || mathB) && (
              <View style={st.mathLivePreview}>
                <View style={st.fracPreview}>
                  <Text style={st.fracPreviewNum}>{mathA || "a"}</Text>
                  <View style={st.fracPreviewLine} />
                  <Text style={st.fracPreviewDen}>{mathB || "b"}</Text>
                </View>
              </View>
            )}
            <Text style={st.mathHint}>Will insert: $\frac&#123;{mathA || "a"}&#125;&#123;{mathB || "b"}&#125;$</Text>
            <View style={st.mathBtns}>
              <TouchableOpacity style={st.mathCancelBtn} onPress={() => setMathModal(null)}>
                <Text style={st.mathCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.mathInsertBtn, !(mathA && mathB) && { opacity: 0.4 }]}
                onPress={() => mathA && mathB && insertMath(`\\frac{${mathA}}{${mathB}}`)}>
                <Text style={st.mathInsertTxt}>Insert</Text>
              </TouchableOpacity>
            </View>
          </>}

          {/* Square root */}
          {mathModal === "sqrt" && <>
            <Text style={st.mathTitle}>Insert square / nth root</Text>
            <View style={st.mathRow}>
              <Text style={st.mathSymLarge}>√</Text>
              <TextInput style={[st.mathInput, { flex: 1 }]} value={mathA} onChangeText={setMathA}
                placeholder="Value inside root (e.g. 144 or x+1)" placeholderTextColor="#9ca3af" autoFocus />
            </View>
            <Text style={st.mathHint}>For cube root (³√) etc., enter the index n:</Text>
            <TextInput style={st.mathInput} value={mathB} onChangeText={setMathB}
              placeholder="Index n (leave empty for square root)" placeholderTextColor="#9ca3af"
              keyboardType="numeric" />
            <View style={st.mathBtns}>
              <TouchableOpacity style={st.mathCancelBtn} onPress={() => setMathModal(null)}>
                <Text style={st.mathCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.mathInsertBtn, !mathA && { opacity: 0.4 }]}
                onPress={() => mathA && insertMath(mathB ? `\\sqrt[${mathB}]{${mathA}}` : `\\sqrt{${mathA}}`)}>
                <Text style={st.mathInsertTxt}>Insert</Text>
              </TouchableOpacity>
            </View>
          </>}

          {/* Power */}
          {mathModal === "power" && <>
            <Text style={st.mathTitle}>Insert power / exponent</Text>
            <View style={st.mathRow}>
              <TextInput style={[st.mathInput, { flex: 1 }]} value={mathA} onChangeText={setMathA}
                placeholder="Base (e.g. x or 2)" placeholderTextColor="#9ca3af" autoFocus textAlign="center" />
              <Text style={st.mathOp}>^</Text>
              <TextInput style={[st.mathInput, { flex: 1 }]} value={mathB} onChangeText={setMathB}
                placeholder="Exponent (e.g. 2)" placeholderTextColor="#9ca3af" textAlign="center" />
            </View>
            <Text style={st.mathHint}>e.g. base x, exponent 2  →  x²</Text>
            <View style={st.mathBtns}>
              <TouchableOpacity style={st.mathCancelBtn} onPress={() => setMathModal(null)}>
                <Text style={st.mathCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.mathInsertBtn, !(mathA && mathB) && { opacity: 0.4 }]}
                onPress={() => mathA && mathB && insertMath(`${mathA}^{${mathB}}`)}>
                <Text style={st.mathInsertTxt}>Insert</Text>
              </TouchableOpacity>
            </View>
          </>}

          {/* Subscript */}
          {mathModal === "sub" && <>
            <Text style={st.mathTitle}>Insert subscript</Text>
            <View style={st.mathRow}>
              <TextInput style={[st.mathInput, { flex: 1 }]} value={mathA} onChangeText={setMathA}
                placeholder="Base (e.g. a or H)" placeholderTextColor="#9ca3af" autoFocus textAlign="center" />
              <Text style={st.mathOp}>_</Text>
              <TextInput style={[st.mathInput, { flex: 1 }]} value={mathB} onChangeText={setMathB}
                placeholder="Subscript (e.g. n or 2)" placeholderTextColor="#9ca3af" textAlign="center" />
            </View>
            <Text style={st.mathHint}>e.g. base H, subscript 2  →  H₂</Text>
            <View style={st.mathBtns}>
              <TouchableOpacity style={st.mathCancelBtn} onPress={() => setMathModal(null)}>
                <Text style={st.mathCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.mathInsertBtn, !(mathA && mathB) && { opacity: 0.4 }]}
                onPress={() => mathA && mathB && insertMath(`${mathA}_{${mathB}}`)}>
                <Text style={st.mathInsertTxt}>Insert</Text>
              </TouchableOpacity>
            </View>
          </>}

        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const DIFF_COLORS = { easy: "#16a34a", medium: "#d97706", hard: "#dc2626" };

const st = StyleSheet.create({
  root:           { flex: 1, backgroundColor: "#f8fafc" },
  scroll:         { padding: 16, paddingBottom: 24 },
  sectionLabel:   { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 16, marginBottom: 6 },
  toolbarLabel:   { fontSize: 11, fontWeight: "600", color: "#6b7280", marginTop: 10, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  typeRow:        { marginBottom: 4, flexGrow: 0 },
  typeChip:       { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1.5, borderColor: "#d1d5db", paddingHorizontal: 12, paddingVertical: 6 },
  typeChipSel:    { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  typeChipTxt:    { fontSize: 12, color: "#374151", fontWeight: "600" },
  typeChipTxtSel: { color: "#fff" },
  textArea:       { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, fontSize: 14, color: "#0f172a", minHeight: 90 },
  symbolRow:      { flexGrow: 0 },
  symBtn:         { backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5, minWidth: 32, alignItems: "center" },
  symTxt:         { fontSize: 16, color: "#1e40af" },

  // Math construct buttons
  constructRow:     { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 4 },
  constructBtn:     { backgroundColor: "#eff6ff", borderRadius: 8, borderWidth: 1, borderColor: "#bfdbfe", paddingHorizontal: 13, paddingVertical: 7 },
  constructBtnTxt:  { fontSize: 12, color: "#1d4ed8", fontWeight: "600" },

  // MathJax live preview
  mathPreviewWrap:  { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden", marginTop: 8, marginBottom: 4 },
  mathPreviewLabel: { fontSize: 11, color: "#9ca3af", paddingHorizontal: 10, paddingTop: 6 },
  mathPreviewView:  { height: 100 },

  // MCQ
  optRow:         { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  optRadio:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#9ca3af", alignItems: "center", justifyContent: "center" },
  optRadioSel:     { borderColor: "#2563eb" },
  optRadioDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: "#2563eb" },
  optCheckbox:     { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#9ca3af", alignItems: "center", justifyContent: "center" },
  optCheckboxSel:  { borderColor: "#7c3aed", backgroundColor: "#7c3aed" },
  optLabel:       { fontSize: 14, fontWeight: "700", color: "#374151", width: 20 },
  optInput:       { flex: 1, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 9, fontSize: 14, color: "#0f172a" },
  optFmtRow:      { flexDirection: "row", gap: 6, paddingLeft: 56 },
  optFmtBtn:      { backgroundColor: "#f1f5f9", borderRadius: 5, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 10, paddingVertical: 3 },
  optFmtTxt:      { fontSize: 12, color: "#1d4ed8" },
  // True/False
  tfRow:          { flexDirection: "row", gap: 12, marginBottom: 4 },
  tfBtn:          { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: "#d1d5db" },
  tfBtnSel:       { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  tfTxt:          { fontSize: 15, fontWeight: "600", color: "#374151" },
  tfTxtSel:       { color: "#fff" },
  // Match pairs
  pairRow:        { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  pairNum:        { fontSize: 13, fontWeight: "700", color: "#374151", width: 22 },
  pairInput:      { backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 8, fontSize: 13, color: "#0f172a" },
  pairDel:        { marginLeft: 6, padding: 4 },
  addPairBtn:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2, paddingVertical: 6 },
  addPairTxt:     { fontSize: 13, color: "#2563eb", fontWeight: "600" },
  // Answer lines
  ansRow:         { flexDirection: "row", gap: 8 },
  ansChip:        { borderRadius: 8, borderWidth: 1.5, borderColor: "#d1d5db", paddingHorizontal: 14, paddingVertical: 6 },
  ansChipSel:     { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  ansChipTxt:     { fontSize: 13, color: "#374151" },
  ansChipTxtSel:  { color: "#fff", fontWeight: "700" },
  // Image
  imagePick:         { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1.5, borderColor: "#e2e8f0", borderStyle: "dashed", overflow: "hidden", minHeight: 100 },
  imagePlaceholder:  { alignItems: "center", justifyContent: "center", padding: 20, gap: 6 },
  imagePlaceholderTxt: { fontSize: 13, color: "#9ca3af", textAlign: "center" },
  imagePreviewWrap:  { position: "relative" },
  imagePreview:      { width: "100%", height: 180 },
  imageActions:      { flexDirection: "row", gap: 8, padding: 8 },
  imageActionBtn:    { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#eff6ff" },
  imageActionTxt:    { fontSize: 12, fontWeight: "600", color: "#2563eb" },
  // Metadata
  metaGrid:       { flexDirection: "row", gap: 12, marginTop: 4 },
  metaCell:       { flex: 1 },
  metaLabel:      { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 4 },
  metaInput:      { backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 9, fontSize: 14, color: "#0f172a" },
  // Difficulty
  diffRow:        { flexDirection: "row", gap: 10 },
  diffChip:       { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: "#d1d5db" },
  diffChipSel:    (d) => ({ backgroundColor: DIFF_COLORS[d] ?? "#374151", borderColor: DIFF_COLORS[d] ?? "#374151" }),
  diffTxt:        { fontSize: 13, color: "#374151", fontWeight: "600", textTransform: "capitalize" },
  // Dropdowns
  ddRow:          { flexDirection: "row", gap: 10, marginBottom: 4 },
  ddCell:         { flex: 1 },
  ddBox:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10 },
  ddText:         { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "500", marginRight: 6 },
  ddPlaceholder:  { flex: 1, fontSize: 13, color: "#9ca3af", marginRight: 6 },
  ddOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  ddSheet:        { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "60%", paddingBottom: 20 },
  ddHandle:       { width: 36, height: 4, backgroundColor: "#d1d5db", borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  ddTitle:        { fontSize: 14, fontWeight: "700", color: "#0f172a", paddingHorizontal: 18, paddingBottom: 8 },
  ddItem:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12 },
  ddItemSel:      { backgroundColor: "#eff6ff" },
  ddItemTxt:      { fontSize: 14, color: "#374151" },
  ddItemTxtSel:   { color: "#2563eb", fontWeight: "700" },
  ddSep:          { height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 18 },
  // Footer
  footer:         { paddingHorizontal: 14, paddingVertical: 10 },
  saveBtn:        { backgroundColor: "#2563eb", borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  saveTxt:        { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Math modal sheet
  mathSheet:       { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 20, paddingBottom: Platform.OS === "ios" ? 32 : 20 },
  mathTitle:       { fontSize: 15, fontWeight: "800", color: "#1e293b", marginBottom: 14 },
  mathInput:       { backgroundColor: "#f8fafc", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0f172a" },
  mathRow:         { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  mathOp:          { fontSize: 22, color: "#374151", fontWeight: "700", minWidth: 20, textAlign: "center" },
  mathSymLarge:    { fontSize: 26, color: "#374151", marginRight: 4 },
  mathHint:        { fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 2 },
  mathBtns:        { flexDirection: "row", gap: 10, marginTop: 16 },
  mathCancelBtn:   { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center" },
  mathCancelTxt:   { fontSize: 14, color: "#64748b" },
  mathInsertBtn:   { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: "#2563eb", alignItems: "center" },
  mathInsertTxt:   { fontSize: 14, color: "#fff", fontWeight: "700" },
  // Fraction builder inside modal
  fracBuilder:     { alignItems: "center", gap: 0, marginBottom: 12 },
  fracLine:        { width: "60%", height: 1.5, backgroundColor: "#0f172a", marginVertical: 4 },
  mathLivePreview: { alignItems: "center", padding: 10, backgroundColor: "#f8fafc", borderRadius: 8, marginBottom: 4 },
  fracPreview:     { alignItems: "center" },
  fracPreviewNum:  { fontSize: 16, color: "#0f172a", textAlign: "center", paddingBottom: 2 },
  fracPreviewLine: { width: 80, height: 1.5, backgroundColor: "#0f172a" },
  fracPreviewDen:  { fontSize: 16, color: "#0f172a", textAlign: "center", paddingTop: 2 },
});
