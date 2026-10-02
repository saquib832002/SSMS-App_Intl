/**
 * screens/Exam/ExamResultsRankScreen.js
 * Displays student rankings for a selected exam and class.
 * Supports filtering by session, section and branch.
 * Rank is calculated from total marks across all subjects.
 */
import React, { useState, useContext, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  FlatList, StyleSheet, Alert, ActivityIndicator, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchExams, fetchExamRankings, fetchSchoolInfo, promoteStudents } from "../../services/ExamServiceApi";
import { fetchBranches, fetchClasses, fetchSections, fetchSessions } from "../../services/SetupServiceApi";
import { BASE_URL, HOST_NAME } from "../../Environment/EnvironmentConfig";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[sc.dd, disabled && sc.ddDis]}
        onPress={() => !disabled && !loading && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[sc.ddTxt, !sel?.value && sc.ddPh]} numberOfLines={1}>
          {loading ? "Loading…" : (sel?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={sc.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={sc.ddSheet}>
            <View style={sc.ddHead}>
              <Text style={sc.ddTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={sc.ddClose}>
                <Feather name="x" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[sc.ddOpt, String(o.value) === String(value) && sc.ddOptAct]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[sc.ddOptTxt, String(o.value) === String(value) && sc.ddOptTxtAct]}>
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

// ── Rank medal ────────────────────────────────────────────────────────────────
function RankBadge({ rank }) {
  const configs = {
    1: { bg: "#fef9c3", fg: "#b45309", border: "#fde047", emoji: "🥇" },
    2: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1", emoji: "🥈" },
    3: { bg: "#fff7ed", fg: "#c2410c", border: "#fdba74", emoji: "🥉" },
  };
  const c = configs[rank] ?? { bg: "#f8fafc", fg: "#1e40af", border: "#e2e8f0", emoji: null };
  return (
    <View style={[sc.rankBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
      {c.emoji
        ? <Text style={sc.rankEmoji}>{c.emoji}</Text>
        : <Text style={[sc.rankNum, { color: c.fg }]}>#{rank}</Text>}
    </View>
  );
}

// ── Grade chip ────────────────────────────────────────────────────────────────
function GradeChip({ grade }) {
  const map = {
    "A+": ["#dcfce7", "#15803d"], "A": ["#d1fae5", "#059669"],
    "B+": ["#dbeafe", "#1d4ed8"], "B": ["#eff6ff", "#3b82f6"],
    "C":  ["#fef9c3", "#a16207"], "D": ["#ffedd5", "#c2410c"],
    "F":  ["#fee2e2", "#dc2626"],
  };
  const [bg, fg] = map[grade] ?? ["#f1f5f9", "#64748b"];
  return (
    <View style={[sc.gradeChip, { backgroundColor: bg }]}>
      <Text style={[sc.gradeChipTxt, { color: fg }]}>{grade}</Text>
    </View>
  );
}

// ── Summary stats bar ─────────────────────────────────────────────────────────
function StatsBar({ rankings }) {
  if (!rankings.length) return null;
  const avg  = (rankings.reduce((s, r) => s + r.percentage, 0) / rankings.length).toFixed(1);
  const pass = rankings.filter(r => r.is_passed ?? (r.percentage >= 40)).length;
  const fail = rankings.length - pass;
  const top  = rankings[0];
  return (
    <View style={sc.statsBar}>
      <View style={sc.statItem}>
        <Text style={sc.statVal}>{rankings.length}</Text>
        <Text style={sc.statLabel}>Students</Text>
      </View>
      <View style={sc.statDivider} />
      <View style={sc.statItem}>
        <Text style={sc.statVal}>{avg}%</Text>
        <Text style={sc.statLabel}>Avg Score</Text>
      </View>
      <View style={sc.statDivider} />
      <View style={sc.statItem}>
        <Text style={[sc.statVal, { color: "#16a34a" }]}>{pass}</Text>
        <Text style={sc.statLabel}>Passed</Text>
      </View>
      <View style={sc.statDivider} />
      <View style={sc.statItem}>
        <Text style={[sc.statVal, { color: "#dc2626" }]}>{fail}</Text>
        <Text style={sc.statLabel}>Failed</Text>
      </View>
      <View style={sc.statDivider} />
      <View style={sc.statItem}>
        <Text style={[sc.statVal, { color: "#1e40af" }]} numberOfLines={1}>
          {top?.total_obtained ?? 0}
        </Text>
        <Text style={sc.statLabel}>Top Score</Text>
      </View>
    </View>
  );
}


// ── Build rankings PDF HTML ───────────────────────────────────────────────────
function buildRankingsHTML(rankings, examInfo, filters, schoolInfo, selClass, selSection, selSession) {
  const gradeColor = { "A+":"#16a34a","A":"#059669","B+":"#2563eb","B":"#3b82f6","C":"#d97706","D":"#ea580c","F":"#dc2626" };
  const medalEmoji = { 1:"🥇", 2:"🥈", 3:"🥉" };
  const pass  = rankings.filter(r => r.is_passed ?? (r.percentage >= 40)).length;
  const fail  = rankings.length - pass;
  const avg   = rankings.length ? (rankings.reduce((s,r) => s + r.percentage, 0) / rankings.length).toFixed(1) : 0;

  const logoHtml = schoolInfo?.logo
    ? `<img src="${schoolInfo.logo}" style="width:60px;height:60px;object-fit:contain;border-radius:6px;border:1px solid #e2e8f0;"/>`
    : `<div style="width:60px;height:60px;border-radius:6px;background:#1e40af;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;">${(schoolInfo?.name ?? "S")[0]}</div>`;

  const rows = rankings.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? "#f8fafc" : "#fff"}">
      <td style="padding:5px 8px;text-align:center;font-size:11px;font-weight:800;color:${r.rank <= 3 ? "#b45309" : "#1e40af"};">
        ${medalEmoji[r.rank] ?? "#" + r.rank}
      </td>
      <td style="padding:5px 8px;text-align:center;font-size:9px;font-weight:600;color:#374151;">${r.roll_number ?? "—"}</td>
      <td style="padding:5px 8px;font-size:10px;font-weight:600;color:#0f172a;">${r.student_name}</td>
      <td style="padding:5px 8px;text-align:center;font-size:9px;color:#475569;">${r.class_name ?? "—"}${r.section_name ? " · " + r.section_name : ""}</td>
      <td style="padding:5px 8px;text-align:center;font-size:11px;font-weight:700;color:#1e40af;">${r.total_obtained}</td>
      <td style="padding:5px 8px;text-align:center;font-size:9px;color:#64748b;">/ ${r.total_max}</td>
      <td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#16a34a;">${r.percentage}%</td>
      <td style="padding:5px 8px;text-align:center;">
        <span style="background:${(gradeColor[r.grade] ?? "#64748b") + "22"};color:${gradeColor[r.grade] ?? "#64748b"};font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;">${r.grade}</span>
      </td>
      <td style="padding:5px 8px;text-align:center;">
        <span style="background:${r.is_passed ? '#dcfce7' : '#fee2e2'};color:${r.is_passed ? '#16a34a' : '#dc2626'};font-size:8px;font-weight:700;padding:2px 5px;border-radius:4px;">${r.is_passed ? 'PASS' : r.failed_subject ? 'COMP.FAIL' : 'FAIL'}</span>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;color:#1e293b;font-size:9px;background:#fff;}
    @page{size:A4 landscape;margin:10mm 10mm;}
    table{border-collapse:collapse;}
  </style>
</head>
<body>
<div style="width:100%;max-width:257mm;margin:0 auto;">

  <!-- HEADER -->
  <table style="width:100%;margin-bottom:8px;border-bottom:2px solid #1e40af;padding-bottom:6px;">
    <tr>
      <td style="width:68px;vertical-align:middle;padding-right:10px;">${logoHtml}</td>
      <td style="vertical-align:middle;text-align:center;">
        <div style="font-size:17px;font-weight:800;color:#1e40af;">${schoolInfo?.name ?? "School Management System"}</div>
        ${schoolInfo?.headerText && schoolInfo.headerText.trim().toLowerCase() !== (schoolInfo?.name ?? "").trim().toLowerCase() ? `<div style="font-size:8px;color:#475569;margin-top:2px;font-style:italic;">${schoolInfo.headerText}</div>` : ""}
        ${schoolInfo?.address ? `<div style="font-size:7px;color:#64748b;margin-top:2px;">${schoolInfo.address}${schoolInfo.phone ? " · " + schoolInfo.phone : ""}</div>` : ""}
      </td>
      <td style="width:68px;"></td>
    </tr>
  </table>
  <div style="text-align:center;margin-bottom:8px;">
    <span style="background:#1e40af;color:#fff;padding:3px 20px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">
      ${examInfo?.exam_name ?? "Exam"} — Result Rankings
    </span>
  </div>

  <!-- CONTEXT -->
  <table style="width:100%;margin-bottom:8px;background:#f8fafc;border:1px solid #e2e8f0;">
    <tr>
      <td style="padding:4px 10px;border-right:1px solid #e2e8f0;">
        <span style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;">Session</span><br/>
        <span style="font-size:10px;font-weight:600;">${selSession?.session_name ?? selSession?.session_year ?? "All"}</span>
      </td>
      <td style="padding:4px 10px;border-right:1px solid #e2e8f0;">
        <span style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;">Class</span><br/>
        <span style="font-size:10px;font-weight:600;">${selClass?.class_name ?? "All Classes"}</span>
      </td>
      <td style="padding:4px 10px;border-right:1px solid #e2e8f0;">
        <span style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;">Section</span><br/>
        <span style="font-size:10px;font-weight:600;">${selSection?.section_name ?? "All Sections"}</span>
      </td>
      <td style="padding:4px 10px;border-right:1px solid #e2e8f0;">
        <span style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;">Total Students</span><br/>
        <span style="font-size:10px;font-weight:800;color:#1e40af;">${rankings.length}</span>
      </td>
      <td style="padding:4px 10px;border-right:1px solid #e2e8f0;">
        <span style="font-size:7px;color:#374151;font-weight:700;text-transform:uppercase;">Class Average</span><br/>
        <span style="font-size:10px;font-weight:800;color:#0891b2;">${avg}%</span>
      </td>
      <td style="padding:4px 10px;border-right:1px solid #e2e8f0;">
        <span style="font-size:7px;color:#16a34a;font-weight:700;text-transform:uppercase;">Passed</span><br/>
        <span style="font-size:10px;font-weight:800;color:#16a34a;">${pass}</span>
      </td>
      <td style="padding:4px 10px;">
        <span style="font-size:7px;color:#dc2626;font-weight:700;text-transform:uppercase;">Failed</span><br/>
        <span style="font-size:10px;font-weight:800;color:#dc2626;">${fail}</span>
      </td>
    </tr>
  </table>

  <!-- RANKINGS TABLE -->
  <table style="width:100%;border:1px solid #e2e8f0;">
    <thead>
      <tr style="background:#1e40af;color:#fff;">
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:40px;">Rank</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:44px;">Roll</th>
        <th style="padding:5px 8px;text-align:left;font-size:8px;width:160px;">Student Name</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:90px;">Class / Sec</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:60px;">Obtained</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:50px;">Max</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:58px;">Percentage</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:44px;">Grade</th>
        <th style="padding:5px 8px;text-align:center;font-size:8px;width:44px;">Result</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <!-- FOOTER -->
  <div style="position:fixed;bottom:0;left:10mm;right:10mm;border-top:1px solid #e2e8f0;padding-top:4px;text-align:center;font-size:6px;color:#64748b;background:#fff;">
    Generated on ${new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})} · ${schoolInfo?.name ?? "School Management System"}
  </div>

</div>
</body>
</html>`;
}

// ── Promote Modal ─────────────────────────────────────────────────────────────
const MEDIUM_OPTS = [
  'English', 'Hindi', 'Urdu', 'Arabic',
  'Assamese', 'Bengali', 'Dogri', 'Gujarati', 'Kannada', 'Kashmiri',
  'Maithili', 'Malayalam', 'Marathi', 'Nepali', 'Odia', 'Pali',
  'Prakrit', 'Punjabi', 'Sindhi', 'Tamil', 'Telugu', 'Others',
];

// ── PromoteModal — destination form only; student selection happens on the ranking list ──
function PromoteModal({ visible, onClose, selectedIds, classes, sessions, branches, currentSessionId, user, onDone }) {
  const [tBranchId,  setTBranchId]  = useState('');
  const [tClassId,   setTClassId]   = useState('');
  const [tSectionId, setTSectionId] = useState('');
  const [tSessionId, setTSessionId] = useState('');
  const [tMedium,    setTMedium]    = useState('English');
  const [tSections,  setTSections]  = useState([]);
  const [loadingSec, setLoadingSec] = useState(false);
  const [promoting,  setPromoting]  = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTBranchId(''); setTClassId(''); setTSectionId('');
    setTSessionId(''); setTMedium('English'); setTSections([]);
  }, [visible]);

  useEffect(() => {
    if (!tClassId) { setTSections([]); setTSectionId(''); return; }
    setLoadingSec(true);
    fetchSections(user, tClassId)
      .then(d => setTSections(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingSec(false));
  }, [tClassId]);

  const handlePromote = async () => {
    if (!tClassId)   { Alert.alert('Required', 'Please select a target class.');   return; }
    if (!tSectionId) { Alert.alert('Required', 'Please select a target section.'); return; }
    if (!tSessionId) { Alert.alert('Required', 'Please select a target session.'); return; }
    if (!tMedium)    { Alert.alert('Required', 'Please select a course medium.');  return; }
    try {
      setPromoting(true);
      const res = await promoteStudents(user, {
        enrollment_ids:    [...selectedIds],
        current_session_id: currentSessionId,
        target_branch_id:  tBranchId  || null,
        target_class_id:   tClassId,
        target_section_id: tSectionId,
        target_session_id: tSessionId,
        course_medium:     tMedium,
      });
      onClose();
      Alert.alert('Promotion Complete', res.message ?? `${res.promoted} student(s) promoted.`);
      onDone?.();
    } catch (e) {
      Alert.alert('Error', e.message || 'Promotion failed');
    } finally { setPromoting(false); }
  };

  const branchOpts  = [{ label: 'Keep Existing', value: '' }, ...branches.map(b => ({ label: b.branch_name,                          value: String(b.branch_id)  }))];
  const classOpts   = [{ label: 'Select Class',   value: '' }, ...classes.map(c  => ({ label: c.class_name,                          value: String(c.class_id)   }))];
  // Exclude the session the students are currently enrolled in
  const sessionOpts = [
    { label: 'Select Session', value: '' },
    ...sessions
      .filter(s => String(s.session_id) !== String(currentSessionId))
      .map(s => ({ label: s.session_name ?? s.session_year ?? '', value: String(s.session_id) })),
  ];
  const sectionOpts = [{ label: 'Select Section', value: '' }, ...tSections.map(s => ({ label: s.section_name, value: String(s.section_id) }))];
  const mediumOpts  = MEDIUM_OPTS.map(m => ({ label: m, value: m }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pm.overlay}>
        <View style={pm.panel}>

          {/* Header */}
          <View style={pm.header}>
            <View style={pm.headerIcon}>
              <Feather name="arrow-up-circle" size={18} color="#7c3aed" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={pm.headerTitle}>Promote Students</Text>
              <Text style={pm.headerSub}>
                {selectedIds.size} student{selectedIds.size !== 1 ? 's' : ''} selected
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={pm.closeBtn}>
              <Feather name="x" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Scrollable destination form */}
          <ScrollView
            contentContainerStyle={pm.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={pm.sectionTitle}>▸  Promote To</Text>
            <View style={pm.grid}>
              <View style={{ width: '100%' }}>
                <Text style={pm.fieldLbl}>Branch</Text>
                <Dropdown label="Keep Existing" value={tBranchId} options={branchOpts} onChange={setTBranchId} />
              </View>
              <View style={pm.half}>
                <Text style={pm.fieldLbl}>Class *</Text>
                <Dropdown label="Select Class" value={tClassId} options={classOpts}
                  onChange={v => { setTClassId(v); setTSectionId(''); }} />
              </View>
              <View style={pm.half}>
                <Text style={pm.fieldLbl}>Section *</Text>
                <Dropdown label="Select Section" value={tSectionId} options={sectionOpts}
                  onChange={setTSectionId} disabled={!tClassId} loading={loadingSec} />
              </View>
              <View style={{ width: '100%' }}>
                <Text style={pm.fieldLbl}>Session *</Text>
                <Dropdown label="Select Session" value={tSessionId} options={sessionOpts} onChange={setTSessionId} />
              </View>
              <View style={{ width: '100%' }}>
                <Text style={pm.fieldLbl}>Course Medium *</Text>
                <Dropdown label="Select Medium" value={tMedium} options={mediumOpts} onChange={setTMedium} />
              </View>
            </View>

            <TouchableOpacity
              style={[pm.promoteBtn, promoting && { opacity: 0.55 }]}
              onPress={handlePromote}
              disabled={promoting}
              activeOpacity={0.85}
            >
              {promoting
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Feather name="arrow-up-circle" size={16} color="#fff" />
                    <Text style={pm.promoteBtnTxt}>
                      Promote {selectedIds.size} Student{selectedIds.size !== 1 ? 's' : ''}
                    </Text>
                  </>
              }
            </TouchableOpacity>
          </ScrollView>

        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ExamResultsRankScreen() {
  const { user } = useContext(AuthContext);

  const [filters, setFilters] = useState({
    exam_id: "", class_id: "", session_id: "", section_id: "", branch_id: "",
  });
  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  const [exams,    setExams]    = useState([]);
  const [classes,  setClasses]  = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sections, setSections] = useState([]);
  const [branches, setBranches] = useState([]);

  const [loadingFilters,  setLoadingFilters]  = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loading,         setLoading]         = useState(false);

  const [rankings, setRankings] = useState([]);
  const [examInfo, setExamInfo] = useState(null);
  const [searched,              setSearched]              = useState(false);
  const [search,                setSearch]                = useState("");
  const [schoolInfo,            setSchoolInfo]            = useState(null);
  const [generating,            setGenerating]            = useState(false);
  const [showPromote,           setShowPromote]           = useState(false);
  const [selectedForPromotion,  setSelectedForPromotion]  = useState(new Set());

  const isAdmin = ['admin', 'owner'].includes((user?.ssmsUserRole ?? '').toLowerCase().trim());

  const togglePromotion = (id) => setSelectedForPromotion(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Load school info ──────────────────────────────────────────────────────
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
            const ext  = (info.logo_name.split('.').pop() || 'jpg').toLowerCase();
            const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            const tmp  = FileSystem.cacheDirectory + 'school_logo_rank.' + ext;
            await FileSystem.downloadAsync(logoUrl, tmp);
            const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
            logoBase64 = `data:${mime};base64,${b64}`;
          } catch (_) { /* logo unavailable — fall back to initials */ }
        }

        setSchoolInfo({
          name:       info.ssms_client_name        ?? "",
          headerText: info.ssms_client_header_text ?? "",
          address:    info.ssms_client_address     ?? "",
          phone:      info.ssms_client_phone       ?? "",
          logoUrl,        // keep raw URL as fallback
          logo:       logoBase64,
        });
      })
      .catch(() => {});
  }, [user]);

  // ── Load static dropdowns ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoadingFilters(true);
        const [exData, clData, seData, brData] = await Promise.all([
          fetchExams(user), fetchClasses(user),
          fetchSessions(user), fetchBranches(user),
        ]);
        const brList = Array.isArray(brData) ? brData : brData?.data ?? [];
        const seList = Array.isArray(seData) ? seData : seData?.data ?? [];
        setExams(Array.isArray(exData)    ? exData    : exData?.data    ?? []);
        setClasses(Array.isArray(clData)  ? clData    : clData?.data    ?? []);
        setSessions(seList);
        setBranches(brList);
        if (brList.length) setFilter("branch_id",  String(brList[0].branch_id));
        if (seList.length) setFilter("session_id", String(seList[0].session_id));
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load filters");
      } finally { setLoadingFilters(false); }
    })();
  }, [user]);

  // ── Load sections when class changes ──────────────────────────────────────
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

  // ── Load rankings ─────────────────────────────────────────────────────────
  const handleLoad = async () => {
    if (!filters.exam_id)    { Alert.alert("Required", "Please select an exam.");    return; }
    if (!filters.session_id) { Alert.alert("Required", "Please select a session."); return; }
    try {
      setLoading(true);
      setSearched(false);
      const res = await fetchExamRankings(user, {
        examId:    filters.exam_id,
        classId:   filters.class_id,
        sessionId: filters.session_id,
        sectionId: filters.section_id,
        branchId:  filters.branch_id,
      });
      setRankings(res.data ?? []);
      setExamInfo(res.exam ?? null);
      setSelectedForPromotion(new Set());
      setSearched(true);
      if (!res.data?.length)
        Alert.alert("No Data", "No marks found for the selected filters.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load rankings");
    } finally { setLoading(false); }
  };

  // ── Generate PDF ─────────────────────────────────────────────────────────
  const handleGeneratePDF = async () => {
    if (!rankings.length) { Alert.alert("No Data", "Load rankings first."); return; }
    try {
      setGenerating(true);

      // Guarantee base64 logo is available — re-download if it wasn't ready at mount time
      let pdfSchoolInfo = { ...schoolInfo };
      if (!pdfSchoolInfo?.logo && pdfSchoolInfo?.logoUrl) {
        try {
          const url  = pdfSchoolInfo.logoUrl;
          const ext  = (url.split('.').pop() || 'jpg').toLowerCase();
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const tmp  = FileSystem.cacheDirectory + 'school_logo_rank.' + ext;
          await FileSystem.downloadAsync(url, tmp);
          const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
          pdfSchoolInfo = { ...pdfSchoolInfo, logo: `data:${mime};base64,${b64}` };
        } catch (_) { /* fall back to initials */ }
      }

      const html = buildRankingsHTML(rankings, examInfo, filters, pdfSchoolInfo, selClass, selSection, selSession);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType:    "application/pdf",
        dialogTitle: `Rankings — ${examInfo?.exam_name ?? "Exam"}`,
        UTI:         "com.adobe.pdf",
      });
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to generate PDF");
    } finally { setGenerating(false); }
  };

  // ── Filtered + searched list ───────────────────────────────────────────────
  const filtered = rankings.filter(r =>
    !search || (r.student_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    String(r.roll_number ?? "").includes(search)
  );

  // ── Options ────────────────────────────────────────────────────────────────
  const examOpts    = exams.map(e    => ({ label: e.exam_name,     value: String(e.exam_id)    }));
  const classOpts   = classes.map(c  => ({ label: c.class_name,    value: String(c.class_id)   }));
  const sessionOpts = sessions.map(s => ({ label: s.session_name ?? s.session_year, value: String(s.session_id) }));
  const sectionOpts = sections.map(s => ({ label: s.section_name,  value: String(s.section_id) }));
  const branchOpts  = branches.map(b => ({ label: b.branch_name,   value: String(b.branch_id)  }));

  const selClass   = classes.find(c  => String(c.class_id)   === String(filters.class_id));
  const selSection = sections.find(s => String(s.section_id) === String(filters.section_id));
  const selSession = sessions.find(s => String(s.session_id) === String(filters.session_id));

  // ── Rank card ──────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const pct          = item.percentage ?? 0;
    const barW         = Math.min(100, pct);
    const isPassed     = item.is_passed ?? (pct >= 40);
    const failedSubject= item.failed_subject ?? false;
    const isSelected   = selectedForPromotion.has(item.enrollment_id);

    const cardStyle = [
      sc.card,
      item.rank === 1 && sc.cardGold,
      item.rank === 2 && sc.cardSilver,
      item.rank === 3 && sc.cardBronze,
      isSelected && sc.cardSelected,
    ];

    const CardWrap = isAdmin ? TouchableOpacity : View;
    return (
      <CardWrap
        style={cardStyle}
        onPress={isAdmin ? () => togglePromotion(item.enrollment_id) : undefined}
        activeOpacity={0.85}
      >
        {/* Checkbox — admin only */}
        {isAdmin && (
          <View style={[sc.promoteChk, isSelected && sc.promoteChkOn]}>
            {isSelected && <Feather name="check" size={9} color="#fff" />}
          </View>
        )}
        {/* Left — rank badge */}
        <RankBadge rank={item.rank} />

        {/* Middle — student info */}
        <View style={sc.cardBody}>
          <View style={sc.cardTopRow}>
            <Text style={sc.studentName} numberOfLines={1}>{item.student_name}</Text>
            <GradeChip grade={item.grade} />
          </View>
          <View style={sc.cardMetaRow}>
            {item.roll_number
              ? <View style={sc.metaPill}>
                  <Feather name="hash" size={9} color="#64748b" />
                  <Text style={sc.metaTxt}>Roll {item.roll_number}</Text>
                </View>
              : null}
            {item.class_name
              ? <View style={sc.metaPill}>
                  <Feather name="book-open" size={9} color="#64748b" />
                  <Text style={sc.metaTxt}>{item.class_name}</Text>
                </View>
              : null}
            {item.section_name
              ? <View style={sc.metaPill}>
                  <Feather name="layers" size={9} color="#64748b" />
                  <Text style={sc.metaTxt}>{item.section_name}</Text>
                </View>
              : null}
          </View>

          {/* Progress bar */}
          <View style={sc.progressWrap}>
            <View style={sc.progressTrack}>
              <View style={[
                sc.progressFill,
                { width: `${barW}%` },
                pct >= 80 ? sc.progressGreen
                  : pct >= 60 ? sc.progressBlue
                  : pct >= 40 ? sc.progressYellow
                  : sc.progressRed,
              ]} />
            </View>
            <Text style={sc.progressPct}>{pct}%</Text>
          </View>
        </View>

        {/* Right — score */}
        <View style={sc.scoreWrap}>
          <Text style={[sc.scoreObtained, !isPassed && { color: "#dc2626" }]}>
            {item.total_obtained}
          </Text>
          <Text style={sc.scoreMax}>/{item.total_max}</Text>
          <Text style={[sc.passTag, {
            color: isPassed ? "#16a34a" : "#dc2626",
            backgroundColor: isPassed ? "#dcfce7" : "#fee2e2"
          }]}>
            {isPassed ? "PASS" : failedSubject ? "COMP.FAIL" : "FAIL"}
          </Text>
        </View>
      </CardWrap>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>

      {/* Header */}
      <View style={sc.pageHead}>
        <View style={sc.pageHeadIcon}>
          <Feather name="award" size={20} color="#1e40af" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sc.pageTitle}>Exam Rankings</Text>
          <Text style={sc.pageSub}>
            {searched && examInfo
              ? `${examInfo.exam_name} · ${selClass?.class_name ?? ""}${selSection ? " — " + selSection.section_name : ""}`
              : "Select filters to view rankings"}
          </Text>
        </View>
        {searched && !!rankings.length && (
          <TouchableOpacity
            style={[sc.pdfBtn, generating && { opacity: 0.6 }]}
            onPress={handleGeneratePDF}
            disabled={generating}
            activeOpacity={0.85}
          >
            {generating
              ? <><ActivityIndicator color="#fff" size="small" /><Text style={sc.pdfBtnTxt}>…</Text></>
              : <><Feather name="download" size={15} color="#fff" /><Text style={sc.pdfBtnTxt}>PDF</Text></>}
          </TouchableOpacity>
        )}
      </View>

      {/* Rankings list — header contains filters, stats, search */}
      {loading
        ? <>
            {/* Show filters while loading */}
            <View style={sc.filterCard}>
              <View style={sc.filterGrid}>
                <View style={sc.filterHalf}>
                  <Text style={sc.filterLabel}>Exam <Text style={{ color: "#ef4444" }}>*</Text></Text>
                  <Dropdown label="Select Exam" value={filters.exam_id} options={examOpts}
                    onChange={v => setFilter("exam_id", v)} loading={loadingFilters} />
                </View>
                <View style={sc.filterHalf}>
                  <Text style={sc.filterLabel}>Session <Text style={{ color: "#ef4444" }}>*</Text></Text>
                  <Dropdown label="Select Session" value={filters.session_id} options={sessionOpts}
                    onChange={v => setFilter("session_id", v)} loading={loadingFilters} />
                </View>
                <View style={sc.filterHalf}>
                  <Text style={sc.filterLabel}>Class</Text>
                  <Dropdown label="All Classes" value={filters.class_id} options={classOpts}
                    onChange={v => setFilter("class_id", v)} loading={loadingFilters} />
                </View>
                <View style={sc.filterHalf}>
                  <Text style={sc.filterLabel}>Section</Text>
                  <Dropdown label="All Sections" value={filters.section_id} options={sectionOpts}
                    onChange={v => setFilter("section_id", v)}
                    disabled={!filters.class_id} loading={loadingSections} />
                </View>
                <View style={[sc.filterHalf, { width: "100%" }]}>
                  <Text style={sc.filterLabel}>Branch</Text>
                  <Dropdown label="All Branches" value={filters.branch_id} options={branchOpts}
                    onChange={v => setFilter("branch_id", v)} loading={loadingFilters} />
                </View>
              </View>
              <TouchableOpacity style={[sc.loadBtn, { opacity: 0.6 }]} disabled>
                <ActivityIndicator color="#fff" size="small" />
              </TouchableOpacity>
            </View>
            <View style={sc.loader}>
              <ActivityIndicator size="large" color="#1e40af" />
              <Text style={sc.loaderTxt}>Calculating rankings…</Text>
            </View>
          </>
        : <FlatList
            data={filtered}
            keyExtractor={item => String(item.enrollment_id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: isAdmin && searched && rankings.length ? 130 : 40 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={renderItem}
            ListHeaderComponent={
              <View>
                {/* Filter card */}
                <View style={sc.filterCard}>
                  <View style={sc.filterGrid}>
                    <View style={sc.filterHalf}>
                      <Text style={sc.filterLabel}>Exam <Text style={{ color: "#ef4444" }}>*</Text></Text>
                      <Dropdown label="Select Exam" value={filters.exam_id} options={examOpts}
                        onChange={v => setFilter("exam_id", v)} loading={loadingFilters} />
                    </View>
                    <View style={sc.filterHalf}>
                      <Text style={sc.filterLabel}>Session <Text style={{ color: "#ef4444" }}>*</Text></Text>
                      <Dropdown label="Select Session" value={filters.session_id} options={sessionOpts}
                        onChange={v => setFilter("session_id", v)} loading={loadingFilters} />
                    </View>
                    <View style={sc.filterHalf}>
                      <Text style={sc.filterLabel}>Class</Text>
                      <Dropdown label="All Classes" value={filters.class_id} options={classOpts}
                        onChange={v => setFilter("class_id", v)} loading={loadingFilters} />
                    </View>
                    <View style={sc.filterHalf}>
                      <Text style={sc.filterLabel}>Section</Text>
                      <Dropdown label="All Sections" value={filters.section_id} options={sectionOpts}
                        onChange={v => setFilter("section_id", v)}
                        disabled={!filters.class_id} loading={loadingSections} />
                    </View>
                    <View style={[sc.filterHalf, { width: "100%" }]}>
                      <Text style={sc.filterLabel}>Branch</Text>
                      <Dropdown label="All Branches" value={filters.branch_id} options={branchOpts}
                        onChange={v => setFilter("branch_id", v)} loading={loadingFilters} />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[sc.loadBtn, loading && { opacity: 0.6 }]}
                    onPress={handleLoad} disabled={loading} activeOpacity={0.85}
                  >
                    <Feather name="award" size={15} color="#fff" />
                    <Text style={sc.loadBtnTxt}>Show Rankings</Text>
                  </TouchableOpacity>
                </View>

                {/* Stats bar */}
                {searched && !!rankings.length && <StatsBar rankings={rankings} />}

                {/* Search */}
                {searched && !!rankings.length && (
                  <View style={sc.searchWrap}>
                    <Feather name="search" size={13} color="#94a3b8" style={{ marginRight: 8 }} />
                    <TextInput
                      style={sc.searchInput}
                      placeholder="Search by name or roll number…"
                      placeholderTextColor="#94a3b8"
                      value={search}
                      onChangeText={setSearch}
                    />
                    {!!search &&
                      <TouchableOpacity onPress={() => setSearch("")}>
                        <Feather name="x" size={13} color="#94a3b8" />
                      </TouchableOpacity>}
                  </View>
                )}

                {/* Padding before list items */}
                <View style={{ height: 4 }} />
              </View>
            }
            ListEmptyComponent={
              searched
                ? <View style={sc.empty}>
                    <Feather name="award" size={40} color="#cbd5e1" />
                    <Text style={sc.emptyTxt}>No results found</Text>
                    <Text style={sc.emptySubTxt}>
                      {search ? "Try a different search" : "No marks found for the selected filters"}
                    </Text>
                  </View>
                : null
            }
          />}

      {/* ── Fixed bottom action bar (admin only, when rankings loaded) ── */}
      {isAdmin && searched && !!rankings.length && (
        <View style={sc.actionBar}>
          {/* Quick-select row */}
          <View style={sc.actionSelRow}>
            <TouchableOpacity style={sc.selBtn}
              onPress={() => setSelectedForPromotion(new Set(rankings.map(r => r.enrollment_id)))}>
              <Text style={sc.selBtnTxt}>Select All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sc.selBtn}
              onPress={() => setSelectedForPromotion(new Set(rankings.filter(r => r.is_passed).map(r => r.enrollment_id)))}>
              <Text style={sc.selBtnTxt}>✓ Passed</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sc.selBtn, { backgroundColor: '#fee2e2', borderColor: '#fca5a5' }]}
              onPress={() => setSelectedForPromotion(new Set())}>
              <Text style={[sc.selBtnTxt, { color: '#dc2626' }]}>Clear</Text>
            </TouchableOpacity>
            <Text style={sc.selCountTxt}>
              {selectedForPromotion.size > 0 ? `${selectedForPromotion.size} selected` : 'Tap card to select'}
            </Text>
          </View>

          {/* Promote button */}
          <TouchableOpacity
            style={[sc.actionPromoteBtn, !selectedForPromotion.size && { opacity: 0.4 }]}
            onPress={() => setShowPromote(true)}
            disabled={!selectedForPromotion.size}
            activeOpacity={0.85}
          >
            <Feather name="arrow-up-circle" size={16} color="#fff" />
            <Text style={sc.actionPromoteTxt}>
              {selectedForPromotion.size > 0
                ? `Promote ${selectedForPromotion.size} Student${selectedForPromotion.size !== 1 ? 's' : ''}`
                : 'Promote'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <PromoteModal
        visible={showPromote}
        onClose={() => setShowPromote(false)}
        selectedIds={selectedForPromotion}
        classes={classes}
        sessions={sessions}
        branches={branches}
        currentSessionId={filters.session_id}
        user={user}
        onDone={() => { setSelectedForPromotion(new Set()); }}
      />

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },

  pageHead:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  pageHeadIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  pageTitle:    { fontSize: 17, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  pageSub:      { fontSize: 11, color: "#94a3b8", marginTop: 1 },

  filterCard:   { backgroundColor: "#fff", marginHorizontal: 12, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 10, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  filterGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  filterHalf:   { width: "47.5%" },
  filterLabel:  { fontSize: 10, fontWeight: "700", color: "#475569", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 },

  pdfBtn:        { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#7d5493", shadowColor: "#7d5493", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pdfBtnTxt:     { color: "#fff", fontSize: 12, fontWeight: "700" },
  // Card selection checkbox
  cardSelected:     { borderLeftColor: "#7c3aed", borderColor: "#ddd6fe", backgroundColor: "#faf5ff" },
  promoteChk:       { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", marginRight: 4 },
  promoteChkOn:     { backgroundColor: "#7c3aed", borderColor: "#7c3aed" },
  // Fixed bottom action bar
  actionBar:        { position: "absolute", bottom: 0, left: 0, right: 0,
                      backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0",
                      paddingHorizontal: 14, paddingTop: 10, paddingBottom: 16,
                      gap: 10, shadowColor: "#0f172a", shadowOpacity: 0.08,
                      shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 10 },
  actionSelRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  selBtn:           { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe" },
  selBtnTxt:        { fontSize: 11, fontWeight: "700", color: "#1e40af" },
  selCountTxt:      { fontSize: 11, color: "#94a3b8", marginLeft: "auto" },
  actionPromoteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                      backgroundColor: "#7c3aed", borderRadius: 12, paddingVertical: 13,
                      shadowColor: "#7c3aed", shadowOpacity: 0.3, shadowRadius: 6,
                      shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  actionPromoteTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },
  loadBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1e40af", borderRadius: 12, paddingVertical: 13, shadowColor: "#1e40af", shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  loadBtnTxt:   { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Stats bar
  statsBar:     { flexDirection: "row", backgroundColor: "#fff", marginHorizontal: 12, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, marginBottom: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  statItem:     { flex: 1, alignItems: "center" },
  statVal:      { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  statLabel:    { fontSize: 9, color: "#94a3b8", marginTop: 2, textTransform: "uppercase" },
  statDivider:  { width: 1, backgroundColor: "#f1f5f9", marginVertical: 4 },

  // Search
  searchWrap:   { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 11, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 9, marginHorizontal: 12, marginBottom: 8 },
  searchInput:  { flex: 1, fontSize: 13, color: "#0f172a" },

  // Card
  card:         { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, padding: 13, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", gap: 10, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardGold:     { borderLeftColor: "#f59e0b", borderColor: "#fef3c7", backgroundColor: "#fffbeb" },
  cardSilver:   { borderLeftColor: "#94a3b8", borderColor: "#f1f5f9", backgroundColor: "#f8fafc" },
  cardBronze:   { borderLeftColor: "#f97316", borderColor: "#fff7ed", backgroundColor: "#fff7ed" },

  // Rank badge
  rankBadge:    { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rankEmoji:    { fontSize: 22 },
  rankNum:      { fontSize: 13, fontWeight: "800" },

  // Card body
  cardBody:     { flex: 1 },
  cardTopRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  studentName:  { fontSize: 13, fontWeight: "700", color: "#1946b2", flex: 1, marginRight: 6 },
  cardMetaRow:  { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 6 },
  metaPill:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#f8fafc", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: "#e2e8f0" },
  metaTxt:      { fontSize: 9, color: "#64748b" },

  // Progress bar
  progressWrap:  { flexDirection: "row", alignItems: "center", gap: 6 },
  progressTrack: { flex: 1, height: 5, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden" },
  progressFill:  { height: 5, borderRadius: 4 },
  progressGreen: { backgroundColor: "#16a34a" },
  progressBlue:  { backgroundColor: "#3b82f6" },
  progressYellow:{ backgroundColor: "#f59e0b" },
  progressRed:   { backgroundColor: "#ef4444" },
  progressPct:   { fontSize: 10, fontWeight: "700", color: "#64748b", width: 38, textAlign: "right" },

  // Grade chip
  gradeChip:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  gradeChipTxt: { fontSize: 11, fontWeight: "800" },

  // Score
  scoreWrap:    { alignItems: "center", minWidth: 52 },
  scoreObtained:{ fontSize: 18, fontWeight: "800", color: "#1e40af", lineHeight: 22 },
  scoreMax:     { fontSize: 10, color: "#94a3b8" },
  passTag:      { fontSize: 8, fontWeight: "800", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, marginTop: 3 },

  // Loader / empty
  loader:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:    { color: "#64748b", fontSize: 13 },
  empty:        { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTxt:     { fontSize: 14, fontWeight: "700", color: "#94a3b8" },
  emptySubTxt:  { fontSize: 12, color: "#cbd5e1", textAlign: "center" },

  // Dropdown
  dd:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  ddDis:       { opacity: 0.45 },
  ddTxt:       { flex: 1, fontSize: 12, color: "#0f172a" },
  ddPh:        { color: "#94a3b8" },
  ddOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  ddSheet:     { backgroundColor: "#fff", borderRadius: 18, width: "100%", maxHeight: "65%", overflow: "hidden" },
  ddHead:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  ddTitle:     { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  ddClose:     { width: 26, height: 26, borderRadius: 7, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  ddOpt:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 16 },
  ddOptAct:    { backgroundColor: "#eff6ff" },
  ddOptTxt:    { fontSize: 13, color: "#0f172a" },
  ddOptTxtAct: { color: "#1e40af", fontWeight: "700" },
});

// ── PromoteModal styles ────────────────────────────────────────────────────────
// ── PromoteModal styles (destination form only — no student list) ──────────────
const pm = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  panel:        { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  maxHeight: "80%" },
  header:       { flexDirection: "row", alignItems: "flex-start", padding: 20,
                  borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  headerIcon:   { marginRight: 10, marginTop: 2 },
  headerTitle:  { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  headerSub:    { fontSize: 12, color: "#64748b", marginTop: 2 },
  closeBtn:     { position: "absolute", top: 16, right: 16, width: 30, height: 30,
                  borderRadius: 8, backgroundColor: "#f1f5f9",
                  alignItems: "center", justifyContent: "center" },
  formContent:  { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 34, gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 4 },
  grid:         { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  half:         { flexBasis: "47%", flexGrow: 1 },
  fieldLbl:     { fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: "600" },
  promoteBtn:   { marginTop: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: "#7c3aed",
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  shadowColor: "#7c3aed", shadowOpacity: 0.25, shadowRadius: 6,
                  shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  promoteBtnTxt:{ fontSize: 15, fontWeight: "800", color: "#fff" },
});