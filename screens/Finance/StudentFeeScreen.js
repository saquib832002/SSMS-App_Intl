/**
 * StudentFeeScreen.js
 *
 * Navigate to this screen via:
 *   navigation.navigate('StudentFee', {
 *     enrollment_id:   1042,
 *     registration_id: 5,
 *     student_name:    'John Smith',
 *     class_id:        3,
 *     session_id:      2,
 *     branch_id:       1,
 *     ssms_client_code:'SCH01',
 *   })
 *
 * Screen layout:
 *   1. Student header card
 *   2. DUE FEES — selectable rows (cart-style), running total at bottom
 *   3. Payment entry — paid amount input, balance auto-calc, submit
 *   4. PAYMENT HISTORY — paid records as tappable receipt links
 *   5. ReceiptDetailModal — full details of a past payment
 */

import React, {
  useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator, Platform,
  RefreshControl, Dimensions, FlatList, Animated, Image, Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import {
  fetchStudentFeeData,
  submitPayment,
  sendReceiptEmail,
} from '../../services/FeeServiceApi';
import { HOST_NAME } from '../../Environment/EnvironmentConfig';

const { width } = Dimensions.get('window');
const isTablet  = width >= 768;
// NOTE: useContext(AuthContext) moved inside the component function below

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt      = (v)    => (isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2));
const fmtCurr  = (v, sym = '₹') => `${sym} ${fmt(v)}`;
const fmtDate  = (d)    => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const today = () => new Date().toISOString().split('T')[0];

// Auto-generate a cash receipt number: CASH-YYYYMMDD-XXXX
const genCashReceipt = () => {
  const d   = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `CASH-${ymd}-${rnd}`;
};

const PAYMENT_METHODS = [
  { id: 'Cash',          icon: 'payments',               label: 'Cash',         color: '#15803d', bg: '#f0fdf4' },
  // { id: 'Card',          icon: 'credit-card',            label: 'Card',         color: '#0f4c81', bg: '#eff6ff' },
  { id: 'PhonePe',       icon: 'smartphone',             label: 'PhonePe',      color: '#5f259f', bg: '#faf5ff' },
  { id: 'Google Pay',    icon: 'account-balance-wallet', label: 'Google Pay',   color: '#1a73e8', bg: '#eff8ff' },
  { id: 'Paytm',         icon: 'qr-code-2',              label: 'Paytm',        color: '#00b9f5', bg: '#f0fbff' },
  // { id: 'Bank Transfer', icon: 'account-balance',        label: 'Bank Transfer',color: '#b45309', bg: '#fffbeb' },
];

