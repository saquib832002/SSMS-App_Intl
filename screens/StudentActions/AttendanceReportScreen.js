/**
 * AttendanceReportScreen.js
 *
 * Monthly attendance report — mirrors the web monthly_attendance.php view.
 * Filters: Branch → Class → Section → Year → Month → Generate
 * Output : scrollable matrix (students × days) with P/A/L/H/S colour coding,
 *          per-student present/total/% summary column.
 *
 * Navigate here from anywhere:
 *   navigation.navigate('AttendanceReport')
 */

import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Linking, Modal,
  Platform, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { AuthContext } from '../../context/AuthContext';
import {
  fetchBranches, fetchClasses, fetchMonthlyAttendance, fetchSections,
} from '../../services/StudentServiceApi';
import { fetchClientInfo } from '../../services/ExamServiceApi';
import { HOST_NAME } from '../../Environment/EnvironmentConfig';

// ─── Constants ────────────────────────────────────────────────────────────────
const { width: W, height: SCREEN_H } = Dimensions.get('window');
const isTablet = W >= 768;

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const YEARS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);

// Attendance status colours — matches web att-p / att-a / att-l / att-h / att-s / att-f
const STATUS = {
  P: { bg: '#dcfce7', fg: '#15803d', label: 'P' },  // Present — green
  A: { bg: '#fee2e2', fg: '#dc2626', label: 'A' },  // Absent  — red
  L: { bg: '#fef9c3', fg: '#92400e', label: 'L' },  // Leave   — amber
  H: { bg: '#e0f2fe', fg: '#0369a1', label: 'H' },  // Holiday — blue
  S: { bg: '#f1f5f9', fg: '#94a3b8', label: 'S' },  // Sunday  — slate
  '-': { bg: '#fff',  fg: '#e2e8f0', label: '–' },  // Future  — blank
};

const PCT_COLOR = (p) => p >= 75 ? '#15803d' : p >= 50 ? '#b45309' : '#dc2626';

// Day abbreviations
const dayAbbr = (name) => {
  if (name === 'Sunday')   return 'Sun';
  if (name === 'Saturday') return 'Sat';
  return name.slice(0, 3);
};

// ─── Picker modal ─────────────────────────────────────────────────────────────
function PickerModal({ visible, title, items, keyField, labelField, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>{title}</Text>
          <FlatList
            data={items}
            keyExtractor={(item) => String(item[keyField])}
            ItemSeparatorComponent={() => <View style={s.sep} />}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.sheetRow} onPress={() => { onSelect(item); onClose(); }}>
                <Text style={s.sheetRowTxt}>{item[labelField]}</Text>
                <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Filter row chip ──────────────────────────────────────────────────────────
function FilterChip({ icon, label, value, onPress, required, error, flex }) {
  const hasVal = !!value;
  return (
    <TouchableOpacity
      style={[s.chip, hasVal && s.chipFilled, error && s.chipError, flex && { flex: 1 }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <MaterialIcons name={icon} size={14} color={hasVal ? '#0b1f4b' : '#64748b'} />
      <Text style={[s.chipTxt, hasVal && s.chipTxtFilled]} numberOfLines={1}>
        {value || label}
      </Text>
      {required && !hasVal && <Text style={s.chipReq}>*</Text>}
      <MaterialIcons name="expand-more" size={14} color={hasVal ? '#0b1f4b' : '#94a3b8'} />
    </TouchableOpacity>
  );
}

// ─── Legend item ──────────────────────────────────────────────────────────────
function LegendItem({ code, label }) {
  const st = STATUS[code] ?? STATUS['-'];
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, { backgroundColor: st.bg, borderColor: st.fg + '55' }]} />
      <Text style={s.legendTxt}>{code} — {label}</Text>
    </View>
  );
}

