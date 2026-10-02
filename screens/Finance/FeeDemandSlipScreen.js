/**
 * FeeDemandSlipScreen.js
 *
 * Class-wise fee demand slip with:
 *   - Scrollable student list (FlatList — scrolls natively)
 *   - Individual student PDF demand slip
 *   - Whole-class PDF demand slip
 *   - Email demand slip per student
 *   - Filter by class / session / branch
 *   - Search + "Due only" toggle
 *
 * PDF dependency:  expo-print + expo-sharing
 *   npx expo install expo-print expo-sharing
 */

import React, {
  useCallback, useContext, useMemo, useState,
} from 'react';
import {
  ActivityIndicator, Alert, FlatList, Linking, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
// expo-print and expo-sharing are loaded lazily on first PDF tap.
// Install them with:  npx expo install expo-print expo-sharing
// Then restart Metro: npx expo start --clear
let _Print      = null;
let _Sharing    = null;
let _FileSystem = null;

async function loadPdfLibs() {
  if (_Print) return { Print: _Print, Sharing: _Sharing };
  try {
    _Print      = await import('expo-print');
    _Sharing    = await import('expo-sharing');
    _FileSystem = await import('expo-file-system');
    return { Print: _Print, Sharing: _Sharing };
  } catch {
    throw new Error(
      'PDF libraries not installed.\n\n' +
      'Run in your project folder:\n' +
      '  npx expo install expo-print expo-sharing expo-file-system\n\n' +
      'Then restart Metro:\n' +
      '  npx expo start --clear'
    );
  }
}
import { AuthContext } from '../../context/AuthContext';
import {
  fetchDemandSlip,
  sendReceiptEmail,
} from '../../services/FeeServiceApi';
import { fetchClasses, fetchSessions, fetchBranches } from '../../services/StudentServiceApi';
import { Feather } from "@expo/vector-icons";
import { HOST_NAME } from '../../Environment/EnvironmentConfig';

const { width } = Dimensions.get('window');

const fmt     = (v) => (isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2));
const fmtCurr = (v) => `₹ ${fmt(v)}`;
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const C = {
  primary:  '#0f4c81',
  accent:   '#e8a020',
  bg:       '#f0f4f8',
  surface:  '#ffffff',
  border:   '#e2e8f0',
  muted:    '#64748b',
  text:     '#0c1a2e',
  textSoft: '#475569',
  success:  '#15803d',
  error:    '#b91c1c',
  warning:  '#b45309',
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF HTML builders
// ─────────────────────────────────────────────────────────────────────────────

// Helper: filter fee items to only those that are overdue
// Overdue = balance_due > 0 AND due_date is in the past (or null — still include)
const today = new Date(); today.setHours(0, 0, 0, 0);

function overdueItems(feeItems) {
  return (feeItems ?? []).filter(fi => {
    if (parseFloat(fi.balance_due ?? 0) <= 0) return false;   // fully paid — skip
    if (!fi.due_date) return true;                            // no due date — include
    const d = new Date(fi.due_date); d.setHours(0, 0, 0, 0);
    return d <= today;                                        // past due — include
  });
}

// PDF styles — exact match to fee_demand_slip.php web template
const PDF_STYLES = '<style>' +
  '*{margin:0;padding:0;box-sizing:border-box}' +
  'body{font-family:Arial,sans-serif;font-size:9px;color:#0c1a2e;background:#fff}' +
  // Slip container — one per page for Print All
  '.slip{page-break-after:always;padding:20px 22px 14px 22px}' +
  '.slip:last-child{page-break-after:avoid}' +
  // Letterhead
  '.lhdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f4c81;padding-bottom:8px;margin-bottom:8px}' +
  '.lhdr h1{font-size:13px;color:#0f4c81;font-weight:800;margin-bottom:3px}' +
  '.lhdr .addr{font-size:7.5px;color:#64748b;line-height:1.6}' +
  '.lhdr .right{text-align:right;font-size:7.5px;color:#64748b;white-space:nowrap}' +
  '.lhdr .right strong{font-size:10px;color:#0f4c81;display:block;margin-bottom:2px}' +
  // Meta row
  '.meta-row{display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px dashed #e2e8f0}' +
  '.meta-item .lbl{font-size:6.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}' +
  '.meta-item .val{font-size:8.5px;font-weight:700;color:#0c1a2e}' +
  // Student block
  '.stu-block{background:#f8fafc;border-radius:4px;padding:7px 10px;margin-bottom:8px;border:1px solid #e2e8f0}' +
  '.stu-name{font-size:11px;font-weight:800;color:#0c1a2e;margin-bottom:3px}' +
  '.stu-info{font-size:7.5px;color:#64748b;line-height:1.6}' +
  '.stu-badge{display:inline-block;background:#eff6ff;color:#1e40af;border-radius:10px;padding:1px 6px;font-size:7px;font-weight:700;margin-right:4px;margin-top:2px}' +
  // Subject strip
  '.subj{border-left:3px solid #dc2626;background:#fef2f2;padding:5px 8px;margin-bottom:8px;border-radius:0 3px 3px 0}' +
  '.subj .title{font-size:8.5px;font-weight:800;color:#7f1d1d}' +
  '.subj .sub{font-size:7.5px;color:#b91c1c;margin-top:1px}' +
  // Table
  'table{width:100%;border-collapse:collapse;margin-bottom:8px}' +
  'th{background:#0f4c81;color:#fff;padding:5px 7px;font-size:7px;font-weight:700;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'th.r{text-align:right}' +
  'td{padding:5px 7px;font-size:8px;border-bottom:1px solid #f1f5f9;vertical-align:top}' +
  'td.r{text-align:right;font-weight:700}' +
  'td.disc{color:#15803d;text-align:right;font-weight:700}' +
  'td.tax-c{color:#1e40af;text-align:right;font-weight:700}' +
  'td.paid-c{color:#15803d;text-align:right;font-weight:700}' +
  'td.due{color:#b91c1c;text-align:right;font-weight:800}' +
  'td.late{color:#b45309;text-align:right;font-weight:700}' +
  'tr.tot td{background:#f0f4f8;font-weight:800;border-top:1.5px solid #0f4c81}' +
  'tr.grand td{background:#0f4c81;color:#fff;font-size:9px;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'tr.grand td.r{text-align:right}' +
  '.fn{font-size:7px;color:#94a3b8;margin-top:2px}' +
  // Signature
  '.sig-row{display:flex;justify-content:space-between;margin-top:14px}' +
  '.sig-box{text-align:center;font-size:7.5px;color:#475569}' +
  '.sig-line{width:100px;border-top:1px solid #94a3b8;margin:0 auto 3px}' +
  // Para + footer
  '.para{font-size:8px;color:#334155;line-height:1.7;margin-bottom:6px}' +
  '.slip-footer{text-align:center;font-size:7px;color:#94a3b8;padding-top:6px;margin-top:8px;border-top:1px solid #f1f5f9}' +
  '</style>';

// ── Language helpers ─────────────────────────────────────────────────────────

function getLanguage(courseMedium) {
  const m = String(courseMedium ?? '').toLowerCase().trim();
  if (!m) return 'en';
  if (m.includes('hindi') || m === 'hi') return 'hi';
  if (m.includes('urdu') || m === 'ur' || m.includes('arabic') || m === 'ar') return 'ur';
  return 'en';
}

const DEMAND_STRINGS = {
  en: {
    noticeTitle: 'FEE DEMAND NOTICE', academicSession: 'Academic Session',
    classLabel: 'Class', branchLabel: 'Branch', generated: 'Generated',
    subjectLine: 'Subject: Notice for Payment of Outstanding Fee',
    totalOutstanding: 'Total Outstanding Amount',
    dearParent: (n) => `Dear Parent / Guardian of <strong>${n}</strong>,`,
    bodyPara: (s) => `This is to bring to your kind notice that the following fee amount is outstanding against the above-mentioned student for the academic session <strong>${s}</strong>. You are requested to clear the dues at the earliest to avoid any late charges or disruption to academic services.`,
    feeItem: 'Fee Item', feeAmount: 'Fee Amount', discount: 'Discount',
    netPayable: 'Net Payable', gstTax: 'GST / Tax', lateFee: 'Late Fee',
    paid: 'Paid', balanceDue: 'Balance Due', subTotal: 'Sub-Total',
    totalBalanceDue: '&#9654; Total Outstanding Balance Due',
    parentSig: 'Parent / Guardian Signature',
    accountsSig: 'Accounts Office Seal &amp; Signature',
    footerNote: 'System-generated demand notice',
  },
  hi: {
    noticeTitle: 'शुल्क मांग सूचना', academicSession: 'शैक्षणिक सत्र',
    classLabel: 'कक्षा', branchLabel: 'शाखा', generated: 'उत्पन्न',
    subjectLine: 'विषय: बकाया शुल्क भुगतान की सूचना',
    totalOutstanding: 'कुल बकाया राशि',
    dearParent: (n) => `प्रिय अभिभावक / संरक्षक, <strong>${n}</strong> के माता-पिता,`,
    bodyPara: (s) => `आपके संज्ञान में लाया जाता है कि उपरोक्त छात्र/छात्रा के लिए शैक्षणिक सत्र <strong>${s}</strong> हेतु निम्नलिखित शुल्क बकाया है। कृपया शीघ्र भुगतान करें ताकि किसी विलंब शुल्क या शैक्षणिक सेवाओं में व्यवधान से बचा जा सके।`,
    feeItem: 'शुल्क मद', feeAmount: 'शुल्क राशि', discount: 'छूट',
    netPayable: 'देय राशि', gstTax: 'जीएसटी / कर', lateFee: 'विलंब शुल्क',
    paid: 'भुगतान', balanceDue: 'बकाया राशि', subTotal: 'उप-योग',
    totalBalanceDue: '&#9654; कुल बकाया शेष',
    parentSig: 'अभिभावक के हस्ताक्षर',
    accountsSig: 'लेखा कार्यालय मोहर एवं हस्ताक्षर',
    footerNote: 'सिस्टम-जनित मांग सूचना',
  },
  ur: {
    noticeTitle: 'فیس طلب نوٹس', academicSession: 'تعلیمی سیشن',
    classLabel: 'جماعت', branchLabel: 'شاخہ', generated: 'تاریخ اجراء',
    subjectLine: 'موضوع: واجب الادا فیس کی ادائیگی کا نوٹس',
    totalOutstanding: 'کل واجب الادا رقم',
    dearParent: (n) => `محترم والدین / سرپرست، <strong>${n}</strong>،`,
    bodyPara: (s) => `آپ کے علم میں لایا جاتا ہے کہ مذکورہ طالب علم کے تعلیمی سیشن <strong>${s}</strong> کی درج ذیل فیس واجب الادا ہے۔ براہ کرم جلد از جلد ادائیگی کریں تاکہ تاخیری جرمانے یا تعلیمی خدمات میں رکاوٹ سے بچا جا سکے۔`,
    feeItem: 'فیس مد', feeAmount: 'فیس رقم', discount: 'رعایت',
    netPayable: 'قابل ادائیگی', gstTax: 'جی ایس ٹی / ٹیکس', lateFee: 'تاخیری جرمانہ',
    paid: 'ادا شدہ', balanceDue: 'بقایا رقم', subTotal: 'ذیلی مجموعہ',
    totalBalanceDue: '&#9654; کل واجب الادا بقایا',
    parentSig: 'والدین / سرپرست کے دستخط',
    accountsSig: 'اکاؤنٹس آفس مہر و دستخط',
    footerNote: 'سسٹم سے تیار کردہ طلب نوٹس',
  },
};

// Build a single slip HTML fragment — mirrors fee_demand_slip.php buildSlipFragment exactly
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildSlipFragment(stu, meta, lang = 'en') {
  const t = DEMAND_STRINGS[lang] ?? DEMAND_STRINGS.en;
  const { className, sessionName, branchName, schoolName, address, city, state, zip, email, phone, logo, currSym = '₹' } = meta;

  const dueItems = (stu.fee_items ?? []).filter(fi => parseFloat(fi.balance_due ?? 0) > 0);
  if (!dueItems.length) return '';

  const totalDue  = dueItems.reduce((s,f) => s + parseFloat(f.balance_due     ?? 0), 0);
  const totalPaid = dueItems.reduce((s,f) => s + parseFloat(f.previously_paid ?? 0), 0);
  const totalFee  = dueItems.reduce((s,f) => s + parseFloat(f.fee_amount      ?? 0), 0);  // raw fee
  const totalLate = dueItems.reduce((s,f) => s + parseFloat(f.late_fee        ?? 0), 0);

  const hasDisc = dueItems.some(fi => parseFloat(fi.discount_amount ?? 0) > 0);
  const hasTax  = dueItems.some(fi => parseFloat(fi.tax_amount      ?? 0) > 0);
  const hasLate = dueItems.some(fi => parseFloat(fi.late_fee        ?? 0) > 0);
  const hasPaid = totalPaid > 0;

  const totalDisc    = hasDisc ? dueItems.reduce((s,f) => s + parseFloat(f.discount_amount ?? 0), 0) : 0;
  const totalTax     = hasTax  ? dueItems.reduce((s,f) => s + parseFloat(f.tax_amount      ?? 0), 0) : 0;
  const totalNetBase = dueItems.reduce((s,f) => s + parseFloat(f.net_fee_amount ?? f.fee_amount ?? 0), 0);

  // Net payable = discounted base + tax (matches $netPayable in controller)
  const netTot = totalNetBase + totalTax;

  const addr    = [address, city, state, zip].filter(Boolean).join(', ');
  const contact = [phone ? `Ph: ${phone}` : '', email ? `Email: ${email}` : ''].filter(Boolean).join('  ·  ');
  const genOn   = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const genDate = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' });
  const refNo   = `FDS-${esc(String(stu.enrollment_id))}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;

  const logoHtml = logo
    ? `<img src="${logo}" style="width:56px;height:56px;object-fit:contain;flex-shrink:0;"/>`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#0f4c81;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;flex-shrink:0;">${esc((schoolName ?? 'S')[0])}</div>`;

  let html = `<div class="lhdr"><div style="display:flex;align-items:center;gap:10px;">${logoHtml}<div><h1>${esc(schoolName)}</h1>${addr ? `<div class="addr">${esc(addr)}</div>` : ''} ${contact ? `<div class="addr">${esc(contact)}</div>` : ''}</div></div><div class="right"><strong>${t.noticeTitle}</strong>Date: ${esc(genDate)}<br/>Ref: ${esc(refNo)}</div></div>`;

  // ── Meta row ──
  html += `<div class="meta-row">
    <div class="meta-item"><div class="lbl">${t.academicSession}</div><div class="val">${esc(sessionName)}</div></div>
    <div class="meta-item"><div class="lbl">${t.classLabel}</div><div class="val">${esc(className)}</div></div>
    ${branchName ? `<div class="meta-item"><div class="lbl">${t.branchLabel}</div><div class="val">${esc(branchName)}</div></div>` : ''}
    <div class="meta-item" style="text-align:right"><div class="lbl">${t.generated}</div><div class="val">${esc(genOn)}</div></div>
  </div>`;

  // ── Student block ──
  html += `<div class="stu-block">
    <div class="stu-name">${esc(stu.student_name ?? '')}</div>
    <div style="margin-top:4px">
      <span class="stu-badge">Enr # ${esc(String(stu.enrollment_id))}</span>
      ${stu.registration_id ? `<span class="stu-badge">Reg # ${esc(String(stu.registration_id))}</span>` : ''}
    </div>
  </div>`;

  // ── Subject strip ──
  html += `<div class="subj">
    <div class="title">${t.subjectLine} &mdash; ${esc(sessionName)}</div>
    <div class="sub">${t.totalOutstanding}: ${currSym} ${fmt(totalDue)}</div>
  </div>`;

  // ── Opening paragraphs ──
  html += `<p class="para">${t.dearParent(esc(stu.student_name ?? ''))}</p>
  <p class="para">${t.bodyPara(esc(sessionName))}</p>`;

  // ── Table header ──
  const discTh = hasDisc ? `<th class="r">${t.discount}</th>` : '';
  const taxTh  = hasTax  ? `<th class="r">${t.gstTax}</th>` : '';
  const lateTh = hasLate ? `<th class="r">${t.lateFee}</th>` : '';
  const paidTh = hasPaid ? `<th class="r">${t.paid}</th>` : '';

  html += `<table><thead><tr>
    <th>${t.feeItem}</th><th class="r">${t.feeAmount}</th>
    ${discTh}<th class="r">${t.netPayable}</th>${taxTh}${paidTh}${lateTh}
    <th class="r">${t.balanceDue}</th>
  </tr></thead><tbody>`;

  // ── Fee rows ──
  dueItems.forEach(fi => {
    const mn  = fi.month_no ? ` <span style="color:#94a3b8">(${esc(fi.month_no)})</span>` : '';
    const dd  = fi.due_date ? `<div class="fn" style="color:#b91c1c">Due: ${fmtDate(fi.due_date)}</div>` : '';
    const disc = parseFloat(fi.discount_amount ?? 0);
    const tax  = parseFloat(fi.tax_amount      ?? 0);
    const late = parseFloat(fi.late_fee        ?? 0);
    const paid = parseFloat(fi.previously_paid ?? 0);
    const net  = parseFloat(fi.net_payable  ?? fi.net_fee_amount ?? fi.fee_amount ?? 0);

    const discCell = hasDisc
      ? (disc > 0 ? `<td class="disc">&minus;${currSym} ${fmt(disc)}<div class="fn">(${parseFloat(fi.discount_percent??0).toFixed(1)}%)</div></td>`
                  : '<td class="r" style="color:#94a3b8">&mdash;</td>')
      : '';
    const taxCell = hasTax
      ? (tax > 0 ? `<td class="tax-c">+${currSym} ${fmt(tax)}<div class="fn">(${parseFloat(fi.tax_percent??0).toFixed(1)}%)</div></td>`
                 : '<td class="r" style="color:#94a3b8">&mdash;</td>')
      : '';
    const lateCell = hasLate
      ? (late > 0 ? `<td class="late">+${currSym} ${fmt(late)}</td>`
                  : '<td class="r" style="color:#94a3b8">&mdash;</td>')
      : '';
    const paidCell = hasPaid
      ? (paid > 0 ? `<td class="paid-c">${currSym} ${fmt(paid)}</td>`
                  : '<td class="r" style="color:#94a3b8">&mdash;</td>')
      : '';

    html += `<tr>
      <td>${esc(fi.fee_item_name ?? '—')}${mn}${dd}</td>
      <td class="r">${currSym} ${fmt(fi.fee_amount)}</td>
      ${discCell}
      <td class="r">${currSym} ${fmt(net)}</td>
      ${taxCell}${paidCell}${lateCell}
      <td class="due">${currSym} ${fmt(fi.balance_due)}</td>
    </tr>`;
  });

  // ── Sub-total ──
  const discTotCell = hasDisc ? `<td class="disc">&minus;${currSym} ${fmt(totalDisc)}</td>` : '';
  const taxTotCell  = hasTax  ? `<td class="tax-c">+${currSym} ${fmt(totalTax)}</td>`       : '';
  const lateTotCell = hasLate ? `<td class="late">+${currSym} ${fmt(totalLate)}</td>`       : '';
  const paidTotCell = hasPaid ? `<td class="paid-c">${currSym} ${fmt(totalPaid)}</td>`      : '';

  html += `<tr class="tot">
    <td><strong>${t.subTotal}</strong></td>
    <td class="r">${currSym} ${fmt(totalFee)}</td>
    ${discTotCell}
    <td class="r">${currSym} ${fmt(netTot)}</td>
    ${taxTotCell}${paidTotCell}${lateTotCell}
    <td class="due">${currSym} ${fmt(totalDue)}</td>
  </tr>`;

  // ── Grand total ──
  const grandColspan = 2 + (hasDisc?1:0) + (hasTax?1:0) + (hasPaid?1:0) + (hasLate?1:0);
  html += `<tr class="grand">
    <td colspan="${grandColspan}">${t.totalBalanceDue}</td>
    <td class="r" colspan="2" style="font-size:10px">${currSym} ${fmt(totalDue)}</td>
  </tr></tbody></table>`;

  // ── Signature ──
  html += `<div class="sig-row">
    <div class="sig-box"><div class="sig-line"></div>${t.parentSig}</div>
    <div class="sig-box"><div class="sig-line"></div>${t.accountsSig}</div>
  </div>`;

  return html;
}

// Individual student PDF — one full page
function buildStudentSlipHtml(stu, meta) {
  const lang     = getLanguage(stu.course_medium);
  const t        = DEMAND_STRINGS[lang] ?? DEMAND_STRINGS.en;
  const dir      = lang === 'ur' ? ' dir="rtl"' : '';
  const fragment = buildSlipFragment(stu, meta, lang);
  const footer   = `<div class="slip-footer">${t.footerNote} &bull; ${esc(meta.schoolName)} &bull; Enr # ${esc(String(stu.enrollment_id))}</div>`;
  if (!fragment) {
    return `<!DOCTYPE html><html${dir}><head><meta charset="UTF-8"/>${PDF_STYLES}</head>
    <body><div class="slip"><div style="text-align:center;padding:40px;color:#64748b">
      <p style="font-size:16px;font-weight:800">No outstanding fees</p>
      <p style="margin-top:8px">${esc(stu.student_name)} has no pending fee dues at this time.</p>
    </div>${footer}</div></body></html>`;
  }
  return `<!DOCTYPE html><html${dir}><head><meta charset="UTF-8"/>${PDF_STYLES}</head>
  <body><div class="slip">${fragment}${footer}</div></body></html>`;
}

// Class PDF — one student per page, page-break-after each slip
function buildClassSlipHtml(students, summary, meta) {
  const studentsWithDues = students.filter(s =>
    (s.fee_items ?? []).some(fi => parseFloat(fi.balance_due ?? 0) > 0)
  );

  if (!studentsWithDues.length) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>${PDF_STYLES}</head>
    <body style="padding:40px;text-align:center;color:#64748b">
      <p style="font-size:16px;font-weight:800;margin-bottom:8px">No outstanding fees found</p>
      <p>All students are up to date for the selected filters.</p>
    </body></html>`;
  }

  const slipDivs = studentsWithDues.map(stu => {
    const lang     = getLanguage(stu.course_medium);
    const t        = DEMAND_STRINGS[lang] ?? DEMAND_STRINGS.en;
    const dir      = lang === 'ur' ? ' dir="rtl"' : '';
    const fragment = buildSlipFragment(stu, meta, lang);
    const footer   = `<div class="slip-footer">${t.footerNote} &bull; ${esc(meta.schoolName)} &bull; Enr # ${esc(String(stu.enrollment_id))}</div>`;
    return `<div class="slip"${dir}>${fragment}${footer}</div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>${PDF_STYLES}</head>
  <body>${slipDivs}</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Custom Dropdown — replaces @react-native-picker/picker ───────────────────
// Fully JS-based: immune to Android dark mode, no native thread blocking.
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[_ddSt.trigger, disabled && _ddSt.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[_ddSt.triggerTxt, !selected?.value && _ddSt.placeholder]} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={_ddSt.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={_ddSt.sheet}>
            <Text style={_ddSt.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[_ddSt.option, String(o.value) === String(value) && _ddSt.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[_ddSt.optionTxt, String(o.value) === String(value) && _ddSt.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#2563eb" />}
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
const _ddSt = StyleSheet.create({
  trigger:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12 },
  disabled:        { opacity: 0.45 },
  triggerTxt:      { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  placeholder:     { color: "#94a3b8" },
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:           { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:    { backgroundColor: "#eff6ff" },
  optionTxt:       { fontSize: 14, color: "#0f172a" },
  optionTxtActive: { color: "#2563eb", fontWeight: "700" },
});

export default function FeeDemandSlipScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const params   = route?.params ?? {};

  const [classes,   setClasses]   = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [branches,  setBranches]  = useState([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(false);
  const [dropdownsLoaded,  setDropdownsLoaded]  = useState(false);

  const [selClassId,   setSelClassId]   = useState(params.class_id   ? String(params.class_id)   : '');
  const [selSessionId, setSelSessionId] = useState(params.session_id ? String(params.session_id) : '');
  const [selBranchId,  setSelBranchId]  = useState(params.branch_id  ? String(params.branch_id)  : '');
  const [selCategory,  setSelCategory]  = useState('');
  const [clientCode,   setClientCode]   = useState(params.ssms_client_code ?? '');

  const [students,   setStudents]   = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [clientInfo, setClientInfo] = useState(null);
  const currSym = clientInfo?.currency?.trim() || '₹';
  const [loading,    setLoading]    = useState(false);
  const [hasLoaded,  setHasLoaded]  = useState(false);

  const [searchQ,   setSearchQ]   = useState('');
  const [filterDue, setFilterDue] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const [filterModal,  setFilterModal]  = useState(false);
  const [emailModal,   setEmailModal]   = useState(false);
  const [emailStudent, setEmailStudent] = useState(null);
  const [emailAddr,    setEmailAddr]    = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfStudentId,  setPdfStudentId]  = useState(null);

  const classItems   = useMemo(() => classes.map(c  => ({ label: c.class_name,  value: String(c.class_id) })),  [classes]);
  const sessionItems = useMemo(() => sessions.map(s => ({ label: s.session_name ?? String(s.session_id), value: String(s.session_id) })), [sessions]);
  // Branch API may return branch_name, name, or branchName depending on backend
  const branchItems  = useMemo(() => branches.map(b => ({
    label: b.branch_name ?? b.name ?? b.branchName ?? String(b.branch_id ?? b.id ?? ''),
    value: String(b.branch_id ?? b.id ?? b.branchId ?? ''),
  })).filter(b => b.value !== ''), [branches]);

  const selectedClassName   = classItems.find(c   => c.value === selClassId)?.label   ?? '';
  const selectedSessionName = sessionItems.find(s => s.value === selSessionId)?.label ?? '';
  const selectedBranchName  = branchItems.find(b  => b.value === selBranchId)?.label  ?? '';

  const pdfMeta = useMemo(() => ({
    className:   selectedClassName   || `Class ${selClassId}`,
    sessionName: selectedSessionName || `Session ${selSessionId}`,
    branchName:  selectedBranchName  || '',
    // Client / school branding — from ssms_clients via API
    schoolName:  clientInfo?.header_text || user?.schoolName || 'School Management System',
    address:     clientInfo?.address  || '',
    city:        clientInfo?.city     || '',
    state:       clientInfo?.state    || '',
    zip:         clientInfo?.zip      || '',
    email:       clientInfo?.email    || '',
    phone:       clientInfo?.phone    || '',
    currSym:     clientInfo?.currency?.trim() || '₹',
    logo:        null,   // filled in per-handler after async logo download
    generatedOn: new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
  }), [selectedClassName, selectedSessionName, selectedBranchName,
       selClassId, selSessionId, clientInfo, user]);

  const loadDropdowns = useCallback(async () => {
    if (!user) return;
    if (dropdownsLoaded) { setFilterModal(true); return; }
    try {
      setLoadingDropdowns(true);
      const [cls, ses, br] = await Promise.all([fetchClasses(user), fetchSessions(user), fetchBranches(user)]);
      setClasses(cls || []); setSessions(ses || []); setBranches(br || []);
      setDropdownsLoaded(true); setFilterModal(true);
    } catch (e) { Alert.alert('Error', e.message || 'Failed to load dropdown data'); }
    finally { setLoadingDropdowns(false); }
  }, [user, dropdownsLoaded]);

  const generate = useCallback(async () => {
    if (!user) return;
    if (!selClassId || !selSessionId) {
      Alert.alert('Required', 'Please select both Class and Session.'); return;
    }
    try {
      setLoading(true); setHasLoaded(false);
      const res = await fetchDemandSlip({
        class_id:         selClassId,
        session_id:       selSessionId,
        branch_id:        selBranchId  || undefined,
        category:         selCategory  || undefined,
        ssms_client_code: clientCode   || undefined,
      }, user);
      setStudents(res.students ?? []);
      setSummary(res.summary   ?? null);
      setClientInfo(res.clientInfo ?? null);
      setHasLoaded(true); setExpandedId(null);
    } catch (e) { Alert.alert('Error', e.message ?? 'Failed to load demand slip data.'); }
    finally { setLoading(false); }
  }, [selClassId, selSessionId, selBranchId, selCategory, clientCode, user]);

  const filteredStudents = useMemo(() => {
    let list = students
      .map(s => ({
        ...s,
        fee_items: (s.fee_items ?? []).filter(fi => parseFloat(fi.balance_due ?? 0) > 0),
      }))
      .filter(s => s.fee_items.length > 0);
    if (filterDue) list = list.filter(s => (s.total_due ?? 0) > 0);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(s =>
        s.student_name?.toLowerCase().includes(q) ||
        String(s.enrollment_id).includes(q) ||
        String(s.registration_id ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, filterDue, searchQ]);

  const openEmailModal = useCallback((stu) => {
    setEmailStudent(stu); setEmailAddr(stu.email_address ?? ''); setEmailModal(true);
  }, []);

  const handleSendEmail = useCallback(async () => {
    const addr = emailAddr.trim();
    if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.'); return;
    }
    try {
      setSendingEmail(true);
      const feeItems = emailStudent?.fee_items?.filter(f => f.balance_due > 0).map(f => ({
        fee_item_name: f.fee_item_name, fee_amount: f.fee_amount,
        paid_amount: f.previously_paid, balance_amount: f.balance_due,
      })) ?? [];
      await sendReceiptEmail({
        email: addr, student_name: emailStudent?.student_name ?? '',
        enrollment_id: emailStudent?.enrollment_id,
        receipt_number: `DEMAND-${selSessionId}-${emailStudent?.enrollment_id}`,
        paid_amount: emailStudent?.total_paid ?? 0,
        balance_amount: emailStudent?.total_due ?? 0,
        fee_amount: emailStudent?.total_fee ?? 0,
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'Demand Slip', fee_items: feeItems,
        class_name: selectedClassName, session_name: selectedSessionName, branch_name: selectedBranchName,
      }, user);
      setEmailModal(false);
      Alert.alert('Sent ✓', `Demand slip emailed to ${addr}.`);
    } catch (e) { Alert.alert('Failed', e.message ?? 'Could not send email.'); }
    finally { setSendingEmail(false); }
  }, [emailAddr, emailStudent, selSessionId, selectedClassName, selectedSessionName, selectedBranchName, user]);

  const handleStudentPdf = useCallback(async (stu) => {
    try {
      setPdfStudentId(stu.enrollment_id);
      const { Print, Sharing } = await loadPdfLibs();

      // ── Download school logo once ─────────────────────────────────────────
      let logoBase64 = null;
      const logoName = clientInfo?.logo_name ?? '';
      if (logoName && _FileSystem) {
        try {
          const base    = (HOST_NAME ?? '').replace(/\/+$/, '');
          const logoUrl = `${base}/clients/${user?.ssmsClientCode}/${logoName}`;
          const ext     = (logoName.split('.').pop() || 'jpg').toLowerCase();
          const mime    = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const tmp     = _FileSystem.cacheDirectory + 'demand_logo.' + ext;
          await _FileSystem.downloadAsync(logoUrl, tmp);
          const b64 = await _FileSystem.readAsStringAsync(tmp, { encoding: _FileSystem.EncodingType.Base64 });
          logoBase64 = `data:${mime};base64,${b64}`;
        } catch (_) { /* fall back to initials circle */ }
      }

      const html = buildStudentSlipHtml(stu, { ...pdfMeta, logo: logoBase64 });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Demand Slip — ${stu.student_name}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e) {
      Alert.alert('PDF Error', e.message ?? 'Could not generate PDF.');
    } finally {
      setPdfStudentId(null);
    }
  }, [pdfMeta, clientInfo, user]);

  const handleClassPdf = useCallback(async () => {
    if (filteredStudents.length === 0) {
      Alert.alert('No Data', 'Generate the demand slip first.'); return;
    }
    try {
      setGeneratingPdf(true);
      const { Print, Sharing } = await loadPdfLibs();

      // ── Download school logo once ─────────────────────────────────────────
      let logoBase64 = null;
      const logoName = clientInfo?.logo_name ?? '';
      if (logoName && _FileSystem) {
        try {
          const base    = (HOST_NAME ?? '').replace(/\/+$/, '');
          const logoUrl = `${base}/clients/${user?.ssmsClientCode}/${logoName}`;
          const ext     = (logoName.split('.').pop() || 'jpg').toLowerCase();
          const mime    = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const tmp     = _FileSystem.cacheDirectory + 'demand_logo.' + ext;
          await _FileSystem.downloadAsync(logoUrl, tmp);
          const b64 = await _FileSystem.readAsStringAsync(tmp, { encoding: _FileSystem.EncodingType.Base64 });
          logoBase64 = `data:${mime};base64,${b64}`;
        } catch (_) { /* fall back to initials circle */ }
      }

      const html = buildClassSlipHtml(filteredStudents, summary, { ...pdfMeta, logo: logoBase64 });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Demand Slip — ${pdfMeta.className}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e) {
      Alert.alert('PDF Error', e.message ?? 'Could not generate PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  }, [filteredStudents, summary, pdfMeta, clientInfo, user]);

  const sendWhatsAppDemandNotice = useCallback((stu) => {
    const phone = String(stu.mobile_number ?? '').replace(/\D/g, '');
    if (!phone) {
      Alert.alert('No Phone Number', `No mobile number on record for ${stu.student_name ?? 'this student'}.`);
      return;
    }
    const schoolName = pdfMeta.schoolName ?? 'School';
    const dueItems   = (stu.fee_items ?? []).filter(fi => parseFloat(fi.balance_due ?? 0) > 0);
    if (!dueItems.length) {
      Alert.alert('No Dues', `${stu.student_name} has no outstanding fees.`);
      return;
    }
    const lines = dueItems.map(i =>
      `• ${i.fee_item_name}${i.month_no ? ` (${i.month_no})` : ''}: ₹ ${parseFloat(i.balance_due ?? 0).toFixed(2)}`
    ).join('\n');
    const total = dueItems.reduce((s, i) => s + parseFloat(i.balance_due ?? 0), 0);
    const message =
      `*📢 Fee Demand Notice*\n` +
      `From: ${schoolName}\n\n` +
      `Dear Parent/Guardian,\n` +
      `This is a reminder that the following fees are outstanding for *${stu.student_name ?? stu.enrollment_id}* (Enrollment: ${stu.enrollment_id}):\n\n` +
      `${lines}\n\n` +
      `*Total Due: ₹ ${total.toFixed(2)}*\n\n` +
      `Please clear the dues at the earliest to avoid any late charges.\n` +
      `For any queries, contact the school accounts office.`;
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`).catch(() =>
      Alert.alert('WhatsApp Not Found', 'Please ensure WhatsApp is installed on this device.')
    );
  }, [pdfMeta]);

  // ── Header + controls rendered as FlatList header (scrolls with content) ──
  const ListHeader = useMemo(() => (
    <View>
      {/* Filter chips */}
      {(selClassId || selSessionId || selBranchId || selCategory) && (
        <View style={ds.chipRow}>
          {selectedClassName   && <FilterChip label={`Class: ${selectedClassName}`}     onRemove={() => setSelClassId('')} />}
          {selectedSessionName && <FilterChip label={`Session: ${selectedSessionName}`} onRemove={() => setSelSessionId('')} />}
          {selectedBranchName  && <FilterChip label={`Branch: ${selectedBranchName}`}   onRemove={() => setSelBranchId('')} />}
          {selCategory         && <FilterChip label={`Category: ${selCategory}`}         onRemove={() => setSelCategory('')} />}
        </View>
      )}

      {/* Generate + Print All */}
      <View style={ds.generateRow}>
        <TouchableOpacity
          style={[ds.generateBtn, (!selClassId || !selSessionId || loading) && ds.generateBtnDisabled]}
          onPress={generate} disabled={!selClassId || !selSessionId || loading}>
          {loading
            ? <><ActivityIndicator size="small" color="#fff" /><Text style={ds.generateBtnText}>  Generating…</Text></>
            : <><MaterialIcons name="assignment" size={18} color="#fff" /><Text style={ds.generateBtnText}>  Generate</Text></>}
        </TouchableOpacity>
        {hasLoaded && filteredStudents.length > 0 && (
          <TouchableOpacity style={[ds.pdfAllBtn, generatingPdf && { opacity: 0.65 }]}
            onPress={handleClassPdf} disabled={generatingPdf}>
            {generatingPdf
              ? <ActivityIndicator size="small" color={C.primary} />
              : <MaterialIcons name="picture-as-pdf" size={18} color={C.primary} />}
            <Text style={ds.pdfAllBtnText}>{generatingPdf ? 'Generating…' : 'Print All'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Empty / loading state */}
      {!hasLoaded && loading && (
        <View style={ds.emptyState}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={ds.emptySub}>Loading…</Text>
        </View>
      )}
      {!hasLoaded && !loading && (
        <View style={ds.emptyState}>
          <MaterialIcons name="assignment" size={56} color="#cbd5e1" />
          <Text style={ds.emptyTitle}>No data yet</Text>
          <Text style={ds.emptySub}>Select a class and session above, then tap Generate.</Text>
        </View>
      )}

      {/* Summary banner */}
      {hasLoaded && summary && (
        <View style={ds.summaryBanner}>
          <SumCell icon="people"          label="Students"  value={String(summary.student_count)} />
          <View style={ds.sumDivider} />
          <SumCell icon="account-balance" label="Total Fee"  value={fmtCurr(summary.total_fee)} />
          <View style={ds.sumDivider} />
          <SumCell icon="check-circle"    label="Collected" value={fmtCurr(summary.total_paid)} color="#4ade80" />
          <View style={ds.sumDivider} />
          <SumCell icon="pending-actions" label="Due"       value={fmtCurr(summary.total_due)}  color="#fca5a5" />
        </View>
      )}

      {/* Search + Due toggle */}
      {hasLoaded && (
        <View style={ds.searchRow}>
          <View style={ds.searchBox}>
            <MaterialIcons name="search" size={18} color={C.muted} style={{ marginLeft: 10 }} />
            <TextInput
              style={ds.searchInput}
              placeholder="Search by name or enrollment…"
              placeholderTextColor={C.muted}
              value={searchQ} onChangeText={setSearchQ} autoCorrect={false}
            />
            {searchQ.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQ('')} style={{ paddingRight: 10 }}>
                <MaterialIcons name="cancel" size={18} color={C.muted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity style={[ds.dueToggle, filterDue && ds.dueToggleActive]}
            onPress={() => setFilterDue(v => !v)}>
            <MaterialIcons name={filterDue ? 'filter-alt' : 'filter-alt-off'} size={18}
              color={filterDue ? '#fff' : C.muted} />
            <Text style={[ds.dueToggleText, filterDue && { color: '#fff' }]}>Due only</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  ), [selClassId, selSessionId, selBranchId, selectedClassName, selectedSessionName,
      selectedBranchName, loading, hasLoaded, summary, filteredStudents.length,
      generatingPdf, searchQ, filterDue, generate, handleClassPdf]);

  return (
    <SafeAreaView style={ds.safeArea} edges={['top']}>

      {/* Sticky page header — never scrolls away */}
      <View style={ds.header}>
        <TouchableOpacity style={ds.backBtn} onPress={() => navigation?.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={C.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={ds.headerTitle}>Fee Demand Slip</Text>
          <Text style={ds.headerSub}>Class-wise outstanding fee report</Text>
        </View>
        <TouchableOpacity style={[ds.filterBtn, loadingDropdowns && { opacity: 0.6 }]}
          onPress={loadDropdowns} disabled={loadingDropdowns}>
          {loadingDropdowns
            ? <ActivityIndicator size="small" color={C.primary} />
            : <MaterialIcons name="tune" size={20} color={C.primary} />}
          <Text style={ds.filterBtnText}>Filters</Text>
        </TouchableOpacity>
      </View>

      {/* Single FlatList owns ALL scrolling.
          ListHeaderComponent renders chips / generate / summary / search.
          renderItem renders each student card.
          The whole thing scrolls together naturally. */}
      <FlatList
        data={hasLoaded ? filteredStudents : []}
        keyExtractor={item => String(item.enrollment_id)}
        contentContainerStyle={ds.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={hasLoaded ? (
          <View style={ds.emptyInList}>
            <MaterialIcons name="person-search" size={44} color="#cbd5e1" />
            <Text style={ds.emptyTitle}>No students found</Text>
            <Text style={ds.emptySub}>{filterDue ? 'All students are fully paid up!' : 'Try a different search term.'}</Text>
          </View>
        ) : null}
        renderItem={({ item: stu }) => {
          const isExpanded   = expandedId === stu.enrollment_id;
          const hasDue       = stu.total_due > 0;
          const isPdfLoading = pdfStudentId === stu.enrollment_id;
          return (
            <View style={[ds.studentCard, hasDue && ds.studentCardDue]}>
              <View style={[ds.studentAccent, { backgroundColor: hasDue ? C.error : C.success }]} />
              <View style={ds.studentBody}>
                <View style={ds.studentTopRow}>
                  <View style={ds.studentAvatar}>
                    <Text style={ds.studentAvatarText}>
                      {(stu.student_name ?? 'S').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ds.studentName} numberOfLines={1}>{stu.student_name}</Text>
                    <Text style={ds.studentMeta}>
                      #{stu.enrollment_id}{stu.registration_id ? `  ·  Reg #${stu.registration_id}` : ''}
                    </Text>
                  </View>
                  <View style={ds.studentActions}>
                    <TouchableOpacity style={ds.actionBtn} onPress={() => openEmailModal(stu)}>
                      <MaterialIcons name="email" size={16} color={C.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[ds.actionBtn, isPdfLoading && { opacity: 0.6 }]}
                      onPress={() => handleStudentPdf(stu)} disabled={isPdfLoading}>
                      {isPdfLoading
                        ? <ActivityIndicator size="small" color={C.primary} />
                        : <MaterialIcons name="picture-as-pdf" size={16} color="#e8a020" />}
                    </TouchableOpacity>
                    {hasDue && (
                      <TouchableOpacity style={ds.actionBtn}
                        onPress={() => sendWhatsAppDemandNotice(stu)}>
                        <MaterialIcons name="chat" size={16} color="#16a34a" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={ds.actionBtn}
                      onPress={() => setExpandedId(isExpanded ? null : stu.enrollment_id)}>
                      <MaterialIcons name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={C.muted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={ds.finStrip}>
                  <FinCell label="Total Fee"  value={fmtCurr(stu.total_fee)}  color={C.primary} />
                  <View style={ds.finDivider} />
                  <FinCell label="Paid"       value={fmtCurr(stu.total_paid)} color={C.success} />
                  <View style={ds.finDivider} />
                  <FinCell label="Due"        value={fmtCurr(stu.total_due)}  color={hasDue ? C.error : C.success} />
                </View>

                {isExpanded && (
                  <View style={ds.feeItemsList}>
                    <Text style={ds.feeItemsHeader}>Fee Breakdown</Text>
                    {stu.fee_items.map((fi, idx) => {
                      const disc = parseFloat(fi.discount_amount ?? 0);
                      const tax  = parseFloat(fi.tax_amount      ?? 0);
                      const paid = parseFloat(fi.previously_paid ?? 0);
                      const due  = parseFloat(fi.balance_due     ?? 0);
                      const mn   = fi.month_no ? ` · ${fi.month_no}` : '';
                      return (
                        <View key={idx} style={[ds.feeItemRow, idx === stu.fee_items.length - 1 && { borderBottomWidth: 0 }]}>
                          <View style={ds.feeItemHeader}>
                            <Text style={ds.feeItemName}>{fi.fee_item_name}{mn}</Text>
                            {fi.due_date && <Text style={ds.feeItemDate}>Due: {fmtDate(fi.due_date)}</Text>}
                          </View>
                          <View style={ds.feeItemLines}>
                            <View style={ds.feeItemLine}>
                              <Text style={ds.feeItemLineLabel}>Fee</Text>
                              <Text style={ds.feeItemLineFee}>{fmtCurr(fi.fee_amount, currSym)}</Text>
                            </View>
                            {disc > 0 && (
                              <View style={ds.feeItemLine}>
                                <Text style={[ds.feeItemLineLabel, { color: '#15803d' }]}>
                                  − Disc ({parseFloat(fi.discount_percent ?? 0).toFixed(1)}%)
                                </Text>
                                <Text style={[ds.feeItemLineVal, { color: '#15803d' }]}>−{fmtCurr(disc, currSym)}</Text>
                              </View>
                            )}
                            {tax > 0 && (
                              <View style={ds.feeItemLine}>
                                <Text style={[ds.feeItemLineLabel, { color: '#1e40af' }]}>
                                  + GST ({parseFloat(fi.tax_percent ?? 0).toFixed(1)}%)
                                </Text>
                                <Text style={[ds.feeItemLineVal, { color: '#1e40af' }]}>+{fmtCurr(tax, currSym)}</Text>
                              </View>
                            )}
                            {paid > 0 && (
                              <View style={ds.feeItemLine}>
                                <Text style={[ds.feeItemLineLabel, { color: C.success }]}>Paid</Text>
                                <Text style={[ds.feeItemLineVal, { color: C.success }]}>{fmtCurr(paid, currSym)}</Text>
                              </View>
                            )}
                            <View style={[ds.feeItemLine, ds.feeItemDueLine]}>
                              <Text style={ds.feeItemDueLabel}>Due</Text>
                              <Text style={ds.feeItemDueVal}>{fmtCurr(due, currSym)}</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />

      {/* Filter modal */}
      <FilterModal
        visible={filterModal} onClose={() => setFilterModal(false)}
        selClassId={selClassId}     setSelClassId={setSelClassId}
        selSessionId={selSessionId} setSelSessionId={setSelSessionId}
        selBranchId={selBranchId}   setSelBranchId={setSelBranchId}
        selCategory={selCategory}   setSelCategory={setSelCategory}
        classItems={classItems} sessionItems={sessionItems} branchItems={branchItems}
        onApply={() => setFilterModal(false)}
      />

      {/* Email modal */}
      <Modal visible={emailModal} transparent animationType="slide" onRequestClose={() => setEmailModal(false)}>
        <View style={ds.modalOverlay}>
          <TouchableOpacity style={ds.modalBackdrop} onPress={() => setEmailModal(false)} activeOpacity={1} />
          <View style={ds.emailSheet}>
            <View style={ds.emailHeader}>
              <View style={ds.emailIconWrap}>
                <MaterialIcons name="mark-email-unread" size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ds.emailTitle}>Send Demand Slip</Text>
                <Text style={ds.emailSub} numberOfLines={1}>{emailStudent?.student_name}</Text>
              </View>
              <TouchableOpacity style={ds.emailCloseBtn} onPress={() => setEmailModal(false)}>
                <MaterialIcons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <View style={ds.emailDueSummary}>
              <MaterialIcons name="pending-actions" size={18} color={C.error} />
              <Text style={ds.emailDueText}>
                Outstanding: <Text style={{ fontWeight: '900', color: C.error }}>{fmtCurr(emailStudent?.total_due)}</Text>
                {'  '}across {emailStudent?.fee_items?.filter(f => f.balance_due > 0).length ?? 0} item(s)
              </Text>
            </View>
            <Text style={ds.emailFieldLabel}>Send to Email</Text>
            <View style={ds.emailInputRow}>
              <MaterialIcons name="mail-outline" size={18} color="#94a3b8" style={{ marginLeft: 12, marginRight: 8 }} />
              <TextInput
                style={ds.emailInput} placeholder="guardian@example.com" placeholderTextColor="#94a3b8"
                value={emailAddr} onChangeText={setEmailAddr}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              />
            </View>
            <View style={ds.emailFooter}>
              <TouchableOpacity style={ds.emailCancelBtn} onPress={() => setEmailModal(false)}>
                <Text style={ds.emailCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[ds.emailSendBtn, sendingEmail && { opacity: 0.65 }]}
                onPress={handleSendEmail} disabled={sendingEmail}>
                {sendingEmail
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><MaterialIcons name="send" size={17} color="#fff" style={{ marginRight: 7 }} />
                      <Text style={ds.emailSendText}>Send Demand Slip</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── FilterModal ──────────────────────────────────────────────────────────────
const CATEGORY_ITEMS = [
  { label: 'Academic',   value: 'Academic' },
  { label: 'Hostel',     value: 'Hostel' },
  { label: 'Transport',  value: 'Transport' },
];

function FilterModal({ visible, onClose, selClassId, setSelClassId, selSessionId, setSelSessionId,
  selBranchId, setSelBranchId, selCategory, setSelCategory,
  classItems, sessionItems, branchItems, onApply }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ds.modalOverlay}>
        <TouchableOpacity style={ds.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={ds.filterSheet}>
          <View style={ds.filterSheetHeader}>
            <Text style={ds.filterSheetTitle}>Filter Demand Slip</Text>
            <TouchableOpacity style={ds.emailCloseBtn} onPress={onClose}>
              <MaterialIcons name="close" size={20} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false}>
            <PickerSection label="Class *"    icon="class"           value={selClassId}   onSelect={setSelClassId}   items={classItems}      placeholder="Select Class" />
            <PickerSection label="Session *"  icon="date-range"      value={selSessionId} onSelect={setSelSessionId} items={sessionItems}    placeholder="Select Session" />
            <PickerSection label="Branch"     icon="account-balance" value={selBranchId}  onSelect={setSelBranchId}  items={branchItems}     placeholder="All Branches" optional />
            <PickerSection label="Category"   icon="category"        value={selCategory}  onSelect={setSelCategory}  items={CATEGORY_ITEMS}  placeholder="All Categories" optional openUp />
          </ScrollView>
          <View style={{ paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 20, gap: 10 }}>
            <TouchableOpacity style={ds.applyBtn} onPress={onApply}>
              <MaterialIcons name="check" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={ds.applyBtnText}>Apply Filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ds.clearBtn} onPress={() => { setSelClassId(''); setSelSessionId(''); setSelBranchId(''); setSelCategory(''); }}>
              <Text style={ds.clearBtnText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PickerSection({ label, icon, value, onSelect, items, placeholder, optional, openUp = false }) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => i.value === value);
  return (
    <View style={{ zIndex: open ? 999 : 1 }}>
      <Text style={ds.pickerLabel}>{label}</Text>
      <TouchableOpacity style={[ds.pickerTrigger, value && ds.pickerTriggerActive]}
        onPress={() => setOpen(v => !v)} activeOpacity={0.75}>
        <MaterialIcons name={icon} size={17} color={value ? C.primary : C.muted} style={{ marginRight: 8 }} />
        <Text style={[ds.pickerTriggerText, value && { color: C.primary, fontWeight: '700' }]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <MaterialIcons name={open ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={C.muted} />
      </TouchableOpacity>
      {open && (
        <View style={[ds.pickerList, {
          position: 'absolute', left: 0, right: 0,
          ...(openUp ? { bottom: 52 } : { top: 52 }),
          zIndex: 1000, elevation: 20,
        }]}>
          {optional && (
            <TouchableOpacity style={[ds.pickerItem, !value && ds.pickerItemActive]}
              onPress={() => { onSelect(''); setOpen(false); }}>
              <Text style={[ds.pickerItemText, !value && { color: C.primary, fontWeight: '700' }]}>{placeholder}</Text>
              {!value && <MaterialIcons name="check" size={16} color={C.primary} />}
            </TouchableOpacity>
          )}
          {items.map(it => (
            <TouchableOpacity key={it.value} style={[ds.pickerItem, it.value === value && ds.pickerItemActive]}
              onPress={() => { onSelect(it.value); setOpen(false); }}>
              <Text style={[ds.pickerItemText, it.value === value && { color: C.primary, fontWeight: '700' }]}>{it.label}</Text>
              {it.value === value && <MaterialIcons name="check" size={16} color={C.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function FilterChip({ label, onRemove }) {
  return (
    <View style={ds.chip}>
      <Text style={ds.chipText}>{label}</Text>
      <TouchableOpacity onPress={onRemove} style={{ marginLeft: 4 }}>
        <MaterialIcons name="close" size={14} color={C.primary} />
      </TouchableOpacity>
    </View>
  );
}

function SumCell({ icon, label, value, color }) {
  return (
    <View style={ds.sumCell}>
      <MaterialIcons name={icon} size={16} color={color ?? 'rgba(255,255,255,0.85)'} />
      <Text style={[ds.sumValue, color && { color }]}>{value}</Text>
      <Text style={ds.sumLabel}>{label}</Text>
    </View>
  );
}

function FinCell({ label, value, color }) {
  return (
    <View style={ds.finCell}>
      <Text style={ds.finLabel}>{label}</Text>
      <Text style={[ds.finValue, { color }]}>{value}</Text>
    </View>
  );
}

const ds = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  header:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, paddingTop: Platform.OS === 'ios' ? 4 : 14, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12, elevation: 3, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  backBtn:       { width: 38, height: 38, borderRadius: 12, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: 19, fontWeight: '900', color: C.text, letterSpacing: -0.3 },
  headerSub:     { fontSize: 12, color: C.muted, marginTop: 2 },
  filterBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#e8f0fe', borderRadius: 12 },
  filterBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  chip:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8f0fe', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 4 },
  chipText:{ fontSize: 12, color: C.primary, fontWeight: '700' },
  generateRow:         { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  generateBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, elevation: 3, shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  generateBtnDisabled: { backgroundColor: '#94a3b8', elevation: 0, shadowOpacity: 0 },
  generateBtnText:     { fontSize: 15, fontWeight: '800', color: '#fff' },
  pdfAllBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: C.primary },
  pdfAllBtnText: { fontSize: 13, fontWeight: '800', color: C.primary },
  summaryBanner: { flexDirection: 'row', backgroundColor: C.primary, marginHorizontal: 16, marginTop: 14, marginBottom: 4, borderRadius: 18, padding: 16, elevation: 4, shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  sumCell:       { flex: 1, alignItems: 'center', gap: 4 },
  sumDivider:    { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },
  sumValue:      { fontSize: 13, fontWeight: '900', color: '#fff' },
  sumLabel:      { fontSize: 9, color: 'rgba(255,255,255,0.7)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  searchRow:       { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  searchBox:       { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 13, borderWidth: 1.5, borderColor: C.border, minHeight: 46 },
  searchInput:     { flex: 1, fontSize: 14, color: C.text, paddingVertical: 10, paddingHorizontal: 8 },
  dueToggle:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.surface, borderRadius: 13, borderWidth: 1.5, borderColor: C.border },
  dueToggleActive: { backgroundColor: C.primary, borderColor: C.primary },
  dueToggleText:   { fontSize: 12, fontWeight: '700', color: C.muted },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: C.textSoft },
  emptySub:   { fontSize: 13, color: C.muted, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  listContent: { paddingBottom: 40, gap: 10 },
  emptyInList: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  studentCard:      { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: C.border, elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, marginHorizontal: 16 },
  studentCardDue:   { borderColor: '#fecaca' },
  studentAccent:    { width: 5 },
  studentBody:      { flex: 1, padding: 14 },
  studentTopRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  studentAvatar:    { width: 40, height: 40, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  studentAvatarText:{ fontSize: 14, fontWeight: '900', color: '#fff' },
  studentName:      { fontSize: 15, fontWeight: '800', color: C.text },
  studentMeta:      { fontSize: 11, color: C.muted, marginTop: 2 },
  studentActions:   { flexDirection: 'row', gap: 6 },
  actionBtn:        { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f0f4f8', alignItems: 'center', justifyContent: 'center' },
  finStrip:   { flexDirection: 'row', backgroundColor: '#f8fafc', borderRadius: 12, padding: 10 },
  finCell:    { flex: 1, alignItems: 'center' },
  finDivider: { width: 1, backgroundColor: C.border, marginVertical: 2 },
  finLabel:   { fontSize: 9, color: C.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  finValue:   { fontSize: 13, fontWeight: '900', marginTop: 3 },
  feeItemsList:       { marginTop: 12, backgroundColor: '#f8fafc', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  feeItemsHeader:     { fontSize: 11, fontWeight: '800', color: C.primary, letterSpacing: 1, textTransform: 'uppercase', padding: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: '#eef2f8' },
  feeItemRow:         { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  feeItemHeader:      { marginBottom: 5 },
  feeItemName:        { fontSize: 13, fontWeight: '700', color: C.text },
  feeItemDate:        { fontSize: 11, color: C.error, marginTop: 1 },
  feeItemLines:       { gap: 3 },
  feeItemLine:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeItemLineLabel:   { fontSize: 12, color: C.muted },
  feeItemLineFee:     { fontSize: 12, fontWeight: '700', color: C.text },
  feeItemLineVal:     { fontSize: 12, fontWeight: '700' },
  feeItemDueLine:     { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#fee2e2' },
  feeItemDueLabel:    { fontSize: 13, fontWeight: '800', color: C.error },
  feeItemDueVal:      { fontSize: 13, fontWeight: '900', color: C.error },
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  filterSheet:       { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%', paddingBottom: 0, overflow: 'visible' },
  filterSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  filterSheetTitle:  { fontSize: 18, fontWeight: '800', color: C.text },
  pickerLabel:        { fontSize: 12, fontWeight: '700', color: C.textSoft, marginBottom: 6 },
  pickerTrigger:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13 },
  pickerTriggerActive:{ borderColor: C.primary, backgroundColor: '#eff6ff' },
  pickerTriggerText:  { flex: 1, fontSize: 14, color: C.muted },
  pickerList:         { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 13, marginTop: 4 },
  pickerItem:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  pickerItemActive:   { backgroundColor: '#eff6ff' },
  pickerItemText:     { fontSize: 14, color: C.text },
  applyBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15, elevation: 3 },
  applyBtnText:       { fontSize: 15, fontWeight: '800', color: '#fff' },
  clearBtn:           { alignItems: 'center', paddingVertical: 12 },
  clearBtnText:       { fontSize: 14, fontWeight: '700', color: C.muted },
  emailSheet:      { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 36 : 20 },
  emailHeader:     { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  emailIconWrap:   { width: 44, height: 44, borderRadius: 14, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  emailTitle:      { fontSize: 18, fontWeight: '800', color: C.text },
  emailSub:        { fontSize: 12, color: C.muted, marginTop: 2 },
  emailCloseBtn:   { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  emailDueSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, margin: 16, borderWidth: 1, borderColor: '#fecaca' },
  emailDueText:    { flex: 1, fontSize: 13, color: C.textSoft, lineHeight: 18 },
  emailFieldLabel: { fontSize: 12, fontWeight: '700', color: '#374151', marginHorizontal: 16, marginBottom: 6 },
  emailInputRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, marginHorizontal: 16, minHeight: 50 },
  emailInput:      { flex: 1, fontSize: 14, color: C.text, paddingVertical: 12 },
  emailFooter:     { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 16 },
  emailCancelBtn:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: C.border },
  emailCancelText: { fontSize: 14, fontWeight: '700', color: C.textSoft },
  emailSendBtn:    { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: C.primary, elevation: 3, shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  emailSendText:   { fontSize: 14, fontWeight: '700', color: '#fff' },
});