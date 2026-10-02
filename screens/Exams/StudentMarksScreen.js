/**
 * screens/Exams/StudentMarksScreen.js
 * Class-wise student marks — horizontal matrix table (Student | Subject… | Total)
 * with PDF export matching the same layout, school header included.
 */
import React, { useState, useContext, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Modal, FlatList,
  StyleSheet, Alert, ActivityIndicator, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import * as Print   from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

import { AuthContext } from "../../context/AuthContext";
import { fetchExams, fetchClassMarksMatrix, fetchSchoolInfo } from "../../services/ExamServiceApi";
import { fetchBranches, fetchClasses, fetchSections, fetchSessions } from "../../services/SetupServiceApi";
import { BASE_URL, HOST_NAME } from "../../Environment/EnvironmentConfig";

const PURPLE  = "#6b21a8";
const SNO_W   = 36;   // serial number column
const NAME_W  = 140;  // fixed student name column
const ROLL_W  = 52;   // roll number column
const MARK_W  = 52;   // width of each mark-type sub-column (Th / Int / Pr) — all equal
const TOTAL_W = 70;   // total obtained / max column
const PCT_W   = 54;   // percentage column

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[S.dd, disabled && S.ddDis]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[S.ddTxt, !sel?.value && S.ddPh]} numberOfLines={1}>
          {loading ? "Loading…" : (sel?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={S.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={S.ddSheet}>
            <View style={S.ddHead}>
              <Text style={S.ddTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={S.ddClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[S.ddOpt, String(o.value) === String(value) && S.ddOptAct]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[S.ddOptTxt, String(o.value) === String(value) && S.ddOptTxtAct]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) &&
                    <Feather name="check" size={13} color={PURPLE} />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── PDF HTML builder ──────────────────────────────────────────────────────────
// subjectCols: [{ subject_id, subject_name, subject_code, cols:[{key,label,max_key}] }]
function buildMatrixHTML(subjectCols, students, examName, schoolInfo, className, sectionName) {
  const logoHtml = schoolInfo?.logo
    ? `<img src="${schoolInfo.logo}" style="width:68px;height:68px;object-fit:contain;"/>`
    : `<div style="width:68px;height:68px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:900;">${(schoolInfo?.name ?? "S")[0]}</div>`;

  // ── Column width helpers ───────────────────────────────────────────────────
  // All numeric mark columns share the same fixed width for uniformity.
  const COL_W   = "42px";   // each sub-column (Th / Int / Pr)
  const TOTAL_W = "52px";
  const PCT_W   = "40px";
  const ROLL_W  = "38px";
  const NAME_W  = "140px";
  const SNO_W   = "26px";

  // CSS shorthand strings
  const HEAD_BASE = `background:#1e3a8a;color:#fff;font-family:Arial,sans-serif;font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;padding:2px 3px;text-align:center;vertical-align:middle;border:1px solid #1e40af;white-space:nowrap;`;
  const HEAD2     = `background:#1e40af;color:#bfdbfe;font-family:Arial,sans-serif;font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.2px;padding:2px 2px;text-align:center;border:1px solid #3b5fc0;white-space:nowrap;`;
  const TD_BASE   = `font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-align:center;padding:2px 2px;border:1px solid #e2e8f0;vertical-align:middle;`;
  const TD_NAME   = `font-family:Arial,sans-serif;font-size:8.5px;padding:2px 5px;border:1px solid #e2e8f0;vertical-align:middle;`;
  const TD_ROLL   = `font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-align:center;padding:2px 2px;border:1px solid #e2e8f0;vertical-align:middle;color:#1e40af;`;
  const TD_TOTAL  = `font-family:Arial,sans-serif;font-size:9px;font-weight:800;text-align:center;padding:2px 2px;border:1px solid #e2e8f0;vertical-align:middle;color:#1e40af;`;
  const TD_PCT    = `font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-align:center;padding:2px 2px;border:1px solid #e2e8f0;vertical-align:middle;color:#15803d;`;

  // Show sub-column header row only when at least one subject has multiple columns (e.g. Theory + Internal)
  const hasBreakdown = subjectCols.some(s => s.cols.length > 1);
  const totalNumCols = subjectCols.reduce((n, s) => n + s.cols.length, 0);

  // ── Column group <col> definitions for equal-width numeric columns ─────────
  const colDefs = `
    <col style="width:${SNO_W};min-width:${SNO_W};"/>
    <col style="width:${NAME_W};min-width:${NAME_W};"/>
    <col style="width:${ROLL_W};min-width:${ROLL_W};"/>
    ${subjectCols.flatMap(s => s.cols.map(() => `<col style="width:${COL_W};"/>`)).join("")}
    <col style="width:${TOTAL_W};"/>
    <col style="width:${PCT_W};"/>`;

  // Row 1 — subject group headers (colspan per subject)
  const hRow1 = subjectCols.map(s =>
    `<th colspan="${s.cols.length}" style="${HEAD_BASE}">${s.subject_name}</th>`
  ).join("");

  // Row 2 — sub-column labels (Th / Int / Pr) — only when breakdown exists
  const hRow2 = hasBreakdown ? subjectCols.flatMap(s =>
    s.cols.map(col => `<th style="${HEAD2}">${col.label}</th>`)
  ).join("") : "";

  const tableHead = `
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
      <colgroup>${colDefs}</colgroup>
      <thead>
        <tr>
          <th rowspan="${hasBreakdown ? 2 : 1}" style="${HEAD_BASE}width:${SNO_W};">S.No.</th>
          <th rowspan="${hasBreakdown ? 2 : 1}" style="${HEAD_BASE}text-align:left;width:${NAME_W};">Student Name</th>
          <th rowspan="${hasBreakdown ? 2 : 1}" style="${HEAD_BASE}width:${ROLL_W};">Roll No.</th>
          ${hRow1}
          <th rowspan="${hasBreakdown ? 2 : 1}" style="${HEAD_BASE}width:${TOTAL_W};">Total</th>
          <th rowspan="${hasBreakdown ? 2 : 1}" style="${HEAD_BASE}width:${PCT_W};">Pct.</th>
        </tr>
        ${hasBreakdown ? `<tr>${hRow2}</tr>` : ""}
      </thead>`;

  // ── Group students by section ──────────────────────────────────────────────
  const sectionGroups = {};
  const sectionOrder  = [];
  students.forEach(stu => {
    const key = stu.section_id ?? "__none__";
    if (!sectionGroups[key]) {
      sectionGroups[key] = { section_name: stu.section_name ?? "", students: [] };
      sectionOrder.push(key);
    }
    sectionGroups[key].students.push(stu);
  });

  const buildRows = (grpStudents, startIdx = 0) => grpStudents.map((stu, i) => {
    const bg  = i % 2 === 0 ? "#f8fafc" : "#ffffff";
    const pct = stu.total_max > 0 ? ((stu.total_obtained / stu.total_max) * 100).toFixed(1) : "0.0";
    const sno = startIdx + i + 1;

    const subCells = subjectCols.flatMap(s => {
      const m = stu.marks?.[s.subject_id];
      return s.cols.map((col) => {
        const absentKey  = col.key === 'theory'    ? 'theory_absent'
                         : col.key === 'internal'  ? 'internal_absent'
                         : col.key === 'practical' ? 'practical_absent'
                         : null;
        const compAbsent = absentKey && m?.[absentKey];
        const obtained   = m != null ? (m[col.key] ?? 0) : null;
        const maxVal     = m != null ? m[col.max_key]    : null;
        if (m == null) {
          return `<td style="${TD_BASE}background:${bg};color:#94a3b8;">—</td>`;
        }
        if (compAbsent) {
          return `<td style="${TD_BASE}background:#fef2f2;color:#dc2626;">A</td>`;
        }
        return `<td style="${TD_BASE}background:${bg};color:#0f172a;">${obtained}</td>`;
      });
    }).join("");

    return `<tr>
      <td style="${TD_BASE}background:${bg};color:#64748b;font-size:9px;">${sno}</td>
      <td style="${TD_NAME}background:${bg};">
        <div style="font-weight:700;color:#0f172a;font-size:8.5px;line-height:1.2;">${stu.student_name}</div>
      </td>
      <td style="${TD_ROLL}background:${bg};">${stu.roll_number ?? "—"}</td>
      ${subCells}
      <td style="${TD_TOTAL}background:${bg};">${stu.total_obtained}</td>
      <td style="${TD_PCT}background:${bg};">${pct}%</td>
    </tr>`;
  }).join("");

  const isMultiSection = sectionOrder.length > 1;

  let runningIdx = 0;
  const sectionsHTML = sectionOrder.map((key, idx) => {
    const grp         = sectionGroups[key];
    const thisStart   = runningIdx;
    runningIdx       += grp.students.length;
    const pageBreak   = idx > 0 ? `style="page-break-before:always;"` : "";
    const secLabel    = isMultiSection && grp.section_name
      ? `<div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:#1e40af;margin-bottom:6px;padding:4px 10px;background:#eff6ff;border-left:4px solid #1e40af;border-radius:4px;">Section: ${grp.section_name}</div>`
      : "";
    return `<div ${pageBreak}>
      ${secLabel}
      ${tableHead}
        <tbody>${buildRows(grp.students, thisStart)}</tbody>
      </table>
    </div>`;
  }).join("");

  // ── Class / Section / Total — shown inline in header (right column) ──────────
  const dispSection = !isMultiSection
    ? (sectionName || sectionGroups[sectionOrder[0]]?.section_name || "")
    : "";
  const globalMax = students.length > 0 ? (students[0].total_max ?? 0) : 0;
  const metaInfo = `
    <div style="text-align:right;white-space:nowrap;">
      <div style="font-family:Arial,sans-serif;font-size:8px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">
        Class: <span style="font-size:12px;font-weight:900;color:#1e40af;">${className ?? "—"}</span>
        ${dispSection ? `&nbsp;&nbsp;Section: <span style="font-size:12px;font-weight:900;color:#1e40af;">${dispSection}</span>` : ""}
      </div>
      ${globalMax > 0 ? `<div style="font-family:Arial,sans-serif;font-size:8px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;margin-top:2px;">Total Marks: <span style="font-size:12px;font-weight:900;color:#1e40af;">${globalMax}</span></div>` : ""}
    </div>`;

  // ── Top 3 students by percentage ──────────────────────────────────────────
  // Exclude any student absent in ANY component of ANY subject
  const top3 = [...students]
    .filter(s => {
      if (s.total_max <= 0) return false;
      return !Object.values(s.marks ?? {}).some(
        m => m?.theory_absent || m?.internal_absent || m?.practical_absent
      );
    })
    .sort((a, b) => (b.total_obtained / b.total_max) - (a.total_obtained / a.total_max))
    .slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const medalColors = ["#b45309", "#64748b", "#92400e"];
  const medalBg     = ["#fef9c3", "#f1f5f9", "#fef3c7"];
  const top3HTML = top3.length > 0 ? `
  <div style="margin-top:6px;padding:3px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;break-inside:avoid;page-break-inside:avoid;display:flex;align-items:center;justify-content:center;gap:12px;">
    <div style="font-family:Arial,sans-serif;font-size:8px;font-weight:900;color:#0369a1;text-transform:uppercase;letter-spacing:0.6px;white-space:nowrap;">&#127942; Top</div>
    ${top3.map((s, i) => {
      const pct = s.total_max > 0 ? ((s.total_obtained / s.total_max) * 100).toFixed(1) : "—";
      return `<div style="display:inline-flex;align-items:center;gap:4px;background:${medalBg[i]};border:1px solid #e2e8f0;border-radius:4px;padding:2px 7px;">
        <span style="font-size:11px;line-height:1;">${medals[i]}</span>
        <span style="font-family:Arial,sans-serif;font-size:9px;font-weight:800;color:#0f172a;">${s.student_name}</span>
        ${s.roll_number ? `<span style="font-family:Arial,sans-serif;font-size:7.5px;color:#64748b;">(${s.roll_number})</span>` : ""}
        <span style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;color:${medalColors[i]};">${pct}%</span>
      </div>`;
    }).join("")}
  </div>` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    html,body{margin:0!important;padding:0!important;}
    body{font-family:Arial,sans-serif;color:#1e293b;background:#fff;}
    @page{size:A4 landscape;margin:0 8mm;}
    table{border-collapse:collapse;}
    thead{display:table-header-group;}
  </style>
</head>
<body>
<table style="width:100%;border-collapse:collapse;border-spacing:0;">

<thead>
<tr><td style="padding:2px 0 3px;border-bottom:2px solid #1e40af;">
  <div style="display:flex;align-items:center;justify-content:space-between;">
    <!-- Left spacer — mirrors right column width so center stays truly centered -->
    <div style="min-width:160px;"></div>
    <!-- Center — logo + school name/address (unchanged, centered) -->
    <div style="display:flex;align-items:center;gap:10px;justify-content:center;flex:1;">
      ${logoHtml}
      <div style="text-align:left;">
        <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:900;color:#1e40af;letter-spacing:-0.3px;line-height:1.2;">${schoolInfo?.name ?? "School"}</div>
        ${schoolInfo?.headerText && schoolInfo.headerText.trim().toLowerCase() !== (schoolInfo?.name ?? "").trim().toLowerCase()
          ? `<div style="font-family:Arial,sans-serif;font-size:8px;color:#475569;margin-top:1px;font-style:italic;">${schoolInfo.headerText}</div>` : ""}
        ${schoolInfo?.address
          ? `<div style="font-family:Arial,sans-serif;font-size:7.5px;color:#64748b;margin-top:1px;">${schoolInfo.address}${schoolInfo?.phone ? "  ·  Tel: " + schoolInfo.phone : ""}</div>` : ""}
        <div style="margin-top:4px;text-align:center;">
          <span style="font-family:Arial,sans-serif;background:#1e40af;color:#fff;padding:2px 14px;border-radius:20px;font-size:8px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">${examName ?? "Examination"} &mdash; Class Marks Sheet</span>
        </div>
      </div>
    </div>
    <!-- Right — class / section / total marks -->
    <div style="min-width:160px;">${metaInfo}</div>
  </div>
</td></tr>
</thead>

<tbody>
<tr><td style="vertical-align:top;padding:2px 0 0;">

  <!-- SECTION-GROUPED MARKS TABLES -->
  ${sectionsHTML}

  <!-- TOP 3 PERFORMERS — single compact line -->
  ${top3HTML}


</td></tr>
</tbody>
</table>

</body>
</html>`;
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StudentMarksScreen({ navigation }) {
  const { user }        = useContext(AuthContext);
  const { width: SW }   = useWindowDimensions();

  // Dropdown data
  const [branches,  setBranches]  = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [exams,     setExams]     = useState([]);

  // Selected filter values
  const [selBranch,  setSelBranch]  = useState("");
  const [selSession, setSelSession] = useState("");
  const [selClass,   setSelClass]   = useState("");
  const [selSection, setSelSection] = useState("");
  const [selExam,    setSelExam]    = useState("");
  const [examName,   setExamName]   = useState("");

  // Loading states
  const [loadingBranches,  setLoadingBranches]  = useState(false);
  const [loadingSessions,  setLoadingSessions]  = useState(false);
  const [loadingClasses,   setLoadingClasses]   = useState(false);
  const [loadingSections,  setLoadingSections]  = useState(false);
  const [loadingExams,     setLoadingExams]     = useState(false);

  // Matrix data
  const [subjects,     setSubjects]     = useState([]);
  const [students,     setStudents]     = useState([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);

  // PDF export
  const [exporting,  setExporting]  = useState(false);
  const [schoolInfo, setSchoolInfo] = useState(null);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSchoolInfo(user)
      .then(async info => {
        if (!info) return;
        const base    = (HOST_NAME ?? "").replace(/\/+$/, "");
        const logoUrl = info.logo_name
          ? `${base}/clients/${user?.ssmsClientCode}/${info.logo_name}`
          : null;
        let logoBase64 = null;
        if (logoUrl) {
          try {
            const ext  = (info.logo_name.split(".").pop() || "jpg").toLowerCase();
            const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
            const tmp  = FileSystem.cacheDirectory + "school_logo_marks." + ext;
            await FileSystem.downloadAsync(logoUrl, tmp);
            const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
            logoBase64 = `data:${mime};base64,${b64}`;
          } catch (_) { /* fall back to initials */ }
        }
        setSchoolInfo({
          name:       info.ssms_client_name        ?? "",
          headerText: info.ssms_client_header_text ?? "",
          address:    info.ssms_client_address     ?? "",
          phone:      info.ssms_client_phone       ?? "",
          logo:       logoBase64,
        });
      })
      .catch(() => {});

    setLoadingBranches(true);
    fetchBranches(user)
      .then(d => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        const mapped = list.map(b => ({ label: b.branch_name, value: String(b.branch_id) }));
        setBranches(mapped);
        if (mapped.length > 0) setSelBranch(mapped[0].value);
      })
      .catch(() => {}).finally(() => setLoadingBranches(false));

    setLoadingSessions(true);
    fetchSessions(user)
      .then(d => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        const mapped = list.map(s => ({ label: s.session_name, value: String(s.session_id) }));
        setSessions(mapped);
        if (mapped.length > 0) setSelSession(mapped[0].value);
      })
      .catch(() => {}).finally(() => setLoadingSessions(false));
  }, []);

  // ── Load classes on branch change ───────────────────────────────────────────
  useEffect(() => {
    setSelClass(""); setSelSection(""); setSelExam(""); setSubjects([]); setStudents([]);
    setLoadingClasses(true);
    fetchClasses(user, selBranch || null)
      .then(d => setClasses([{ label: "Select Class", value: "" }, ...(d ?? []).map(c => ({ label: c.class_name, value: String(c.class_id) }))]))
      .catch(() => {}).finally(() => setLoadingClasses(false));
  }, [selBranch]);

  // ── Load sections + exams on class change ───────────────────────────────────
  useEffect(() => {
    setSelSection(""); setSelExam(""); setSubjects([]); setStudents([]);
    if (!selClass) return;

    setLoadingSections(true);
    fetchSections(user, selClass)
      .then(d => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setSections(list.map(s => ({ label: s.section_name, value: String(s.section_id) })));
      })
      .catch(() => {}).finally(() => setLoadingSections(false));

    setLoadingExams(true);
    fetchExams(user)
      .then(d => setExams([{ label: "Select Exam", value: "" }, ...(d ?? []).map(e => ({ label: e.exam_name, value: String(e.exam_id) }))]))
      .catch(() => {}).finally(() => setLoadingExams(false));
  }, [selClass]);

  // ── Load matrix ─────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!user) return;
    if (!selClass || !selExam) {
      Alert.alert("Required", "Please select a Class and Exam.");
      return;
    }
    setLoadingMatrix(true);
    setSubjects([]); setStudents([]);
    try {
      const { subjects: subs, students: stus } = await fetchClassMarksMatrix(user, {
        examId:    selExam,
        classId:   selClass,
        sessionId: selSession  || null,
        sectionId: selSection  || null,
        branchId:  selBranch   || null,
      });
      if (!stus.length) {
        Alert.alert("No Data", "No marks found for the selected filters.");
      }
      setSubjects(subs);
      setStudents(stus);
    } catch (err) {
      Alert.alert("Error", err.message ?? "Could not load marks.");
    } finally {
      setLoadingMatrix(false);
    }
  }, [selClass, selExam, selSession, selSection, selBranch, user]);

  // Keep exam name label in sync
  useEffect(() => {
    const found = exams.find(e => String(e.value) === String(selExam));
    setExamName(found?.label ?? "");
  }, [selExam, exams]);

  // ── PDF export ──────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!students.length) return;
    setExporting(true);
    try {
      // schoolInfo already has logo as base64 (loaded at startup, same as GenerateMarksheetScreen)
      const className   = classes.find(c  => String(c.value)  === String(selClass))?.label   ?? "";
      const sectionName = sections.find(s => String(s.value) === String(selSection))?.label ?? "";
      const html = buildMatrixHTML(subjectCols, students, examName, schoolInfo, className, sectionName);
      const { uri } = await Print.printToFileAsync({
        html,
        base64: false,
        // Zero top/bottom margins so the header starts at the very top of the page
        // and more rows fit per page (left/right handled by the CSS @page rule above)
        margins: { top: 0, right: 23, bottom: 0, left: 23 },
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Export Marks Sheet" });
      } else {
        Alert.alert("Exported", `PDF saved:\n${uri}`);
      }
    } catch (err) {
      Alert.alert("Export Failed", err.message ?? "Could not generate PDF.");
    } finally {
      setExporting(false);
    }
  }, [subjects, students, examName, schoolInfo]);

  // ── Compute sub-columns per subject based on which mark types have max marks ──
  const subjectCols = useMemo(() => {
    if (!subjects.length) return [];
    return subjects.map(s => {
      let hasTheory = false, hasInternal = false, hasPractical = false;
      students.forEach(stu => {
        const m = stu.marks?.[s.subject_id];
        if (!m) return;
        // A column is shown ONLY when a positive maximum mark is defined for that component.
        // DB stores 0 (not NULL) for inapplicable components, so we check > 0.
        if (m.theory_max    > 0) hasTheory    = true;
        if (m.internal_max  > 0) hasInternal  = true;
        if (m.practical_max > 0) hasPractical = true;
      });
      const cols = [];
      if (hasTheory)    cols.push({ key: 'theory',    label: 'Th',  max_key: 'theory_max'    });
      if (hasInternal)  cols.push({ key: 'internal',  label: 'Int', max_key: 'internal_max'  });
      if (hasPractical) cols.push({ key: 'practical', label: 'Pr',  max_key: 'practical_max' });
      if (!cols.length) cols.push({ key: 'total',     label: 'Marks', max_key: 'max'         });
      return { ...s, cols };
    });
  }, [subjects, students]);

  const hasBreakdownCols = subjectCols.some(s => s.cols.length > 1 || s.cols[0]?.key !== 'total');

  // ── Responsive column widths — scale up to fill wider screens ───────────────
  const w = useMemo(() => {
    const base = SNO_W + NAME_W + ROLL_W +
      subjectCols.reduce((acc, s) => acc + s.cols.length * MARK_W, 0) + TOTAL_W + PCT_W;
    const avail = SW - 28; // 14px horizontal padding each side
    const scale = avail > base ? avail / base : 1;
    return {
      sno:   Math.round(SNO_W   * scale),
      name:  Math.round(NAME_W  * scale),
      roll:  Math.round(ROLL_W  * scale),
      mark:  Math.round(MARK_W  * scale),
      total: Math.round(TOTAL_W * scale),
      pct:   Math.round(PCT_W   * scale),
      tbl:   avail > base ? avail : base,
    };
  }, [subjectCols, SW]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={S.safe} edges={["bottom"]}>
      {/* Page header */}
      <View style={S.pageHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Feather name="arrow-left" size={20} color={PURPLE} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.pageTitle}>Student Marks</Text>
          <Text style={S.pageSubtitle}>Subject-wise marks by class &amp; exam</Text>
        </View>
        {students.length > 0 && (
          <TouchableOpacity
            style={[S.exportBtn, exporting && { opacity: 0.6 }]}
            onPress={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Feather name="download" size={15} color="#fff" />}
            <Text style={S.exportBtnTxt}>{exporting ? "…" : "PDF"}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Filter card */}
        <View style={S.filterCard}>
          <Text style={S.filterHeading}>Filters</Text>

          <View style={S.filterRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={S.filterLbl}>Branch</Text>
              <Dropdown label="Select Branch" value={selBranch} options={branches}
                onChange={setSelBranch} loading={loadingBranches} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.filterLbl}>Session</Text>
              <Dropdown label="Select Session" value={selSession} options={sessions}
                onChange={setSelSession} loading={loadingSessions} />
            </View>
          </View>

          <View style={S.filterRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={S.filterLbl}>Class *</Text>
              <Dropdown label="Select Class" value={selClass} options={classes}
                onChange={setSelClass} disabled={!classes.length} loading={loadingClasses} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.filterLbl}>Section</Text>
              <Dropdown label="Select Section" value={selSection} options={sections}
                onChange={setSelSection} disabled={!selClass} loading={loadingSections} />
            </View>
          </View>

          <View>
            <Text style={S.filterLbl}>Exam *</Text>
            <Dropdown label="Select Exam" value={selExam} options={exams}
              onChange={v => { setSelExam(v); setSubjects([]); setStudents([]); }}
              disabled={!selClass} loading={loadingExams} />
          </View>

          <TouchableOpacity
            style={[S.searchBtn, (!selClass || !selExam) && { opacity: 0.45 }]}
            onPress={handleSearch}
            disabled={loadingMatrix || !selClass || !selExam}
          >
            {loadingMatrix
              ? <ActivityIndicator color="#fff" size="small" />
              : <Feather name="search" size={15} color="#fff" />}
            <Text style={S.searchBtnTxt}>
              {loadingMatrix ? "Loading…" : "Load Marks"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Marks matrix table */}
        {students.length > 0 && (
          <View style={S.tableWrap}>
            <Text style={S.tableCaption}>
              {students.length} student{students.length !== 1 ? "s" : ""}  ·  {subjects.length} subject{subjects.length !== 1 ? "s" : ""}
              {examName ? "  ·  " + examName : ""}
            </Text>

            {/* Horizontal scroll for the whole table (no-op when table fills screen) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ width: w.tbl }}>

                {/* ── Header row 1 — subject group names ── */}
                <View style={S.tblHeadRow}>
                  <View style={[S.tblHeadCell, { width: w.sno, borderRightWidth: 1, borderRightColor: "#7c3aed" }]}>
                    <Text style={S.tblHeadTxt}>S.{"\n"}No.</Text>
                  </View>
                  <View style={[S.tblHeadCell, { width: w.name, borderRightWidth: 1, borderRightColor: "#7c3aed" }]}>
                    <Text style={S.tblHeadTxt}>Student Name</Text>
                  </View>
                  <View style={[S.tblHeadCell, { width: w.roll, borderRightWidth: 2, borderRightColor: "#7c3aed" }]}>
                    <Text style={S.tblHeadTxt}>Roll{"\n"}No.</Text>
                  </View>
                  {subjectCols.map(s => (
                    <View key={s.subject_id} style={[S.tblHeadCell, { width: s.cols.length * w.mark, borderRightWidth: 2, borderRightColor: "#7c3aed" }]}>
                      <Text style={S.tblHeadTxt} numberOfLines={2}>{s.subject_name}</Text>
                      {s.subject_code ? <Text style={S.tblHeadSub}>{s.subject_code}</Text> : null}
                    </View>
                  ))}
                  <View style={[S.tblHeadCell, { width: w.total, borderRightWidth: 1, borderRightColor: "#7c3aed" }]}>
                    <Text style={S.tblHeadTxt}>Total</Text>
                  </View>
                  <View style={[S.tblHeadCell, { width: w.pct }]}>
                    <Text style={S.tblHeadTxt}>Pct.</Text>
                  </View>
                </View>

                {/* ── Header row 2 — sub-column labels ── */}
                {hasBreakdownCols && (
                  <View style={S.tblSubHeadRow}>
                    <View style={{ width: w.sno, borderRightWidth: 1, borderRightColor: "#4338ca" }} />
                    <View style={{ width: w.name, borderRightWidth: 1, borderRightColor: "#4338ca" }} />
                    <View style={{ width: w.roll, borderRightWidth: 2, borderRightColor: "#4338ca" }} />
                    {subjectCols.flatMap(s => s.cols.map((col, ci) => (
                      <View key={`h2-${s.subject_id}-${col.key}`}
                        style={[S.tblSubHeadCell, { width: w.mark,
                          borderRightWidth: ci === s.cols.length - 1 ? 2 : 1,
                          borderRightColor: ci === s.cols.length - 1 ? "#4338ca" : "#4f46e5" }]}>
                        <Text style={S.tblSubHeadTxt}>{col.label}</Text>
                      </View>
                    )))}
                    <View style={[S.tblSubHeadCell, { width: w.total, borderRightWidth: 1, borderRightColor: "#4338ca" }]}>
                      <Text style={S.tblSubHeadTxt}>Marks</Text>
                    </View>
                    <View style={[S.tblSubHeadCell, { width: w.pct }]}>
                      <Text style={S.tblSubHeadTxt}>Score</Text>
                    </View>
                  </View>
                )}

                {/* ── Data rows ── */}
                {students.map((stu, ri) => {
                  const pct    = stu.total_max > 0 ? ((stu.total_obtained / stu.total_max) * 100).toFixed(1) : "0.0";
                  const isEven = ri % 2 === 0;
                  const bg     = isEven ? "#faf5ff" : "#fff";
                  return (
                    <View key={stu.enrollment_id ?? stu.student_name} style={[S.tblDataRow, { backgroundColor: bg }]}>

                      {/* S.No. */}
                      <View style={[S.tblCell, { width: w.sno, borderRightWidth: 1, borderRightColor: "#ddd6fe" }]}>
                        <Text style={[S.markVal, { color: "#94a3b8", fontSize: 11 }]}>{ri + 1}</Text>
                      </View>

                      {/* Name */}
                      <View style={[S.tblNameCell, { width: w.name }]}>
                        <Text style={S.nameText} numberOfLines={2}>{stu.student_name}</Text>
                      </View>

                      {/* Roll No. */}
                      <View style={[S.tblRollCell, { width: w.roll }]}>
                        <Text style={S.rollText}>{stu.roll_number ?? "—"}</Text>
                      </View>

                      {/* Sub-columns per subject */}
                      {subjectCols.flatMap(s => {
                        const m = stu.marks?.[s.subject_id];
                        return s.cols.map((col, ci) => {
                          const absentKey = col.key === 'theory'    ? 'theory_absent'
                                          : col.key === 'internal'  ? 'internal_absent'
                                          : col.key === 'practical' ? 'practical_absent'
                                          : null;
                          const compAbsent = absentKey && m?.[absentKey];
                          const obtained   = m != null ? (m[col.key] ?? 0) : null;
                          return (
                            <View key={`${stu.enrollment_id}-${s.subject_id}-${col.key}`}
                              style={[S.tblCell, { width: w.mark,
                                borderRightWidth: ci === s.cols.length - 1 ? 2 : 1,
                                borderRightColor: ci === s.cols.length - 1 ? "#ddd6fe" : "#ede9fe" }]}>
                              {m == null ? (
                                <Text style={S.markAbsent}>—</Text>
                              ) : compAbsent ? (
                                <Text style={[S.markVal, { color: "#ef4444", fontWeight: "800" }]}>A</Text>
                              ) : (
                                <Text style={S.markVal}>{obtained}</Text>
                              )}
                            </View>
                          );
                        });
                      })}

                      {/* Total */}
                      <View style={[S.tblCell, { width: w.total, borderRightWidth: 1, borderRightColor: "#ddd6fe",
                        backgroundColor: isEven ? "#ede9fe" : "#f3e8ff" }]}>
                        <Text style={S.totalVal}>{stu.total_obtained}</Text>
                      </View>

                      {/* Percentage */}
                      <View style={[S.tblCell, { width: w.pct,
                        backgroundColor: isEven ? "#f0fdf4" : "#f7fee7" }]}>
                        <Text style={[S.totalVal, { color: "#16a34a", fontSize: 13 }]}>{pct}%</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {/* ── Top 3 Performers ── */}
        {students.length > 0 && (() => {
          const top3Screen = [...students]
            .filter(s => {
              if (s.total_max <= 0) return false;
              // exclude if absent in ANY component of ANY subject
              return !Object.values(s.marks ?? {}).some(
                m => m?.theory_absent || m?.internal_absent || m?.practical_absent
              );
            })
            .sort((a, b) => (b.total_obtained / b.total_max) - (a.total_obtained / a.total_max))
            .slice(0, 3);
          if (!top3Screen.length) return null;
          const MEDAL_ICON  = ["🥇", "🥈", "🥉"];
          const MEDAL_BG    = ["#fef9c3", "#f1f5f9", "#fef3c7"];
          const MEDAL_BORDER= ["#fde68a", "#e2e8f0", "#fcd34d"];
          const MEDAL_COLOR = ["#92400e", "#475569", "#78350f"];
          return (
            <View style={S.top3Card}>
              <View style={S.top3Header}>
                <Text style={S.top3HeaderTxt}>🏆  Top Performers</Text>
              </View>
              <View style={S.top3Row}>
                {top3Screen.map((stu, i) => {
                  const pct = ((stu.total_obtained / stu.total_max) * 100).toFixed(1);
                  return (
                    <View key={stu.enrollment_id} style={[S.top3Cell, { backgroundColor: MEDAL_BG[i], borderColor: MEDAL_BORDER[i] }]}>
                      <Text style={S.top3Medal}>{MEDAL_ICON[i]}</Text>
                      <Text style={S.top3Name} numberOfLines={2}>{stu.student_name}</Text>
                      {stu.roll_number ? <Text style={S.top3Roll}>Roll {stu.roll_number}</Text> : null}
                      <Text style={[S.top3Pct, { color: MEDAL_COLOR[i] }]}>{pct}%</Text>
                      <Text style={S.top3Marks}>{stu.total_obtained} / {stu.total_max}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })()}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#f8f5ff" },

  // Page header
  pageHeader:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f0e8ff" },
  backBtn:      { marginRight: 10, padding: 4 },
  pageTitle:    { fontSize: 17, fontWeight: "700", color: "#1e0a3c" },
  pageSubtitle: { fontSize: 11, color: "#7c3aed", marginTop: 1 },
  exportBtn:    { flexDirection: "row", alignItems: "center", backgroundColor: PURPLE, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 5 },
  exportBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // Filters
  filterCard:    { backgroundColor: "#fff", borderRadius: 14, padding: 16, margin: 14, shadowColor: "#6b21a8", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  filterHeading: { fontSize: 13, fontWeight: "700", color: PURPLE, marginBottom: 12, letterSpacing: 0.3 },
  filterRow:     { flexDirection: "row", marginBottom: 10 },
  filterLbl:     { fontSize: 11, fontWeight: "600", color: "#475569", marginBottom: 4 },

  searchBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: PURPLE, borderRadius: 10, paddingVertical: 11, marginTop: 14, gap: 6 },
  searchBtnTxt:  { color: "#fff", fontSize: 14, fontWeight: "700" },

  // Dropdown
  dd:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#faf5ff", borderWidth: 1, borderColor: "#e9d5ff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  ddDis:       { opacity: 0.45 },
  ddTxt:       { fontSize: 13, color: "#1e293b", flex: 1, marginRight: 6 },
  ddPh:        { color: "#94a3b8" },
  ddOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center" },
  ddSheet:     { backgroundColor: "#fff", borderRadius: 16, width: "85%", maxHeight: 340, overflow: "hidden" },
  ddHead:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  ddTitle:     { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  ddClose:     { padding: 4 },
  ddOpt:       { paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ddOptAct:    { backgroundColor: "#faf5ff" },
  ddOptTxt:    { fontSize: 14, color: "#334155" },
  ddOptTxtAct: { color: PURPLE, fontWeight: "700" },

  // Table
  tableWrap:      { marginHorizontal: 14, marginBottom: 12 },
  tableCaption:   { fontSize: 11, fontWeight: "600", color: "#64748b", marginBottom: 8 },

  tblHeadRow:      { flexDirection: "row", backgroundColor: PURPLE },
  tblHeadCell:     { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, paddingVertical: 8, borderRightWidth: 1, borderRightColor: "#7c3aed", minHeight: 46 },
  tblHeadTxt:      { fontSize: 10, fontWeight: "700", color: "#fff", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.2 },
  tblHeadSub:      { fontSize: 8, color: "#d8b4fe", textAlign: "center", marginTop: 2 },

  tblSubHeadRow:   { flexDirection: "row", backgroundColor: "#3730a3" },
  tblSubHeadCell:  { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, paddingVertical: 5, minHeight: 26 },
  tblSubHeadTxt:   { fontSize: 9, fontWeight: "700", color: "#c4b5fd", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.3 },

  tblDataRow:      { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ede9fe" },
  tblNameCell:     { justifyContent: "center", paddingHorizontal: 8, paddingVertical: 8, borderRightWidth: 1, borderRightColor: "#ddd6fe", minHeight: 52 },
  nameText:        { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  tblRollCell:     { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, paddingVertical: 8, borderRightWidth: 2, borderRightColor: "#ddd6fe", minHeight: 52 },
  rollText:        { fontSize: 11, fontWeight: "700", color: "#1e293b", textAlign: "center" },

  tblCell:         { justifyContent: "center", alignItems: "center", paddingHorizontal: 2, paddingVertical: 6, minHeight: 52 },
  markVal:         { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  markMax:         { fontSize: 9, color: "#94a3b8" },
  markAbsent:      { fontSize: 14, color: "#cbd5e1" },
  totalVal:        { fontSize: 14, fontWeight: "800", color: PURPLE },

  // Top 3 performers card
  top3Card:        { margin: 14, marginTop: 6, backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", shadowColor: "#6b21a8", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  top3Header:      { backgroundColor: "#1e40af", paddingVertical: 10, paddingHorizontal: 14 },
  top3HeaderTxt:   { fontSize: 13, fontWeight: "900", color: "#fff", letterSpacing: 0.4 },
  top3Row:         { flexDirection: "row", padding: 12, gap: 10 },
  top3Cell:        { flex: 1, alignItems: "center", borderRadius: 10, borderWidth: 1.5, padding: 10, gap: 3 },
  top3Medal:       { fontSize: 24 },
  top3Name:        { fontSize: 12, fontWeight: "800", color: "#0f172a", textAlign: "center", marginTop: 2 },
  top3Roll:        { fontSize: 10, color: "#64748b" },
  top3Pct:         { fontSize: 18, fontWeight: "900", marginTop: 4 },
  top3Marks:       { fontSize: 10, color: "#475569" },
});