// ─── Summary bar ─────────────────────────────────────────────────────────────
function SummaryCard({ meta }) {
  return (
    <View style={s.summaryCard}>
      <Text style={s.summarySchool}>{meta.schoolName}</Text>
      <View style={s.summaryRow}>
        <View style={s.summaryChip}>
          <MaterialIcons name="business" size={11} color="#64748b" />
          <Text style={s.summaryChipTxt}>{meta.branchName}</Text>
        </View>
        <View style={s.summaryChip}>
          <MaterialIcons name="class" size={11} color="#64748b" />
          <Text style={s.summaryChipTxt}>{meta.className}</Text>
        </View>
        <View style={s.summaryChip}>
          <MaterialIcons name="group" size={11} color="#64748b" />
          <Text style={s.summaryChipTxt}>{meta.sectionName}</Text>
        </View>
        <View style={s.summaryChip}>
          <MaterialIcons name="calendar-month" size={11} color="#64748b" />
          <Text style={s.summaryChipTxt}>{meta.monthName} {meta.year}</Text>
        </View>
        <View style={s.summaryChip}>
          <MaterialIcons name="people" size={11} color="#64748b" />
          <Text style={s.summaryChipTxt}>{meta.studentCount} students</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Attendance matrix ────────────────────────────────────────────────────────
// Sticky-left name column + horizontally scrolling day columns
function AttendanceMatrix({ columns, dayNames, students }) {
  const DAY_W  = 28;
  const NAME_W = isTablet ? 200 : 140;
  const TOT_W  = 60;

  const dayHeader = useMemo(() => columns.map((col, i) => ({
    col, abbr: dayAbbr(dayNames[i] ?? ''), isSun: dayNames[i] === 'Sunday',
  })), [columns, dayNames]);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* ── Header row ── */}
          <View style={[s.matRow, s.matHeaderRow]}>
            {/* sticky name cell */}
            <View style={[s.matNameCell, { width: NAME_W }, s.matHeaderCell]}>
              <Text style={s.matHeaderTxt}>Student</Text>
            </View>
            {/* day cells */}
            {dayHeader.map(({ col, abbr, isSun }) => (
              <View key={col} style={[s.matDayCell, { width: DAY_W }, s.matHeaderCell,
                isSun && { backgroundColor: '#e8edf5' }]}>
                <Text style={[s.matDayAbbrTxt, isSun && { color: '#94a3b8' }]}>{abbr}</Text>
                <Text style={[s.matDayNumTxt,  isSun && { color: '#94a3b8' }]}>{parseInt(col, 10)}</Text>
              </View>
            ))}
            {/* totals */}
            <View style={[s.matTotCell, { width: TOT_W }, s.matHeaderCell]}>
              <Text style={s.matHeaderTxt}>P/T</Text>
            </View>
            <View style={[s.matTotCell, { width: TOT_W }, s.matHeaderCell]}>
              <Text style={s.matHeaderTxt}>%</Text>
            </View>
          </View>

          {/* ── Student rows ── */}
          {students.map((stu, idx) => (
            <View key={stu.enrollment_id}
              style={[s.matRow, idx % 2 === 1 && { backgroundColor: '#fafafa' }]}>
              {/* Name + roll */}
              <View style={[s.matNameCell, { width: NAME_W }]}>
                <Text style={s.matNameTxt} numberOfLines={1}>{stu.student_name}</Text>
                <Text style={s.matEnrollTxt}>{stu.enrollment_id}</Text>
              </View>
              {/* Day cells */}
              {columns.map((col) => {
                const v  = stu.days[col] ?? '-';
                const st = STATUS[v] ?? STATUS['-'];
                return (
                  <View key={col} style={[s.matDayCell, { width: DAY_W, backgroundColor: st.bg }]}>
                    <Text style={[s.matDayValTxt, { color: st.fg }]}>{st.label}</Text>
                  </View>
                );
              })}
              {/* Totals */}
              <View style={[s.matTotCell, { width: TOT_W }]}>
                <Text style={s.matTotTxt}>{stu.present}/{stu.total}</Text>
              </View>
              <View style={[s.matTotCell, { width: TOT_W }]}>
                <Text style={[s.matPctTxt, { color: PCT_COLOR(stu.percent) }]}>
                  {stu.percent}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── PDF HTML builder ─────────────────────────────────────────────────────────
function buildPdfHtml(report, schoolInfo = {}) {
  const { meta, columns, dayNames, students } = report;

  const logoHtml = schoolInfo.logo
    ? `<img src="${schoolInfo.logo}" style="width:64px;height:64px;object-fit:contain;border-radius:6px;"/>`
    : `<div style="width:64px;height:64px;border-radius:6px;background:#0b1f4b;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:800;">${(meta.schoolName ?? 'S')[0]}</div>`;

  const STATUS_CSS = {
    P: 'background:#dcfce7;color:#15803d;',
    A: 'background:#fee2e2;color:#dc2626;',
    L: 'background:#fef9c3;color:#92400e;',
    H: 'background:#e0f2fe;color:#0369a1;',
    S: 'background:#f1f5f9;color:#94a3b8;',
    '-': 'background:#fff;color:#e2e8f0;',
  };

  const pctColor = (p) => p >= 75 ? '#15803d' : p >= 50 ? '#b45309' : '#dc2626';

  const dayAbbrev = (name) => {
    if (name === 'Sunday')   return 'Sun';
    if (name === 'Saturday') return 'Sat';
    return name.slice(0, 3);
  };

  // Address line
  const addrParts = [
    meta.schoolAddress,
    meta.schoolCity,
    meta.schoolState,
    meta.schoolZip,
  ].filter(Boolean);
  const addrLine  = addrParts.join(', ');
  const emailLine = meta.schoolEmail ? `Email: ${meta.schoolEmail}` : '';

  // Day header cells
  const dayHeaderCells = columns.map((col, i) => {
    const name = dayNames[i] ?? '';
    const isSun = name === 'Sunday';
    const style = isSun
      ? 'background:#e8edf5;color:#94a3b8;'
      : 'background:#f1f5f9;color:#0b1f4b;';
    return `<th style="${style}font-size:7px;padding:3px 2px;text-align:center;border:1px solid #e2e8f0;">
              <div>${dayAbbrev(name)}</div>
              <div style="font-weight:900;">${parseInt(col, 10)}</div>
            </th>`;
  }).join('');

  // Student rows
  const studentRows = students.map((stu, idx) => {
    const rowBg = idx % 2 === 1 ? '#fafafa' : '#fff';
    const dayCells = columns.map((col) => {
      const v   = stu.days[col] ?? '-';
      const css = STATUS_CSS[v] ?? STATUS_CSS['-'];
      return `<td style="${css}font-size:8px;font-weight:800;text-align:center;
                          padding:3px 1px;border:1px solid #e2e8f0;">${v === '-' ? '–' : v}</td>`;
    }).join('');

    const pctClr = pctColor(stu.percent);
    return `
      <tr style="background:${rowBg};">
        <td style="font-size:8px;font-weight:700;color:#0b1f4b;padding:4px 6px;
                   border:1px solid #e2e8f0;border-right:2px solid #cbd5e1;white-space:nowrap;">
          ${stu.student_name}<br>
          <span style="font-size:7px;color:#94a3b8;font-weight:400;">${stu.enrollment_id}</span>
        </td>
        ${dayCells}
        <td style="font-size:8px;font-weight:700;color:#0b1f4b;text-align:center;
                   padding:4px;border:1px solid #e2e8f0;border-left:2px solid #cbd5e1;
                   background:#f8faff;">${stu.present}/${stu.total}</td>
        <td style="font-size:9px;font-weight:900;color:${pctClr};text-align:center;
                   padding:4px;border:1px solid #e2e8f0;background:#f8faff;">${stu.percent}%</td>
      </tr>`;
  }).join('');

  // Legend
  const legendItems = [
    { code: 'P', label: 'Present',  css: STATUS_CSS.P },
    { code: 'A', label: 'Absent',   css: STATUS_CSS.A },
    { code: 'L', label: 'Leave',    css: STATUS_CSS.L },
    { code: 'H', label: 'Holiday',  css: STATUS_CSS.H },
    { code: 'S', label: 'Sunday',   css: STATUS_CSS.S },
  ].map(({ code, label, css }) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;">
       <span style="${css}font-size:8px;font-weight:800;padding:2px 5px;border-radius:3px;">${code}</span>
       <span style="font-size:9px;color:#374151;font-weight:600;">${label}</span>
     </span>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #1e293b; }
  table { border-collapse: collapse; width: 100%; }
  @page { size: A4 landscape; margin: 14mm 8mm 18mm 8mm; }
</style>
</head>
<body>

  <!-- ── School header ─────────────────────────────────── -->
  <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:6px;padding-bottom:6px;border-bottom:2.5px solid #0b1f4b;">
    ${logoHtml}
    <div style="text-align:left;">
      <div style="font-size:16px;font-weight:900;color:#0b1f4b;letter-spacing:0.3px;">${meta.schoolName}</div>
      ${schoolInfo.address ? `<div style="font-size:8px;color:#64748b;margin-top:2px;">${schoolInfo.address}${schoolInfo.phone ? '  ·  Tel: ' + schoolInfo.phone : ''}</div>` : ''}
      <div style="margin-top:3px;font-size:10px;font-weight:800;color:#0b1f4b;letter-spacing:0.2px;">MONTHLY ATTENDANCE REPORT</div>
    </div>
  </div>
  <div style="display:flex;justify-content:center;gap:16px;margin-bottom:8px;flex-wrap:wrap;">
    <span style="font-size:9px;color:#374151;"><strong>Branch:</strong> ${meta.branchName}</span>
    <span style="font-size:9px;color:#374151;"><strong>Class:</strong> ${meta.className}</span>
    <span style="font-size:9px;color:#374151;"><strong>Section:</strong> ${meta.sectionName}</span>
    <span style="font-size:9px;color:#374151;"><strong>Period:</strong> ${meta.monthName} ${meta.year}</span>
    <span style="font-size:9px;color:#374151;"><strong>Students:</strong> ${meta.studentCount}</span>
  </div>

  <!-- ── Attendance table ───────────────────────────────── -->
  <table>
    <thead>
      <tr>
        <th style="background:#f1f5f9;color:#0b1f4b;font-size:8px;padding:5px 6px;
                   text-align:left;border:1px solid #e2e8f0;border-right:2px solid #cbd5e1;
                   min-width:110px;">Student</th>
        ${dayHeaderCells}
        <th style="background:#f1f5f9;color:#0b1f4b;font-size:8px;padding:5px 4px;
                   text-align:center;border:1px solid #e2e8f0;border-left:2px solid #cbd5e1;
                   min-width:36px;">P/T</th>
        <th style="background:#f1f5f9;color:#0b1f4b;font-size:8px;padding:5px 4px;
                   text-align:center;border:1px solid #e2e8f0;min-width:32px;">%</th>
      </tr>
    </thead>
    <tbody>
      ${studentRows}
    </tbody>
  </table>

  <!-- ── Legend ────────────────────────────────────────── -->
  <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;">
    ${legendItems}
    <span style="font-size:8px;color:#94a3b8;margin-left:8px;">
      P/T = Present / Working days &nbsp;·&nbsp;
      <span style="color:#15803d;font-weight:700;">≥75%</span> good &nbsp;
      <span style="color:#b45309;font-weight:700;">≥50%</span> average &nbsp;
      <span style="color:#dc2626;font-weight:700;">&lt;50%</span> low
    </span>
  </div>

  <!-- ── Signature footer ───────────────────────────────── -->
  <div style="margin-top:24px;display:flex;justify-content:space-between;padding:0 20px;">
    <div style="text-align:center;min-width:160px;">
      <div style="height:28px;"></div>
      <div style="border-top:1px solid #64748b;padding-top:4px;
                  font-size:8px;font-weight:700;color:#0b1f4b;">Class Teacher Signature</div>
    </div>
    <div style="text-align:center;font-size:8px;color:#94a3b8;padding-top:32px;">
      ${meta.schoolName} &nbsp;·&nbsp; ${meta.monthName} ${meta.year}
    </div>
    <div style="text-align:center;min-width:160px;">
      <div style="height:28px;"></div>
      <div style="border-top:1px solid #64748b;padding-top:4px;
                  font-size:8px;font-weight:700;color:#0b1f4b;">Principal Signature</div>
    </div>
  </div>

</body>
</html>`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function AttendanceReportScreen() {
  const { user } = useContext(AuthContext);

  // ── Reference data ────────────────────────────────────────────────────────
  const [branches, setBranches] = useState([]);
  const [classes,  setClasses]  = useState([]);
  const [sections, setSections] = useState([]);
  const [refLoading, setRefLoading] = useState(false);

  // ── Filter selections ─────────────────────────────────────────────────────
  const now = new Date();
  const [branch,    setBranch]    = useState(null);
  const [cls,       setCls]       = useState(null);
  const [section,   setSection]   = useState(null);
  const [year,      setYear]      = useState(now.getFullYear());
  const [month,     setMonth]     = useState(now.getMonth() + 1);
  const [validated, setValidated] = useState(false);

  // ── Picker visibility ────────────────────────────────────────────────────
  const [picker, setPicker] = useState(null); // 'branch'|'class'|'section'|'year'|'month'

  // ── Report data ───────────────────────────────────────────────────────────
  const [report,   setReport]   = useState(null);  // { meta, columns, dayNames, students }
  const [loading,  setLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // ── School info (logo for PDF) ────────────────────────────────────────────
  const [schoolInfo, setSchoolInfo] = useState({ name: '', logo: null });

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const info = await fetchClientInfo(user);
        if (!info) return;
        const base    = (HOST_NAME ?? '').replace(/\/+$/, '');
        const logoUrl = info.logo_name
          ? `${base}/clients/${user?.ssmsClientCode}/${info.logo_name}`
          : null;

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
              console.warn('[AttendancePDF] logo fetch failed:', response.status, logoUrl);
            }
          } catch (logoErr) {
            console.warn('[AttendancePDF] logo error:', logoErr?.message, logoUrl);
          }
        }

        setSchoolInfo({
          name:    info.ssms_client_name    ?? '',
          address: info.ssms_client_address ?? '',
          phone:   info.ssms_client_phone   ?? '',
          logo:    logoBase64,
        });
      } catch (_) { /* non-fatal */ }
    })();
  }, [user]);

  // ── WhatsApp state ────────────────────────────────────────────────────────
  const [waMdVisible, setWaMdVisible] = useState(false);
  const [waBulkIdx,   setWaBulkIdx]   = useState(0);
  const [waBulkMode,  setWaBulkMode]  = useState(false);

  // Absent students — those with at least one 'A' in the current report
  const absentStudents = useMemo(() => {
    if (!report) return [];
    return report.students
      .map(stu => {
        const absentDays = Object.entries(stu.days)
          .filter(([, v]) => v === 'A')
          .map(([col]) => parseInt(col, 10))
          .sort((a, b) => a - b);
        return { ...stu, absentDays };
      })
      .filter(stu => stu.absentDays.length > 0);
  }, [report]);

  const buildWaMessage = useCallback((stu) => {
    const daysStr  = stu.absentDays.join(', ');
    const schoolPhone = report.meta.schoolPhone ?? '';
    const schoolEn = report.meta.schoolName ? `\n\n${report.meta.schoolName}${schoolPhone ? `\nContact: ${schoolPhone}` : ''}` : '';
    const schoolHi = report.meta.schoolName ? `\n\n${report.meta.schoolName}${schoolPhone ? `\nसंपर्क: ${schoolPhone}` : ''}` : '';
    const schoolUr = report.meta.schoolName ? `\n\n${report.meta.schoolName}${schoolPhone ? `\nرابطہ: ${schoolPhone}` : ''}` : '';
    const mn       = report.meta.monthName ?? '';
    const yr       = report.meta.year ?? '';

    // Month names per language (index 0 = January)
    const HI_MONTHS = ['जनवरी','फ़रवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितम्बर','अक्टूबर','नवम्बर','दिसम्बर'];
    const UR_MONTHS = ['جنوری','فروری','مارچ','اپریل','مئی','جون','جولائی','اگست','ستمبر','اکتوبر','نومبر','دسمبر'];
    // month is 1-indexed from backend
    const mIdx  = (report.meta.month ?? 1) - 1;
    const mnHi  = HI_MONTHS[mIdx] ?? mn;
    const mnUr  = UR_MONTHS[mIdx] ?? mn;

    const med     = (stu.medium ?? '').toLowerCase().trim();
    const isHindi = med.includes('hindi');
    const isUrdu  = med.includes('urdu') || med.includes('arabic');

    if (isHindi) {
      return (
        `प्रिय अभिभावक/संरक्षक,\n\n` +
        `यह सूचित किया जाता है कि आपका बच्चा *${stu.student_name}* ` +
        `${mnHi} ${yr} में निम्नलिखित तारीखों को *अनुपस्थित* रहा/रही:\n\n` +
        `📅 *${daysStr}*\n\n` +
        `कृपया नियमित एवं समयपूर्वक उपस्थिति सुनिश्चित करें।\n\n` +
        `धन्यवाद,${schoolHi}`
      );
    }

    if (isUrdu) {
      return (
        `محترم والدین/سرپرست،\n\n` +
        `یہ اطلاع دی جاتی ہے کہ آپ کا بچہ *${stu.student_name}* ` +
        `${mnUr} ${yr} میں درج ذیل تاریخوں کو *غیر حاضر* رہا:\n\n` +
        `📅 *${daysStr}*\n\n` +
        `براہ کرم باقاعدہ اور وقت پر حاضری یقینی بنائیں۔\n\n` +
        `شکریہ،${schoolUr}`
      );
    }

    // English (default)
    return (
      `Dear Parent/Guardian,\n\n` +
      `This is to inform you that your child *${stu.student_name}* was absent on the ` +
      `following date(s) in ${mn} ${yr}:\n\n` +
      `📅 *${daysStr}*\n\n` +
      `Please ensure regular and timely attendance.\n\n` +
      `Thank you,${schoolEn}`
    );
  }, [report]);

  const openWhatsApp = useCallback(async (stu) => {
    let phone = (stu.parent_phone ?? '').replace(/\D/g, '');
    if (!phone) {
      Alert.alert('No Phone Number', `${stu.student_name} has no contact number on record.`);
      return;
    }
    // Normalise to international format for wa.me (no leading +)
    // 03001234567 → 923001234567
    if (phone.startsWith('0')) phone = '92' + phone.slice(1);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildWaMessage(stu))}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Cannot Open WhatsApp', 'Ensure WhatsApp is installed on this device.');
    }
  }, [buildWaMessage]);

  const startBulkSend = useCallback(() => {
    setWaBulkIdx(0);
    setWaBulkMode(true);
  }, []);

  const bulkNext = useCallback(() => {
    if (waBulkIdx + 1 >= absentStudents.length) {
      setWaBulkMode(false);
    } else {
      setWaBulkIdx(i => i + 1);
    }
  }, [waBulkIdx, absentStudents.length]);

  // ── PDF generation ────────────────────────────────────────────────────────
  const generatePdf = useCallback(async () => {
    if (!report) return;
    try {
      setPdfLoading(true);
      const html = buildPdfHtml(report, schoolInfo);

      // Generate the PDF file via expo-print
      const { uri } = await Print.printToFileAsync({
        html,
        width:  841,   // A4 landscape — points (~297mm)
        height: 595,
        base64: false,
      });

      // Share / save via the OS share sheet
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Attendance_${report.meta.className}_${report.meta.sectionName}_${report.meta.monthName}_${report.meta.year}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('PDF Ready', `Saved to:\n${uri}`);
      }
    } catch (e) {
      Alert.alert('PDF Error', e.message ?? 'Failed to generate PDF');
    } finally {
      setPdfLoading(false);
    }
  }, [report, schoolInfo]);

  // ── Load reference data ───────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setRefLoading(true);
      try {
        const [b, c] = await Promise.all([fetchBranches(user), fetchClasses(user)]);
        if (!alive) return;
        setBranches(b);
        setClasses(c);
        // Auto-select branch: prefer user's branch, otherwise first available
        if (b.length > 0) {
          const userBranch = user?.branchId
            ? b.find(x => String(x.branch_id) === String(user.branchId))
            : null;
          setBranch(userBranch ?? b[0]);
        }
      } catch (e) {
        if (alive) Alert.alert('Error', e.message ?? 'Failed to load options');
      } finally {
        if (alive) setRefLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ── Load sections when class changes — auto-select first section ─────────
  useEffect(() => {
    setSection(null);
    setSections([]);
    if (!cls) return;
    let alive = true;
    (async () => {
      try {
        const secs = await fetchSections(user, cls.class_id);
        if (!alive) return;
        setSections(secs);
        if (secs.length > 0) setSection(secs[0]); // auto-select first section
      } catch { /* silently ignore */ }
    })();
    return () => { alive = false; };
  }, [cls]);

  // ── Generate report ───────────────────────────────────────────────────────
  const generate = useCallback(async (silent = false) => {
    setValidated(true);
    if (!branch || !cls || !section) {
      Alert.alert('Filters required', 'Please select Branch, Class and Section.');
      return;
    }
    try {
      if (!silent) setLoading(true);
      const data = await fetchMonthlyAttendance(user, {
        classId:   cls.class_id,
        sectionId: section.section_id,
        branchId:  branch.branch_id,
        year,
        month,
      });
      setReport(data);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Failed to load attendance report');
      setReport(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branch, cls, section, year, month, user]);

  const onRefresh = useCallback(() => {
    if (!report) return;
    setRefreshing(true);
    generate(true);
  }, [report, generate]);

  // ── Picker helpers ────────────────────────────────────────────────────────
  const openPicker = (name) => setPicker(name);
  const closePicker = () => setPicker(null);

  const handleBranchSelect  = (b) => { setBranch(b); setCls(null); setSection(null); };
  const handleClassSelect   = (c) => { setCls(c); setSection(null); };
  const handleSectionSelect = (sc) => setSection(sc);

  return (
    <View style={s.screen}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <MaterialIcons name="calendar-month" size={22} color="#0b1f4b" />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.headerTitle}>Monthly Attendance</Text>
          <Text style={s.headerSub}>Select filters and generate report</Text>
        </View>
        {refLoading && <ActivityIndicator size="small" color="#0b1f4b" />}
      </View>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <View style={s.filterCard}>
        {/* Row 1: Branch | Class */}
        <View style={s.filterRow}>
          <FilterChip
            icon="business" label="Branch" required flex
            value={branch?.branch_name}
            error={validated && !branch}
            onPress={() => openPicker('branch')}
          />
          <FilterChip
            icon="class" label="Class" required flex
            value={cls?.class_name}
            error={validated && !cls}
            onPress={() => openPicker('class')}
          />
        </View>
        {/* Row 2: Section | Year | Month */}
        <View style={s.filterRow}>
          <FilterChip
            icon="group" label="Section" required flex
            value={section?.section_name}
            error={validated && !section}
            onPress={() => openPicker('section')}
          />
          <FilterChip
            icon="calendar-today" label="Year" flex
            value={String(year)}
            onPress={() => openPicker('year')}
          />
          <FilterChip
            icon="date-range" label="Month" flex
            value={MONTH_NAMES[month]}
            onPress={() => openPicker('month')}
          />
        </View>

        <TouchableOpacity
          style={[s.generateBtn, loading && s.generateBtnDisabled]}
          onPress={() => generate(false)}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <MaterialIcons name="bar-chart" size={16} color="#fff" />}
          <Text style={s.generateBtnTxt}>{loading ? 'Generating…' : 'Generate'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Report ─────────────────────────────────────────────────────── */}
      {loading && !report ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#0b1f4b" />
          <Text style={s.loadingTxt}>Loading attendance data…</Text>
        </View>
      ) : report ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 130 : 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={['#0b1f4b']} tintColor="#0b1f4b" />}
          showsVerticalScrollIndicator={false}
        >
          {/* Matrix */}
          <View style={s.matrixCard}>
            {report.students.length === 0 ? (
              <View style={s.emptyBox}>
                <MaterialIcons name="event-busy" size={40} color="#cbd5e1" />
                <Text style={s.emptyTitle}>No attendance records</Text>
                <Text style={s.emptySub}>
                  No data found for {report.meta.className} — {report.meta.sectionName}
                  {'\n'}{report.meta.monthName} {report.meta.year}
                </Text>
              </View>
            ) : (
              <AttendanceMatrix
                columns={report.columns}
                dayNames={report.dayNames}
                students={report.students}
              />
            )}
          </View>

          {/* Legend */}
          <View style={s.legendCard}>
            <Text style={s.legendTitle}>Legend</Text>
            <View style={s.legendRow}>
              <LegendItem code="P" label="Present" />
              <LegendItem code="A" label="Absent" />
              <LegendItem code="L" label="Leave" />
              <LegendItem code="H" label="Holiday" />
              <LegendItem code="S" label="Sunday" />
              <LegendItem code="-" label="Future" />
            </View>
            <Text style={s.legendNote}>
              P/T = Present / Working days{'  ·  '}
              <Text style={{ color: '#15803d', fontWeight: '700' }}>≥75%</Text> good{'  '}
              <Text style={{ color: '#b45309', fontWeight: '700' }}>≥50%</Text> average{'  '}
              <Text style={{ color: '#dc2626', fontWeight: '700' }}>&lt;50%</Text> low
            </Text>
          </View>

        </ScrollView>
      ) : (
        <View style={s.centred}>
          <MaterialIcons name="calendar-month" size={52} color="#cbd5e1" />
          <Text style={s.emptyTitle}>Select filters above</Text>
          <Text style={s.emptySub}>Choose Branch, Class, Section, Year and Month,{'\n'}then tap Generate.</Text>
        </View>
      )}

      {/* ── Bottom action bar — PDF + WhatsApp ──────────────────────── */}
      {report && report.students.length > 0 && (
        <View style={s.pdfBar}>
          <View style={s.actionRow}>
            <TouchableOpacity
              style={[s.pdfBtn, s.actionBtnHalf, pdfLoading && s.pdfBtnDisabled]}
              onPress={generatePdf}
              disabled={pdfLoading}
              activeOpacity={0.8}
            >
              {pdfLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <MaterialIcons name="picture-as-pdf" size={18} color="#fff" />}
              <Text style={s.pdfBtnTxt}>
                {pdfLoading ? 'Generating…' : 'Save PDF'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.waBtn, s.actionBtnHalf]}
              onPress={() => { setWaBulkMode(false); setWaBulkIdx(0); setWaMdVisible(true); }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="chat" size={18} color="#fff" />
              <Text style={s.pdfBtnTxt}>
                {absentStudents.length > 0 ? `WhatsApp (${absentStudents.length})` : 'WhatsApp'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Pickers ────────────────────────────────────────────────────── */}
      <PickerModal
        visible={picker === 'branch'}
        title="Select Branch"
        items={branches} keyField="branch_id" labelField="branch_name"
        onSelect={handleBranchSelect} onClose={closePicker}
      />
      <PickerModal
        visible={picker === 'class'}
        title="Select Class"
        items={classes} keyField="class_id" labelField="class_name"
        onSelect={handleClassSelect} onClose={closePicker}
      />
      <PickerModal
        visible={picker === 'section'}
        title="Select Section"
        items={sections} keyField="section_id" labelField="section_name"
        onSelect={handleSectionSelect} onClose={closePicker}
      />
      <PickerModal
        visible={picker === 'year'}
        title="Select Year"
        items={YEARS.map(y => ({ id: y, label: String(y) }))}
        keyField="id" labelField="label"
        onSelect={(item) => setYear(item.id)} onClose={closePicker}
      />
      <PickerModal
        visible={picker === 'month'}
        title="Select Month"
        items={MONTH_NAMES.slice(1).map((m, i) => ({ id: i + 1, label: m }))}
        keyField="id" labelField="label"
        onSelect={(item) => setMonth(item.id)} onClose={closePicker}
      />

      {/* ── WhatsApp full-screen modal ──────────────────────────────── */}
      <Modal
        visible={waMdVisible}
        animationType="slide"
        onRequestClose={() => { setWaMdVisible(false); setWaBulkMode(false); }}
      >
        <View style={s.waScreen}>

          {/* ── Top nav bar ── */}
          <View style={s.waNavBar}>
            <TouchableOpacity
              style={s.waNavClose}
              onPress={() => { setWaMdVisible(false); setWaBulkMode(false); }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="close" size={22} color="#0b1f4b" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.waNavTitle}>
                {waBulkMode ? `Sending ${waBulkIdx + 1} / ${absentStudents.length}` : 'WhatsApp — Absent Students'}
              </Text>
              <Text style={s.waNavSub}>
                {report?.meta?.className} · {report?.meta?.sectionName} · {report?.meta?.monthName} {report?.meta?.year}
              </Text>
            </View>
            <View style={s.waBadge}>
              <Text style={s.waBadgeTxt}>{absentStudents.length}</Text>
            </View>
          </View>

          {/* ── Content ── */}
          {absentStudents.length === 0 ? (
            <View style={s.centred}>
              <MaterialIcons name="check-circle" size={48} color="#86efac" />
              <Text style={s.emptyTitle}>No absences this month</Text>
              <Text style={s.emptySub}>All students were present or on leave.</Text>
            </View>

          ) : waBulkMode ? (
            /* ── Bulk send: one student at a time ── */
            <ScrollView contentContainerStyle={s.bulkWrap} showsVerticalScrollIndicator={false}>
              {/* Progress bar */}
              <View style={s.bulkProgress}>
                <View style={[s.bulkBar, { width: `${((waBulkIdx + 1) / absentStudents.length) * 100}%` }]} />
              </View>
              <Text style={s.bulkCount}>Student {waBulkIdx + 1} of {absentStudents.length}</Text>

              {(() => {
                const stu = absentStudents[waBulkIdx];
                const hasPhone = !!(stu.parent_phone ?? '').replace(/\D/g, '');
                return (
                  <View style={s.bulkCard}>
                    <Text style={s.bulkName}>{stu.student_name}</Text>
                    <Text style={s.bulkEnroll}>{stu.enrollment_id}</Text>
                    <Text style={s.bulkDays}>
                      Absent on: {stu.absentDays.join(', ')} · {stu.absentDays.length} day{stu.absentDays.length !== 1 ? 's' : ''}
                    </Text>
                    <Text style={[s.bulkPhone, !hasPhone && { color: '#f87171' }]}>
                      {hasPhone ? `📱 ${stu.parent_phone}` : '⚠️  No phone number on record'}
                    </Text>
                    <View style={s.msgPreview}>
                      <Text style={s.msgPreviewLabel}>Message preview</Text>
                      <Text style={s.msgPreviewTxt}>{buildWaMessage(stu)}</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.openWaBtn, !hasPhone && s.pdfBtnDisabled]}
                      onPress={() => openWhatsApp(stu)}
                      disabled={!hasPhone}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="chat" size={17} color="#fff" />
                      <Text style={s.openWaBtnTxt}>Open in WhatsApp</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}

              <View style={s.bulkNav}>
                <TouchableOpacity style={s.bulkSkipBtn} onPress={bulkNext}>
                  <Text style={s.bulkSkipTxt}>
                    {waBulkIdx + 1 >= absentStudents.length ? 'Finish ✓' : 'Skip / Next →'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.bulkDoneBtn}
                  onPress={() => { setWaBulkMode(false); setWaMdVisible(false); }}
                >
                  <Text style={s.bulkDoneTxt}>Done</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

          ) : (
            /* ── Student list ── */
            <>
              <TouchableOpacity style={s.sendAllBtn} onPress={startBulkSend} activeOpacity={0.8}>
                <MaterialIcons name="send" size={15} color="#fff" />
                <Text style={s.sendAllTxt}>Send All One by One ({absentStudents.length})</Text>
              </TouchableOpacity>

              <FlatList
                data={absentStudents}
                keyExtractor={item => String(item.enrollment_id)}
                ItemSeparatorComponent={() => <View style={s.sep} />}
                contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 80 : 60 }}
                renderItem={({ item }) => {
                  const hasPhone = !!(item.parent_phone ?? '').replace(/\D/g, '');
                  return (
                    <View style={s.waRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.waRowName}>{item.student_name}</Text>
                        <Text style={s.waRowEnroll}>{item.enrollment_id}</Text>
                        <Text style={s.waRowDays}>
                          Absent: {item.absentDays.join(', ')} · {item.absentDays.length} day{item.absentDays.length !== 1 ? 's' : ''}
                        </Text>
                        <Text style={[s.waRowPhone, !hasPhone && { color: '#f87171' }]}>
                          {hasPhone ? item.parent_phone : 'No phone number'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[s.waSendBtn, !hasPhone && s.waSendBtnDisabled]}
                        onPress={() => openWhatsApp(item)}
                        disabled={!hasPhone}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="chat" size={22} color={hasPhone ? '#15803d' : '#cbd5e1'} />
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#f1f5f9' },

  // Header
  header:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
              paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 18,
              paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0b1f4b' },
  headerSub:   { fontSize: 12, color: '#64748b', marginTop: 1 },

  // Filter card
  filterCard: { backgroundColor: '#fff', margin: 12, borderRadius: 16, padding: 14,
                shadowColor: '#0b1f4b', shadowOpacity: 0.07, shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  filterRow:  { flexDirection: 'row', gap: 8, marginBottom: 8 },

  // Filter chips
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5,
                 borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10,
                 paddingVertical: 10, backgroundColor: '#f8fafc', minWidth: 0 },
  chipFilled:  { borderColor: '#0b1f4b', backgroundColor: '#f0f4ff' },
  chipError:   { borderColor: '#dc2626', backgroundColor: '#fff5f5' },
  chipTxt:     { fontSize: 12, color: '#64748b', fontWeight: '600', flex: 1 },
  chipTxtFilled: { color: '#0b1f4b' },
  chipReq:     { fontSize: 11, color: '#dc2626', fontWeight: '800' },

  // Generate button
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                 gap: 8, backgroundColor: '#0b1f4b', borderRadius: 12,
                 paddingVertical: 13, paddingHorizontal: 20 },
  generateBtnDisabled: { backgroundColor: '#64748b' },
  generateBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Centred empty/loading
  centred:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  loadingTxt:  { marginTop: 14, color: '#64748b', fontSize: 14 },

  // Summary card
  summaryCard: { backgroundColor: '#0b1f4b', marginHorizontal: 12, marginTop: 4,
                 borderRadius: 14, padding: 14 },
  summarySchool: { fontSize: 15, fontWeight: '800', color: '#fff',
                   textAlign: 'center', marginBottom: 10 },
  summaryRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  summaryChip: { flexDirection: 'row', alignItems: 'center', gap: 4,
                 backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8,
                 paddingHorizontal: 8, paddingVertical: 4 },
  summaryChipTxt: { fontSize: 11, color: '#e2e8f0', fontWeight: '600' },

  // Matrix card
  matrixCard:  { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 10,
                 borderRadius: 14, overflow: 'hidden',
                 shadowColor: '#0b1f4b', shadowOpacity: 0.06, shadowRadius: 6,
                 shadowOffset: { width: 0, height: 2 }, elevation: 2 },

  // Matrix rows
  matRow:      { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  matHeaderRow: { backgroundColor: '#f1f5f9' },
  matHeaderCell: { justifyContent: 'center', alignItems: 'center',
                   borderRightWidth: 0.5, borderRightColor: '#e2e8f0' },
  matHeaderTxt:  { fontSize: 10, fontWeight: '700', color: '#0b1f4b' },

  matNameCell:   { justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6,
                   borderRightWidth: 2, borderRightColor: '#cbd5e1' },
  matNameTxt:    { fontSize: 11, fontWeight: '700', color: '#0b1f4b' },
  matEnrollTxt:  { fontSize: 9,  color: '#94a3b8', marginTop: 1 },

  matDayCell:    { justifyContent: 'center', alignItems: 'center',
                   paddingVertical: 5, borderRightWidth: 0.5, borderRightColor: '#e2e8f0' },
  matDayAbbrTxt: { fontSize: 8,  fontWeight: '600', color: '#64748b' },
  matDayNumTxt:  { fontSize: 10, fontWeight: '700', color: '#0b1f4b' },
  matDayValTxt:  { fontSize: 10, fontWeight: '800' },

  matTotCell:    { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
                   paddingVertical: 6, borderLeftWidth: 2, borderLeftColor: '#cbd5e1',
                   backgroundColor: '#f8faff' },
  matTotTxt:     { fontSize: 10, fontWeight: '700', color: '#0b1f4b' },
  matPctTxt:     { fontSize: 11, fontWeight: '900' },

  // Empty state (inside matrix)
  emptyBox:    { alignItems: 'center', padding: 40 },
  emptyTitle:  { fontSize: 15, fontWeight: '700', color: '#64748b', marginTop: 12 },
  emptySub:    { fontSize: 12, color: '#94a3b8', marginTop: 6, textAlign: 'center', lineHeight: 18 },

  // Legend
  legendCard:  { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 10,
                 borderRadius: 14, padding: 14,
                 shadowColor: '#0b1f4b', shadowOpacity: 0.05, shadowRadius: 4,
                 shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  legendTitle: { fontSize: 12, fontWeight: '800', color: '#374151', marginBottom: 8 },
  legendRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:   { width: 16, height: 16, borderRadius: 4, borderWidth: 1 },
  legendTxt:   { fontSize: 11, fontWeight: '600', color: '#374151' },
  legendNote:  { fontSize: 10, color: '#94a3b8', lineHeight: 16 },

  // PDF + action bar
  pdfBar:    { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12,
               paddingBottom: Platform.OS === 'ios' ? 34 : 28,
               borderTopWidth: 1, borderTopColor: '#e2e8f0',
               shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8,
               shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  actionRow:  { flexDirection: 'row', gap: 10 },
  actionBtnHalf: { flex: 1 },
  pdfBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
               gap: 8, backgroundColor: '#c0392b', borderRadius: 14,
               paddingVertical: 14 },
  waBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
               gap: 8, backgroundColor: '#15803d', borderRadius: 14,
               paddingVertical: 14 },
  pdfBtnDisabled: { backgroundColor: '#94a3b8' },
  pdfBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },

  // WhatsApp full-screen modal
  waScreen:   { flex: 1, backgroundColor: '#f1f5f9',
                paddingTop: Platform.OS === 'ios' ? 54 : 0 },
  waNavBar:   { flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: '#fff', paddingHorizontal: 14,
                paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  waNavClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9',
                alignItems: 'center', justifyContent: 'center' },
  waNavTitle: { fontSize: 15, fontWeight: '800', color: '#0b1f4b' },
  waNavSub:   { fontSize: 11, color: '#64748b', marginTop: 1 },
  waBadge:    { backgroundColor: '#dcfce7', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  waBadgeTxt: { fontSize: 12, fontWeight: '800', color: '#15803d' },

  sendAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, backgroundColor: '#15803d', borderRadius: 12,
                paddingVertical: 12, marginHorizontal: 16, marginVertical: 12 },
  sendAllTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  waRow:      { flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 13,
                backgroundColor: '#fff' },
  waRowName:  { fontSize: 13, fontWeight: '700', color: '#0b1f4b' },
  waRowEnroll:{ fontSize: 10, color: '#94a3b8', marginTop: 1 },
  waRowDays:  { fontSize: 11, color: '#64748b', marginTop: 3 },
  waRowPhone: { fontSize: 11, color: '#15803d', fontWeight: '600', marginTop: 2 },
  waSendBtn:  { width: 44, height: 44, borderRadius: 22, backgroundColor: '#dcfce7',
                alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  waSendBtnDisabled: { backgroundColor: '#f1f5f9' },

  // Bulk send flow
  bulkWrap:   { padding: 16, paddingBottom: 40 },
  bulkProgress: { height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, marginBottom: 8 },
  bulkBar:    { height: 4, backgroundColor: '#15803d', borderRadius: 2 },
  bulkCount:  { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 14,
                textAlign: 'center' },
  bulkCard:   { backgroundColor: '#f0fdf4', borderRadius: 14, padding: 14,
                borderWidth: 1, borderColor: '#86efac', marginBottom: 16 },
  bulkName:   { fontSize: 15, fontWeight: '800', color: '#0b1f4b', marginBottom: 2 },
  bulkEnroll: { fontSize: 11, color: '#94a3b8', marginBottom: 6 },
  bulkDays:   { fontSize: 12, color: '#64748b', marginBottom: 4 },
  bulkPhone:  { fontSize: 12, fontWeight: '600', color: '#15803d', marginBottom: 12 },
  msgPreview: { backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 14,
                borderWidth: 1, borderColor: '#d1fae5' },
  msgPreviewLabel: { fontSize: 10, fontWeight: '700', color: '#15803d',
                     textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  msgPreviewTxt: { fontSize: 11, color: '#374151', lineHeight: 17 },
  openWaBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, backgroundColor: '#15803d', borderRadius: 12, paddingVertical: 12 },
  openWaBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bulkNav:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  bulkSkipBtn:{ flex: 1, alignItems: 'center', paddingVertical: 12,
                backgroundColor: '#f1f5f9', borderRadius: 12 },
  bulkSkipTxt:{ fontSize: 13, fontWeight: '700', color: '#475569' },
  bulkDoneBtn:{ flex: 1, alignItems: 'center', paddingVertical: 12,
                backgroundColor: '#fee2e2', borderRadius: 12 },
  bulkDoneTxt:{ fontSize: 13, fontWeight: '700', color: '#dc2626' },

  // Picker modal
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
                 maxHeight: '70%', paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#cbd5e1',
                 alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  sheetTitle:  { fontSize: 15, fontWeight: '800', color: '#0b1f4b',
                 paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
                 borderBottomColor: '#f1f5f9' },
  sheetRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
                 paddingVertical: 14 },
  sheetRowTxt: { flex: 1, fontSize: 14, color: '#0b1f4b', fontWeight: '500' },
  sep:         { height: 1, backgroundColor: '#f1f5f9', marginHorizontal: 16 },
});