// ─── PDF — demand letter helpers ─────────────────────────────────────────────
let _Print = null, _Sharing = null, _FileSystem = null;
async function loadPrintLibs() {
  if (!_Print)      _Print      = await import('expo-print');
  if (!_Sharing)    _Sharing    = await import('expo-sharing');
  if (!_FileSystem) _FileSystem = await import('expo-file-system');
}
function escH(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtPdf(v) { return isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2); }
function fmtDatePdf(d) {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
const DEMAND_PDF_STYLES = '<style>' +
  '*{margin:0;padding:0;box-sizing:border-box}' +
  'body{font-family:Arial,sans-serif;font-size:9px;color:#0c1a2e;background:#fff}' +
  '.slip{page-break-after:always;padding:20px 22px 14px 22px}.slip:last-child{page-break-after:avoid}' +
  '.lhdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f4c81;padding-bottom:8px;margin-bottom:8px}' +
  '.lhdr h1{font-size:13px;color:#0f4c81;font-weight:800;margin-bottom:3px}' +
  '.lhdr .addr{font-size:7.5px;color:#64748b;line-height:1.6}' +
  '.lhdr .right{text-align:right;font-size:7.5px;color:#64748b;white-space:nowrap}' +
  '.lhdr .right strong{font-size:10px;color:#0f4c81;display:block;margin-bottom:2px}' +
  '.meta-row{display:flex;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px dashed #e2e8f0}' +
  '.meta-item .lbl{font-size:6.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}' +
  '.meta-item .val{font-size:8.5px;font-weight:700;color:#0c1a2e}' +
  '.stu-block{background:#f8fafc;border-radius:4px;padding:7px 10px;margin-bottom:8px;border:1px solid #e2e8f0}' +
  '.stu-name{font-size:11px;font-weight:800;color:#0c1a2e;margin-bottom:3px}' +
  '.stu-badge{display:inline-block;background:#eff6ff;color:#1e40af;border-radius:10px;padding:1px 6px;font-size:7px;font-weight:700;margin-right:4px;margin-top:2px}' +
  '.subj{border-left:3px solid #dc2626;background:#fef2f2;padding:5px 8px;margin-bottom:8px;border-radius:0 3px 3px 0}' +
  '.subj .title{font-size:8.5px;font-weight:800;color:#7f1d1d}.subj .sub{font-size:7.5px;color:#b91c1c;margin-top:1px}' +
  'table{width:100%;border-collapse:collapse;margin-bottom:8px}' +
  'th{background:#0f4c81;color:#fff;padding:5px 7px;font-size:7px;font-weight:700;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'th.r{text-align:right}td{padding:5px 7px;font-size:8px;border-bottom:1px solid #f1f5f9;vertical-align:top}' +
  'td.r{text-align:right;font-weight:700}td.disc{color:#15803d;text-align:right;font-weight:700}' +
  'td.tax-c{color:#1e40af;text-align:right;font-weight:700}td.paid-c{color:#15803d;text-align:right;font-weight:700}' +
  'td.due{color:#b91c1c;text-align:right;font-weight:800}td.late{color:#b45309;text-align:right;font-weight:700}' +
  'tr.tot td{background:#f0f4f8;font-weight:800;border-top:1.5px solid #0f4c81}' +
  'tr.grand td{background:#0f4c81;color:#fff;font-size:9px;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'tr.grand td.r{text-align:right}.fn{font-size:7px;color:#94a3b8;margin-top:2px}' +
  '.sig-row{display:flex;justify-content:space-between;margin-top:14px}' +
  '.sig-box{text-align:center;font-size:7.5px;color:#475569}.sig-line{width:100px;border-top:1px solid #94a3b8;margin:0 auto 3px}' +
  '.para{font-size:8px;color:#334155;line-height:1.7;margin-bottom:6px}' +
  '.slip-footer{text-align:center;font-size:7px;color:#94a3b8;padding-top:6px;margin-top:8px;border-top:1px solid #f1f5f9}' +
  '</style>';
// ─── Demand notice i18n ──────────────────────────────────────────────────────
function getLanguage(courseMedium) {
  const m = String(courseMedium ?? '').toLowerCase().trim();
  if (!m) return 'en';
  if (m.includes('hindi') || m === 'hi') return 'hi';
  if (m.includes('urdu') || m === 'ur' || m.includes('arabic') || m === 'ar') return 'ur';
  return 'en';
}
const DEMAND_STRINGS = {
  en: {
    noticeTitle:     'FEE DEMAND NOTICE',
    academicSession: 'Academic Session',
    classLabel:      'Class',
    branchLabel:     'Branch',
    generated:       'Generated',
    subjectLine:     'Subject: Notice for Payment of Outstanding Fee',
    totalOutstanding:'Total Outstanding Amount',
    dearParent:      (n) => `Dear Parent / Guardian of <strong>${n}</strong>,`,
    bodyPara:        (s) => `This is to bring to your kind notice that the following fee amount is outstanding against the above-mentioned student for the academic session <strong>${s}</strong>. You are requested to clear the dues at the earliest to avoid any late charges or disruption to academic services.`,
    feeItem:         'Fee Item',      feeAmount:  'Fee Amount',
    discount:        'Discount',      netPayable: 'Net Payable',
    gstTax:          'GST / Tax',     lateFee:    'Late Fee',
    paid:            'Paid',          balanceDue: 'Balance Due',
    subTotal:        'Sub-Total',
    totalBalanceDue: '&#9654; Total Outstanding Balance Due',
    parentSig:       'Parent / Guardian Signature',
    accountsSig:     'Accounts Office Seal &amp; Signature',
    footerNote:      'System-generated demand notice',
    waTitle:         '📢 Fee Demand Notice',
    waFrom:          (school) => `From: ${school}`,
    waGreeting:      'Dear Parent/Guardian,',
    waBody:          (name, id) => `This is a reminder that the following fees are outstanding for *${name ?? id}* (Enrollment: ${id}):`,
    waTotal:         (sym, amt) => `*Total Due: ${sym} ${amt}*`,
    waUrgency:       'Please clear the dues at the earliest to avoid any late charges.',
    waContact:       'For any queries, contact the school accounts office.',
    waPhone:         (ph) => `📞 ${ph}`,
  },
  hi: {
    noticeTitle:     'शुल्क मांग सूचना',
    academicSession: 'शैक्षणिक सत्र',
    classLabel:      'कक्षा',
    branchLabel:     'शाखा',
    generated:       'उत्पन्न',
    subjectLine:     'विषय: बकाया शुल्क भुगतान की सूचना',
    totalOutstanding:'कुल बकाया राशि',
    dearParent:      (n) => `प्रिय अभिभावक / संरक्षक, <strong>${n}</strong> के माता-पिता,`,
    bodyPara:        (s) => `आपके संज्ञान में लाया जाता है कि उपरोक्त छात्र/छात्रा के लिए शैक्षणिक सत्र <strong>${s}</strong> हेतु निम्नलिखित शुल्क बकाया है। कृपया शीघ्र भुगतान करें ताकि किसी विलंब शुल्क या शैक्षणिक सेवाओं में व्यवधान से बचा जा सके।`,
    feeItem:         'शुल्क मद',     feeAmount:  'शुल्क राशि',
    discount:        'छूट',           netPayable: 'देय राशि',
    gstTax:          'जीएसटी / कर', lateFee:    'विलंब शुल्क',
    paid:            'भुगतान',        balanceDue: 'बकाया राशि',
    subTotal:        'उप-योग',
    totalBalanceDue: '&#9654; कुल बकाया शेष',
    parentSig:       'अभिभावक के हस्ताक्षर',
    accountsSig:     'लेखा कार्यालय मोहर एवं हस्ताक्षर',
    footerNote:      'सिस्टम-जनित मांग सूचना',
    waTitle:         '📢 शुल्क मांग सूचना',
    waFrom:          (school) => `प्रेषक: ${school}`,
    waGreeting:      'प्रिय अभिभावक,',
    waBody:          (name, id) => `यह स्मरण कराया जाता है कि *${name ?? id}* (नामांकन: ${id}) के निम्नलिखित शुल्क बकाया हैं:`,
    waTotal:         (sym, amt) => `*कुल बकाया: ${sym} ${amt}*`,
    waUrgency:       'कृपया शीघ्र भुगतान करें ताकि विलंब शुल्क से बचा जा सके।',
    waContact:       'किसी भी जानकारी के लिए विद्यालय के लेखा कार्यालय से संपर्क करें।',
    waPhone:         (ph) => `📞 ${ph}`,
  },
  ur: {
    noticeTitle:     'فیس طلب نوٹس',
    academicSession: 'تعلیمی سیشن',
    classLabel:      'جماعت',
    branchLabel:     'شاخہ',
    generated:       'تاریخ اجراء',
    subjectLine:     'موضوع: واجب الادا فیس کی ادائیگی کا نوٹس',
    totalOutstanding:'کل واجب الادا رقم',
    dearParent:      (n) => `محترم والدین / سرپرست، <strong>${n}</strong>،`,
    bodyPara:        (s) => `آپ کے علم میں لایا جاتا ہے کہ مذکورہ طالب علم کے تعلیمی سیشن <strong>${s}</strong> کی درج ذیل فیس واجب الادا ہے۔ براہ کرم جلد از جلد ادائیگی کریں تاکہ تاخیری جرمانے یا تعلیمی خدمات میں رکاوٹ سے بچا جا سکے۔`,
    feeItem:         'فیس مد',        feeAmount:  'فیس رقم',
    discount:        'رعایت',          netPayable: 'قابل ادائیگی',
    gstTax:          'جی ایس ٹی / ٹیکس', lateFee: 'تاخیری جرمانہ',
    paid:            'ادا شدہ',        balanceDue: 'بقایا رقم',
    subTotal:        'ذیلی مجموعہ',
    totalBalanceDue: '&#9654; کل واجب الادا بقایا',
    parentSig:       'والدین / سرپرست کے دستخط',
    accountsSig:     'اکاؤنٹس آفس مہر و دستخط',
    footerNote:      'سسٹم سے تیار کردہ طلب نوٹس',
    waTitle:         '📢 فیس طلب نوٹس',
    waFrom:          (school) => `از طرف: ${school}`,
    waGreeting:      'محترم والدین / سرپرست،',
    waBody:          (name, id) => `یہ یاد دہانی کرائی جاتی ہے کہ *${name ?? id}* (داخلہ نمبر: ${id}) کی درج ذیل فیس واجب الادا ہے:`,
    waTotal:         (sym, amt) => `*کل بقایا: ${sym} ${amt}*`,
    waUrgency:       'براہ کرم جلد ادائیگی کریں تاکہ تاخیری جرمانے سے بچا جا سکے۔',
    waContact:       'مزید معلومات کے لیے اسکول کے اکاؤنٹس آفس سے رابطہ کریں۔',
    waPhone:         (ph) => `📞 ${ph}`,
  },
};

function buildDemandSlipHtml(stu, meta, lang = 'en') {
  const t = DEMAND_STRINGS[lang] ?? DEMAND_STRINGS.en;
  const dir = lang === 'ur' ? ' dir="rtl"' : '';
  const { className, sessionName, branchName, schoolName, address, city, state, zip, email, phone, logo, currSym = '₹' } = meta;
  const logoHtml = logo
    ? `<img src="${logo}" style="width:56px;height:56px;object-fit:contain;flex-shrink:0;"/>`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#0f4c81;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;flex-shrink:0;">${escH((schoolName ?? 'S')[0])}</div>`;
  const dueItems = (stu.fee_items ?? []).filter(fi => parseFloat(fi.balance_due ?? 0) > 0);
  if (!dueItems.length) return null;
  const totalDue=dueItems.reduce((s,f)=>s+parseFloat(f.balance_due??0),0);
  const totalPaid=dueItems.reduce((s,f)=>s+parseFloat(f.previously_paid??0),0);
  const totalFee=dueItems.reduce((s,f)=>s+parseFloat(f.fee_amount??0),0);
  const totalLate=dueItems.reduce((s,f)=>s+parseFloat(f.late_fee??0),0);
  const hasDisc=dueItems.some(fi=>parseFloat(fi.discount_amount??0)>0);
  const hasTax=dueItems.some(fi=>parseFloat(fi.tax_amount??0)>0);
  const hasLate=dueItems.some(fi=>parseFloat(fi.late_fee??0)>0);
  const hasPaid=totalPaid>0;
  const totalDisc=hasDisc?dueItems.reduce((s,f)=>s+parseFloat(f.discount_amount??0),0):0;
  const totalTax=hasTax?dueItems.reduce((s,f)=>s+parseFloat(f.tax_amount??0),0):0;
  const totalNetBase=dueItems.reduce((s,f)=>s+parseFloat(f.net_fee_amount??f.fee_amount??0),0);
  const netTot=totalNetBase+totalTax;
  const addr=[address,city,state,zip].filter(Boolean).join(', ');
  const contact=[phone?`Ph: ${phone}`:'',email?`Email: ${email}`:''].filter(Boolean).join('  ·  ');
  const genOn=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const genDate=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  const refNo=`FDS-${escH(String(stu.enrollment_id))}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
  let html=`<div class="lhdr"><div style="display:flex;align-items:center;gap:10px;">${logoHtml}<div><h1>${escH(schoolName)}</h1>${addr?`<div class="addr">${escH(addr)}</div>`:''} ${contact?`<div class="addr">${escH(contact)}</div>`:''}</div></div><div class="right"><strong>${t.noticeTitle}</strong>Date: ${escH(genDate)}<br/>Ref: ${escH(refNo)}</div></div>`;
  html+=`<div class="meta-row"><div class="meta-item"><div class="lbl">${t.academicSession}</div><div class="val">${escH(sessionName)}</div></div><div class="meta-item"><div class="lbl">${t.classLabel}</div><div class="val">${escH(className)}</div></div>${branchName?`<div class="meta-item"><div class="lbl">${t.branchLabel}</div><div class="val">${escH(branchName)}</div></div>`:''}<div class="meta-item" style="text-align:right"><div class="lbl">${t.generated}</div><div class="val">${escH(genOn)}</div></div></div>`;
  html+=`<div class="stu-block"><div class="stu-name">${escH(stu.student_name??'')}</div><div style="margin-top:4px"><span class="stu-badge">Enr # ${escH(String(stu.enrollment_id))}</span>${stu.registration_id?`<span class="stu-badge">Reg # ${escH(String(stu.registration_id))}</span>`:''}</div></div>`;
  html+=`<div class="subj"><div class="title">${t.subjectLine} &mdash; ${escH(sessionName)}</div><div class="sub">${t.totalOutstanding}: ${currSym} ${fmtPdf(totalDue)}</div></div>`;
  html+=`<p class="para">${t.dearParent(escH(stu.student_name??''))}</p><p class="para">${t.bodyPara(escH(sessionName))}</p>`;
  const discTh=hasDisc?`<th class="r">${t.discount}</th>`:'';
  const taxTh=hasTax?`<th class="r">${t.gstTax}</th>`:'';
  const lateTh=hasLate?`<th class="r">${t.lateFee}</th>`:'';
  const paidTh=hasPaid?`<th class="r">${t.paid}</th>`:'';
  html+=`<table><thead><tr><th>${t.feeItem}</th><th class="r">${t.feeAmount}</th>${discTh}<th class="r">${t.netPayable}</th>${taxTh}${paidTh}${lateTh}<th class="r">${t.balanceDue}</th></tr></thead><tbody>`;
  dueItems.forEach(fi=>{
    const mn=fi.month_no?` <span style="color:#94a3b8">(${escH(fi.month_no)})</span>`:'';
    const dd=fi.due_date?`<div class="fn" style="color:#b91c1c">Due: ${fmtDatePdf(fi.due_date)}</div>`:'';
    const disc=parseFloat(fi.discount_amount??0),tax=parseFloat(fi.tax_amount??0);
    const late=parseFloat(fi.late_fee??0),paid=parseFloat(fi.previously_paid??0);
    const net=parseFloat(fi.net_payable??fi.net_fee_amount??fi.fee_amount??0);
    const dc=hasDisc?(disc>0?`<td class="disc">&minus;${currSym} ${fmtPdf(disc)}<div class="fn">(${parseFloat(fi.discount_percent??0).toFixed(1)}%)</div></td>`:'<td class="r" style="color:#94a3b8">&mdash;</td>'):'';
    const tc=hasTax?(tax>0?`<td class="tax-c">+${currSym} ${fmtPdf(tax)}<div class="fn">(${parseFloat(fi.tax_percent??0).toFixed(1)}%)</div></td>`:'<td class="r" style="color:#94a3b8">&mdash;</td>'):'';
    const lc=hasLate?(late>0?`<td class="late">+${currSym} ${fmtPdf(late)}</td>`:'<td class="r" style="color:#94a3b8">&mdash;</td>'):'';
    const pc=hasPaid?(paid>0?`<td class="paid-c">${currSym} ${fmtPdf(paid)}</td>`:'<td class="r" style="color:#94a3b8">&mdash;</td>'):'';
    html+=`<tr><td>${escH(fi.fee_item_name??'—')}${mn}${dd}</td><td class="r">${currSym} ${fmtPdf(fi.fee_amount)}</td>${dc}<td class="r">${currSym} ${fmtPdf(net)}</td>${tc}${pc}${lc}<td class="due">${currSym} ${fmtPdf(fi.balance_due)}</td></tr>`;
  });
  const dtc=hasDisc?`<td class="disc">&minus;${currSym} ${fmtPdf(totalDisc)}</td>`:'';
  const ttc=hasTax?`<td class="tax-c">+${currSym} ${fmtPdf(totalTax)}</td>`:'';
  const ltc=hasLate?`<td class="late">+${currSym} ${fmtPdf(totalLate)}</td>`:'';
  const ptc=hasPaid?`<td class="paid-c">${currSym} ${fmtPdf(totalPaid)}</td>`:'';
  const gc=2+(hasDisc?1:0)+(hasTax?1:0)+(hasPaid?1:0)+(hasLate?1:0);
  html+=`<tr class="tot"><td><strong>${t.subTotal}</strong></td><td class="r">${currSym} ${fmtPdf(totalFee)}</td>${dtc}<td class="r">${currSym} ${fmtPdf(netTot)}</td>${ttc}${ptc}${ltc}<td class="due">${currSym} ${fmtPdf(totalDue)}</td></tr><tr class="grand"><td colspan="${gc}">${t.totalBalanceDue}</td><td class="r" colspan="2" style="font-size:10px">${currSym} ${fmtPdf(totalDue)}</td></tr></tbody></table>`;
  html+=`<div class="sig-row"><div class="sig-box"><div class="sig-line"></div>${t.parentSig}</div><div class="sig-box"><div class="sig-line"></div>${t.accountsSig}</div></div>`;
  const footer=`<div class="slip-footer">${t.footerNote} &bull; ${escH(schoolName)} &bull; Enr # ${escH(String(stu.enrollment_id))}</div>`;
  return `<!DOCTYPE html><html lang="${lang}"${dir}><head><meta charset="UTF-8"/>${DEMAND_PDF_STYLES}</head><body><div class="slip">${html}${footer}</div></body></html>`;
}

const REVIEW_STYLE = {
  Approved:       { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' },
  Rejected:       { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' },
  'Under Review': { bg: '#fef9c3', text: '#a16207', border: '#fef08a' },
  Pending:        { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
};
const rs = (s) => REVIEW_STYLE[s] ?? REVIEW_STYLE.Pending;

// ─── Cart reducer ─────────────────────────────────────────────────────────────
const cartReducer = (state, action) => {
  switch (action.type) {
    case 'TOGGLE': {
      const id = action.id;
      return state.includes(id) ? state.filter(x => x !== id) : [...state, id];
    }
    case 'SELECT_ALL':  return action.ids;
    case 'CLEAR':       return [];
    default:            return state;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
export default function StudentFeeScreen({ route, navigation }) {
  // Accept both camelCase (from EnrolledStudentsScreen) and snake_case param names
  const params = route?.params ?? {};
  const enrollment_id   = params.enrollmentId   ?? params.enrollment_id;
  const registration_id = params.registrationId ?? params.registration_id;
  const student_name    = params.studentsName   ?? params.student_name;
  const class_id        = params.classId        ?? params.class_id;
  const session_id      = params.sessionId      ?? params.session_id;
  const branch_id       = params.branchId       ?? params.branch_id;
  const ssms_client_code = params.ssmsClientCode ?? params.ssms_client_code;
  // mobile_number is fetched from the API response (ssms_student_registration via enrollment)
  // The route param is kept as fallback for screens that already pass it
  const routeMobile = params.mobileNumber ?? params.mobile_number ?? '';

  const { user, logout } = useContext(AuthContext);

  // Admin, owner and accountant roles can collect/submit fee payments
  const canCollect = useMemo(() =>
    ['admin', 'owner', 'accountant'].includes((user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim()),
  [user]);

  // Data
  const [dueItems,     setDueItems]    = useState([]);   // joined fee_structure rows with balance
  const [paidRecords,  setPaidRecords] = useState([]);   // ssms_fee_paid_details rows (fully/partially paid)
  const [schoolDetails,  setSchoolDetails] = useState({});
  // mobile_number fetched from API (ssms_student_registration); route param used as initial fallback
  const [mobileNumber, setMobileNumber] = useState(routeMobile);
  // course_medium fetched from API — drives demand letter / WhatsApp language
  const [courseMedium, setCourseMedium] = useState('');
  // Currency symbol from school settings — fallback to ₹ if not set
  const currSym = schoolDetails?.currency?.trim() || '₹';
  const [loading,      setLoading]     = useState(true);
  const [refreshing,   setRefreshing]  = useState(false);

  // Cart
  const [selected, dispatch] = useReducer(cartReducer, []);

  // Late fee overrides — keyed by fee_id, allows manual entry per due item.
  // Pre-populated from API value (item.late_fee); user can edit before paying.
  const [lateFeeOverrides, setLateFeeOverrides] = useState({});

  const getLateFee = useCallback((item) => {
    // Late fee only applies to overdue items
    const isOverdue = item.due_date && new Date(item.due_date) < new Date();
    if (!isOverdue) return 0;
    const override = lateFeeOverrides[item.fee_id];
    return override !== undefined ? (parseFloat(override) || 0) : (parseFloat(item.late_fee) || 0);
  }, [lateFeeOverrides]);

  const setLateFee = useCallback((feeId, val) => {
    setLateFeeOverrides(prev => ({ ...prev, [feeId]: val }));
  }, []);

  // Payment form
  const [paidInput,      setPaidInput]    = useState('');
  const [receiptInput,   setReceiptInput] = useState('');
  const [paymentDate,    setPaymentDate]  = useState(today());
  const [paymentMethod,  setPaymentMethod]= useState('Cash');
  const [submitting,     setSubmitting]   = useState(false);

  // UPI / QR modal
  const [qrModal,        setQrModal]      = useState(false);

    // Receipt detail modal
  const [receiptModal,  setReceiptModal] = useState(false);
  const [receiptRecord, setReceiptRecord]= useState(null);

  // Email receipt modal
  const [emailModal,   setEmailModal]  = useState(false);
  const [emailRecord,  setEmailRecord] = useState(null);
  const [emailAddr,    setEmailAddr]   = useState('');
  const [demandLoading, setDemandLoading] = useState(false);

  // ── Generate Demand Letter ────────────────────────────────────────────
  const generateDemandLetter = useCallback(async () => {
    if (!dueItems.length) {
      Alert.alert('No Due Fees', 'No outstanding dues to generate a demand letter for.');
      return;
    }
    try {
      setDemandLoading(true);
      await loadPrintLibs();
      // Download school logo as base64 for PDF embedding
      let logoBase64 = null;
      const logoName = schoolDetails?.logo_name ?? '';
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
        } catch (_) { /* fall back to initials */ }
      }
      const firstDue = dueItems[0] ?? {};
      const meta = {
        schoolName:  schoolDetails?.ssms_client_header_text ?? '',
        address:     schoolDetails?.ssms_client_address ?? '',
        city:        schoolDetails?.ssms_client_city    ?? '',
        state:       schoolDetails?.ssms_client_state   ?? '',
        zip:         schoolDetails?.ssms_client_zip     ?? '',
        email:       schoolDetails?.ssms_client_email   ?? '',
        phone:       schoolDetails?.ssms_client_phone   ?? '',
        logo:        logoBase64,
        className:   firstDue.class_name   ?? route?.params?.className ?? String(class_id ?? ''),
        sessionName: firstDue.session_name ?? String(session_id ?? ''),
        branchName:  firstDue.branch_name  ?? String(branch_id  ?? ''),
        currSym:     schoolDetails?.currency?.trim() || '₹',
      };
      const stu = { enrollment_id: enrollment_id, registration_id: registration_id,
                    student_name: student_name, fee_items: dueItems };
      const lang = getLanguage(courseMedium);
      const html = buildDemandSlipHtml(stu, meta, lang);
      if (!html) { Alert.alert('No Due Fees', 'No items to include.'); return; }
      const { uri } = await _Print.printToFileAsync({ html, width: 595, height: 842, base64: false });
      const canShare = await _Sharing.isAvailableAsync();
      if (canShare) {
        await _Sharing.shareAsync(uri, { mimeType: 'application/pdf',
          dialogTitle: `Demand_${String(student_name ?? '').replace(/\s+/g,'_')}.pdf`, UTI: 'com.adobe.pdf' });
      } else { Alert.alert('PDF Ready', `Saved to:\n${uri}`); }
    } catch (e) { Alert.alert('Error', e.message ?? 'Failed to generate demand letter'); }
    finally { setDemandLoading(false); }
  }, [dueItems, schoolDetails, enrollment_id, registration_id, student_name,
      class_id, session_id, branch_id, route?.params?.className, courseMedium]);
  // ── Send WhatsApp Demand Notice ──────────────────────────────────────────────
  const sendWhatsAppDemandNotice = useCallback(() => {
    if (!dueItems.length) {
      Alert.alert('No Due Fees', 'No outstanding dues to notify about.');
      return;
    }
    const phone = String(mobileNumber ?? '').replace(/\D/g, '');
    if (!phone) {
      Alert.alert('No Phone Number', 'Parent/guardian mobile number is not available for this student.');
      return;
    }
    const schoolName = schoolDetails?.ssms_client_header_text ?? 'School';
    const schoolPhone = String(schoolDetails?.ssms_client_phone ?? '').trim();
    const lang = getLanguage(courseMedium);
    const t = DEMAND_STRINGS[lang] ?? DEMAND_STRINGS.en;
    const lines = dueItems.map(i =>
      `• ${i.fee_item_name} (${i.month_no ?? '—'}): ${currSym} ${parseFloat(i.balance_due ?? i.fee_amount ?? 0).toFixed(2)}`
    ).join('\n');
    const total = dueItems.reduce((s, i) => s + parseFloat(i.balance_due ?? i.fee_amount ?? 0), 0);
    const message =
      `*${t.waTitle}*\n` +
      `${t.waFrom(schoolName)}\n\n` +
      `${t.waGreeting}\n` +
      `${t.waBody(student_name, enrollment_id)}\n\n` +
      `${lines}\n\n` +
      `${t.waTotal(currSym, total.toFixed(2))}\n\n` +
      `${t.waUrgency}\n` +
      `${t.waContact}` +
      (schoolPhone ? `\n${t.waPhone(schoolPhone)}` : '');
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    Linking.openURL(waUrl).catch(() =>
      Alert.alert('WhatsApp Not Found', 'Please ensure WhatsApp is installed on this device.')
    );
  }, [dueItems, mobileNumber, schoolDetails, student_name, enrollment_id, currSym, courseMedium]);

  const [sendingEmail, setSendingEmail]= useState(false);

  // Shake animation for validation
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // isCash drives receipt field behaviour
  const isCash = paymentMethod === 'Cash';

  // When method switches TO Cash → auto-generate receipt number
  // When method switches AWAY from Cash → clear so user must enter their ref
  React.useEffect(() => {
    if (isCash) {
      setReceiptInput(genCashReceipt());
    } else {
      setReceiptInput('');
    }
  }, [paymentMethod]);

  // ── Derived cart totals ────────────────────────────────────────────────────
  const selectedItems = useMemo(
    () => dueItems.filter(i => selected.includes(i.fee_id)),
    [dueItems, selected],
  );

  // net_fee_amount = fee_amount - discount_amount (from backend)
  // If no discount, net_fee_amount = fee_amount = balance_due
  const getNetFee = useCallback((item) =>
    parseFloat(item.balance_due ?? item.fee_amount ?? 0),
  []);

  const cartTotal = useMemo(
    () => selectedItems.reduce((s, i) => s + getNetFee(i) + getLateFee(i), 0),
    [selectedItems, getLateFee, getNetFee],
  );

  const cartLateFeeTotal = useMemo(
    () => selectedItems.reduce((s, i) => s + getLateFee(i), 0),
    [selectedItems, getLateFee],
  );

  const cartTaxTotal = useMemo(
    () => selectedItems.reduce((s, i) => s + parseFloat(i.tax_amount ?? 0), 0),
    [selectedItems],
  );

  const paidAmt   = parseFloat(paidInput) || 0;
  const balanceAmt = Math.max(0, cartTotal - paidAmt);
  const overpaid   = paidAmt > cartTotal && cartTotal > 0;

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!enrollment_id) return;
    try {
      if (!silent) setLoading(true);
      let res;
      try {
        res = await fetchStudentFeeData(enrollment_id,  {
          class_id, session_id, branch_id, ssms_client_code, category: 'Academic',
        }, user);
      } catch (e) {
        if (e.message.includes('Session expired') || e.message.includes('SESSION_EXPIRED')) {
          logout();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        throw e;
      }
      const dueData = res.due ?? [];
      setDueItems(dueData);
      setPaidRecords(res.paid ?? []);

      const schoolData = res.schoolDetails ?? {};
      setSchoolDetails(schoolData);

      // Use mobile_number from API (authoritative); fall back to route param
      if (res.mobile_number) setMobileNumber(String(res.mobile_number));
      // course_medium drives demand letter / WhatsApp language
      // eslint-disable-next-line no-console
      console.warn('[FeeScreen] course_medium from API:', res.course_medium, '→ lang:', getLanguage(res.course_medium ?? ''));
      if (res.course_medium) setCourseMedium(String(res.course_medium));
      // Pre-populate late fee overrides from API values

      const initOverrides = {};
      dueData.forEach(i => {
        if (parseFloat(i.late_fee) > 0) initOverrides[i.fee_id] = String(i.late_fee);
      });
      setLateFeeOverrides(initOverrides);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Failed to load fee data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enrollment_id, class_id, session_id, branch_id, ssms_client_code, user]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(true); };

  // ── Summary across all due items ───────────────────────────────────────────
  const totalDue  = useMemo(() => dueItems.reduce((s, i) =>
    s + parseFloat(i.balance_due ?? i.fee_amount ?? 0)
      + parseFloat(i.late_fee ?? 0),
  0), [dueItems]);
  const totalPaid = useMemo(() => paidRecords.reduce((s, r) => s + parseFloat(r.total_collected ?? r.total_paid ?? r.paid_amount ?? 0), 0), [paidRecords]);

  // UPI config — update these for your school
  const UPI_ID        = schoolDetails?.upi_id        ?? '';  //'9801198648@ybl';
  const MERCHANT_NAME = schoolDetails?.pay_account_nam ?? '';
  // ── Submit payment ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (selected.length === 0) {
      Alert.alert('Select Items', 'Please select at least one fee item to pay.'); return;
    }
    if (!isCash && !receiptInput.trim()) {
      shake();
      Alert.alert('Reference Required', `Please enter the ${paymentMethod} transaction / reference number.`); return;
    }
    if (paidAmt <= 0) {
      shake();
      Alert.alert('Amount Required', 'Please enter a valid payment amount.'); return;
    }
    if (overpaid) {
      Alert.alert('Overpayment', `Paid amount cannot exceed the selected total of ${fmtCurr(cartTotal, currSym)}.`); return;
    }

    try {
      setSubmitting(true);
      await submitPayment({
        enrollment_id: enrollment_id,
        registration_id: route?.params?.registrationId,
        selected_fee_items: selectedItems.map(i => ({
          fee_item_id:      i.fee_item_id,
          fee_id:           i.fee_id,
          fee_amount:       i.fee_amount,
          net_fee_amount:   i.net_fee_amount ?? i.fee_amount,
          discount_amount:  i.discount_amount  ?? 0,
          discount_percent: i.discount_percent ?? 0,
          discount_reason:  i.discount_reason  ?? '',
          tax_percent:      i.tax_percent  ?? 0,
          tax_amount:       i.tax_amount   ?? 0,
          balance_due:      i.balance_due ?? i.fee_amount,
          late_fee:         getLateFee(i),
          class_id:         i.class_id,
          session_id:       i.session_id,
          branch_id:        i.branch_id,
          ssms_user_name:   user?.ssmsUserName || '',
          ssms_client_code: user?.ssmsClientCode || '',
          trxn_id:          i.trxn_id,
          existing_trxn:    i.trxn_id ?? null,
          existing_receipt: i.receipt_number ?? null,
        })),
        receipt_number:   receiptInput.trim(),
        fee_paid_amount:      paidAmt,
        balance_amount:   balanceAmt,
        payment_date:     paymentDate,
        fee_paid_date:    paymentDate,
        payment_method:   paymentMethod,
        admin_user:       user?.ssmsUserName ?? user?.ssms_user_name ?? '',
        class_id,
        session_id,
        branch_id,
        ssms_client_code,
        ssms_user_name:   student_name ?? '',
        // These two fields are used by payStudentFees() to auto-send
        // the receipt email immediately after saving — no separate call needed
        student_name:     student_name ?? '',
        email_address:    route?.params?.email_address ?? '',
      }, user);

      // Reset form
      dispatch({ type: 'CLEAR' });
      setPaidInput('');
      setReceiptInput(genCashReceipt());   // pre-fill for next cash payment
      setPaymentDate(today());
      setPaymentMethod('Cash');
      load(true);
      Alert.alert('Payment Recorded', `Receipt #${receiptInput.trim()} saved successfully.`);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Payment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const openReceipt = (rec) => { setReceiptRecord(rec); setReceiptModal(true); };

  const openEmailModal = useCallback((rec) => {
    setEmailRecord(rec);
    setEmailAddr('');
    setEmailModal(true);
  }, []);

  const handleSendEmail = useCallback(async () => {
    const addr = emailAddr.trim();
    if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.'); return;
    }
    try {
      setSendingEmail(true);
      // Build fee_items array from the grouped receipt's items[]
      const feeItems = (emailRecord?.items ?? []).map(item => ({
        fee_item_name:    item.fee_item_name,
        fee_amount:       item.fee_amount,
        discount_percent: item.discount_percent ?? 0,
        discount_amount:  item.discount_amount  ?? 0,
        tax_percent:      item.tax_percent      ?? 0,
        tax_amount:       item.tax_amount       ?? 0,
        net_fee_amount:   item.net_fee_amount   ?? item.fee_amount,
        paid_amount:      item.paid_amount      ?? 0,
        balance_amount:   item.balance_amount,
        late_fee:         item.late_fee         ?? 0,
        month_no:         item.month_no         ?? '',
      }));
      await sendReceiptEmail({
        email:          addr,
        receipt_number: emailRecord?.receipt_number,
        student_name:   student_name ?? '',
        enrollment_id:  enrollment_id ?? enrollment_id,
        // Receipt-level totals
        paid_amount:    emailRecord?.total_paid    ?? 0,
        balance_amount: emailRecord?.total_balance ?? 0,
        fee_amount:     emailRecord?.total_fee     ?? 0,
        totalLateFee:   emailRecord?.total_late_fee ?? 0,
        totalTax:       feeItems.reduce((s, i) => s + (i.tax_amount      ?? 0), 0),
        totalDiscount:  feeItems.reduce((s, i) => s + (i.discount_amount ?? 0), 0),
        payment_date:   emailRecord?.payment_date,
        fee_paid_date:  emailRecord?.fee_paid_date,
        payment_method: emailRecord?.payment_method ?? 'Cash',
        admin_user:     emailRecord?.admin_user     ?? '',
        // Full items breakdown for the email table
        fee_items: feeItems,
      }, user);
      setEmailModal(false);
      Alert.alert('Sent ✓', `Receipt emailed to ${addr} successfully.`);
    } catch (e) {
      Alert.alert('Failed', e.message ?? 'Could not send email. Please try again.');
    } finally {
      setSendingEmail(false);
    }
  }, [emailAddr, emailRecord, student_name, enrollment_id, route, user]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.root}>
        <NavBar title={student_name ?? 'Student Fees'} sub={`Enrollment #${enrollment_id}`} onBack={() => navigation?.goBack()} />
        <View style={s.loaderWrap}>
          <ActivityIndicator size="large" color="#0f4c81" />
          <Text style={s.loaderText}>Loading fee data…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
     
      

      <ScrollView

        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0f4c81']} tintColor="#0f4c81" />}
      >
        {/* ── Student info card ───────────────────────────────────────────────── */}
      <StudentInfoCard
        studentsName={route?.params?.studentsName}
        enrollmentId={enrollment_id}
        className={route?.params?.className}
        totalDue={totalDue}
        totalPaid={totalPaid}
        currSym={currSym}
        onDemandLetter={generateDemandLetter}
        demandLoading={demandLoading}
        onWhatsApp={canCollect && totalDue > 0 ? sendWhatsAppDemandNotice : null}
        hasPhone={!!String(mobileNumber ?? '').replace(/\D/g, '')}
      />
       <View style={si.separator}></View>
        {/* Summary banner removed — financials now live in StudentInfoCard above */}

        {/* ═══════════════════════════════════════════════════════════════════
            DUE FEES — selectable cart rows
        ════════════════════════════════════════════════════════════════════ */}
        <View style={s.sectionHeader}>
          <View style={s.sectionHeaderLeft}>
            <View style={[s.sectionDot, { backgroundColor: '#b91c1c' }]} />
            <Text style={s.sectionTitle}>Due Payments</Text>
            {dueItems.length > 0 && (
              <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{dueItems.length}</Text></View>
            )}
          </View>
          {dueItems.length > 0 && (
            <TouchableOpacity
              onPress={() =>
                selected.length === dueItems.length
                  ? dispatch({ type: 'CLEAR' })
                  : dispatch({ type: 'SELECT_ALL', ids: dueItems.map(i => i.fee_id) })
              }
            >
              <Text style={s.selectAllText}>
                {selected.length === dueItems.length ? 'Deselect all' : 'Select all'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {dueItems.length === 0 ? (
          <View style={s.emptyDue}>
            <MaterialIcons name="celebration" size={36} color="#15803d" />
            <Text style={s.emptyDueText}>No outstanding fees — all clear!</Text>
          </View>
        ) : (
          dueItems.map((item) => {
            const checked = selected.includes(item.fee_id);
            const overdue = item.due_date && new Date(item.due_date) < new Date();
            return (
              <TouchableOpacity
                key={item.fee_id}
                activeOpacity={0.85}
                onPress={() => dispatch({ type: 'TOGGLE', id: item.fee_id })}
              >
                <View style={[s.dueCard, checked && s.dueCardSelected]}>
                  {/* Checkbox */}
                  <View style={[s.checkbox, checked && s.checkboxChecked]}>
                    {checked && <MaterialIcons name="check" size={14} color="#fff" />}
                  </View>

                  {/* Content */}
                  <View style={s.dueCardContent}>
                    <View style={s.dueCardTopRow}>
                      <Text style={s.dueItemName} numberOfLines={1}>
                        {item.fee_item_name} ({item.month_no})
                        {/* {item.fee_name ? `  ·  ${item.fee_name}` : ''} */}
                      </Text>
                      {overdue && (
                        <View style={s.overdueBadge}>
                          <MaterialIcons name="warning" size={10} color="#b45309" />
                          <Text style={s.overdueBadgeText}>Overdue</Text>
                        </View>
                      )}
                    </View>

                    <View style={s.dueCardMetaRow}>
                      <MetaTag icon="event" label={`Due ${fmtDate(item.due_date)}`} />
                      <MetaTag icon="class" label={`Class: ${item.class_name ?? '—'}`} />
                      {item.late_fee > 0 && (
                        <MetaTag icon="timer" label={`Late ${currSym}${fmt(item.late_fee)}`} warn />
                      )}
                    </View>

                    {/* Late fee row — appears only when item is selected AND overdue */}
                    {checked && overdue && (
                      <View style={s.lateFeeRow}>
                        <MaterialIcons name="timer" size={14} color="#b45309" />
                        <Text style={s.lateFeeLabel}>Late Fee:</Text>
                        <View style={s.lateFeeInputWrap}>
                          <Text style={s.lateFeeRupee}>{currSym}</Text>
                          <TextInput
                            style={s.lateFeeInput}
                            placeholder="0.00"
                            placeholderTextColor="#94a3b8"
                            value={lateFeeOverrides[item.fee_id] ?? (parseFloat(item.late_fee) > 0 ? String(item.late_fee) : '')}
                            onChangeText={val => setLateFee(item.fee_id, val)}
                            keyboardType="decimal-pad"
                          />
                        </View>
                        {getLateFee(item) > 0 && (
                          <TouchableOpacity onPress={() => setLateFee(item.fee_id, '0')} style={s.lateFeeClear}>
                            <MaterialIcons name="close" size={14} color="#b45309" />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Discount badge — 2 lines */}
                    {parseFloat(item.discount_amount) > 0 && (() => {
                      const discountedBase = parseFloat(item.fee_amount) - parseFloat(item.discount_amount);
                      return (
                        <View style={s.discountRow}>
                          {/* Line 1: icon + label */}
                          <View style={s.discountLine1}>
                            <MaterialIcons name="local-offer" size={12} color="#16a34a" />
                            <Text style={s.discountTxt}>
                              {fmt(item.discount_percent)}% discount applied
                            </Text>
                          </View>
                          {/* Line 2: original ~~strike~~ − amount = net */}
                          <View style={s.discountLine2}>
                            <Text style={s.discountStrike}>{fmtCurr(item.fee_amount, currSym)}</Text>
                            <Text style={s.discountSaved}>−{fmtCurr(item.discount_amount, currSym)}</Text>
                            <Text style={s.discountNet}>{fmtCurr(discountedBase, currSym)}</Text>
                          </View>
                        </View>
                      );
                    })()}

                    {/* Remaining Fee row — only for partial payments */}
                    {(() => {
                      const priorPaid = parseFloat(item.total_fee_paid ?? item.previously_paid ?? 0);
                      const taxAmt    = parseFloat(item.tax_amount ?? 0);
                      const balDue    = parseFloat(item.balance_due ?? item.fee_amount ?? 0);
                      const remBase   = parseFloat((balDue - taxAmt).toFixed(2));
                      if (priorPaid <= 0 || remBase <= 0) return null;
                      return (
                        <View style={s.infoRow}>
                          <MaterialIcons name="payments" size={12} color="#0369a1" />
                          <Text style={[s.infoRowTxt, { color: '#0369a1' }]}>Remaining Fee</Text>
                          <View style={{ flex: 1 }} />
                          <Text style={[s.infoRowAmt, { color: '#0369a1' }]}>+{fmtCurr(remBase, currSym)}</Text>
                        </View>
                      );
                    })()}

                    {/* Tax badge — prorated for partial payments */}
                    {parseFloat(item.tax_amount ?? 0) > 0 && (
                      <View style={s.infoRow}>
                        <MaterialIcons name="account-balance" size={12} color="#0f4c81" />
                        <Text style={[s.infoRowTxt, { color: '#0f4c81' }]}>
                          GST / Tax {fmt(item.tax_percent)}%
                        </Text>
                        <View style={{ flex: 1 }} />
                        <Text style={[s.infoRowAmt, { color: '#0f4c81' }]}>+{fmtCurr(item.tax_amount, currSym)}</Text>
                      </View>
                    )}

                    <View style={s.dueAmountRow}>
                      <View style={{ flex: 1 }} />
                      <View style={{ alignItems: 'flex-end' }}>
                        {checked && overdue && getLateFee(item) > 0 && (
                          <Text style={s.lateFeeBreakdown}>
                            Net {fmtCurr(item.balance_due ?? item.fee_amount, currSym)} + Late {fmtCurr(getLateFee(item), currSym)}
                          </Text>
                        )}
                        <Text style={s.dueAmountLabel}>
                          {checked && overdue && getLateFee(item) > 0 ? 'Total (incl. Late)' : 'Balance Due'}
                        </Text>
                        <Text style={[s.dueAmount, checked && s.dueAmountSelected]}>
                          {checked && overdue && getLateFee(item) > 0
                            ? fmtCurr((parseFloat(item.balance_due ?? item.fee_amount) || 0) + getLateFee(item), currSym)
                            : fmtCurr(item.balance_due ?? item.fee_amount, currSym)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAYMENT ENTRY — sticky cart-style bottom section
        ════════════════════════════════════════════════════════════════════ */}
        {dueItems.length > 0 && (
          <View style={s.paymentPanel}>
            {/* Selected items summary */}
            <View style={s.cartSummaryRow}>
              <Text style={s.cartSummaryLabel}>
                {selected.length} item{selected.length !== 1 ? 's' : ''} selected
              </Text>
              <Text style={s.cartTotal}>{fmtCurr(cartTotal, currSym)}</Text>
            </View>

            {selected.length > 0 && (
              <>
                {/* Selected items breakdown */}
                <View style={s.cartBreakdown}>
                  {selectedItems.map(i => {
                    const lf = getLateFee(i);
                    return (
                      <View key={i.fee_id}>
                        <View style={s.cartBreakdownRow}>
                          <Text style={s.cartBreakdownLabel} numberOfLines={1}>
                            {i.fee_item_name} ({i.month_no})
                          </Text>
                          <Text style={s.cartBreakdownAmt}>{fmtCurr(i.balance_due ?? i.fee_amount, currSym)}</Text>
                        </View>
                        {lf > 0 && (
                          <View style={s.cartBreakdownRow}>
                            <Text style={[s.cartBreakdownLabel, { color: '#b45309', paddingLeft: 10 }]}>
                              ↳ Late Fee
                            </Text>
                            <Text style={[s.cartBreakdownAmt, { color: '#b45309' }]}>{fmtCurr(lf, currSym)}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  <View style={s.cartBreakdownDivider} />
                  {cartTaxTotal > 0 && (
                    <View style={s.cartBreakdownRow}>
                      <Text style={[s.cartBreakdownLabel, { color: '#0f4c81' }]}>Tax (GST)</Text>
                      <Text style={[s.cartBreakdownAmt,   { color: '#0f4c81' }]}>{fmtCurr(cartTaxTotal, currSym)}</Text>
                    </View>
                  )}
                  {cartLateFeeTotal > 0 && (
                    <View style={s.cartBreakdownRow}>
                      <Text style={[s.cartBreakdownLabel, { color: '#b45309' }]}>Total Late Fee</Text>
                      <Text style={[s.cartBreakdownAmt,   { color: '#b45309' }]}>{fmtCurr(cartLateFeeTotal, currSym)}</Text>
                    </View>
                  )}
                  <View style={s.cartBreakdownRow}>
                    <Text style={[s.cartBreakdownLabel, { fontWeight: '800', color: '#0c1a2e' }]}>Total</Text>
                    <Text style={[s.cartBreakdownAmt,   { fontWeight: '900', color: '#0f4c81' }]}>{fmtCurr(cartTotal, currSym)}</Text>
                  </View>
                </View>

                {/* ── Payment Method selector — 2 per row ─────────────────── */}
                <Text style={s.inputLabel}>Payment Method</Text>
                <View style={s.methodGrid}>
                  {PAYMENT_METHODS.map((m, idx) => {
                    const active = paymentMethod === m.id;
                    // 2 columns: every item takes (50% - gap/2)
                    const isLastOdd = idx === PAYMENT_METHODS.length - 1 && PAYMENT_METHODS.length % 2 !== 0;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        activeOpacity={0.75}
                        style={[
                          s.methodBtn,
                          isLastOdd && s.methodBtnFull,
                          active && {
                            borderColor: m.color,
                            backgroundColor: m.bg,
                          },
                        ]}
                        onPress={() => setPaymentMethod(m.id)}
                      >
                        {/* Brand icon — large, centred */}
                        <View style={[s.methodIconWrap, active && { backgroundColor: m.color + '20' }]}>
                          <MaterialIcons name={m.icon} size={28} color={active ? m.color : '#94a3b8'} />
                        </View>

                        {/* Label */}
                        <Text style={[s.methodLabel, active && { color: m.color, fontWeight: '800' }]}>
                          {m.label}
                        </Text>

                        {/* Active checkmark badge */}
                        {active && (
                          <View style={[s.methodCheck, { backgroundColor: m.color }]}>
                            <MaterialIcons name="check" size={9} color="#fff" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* UPI apps: show QR button when PhonePe / GPay / Paytm selected */}
                {['PhonePe', 'Google Pay', 'Paytm'].includes(paymentMethod) && cartTotal > 0 && (
                  <TouchableOpacity style={s.qrLaunchBtn} onPress={() => setQrModal(true)}>
                    <MaterialIcons name="qr-code-2" size={22} color="#5f259f" />
                    <Text style={s.qrLaunchText}>Show QR Code for {paymentMethod}</Text>
                    <MaterialIcons name="chevron-right" size={18} color="#5f259f" />
                  </TouchableOpacity>
                )}

                {/* ── Inputs ────────────────────────────────────────────────── */}
                <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
                  {/* Receipt Number — auto for Cash, user-entry for all others */}
                  <View style={s.receiptLabelRow}>
                    <Text style={s.inputLabel}>
                      {isCash ? 'Receipt Number (auto-generated)' : `${paymentMethod} Reference / Transaction No. *`}
                    </Text>
                    {isCash && (
                      <TouchableOpacity onPress={() => setReceiptInput(genCashReceipt())} style={s.regenBtn}>
                        <MaterialIcons name="refresh" size={14} color="#0f4c81" />
                        <Text style={s.regenBtnText}>Regenerate</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={[s.inputWrap, isCash && s.inputWrapAuto]}>
                    <MaterialIcons
                      name={isCash ? 'auto-awesome' : 'tag'}
                      size={16}
                      color={isCash ? '#15803d' : '#94a3b8'}
                      style={s.inputIcon}
                    />
                    <TextInput
                      style={[s.inputText, isCash && { color: '#15803d', fontStyle: 'italic' }]}
                      placeholder={isCash ? 'Auto-generated' : `Enter ${paymentMethod} ref / UTR no.`}
                      placeholderTextColor="#94a3b8"
                      value={receiptInput}
                      onChangeText={setReceiptInput}
                      editable={!isCash}
                      autoCorrect={false}
                      autoCapitalize="characters"
                    />
                    {!isCash && (
                      <View style={s.requiredDot} />
                    )}
                  </View>
                  {!isCash && (
                    <Text style={s.receiptHint}>
                      Enter the UTR / transaction ID shown on your {paymentMethod} app after payment.
                    </Text>
                  )}

                  <View style={s.twoCol}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>Paid Amount *</Text>
                      <View style={[s.inputWrap, overpaid && s.inputWrapError]}>
                        <MaterialIcons name="currency-rupee" size={16} color="#94a3b8" style={s.inputIcon} />
                        <TextInput
                          style={s.inputText}
                          placeholder={`Max ${fmtCurr(cartTotal, currSym)}`}
                          placeholderTextColor="#94a3b8"
                          value={paidInput}
                          onChangeText={setPaidInput}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                    <View style={{ width: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>Balance</Text>
                      <View style={[s.inputWrap, s.inputWrapReadonly]}>
                        <MaterialIcons name="pending-actions" size={16} color="#b91c1c" style={s.inputIcon} />
                        <Text style={[s.inputText, { color: balanceAmt > 0 ? '#b91c1c' : '#15803d', fontWeight: '800', paddingTop: 13 }]}>
                          {fmtCurr(balanceAmt, currSym)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {overpaid && (
                    <Text style={s.overpaidWarning}>
                      ⚠️  Amount exceeds the selected total of {fmtCurr(cartTotal, currSym)}
                    </Text>
                  )}

                  <Text style={s.inputLabel}>Payment Date</Text>
                  <View style={s.inputWrap}>
                    <MaterialIcons name="event" size={16} color="#94a3b8" style={s.inputIcon} />
                    <TextInput
                      style={s.inputText}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#94a3b8"
                      value={paymentDate}
                      onChangeText={setPaymentDate}
                    />
                  </View>
                </Animated.View>

                {/* Balance note */}
                {balanceAmt > 0 && paidAmt > 0 && (
                  <View style={s.balanceNote}>
                    <MaterialIcons name="info-outline" size={15} color="#0f4c81" />
                    <Text style={s.balanceNoteText}>
                      A partial payment row will be created for the remaining {fmtCurr(balanceAmt, currSym)}.
                    </Text>
                  </View>
                )}

                {/* Submit */}
                {canCollect ? (
                <TouchableOpacity
                  style={[s.submitBtn, submitting && { opacity: 0.65 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <MaterialIcons name="check-circle" size={20} color="#fff" style={{ marginRight: 10 }} />
                        <Text style={s.submitBtnText}>
                          {paymentMethod === 'Cash' ? '💵' :
                           paymentMethod === 'Card' ? '💳' :
                           ['PhonePe','Google Pay','Paytm'].includes(paymentMethod) ? '📱' : '🏦'}
                          {'  '}Record {paymentMethod} · {fmtCurr(paidAmt || cartTotal, currSym)}
                        </Text>
                      </>}
                </TouchableOpacity>
                ) : (
                <View style={s.notAllowedBanner}>
                  <MaterialIcons name="lock" size={16} color="#b45309" />
                  <Text style={s.notAllowedText}>You are not allowed to collect fees.</Text>
                </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAYMENT HISTORY
        ════════════════════════════════════════════════════════════════════ */}
        <View style={[s.sectionHeader, { marginTop: 24 }]}>
          <View style={s.sectionHeaderLeft}>
            <View style={[s.sectionDot, { backgroundColor: '#15803d' }]} />
            <Text style={s.sectionTitle}>Payment History</Text>
            {paidRecords.length > 0 && (
              <View style={[s.sectionBadge, { backgroundColor: '#15803d' }]}>
                <Text style={s.sectionBadgeText}>{paidRecords.length}</Text>
              </View>
            )}
          </View>
        </View>

        {paidRecords.length === 0 ? (
          <View style={s.emptyDue}>
            <MaterialIcons name="receipt-long" size={36} color="#94a3b8" />
            <Text style={s.emptyDueText}>No payments recorded yet.</Text>
          </View>
        ) : (
          paidRecords.map((rec, idx) => (
            <ReceiptRow key={rec.receipt_number ?? idx} record={rec} onPress={() => openReceipt(rec)} onEmail={openEmailModal} currSym={currSym} />
          ))
        )}

        <View style={{ height: 50 }} />
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════════
          UPI QR CODE MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <UpiQrModal
        visible={qrModal}
        amount={paidAmt > 0 ? paidAmt : cartTotal}
        upiId={UPI_ID}
        merchantName={MERCHANT_NAME}
        paymentMethod={paymentMethod}
        studentName={student_name ?? ''}
        receiptNumber={receiptInput}
        onClose={() => setQrModal(false)}
        onConfirm={() => { setQrModal(false); handleSubmit(); }}
      />

      {/* ═══════════════════════════════════════════════════════════════════════
          EMAIL RECEIPT MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={emailModal}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => setEmailModal(false)}
      >
        <View style={s.emailOverlay}>
          <TouchableOpacity style={s.emailBackdrop} onPress={() => setEmailModal(false)} activeOpacity={1} />
          <View style={s.emailSheet}>

            {/* Header */}
            <View style={s.emailHeader}>
              <View style={s.emailIconWrap}>
                <MaterialIcons name="mark-email-unread" size={22} color="#0f4c81" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.emailTitle}>Email Receipt</Text>
                <Text style={s.emailSub}>Receipt #{emailRecord?.receipt_number || '—'}</Text>
              </View>
              <TouchableOpacity style={s.emailCloseBtn} onPress={() => setEmailModal(false)}>
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Payment summary strip */}
            <View style={s.emailSummaryStrip}>
              <View style={s.emailSummaryCell}>
                <Text style={s.emailSummaryLabel}>Paid</Text>
                <Text style={[s.emailSummaryValue, { color: '#15803d' }]}>{fmtCurr((emailRecord?.total_paid + emailRecord?.total_late_fee) ?? emailRecord?.fee_paid_amount + emailRecord?.fee_late_fee, currSym)}</Text>
              </View>
              <View style={s.emailSummaryDivider} />
              <View style={s.emailSummaryCell}>
                <Text style={s.emailSummaryLabel}>Balance</Text>
                <Text style={[s.emailSummaryValue, {
                  color: parseFloat(emailRecord?.total_balance ?? emailRecord?.balance_amount ?? 0) > 0 ? '#b91c1c' : '#15803d'
                }]}>{fmtCurr(emailRecord?.total_balance ?? emailRecord?.balance_amount, currSym)}</Text>
              </View>
              <View style={s.emailSummaryDivider} />
              <View style={s.emailSummaryCell}>
                <Text style={s.emailSummaryLabel}>Items</Text>
                <Text style={s.emailSummaryValue} numberOfLines={1}>{emailRecord?.items?.length ?? 1}</Text>
              </View>
            </View>

            {/* Email input */}
            <Text style={s.emailFieldLabel}>Send to Email Address</Text>
            <View style={s.emailInputRow}>
              <MaterialIcons name="mail-outline" size={18} color="#94a3b8" style={{ marginLeft: 12, marginRight: 8 }} />
              <TextInput
                style={s.emailInput}
                placeholder="guardian@example.com"
                placeholderTextColor="#94a3b8"
                value={emailAddr}
                onChangeText={setEmailAddr}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {emailAddr.length > 0 && (
                <TouchableOpacity onPress={() => setEmailAddr('')} style={{ paddingRight: 12 }}>
                  <MaterialIcons name="cancel" size={18} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.emailHint}>
              A full HTML receipt with payment breakdown will be delivered to this address.
            </Text>

            {/* Buttons */}
            <View style={s.emailFooterRow}>
              <TouchableOpacity style={s.emailCancelBtn} onPress={() => setEmailModal(false)}>
                <Text style={s.emailCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.emailSendBtn, sendingEmail && { opacity: 0.65 }]}
                onPress={handleSendEmail}
                disabled={sendingEmail}
              >
                {sendingEmail
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <MaterialIcons name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={s.emailSendText}>Send Receipt</Text>
                    </>}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          RECEIPT DETAIL MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <ReceiptDetailModal
        visible={receiptModal}
        record={receiptRecord}
        onClose={() => setReceiptModal(false)}
        className={dueItems[0]?.class_name   ?? route?.params?.className ?? String(class_id   ?? '')}
        sessionName={dueItems[0]?.session_name ?? String(session_id ?? '')}
        branchName={dueItems[0]?.branch_name   ?? String(branch_id  ?? '')}
        currSym={currSym}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ─── Student Info Card ───────────────────────────────────────────────────────
function StudentInfoCard({
  studentsName, enrollmentId, className, sessionId, branchId, clientCode,
  totalDue, totalPaid, currSym = '₹', onDemandLetter, demandLoading,
  onWhatsApp, hasPhone,
}) {
  // Derive initials from name for avatar
  const initials = (studentsName ?? 'S')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const fullyPaid = totalDue <= 0;

  return (
    <View style={si.card}>
      {/* Decorative top stripe */}
      <View style={si.topStripe} />
        
      <View style={si.body}>
        {/* Avatar + name block */}
        <View style={si.avatarRow}>
          <View style={si.avatar}>
            <Text style={si.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={si.studentName} numberOfLines={1}>{studentsName ?? '—'}</Text>
            <View style={si.enrollRow}>
              <MaterialIcons name="badge" size={13} color="#64748b" />
              <Text style={si.enrollText}>{enrollmentId ?? '—'}</Text>
                <View style={si.chipsRow}>
          {className  ? <InfoChip icon="class"            label="Class:"   value={className}   /> : null}
          {sessionId? <InfoChip icon="date-range"       label="Session" value={sessionId} /> : null}
          {branchId ? <InfoChip icon="account-balance"  label="Branch"  value={branchId}  /> : null}
          {clientCode?<InfoChip icon="business"         label="Code"    value={clientCode}/> : null}
        </View>
            </View>
          </View>

          {/* Fee status badge */}
          <View style={[si.statusBadge, { backgroundColor: fullyPaid ? '#dcfce7' : '#fee2e2' }]}>
            <MaterialIcons
              name={fullyPaid ? 'check-circle' : 'pending-actions'}
              size={14}
              color={fullyPaid ? '#15803d' : '#b91c1c'}
            />
            <Text style={[si.statusBadgeText, { color: fullyPaid ? '#15803d' : '#b91c1c' }]}>
              {fullyPaid ? 'Paid' : 'Due'}
            </Text>
          </View>
        </View>

        {/* Detail chips row */}
        {/* <View style={si.chipsRow}>
          {className  ? <InfoChip icon="class"            label="Class:"   value={className}   /> : null}
          {sessionId? <InfoChip icon="date-range"       label="Session" value={sessionId} /> : null}
          {branchId ? <InfoChip icon="account-balance"  label="Branch"  value={branchId}  /> : null}
          {clientCode?<InfoChip icon="business"         label="Code"    value={clientCode}/> : null}
        </View> */}

        {/* Action links row — Demand Letter + WhatsApp */}
        <View style={si.actionRow}>
          <TouchableOpacity
            onPress={onDemandLetter}
            disabled={demandLoading}
            style={si.demandLink}
            activeOpacity={0.7}
          >
            <MaterialIcons name='description' size={12} color='#b91c1c' />
            <Text style={si.demandLinkTxt}>
              {demandLoading ? 'Generating…' : 'Demand Letter'}
            </Text>
          </TouchableOpacity>
          {onWhatsApp && (
            <TouchableOpacity
              onPress={onWhatsApp}
              style={si.whatsappLink}
              activeOpacity={0.7}
            >
              <MaterialIcons name='chat' size={12} color={hasPhone ? '#16a34a' : '#94a3b8'} />
              <Text style={[si.demandLinkTxt, { color: hasPhone ? '#16a34a' : '#94a3b8' }]}>
                {hasPhone ? 'Send via WhatsApp' : 'WhatsApp (no number)'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Mini financials */}
        <View style={si.financialRow}>
          <View style={si.finCell}>
            <Text style={si.finLabel}>Due</Text>
            <Text style={[si.finValue, { color: totalDue > 0 ? '#b91c1c' : '#15803d' }]}>
              {currSym} {parseFloat(totalDue || 0).toFixed(2)}
            </Text>
          </View>
          <View style={si.finDivider} />
          <View style={si.finCell}>
            <Text style={si.finLabel}> Paid</Text>
            <Text style={[si.finValue, { color: '#15803d' }]}>
              {currSym} {parseFloat(totalPaid || 0).toFixed(2)}
            </Text>
          </View>
          <View style={si.finDivider} />
          <View style={si.finCell}>
            <Text style={si.finLabel}>Total</Text>
            <Text style={[si.finValue, { color: '#0f4c81' }]}>
              {currSym} {(parseFloat(totalDue || 0) + parseFloat(totalPaid || 0)).toFixed(2)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function InfoChip({ icon, label, value }) {
  return (
    <View style={si.chip}>
      <MaterialIcons name={icon} size={11} color="#0f4c81" />
      <Text style={si.chipLabel}>{label} </Text>
      <Text style={si.chipValue}>{value}</Text>
    </View>
  );
}

function NavBar({ title, sub, onBack }) {
  return (
    <View style={s.navbar}>
      <TouchableOpacity style={s.backBtn} onPress={onBack}>
        <MaterialIcons name="arrow-back-ios" size={20} color="#0f4c81" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.navTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.navSub}>{sub}</Text>
      </View>
    </View>
  );
}

function SumCell({ icon, label, value, light }) {
  return (
    <View style={s.sumCell}>
      <MaterialIcons name={icon} size={18} color={light ? 'rgba(255,255,255,0.85)' : '#0f4c81'} />
      <Text style={[s.sumValue, light && { color: '#fff' }]}>{value}</Text>
      <Text style={[s.sumLabel,  light && { color: 'rgba(255,255,255,0.7)' }]}>{label}</Text>
    </View>
  );
}

function MetaTag({ icon, label, warn }) {
  return (
    <View style={[s.metaTag, warn && s.metaTagWarn]}>
      <MaterialIcons name={icon} size={11} color={warn ? '#b45309' : '#64748b'} />
      <Text style={[s.metaTagText, warn && { color: '#b45309' }]}>{label}</Text>
    </View>
  );
}

// Method icon/colour maps — module-level so they are not recreated on render
const METHOD_ICON_MAP = {
  Cash: 'payments', Card: 'credit-card', PhonePe: 'smartphone',
  'Google Pay': 'account-balance-wallet', Paytm: 'qr-code',
  'Bank Transfer': 'account-balance', Cheque: 'description',
};
const METHOD_COLOR_MAP = {
  Cash: '#15803d', Card: '#0f4c81', PhonePe: '#5f259f',
  'Google Pay': '#1a73e8', Paytm: '#00b9f5',
  'Bank Transfer': '#b45309', Cheque: '#475569',
};

function ReceiptRow({ record: r, onPress, onEmail, currSym = "₹" }) {
  const rc         = rs(r.admin_review);
  const items      = r.items ?? [];
  const hasBalance = parseFloat(r.total_balance ?? 0) > 0;
  const hasLateFee = parseFloat(r.total_late_fee ?? 0) > 0;
  const ic         = METHOD_ICON_MAP[r.payment_method]  ?? 'payments';
  const co         = METHOD_COLOR_MAP[r.payment_method] ?? '#0f4c81';

  return (
    <TouchableOpacity style={s.receiptRow} onPress={onPress} activeOpacity={0.8}>
      {/* Left accent — amber if balance remains, green if fully paid */}
      <View style={[s.receiptRowAccent, { backgroundColor: hasBalance ? '#f59e0b' : '#15803d' }]} />

      <View style={s.receiptRowBody}>

        {/* ── Top row: receipt number + email icon + status pill ── */}
        <View style={s.receiptRowTop}>
          <TouchableOpacity style={s.receiptLink} onPress={onPress} activeOpacity={0.75}>
            <MaterialIcons name="receipt" size={14} color="#0f4c81" />
            <Text style={s.receiptLinkText}>#{r.receipt_number || '—'}</Text>
            <MaterialIcons name="open-in-new" size={12} color="#0f4c81" />
          </TouchableOpacity>
          <View style={s.receiptRowActions}>
            {onEmail && (
              <TouchableOpacity style={s.emailIconBtn} onPress={() => onEmail(r)} activeOpacity={0.75}>
                <MaterialIcons name="email" size={16} color="#0f4c81" />
              </TouchableOpacity>
            )}
            <View style={[s.reviewPill, { backgroundColor: rc.bg, borderColor: rc.border }]}>
              <View style={[s.reviewDot, { backgroundColor: rc.text }]} />
              <Text style={[s.reviewPillText, { color: rc.text }]}>{r.admin_review ?? 'Pending'}</Text>
            </View>
          </View>
        </View>

        {/* ── Receipt-level totals strip ── */}
        <View style={s.receiptAmtRow}>
          <ReceiptAmt label="Total Fee"  value={fmtCurr(r.total_fee, currSym)} />
          {parseFloat(r.total_discount ?? 0) > 0 && (
            <ReceiptAmt label="Discount" value={`−${fmtCurr(r.total_discount, currSym)}`} green />
          )}
          {parseFloat(r.total_tax ?? 0) > 0 && (
            <ReceiptAmt label="Tax" value={fmtCurr(r.total_tax, currSym)} blue />
          )}
          <ReceiptAmt label="Collected"  value={fmtCurr(r.total_collected ?? r.total_paid, currSym)} green />
          {hasLateFee && (
            <ReceiptAmt label="Late Fee" value={fmtCurr(r.total_late_fee, currSym)} warn />
          )}
          <ReceiptAmt label="Balance"    value={fmtCurr(r.total_balance, currSym)}
            red={hasBalance} green={!hasBalance} />
        </View>

        {/* ── Per-item breakdown ── */}
        {items.length > 0 && (
          <View style={s.receiptItemsList}>
            {items.map((item, idx) => {
              const bal      = parseFloat(item.balance_amount ?? 0);
              const late     = parseFloat(item.late_fee ?? 0);
              const thisPaid = parseFloat(item.paid_amount ?? 0);   // this receipt only
              const allPaid  = parseFloat(item.total_paid  ?? thisPaid); // all-time total
              return (
                <View key={item.trxn_id ?? idx}
                  style={[s.receiptItemRow, idx === items.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.receiptItemName} numberOfLines={1}>
                      {item.fee_item_name}
                      {item.month_no ? `  ·  ${item.month_no}` : ''}
                    </Text>
                    <Text style={s.receiptItemFee}>Fee {fmtCurr(item.fee_amount, currSym)}</Text>
                    {parseFloat(item.discount_amount ?? 0) > 0 && (
                      <Text style={[s.receiptItemFee, { color: '#16a34a' }]}>
                        Disc −{fmtCurr(item.discount_amount, currSym)}
                        {parseFloat(item.discount_percent ?? 0) > 0
                          ? ` (${fmt(item.discount_percent)}%)` : ''}
                      </Text>
                    )}
                    {parseFloat(item.tax_amount ?? 0) > 0 && (
                      <Text style={[s.receiptItemFee, { color: '#0f4c81' }]}>
                        Tax +{fmtCurr(item.tax_amount, currSym)}
                        {parseFloat(item.tax_percent ?? 0) > 0
                          ? ` (${fmt(item.tax_percent)}%)` : ''}
                      </Text>
                    )}
                  </View>
                  <View style={s.receiptItemRight}>
                    {/* This receipt's payment */}
                    <Text style={[s.receiptItemPaid, { color: '#15803d' }]}>
                      Paid {fmtCurr(thisPaid, currSym)}
                    </Text>
                    {/* All-time paid — shown only when differs from this receipt */}
                    {allPaid > thisPaid && (
                      <Text style={[s.receiptItemPaid, { color: '#475569', fontSize: 10 }]}>
                        Total paid {fmtCurr(allPaid, currSym)}
                      </Text>
                    )}
                    {late > 0 && (
                      <Text style={[s.receiptItemPaid, { color: '#b45309' }]}>
                        Late {fmtCurr(late, currSym)}
                      </Text>
                    )}
                    {/* Balance pill: based on true_balance from backend (fee_structure − all payments) */}
                    <View style={[s.receiptItemBalancePill,
                      { backgroundColor: bal > 0 ? '#fef3c7' : '#dcfce7' }]}>
                      <Text style={[s.receiptItemBalanceText,
                        { color: bal > 0 ? '#b45309' : '#15803d' }]}>
                        {bal > 0 ? `Bal ${fmtCurr(bal, currSym)}` : '✓ Cleared'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Footer: date + item count + payment method ── */}
        <View style={s.receiptMeta}>
          <MetaTag icon="event" label={fmtDate(r.payment_date)} />
          <MetaTag icon="receipt" label={`${items.length} item${items.length !== 1 ? 's' : ''}`} />
          <View style={[s.methodHistoryBadge, { backgroundColor: co + '14', borderColor: co + '40' }]}>
            <MaterialIcons name={ic} size={11} color={co} />
            <Text style={[s.methodHistoryText, { color: co }]}>{r.payment_method || 'Cash'}</Text>
          </View>
          {hasBalance && (
            <View style={s.partialBadge}><Text style={s.partialBadgeText}>Partial</Text></View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ReceiptAmt({ label, value, green, red, warn, blue }) {
  const color = green ? '#15803d' : red ? '#b91c1c' : warn ? '#b45309' : blue ? '#0f4c81' : '#475569';
  return (
    <View style={s.receiptAmtCell}>
      <Text style={s.receiptAmtLabel}>{label}</Text>
      <Text style={[s.receiptAmtValue, { color }]}>{value}</Text>
    </View>
  );
}

// ─── UPI QR Code Modal ───────────────────────────────────────────────────────
/**
 * Generates a standard UPI deep-link URI and renders it as a QR code
 * using the free api.qrserver.com service (no API key needed).
 *
 * UPI URI format:  upi://pay?pa=VPA&pn=NAME&am=AMOUNT&cu=INR&tn=NOTE
 * Works with PhonePe, Google Pay, Paytm, BHIM and all UPI apps.
 *
 * Install: expo install react-native-webview
 */
function UpiQrModal({ visible, amount, upiId, merchantName, paymentMethod, studentName, receiptNumber, onClose, onConfirm, currSym = "₹" }) {
  const amtStr  = parseFloat(amount || 0).toFixed(2);
  const note    = encodeURIComponent(`Fee: ${studentName}${receiptNumber ? ' / ' + receiptNumber : ''}`);
  const upiUri  = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${amtStr}&cu=INR&tn=${note}`;

  // QR image via free public API — no key needed, works offline-tolerantly
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(upiUri)}&format=png&margin=16`;

  const METHOD_COLOR = {
    PhonePe:      '#5f259f',
    'Google Pay': '#1a73e8',
    Paytm:        '#00b9f5',
  };
  const accent = METHOD_COLOR[paymentMethod] ?? '#0f4c81';

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError,  setImgError]  = useState(false);

  // Reset state when modal opens
  React.useEffect(() => {
    if (visible) { setImgLoaded(false); setImgError(false); }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={sq.overlay}>
        <View style={sq.sheet}>

          {/* Header */}
          <View style={sq.header}>
            <View style={[sq.headerIcon, { backgroundColor: accent + '18' }]}>
              <MaterialIcons name="qr-code-2" size={26} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={sq.headerTitle}>Pay via {paymentMethod}</Text>
              <Text style={sq.headerSub}>Scan with any UPI app</Text>
            </View>
            <TouchableOpacity style={sq.closeBtn} onPress={onClose}>
              <MaterialIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Amount pill */}
          <View style={[sq.amountPill, { borderColor: accent }]}>
            <Text style={sq.amountPillLabel}>Amount to Pay</Text>
            <Text style={[sq.amountPillValue, { color: accent }]}>{currSym} {amtStr}</Text>
          </View>

          {/* QR code */}
          <View style={sq.qrWrap}>
            {!imgLoaded && !imgError && (
              <View style={sq.qrLoader}>
                <ActivityIndicator size="large" color={accent} />
                <Text style={sq.qrLoaderText}>Generating QR…</Text>
              </View>
            )}
            {imgError ? (
              <View style={sq.qrError}>
                <MaterialIcons name="wifi-off" size={40} color="#94a3b8" />
                <Text style={sq.qrErrorText}>Could not load QR code.</Text>
                <Text style={sq.qrErrorSub}>Check your internet connection.</Text>
              </View>
            ) : (
              <Image
                source={{ uri: qrUrl }}
                style={[sq.qrImage, !imgLoaded && { opacity: 0 }]}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
                resizeMode="contain"
              />
            )}
          </View>

          {/* UPI ID display */}
          <View style={sq.upiRow}>
            <MaterialIcons name="account-balance-wallet" size={15} color="#64748b" />
            <Text style={sq.upiLabel}>UPI ID: </Text>
            <Text style={sq.upiId}>{upiId}</Text>
          </View>

          {/* Instructions */}
          <View style={sq.steps}>
            {[
              `Open ${paymentMethod} on your phone`,
              'Tap "Scan QR" or "Pay"',
              `Verify amount ${currSym}${amtStr} and confirm`,
              'Share screenshot / transaction ID for receipt',
            ].map((step, i) => (
              <View key={i} style={sq.step}>
                <View style={[sq.stepNum, { backgroundColor: accent }]}>
                  <Text style={sq.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={sq.stepText}>{step}</Text>
              </View>
            ))}
          </View>

          {/* Footer actions */}
          <View style={sq.footer}>
            <TouchableOpacity style={sq.cancelBtn} onPress={onClose}>
              <Text style={sq.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sq.confirmBtn, { backgroundColor: accent }]} onPress={onConfirm}>
              <MaterialIcons name="check-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={sq.confirmBtnText}>Payment Done — Record It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Receipt Detail Modal ─────────────────────────────────────────────────────
function ReceiptDetailModal({ visible, record: r, onClose, className, sessionName, branchName, currSym = "₹" }) {
  if (!r) return null;
  const rc         = rs(r.admin_review);
  const items      = r.items ?? [];
  const hasBalance = parseFloat(r.total_balance ?? 0) > 0;
  const hasLateFee = parseFloat(r.total_late_fee ?? 0) > 0;
  const methodIcon  = METHOD_ICON_MAP[r.payment_method]  ?? 'payments';
  const methodColor = METHOD_COLOR_MAP[r.payment_method] ?? '#0f4c81';

  const Field = ({ label, value, highlight }) => (
    <View style={s.detailField}>
      <Text style={s.detailFieldLabel}>{label}</Text>
      <Text style={[s.detailFieldValue, highlight && { color: '#0f4c81', fontWeight: '800' }]}>
        {value ?? '—'}
      </Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent={false} animationType="slide"
      presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.modalRoot}>

        {/* ── Header ── */}
        <View style={s.modalHeader}>
          <View style={s.modalHeaderLeft}>
            <View style={s.modalIconWrap}>
              <MaterialIcons name="receipt-long" size={22} color="#0f4c81" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle}>Receipt #{r.receipt_number}</Text>
              <Text style={s.modalSubtitle}>
                {items.length} fee item{items.length !== 1 ? 's' : ''}
                {'  ·  '}{fmtDate(r.payment_date)}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={s.modalCloseBtn} onPress={onClose}>
            <MaterialIcons name="close" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>
        <View style={s.modalDivider} />

        <ScrollView style={s.modalBody} contentContainerStyle={s.modalBodyContent}
          showsVerticalScrollIndicator={false}>

          {/* ── Status + payment method ── */}
          <View style={[s.receiptStatusBanner, { backgroundColor: rc.bg, borderColor: rc.border }]}>
            <View style={[s.reviewDot, { backgroundColor: rc.text, width: 10, height: 10 }]} />
            <Text style={[s.receiptStatusText, { color: rc.text }]}>{r.admin_review ?? 'Pending'}</Text>
            <View style={{ flex: 1 }} />
            <View style={[s.detailMethodBadge,
              { backgroundColor: methodColor + '18', borderColor: methodColor + '40' }]}>
              <MaterialIcons name={methodIcon} size={13} color={methodColor} />
              <Text style={[s.detailMethodText, { color: methodColor }]}>
                {r.payment_method || 'Cash'}
              </Text>
            </View>
            {hasBalance && (
              <View style={[s.partialBadge, { marginLeft: 8 }]}>
                <Text style={s.partialBadgeText}>Partial</Text>
              </View>
            )}
          </View>

          {/* ── Receipt-level totals grid ── */}
          <View style={s.receiptAmtGrid}>
            <AmountBox label="Total Fee"  value={fmtCurr(r.total_fee, currSym)}                          color="#0f4c81" />
            {parseFloat(r.total_discount ?? 0) > 0 && (
              <AmountBox label="Discount" value={`−${fmtCurr(r.total_discount, currSym)}`}               color="#15803d" />
            )}
            {parseFloat(r.total_tax ?? 0) > 0 && (
              <AmountBox label="Tax (GST)" value={fmtCurr(r.total_tax, currSym)}                         color="#0f4c81" />
            )}
            {hasLateFee && (
              <AmountBox label="Late Fee"  value={fmtCurr(r.total_late_fee, currSym)}                    color="#a16207" />
            )}
            <AmountBox label="Collected"  value={fmtCurr(r.total_collected ?? r.total_paid, currSym)}    color="#15803d" />
            <AmountBox label="Balance"    value={fmtCurr(r.total_balance, currSym)}
              color={hasBalance ? '#b91c1c' : '#15803d'} />
          </View>

          {/* ── Per-item breakdown ── */}
          <DetailSection label={`FEE ITEMS (${items.length})`}>
            {items.map((item, idx) => {
              const bal = parseFloat(item.balance_amount ?? 0);
              return (
                <View key={item.trxn_id ?? idx}
                  style={[s.detailItemRow,
                    idx === items.length - 1 && { borderBottomWidth: 0 }]}>
                  {/* Left: name + fee breakdown */}
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={s.detailItemName}>
                      {item.fee_item_name}
                      {item.month_no ? `  ·  ${item.month_no}` : ''}
                    </Text>
                    <Text style={s.detailItemMeta}>
                      Fee {fmtCurr(item.fee_amount, currSym)}
                    </Text>
                    {parseFloat(item.discount_amount ?? 0) > 0 && (
                      <Text style={[s.detailItemMeta, { color: '#16a34a' }]}>
                        Discount −{fmtCurr(item.discount_amount, currSym)}
                        {parseFloat(item.discount_percent ?? 0) > 0
                          ? ` (${fmt(item.discount_percent)}%)` : ''}
                      </Text>
                    )}
                    {parseFloat(item.tax_amount ?? 0) > 0 && (
                      <Text style={[s.detailItemMeta, { color: '#0f4c81' }]}>
                        Tax +{fmtCurr(item.tax_amount, currSym)}
                        {parseFloat(item.tax_percent ?? 0) > 0
                          ? ` (${fmt(item.tax_percent)}%)` : ''}
                      </Text>
                    )}
                    {parseFloat(item.late_fee ?? 0) > 0 && (
                      <Text style={[s.detailItemMeta, { color: '#b45309' }]}>
                        Late Fee +{fmtCurr(item.late_fee, currSym)}
                      </Text>
                    )}
                  </View>
                  {/* Right: paid + balance pill */}
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[s.detailFieldValue, { color: '#15803d' }]}>
                      Paid {fmtCurr(item.paid_amount, currSym)}
                    </Text>
                    <View style={[s.receiptItemBalancePill,
                      { backgroundColor: bal > 0 ? '#fef3c7' : '#dcfce7' }]}>
                      <Text style={[s.receiptItemBalanceText,
                        { color: bal > 0 ? '#b45309' : '#15803d' }]}>
                        {bal > 0 ? `Bal ${fmtCurr(bal, currSym)}` : '✓ Cleared'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </DetailSection>

          {/* ── Payment info ── */}
          <DetailSection label="PAYMENT INFO">
            <Field label="Receipt Number" value={r.receipt_number} highlight />
            <Field label="Payment Date"   value={fmtDate(r.payment_date)} />
            <Field label="Fee Paid Date"  value={fmtDate(r.fee_paid_date)} />
            <Field label="Recorded By"    value={r.admin_user} />
          </DetailSection>

          {/* ── Reference ── */}
          <DetailSection label="REFERENCE">
            <Field label="Enrollment"   value={r.enrollment_id} />
            <Field label="Class"        value={className   || String(r.class_id   ?? '—')} />
            <Field label="Branch"       value={branchName  || String(r.branch_id  ?? '—')} />
            <Field label="Session"      value={sessionName || String(r.session_id ?? '—')} />
            <Field label="Collected By" value={r.ssms_user_name || r.admin_user || '—'} />
          </DetailSection>

          {/* ── Admin review ── */}
          <DetailSection label="ADMIN REVIEW">
            <Field label="Status"      value={r.admin_review} />
            <Field label="Reviewed By" value={r.admin_user} />
            <Field label="Review Date" value={fmtDate(r.admin_review_date)} />
          </DetailSection>

          <TouchableOpacity style={s.closeReceiptBtn} onPress={onClose}>
            <Text style={s.closeReceiptBtnText}>Close</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AmountBox({ label, value, color }) {
  return (
    <View style={s.amountBox}>
      <Text style={s.amountBoxLabel}>{label}</Text>
      <Text style={[s.amountBoxValue, { color }]}>{value}</Text>
    </View>
  );
}

function DetailSection({ label, children }) {
  return (
    <View style={s.detailSection}>
      <Text style={s.detailSectionLabel}>{label}</Text>
      <View style={s.detailSectionBody}>{children}</View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#f0f4f8' },
  scroll:{ flex: 1 },
  scrollContent: { padding: 16, paddingTop: 14, paddingBottom: 80 },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  loaderText: { marginTop: 14, color: '#64748b', fontSize: 14 },

  // Navbar
  navbar:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: Platform.OS === 'ios' ? 52 : 20, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#e8f0fe', gap: 10, elevation: 3, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  backBtn:    { width: 38, height: 38, borderRadius: 12, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  navTitle:   { fontSize: 18, fontWeight: '800', color: '#0c1a2e' },
  navSub:     { fontSize: 12, color: '#64748b', marginTop: 1 },

  // Summary banner
  summaryBanner: { flexDirection: 'row', backgroundColor: '#0f4c81', borderRadius: 20, padding: 18, marginBottom: 20, elevation: 5, shadowColor: '#0f4c81', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  sumCell:       { flex: 1, alignItems: 'center' },
  sumDivider:    { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },
  sumValue:      { fontSize: 15, fontWeight: '900', color: '#fff', marginTop: 6 },
  sumLabel:      { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 3, fontWeight: '600' },

  // Section headers
  sectionHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDot:        { width: 10, height: 10, borderRadius: 5 },
  sectionTitle:      { fontSize: 15, fontWeight: '800', color: '#0c1a2e' },
  sectionBadge:      { backgroundColor: '#b91c1c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  sectionBadgeText:  { fontSize: 11, fontWeight: '800', color: '#fff' },
  selectAllText:     { fontSize: 13, color: '#0f4c81', fontWeight: '700' },

  emptyDue:     { alignItems: 'center', paddingVertical: 30, backgroundColor: '#fff', borderRadius: 18, marginBottom: 16 },

  // Late fee per-item UI
  discountRow:      { flexDirection: 'column', backgroundColor: '#f0fdf4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  discountLine1:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  discountLine2:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 17 },
  discountTxt:      { fontSize: 11, color: '#15803d', fontWeight: '600', flex: 1 },
  discountStrike:   { fontSize: 11, color: '#94a3b8', textDecorationLine: 'line-through' },
  discountSaved:    { fontSize: 11, color: '#dc2626', fontWeight: '700' },
  discountNet:      { fontSize: 12, color: '#0f172a', fontWeight: '800', marginLeft: 4 },
  infoRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6, borderWidth: 1, borderColor: '#e0f2fe', backgroundColor: '#f0f9ff' },
  infoRowTxt:       { fontSize: 11, fontWeight: '600' },
  infoRowAmt:       { fontSize: 11, fontWeight: '700' },
  lateFeeRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb',
                      borderRadius: 8, padding: 7, marginTop: 6, marginBottom: 8,
                      borderWidth: 1, borderColor: '#fde68a' },
  lateFeeLabel:     { fontSize: 12, fontWeight: '700', color: '#b45309' },
  lateFeeInputWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, backgroundColor: '#fff',
                      borderRadius: 6, borderWidth: 1, borderColor: '#fcd34d', paddingHorizontal: 8, height: 32 },
  lateFeeRupee:     { fontSize: 13, color: '#b45309', fontWeight: '700', marginRight: 3 },
  lateFeeInput:     { flex: 1, fontSize: 13, color: '#b45309', fontWeight: '700', paddingVertical: 0 },
  lateFeeClear:     { padding: 4 },
  lateFeeBreakdown: { fontSize: 10, color: '#b45309', fontWeight: '600', marginBottom: 2 },
  emptyDueText: { marginTop: 10, fontSize: 14, color: '#64748b', fontWeight: '600' },

  // Due fee card
  dueCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: 18, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#e2e8f0',
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  dueCardSelected: {
    borderColor: '#0f4c81', backgroundColor: '#f0f7ff',
    elevation: 4, shadowOpacity: 0.08,
  },
  checkbox:        { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 2, backgroundColor: '#fff' },
  checkboxChecked: { backgroundColor: '#0f4c81', borderColor: '#0f4c81' },

  dueCardContent:  { flex: 1 },
  dueCardTopRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dueItemName:     { fontSize: 14, fontWeight: '700', color: '#0c1a2e', flex: 1 },
  overdueBadge:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef3c7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, gap: 3, marginLeft: 8 },
  overdueBadgeText:{ fontSize: 10, color: '#b45309', fontWeight: '700' },

  dueCardMetaRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaTag:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, gap: 4 },
  metaTagWarn:     { backgroundColor: '#fef3c7' },
  metaTagText:     { fontSize: 11, color: '#64748b', fontWeight: '600' },

  dueAmountRow:    { flexDirection: 'row', alignItems: 'center' },
  prevPaidTag:     { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  prevPaidText:    { fontSize: 11, color: '#15803d', fontWeight: '700' },
  dueAmountLabel:  { fontSize: 11, color: '#94a3b8', fontWeight: '600', marginRight: 6 },
  dueAmount:       { fontSize: 17, fontWeight: '900', color: '#b91c1c' },
  dueAmountSelected:{ color: '#0f4c81' },

  // Payment panel
  paymentPanel:       { backgroundColor: '#fff', borderRadius: 22, padding: 18, marginTop: 8, marginBottom: 4, borderWidth: 1.5, borderColor: '#e8f0fe', elevation: 4, shadowColor: '#0f4c81', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  cartSummaryRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cartSummaryLabel:   { fontSize: 13, color: '#64748b', fontWeight: '600' },
  cartTotal:          { fontSize: 24, fontWeight: '900', color: '#0f4c81', letterSpacing: -0.5 },
  cartBreakdown:      { backgroundColor: '#f8fafc', borderRadius: 14, padding: 12, marginTop: 12, marginBottom: 16 },
  cartBreakdownRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cartBreakdownLabel: { fontSize: 13, color: '#475569', flex: 1, marginRight: 8 },
  cartBreakdownAmt:   { fontSize: 13, color: '#475569', fontWeight: '700' },
  cartBreakdownDivider:{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 },

  inputLabel:   { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6 },
  inputWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, marginBottom: 14, minHeight: 48 },
  inputWrapError:   { borderColor: '#ef4444', backgroundColor: '#fff5f5' },
  inputWrapReadonly:{ backgroundColor: '#f1f5f9' },
  inputIcon:    { marginLeft: 12, marginRight: 4 },
  inputText:    { flex: 1, fontSize: 15, color: '#0c1a2e', paddingVertical: 12, paddingRight: 12 },
  twoCol:       { flexDirection: 'row' },
  overpaidWarning: { fontSize: 12, color: '#b91c1c', fontWeight: '600', marginTop: -10, marginBottom: 10 },

  balanceNote:     { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#e8f0fe', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
  balanceNoteText: { flex: 1, fontSize: 13, color: '#0f4c81', lineHeight: 18 },

  submitBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f4c81', borderRadius: 16, paddingVertical: 17, elevation: 5, shadowColor: '#0f4c81', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  notAllowedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  notAllowedText:   { fontSize: 14, fontWeight: '600', color: '#b45309', flex: 1 },

  // Receipt row
  receiptRow:       { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  receiptRowAccent: { width: 5 },
  receiptRowBody:   { flex: 1, padding: 14 },
  receiptRowTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  receiptLink:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e8f0fe', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  receiptLinkText:  { fontSize: 13, fontWeight: '800', color: '#0f4c81' },
  reviewPill:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14, borderWidth: 1.5, gap: 5 },
  reviewDot:        { width: 7, height: 7, borderRadius: 4 },
  reviewPillText:   { fontSize: 11, fontWeight: '700' },

  receiptAmtRow:    { flexDirection: 'row', gap: 4, marginBottom: 10 },
  receiptAmtCell:   { flex: 1, backgroundColor: '#f8fafc', borderRadius: 10, padding: 8, alignItems: 'center' },
  receiptAmtLabel:  { fontSize: 9, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  receiptAmtValue:  { fontSize: 13, fontWeight: '800', marginTop: 3 },
  receiptMeta:      { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  partialBadge:     { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  partialBadgeText: { fontSize: 10, color: '#b45309', fontWeight: '800' },

  // Receipt detail modal
  modalRoot:       { flex: 1, backgroundColor: '#f0f4f8' },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 18 : 20, paddingBottom: 16, backgroundColor: '#fff' },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  modalIconWrap:   { width: 44, height: 44, borderRadius: 14, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  modalTitle:      { fontSize: 19, fontWeight: '800', color: '#0c1a2e' },
  modalSubtitle:   { fontSize: 12, color: '#64748b', marginTop: 2 },
  modalCloseBtn:   { width: 38, height: 38, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  modalDivider:    { height: 1, backgroundColor: '#e2e8f0' },
  modalBody:       { flex: 1 },
  modalBodyContent:{ padding: 20, paddingBottom: Platform.OS === 'ios' ? 44 : 28 },

  receiptStatusBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 20, gap: 8, borderWidth: 1.5 },
  receiptStatusText:   { fontSize: 15, fontWeight: '800', flex: 1 },

  receiptAmtGrid:  { flexDirection: 'row', gap: 8, marginBottom: 24 },
  amountBox:       { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', elevation: 1 },
  amountBoxLabel:  { fontSize: 10, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  amountBoxValue:  { fontSize: 15, fontWeight: '900', marginTop: 6 },

  detailSection:      { marginBottom: 20 },
  detailSectionLabel: { fontSize: 11, fontWeight: '800', color: '#0f4c81', letterSpacing: 1.2, marginBottom: 12 },
  detailSectionBody:  { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  detailField:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailFieldLabel:   { fontSize: 13, color: '#64748b', fontWeight: '600' },
  detailFieldValue:   { fontSize: 13, color: '#0c1a2e', fontWeight: '700', textAlign: 'right', flex: 1, marginLeft: 12 },

  closeReceiptBtn:     { backgroundColor: '#0f4c81', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  closeReceiptBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Receipt row — per-item breakdown list
  receiptItemsList:       { borderTopWidth: 1, borderTopColor: '#f1f5f9', marginTop: 10, marginBottom: 4 },
  receiptItemRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  receiptItemName:        { fontSize: 13, fontWeight: '700', color: '#0c1a2e' },
  receiptItemFee:         { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  receiptItemRight:       { alignItems: 'flex-end', gap: 4 },
  receiptItemPaid:        { fontSize: 12, fontWeight: '700' },
  receiptItemBalancePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  receiptItemBalanceText: { fontSize: 11, fontWeight: '800' },

  // Receipt detail modal — item rows
  detailItemRow:  { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailItemName: { fontSize: 13, fontWeight: '700', color: '#0c1a2e' },
  detailItemMeta: { fontSize: 11, color: '#94a3b8', marginTop: 3 },

  // ReceiptRow email button
  receiptRowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emailIconBtn:      { width: 32, height: 32, borderRadius: 10, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },

  // Email receipt modal
  emailOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', justifyContent: 'flex-end' },
  emailBackdrop:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  emailSheet:         { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 38 : 24 },
  emailHeader:        { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  emailIconWrap:      { width: 44, height: 44, borderRadius: 14, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  emailTitle:         { fontSize: 18, fontWeight: '800', color: '#0c1a2e' },
  emailSub:           { fontSize: 12, color: '#64748b', marginTop: 2 },
  emailCloseBtn:      { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  emailSummaryStrip:  { flexDirection: 'row', marginHorizontal: 16, marginVertical: 14, backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  emailSummaryCell:   { flex: 1, alignItems: 'center' },
  emailSummaryDivider:{ width: 1, backgroundColor: '#e2e8f0', marginVertical: 2 },
  emailSummaryLabel:  { fontSize: 10, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  emailSummaryValue:  { fontSize: 14, fontWeight: '800', color: '#0c1a2e', marginTop: 4 },
  emailFieldLabel:    { fontSize: 12, fontWeight: '700', color: '#374151', marginHorizontal: 16, marginBottom: 6 },
  emailInputRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 13, marginHorizontal: 16, minHeight: 50 },
  emailInput:         { flex: 1, fontSize: 14, color: '#0c1a2e', paddingVertical: 12 },
  emailHint:          { fontSize: 12, color: '#94a3b8', marginHorizontal: 16, marginTop: 6, marginBottom: 20, lineHeight: 17 },
  emailFooterRow:     { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  emailCancelBtn:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: '#e2e8f0' },
  emailCancelText:    { fontSize: 14, fontWeight: '700', color: '#475569' },
  emailSendBtn:       { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#0f4c81', elevation: 3, shadowColor: '#0f4c81', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  emailSendText:      { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Payment method badge in receipt detail modal
  detailMethodBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-end' },
  detailMethodText:  { fontSize: 13, fontWeight: '700' },

  // Payment method badge in receipt history row
  methodHistoryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  methodHistoryText:  { fontSize: 11, fontWeight: '700' },

  // Receipt label row + hints
  receiptLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  regenBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8f0fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  regenBtnText:    { fontSize: 11, color: '#0f4c81', fontWeight: '700' },
  inputWrapAuto:   { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
  requiredDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 12 },
  receiptHint:     { fontSize: 11, color: '#64748b', marginTop: -10, marginBottom: 14, lineHeight: 16 },

  // Payment method selector — 2 per row
  methodGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  methodBtn:        {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    position: 'relative',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    gap: 8,
  },
  methodBtnFull:    { width: '100%' },
  methodIconWrap:   { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  methodLabel:      { fontSize: 13, color: '#64748b', fontWeight: '600', textAlign: 'center' },
  methodCheck:      { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },

  // QR launch button
  qrLaunchBtn:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f0ff', borderWidth: 1.5, borderColor: '#c4b5fd', borderRadius: 14, padding: 14, marginBottom: 16, gap: 10 },
  qrLaunchText: { flex: 1, fontSize: 14, color: '#5f259f', fontWeight: '700' },
});

// ─── Student Info Card styles ────────────────────────────────────────────────
const si = StyleSheet.create({
  card:         {  flex: 1,backgroundColor: '#fff', marginHorizontal: 4, marginBottom: 0, borderRadius: 24, overflow: 'hidden', elevation: 4, shadowColor: '#0f4c81', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, borderWidth: 1, borderColor: '#25ae9c' },
  topStripe:    { height: 2, backgroundColor: '#0f4c81' },
  body:         { padding: 1 },
  separator: {
    marginVertical: 18,
    borderBottomColor: '#0eed46',
    borderBottomWidth: StyleSheet.hairlineWidth, // Best for a thin, crisp line
  },
  avatarRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatar:       { width: 52, height: 52, borderRadius: 16, backgroundColor: '#0f4c81', alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 20, fontWeight: '900', color: '#fff' },
  studentName:  { fontSize: 17, fontWeight: '800', color: '#0c1a2e', marginBottom: 4 },
  enrollRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  enrollText:   { fontSize: 12, color: '#64748b', fontWeight: '600' },
  enrollDivider:{ fontSize: 12, color: '#cbd5e1', marginHorizontal: 2 },

  statusBadge:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusBadgeText:  { fontSize: 12, fontWeight: '800' },
  actionRow:        { flexDirection: 'row', gap: 8, marginBottom: 8 },
  demandLink:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 6, marginHorizontal: 0,
                      paddingVertical: 9, borderRadius: 10,
                      borderWidth: 1.5, borderColor: '#fca5a5',
                      backgroundColor: '#fff1f2' },
  whatsappLink:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 6,
                      paddingVertical: 9, borderRadius: 10,
                      borderWidth: 1.5, borderColor: '#bbf7d0',
                      backgroundColor: '#f0fdf4' },
  demandLinkTxt:    { fontSize: 12, fontWeight: '700', color: '#b91c1c', letterSpacing: 0.3 },

  chipsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  chip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f7ff', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, gap: 4, borderWidth: 1, borderColor: '#bfdbfe' },
  chipLabel:    { fontSize: 11, color: '#64748b', fontWeight: '600' },
  chipValue:    { fontSize: 11, color: '#0f4c81', fontWeight: '800' },

  financialRow: { flexDirection: 'row', backgroundColor: '#dfe7f0', borderRadius: 14, padding: 12 },
  finCell:      { flex: 1, alignItems: 'center' },
  finDivider:   { width: 1, backgroundColor: '#f9f9fa', marginVertical: 2 },
  finLabel:     { fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  finValue:     { fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
});

// ─── UPI QR Modal styles ──────────────────────────────────────────────────────
const sq = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:          { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 36 : 24, maxHeight: '92%' },

  header:         { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 },
  headerIcon:     { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: 20, fontWeight: '800', color: '#0c1a2e' },
  headerSub:      { fontSize: 13, color: '#64748b', marginTop: 2 },
  closeBtn:       { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },

  amountPill:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 20, backgroundColor: '#f8fafc', borderWidth: 1.5, borderRadius: 16, padding: 14 },
  amountPillLabel:{ fontSize: 13, color: '#64748b', fontWeight: '600' },
  amountPillValue:{ fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },

  qrWrap:         { alignItems: 'center', justifyContent: 'center', marginHorizontal: 20, marginBottom: 16, backgroundColor: '#fafafa', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', minHeight: 296 },
  qrLoader:       { alignItems: 'center', gap: 12, padding: 40 },
  qrLoaderText:   { fontSize: 14, color: '#64748b', fontWeight: '600' },
  qrImage:        { width: 280, height: 280 },
  qrError:        { alignItems: 'center', gap: 8, padding: 40 },
  qrErrorText:    { fontSize: 15, color: '#475569', fontWeight: '700' },
  qrErrorSub:     { fontSize: 13, color: '#94a3b8' },

  upiRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 },
  upiLabel:       { fontSize: 13, color: '#64748b' },
  upiId:          { fontSize: 13, fontWeight: '800', color: '#0c1a2e' },

  steps:          { marginHorizontal: 20, marginBottom: 20, gap: 10 },
  step:           { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum:        { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  stepNumText:    { fontSize: 12, fontWeight: '800', color: '#fff' },
  stepText:       { fontSize: 13, color: '#475569', lineHeight: 20, flex: 1 },

  footer:         { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  cancelBtn:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: '#e2e8f0' },
  cancelBtnText:  { fontSize: 14, fontWeight: '700', color: '#475569' },
  confirmBtn:     { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14 },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});