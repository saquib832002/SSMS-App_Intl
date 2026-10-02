/**
 * screens/StudentActions/CertificateScreen.js
 *
 * Generate school certificates for individual students:
 *   • Transfer Certificate (TC)
 *   • Bonafide Certificate
 *   • Character Certificate
 *   • Conduct Certificate
 *
 * Languages: English · हिंदी · اردو (RTL) · العربية (RTL)
 *
 * Flow: Search student → pick cert type → pick language → fill extra fields → Download PDF
 */
import React, {
  useCallback, useContext, useEffect, useRef, useState,
} from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather }              from "@expo/vector-icons";

// expo-print, expo-sharing, expo-file-system loaded lazily (same pattern as FeeDemandSlipScreen)
let _Print      = null;
let _Sharing    = null;
let _FileSystem = null;
async function loadPdfLibs() {
  if (_Print) return { Print: _Print, Sharing: _Sharing };
  _Print      = await import("expo-print");
  _Sharing    = await import("expo-sharing");
  _FileSystem = await import("expo-file-system");
  return { Print: _Print, Sharing: _Sharing };
}

import { AuthContext }          from "../../context/AuthContext";
import { HOST_NAME }            from "../../Environment/EnvironmentConfig";
import { getEnrolledStudents }  from "../../services/StudentServiceApi";
import { fetchCertificateData } from "../../services/CertificateServiceApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary:  "#1e40af",
  accent:   "#3b82f6",
  bg:       "#f8fafc",
  card:     "#ffffff",
  border:   "#e2e8f0",
  text:     "#0f172a",
  sub:      "#64748b",
  muted:    "#94a3b8",
  green:    "#059669",
  red:      "#dc2626",
};

// ── Languages ─────────────────────────────────────────────────────────────────
const LANGS = [
  { id: "en", label: "English",   dir: "ltr" },
  { id: "hi", label: "हिंदी",      dir: "ltr" },
  { id: "ur", label: "اردو",      dir: "rtl" },
  { id: "ar", label: "العربية",   dir: "rtl" },
];

// ── Translation strings ───────────────────────────────────────────────────────
const L = {
  en: {
    dir:    "ltr",
    font:   "'Times New Roman', Times, serif",
    serial: "Serial No.:",
    date:   "Date:",
    prin:   "Principal / Head of School",
    feeCleared:     "Cleared",
    feeOutstanding: "Outstanding",
    issuedOnRequest: "This certificate is issued on request.",
    certTitle: {
      tc:        "Transfer Certificate",
      bonafide:  "Bonafide Certificate",
      character: "Character Certificate",
      conduct:   "Conduct Certificate",
    },
    tbl: {
      dob:           "Date of Birth",
      gender:        "Gender",
      bg:            "Blood Group",
      classLast:     "Class Last Studied",
      session:       "Academic Session",
      admDate:       "Date of Admission",
      leavingDate:   "Date of Leaving",
      leavingReason: "Reason for Leaving",
      feeStatus:     "Fee Status",
      conduct:       "Conduct & Character",
      admNo:         "Admission Number",
      roll:          "Roll Number",
      classSection:  "Class & Section",
    },
  },
  hi: {
    dir:    "ltr",
    font:   "'Noto Sans Devanagari', 'Mangal', 'Times New Roman', sans-serif",
    serial: "क्रमांक:",
    date:   "तिथि:",
    prin:   "प्रधानाचार्य / विद्यालय प्रमुख",
    feeCleared:     "जमा",
    feeOutstanding: "बकाया",
    issuedOnRequest: "यह प्रमाण पत्र अनुरोध पर जारी किया गया है।",
    certTitle: {
      tc:        "स्थानांतरण प्रमाण पत्र",
      bonafide:  "वास्तविक प्रमाण पत्र",
      character: "चरित्र प्रमाण पत्र",
      conduct:   "आचरण प्रमाण पत्र",
    },
    tbl: {
      dob:           "जन्म तिथि",
      gender:        "लिंग",
      bg:            "रक्त समूह",
      classLast:     "अंतिम कक्षा",
      session:       "शैक्षणिक सत्र",
      admDate:       "प्रवेश तिथि",
      leavingDate:   "विदाई तिथि",
      leavingReason: "विदाई का कारण",
      feeStatus:     "शुल्क स्थिति",
      conduct:       "आचरण एवं चरित्र",
      admNo:         "प्रवेश संख्या",
      roll:          "अनुक्रमांक",
      classSection:  "कक्षा एवं अनुभाग",
    },
  },
  ur: {
    dir:    "rtl",
    font:   "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Times New Roman', serif",
    serial: "سیریل نمبر:",
    date:   "تاریخ:",
    prin:   "پرنسپل / سربراہ ادارہ",
    feeCleared:     "ادا شدہ",
    feeOutstanding: "باقی",
    issuedOnRequest: "یہ سرٹیفکیٹ درخواست پر جاری کیا گیا ہے۔",
    certTitle: {
      tc:        "سرٹیفکیٹ انتقال",
      bonafide:  "بونافائڈ سرٹیفکیٹ",
      character: "کردار سرٹیفکیٹ",
      conduct:   "چال چلن سرٹیفکیٹ",
    },
    tbl: {
      dob:           "تاریخ پیدائش",
      gender:        "جنس",
      bg:            "خون کا گروپ",
      classLast:     "آخری جماعت",
      session:       "تعلیمی سال",
      admDate:       "داخلے کی تاریخ",
      leavingDate:   "روانگی کی تاریخ",
      leavingReason: "روانگی کی وجہ",
      feeStatus:     "فیس کی صورتحال",
      conduct:       "رویہ و کردار",
      admNo:         "داخلہ نمبر",
      roll:          "رول نمبر",
      classSection:  "جماعت و سیکشن",
    },
  },
  ar: {
    dir:    "rtl",
    font:   "'Noto Sans Arabic', 'Arial', sans-serif",
    serial: "رقم التسلسل:",
    date:   "التاريخ:",
    prin:   "المدير / رئيس المدرسة",
    feeCleared:     "مدفوعة",
    feeOutstanding: "متأخرة",
    issuedOnRequest: "تُصدر هذه الشهادة بناءً على الطلب.",
    certTitle: {
      tc:        "شهادة النقل",
      bonafide:  "شهادة الانتساب",
      character: "شهادة الشخصية",
      conduct:   "شهادة السلوك",
    },
    tbl: {
      dob:           "تاريخ الميلاد",
      gender:        "الجنس",
      bg:            "فصيلة الدم",
      classLast:     "آخر صف دراسي",
      session:       "العام الدراسي",
      admDate:       "تاريخ القبول",
      leavingDate:   "تاريخ المغادرة",
      leavingReason: "سبب المغادرة",
      feeStatus:     "حالة الرسوم",
      conduct:       "السلوك والأخلاق",
      admNo:         "رقم القيد",
      roll:          "رقم القائمة",
      classSection:  "الصف والشعبة",
    },
  },
};

