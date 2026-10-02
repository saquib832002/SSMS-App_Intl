/**
 * screens/Exam/GenerateMarksheetScreen.js
 * International school standard marksheet — preview + PDF generation
 * Uses expo-print and expo-sharing for PDF export
 */
import React, { useState, useContext, useCallback, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
  Image, Modal, FlatList,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AuthContext } from "../../context/AuthContext";
import { fetchExams, fetchMarksheet, fetchStudentsForMarksheet, fetchSchoolInfo } from "../../services/ExamServiceApi";
import { BASE_URL, HOST_NAME } from "../../Environment/EnvironmentConfig";
import { fetchBranches, fetchClasses, fetchSections, fetchSessions } from "../../services/SetupServiceApi";

const { width: SW } = Dimensions.get("window");

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[ms.dd, disabled && ms.ddDis]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[ms.ddTxt, !sel?.value && ms.ddPh]} numberOfLines={1}>
          {loading ? "Loading…" : (sel?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={ms.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={ms.ddSheet}>
            <View style={ms.ddHead}>
              <Text style={ms.ddTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={ms.ddClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[ms.ddOpt, String(o.value) === String(value) && ms.ddOptAct]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[ms.ddOptTxt, String(o.value) === String(value) && ms.ddOptTxtAct]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) &&
                    <Feather name="check" size={13} color="#1e40af" />}
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

// ── Grade chip ────────────────────────────────────────────────────────────────
function GradeChip({ grade }) {
  const colors = {
    "A+": ["#dcfce7", "#16a34a"], "A": ["#d1fae5", "#059669"],
    "B+": ["#dbeafe", "#2563eb"], "B": ["#eff6ff", "#3b82f6"],
    "C":  ["#fef3c7", "#d97706"], "D": ["#fed7aa", "#ea580c"],
    "F":  ["#fee2e2", "#dc2626"],
  };
  const [bg, fg] = colors[grade] ?? ["#f1f5f9", "#64748b"];
  return (
    <View style={[ms.gradeChip, { backgroundColor: bg }]}>
      <Text style={[ms.gradeChipTxt, { color: fg }]}>{grade}</Text>
    </View>
  );
}

// ── Generate HTML marksheet ───────────────────────────────────────────────────
function buildMarksheetHTML(data, schoolInfo) {
  const { student, exam, marks, total_obtained, total_max, percentage, grade } = data;

  const gradeColor = {
    "A+": "#16a34a", "A": "#059669", "B+": "#2563eb",
    "B": "#3b82f6",  "C": "#d97706", "D": "#ea580c", "F": "#dc2626"
  }[grade] ?? "#64748b";

  const resultText = percentage >= 90 ? "Outstanding"
    : percentage >= 80 ? "Excellent"   : percentage >= 70 ? "Very Good"
    : percentage >= 60 ? "Good"        : percentage >= 50 ? "Average"
    : percentage >= 40 ? "Below Avg"   : "Fail";

  const logoHtml = schoolInfo.logo
    ? `<img src="${schoolInfo.logo}" style="width:72px;height:72px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;"/>`
    : `<div style="width:72px;height:72px;border-radius:8px;background:#1e40af;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:800;">${(schoolInfo.name ?? "S")[0]}</div>`;

  const fmtCell = (val, maxVal, isAbsent) => {
    const hasMax = maxVal != null && parseFloat(maxVal) > 0;
    if (!hasMax) return `<span style="color:#94a3b8;">—</span>`;
    if (isAbsent) return `<span style="color:#ef4444;font-weight:700;">A</span>`;
    return `${val ?? 0}<span style="color:#475569;font-size:7px;font-weight:600">/${maxVal}</span>`;
  };

  const subjectRows = marks.map((m, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#fff'}">
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;font-size:9px;font-weight:600;color:#1e293b">${m.subject_name}</td>
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:8px;color:#334155;font-weight:600">${m.subject_code || "—"}</td>
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:9px">${fmtCell(m.theory_marks,   m.theory_max_marks,   m.theory_absent)}</td>
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:9px">${fmtCell(m.internal_marks, m.internal_max_marks, m.internal_absent)}</td>
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:9px">${fmtCell(m.practical_marks,m.practical_max_marks,m.practical_absent)}</td>
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:10px;font-weight:700;color:#1e40af">${(m.theory_absent && m.internal_absent && m.practical_absent) ? '<span style="color:#ef4444">A</span>' : (m.total_marks ?? 0)}</td>
      <td style="padding:4px 7px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:9px;color:#475569;font-weight:600">${m.subject_max_marks ?? "—"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;color:#1e293b;font-size:9px;background:#fff;}
    @page{size:A4 portrait;margin:16mm 10mm 10mm 10mm;}
    table{border-collapse:collapse;}
  </style>
</head>
<body>
<div style="width:100%;max-width:185mm;margin:0 auto;">

  <!-- HEADER -->
  <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:6px;padding-bottom:6px;border-bottom:2px solid #1e40af;">
    ${logoHtml}
    <div style="text-align:left;">
      <div style="font-size:15px;font-weight:800;color:#1e40af;letter-spacing:-0.3px;">${schoolInfo.name ?? "School"}</div>
      ${schoolInfo.headerText && schoolInfo.headerText.trim().toLowerCase() !== (schoolInfo.name ?? "").trim().toLowerCase() ? `<div style="font-size:8px;color:#475569;margin-top:2px;font-style:italic;">${schoolInfo.headerText}</div>` : ""}
      ${schoolInfo.address ? `<div style="font-size:7px;color:#64748b;margin-top:2px;">${schoolInfo.address}${schoolInfo.phone ? " · Tel: " + schoolInfo.phone : ""}</div>` : ""}
    </div>
  </div>
  <div style="text-align:center;margin-bottom:6px;">
    <span style="background:#1e40af;color:#fff;padding:2px 18px;border-radius:20px;font-size:8px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">
      ${exam?.exam_name ?? "Examination"} — Result Sheet
    </span>
  </div>

  <!-- STUDENT INFO -->
  <table style="width:100%;border:1px solid #e2e8f0;background:#f8fafc;margin-bottom:6px;">
    <tr>
      <td style="padding:4px 7px;width:50%;border-right:1px solid #e2e8f0;">
        <div style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Student Name</div>
        <div style="font-size:10px;font-weight:700;color:#0f172a;">${student.student_name}</div>
      </td>
      <td style="padding:4px 7px;width:50%;">
        <div style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Enrollment ID</div>
        <div style="font-size:9px;font-weight:600;color:#1e40af;">${student.enrollment_id}</div>
      </td>
    </tr>
    <tr style="border-top:1px solid #e2e8f0;">
      <td style="padding:4px 7px;border-right:1px solid #e2e8f0;">
        <div style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Class / Section</div>
        <div style="font-size:9px;font-weight:600;">${student.class_name ?? "—"}${student.section_name ? " — " + student.section_name : ""}</div>
      </td>
      <td style="padding:4px 7px;">
        <div style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Roll No · Session</div>
        <div style="font-size:9px;font-weight:600;">${student.roll_number ?? "—"} · ${student.session_name ?? "—"}</div>
      </td>
    </tr>
  </table>

  <!-- MARKS TABLE -->
  <table style="width:100%;border:1px solid #e2e8f0;margin-bottom:6px;">
    <thead>
      <tr style="background:#1e40af;color:#fff;">
        <th style="padding:4px 7px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:0.4px;">Subject</th>
        <th style="padding:4px 7px;text-align:center;font-size:8px;width:36px;">Code</th>
        <th style="padding:4px 7px;text-align:center;font-size:8px;width:48px;">Theory</th>
        <th style="padding:4px 7px;text-align:center;font-size:8px;width:48px;">Internal</th>
        <th style="padding:4px 7px;text-align:center;font-size:8px;width:48px;">Practical</th>
        <th style="padding:4px 7px;text-align:center;font-size:8px;width:40px;">Total</th>
        <th style="padding:4px 7px;text-align:center;font-size:8px;width:68px;white-space:nowrap;">Max Marks</th>
      </tr>
    </thead>
    <tbody>${subjectRows}</tbody>
    <tfoot>
      <tr style="background:#0f172a;color:#fff;">
        <td colspan="5" style="padding:4px 7px;font-size:9px;font-weight:700;text-align:right;">TOTAL OBTAINED</td>
        <td style="padding:4px 7px;text-align:center;font-size:10px;font-weight:800;color:#60a5fa;">${total_obtained}</td>
        <td style="padding:4px 7px;text-align:center;font-size:9px;color:#93c5fd;font-weight:600;">/${total_max}</td>
      </tr>
    </tfoot>
  </table>

  <!-- SUMMARY -->
  <table style="width:100%;margin-bottom:8px;">
    <tr>
      <td style="width:32%;padding:5px 8px;text-align:center;background:#eff6ff;border:1px solid #dbeafe;">
        <div style="font-size:7px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">Total Obtained</div>
        <div style="font-size:16px;font-weight:800;color:#1e40af;line-height:1.1;">${total_obtained}</div>
        <div style="font-size:7px;color:#1e40af;font-weight:600;">out of ${total_max}</div>
      </td>
      <td style="width:2%;"></td>
      <td style="width:32%;padding:5px 8px;text-align:center;background:#f0fdf4;border:1px solid #bbf7d0;">
        <div style="font-size:7px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">Percentage</div>
        <div style="font-size:16px;font-weight:800;color:#16a34a;line-height:1.1;">${percentage}%</div>
        <div style="font-size:7px;color:#16a34a;font-weight:600;">${marks.length} subjects</div>
      </td>
      <td style="width:2%;"></td>
      <td style="width:32%;padding:5px 8px;text-align:center;background:#fff;border:2px solid ${gradeColor};">
        <div style="font-size:7px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">Grade</div>
        <div style="font-size:20px;font-weight:800;color:${gradeColor};line-height:1.1;">${grade}</div>
        <div style="font-size:7px;color:${gradeColor};">${resultText}</div>
      </td>
    </tr>
  </table>

</div>

<!-- FIXED FOOTER -->
<div style="position:fixed;bottom:0;left:10mm;right:10mm;background:#fff;border-top:2px solid #1e40af;padding-top:5px;">
  <table style="width:100%;">
    <tr>
      <td style="text-align:center;width:33%;padding:0 8px;">
        <div style="border-top:1px solid #1e293b;padding-top:4px;margin-top:22px;font-size:8px;font-weight:700;color:#1e293b;">Class Teacher</div>
      </td>
      <td style="text-align:center;width:33%;padding:0 8px;">
        <div style="border-top:1px solid #1e293b;padding-top:4px;margin-top:22px;font-size:8px;font-weight:700;color:#1e293b;">Examiner</div>
      </td>
      <td style="text-align:center;width:33%;padding:0 8px;">
        <div style="border-top:1px solid #1e293b;padding-top:4px;margin-top:22px;font-size:8px;font-weight:700;color:#1e293b;">Principal</div>
      </td>
    </tr>
  </table>
  <div style="text-align:center;margin-top:3px;font-size:7px;color:#334155;font-weight:600;">
    Generated on ${new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})} · ${schoolInfo.name ?? "School Management System"}
  </div>
</div>

</body>
</html>`;
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function GenerateMarksheetScreen() {
  const { user } = useContext(AuthContext);

  // Filters
  const [filters, setFilters] = useState({
    branch_id: "", exam_id: "", session_id: "", class_id: "", section_id: "",
  });
  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  // Dropdown data
  const [branches,  setBranches]  = useState([]);
  const [exams,     setExams]     = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [classes,   setClasses]   = useState([]);
  const [sections,  setSections]  = useState([]);
  const [loadingFilters,  setLoadingFilters]  = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);

  // Students list (step 1 result)
  const [students,    setStudents]    = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Marksheet preview
  const [marksheet,   setMarksheet]   = useState(null);
  const [loadingMark, setLoadingMark] = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [bulkGenerating,setBulkGenerating] = useState(false);
  const [bulkProgress,  setBulkProgress]   = useState({ done: 0, total: 0 });
  const [step,        setStep]        = useState(1); // 1=filters 2=students 3=marksheet

  // School info (from branch data)
  const [schoolInfo, setSchoolInfo] = useState({ name: "", address: "", logo: null });

  // Load static dropdowns
  useEffect(() => {
    (async () => {
      try {
        setLoadingFilters(true);
        const [brData, exData, seData, clData] = await Promise.all([
          fetchBranches(user), fetchExams(user),
          fetchSessions(user), fetchClasses(user),
        ]);
        const brList = Array.isArray(brData) ? brData : brData?.data ?? [];
        const seList = Array.isArray(seData) ? seData : seData?.data ?? [];
        setBranches(brList);
        setExams(Array.isArray(exData)    ? exData : exData?.data ?? []);
        setSessions(seList);
        setClasses(Array.isArray(clData)  ? clData : clData?.data ?? []);
        if (brList.length) setFilter("branch_id",  String(brList[0].branch_id));
        if (seList.length) setFilter("session_id", String(seList[0].session_id));
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load filters");
      } finally { setLoadingFilters(false); }
    })();
  }, [user]);

  // Load sections on class change
  useEffect(() => {
    if (!filters.class_id) { setSections([]); setFilter("section_id", ""); return; }
    setLoadingSections(true);
    setSections([]); setFilter("section_id", "");
    fetchSections(user, filters.class_id)
      .then(d => {
        const list = Array.isArray(d) ? d : d?.data ?? [];
        setSections(list);
        if (list.length) setFilter("section_id", String(list[0].section_id));
      })
      .catch(() => {})
      .finally(() => setLoadingSections(false));
  }, [filters.class_id]);

  // Load school info from ssms_clients (header text + logo)
  useEffect(() => {
    if (!user) return;
    fetchSchoolInfo(user)
      .then(async info => {
        if (!info) return;
        const base    = (HOST_NAME ?? '').replace(/\/+$/, '');
        const logoUrl = info.logo_name
          ? `${base}/clients/${user?.ssmsClientCode}/${info.logo_name}`
          : null;

        // expo-print cannot load remote HTTP images — convert to base64 data URI
        let logoBase64 = null;
        if (logoUrl) {
          try {
            const response = await fetch(logoUrl);
            if (response.ok) {
              const blob = await response.blob();
              logoBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('FileReader failed'));
                reader.readAsDataURL(blob);
              });
            } else {
              console.warn('[MarksheetPDF] logo fetch failed:', response.status, logoUrl);
            }
          } catch (logoErr) {
            console.warn('[MarksheetPDF] logo error:', logoErr?.message, logoUrl);
          }
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
  }, [user]);
  // Step 1 → Load students
  const handleLoadStudents = async () => {
    if (!filters.exam_id)  { Alert.alert("Required", "Please select an exam.");  return; }
    if (!filters.class_id) { Alert.alert("Required", "Please select a class."); return; }
    try {
      setLoadingStudents(true);
      const rows = await fetchStudentsForMarksheet(user, {
        branchId:  filters.branch_id,
        examId:    filters.exam_id,
        sessionId: filters.session_id,
        classId:   filters.class_id,
        sectionId: filters.section_id,
      });
      if (!rows.length) { Alert.alert("No Data", "No students found for the selected filters."); return; }
      setStudents(rows);
      setStep(2);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load students");
    } finally { setLoadingStudents(false); }
  };

  // Step 2 → Load marksheet for a student
  const handleViewMarksheet = async (student) => {
    try {
      setLoadingMark(true);
      const res = await fetchMarksheet(user, {
        enrollmentId: student.enrollment_id,
        examId:       filters.exam_id,
        sessionId:    filters.session_id,
        classId:      filters.class_id,
        branchId:     filters.branch_id,
      });
      const mkData = res?.student ? res : (res?.data ?? null);
      if (!mkData?.student) { Alert.alert("No Data", "No marksheet data found for this student."); return; }
      setMarksheet(mkData);
      setStep(3);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load marksheet");
    } finally { setLoadingMark(false); }
  };

  // Generate & share PDF
  const handleGeneratePDF = async () => {
    if (!marksheet) return;
    try {
      setGenerating(true);
      const html = buildMarksheetHTML(marksheet, schoolInfo);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: `Marksheet — ${marksheet.student?.student_name}`,
        UTI: "com.adobe.pdf",
      });
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to generate PDF");
    } finally { setGenerating(false); }
  };

  // Print directly
  const handlePrint = async () => {
    if (!marksheet) return;
    try {
      setGenerating(true);
      const html = buildMarksheetHTML(marksheet, schoolInfo);
      await Print.printAsync({ html });
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to print");
    } finally { setGenerating(false); }
  };


  // ── Bulk PDF — all students in class in one PDF ─────────────────────────────
  const handleBulkPDF = async () => {
    if (!filters.exam_id || !filters.class_id) {
      Alert.alert("Required", "Please go back and select Exam and Class first.");
      return;
    }
    try {
      setBulkGenerating(true);
      setBulkProgress({ done: 0, total: students.length });

      // Fetch marksheet for each student sequentially
      const htmlPages = [];
      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        setBulkProgress({ done: i, total: students.length });
        try {
          const res = await fetchMarksheet(user, {
            enrollmentId: student.enrollment_id,
            examId:       filters.exam_id,
            sessionId:    filters.session_id,
            classId:      filters.class_id,
            branchId:     filters.branch_id,
          });
          const mkData = res?.student ? res : res?.data ?? null;
          if (mkData?.student) {
            htmlPages.push(buildMarksheetHTML(mkData, schoolInfo));
          }
        } catch (_) { /* skip students with no marks */ }
      }

      if (!htmlPages.length) {
        Alert.alert("No Data", "No marksheet data found for any student in this class.");
        return;
      }

      setBulkProgress({ done: students.length, total: students.length });

      // Combine all pages into one HTML with page breaks
      const combinedHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; }
    .page-break { page-break-after: always; break-after: page; }
    @page { size: A4; margin: 15mm 12mm; }
  </style>
</head>
<body>
  ${htmlPages.map((page, i) => {
    // Extract just the body content from each page
    const bodyMatch = page.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const content   = bodyMatch ? bodyMatch[1] : page;
    const isLast    = i === htmlPages.length - 1;
    return `<div class="${isLast ? '' : 'page-break'}">${content}</div>`;
  }).join('')}
</body>
</html>`;

      const selClass   = classes.find(c => String(c.class_id)  === String(filters.class_id));
      const selExamObj = exams.find(e   => String(e.exam_id)    === String(filters.exam_id));
      const fileName   = `Marksheet_${selClass?.class_name ?? "Class"}_${selExamObj?.exam_name ?? "Exam"}`.replace(/\s+/g, "_");

      const { uri } = await Print.printToFileAsync({ html: combinedHTML, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType:    "application/pdf",
        dialogTitle: `${fileName} — ${htmlPages.length} students`,
        UTI:         "com.adobe.pdf",
      });
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to generate bulk PDF");
    } finally {
      setBulkGenerating(false);
      setBulkProgress({ done: 0, total: 0 });
    }
  };

  // ── Dropdown options ────────────────────────────────────────────────────────
  const branchOpts  = branches.map(b => ({ label: b.branch_name,   value: String(b.branch_id)  }));
  const examOpts    = exams.map(e    => ({ label: e.exam_name,     value: String(e.exam_id)    }));
  const sessionOpts = sessions.map(s => ({ label: s.session_name ?? s.session_year, value: String(s.session_id) }));
  const classOpts   = [{ label: "Select Class", value: "" }, ...classes.map(c  => ({ label: c.class_name,    value: String(c.class_id)   }))];
  const sectionOpts = sections.map(s => ({ label: s.section_name,  value: String(s.section_id) }));

  // ── STEP 1 — Filters ────────────────────────────────────────────────────────
  if (step === 1) return (
    <SafeAreaView style={ms.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={ms.scrollPad} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        <View style={ms.pageHead}>
          <View style={ms.pageHeadIcon}><Feather name="file-text" size={20} color="#1e40af" /></View>
          <View>
            <Text style={ms.pageTitle}>Generate Marksheet</Text>
            <Text style={ms.pageSub}>Select filters to view student list</Text>
          </View>
        </View>

        <View style={ms.card}>
          <Text style={ms.cardSectionTitle}>Step 1 — Select Filters</Text>
          <View style={ms.filterGrid}>
            {[
              { label: "Branch",  key: "branch_id",  opts: branchOpts,  req: false },
              { label: "Exam",    key: "exam_id",    opts: examOpts,    req: true  },
              { label: "Session", key: "session_id", opts: sessionOpts, req: false },
              { label: "Class",   key: "class_id",   opts: classOpts,   req: true  },
              { label: "Section", key: "section_id", opts: sectionOpts, req: false, disabled: !filters.class_id, loading: loadingSections },
            ].map(f => (
              <View key={f.key} style={ms.filterHalf}>
                <Text style={ms.filterLabel}>{f.label}{f.req && <Text style={{ color: "#ef4444" }}> *</Text>}</Text>
                <Dropdown label={f.label} value={filters[f.key]} options={f.opts}
                  onChange={v => setFilter(f.key, v)}
                  disabled={f.disabled || loadingFilters}
                  loading={f.loading || loadingFilters} />
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[ms.proceedBtn, loadingStudents && { opacity: 0.6 }]}
            onPress={handleLoadStudents} disabled={loadingStudents} activeOpacity={0.85}
          >
            {loadingStudents
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Text style={ms.proceedBtnTxt}>Load Students</Text><Feather name="arrow-right" size={16} color="#fff" /></>}
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );

  // ── STEP 2 — Student list ───────────────────────────────────────────────────
  if (step === 2) return (
    <SafeAreaView style={ms.safe} edges={["bottom"]}>
      <View style={ms.contextBar}>
        <TouchableOpacity style={ms.backBtn} onPress={() => setStep(1)}>
          <Feather name="arrow-left" size={16} color="#1e40af" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={ms.contextTitle}>Select Student</Text>
          <Text style={ms.contextSub}>{students.length} student{students.length !== 1 ? "s" : ""} found</Text>
        </View>
        <TouchableOpacity
          style={[ms.bulkBtn, bulkGenerating && { opacity: 0.6 }]}
          onPress={handleBulkPDF}
          disabled={bulkGenerating}
          activeOpacity={0.85}
        >
          {bulkGenerating
            ? <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={ms.bulkBtnTxt}>{bulkProgress.done}/{bulkProgress.total}</Text>
              </>
            : <>
                <Feather name="download" size={14} color="#fff" />
                <Text style={ms.bulkBtnTxt}>All PDF</Text>
              </>}
        </TouchableOpacity>
      </View>

      {loadingMark && (
        <View style={ms.loadingOverlay}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={ms.loadingTxt}>Loading marksheet…</Text>
        </View>
      )}

      <FlatList
        data={students}
        keyExtractor={item => String(item.enrollment_id)}
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={ms.studentCard}
            onPress={() => handleViewMarksheet(item)}
            activeOpacity={0.75}
          >
            <View style={ms.studentAvatar}>
              <Text style={ms.studentAvatarTxt}>
                {(item.student_name?.[0] ?? "?").toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ms.studentName}>{item.student_name}</Text>
              <Text style={ms.studentMeta}>
                Roll: {item.roll_number ?? "—"}  ·  {item.enrollment_id}
              </Text>
            </View>
            <View style={ms.viewBtn}>
              <Feather name="file-text" size={14} color="#1e40af" />
              <Text style={ms.viewBtnTxt}>View</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );

  // ── STEP 3 — Marksheet preview ──────────────────────────────────────────────
  const mk   = marksheet;
  const pct  = mk?.percentage ?? 0;

  // Check if any subject is below 30% — forces F
  const hasSubjectFail = (mk?.marks ?? []).some(m => {
    const max = parseFloat(m.subject_max_marks) || 0;
    const tot = parseFloat(m.total_marks)       || 0;
    return max > 0 && (tot / max) * 100 < 30;
  });
  const isPassed       = !hasSubjectFail && pct >= 30;
  const effectiveGrade = hasSubjectFail ? "F"
    : pct >= 90 ? "A+" : pct >= 80 ? "A"  : pct >= 70 ? "B+"
    : pct >= 60 ? "B"  : pct >= 50 ? "C"  : pct >= 40 ? "D"
    : pct >= 30 ? "E"  : "F";
  const screenResultText = isPassed
    ? (pct >= 90 ? "Outstanding" : pct >= 80 ? "Excellent"
      : pct >= 70 ? "Very Good"  : pct >= 60 ? "Good"
      : pct >= 50 ? "Average"    : pct >= 40 ? "Below Avg" : "Pass")
    : hasSubjectFail ? "Comp. Fail" : "Fail";

  const gradeColors = {
    "A+": "#16a34a","A": "#059669","B+": "#2563eb",
    "B": "#3b82f6","C": "#d97706","D": "#ea580c","E": "#dc2626","F": "#dc2626",
  };
  const grd = effectiveGrade;
  const gc  = gradeColors[grd] ?? "#64748b";

  return (
    <SafeAreaView style={ms.safe} edges={["bottom"]}>

      {/* Context bar */}
      <View style={ms.contextBar}>
        <TouchableOpacity style={ms.backBtn} onPress={() => setStep(2)}>
          <Feather name="arrow-left" size={16} color="#1e40af" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={ms.contextTitle} numberOfLines={1}>{mk?.student?.student_name}</Text>
          <Text style={ms.contextSub}>{mk?.exam?.exam_name}</Text>
        </View>
        {/* Action buttons */}
        <TouchableOpacity style={ms.actionBtn} onPress={handlePrint} disabled={generating}>
          <Feather name="printer" size={15} color="#1e40af" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[ms.actionBtnPrimary, generating && { opacity: 0.6 }]}
          onPress={handleGeneratePDF} disabled={generating}
        >
          {generating
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Feather name="download" size={14} color="#fff" /><Text style={ms.actionBtnTxt}>PDF</Text></>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={ms.marksheetPad} showsVerticalScrollIndicator={false}>

        {/* ── School header ── */}
        <View style={ms.schoolHeader}>
          {schoolInfo.logo
            ? <Image source={{ uri: schoolInfo.logo }} style={ms.schoolLogoImg}
                onError={() => console.log("Logo load error:", schoolInfo.logo)} />
            : <View style={ms.schoolLogoWrap}>
                <Text style={ms.schoolLogoTxt}>{(schoolInfo.name || "S")[0].toUpperCase()}</Text>
              </View>}
          <View style={{ flex: 1 }}>
            <Text style={ms.schoolName}>{schoolInfo.name || "International School"}</Text>
            {!!schoolInfo.headerText && <Text style={ms.schoolHeaderTxt}>{schoolInfo.headerText}</Text>}
            {!!schoolInfo.address && <Text style={ms.schoolAddr}>{schoolInfo.address}</Text>}
          </View>
        </View>
        <View style={ms.examTitleBadge}>
          <Text style={ms.examTitleTxt}>{mk?.exam?.exam_name?.toUpperCase()} — RESULT SHEET</Text>
        </View>

        {/* ── Student info grid ── */}
        <View style={ms.infoGrid}>
          {[
            { label: "Student Name", value: mk?.student?.student_name },
            { label: "Enrollment ID", value: mk?.student?.enrollment_id },
            { label: "Class",        value: `${mk?.student?.class_name ?? "—"}${mk?.student?.section_name ? " — " + mk.student.section_name : ""}` },
            { label: "Roll Number",  value: mk?.student?.roll_number ?? "—" },
            { label: "Session",      value: mk?.student?.session_name ?? "—" },
            { label: "Branch",       value: mk?.student?.branch_name  ?? "—" },
          ].map(info => (
            <View key={info.label} style={ms.infoCell}>
              <Text style={ms.infoCellLabel}>{info.label}</Text>
              <Text style={ms.infoCellValue}>{info.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Marks table ── */}
        <View style={ms.marksCard}>
          <Text style={ms.sectionTitle}>Subject Marks</Text>

          {/* Table header */}
          <View style={ms.tableHead}>
            <Text style={[ms.th, { flex: 2 }]}>Subject</Text>
            <Text style={[ms.th, ms.thNum]}>Theory</Text>
            <Text style={[ms.th, ms.thNum]}>Int.</Text>
            <Text style={[ms.th, ms.thNum]}>Prac.</Text>
            <Text style={[ms.th, ms.thNum]}>Total</Text>
            <Text style={[ms.th, ms.thNum]}>Max Marks</Text>
            <Text style={[ms.th, { width: 32 }]}>Grd</Text>
          </View>

          {/* Subject rows */}
          {(mk?.marks ?? []).map((m, i) => {
            const sMax  = parseFloat(m.subject_max_marks) || 0;
            const sTot  = parseFloat(m.total_marks)       || 0;
            const sFail = sMax > 0 && (sTot / sMax) * 100 < 30;
            const sPct  = sMax > 0 ? (sTot / sMax) * 100 : 0;
            const sGrade = sFail ? "F"
              : sPct >= 90 ? "A+" : sPct >= 80 ? "A"  : sPct >= 70 ? "B+"
              : sPct >= 60 ? "B"  : sPct >= 50 ? "C"  : sPct >= 40 ? "D"
              : sPct >= 30 ? "E"  : "F";
            const sGradeColor = gradeColors[sGrade] ?? "#64748b";
            return (
              <View key={i} style={[ms.tableRow, i % 2 === 0 && ms.tableRowAlt,
                sFail && { backgroundColor: "#fff5f5" }]}>
                <View style={{ flex: 2 }}>
                  <Text style={[ms.subjectName, sFail && { color: "#dc2626" }]}>
                    {m.subject_name}{sFail ? " ⚠" : ""}
                  </Text>
                  {m.subject_code ? <Text style={ms.subjectCode}>{m.subject_code}</Text> : null}
                </View>
                {/* Theory */}
                {parseFloat(m.theory_max_marks) > 0
                  ? <Text style={[ms.tdNum, m.theory_absent ? { color: "#ef4444", fontWeight: "700" } : sFail && { color: "#dc2626", fontWeight: "700" }]}>
                      {m.theory_absent ? "A" : (m.theory_marks ?? 0)}
                    </Text>
                  : <Text style={[ms.tdNum, { color: "#cbd5e1" }]}>—</Text>}
                {/* Internal */}
                {parseFloat(m.internal_max_marks) > 0
                  ? <Text style={[ms.tdNum, m.internal_absent ? { color: "#ef4444", fontWeight: "700" } : sFail && { color: "#dc2626", fontWeight: "700" }]}>
                      {m.internal_absent ? "A" : (m.internal_marks ?? 0)}
                    </Text>
                  : <Text style={[ms.tdNum, { color: "#cbd5e1" }]}>—</Text>}
                {/* Practical */}
                {parseFloat(m.practical_max_marks) > 0
                  ? <Text style={[ms.tdNum, m.practical_absent ? { color: "#ef4444", fontWeight: "700" } : sFail && { color: "#dc2626", fontWeight: "700" }]}>
                      {m.practical_absent ? "A" : (m.practical_marks ?? 0)}
                    </Text>
                  : <Text style={[ms.tdNum, { color: "#cbd5e1" }]}>—</Text>}
                <Text style={[ms.tdNum, ms.tdTotal, sFail && { color: "#dc2626" }]}>
                  {(m.theory_absent && m.internal_absent && m.practical_absent) ? "A" : (m.total_marks ?? 0)}
                </Text>
                <Text style={[ms.tdNum, ms.tdMax]}>{m.subject_max_marks ?? "—"}</Text>
                <View style={[ms.subjectGradeBadge, { backgroundColor: sGradeColor + "22" }]}>
                  <Text style={[ms.subjectGradeTxt, { color: sGradeColor }]}>{sGrade}</Text>
                </View>
              </View>
            );
          })}

          {/* Totals row */}
          <View style={ms.totalRow}>
            <Text style={[ms.totalCell, { flex: 2 }]}>TOTAL</Text>
            <Text style={ms.totalCell}>{mk?.total_obtained ?? 0}</Text>
            <Text style={[ms.totalCell, ms.tdMax]}>/ {mk?.total_max ?? 0}</Text>
          </View>
        </View>

        {/* ── Result summary ── */}
        <View style={ms.summaryRow}>
          <View style={[ms.summaryChip, { backgroundColor: "#eff6ff", borderColor: "#dbeafe" }]}>
            <Text style={ms.summaryLabel}>Obtained</Text>
            <Text style={[ms.summaryValue, { color: "#1e40af" }]}>{mk?.total_obtained ?? 0}</Text>
            <Text style={ms.summaryMax}>of {mk?.total_max ?? 0}</Text>
          </View>
          <View style={[ms.summaryChip, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
            <Text style={ms.summaryLabel}>Percentage</Text>
            <Text style={[ms.summaryValue, { color: "#16a34a" }]}>{pct}%</Text>
            <Text style={ms.summaryMax}>{(mk?.marks ?? []).length} subjects</Text>
          </View>
          <View style={[ms.summaryChip, { backgroundColor: "#fff", borderColor: gc, borderWidth: 2 }]}>
            <Text style={ms.summaryLabel}>Grade</Text>
            <Text style={[ms.summaryValue, { color: gc, fontSize: 28 }]}>{grd}</Text>
            <Text style={[ms.summaryMax, { color: gc }]}>{screenResultText}</Text>
          </View>
        </View>

        {/* ── Signature row ── */}
        <View style={ms.sigRow}>
          {["Class Teacher", "Examiner", "Principal"].map(role => (
            <View key={role} style={ms.sigItem}>
              <View style={ms.sigLine} />
              <Text style={ms.sigLabel}>{role}</Text>
            </View>
          ))}
        </View>

        {/* ── Generate PDF button ── */}
        <TouchableOpacity
          style={[ms.pdfBtn, generating && { opacity: 0.6 }]}
          onPress={handleGeneratePDF} disabled={generating} activeOpacity={0.85}
        >
          {generating
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Feather name="download" size={18} color="#fff" /><Text style={ms.pdfBtnTxt}>Download PDF</Text></>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const ms = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#f8fafc" },
  scrollPad:  { padding: 16 },

  pageHead:     { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 },
  pageHeadIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  pageTitle:    { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  pageSub:      { fontSize: 12, color: "#94a3b8", marginTop: 2 },

  card:             { backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cardSectionTitle: { fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 16 },
  filterGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  filterHalf:       { width: "47.5%" },
  filterLabel:      { fontSize: 11, fontWeight: "700", color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 },

  proceedBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#1e40af", borderRadius: 14, paddingVertical: 14, marginTop: 18, shadowColor: "#1e40af", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  proceedBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },

  contextBar:   { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 8 },
  backBtn:      { width: 34, height: 34, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  contextTitle: { fontSize: 13, fontWeight: "800", color: "#0f172a" },
  contextSub:   { fontSize: 11, color: "#64748b", marginTop: 1 },
  actionBtn:    { width: 34, height: 34, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  actionBtnPrimary: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#1e40af", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  actionBtnTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
  bulkBtn:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#7d5493", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  bulkBtnTxt:   { color: "#fff", fontSize: 12, fontWeight: "700" },

  loadingOverlay: { position: "absolute", top: 60, left: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center", gap: 12 },
  loadingTxt:     { fontSize: 14, color: "#64748b" },

  studentCard:    { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", gap: 12 },
  studentAvatar:  { width: 40, height: 40, borderRadius: 12, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  studentAvatarTxt: { fontSize: 16, fontWeight: "800", color: "#1e40af" },
  studentName:    { fontSize: 13, fontWeight: "700", color: "#1946b2" },
  studentMeta:    { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  viewBtn:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  viewBtnTxt:     { fontSize: 11, fontWeight: "700", color: "#1e40af" },

  // Marksheet styles
  marksheetPad:  { padding: 14 },
  schoolHeader:  { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  schoolLogoWrap:{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center" },
  schoolLogoImg: { width: 56, height: 56, borderRadius: 10, resizeMode: "contain", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0" },
  schoolLogoTxt: { fontSize: 22, fontWeight: "800", color: "#fff" },
  schoolName:    { fontSize: 16, fontWeight: "800", color: "#1e40af" },
  schoolHeaderTxt:{ fontSize: 11, color: "#475569", fontStyle: "italic", marginTop: 2 },
  schoolAddr:    { fontSize: 11, color: "#64748b", marginTop: 3 },
  examTitleBadge:{ backgroundColor: "#1e40af", borderRadius: 8, paddingVertical: 8, alignItems: "center", marginBottom: 14 },
  examTitleTxt:  { color: "#fff", fontSize: 12, fontWeight: "800", letterSpacing: 1 },

  infoGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  infoCell:      { width: "47.5%", backgroundColor: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  infoCellLabel: { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  infoCellValue: { fontSize: 12, fontWeight: "700", color: "#0f172a" },

  marksCard:     { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 14, overflow: "hidden" },
  sectionTitle:  { fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6, padding: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tableHead:     { flexDirection: "row", backgroundColor: "#1e40af", paddingVertical: 9, paddingHorizontal: 12 },
  th:            { fontSize: 10, fontWeight: "800", color: "#fff", textTransform: "uppercase", letterSpacing: 0.3 },
  thNum:         { width: 44, textAlign: "center" },
  tableRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  tableRowAlt:   { backgroundColor: "#f8fafc" },
  subjectName:   { fontSize: 12, fontWeight: "600", color: "#0f172a" },
  subjectCode:   { fontSize: 10, color: "#94a3b8", marginTop: 1 },
  tdNum:         { width: 44, textAlign: "center", fontSize: 12, color: "#334155" },
  tdTotal:       { fontWeight: "800", color: "#1e40af" },
  subjectGradeBadge: { width: 28, height: 18, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  subjectGradeTxt:   { fontSize: 9, fontWeight: "800" },
  tdMax:         { color: "#94a3b8" },
  totalRow:      { flexDirection: "row", backgroundColor: "#0f172a", paddingVertical: 10, paddingHorizontal: 12 },
  totalCell:     { width: 44, textAlign: "center", fontSize: 12, fontWeight: "800", color: "#fff" },

  summaryRow:    { flexDirection: "row", gap: 8, marginBottom: 16 },
  summaryChip:   { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1 },
  summaryLabel:  { fontSize: 9, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
  summaryValue:  { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  summaryMax:    { fontSize: 10, color: "#94a3b8", marginTop: 2 },

  sigRow:        { flexDirection: "row", gap: 12, marginBottom: 20 },
  sigItem:       { flex: 1, alignItems: "center" },
  sigLine:       { width: "80%", height: 1, backgroundColor: "#334155", marginBottom: 6, marginTop: 32 },
  sigLabel:      { fontSize: 10, color: "#64748b", textAlign: "center" },

  pdfBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#1e40af", borderRadius: 16, paddingVertical: 16, shadowColor: "#1e40af", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  pdfBtnTxt:     { color: "#fff", fontSize: 15, fontWeight: "800" },

  // Dropdown
  dd:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  ddDis:    { opacity: 0.45 },
  ddTxt:    { flex: 1, fontSize: 12, color: "#0f172a" },
  ddPh:     { color: "#94a3b8" },
  ddOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  ddSheet:  { backgroundColor: "#fff", borderRadius: 18, width: "100%", maxHeight: "65%", overflow: "hidden" },
  ddHead:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  ddTitle:  { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  ddClose:  { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  ddOpt:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 16 },
  ddOptAct: { backgroundColor: "#eff6ff" },
  ddOptTxt: { fontSize: 13, color: "#0f172a" },
  ddOptTxtAct: { color: "#1e40af", fontWeight: "700" },
});