// ── Certificate type definitions ──────────────────────────────────────────────
const CERT_TYPES = [
  { id: "tc",        label: "Transfer Certificate",  short: "TC",  icon: "log-out",     color: "#7c3aed", tint: "#ede9fe", desc: "For students leaving the school" },
  { id: "bonafide",  label: "Bonafide Certificate",  short: "BC",  icon: "check-circle", color: "#0891b2", tint: "#cffafe", desc: "Proof of current enrollment" },
  { id: "character", label: "Character Certificate", short: "CC",  icon: "award",        color: "#d97706", tint: "#fef3c7", desc: "Certifies moral character & conduct" },
  { id: "conduct",   label: "Conduct Certificate",   short: "COC", icon: "shield",       color: "#059669", tint: "#d1fae5", desc: "Confirms disciplined behaviour" },
];

// ── Date helpers ──────────────────────────────────────────────────────────────
const LOCALE_MAP = { en: "en-IN", hi: "hi-IN", ur: "ur", ar: "ar-SA" };

function fmtDateLong(isoStr, lang = "en") {
  if (!isoStr) return "N/A";
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleDateString(LOCALE_MAP[lang] || "en-IN", { day: "2-digit", month: "long", year: "numeric" });
}
function todayLong(lang = "en") {
  return fmtDateLong(new Date().toISOString().slice(0, 10), lang);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Language-aware pronouns ───────────────────────────────────────────────────
function pronoun(gender, lang = "en") {
  const female = (gender ?? "").toLowerCase() === "female" || (gender ?? "").toLowerCase() === "f";
  switch (lang) {
    case "hi":
      return { sub: "वह", obj: "उनके", pos: female ? "उनकी" : "उनका", sd: female ? "पुत्री" : "पुत्र" };
    case "ur":
      return { sub: "وہ", obj: "انہیں", pos: female ? "اُن کی" : "اُن کا", sd: female ? "بنت" : "ابن" };
    case "ar":
      return female
        ? { sub: "هي", obj: "لها",  pos: "ها", sd: "ابنة", hes: "كانت", his: "خلال فترة دراستها", conduct: "سلوكها"  }
        : { sub: "هو", obj: "له",   pos: "ه",  sd: "ابن",  hes: "كان",  his: "خلال فترة دراسته", conduct: "سلوكه"   };
    default:
      return female
        ? { sub: "She", obj: "Her", pos: "Her", sd: "daughter" }
        : { sub: "He",  obj: "Him", pos: "His", sd: "son"      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildLetterhead(school, certType, certColor, lang) {
  const l = L[lang] || L.en;
  // Use pre-fetched base64 — expo-print WebView cannot load remote HTTPS URLs
  const logoSrc  = school.logo_b64 || null;
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="Logo" style="height:72px;width:72px;object-fit:contain;flex-shrink:0;" />`
    : `<div style="height:72px;width:72px;border-radius:50%;background:${certColor};display:flex;align-items:center;justify-content:center;color:#fff;font-size:30px;font-weight:900;flex-shrink:0;">${(school.school_name ?? "S")[0].toUpperCase()}</div>`;

  const nameBlock = `
    <div style="text-align:center;">
      <div style="font-size:22px;font-weight:900;color:${certColor};letter-spacing:0.5px;">${school.school_name ?? "School"}</div>
      ${school.school_address ? `<div style="font-size:12px;color:#64748b;margin-top:2px;text-align:center;">${school.school_address}</div>` : ""}
      ${school.school_phone  ? `<div style="font-size:12px;color:#64748b;text-align:center;">Ph: ${school.school_phone}</div>` : ""}
    </div>`;

  const headerRow = l.dir === "rtl"
    ? `<div style="display:flex;justify-content:center;align-items:center;gap:16px;flex-direction:row-reverse;margin-bottom:8px;">${logoHtml}${nameBlock}</div>`
    : `<div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-bottom:8px;">${logoHtml}${nameBlock}</div>`;

  return `
    <div style="text-align:center;border-bottom:2px solid ${certColor};padding-bottom:16px;margin-bottom:24px;">
      ${headerRow}
      <div style="display:inline-block;background:${certColor};color:#fff;font-size:16px;font-weight:800;
                  letter-spacing:2px;padding:6px 32px;border-radius:2px;margin-top:8px;text-transform:uppercase;">
        ${l.certTitle[certType]}
      </div>
    </div>`;
}

function buildSignatureBlock(school, lang) {
  const l      = L[lang] || L.en;
  const sigSrc = school.signature_b64 || null;
  const sig    = sigSrc
    ? `<img src="${sigSrc}" alt="Signature" style="height:48px;max-width:180px;object-fit:contain;display:block;margin-bottom:4px;" />`
    : `<div style="height:40px;border-bottom:1px solid #334155;width:160px;margin-bottom:4px;"></div>`;

  const dateDiv = `<div style="font-size:12px;color:#64748b;">${l.date} ${todayLong(lang)}</div>`;
  const sigDiv  = `
    <div style="text-align:center;">
      ${sig}
      <div style="font-size:13px;font-weight:700;color:#0f172a;">${school.principal_name ?? ""}</div>
      <div style="font-size:11px;color:#64748b;">${l.prin}</div>
      <div style="font-size:11px;color:#64748b;">${school.school_name ?? ""}</div>
    </div>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:48px;${l.dir === "rtl" ? "flex-direction:row-reverse;" : ""}">
      ${dateDiv}
      ${sigDiv}
    </div>`;
}

function baseHtml(body, certColor, lang, logoB64 = null) {
  const l = L[lang] || L.en;
  const watermark = logoB64
    ? `<div style="position:fixed;top:0;left:0;width:100%;height:100%;
                   display:flex;align-items:center;justify-content:center;
                   pointer-events:none;z-index:0;">
         <img src="${logoB64}" style="width:340px;height:340px;object-fit:contain;opacity:0.07;" />
       </div>`
    : "";
  return `<!DOCTYPE html><html dir="${l.dir}"><head>
    <meta charset="utf-8"/>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: ${l.font}; font-size: 14px; color: #0f172a;
             background: #fff; padding: 40px; direction: ${l.dir}; }
      .wrap { max-width: 700px; margin: 0 auto; border: 3px double ${certColor};
              border-radius: 4px; padding: 32px 40px; position: relative; z-index: 1; }
      .field { display: inline-block; border-bottom: 1px solid #334155;
               min-width: 140px; font-weight: 700; padding: 0 2px; }
      .body-text { line-height: 2.2; font-size: 14px; text-align: justify; }
      .serial { font-size: 12px; color: #64748b; margin-bottom: 12px;
                text-align: ${l.dir === "rtl" ? "left" : "right"}; }
      td { padding: 4px 8px; font-size: 13px; vertical-align: top; }
      .lbl { width: 42%; color: #334155; }
      .val { font-weight: 700; }
    </style>
  </head><body>
    ${watermark}
    <div class="wrap">
      ${body}
    </div>
  </body></html>`;
}

function trow(label, value) {
  return `<tr><td class="lbl">${label}</td><td class="val">: ${value}</td></tr>`;
}

// ── Transfer Certificate ──────────────────────────────────────────────────────
function buildTransferCertHtml(student, school, extra, lang) {
  const l       = L[lang] || L.en;
  const color   = "#7c3aed";
  const p       = pronoun(student.gender, lang);
  const serial  = `TC-${student.enrollment_id}-${new Date().getFullYear()}`;
  const admNo   = student.admission_number || student.roll_number || "—";
  const leaving = extra.leavingDate || todayISO();
  const reason  = extra.reason      || (lang === "hi" ? "अभिभावक का अनुरोध" : lang === "ur" ? "والدین کی درخواست" : lang === "ar" ? "طلب ولي الأمر" : "Parent's request");
  const conduct = extra.conduct     || (lang === "hi" ? "अच्छा" : lang === "ur" ? "اچھا" : lang === "ar" ? "جيد" : "Good");
  const feeVal  = extra.feeCleared  ? l.feeCleared : l.feeOutstanding;

  let body1, body2;
  switch (lang) {
    case "hi":
      body1 = `यह प्रमाणित किया जाता है कि <span class="field">${student.student_name}</span>, ${p.sd} <span class="field">${student.father_name || "_______________"}</span> एवं <span class="field">${student.mother_name || "_______________"}</span>, प्रवेश संख्या <span class="field">${admNo}</span>, इस संस्था के एक वास्तविक छात्र/छात्रा रह चुके हैं।`;
      body2 = `${p.sub} किसी अन्य संस्था में प्रवेश लेने में स्वतंत्र हैं। ${l.issuedOnRequest}`;
      break;
    case "ur":
      body1 = `یہ تصدیق کی جاتی ہے کہ <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span> اور <span class="field">${student.mother_name || "_______________"}</span>، داخلہ نمبر <span class="field">${admNo}</span>، اس ادارے کے سند یافتہ طالب علم رہے ہیں۔`;
      body2 = `${p.sub} کسی دوسرے ادارے میں داخلہ لینے کے لیے آزاد ہیں۔ ${l.issuedOnRequest}`;
      break;
    case "ar":
      body1 = `نشهد بأن <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span> و<span class="field">${student.mother_name || "_______________"}</span>، رقم القيد <span class="field">${admNo}</span>، ${p.hes} طالباً منتظماً في هذه المؤسسة.`;
      body2 = `لا مانع لديه/لديها من الالتحاق بأي مؤسسة أخرى. ${l.issuedOnRequest}`;
      break;
    default:
      body1 = `This is to certify that <span class="field">${student.student_name}</span>, son/daughter of <span class="field">${student.father_name || "_______________"}</span> and <span class="field">${student.mother_name || "_______________"}</span>, bearing Admission No. <span class="field">${admNo}</span>, was a bonafide student of this institution.`;
      body2 = `${p.sub} has no objection for seeking admission in any other institution. ${l.issuedOnRequest}`;
  }

  const body = `
    ${buildLetterhead(school, "tc", color, lang)}
    <div class="serial">${l.serial} <strong>${serial}</strong></div>
    <p class="body-text">${body1}</p>
    <table style="margin:20px 0;border-collapse:collapse;width:100%;">
      ${trow(l.tbl.dob,           fmtDateLong(student.dob, lang))}
      ${trow(l.tbl.gender,        student.gender || "—")}
      ${trow(l.tbl.bg,            student.blood_group || "—")}
      ${trow(l.tbl.classLast,     `${student.class_name} — ${student.section_name}`)}
      ${trow(l.tbl.session,       student.session_name || "—")}
      ${trow(l.tbl.admDate,       fmtDateLong(student.admission_date, lang))}
      ${trow(l.tbl.leavingDate,   fmtDateLong(leaving, lang))}
      ${trow(l.tbl.leavingReason, reason)}
      ${trow(l.tbl.feeStatus,     feeVal)}
      ${trow(l.tbl.conduct,       conduct)}
    </table>
    <p class="body-text">${body2}</p>
    ${buildSignatureBlock(school, lang)}`;

  return baseHtml(body, color, lang, school.logo_b64 ?? null);
}

// ── Bonafide Certificate ──────────────────────────────────────────────────────
function buildBonafideCertHtml(student, school, extra, lang) {
  const l      = L[lang] || L.en;
  const color  = "#0891b2";
  const p      = pronoun(student.gender, lang);
  const serial = `BON-${student.enrollment_id}-${new Date().getFullYear()}`;
  const purpose = extra.purpose || (lang === "hi" ? "सरकारी उद्देश्य" : lang === "ur" ? "سرکاری مقصد" : lang === "ar" ? "الأغراض الرسمية" : "official purpose");

  let body1, body2;
  switch (lang) {
    case "hi":
      body1 = `यह प्रमाणित किया जाता है कि <span class="field">${student.student_name}</span>, ${p.sd} <span class="field">${student.father_name || "_______________"}</span>, शैक्षणिक सत्र <span class="field">${student.session_name || "_______________"}</span> के लिए इस संस्था के एक वास्तविक छात्र/छात्रा हैं।`;
      body2 = `यह प्रमाण पत्र <strong>${purpose}</strong> के लिए अनुरोध पर जारी किया गया है।`;
      break;
    case "ur":
      body1 = `یہ تصدیق کی جاتی ہے کہ <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span>، تعلیمی سال <span class="field">${student.session_name || "_______________"}</span> کے لیے اس ادارے کے باضابطہ طالب علم ہیں۔`;
      body2 = `یہ سرٹیفکیٹ <strong>${purpose}</strong> کے لیے درخواست پر جاری کیا گیا ہے۔`;
      break;
    case "ar":
      body1 = `نشهد بأن <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span>، طالب/طالبة منتظم/منتظمة في هذه المؤسسة للعام الدراسي <span class="field">${student.session_name || "_______________"}</span>.`;
      body2 = `تُصدر هذه الشهادة بناءً على الطلب لـ<strong>${purpose}</strong>.`;
      break;
    default:
      body1 = `This is to certify that <span class="field">${student.student_name}</span>, son/daughter of <span class="field">${student.father_name || "_______________"}</span>, is a bonafide student of this institution for the academic session <span class="field">${student.session_name || "_______________"}</span>.`;
      body2 = `This certificate is issued on request for <strong>${purpose}</strong>.`;
  }

  const body = `
    ${buildLetterhead(school, "bonafide", color, lang)}
    <div class="serial">${l.serial} <strong>${serial}</strong></div>
    <p class="body-text">${body1}</p>
    <table style="margin:20px 0;border-collapse:collapse;width:100%;">
      ${trow(l.tbl.admNo,       student.admission_number || "—")}
      ${trow(l.tbl.roll,        student.roll_number || "—")}
      ${trow(l.tbl.classSection,`${student.class_name} — ${student.section_name}`)}
      ${trow(l.tbl.session,     student.session_name || "—")}
      ${trow(l.tbl.dob,         fmtDateLong(student.dob, lang))}
      ${trow(l.tbl.admDate,     fmtDateLong(student.admission_date, lang))}
    </table>
    <p class="body-text">${body2}</p>
    ${buildSignatureBlock(school, lang)}`;

  return baseHtml(body, color, lang, school.logo_b64 ?? null);
}

// ── Character Certificate ─────────────────────────────────────────────────────
function buildCharacterCertHtml(student, school, extra, lang) {
  const l       = L[lang] || L.en;
  const color   = "#d97706";
  const p       = pronoun(student.gender, lang);
  const serial  = `CHR-${student.enrollment_id}-${new Date().getFullYear()}`;
  const conduct = extra.conduct || (lang === "hi" ? "अच्छा" : lang === "ur" ? "اچھا" : lang === "ar" ? "جيد" : "Good");

  let body1, body2, body3;
  switch (lang) {
    case "hi":
      body1 = `यह प्रमाणित किया जाता है कि <span class="field">${student.student_name}</span>, ${p.sd} <span class="field">${student.father_name || "_______________"}</span>, ${student.admission_date ? `<strong>${fmtDateLong(student.admission_date, lang)}</strong> से ` : ""}इस संस्था में कक्षा <span class="field">${student.class_name || "___"}</span>, अनुभाग <span class="field">${student.section_name || "___"}</span> के एक वास्तविक छात्र/छात्रा रहे।`;
      body2 = `इस संस्था में अपने प्रवास के दौरान उनका नैतिक चरित्र उत्कृष्ट रहा। वे ईमानदार स्वभाव के और <span class="field">${conduct}</span> आचरण वाले पाए गए। वे नियमित, समयनिष्ठ और शिक्षकों एवं साथियों का सम्मान करने वाले रहे।`;
      body3 = `हम ${p.obj} उज्जवल भविष्य की कामना करते हैं।`;
      break;
    case "ur":
      body1 = `یہ تصدیق کی جاتی ہے کہ <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span>، ${student.admission_date ? `<strong>${fmtDateLong(student.admission_date, lang)}</strong> سے ` : ""}اس ادارے میں جماعت <span class="field">${student.class_name || "___"}</span>، سیکشن <span class="field">${student.section_name || "___"}</span> کے باضابطہ طالب علم رہے۔`;
      body2 = `اس ادارے میں اپنے قیام کے دوران اُن کا اخلاق و کردار نہایت عمدہ رہا۔ وہ مخلص مزاج اور <span class="field">${conduct}</span> رویے کے حامل پائے گئے۔ وہ باقاعدہ، وقت کے پابند اور اساتذہ و ساتھیوں کے ساتھ احترام سے پیش آتے رہے۔`;
      body3 = `ہم اُن کی آنے والی زندگی میں کامیابی کی دعا کرتے ہیں۔`;
      break;
    case "ar":
      body1 = `نشهد بأن <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span>، ${p.hes} طالباً منتظماً في هذه المؤسسة${student.admission_date ? ` منذ <strong>${fmtDateLong(student.admission_date, lang)}</strong>` : ""} في الصف <span class="field">${student.class_name || "___"}</span>، الشعبة <span class="field">${student.section_name || "___"}</span>.`;
      body2 = `${p.his}، أبدى/أبدت سلوكاً أخلاقياً رفيعاً. كان/كانت صادقاً في تصرفاته وذا سلوك <span class="field">${conduct}</span>. كان/كانت منتظماً، ملتزماً بالمواعيد، ومحترماً لأساتذته وزملائه.`;
      body3 = `نتمنى له/لها التوفيق والنجاح في مستقبله/مستقبلها.`;
      break;
    default:
      body1 = `This is to certify that <span class="field">${student.student_name}</span>, son/daughter of <span class="field">${student.father_name || "_______________"}</span>, was a bonafide student of this institution${student.admission_date ? ` from <strong>${fmtDateLong(student.admission_date, lang)}</strong>` : ""} in Class <span class="field">${student.class_name || "___"}</span>, Section <span class="field">${student.section_name || "___"}</span>.`;
      body2 = `During ${p.pos.toLowerCase()} stay in this institution, ${p.sub.toLowerCase()} bore an excellent moral character. ${p.sub} was found to be of sincere disposition and <span class="field">${conduct}</span> conduct. ${p.sub} was regular, punctual, and showed respect to teachers and peers alike.`;
      body3 = `We wish ${p.obj.toLowerCase()} all success in ${p.pos.toLowerCase()} future endeavours.`;
  }

  const body = `
    ${buildLetterhead(school, "character", color, lang)}
    <div class="serial">${l.serial} <strong>${serial}</strong></div>
    <p class="body-text">${body1}</p>
    <br/>
    <p class="body-text">${body2}</p>
    <br/>
    <p class="body-text">${body3}</p>
    ${buildSignatureBlock(school, lang)}`;

  return baseHtml(body, color, lang, school.logo_b64 ?? null);
}

// ── Conduct Certificate ───────────────────────────────────────────────────────
function buildConductCertHtml(student, school, extra, lang) {
  const l       = L[lang] || L.en;
  const color   = "#059669";
  const p       = pronoun(student.gender, lang);
  const serial  = `CON-${student.enrollment_id}-${new Date().getFullYear()}`;
  const conduct = extra.conduct || (lang === "hi" ? "उत्कृष्ट" : lang === "ur" ? "بہترین" : lang === "ar" ? "ممتاز" : "Excellent");

  let body1, body2, body3;
  switch (lang) {
    case "hi":
      body1 = `यह प्रमाणित किया जाता है कि <span class="field">${student.student_name}</span>, ${p.sd} <span class="field">${student.father_name || "_______________"}</span>, अनुक्रमांक <span class="field">${student.roll_number || "___"}</span>, कक्षा <span class="field">${student.class_name || "___"}</span>, अनुभाग <span class="field">${student.section_name || "___"}</span>, शैक्षणिक सत्र <span class="field">${student.session_name || "_______________"}</span> के दौरान इस संस्था के छात्र/छात्रा रहे।`;
      body2 = `इस संस्था में अध्ययन के पूरे काल में उनका आचरण <strong>${conduct}</strong> रहा। वे अनुशासित, सहयोगी और शिक्षकों एवं सहपाठियों के प्रति सम्मानशील थे। उनके विरुद्ध कभी कोई अनुशासनात्मक कार्रवाई नहीं की गई।`;
      body3 = `यह प्रमाण पत्र उनके अनुरोध पर जारी किया गया है।`;
      break;
    case "ur":
      body1 = `یہ تصدیق کی جاتی ہے کہ <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span>، رول نمبر <span class="field">${student.roll_number || "___"}</span>، جماعت <span class="field">${student.class_name || "___"}</span>، سیکشن <span class="field">${student.section_name || "___"}</span>، تعلیمی سال <span class="field">${student.session_name || "_______________"}</span> کے دوران اس ادارے کے طالب علم رہے۔`;
      body2 = `اس ادارے میں تعلیم کے پورے عرصے میں اُن کا رویہ <strong>${conduct}</strong> رہا۔ وہ منضبط، تعاون کرنے والے اور اساتذہ و ہم جماعتوں کا احترام کرنے والے تھے۔ اُن کے خلاف کبھی کوئی تادیبی کارروائی نہیں کی گئی۔`;
      body3 = `یہ سرٹیفکیٹ اُن کی درخواست پر جاری کیا گیا ہے۔`;
      break;
    case "ar":
      body1 = `نشهد بأن <span class="field">${student.student_name}</span>، ${p.sd} <span class="field">${student.father_name || "_______________"}</span>، رقم القائمة <span class="field">${student.roll_number || "___"}</span>، الصف <span class="field">${student.class_name || "___"}</span>، الشعبة <span class="field">${student.section_name || "___"}</span>، ${p.hes} طالباً في هذه المؤسسة خلال العام الدراسي <span class="field">${student.session_name || "_______________"}</span>.`;
      body2 = `كان/كانت ${p.conduct} خلال فترة الدراسة في هذه المؤسسة <strong>${conduct}</strong>. كان/كانت منضبطاً، متعاوناً، ومحترماً لأساتذته وزملائه. ولم تُتخذ بحقه أي إجراءات تأديبية.`;
      body3 = `تُصدر هذه الشهادة بناءً على طلبه/طلبها.`;
      break;
    default:
      body1 = `This is to certify that <span class="field">${student.student_name}</span>, son/daughter of <span class="field">${student.father_name || "_______________"}</span>, Roll No. <span class="field">${student.roll_number || "___"}</span>, Class <span class="field">${student.class_name || "___"}</span>, Section <span class="field">${student.section_name || "___"}</span>, was a student of this institution during the academic session <span class="field">${student.session_name || "_______________"}</span>.`;
      body2 = `${p.pos} conduct during the entire period of study at this institution was <strong>${conduct}</strong>. ${p.sub} was disciplined, cooperative, and respectful towards teachers and fellow students. No disciplinary action was ever taken against ${p.obj.toLowerCase()}.`;
      body3 = `This certificate is issued on ${p.pos.toLowerCase()} request.`;
  }

  const body = `
    ${buildLetterhead(school, "conduct", color, lang)}
    <div class="serial">${l.serial} <strong>${serial}</strong></div>
    <p class="body-text">${body1}</p>
    <br/>
    <p class="body-text">${body2}</p>
    <br/>
    <p class="body-text">${body3}</p>
    ${buildSignatureBlock(school, lang)}`;

  return baseHtml(body, color, lang, school.logo_b64 ?? null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component helpers
// ─────────────────────────────────────────────────────────────────────────────
function FieldInput({ label, value, onChange, placeholder, keyboardType }) {
  return (
    <View style={S.fieldWrap}>
      <Text style={S.fieldLabel}>{label}</Text>
      <TextInput
        style={S.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? ""}
        placeholderTextColor={C.muted}
        keyboardType={keyboardType ?? "default"}
      />
    </View>
  );
}

function ConductPicker({ value, onChange, options }) {
  const opts = options ?? ["Excellent", "Very Good", "Good", "Satisfactory"];
  return (
    <View style={S.fieldWrap}>
      <Text style={S.fieldLabel}>Conduct / Character</Text>
      <View style={S.conductRow}>
        {opts.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[S.conductChip, value === opt && S.conductChipSel]}
            onPress={() => onChange(opt)}
          >
            <Text style={[S.conductChipTxt, value === opt && { color: "#fff" }]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function InfoRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <View style={S.infoRow}>
      <Feather name={icon} size={14} color={C.sub} />
      <Text style={S.infoLabel}>{label}:</Text>
      <Text style={S.infoVal} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function CertificateScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const insets   = useSafeAreaInsets();

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchText,    setSearchText]    = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [showList,      setShowList]      = useState(false);
  const searchTimer = useRef(null);

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedEnroll, setSelectedEnroll] = useState(null);
  const [certType,       setCertType]       = useState(null);
  const [certLang,       setCertLang]       = useState("en");

  // ── Extra fields ──────────────────────────────────────────────────────────
  const [leavingDate, setLeavingDate] = useState(todayISO());
  const [reason,      setReason]      = useState("Parent's request");
  const [conduct,     setConduct]     = useState("Good");
  const [feeCleared,  setFeeCleared]  = useState(true);
  const [purpose,     setPurpose]     = useState("official purpose");

  // ── PDF state ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchText.trim()) {
      setSearchResults([]);
      setShowList(false);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { students } = await getEnrolledStudents(user, { search: searchText.trim(), limit: 20 });
        setSearchResults(students);
        setShowList(true);
      } catch { /* fail silently */ }
      finally { setSearching(false); }
    }, 400);
  }, [searchText]);

  const normStudent = useCallback((s) => ({
    enrollment_id: s.enrollmentId ?? s.enrollment_id,
    student_name:  s.student_name ?? (s.firstName ? `${s.firstName} ${s.lastName ?? ""}`.trim() : null) ?? "—",
    class_name:    s.className   ?? s.class_name   ?? "",
    section_name:  s.section     ?? s.sectionName  ?? s.section_name ?? "",
    father_name:   s.fatherName  ?? s.father_name  ?? "",
  }), []);

  const selectStudent = useCallback((s) => {
    const norm = normStudent(s);
    setSelectedEnroll(norm);
    setSearchText(norm.student_name);
    setShowList(false);
    setCertType(null);
  }, [normStudent]);

  const clearStudent = useCallback(() => {
    setSelectedEnroll(null);
    setSearchText("");
    setShowList(false);
    setCertType(null);
  }, []);

  // ── PDF Export ────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!selectedEnroll || !certType) return;
    setExporting(true);
    try {
      const { Print, Sharing } = await loadPdfLibs();
      const { student, school } = await fetchCertificateData(user, selectedEnroll.enrollment_id);

      // ── Logo + signature are base64-encoded by the PHP controller ───────────
      // The API now returns logo_b64 and signature_b64 as data URIs directly,
      // so no client-side image fetching is needed.
      const schoolWithImages = {
        ...school,
        logo_b64:      school.logo_b64      ?? null,
        signature_b64: school.signature_b64 ?? null,
      };
      const extra = { leavingDate, reason, conduct, feeCleared, purpose };

      let html, title;
      if (certType === "tc") {
        html  = buildTransferCertHtml(student, schoolWithImages, extra, certLang);
        title = `TC_${student.student_name}_${new Date().getFullYear()}`;
      } else if (certType === "bonafide") {
        html  = buildBonafideCertHtml(student, schoolWithImages, extra, certLang);
        title = `Bonafide_${student.student_name}`;
      } else if (certType === "character") {
        html  = buildCharacterCertHtml(student, schoolWithImages, extra, certLang);
        title = `Character_Cert_${student.student_name}`;
      } else {
        html  = buildConductCertHtml(student, schoolWithImages, extra, certLang);
        title = `Conduct_Cert_${student.student_name}`;
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType:    "application/pdf",
          dialogTitle: `${title}.pdf`,
          UTI:         "com.adobe.pdf",
        });
      } else {
        Alert.alert("PDF Ready", `Saved to:\n${uri}`);
      }
    } catch (e) {
      Alert.alert("Export Failed", e.message ?? "Could not generate certificate.");
    } finally {
      setExporting(false);
    }
  }, [selectedEnroll, certType, certLang, user, leavingDate, reason, conduct, feeCleared, purpose]);

  // ── Render ────────────────────────────────────────────────────────────────
  const certTypeDef = CERT_TYPES.find(c => c.id === certType);

  return (
    <SafeAreaView style={S.safe} edges={["left", "right", "bottom"]}>
      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>Certificates</Text>
          <Text style={S.headerSub}>Transfer · Bonafide · Character · Conduct</Text>
        </View>
        <Feather name="file-text" size={22} color="rgba(255,255,255,0.6)" />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Step 1: Student search ── */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>
              <Feather name="search" size={14} /> Step 1 — Select Student
            </Text>

            <View style={S.searchBox}>
              <Feather name="user" size={16} color={C.sub} style={{ marginRight: 8 }} />
              <TextInput
                style={S.searchInput}
                value={searchText}
                onChangeText={v => {
                  setSearchText(v);
                  if (selectedEnroll) setSelectedEnroll(null);
                }}
                placeholder="Search student by name…"
                placeholderTextColor={C.muted}
                returnKeyType="search"
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={clearStudent}>
                  <Feather name="x" size={16} color={C.sub} />
                </TouchableOpacity>
              )}
              {searching && <ActivityIndicator size="small" color={C.primary} style={{ marginLeft: 6 }} />}
            </View>

            {showList && searchResults.length > 0 && (
              <View style={S.dropdown}>
                {searchResults.map((s) => {
                  const norm = normStudent(s);
                  return (
                    <TouchableOpacity
                      key={norm.enrollment_id}
                      style={S.dropdownRow}
                      onPress={() => selectStudent(s)}
                    >
                      <View style={S.dropdownAvatar}>
                        <Text style={S.dropdownAvatarTxt}>{(norm.student_name[0] ?? "?").toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.dropdownName}>{norm.student_name}</Text>
                        <Text style={S.dropdownSub}>
                          Class {norm.class_name} {norm.section_name} · #{norm.enrollment_id}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={C.muted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {showList && searchResults.length === 0 && !searching && (
              <View style={S.emptyDropdown}>
                <Text style={{ color: C.muted, fontSize: 13 }}>No students found</Text>
              </View>
            )}

            {selectedEnroll && (
              <View style={S.selectedCard}>
                <Feather name="check-circle" size={18} color={C.green} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={S.selectedName}>{selectedEnroll.student_name}</Text>
                  <Text style={S.selectedSub}>
                    Class {selectedEnroll.class_name} {selectedEnroll.section_name}
                    {" · "}Enroll #{selectedEnroll.enrollment_id}
                  </Text>
                </View>
                <TouchableOpacity onPress={clearStudent} style={S.clearBtn}>
                  <Feather name="x" size={14} color={C.red} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── Step 2: Certificate type ── */}
          {selectedEnroll && (
            <View style={S.section}>
              <Text style={S.sectionTitle}>
                <Feather name="file" size={14} /> Step 2 — Choose Certificate Type
              </Text>
              <View style={S.certTypeGrid}>
                {CERT_TYPES.map(ct => (
                  <TouchableOpacity
                    key={ct.id}
                    style={[
                      S.certTypeCard,
                      { borderColor: certType === ct.id ? ct.color : C.border },
                      certType === ct.id && { backgroundColor: ct.tint },
                    ]}
                    onPress={() => setCertType(ct.id)}
                    activeOpacity={0.75}
                  >
                    <View style={[S.certTypeIcon, { backgroundColor: ct.color }]}>
                      <Feather name={ct.icon} size={20} color="#fff" />
                    </View>
                    <Text style={[S.certTypeLabel, certType === ct.id && { color: ct.color }]}>
                      {ct.label}
                    </Text>
                    <Text style={S.certTypeDesc}>{ct.desc}</Text>
                    {certType === ct.id && (
                      <View style={[S.certTypeCheck, { backgroundColor: ct.color }]}>
                        <Feather name="check" size={11} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Step 3: Language ── */}
          {selectedEnroll && certType && (
            <View style={S.section}>
              <Text style={S.sectionTitle}>
                <Feather name="globe" size={14} /> Step 3 — Certificate Language
              </Text>
              <View style={S.langRow}>
                {LANGS.map(lg => (
                  <TouchableOpacity
                    key={lg.id}
                    style={[S.langChip, certLang === lg.id && S.langChipSel]}
                    onPress={() => setCertLang(lg.id)}
                  >
                    <Text style={[S.langChipTxt, certLang === lg.id && S.langChipTxtSel]}>
                      {lg.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Step 4: Certificate details & export ── */}
          {selectedEnroll && certType && (
            <View style={S.section}>
              <Text style={S.sectionTitle}>
                <Feather name="edit-2" size={14} /> Step 4 — Certificate Details
              </Text>

              {certType === "tc" && (
                <>
                  <FieldInput
                    label="Date of Leaving"
                    value={leavingDate}
                    onChange={setLeavingDate}
                    placeholder="YYYY-MM-DD"
                  />
                  <FieldInput
                    label="Reason for Leaving"
                    value={reason}
                    onChange={setReason}
                    placeholder="e.g. Parent's request, relocation…"
                  />
                  <ConductPicker value={conduct} onChange={setConduct} />
                  <View style={S.fieldWrap}>
                    <Text style={S.fieldLabel}>Fee Status</Text>
                    <View style={S.feeToggleRow}>
                      <TouchableOpacity
                        style={[S.feeChip, feeCleared && S.feeChipSel]}
                        onPress={() => setFeeCleared(true)}
                      >
                        <Text style={[S.feeChipTxt, feeCleared && { color: "#fff" }]}>✓ Cleared</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.feeChip, !feeCleared && S.feeChipSelRed]}
                        onPress={() => setFeeCleared(false)}
                      >
                        <Text style={[S.feeChipTxt, !feeCleared && { color: "#fff" }]}>⚠ Outstanding</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}

              {certType === "bonafide" && (
                <FieldInput
                  label="Purpose"
                  value={purpose}
                  onChange={setPurpose}
                  placeholder="e.g. bank account, passport, scholarship…"
                />
              )}

              {(certType === "character" || certType === "conduct") && (
                <ConductPicker value={conduct} onChange={setConduct} />
              )}

              {/* Preview summary */}
              <View style={[S.previewBanner, { borderColor: certTypeDef?.color ?? C.border }]}>
                <View style={S.previewBannerHead}>
                  <View style={[S.previewDot, { backgroundColor: certTypeDef?.color ?? C.primary }]} />
                  <Text style={[S.previewBannerTitle, { color: certTypeDef?.color ?? C.primary }]}>
                    {certTypeDef?.label}
                  </Text>
                  <View style={S.langBadge}>
                    <Text style={S.langBadgeTxt}>{LANGS.find(l => l.id === certLang)?.label}</Text>
                  </View>
                </View>
                <InfoRow icon="user"     label="Student" value={selectedEnroll?.student_name} />
                <InfoRow icon="users"    label="Father"  value={selectedEnroll?.father_name} />
                <InfoRow icon="book"     label="Class"   value={`${selectedEnroll?.class_name ?? ""} ${selectedEnroll?.section_name ?? ""}`} />
                {certType === "tc"       && <InfoRow icon="calendar" label="Leaving" value={fmtDateLong(leavingDate)} />}
                {certType === "bonafide" && <InfoRow icon="info"     label="Purpose" value={purpose} />}
                {certType !== "bonafide" && <InfoRow icon="shield"   label="Conduct" value={conduct} />}
              </View>

              {/* Export button */}
              <TouchableOpacity
                style={[S.exportBtn, exporting && { opacity: 0.7 }]}
                onPress={handleExport}
                disabled={exporting}
              >
                {exporting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name="download" size={18} color="#fff" />
                }
                <Text style={S.exportBtnTxt}>
                  {exporting ? "Generating PDF…" : "Download Certificate PDF"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: C.bg },

  header:     { backgroundColor: C.primary, flexDirection: "row", alignItems: "center",
                paddingHorizontal: 14, paddingBottom: 12 },
  backBtn:    { marginRight: 12 },
  headerTitle:{ color: "#fff", fontSize: 18, fontWeight: "800" },
  headerSub:  { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 1 },

  section:    { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
                padding: 16, marginBottom: 14 },
  sectionTitle:{ fontSize: 13, fontWeight: "700", color: C.sub, marginBottom: 12,
                 textTransform: "uppercase", letterSpacing: 0.5 },

  searchBox:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.border,
                borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#f8fafc" },
  searchInput:{ flex: 1, fontSize: 14, color: C.text, paddingVertical: 2 },

  dropdown:      { marginTop: 4, borderWidth: 1, borderColor: C.border, borderRadius: 10,
                   backgroundColor: C.card, overflow: "hidden" },
  dropdownRow:   { flexDirection: "row", alignItems: "center", padding: 12,
                   borderBottomWidth: 1, borderBottomColor: C.border },
  dropdownAvatar:{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.primary,
                   alignItems: "center", justifyContent: "center", marginRight: 10 },
  dropdownAvatarTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  dropdownName:  { fontSize: 14, fontWeight: "700", color: C.text },
  dropdownSub:   { fontSize: 12, color: C.sub, marginTop: 1 },
  emptyDropdown: { padding: 12, alignItems: "center", borderWidth: 1, borderColor: C.border,
                   borderRadius: 10, marginTop: 4 },

  selectedCard: { flexDirection: "row", alignItems: "center", marginTop: 12,
                  backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#bbf7d0",
                  borderRadius: 10, padding: 12 },
  selectedName: { fontSize: 14, fontWeight: "700", color: "#065f46" },
  selectedSub:  { fontSize: 12, color: "#059669", marginTop: 1 },
  clearBtn:     { padding: 4 },

  certTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  certTypeCard: { width: "47%", borderWidth: 2, borderRadius: 12, padding: 14,
                  backgroundColor: C.card, position: "relative" },
  certTypeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center",
                  justifyContent: "center", marginBottom: 8 },
  certTypeLabel:{ fontSize: 13, fontWeight: "800", color: C.text, marginBottom: 4 },
  certTypeDesc: { fontSize: 11, color: C.sub, lineHeight: 16 },
  certTypeCheck:{ position: "absolute", top: 8, right: 8, width: 18, height: 18,
                  borderRadius: 9, alignItems: "center", justifyContent: "center" },

  // Language picker
  langRow:       { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  langChip:      { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 22,
                   borderWidth: 1.5, borderColor: C.border, backgroundColor: "#f8fafc" },
  langChipSel:   { backgroundColor: C.primary, borderColor: C.primary },
  langChipTxt:   { fontSize: 14, color: C.text, fontWeight: "600" },
  langChipTxtSel:{ color: "#fff" },

  fieldWrap:  { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.sub, marginBottom: 6,
                textTransform: "uppercase", letterSpacing: 0.3 },
  fieldInput: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12,
                paddingVertical: 9, fontSize: 14, color: C.text, backgroundColor: "#f8fafc" },

  conductRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  conductChip:    { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                    borderWidth: 1, borderColor: C.border, backgroundColor: "#f8fafc" },
  conductChipSel: { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  conductChipTxt: { fontSize: 13, color: C.text, fontWeight: "600" },

  feeToggleRow: { flexDirection: "row", gap: 10 },
  feeChip:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
                  borderWidth: 1, borderColor: C.border, backgroundColor: "#f8fafc" },
  feeChipTxt:   { fontSize: 13, color: C.text, fontWeight: "600" },
  feeChipSel:   { backgroundColor: "#059669", borderColor: "#059669" },
  feeChipSelRed:{ backgroundColor: "#dc2626", borderColor: "#dc2626" },

  previewBanner:     { borderWidth: 1.5, borderRadius: 10, padding: 14, marginBottom: 16,
                       backgroundColor: "#fafafa" },
  previewBannerHead: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  previewDot:        { width: 10, height: 10, borderRadius: 5 },
  previewBannerTitle:{ fontSize: 14, fontWeight: "800", flex: 1 },
  langBadge:         { backgroundColor: "#e0e7ff", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  langBadgeTxt:      { fontSize: 11, color: "#3730a3", fontWeight: "700" },
  infoRow:           { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 5 },
  infoLabel:         { fontSize: 12, color: C.sub, fontWeight: "600", minWidth: 52 },
  infoVal:           { fontSize: 12, color: C.text, fontWeight: "700", flex: 1 },

  exportBtn:    { backgroundColor: C.primary, flexDirection: "row", alignItems: "center",
                  justifyContent: "center", gap: 10, paddingVertical: 14,
                  borderRadius: 12, marginTop: 4 },
  exportBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
