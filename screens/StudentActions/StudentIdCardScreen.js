/**
 * StudentIdCardScreen.js
 * Place at: screens/StudentActions/StudentIdCardScreen.js
 *
 * Generates class-wise student ID cards — 3 per A4 page, exported as PDF.
 *
 * Dependencies (run once):
 *   npx expo install expo-print expo-sharing
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,Pressable,
  Alert, StyleSheet, Image, FlatList, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AuthContext } from "../../context/AuthContext";
import { fetchClasses, fetchSessions, fetchBranches, fetchSections, fetchIdCardData } from "../../services/StudentServiceApi";
import { HOST_NAME as _HOST_NAME } from "../../Environment/EnvironmentConfig";
import { fetchIdCardConfig, ID_CARD_CONFIG_DEFAULTS } from "../../services/SchoolSettingsServiceApi";

// Strip trailing slash so URL construction never produces double //
const HOST_NAME = _HOST_NAME.replace(/\/+$/, '');


// expo-print and expo-sharing must be installed:
//   npx expo install expo-print expo-sharing
 
// ─── Preset colour themes ─────────────────────────────────────────────────────
const THEMES = [
  {
    id: "indigo", name: "Indigo Royal",
    header: { bg: "#4338ca", text: "#fff", sub: "#c7d2fe", border: "#6366f1" },
    body:   { bg: "#fef9c3", border: "#fbbf24", nameTxt: "#312e81" },
    footer: { bg: "#be185d", text: "#fce7f3", sub: "#fbcfe8" },
  },
  {
    id: "emerald", name: "Emerald Forest",
    header: { bg: "#065f46", text: "#fff", sub: "#a7f3d0", border: "#10b981" },
    body:   { bg: "#f0fdf4", border: "#6ee7b7", nameTxt: "#064e3b" },
    footer: { bg: "#0369a1", text: "#e0f2fe", sub: "#bae6fd" },
  },
  {
    id: "crimson", name: "Crimson Gold",
    header: { bg: "#991b1b", text: "#fff", sub: "#fecaca", border: "#ef4444" },
    body:   { bg: "#fffbeb", border: "#fcd34d", nameTxt: "#7c2d12" },
    footer: { bg: "#78350f", text: "#fef3c7", sub: "#fde68a" },
  },
  {
    id: "ocean", name: "Ocean Blue",
    header: { bg: "#0c4a6e", text: "#fff", sub: "#bae6fd", border: "#0284c7" },
    body:   { bg: "#f0f9ff", border: "#7dd3fc", nameTxt: "#0c4a6e" },
    footer: { bg: "#1e3a5f", text: "#dbeafe", sub: "#93c5fd" },
  },
  {
    id: "violet", name: "Violet Dusk",
    header: { bg: "#5b21b6", text: "#fff", sub: "#ddd6fe", border: "#7c3aed" },
    body:   { bg: "#fdf4ff", border: "#e879f9", nameTxt: "#4c1d95" },
    footer: { bg: "#9d174d", text: "#fce7f3", sub: "#f9a8d4" },
  },
  {
    id: "slate", name: "Slate Minimal",
    header: { bg: "#1e293b", text: "#fff", sub: "#94a3b8", border: "#475569" },
    body:   { bg: "#f8fafc", border: "#cbd5e1", nameTxt: "#0f172a" },
    footer: { bg: "#334155", text: "#e2e8f0", sub: "#94a3b8" },
  },
];
 
const SWATCHES = [
  "#312e81","#4338ca","#6366f1","#7c3aed","#9333ea",
  "#be185d","#e11d48","#dc2626","#ea580c","#d97706",
  "#065f46","#047857","#0369a1","#0c4a6e","#1e3a8a",
  "#1e293b","#334155","#475569","#0f172a","#374151",
  "#fef9c3","#fef3c7","#ecfdf5","#f0f9ff","#fdf4ff",
  "#f0fdf4","#eff6ff","#f5f3ff","#fff7ed","#fdf2f8",
  "#ffffff","#f8fafc","#f1f5f9","#e2e8f0","#cbd5e1",
];
 
// ─── ID Card label translations ───────────────────────────────────────────────
const CARD_LABELS = {
  en: {
    admNo:         "Adm. No.",
    father:        "Father's Name",
    mother:        "Mother's Name",
    dob:           "Date of Birth",
    gender:        "Gender",
    bloodGroup:    "Blood Group",
    classGrade:    "Class / Grade",
    enrollRoll:    "Enr / Roll No.",
    parentContact: "Parent Contact",
    address:       "Address",
    estd:          "ESTD.",
    bus:           "BUS",
    validUpto:     "Valid Upto",
    principal:     "Principal",
    contact:       "School Contact",
  },
  hi: {
    admNo:         "प्रवेश सं.",
    father:        "पिता का नाम",
    mother:        "माता का नाम",
    dob:           "जन्म तिथि",
    gender:        "लिंग",
    bloodGroup:    "रक्त समूह",
    classGrade:    "कक्षा / ग्रेड",
    enrollRoll:    "नामांकन सं.",
    parentContact: "अभिभावक संपर्क",
    address:       "पता",
    estd:          "स्थापित",
    bus:           "बस",
    validUpto:     "वैध उपर तक",
    principal:     "प्राचार्य",
    contact:       "स्कूल संपर्क",
  },
  ur: {
    admNo:         "داخلہ نمبر",
    father:        "والد کا نام",
    mother:        "والدہ کا نام",
    dob:           "تاریخ پیدائش",
    gender:        "جنس",
    bloodGroup:    "بلڈ گروپ",
    classGrade:    "جماعت / گریڈ",
    enrollRoll:    "رول نمبر",
    parentContact: "والدین رابطہ",
    address:       "پتہ",
    estd:          "قیام",
    bus:           "بس",
    validUpto:     "درستگی تک",
    principal:     "پرنسپل",
    contact:       "اسکول رابطہ",
  },
};

// ─── Stable separator (NOT an inline arrow — avoids FlatList re-render) ───────
const CardSeparator = () => <View style={{ height: 12 }} />;
 
// ─── PDF builder — reference-image style (international school ID card) ───────
function buildPdfHtml(students, schoolInfo, theme, cfg = {}) {
  const C = { ...ID_CARD_CONFIG_DEFAULTS, ...cfg };
  const L = CARD_LABELS[C.cardLanguage] ?? CARD_LABELS.en;
  const isRtl = C.cardLanguage === "ur";
  const fontImport = C.cardLanguage === "hi"
    ? `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&display=swap');`
    : C.cardLanguage === "ur"
    ? `@import url('https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap');`
    : "";
  const fontFamily = C.cardLanguage === "hi"
    ? "'Noto Sans Devanagari', Arial, sans-serif"
    : C.cardLanguage === "ur"
    ? "'Noto Nastaliq Urdu', Arial, sans-serif"
    : "Arial, Helvetica, sans-serif";
  const T          = theme;
  const schoolName = (schoolInfo?.name ?? "School Management System").toUpperCase();
  const schoolAddr = schoolInfo?.address ?? "";
  const schoolPhone = schoolInfo?.phone ?? "";
  const logoUrl    = schoolInfo?.logoUrl
    ? `${HOST_NAME}/clients/${schoolInfo.ssmsClientCode}/${schoolInfo.logoUrl}`
    : null;
  const principalSigUrl = schoolInfo?.principalSignature
    ? `${HOST_NAME}/clients/${schoolInfo.ssmsClientCode}/${schoolInfo.principalSignature}`
    : null;

  // Fixed barcode-like pattern (alternating dark/light bars)
  const barPattern = [2,1,3,1,2,1,1,4,1,2,1,3,1,2,1,1,3,1,2,1,3,1,1,2,1,3,2,1,3,1,1,2,1,3,1];
  const barcodeHtml = barPattern.map((w, i) =>
    `<div style="flex:${w};background:${i % 2 === 0 ? "#111" : "transparent"};"></div>`
  ).join("");

  // DOB formatter: "YYYY-MM-DD" → "01 July, 2026"
  const formatDob = (raw) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d)) return raw;
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${String(d.getUTCDate()).padStart(2,"0")} ${months[d.getUTCMonth()]}, ${d.getUTCFullYear()}`;
  };

  // Detail row helper — fixed-width columns so all rows align consistently
  // fixedLines: forces the value cell to a fixed height (number of lines), keeping layouts identical across cards
  const dRow = (icon, label, value, fixedLines = 0) => (!value && !fixedLines) ? "" : `
    <div style="display:flex;align-items:center;padding:0;border-bottom:1px dashed #e2e8f0;">
      <span style="font-size:9px;line-height:12px;width:18px;text-align:center;flex-shrink:0;">${icon}</span>
      <span style="font-size:8px;line-height:12px;font-weight:700;color:#64748b;width:72px;flex-shrink:0;margin-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
      <span style="font-size:8px;line-height:12px;color:#94a3b8;width:10px;text-align:center;flex-shrink:0;">:</span>
      <span style="font-size:10px;font-weight:900;color:#0f172a;flex:1;line-height:12px;${fixedLines ? `min-height:${fixedLines * 12}px;max-height:${fixedLines * 12}px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${fixedLines};-webkit-box-orient:vertical;` : ""}">${value ?? ""}</span>
    </div>`;

  const cardHtml = students.map((s) => {
    const photoUrl = s.photo
      ? `${HOST_NAME}/clients/${s.ssmsClientCode}/Students/${s.registrationNo}/${s.photo}`
      : null;

    const logoSnip = !C.showSchoolLogo ? "" : logoUrl
      ? `<img src="${logoUrl}" style="width:62px;height:62px;border-radius:50%;border:2.5px solid ${T.footer.bg};object-fit:cover;flex-shrink:0;" alt="logo"/>`
      : `<div style="width:62px;height:62px;border-radius:50%;background:rgba(255,255,255,0.15);border:2.5px solid ${T.footer.bg};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0;">
           ${(schoolInfo?.name ?? "S")[0].toUpperCase()}
         </div>`;

    const photoSnip = photoUrl
      ? `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;" alt="photo"/>`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#e8edf2;">
           <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
                stroke="${T.header.bg}" stroke-width="1.3" stroke-linecap="round">
             <circle cx="12" cy="7" r="5"/>
             <path d="M3 21c0-5 4-9 9-9s9 4 9 9"/>
           </svg>
         </div>`;

    return `
    <div class="card" style="border-radius:14px;overflow:hidden;background:#fff;border:2px solid ${T.header.bg};box-shadow:0 6px 20px rgba(0,0,0,0.15);page-break-inside:avoid;break-inside:avoid;">

      <!-- ══ DARK TOP SECTION: header + photo ══ -->
      <div style="background:${T.header.bg};position:relative;overflow:hidden;">

        <!-- Left angular accent: two overlapping lighter-blue fills + two gold lines -->
        <svg style="position:absolute;left:0;top:0;width:72px;height:100%;display:block;"
             preserveAspectRatio="none" viewBox="0 0 72 200">
          <!-- Outer (wider) lighter-blue angular panel - spans full height -->
          <polygon points="0,0 72,0 52,200 0,200" fill="rgba(255,255,255,0.13)"/>
          <!-- Inner (narrower) slightly more opaque panel for depth -->
          <polygon points="0,0 44,0 28,200 0,200" fill="rgba(255,255,255,0.10)"/>
          <!-- Gold accent line 1 — thick, upper -->
          <line x1="-4" y1="62" x2="74" y2="4"  stroke="${T.footer.bg}" stroke-width="4.5" opacity="1.0"/>
          <!-- Gold accent line 2 — thin, lower -->
          <line x1="-4" y1="96" x2="72" y2="44" stroke="${T.footer.bg}" stroke-width="2.0" opacity="0.75"/>
        </svg>

        <!-- Right angular accent: mirror of left -->
        <svg style="position:absolute;right:0;top:0;width:72px;height:100%;display:block;"
             preserveAspectRatio="none" viewBox="0 0 72 200">
          <!-- Outer lighter-blue angular panel -->
          <polygon points="72,0 0,0 20,200 72,200" fill="rgba(255,255,255,0.13)"/>
          <!-- Inner panel for depth -->
          <polygon points="72,0 28,0 44,200 72,200" fill="rgba(255,255,255,0.10)"/>
          <!-- Gold accent line 1 — thick, upper -->
          <line x1="76" y1="62" x2="-2" y2="4"  stroke="${T.footer.bg}" stroke-width="4.5" opacity="1.0"/>
          <!-- Gold accent line 2 — thin, lower -->
          <line x1="76" y1="96" x2="0" y2="44"  stroke="${T.footer.bg}" stroke-width="2.0" opacity="0.75"/>
        </svg>

        <!-- HEADER: logo top-left | school name + address stacked to its right -->
        <div style="display:flex;align-items:center;padding:7px 14px 5px;gap:10px;position:relative;z-index:1;">
          ${logoSnip}
          <div style="flex:1;">
            <div style="color:#fff;font-size:12px;font-weight:900;letter-spacing:1px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${schoolName}</div>
            ${C.showSchoolAddress && schoolAddr ? `<div style="color:${T.header.sub};font-size:7.5px;font-weight:600;letter-spacing:.5px;line-height:1.3;margin-top:1px;">${schoolAddr}</div>` : ""}
            ${C.showTagline ? `<div style="color:rgba(255,255,255,0.6);font-size:6.5px;letter-spacing:1.5px;margin-top:2px;">${C.taglineText || "LEARN | GROW | SUCCEED"}</div>` : ""}
          </div>
        </div>

        <!-- PHOTO ROW: ESTD (left) | circular photo (center) | ID No (right) -->
        <div style="display:flex;align-items:center;justify-content:center;padding:2px 14px 6px;position:relative;z-index:1;gap:0;">

          <!-- Left panel: ESTD + Bus Route -->
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">
            ${C.showEstdYear ? `
              <div style="text-align:center;">
                <div style="font-size:10px;line-height:11px;margin-bottom:1px;">🎓</div>
                <div style="color:rgba(255,255,255,0.72);font-size:6.5px;font-weight:700;letter-spacing:.8px;line-height:8px;">${L.estd} ${C.estdYear || "2020"}</div>
              </div>` : ""}
            ${C.showBusRoute && s.busRoute ? `
              <div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
                <div style="height:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                  <span style="font-size:9px;line-height:1;">🚌</span>
                </div>
                <div style="display:inline-flex;align-items:center;justify-content:center;background:${T.footer.bg};border-radius:8px;padding:1px 6px;min-width:28px;white-space:nowrap;">
                  <span style="color:#fff;font-size:7px;font-weight:800;line-height:1;">${L.bus}</span>
                </div>
                <div style="color:${T.header.sub};font-size:6px;font-weight:700;line-height:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.busRoute}</div>
              </div>` : ""}
          </div>

          <!-- Square photo — outer ring + inner photo -->
          ${C.showStudentPhoto ? `
          <div style="width:150px;height:150px;border-radius:6px;border:2px solid ${T.footer.bg};overflow:hidden;flex-shrink:0;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
            <div style="width:100%;height:100%;overflow:hidden;background:#dde3ec;">
              ${photoSnip}
            </div>
          </div>` : ""}

          <!-- Right panel: Adm No + Enroll No + Blood Group -->
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
            ${C.showAdmissionNo && s.admissionNumber ? `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
              <div style="color:rgba(255,255,255,0.62);font-size:6.5px;font-weight:700;letter-spacing:.8px;line-height:8px;white-space:nowrap;overflow:hidden;">${L.admNo}</div>
              <div style="color:#fff;font-size:8px;font-weight:900;letter-spacing:.5px;line-height:10px;white-space:nowrap;overflow:hidden;">${s.admissionNumber}</div>
            </div>` : ""}
            ${s.enrollmentId ? `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
              <div style="color:rgba(255,255,255,0.62);font-size:6.5px;font-weight:700;letter-spacing:.8px;line-height:8px;white-space:nowrap;overflow:hidden;">${L.enrollRoll}</div>
              <div style="color:#fff;font-size:8px;font-weight:900;letter-spacing:.5px;line-height:10px;white-space:nowrap;overflow:hidden;">${s.enrollmentId}</div>
            </div>` : ""}
            ${C.showBloodGroup && s.bloodGroup ? `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
              <div style="color:rgba(255,255,255,0.62);font-size:6.5px;font-weight:700;letter-spacing:.8px;line-height:8px;white-space:nowrap;overflow:hidden;">🩸 ${L.bloodGroup}</div>
              <div style="color:#fff;font-size:8px;font-weight:900;letter-spacing:.5px;line-height:10px;white-space:nowrap;overflow:hidden;">${s.bloodGroup}</div>
            </div>` : ""}
          </div>

        </div>
      </div>

      <!-- ══ V-NOTCH SVG: wide downward triangle in center ══ -->
      <svg viewBox="0 0 300 16" xmlns="http://www.w3.org/2000/svg"
           style="display:block;width:100%;height:16px;margin-top:-1px;" preserveAspectRatio="none">
        <rect width="300" height="16" fill="white"/>
        <polygon points="50,0 250,0 150,16" fill="${T.header.bg}"/>
      </svg>

      <!-- ══ STUDENT BANNER (oval pill on blue bg) ══ -->
      <div style="text-align:center;padding:2px 0 2px;background:${T.header.bg};">
        <span style="display:inline-block;background:${T.footer.bg};color:#fff;font-size:11px;font-weight:900;letter-spacing:4px;padding:3px 26px;border-radius:20px;box-shadow:0 2px 6px rgba(0,0,0,0.25);">STUDENT</span>
      </div>

      <!-- ══ STUDENT NAME (white bold on blue) ══ -->
      <div style="text-align:center;font-size:14px;font-weight:900;color:#fff;letter-spacing:.8px;padding:4px 14px 6px;line-height:1.2;background:${T.header.bg};">
        ${(s.firstName ?? "").toUpperCase()} ${(s.lastName ?? "").toUpperCase()}
      </div>

      <!-- ══ BODY (stretches to fill card height) ══ -->
      <div class="card-body" style="background:${T.body.bg};">

        <!-- DETAIL ROWS -->
        <div style="padding:4px 14px 6px 28px;${isRtl ? "direction:rtl;text-align:right;" : ""}">
          ${C.showFatherName  ? dRow("👤", L.father,        s.fatherName)                                    : ""}
          ${C.showMotherName  ? dRow("👩", L.mother,        s.motherName)                                    : ""}
          ${C.showDateOfBirth ? dRow("📅", L.dob,           formatDob(s.dob))                               : ""}
          ${C.showGender      ? dRow("⚧️", L.gender,         s.gender)                                       : ""}
          ${dRow("🎓", L.classGrade, `${s.className ?? ""}${s.section ? " (" + s.section + ")" : ""}`)}
          ${C.showParentPhone    ? dRow("📞", L.parentContact, s.parentPhone ?? s.fatherPhone ?? s.motherPhone) : ""}
          ${C.showStudentAddress ? dRow("📍", L.address,       s.address, 2)                                   : ""}
        </div>

        <!-- BARCODE -->
        <div style="padding:2px 14px 3px;">
          <div style="display:flex;height:18px;align-items:stretch;">${barcodeHtml}</div>
        </div>

      </div>

      <!-- ══ FOOTER: signature left | contact centre | valid upto right ══ -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:2px 12px 2px;border-top:1px solid #e2e8f0;background:#fff;">
        <div>
          ${C.showPrincipalSignature
            ? (principalSigUrl
                ? `<img src="${principalSigUrl}" style="height:18px;max-width:64px;object-fit:contain;display:block;margin-bottom:1px;background:#fff;" />`
                : `<div style="width:56px;border-bottom:1.5px solid #334155;margin-bottom:2px;"></div>`)
            : ""}
          ${C.showPrincipalSignature ? `<div style="font-size:6.5px;font-weight:700;color:#475569;text-align:center;">${L.principal}</div>` : ""}
        </div>
        ${schoolPhone ? `
        <div style="text-align:center;">
          <div style="font-size:6px;color:#64748b;font-weight:600;letter-spacing:.5px;line-height:8px;">📞 ${L.contact}</div>
          <div style="font-size:8px;font-weight:900;color:${T.header.bg};line-height:10px;">${schoolPhone}</div>
        </div>` : ""}
        ${C.showValidityYear ? `
        <div style="display:flex;align-items:center;gap:3px;">
          <div style="font-size:12px;line-height:14px;">🛡️</div>
          <div style="text-align:right;">
            <div style="font-size:6px;color:#64748b;font-weight:600;letter-spacing:.5px;line-height:8px;">${L.validUpto}</div>
            <div style="font-size:8px;font-weight:900;color:${T.header.bg};line-height:10px;">${s.sessionName ?? "—"}</div>
          </div>
        </div>` : ""}
      </div>

      <!-- ══ RETURN BAR ══ -->
      ${C.showIfFoundBar ? `
      <div style="background:${T.header.bg};text-align:center;padding:2px 8px;">
        <span style="color:rgba(255,255,255,0.85);font-size:6.5px;font-style:italic;line-height:9px;">${C.ifFoundText || "If found, please return this card to the school."}${C.showSchoolPhoneInFooter && schoolPhone ? `  Contact: ${schoolPhone}` : ""}</span>
      </div>` : ""}

    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  ${fontImport}
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { margin:10mm 12mm; }
  body { font-family:${fontFamily}; background:#fff; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:5mm; align-items:stretch; }
  .card { display:flex; flex-direction:column; height:100%; }
  .card-body { flex:1; }
  @media print { div { page-break-inside:avoid; break-inside:avoid; } }
</style>
</head><body>
<div class="grid">${cardHtml}</div>
</body></html>`;
}
 
// ─── Colour picker modal ──────────────────────────────────────────────────────
const ColourPickerModal = React.memo(function ColourPickerModal({
  visible, zone, currentColor, onSelect, onClose,
}) {
  const zoneLabel = { header: "Header", body: "Body Background", footer: "Footer" }[zone] ?? zone;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={cp.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity style={cp.sheet} onPress={() => {}} activeOpacity={1}>
          <View style={cp.handle} />
          <Text style={cp.title}>Pick {zoneLabel} Colour</Text>
          <View style={cp.swatchGrid}>
            {SWATCHES.map(c => (
              <TouchableOpacity
                key={c}
                style={[cp.swatch, { backgroundColor: c },
                  c === currentColor && cp.swatchSelected]}
                onPress={() => { onSelect(c); onClose(); }}
              />
            ))}
          </View>
          <TouchableOpacity style={cp.cancelBtn} onPress={onClose}>
            <Text style={cp.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
});
 
// ─── Row — memoized so re-renders only when value changes ─────────────────────
const Row = React.memo(function Row({ label, value, color }) {
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label} :</Text>
      <Text style={[st.rowValue, { color }]} numberOfLines={1}>{value ?? "—"}</Text>
    </View>
  );
});
 
// ─── Detail row (used inside IdCard preview) ─────────────────────────────────
const DetailRow = React.memo(function DetailRow({ icon, label, value, color = "#0f172a", fixedLines = 0 }) {
  if (!value && !fixedLines) return null;
  return (
    <View style={st.dRow}>
      <Text style={st.dIcon}>{icon}</Text>
      <Text style={st.dLabel} numberOfLines={1}>{label}</Text>
      <Text style={[st.dColon]}>:</Text>
      <Text
        style={[st.dValue, { color }, fixedLines ? { minHeight: fixedLines * 14 } : null]}
        numberOfLines={fixedLines || 2}
      >{value ?? ""}</Text>
    </View>
  );
});

// ─── Barcode simulation ───────────────────────────────────────────────────────
const barPattern = [2,1,3,1,2,1,1,4,1,2,1,3,1,2,1,1,3,1,2,1,3,1,1,2,1,3,2,1,3,1,1,2,1,3,1];
const BarcodeView = React.memo(function BarcodeView() {
  return (
    <View style={st.barcodeRow}>
      {barPattern.map((w, i) => (
        <View key={i} style={{ flex: w, backgroundColor: i % 2 === 0 ? "#111" : "transparent", height: "100%" }} />
      ))}
    </View>
  );
});

// ─── Single card — memoized to prevent re-render when other cards change ──────
const IdCard = React.memo(function IdCard({ s, theme: T, schoolInfo, ssmsClientCode, cfg }) {
  const C = { ...ID_CARD_CONFIG_DEFAULTS, ...cfg };
  const L = CARD_LABELS[C.cardLanguage] ?? CARD_LABELS.en;
  const photoUri = s.photo
    ? `${HOST_NAME}/clients/${s.ssmsClientCode ?? ssmsClientCode}/Students/${s.registrationNo}/${s.photo}`
    : null;
  const logoUri = schoolInfo?.logoUrl
    ? `${HOST_NAME}/clients/${schoolInfo.ssmsClientCode ?? ssmsClientCode}/${schoolInfo.logoUrl}`
    : null;
  const principalSigUri = schoolInfo?.principalSignature
    ? `${HOST_NAME}/clients/${schoolInfo.ssmsClientCode ?? ssmsClientCode}/${schoolInfo.principalSignature}`
    : null;
  const MONTHS_RN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmtDob = (raw) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d)) return raw;
    return `${String(d.getUTCDate()).padStart(2,"0")} ${MONTHS_RN[d.getUTCMonth()]}, ${d.getUTCFullYear()}`;
  };

  return (
    <View style={[st.card, { borderColor: T.header.bg, shadowColor: T.header.bg }]}>

      {/* ══ DARK TOP SECTION ══ */}
      <View style={[st.darkSection, { backgroundColor: T.header.bg }]}>

        {/* ── Diagonal accent stripes (left) ── */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Wide lighter panel */}
          <View style={[st.accentPanelL1, { backgroundColor: "rgba(255,255,255,0.12)" }]} />
          {/* Narrow lighter panel */}
          <View style={[st.accentPanelL2, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
          {/* Gold thick line */}
          <View style={[st.accentLineL1, { backgroundColor: T.footer.bg }]} />
          {/* Gold thin line */}
          <View style={[st.accentLineL2, { backgroundColor: T.footer.bg, opacity: 0.65 }]} />
        </View>

        {/* ── Diagonal accent stripes (right) ── */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[st.accentPanelR1, { backgroundColor: "rgba(255,255,255,0.12)" }]} />
          <View style={[st.accentPanelR2, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
          <View style={[st.accentLineR1, { backgroundColor: T.footer.bg }]} />
          <View style={[st.accentLineR2, { backgroundColor: T.footer.bg, opacity: 0.65 }]} />
        </View>

        {/* HEADER: logo top-left | school name + address stacked to its right */}
        <View style={st.headerRow}>
          {C.showSchoolLogo && (logoUri
            ? <Image source={{ uri: logoUri }} style={[st.headerLogo, { borderColor: T.footer.bg }]} />
            : <View style={[st.headerLogoPlaceholder, { borderColor: T.footer.bg }]}>
                <Text style={[st.headerLogoText, { color: T.header.text }]}>
                  {(schoolInfo?.name ?? "S")[0].toUpperCase()}
                </Text>
              </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[st.headerSchoolName, { color: T.header.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {(schoolInfo?.name ?? ssmsClientCode ?? "School").toUpperCase()}
            </Text>
            {C.showSchoolAddress && !!schoolInfo?.address && (
              <Text style={[st.headerAddress, { color: T.header.sub }]} numberOfLines={1}>
                {schoolInfo.address}
              </Text>
            )}
            {C.showTagline && <Text style={st.headerTagline}>{C.taglineText || "LEARN | GROW | SUCCEED"}</Text>}
          </View>
        </View>

        {/* PHOTO ROW: ESTD | circular double-ring photo | ID No */}
        <View style={st.photoRow}>
          {/* Left panel: ESTD + Bus Route */}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2 }}>
            {C.showEstdYear && (
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: 14, marginBottom: 1 }}>🎓</Text>
                <Text style={[st.estdText, { color: T.header.sub }]}>{L.estd} {C.estdYear || "2020"}</Text>
              </View>
            )}
            {C.showBusRoute && !!s.busRoute && (
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: 9, lineHeight: 10, includeFontPadding: false }}>🚌</Text>
                <View style={[st.busOval, { backgroundColor: T.footer.bg }]}>
                  <Text style={st.busOvalTxt} numberOfLines={1}>{L.bus}</Text>
                </View>
                <Text style={[st.busRouteTxt, { color: T.header.sub }]} numberOfLines={1}>
                  {s.busRoute}
                </Text>
              </View>
            )}
          </View>

          {/* Square photo — outer gold ring + inner white ring */}
          {C.showStudentPhoto && (
            <View style={[st.photoOuterRing, { borderColor: T.footer.bg }]}>
              <View style={st.photoInnerRing}>
                {photoUri
                  ? <Image source={{ uri: photoUri }} style={st.photoCircle} />
                  : <View style={[st.photoCirclePh, { backgroundColor: "#e8edf2" }]}>
                      <Feather name="user" size={42} color={T.header.bg} />
                    </View>}
              </View>
            </View>
          )}

          {/* Right panel: Adm No + Enroll No + Blood Group */}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2 }}>
            {C.showAdmissionNo && !!s.admissionNumber && (
              <View style={{ alignItems: "center" }}>
                <Text style={[st.estdText, { color: T.header.sub }]} numberOfLines={1}>{L.admNo}</Text>
                <Text style={[st.idNoText, { color: "#fff" }]} numberOfLines={1}>
                  {s.admissionNumber}
                </Text>
              </View>
            )}
            {!!s.enrollmentId && (
              <View style={{ alignItems: "center" }}>
                <Text style={[st.estdText, { color: T.header.sub }]} numberOfLines={1}>{L.enrollRoll}</Text>
                <Text style={[st.idNoText, { color: "#fff" }]} numberOfLines={1}>
                  {s.enrollmentId}
                </Text>
              </View>
            )}
            {C.showBloodGroup && !!s.bloodGroup && (
              <View style={{ alignItems: "center" }}>
                <Text style={[st.estdText, { color: T.header.sub }]} numberOfLines={1}>🩸 {L.bloodGroup}</Text>
                <Text style={[st.idNoText, { color: "#fff" }]} numberOfLines={1}>
                  {s.bloodGroup}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ══ V-NOTCH SEPARATOR ══
           Trick: overflow:hidden container clips a 45°-rotated square
           so only the downward-pointing bottom triangle is visible.
           Math: diamond half-diagonal = 100*√2/2 ≈ 70.7
                 to put the bottom point at y=35: center must be at y=-35
                 square top = -35 - 50 = -85 → marginTop: -85            */}
      <View style={[st.vNotchWrap, { backgroundColor: "white" }]}>
        <View style={[st.vNotchDiamond, { backgroundColor: T.header.bg }]} />
      </View>

      {/* ══ STUDENT BANNER (oval pill on blue bg) ══ */}
      <View style={[st.studentBannerWrap, { backgroundColor: T.header.bg }]}>
        <View style={[st.studentBannerPill, { backgroundColor: T.footer.bg }]}>
          <Text style={[st.studentBannerText, { color: "#fff" }]}>STUDENT</Text>
        </View>
      </View>

      {/* ══ STUDENT NAME (white on blue) ══ */}
      <View style={[st.nameRow, { backgroundColor: T.header.bg }]}>
        <Text style={[st.studentName, { color: "#fff" }]} numberOfLines={2}>
          {(s.firstName ?? "").toUpperCase()} {(s.lastName ?? "").toUpperCase()}
        </Text>
      </View>

      {/* ══ DETAIL ROWS ══ */}
      <View style={[st.detailsBlock, { backgroundColor: T.body.bg }]}>
        {C.showFatherName    && <DetailRow icon="👤" label={L.father}        value={s.fatherName} />}
        {C.showMotherName    && <DetailRow icon="👩" label={L.mother}        value={s.motherName} />}
        {C.showDateOfBirth   && <DetailRow icon="📅" label={L.dob}           value={fmtDob(s.dob)} />}
        {C.showGender        && <DetailRow icon="⚧️" label={L.gender}         value={s.gender} />}
        <DetailRow icon="🎓" label={L.classGrade}
          value={`${s.className ?? ""}${s.section ? " (" + s.section + ")" : ""}`} />
        {C.showParentPhone   && <DetailRow icon="📞" label={L.parentContact} value={s.parentPhone ?? s.fatherPhone ?? s.motherPhone} />}
        {C.showStudentAddress && <DetailRow icon="📍" label={L.address}       value={s.address} color="#475569" fixedLines={2} />}
      </View>

      {/* ══ BARCODE ══ */}
      <View style={[st.barcodeWrap, { backgroundColor: T.body.bg }]}>
        <BarcodeView />
      </View>

      {/* ══ FOOTER: signature | contact | valid upto ══ */}
      {(C.showPrincipalSignature || !!schoolInfo?.phone || C.showValidityYear) && (
        <View style={st.cardFooter}>
          {C.showPrincipalSignature && (
            <View style={{ alignItems: "center" }}>
              {principalSigUri
                ? <Image source={{ uri: principalSigUri }} style={st.sigImage} resizeMode="contain" />
                : <View style={st.sigLine} />}
              <Text style={st.sigLabel}>{L.principal}</Text>
            </View>
          )}
          {!!schoolInfo?.phone && (
            <View style={{ alignItems: "center" }}>
              <Text style={st.validLabel}>📞 {L.contact}</Text>
              <Text style={[st.validValue, { color: T.header.bg }]}>{schoolInfo.phone}</Text>
            </View>
          )}
          {C.showValidityYear && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text style={{ fontSize: 20 }}>🛡️</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={st.validLabel}>{L.validUpto}</Text>
                <Text style={[st.validValue, { color: T.header.bg }]}>{s.sessionName ?? "—"}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ══ CONTACT / IF-FOUND BAR ══ */}
      {C.showIfFoundBar && (
        <View style={[st.contactBar, { backgroundColor: T.header.bg }]}>
          <Text style={st.contactItem}>
            {C.ifFoundText || "If found, please return this card to the school."}
            {C.showSchoolPhoneInFooter && schoolInfo?.phone ? `  📞 ${schoolInfo.phone}` : ""}
          </Text>
        </View>
      )}

    </View>
  );
});
 
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
  trigger:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 11 },
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

export default function StudentIdCardScreen({ navigation }) {
  const { user } = useContext(AuthContext);
 
  // ── Stable user identity refs — prevents useEffect re-fires ─────────────
  // Comparing user object directly re-fires on every render because the
  // AuthContext creates a new object reference each time.
  const userToken      = user?.token ?? "";
  const userClientCode = user?.ssmsClientCode ?? "";
 
  const [classes,         setClasses]        = useState([]);
  const [sessions,        setSessions]       = useState([]);
  const [branches,        setBranches]       = useState([]);
  const [sections,        setSections]       = useState([]);
  const [classId,         setClassId]        = useState("");
  const [sessionId,       setSessionId]      = useState("");
  const [selectedBranch,  setSelectedBranch] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [students,        setStudents]       = useState([]);
  const [schoolInfo,      setSchoolInfo]     = useState(null);
  const [loading,         setLoading]        = useState(false);
  const [generating,      setGenerating]     = useState(false);
  const [loadingFilters,  setLoadingFilters]  = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [idCardConfig,    setIdCardConfig]    = useState({ ...ID_CARD_CONFIG_DEFAULTS });
 
  // ── Theme state ──────────────────────────────────────────────────────────
  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [customColors,  setCustomColors]  = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerZone,    setPickerZone]    = useState("header");
 
  // Active theme — memoized so card preview only re-renders when theme changes
  const theme = useMemo(() => {
    if (!customColors) return selectedTheme;
    return {
      ...selectedTheme,
      header: { ...selectedTheme.header, bg: customColors.header ?? selectedTheme.header.bg },
      body:   { ...selectedTheme.body,   bg: customColors.body   ?? selectedTheme.body.bg   },
      footer: { ...selectedTheme.footer, bg: customColors.footer ?? selectedTheme.footer.bg },
    };
  }, [selectedTheme, customColors]);
 
  // ── Stable callbacks — deps use primitive values not object references ───
  const openPicker = useCallback((zone) => {
    setPickerZone(zone);
    setPickerVisible(true);
  }, []); // no deps — setters are stable
 
  const applyCustomColor = useCallback((color) => {
    setCustomColors(prev => ({ ...(prev ?? {}), [pickerZone]: color }));
  }, [pickerZone]);
 
  const closePicker = useCallback(() => setPickerVisible(false), []);
 
  const currentPickerColor = useMemo(() =>
    customColors?.[pickerZone] ??
    (pickerZone === "header" ? theme.header.bg :
     pickerZone === "body"   ? theme.body.bg   : theme.footer.bg),
  [customColors, pickerZone, theme]);
 
  // ── Load filters — depends on token/clientCode primitives not user object ─
  useEffect(() => {
    if (!userToken) return; // not logged in yet
    let cancelled = false;
    (async () => {
      try {
        const [cls, sess, brnch] = await Promise.all([
          fetchClasses(user),
          fetchSessions(user),
          fetchBranches(user).catch(() => []),
        ]);
        if (!cancelled) {
          // Normalize — API may return array directly or wrapped in {data:[]}
          const clsList  = Array.isArray(cls)        ? cls        : Array.isArray(cls?.data)   ? cls.data   : [];
          const sessList = Array.isArray(sess)        ? sess       : Array.isArray(sess?.data)  ? sess.data  : [];
          const brnList  = Array.isArray(brnch)       ? brnch      : Array.isArray(brnch?.data) ? brnch.data : [];
          setClasses(clsList);
          setSessions(sessList);
          setBranches(brnList);
          // Auto-select when there is exactly one option
          if (sessList.length === 1) setSessionId(String(sessList[0].session_id));
          if (brnList.length  === 1) setSelectedBranch(String(brnList[0].branch_id));
        }
      } catch (e) {
        console.log("StudentIdCard filter load error:", e.message);
        if (!cancelled) Alert.alert("Error", e.message ?? "Failed to load filters");
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userToken, userClientCode]); // primitives — stable refs

  // ── Re-fetch ID card config every time this screen comes into focus ──────
  // This ensures that settings saved in IdCardSettingsScreen are reflected
  // immediately when the user navigates back here.
  useFocusEffect(
    useCallback(() => {
      if (!userToken) return;
      fetchIdCardConfig(user)
        .then(cfg => setIdCardConfig({ ...ID_CARD_CONFIG_DEFAULTS, ...cfg }))
        .catch(() => {}); // keep existing config on error — no silent crash
    }, [userToken, userClientCode])
  );

  // ── Load sections when class changes ────────────────────────────────────
  useEffect(() => {
    if (!classId) { setSections([]); setSelectedSection(""); return; }
    let cancelled = false;
    setLoadingSections(true);
    setSections([]);
    setSelectedSection("");
    fetchSections(user, classId)
      .then(list => {
        if (!cancelled) {
          const arr = Array.isArray(list) ? list : [];
          setSections(arr);
          // Auto-select when there is exactly one section
          if (arr.length === 1) setSelectedSection(String(arr[0].section_id));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSections(false); });
    return () => { cancelled = true; };
  }, [classId]);

  const classOptions = useMemo(() => [
    { label: "— Select Class —", value: "" },
    ...classes
      .filter(c => c.class_id != null && c.class_name)
      .map(c => ({ label: c.class_name, value: String(c.class_id) })),
  ], [classes]);
 
  const sessionOptions = useMemo(() => {
    const items = sessions
      .filter(s => s.session_id != null)
      .map(s => ({ label: s.session_name ?? s.session_year ?? `Session ${s.session_id}`, value: String(s.session_id) }));
    // Only add a placeholder when there are multiple sessions to choose from
    return items.length > 1 ? [{ label: "— Select Session —", value: "" }, ...items] : items;
  }, [sessions]);

  const branchOptions = useMemo(() => {
    const items = branches
      .filter(b => b.branch_id != null)
      .map(b => ({ label: b.branch_name ?? `Branch ${b.branch_id}`, value: String(b.branch_id) }));
    // No "All Branches" — require a specific branch; placeholder only when multiple exist
    return items.length > 1 ? [{ label: "— Select Branch —", value: "" }, ...items] : items;
  }, [branches]);

  const sectionOptions = useMemo(() => {
    const items = sections
      .filter(s => s.section_id != null)
      .map(s => ({ label: s.section_name ?? `Section ${s.section_id}`, value: String(s.section_id) }));
    // Keep "All Sections" only when there are multiple to choose from
    return items.length > 1 ? [{ label: "— All Sections —", value: "" }, ...items] : items;
  }, [sections]);
 
  // ── Fetch students ───────────────────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    if (!classId)   { Alert.alert("Validation", "Please select a class.");   return; }
    if (!sessionId) { Alert.alert("Validation", "Please select a session."); return; }
    try {
      setLoading(true);
      setStudents([]);
      const data = await fetchIdCardData(user, { classId, sessionId, branchId: selectedBranch, sectionId: selectedSection });
      setStudents(data.students ?? []);
      setSchoolInfo(data.school  ?? null);
    } catch (e) {
      Alert.alert("Error", e.message ?? "Failed to load students");
    } finally {
      setLoading(false);
    }
  }, [userToken, classId, sessionId, selectedBranch, selectedSection]);
 
  // ── Generate PDF — yields to JS thread before heavy HTML build ───────────
  const lastPdfUri = useRef(null); // track last generated file for cleanup

  const handleGeneratePdf = useCallback(async () => {
    if (!students.length) {
      Alert.alert("No Students", "Please load students first.");
      return;
    }
    try {
      setGenerating(true);

      // Yield to JS thread so spinner renders before heavy HTML build
      await new Promise(resolve => setTimeout(resolve, 50));

      const html = buildPdfHtml(students, schoolInfo, theme, idCardConfig);
      const { uri } = await Print.printToFileAsync({ html, base64: false });

      // Delete previous temp file to prevent cache buildup
      if (lastPdfUri.current && lastPdfUri.current !== uri) {
        try {
          const FileSystem = require('expo-file-system');
          await FileSystem.deleteAsync(lastPdfUri.current, { idempotent: true });
        } catch { /* non-fatal */ }
      }
      lastPdfUri.current = uri;

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType:    "application/pdf",
          dialogTitle: `ID Cards — ${classOptions.find(c => c.value === classId)?.label ?? "Class"}`,
          UTI:         "com.adobe.pdf",
        });
      } else {
        Alert.alert("PDF Generated", `Saved to: ${uri}`);
      }
    } catch (e) {
      Alert.alert("Error", e.message ?? "PDF generation failed");
    } finally {
      setGenerating(false);
    }
  }, [students, schoolInfo, theme, classId, classOptions, idCardConfig]);
 
  // ── renderItem — stable, passes only what IdCard needs ───────────────────
  const renderCard = useCallback(({ item: s }) => (
    <IdCard
      s={s}
      theme={theme}
      schoolInfo={schoolInfo}
      ssmsClientCode={userClientCode}
      cfg={idCardConfig}
    />
  ), [theme, schoolInfo, userClientCode, idCardConfig]);
 
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.safe} edges={["top"]}>
 
      {/* Screen header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#2563eb" />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Student ID Cards</Text>
        {students.length > 0 && (
          <TouchableOpacity
            style={[st.pdfBtn, generating && { opacity: 0.6 }]}
            onPress={handleGeneratePdf}
            disabled={generating}
          >
            {generating
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Feather name="download" size={15} color="#fff" /><Text style={st.pdfBtnText}> PDF</Text></>}
          </TouchableOpacity>
        )}
      </View>
 
      {/* ── FIX: Replace ScrollView+FlatList nesting with a single FlatList ──
          Nesting FlatList inside ScrollView (both scrollEnabled) is the #1
          cause of hangs in React Native. Instead we use FlatList for
          everything and render the filter/theme panels as ListHeaderComponent. */}
      <FlatList
        data={students.length > 0 ? students : null}
        keyExtractor={(s, i) => String(s?.enrollmentId ?? i)}
        renderItem={renderCard}
        ItemSeparatorComponent={CardSeparator}
        contentContainerStyle={st.listContent}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={true}      // unmount off-screen cards
        maxToRenderPerBatch={6}           // render 6 at a time
        windowSize={5}                    // keep 5 windows of cards in memory
        initialNumToRender={4}            // only render 4 on first paint
        getItemLayout={(_, index) => ({   // avoid layout measurement overhead
          length: 220, offset: 220 * index, index,
        })}
        ListHeaderComponent={
          <View>
            {/* ── Filters ── */}
            <View style={st.filterCard}>
              <Text style={st.filterTitle}>Select Filters</Text>

              {/* Row 1: Branch (if any) | Session */}
              <View style={st.filterRow}>
                {branches.length > 0 && (
                  <View style={st.filterCol}>
                    <Text style={st.filterLabel}>Branch</Text>
                    <Dropdown
                      label="All Branches"
                      value={selectedBranch}
                      options={branchOptions}
                      onChange={setSelectedBranch}
                      disabled={!!loadingFilters}
                      loading={loadingFilters}
                    />
                  </View>
                )}
                <View style={st.filterCol}>
                  <Text style={st.filterLabel}>Session</Text>
                  <Dropdown
                    label="Session"
                    value={sessionId}
                    options={sessionOptions}
                    onChange={setSessionId}
                    disabled={!!loadingFilters}
                    loading={loadingFilters}
                  />
                </View>
              </View>

              {/* Row 2: Class | Section */}
              <View style={st.filterRow}>
                <View style={st.filterCol}>
                  <Text style={st.filterLabel}>Class</Text>
                  <Dropdown
                    label="Class"
                    value={classId}
                    options={classOptions}
                    onChange={setClassId}
                    disabled={!!loadingFilters}
                    loading={loadingFilters}
                  />
                </View>
                <View style={st.filterCol}>
                  <Text style={st.filterLabel}>Section</Text>
                  <Dropdown
                    label="All Sections"
                    value={selectedSection}
                    options={sectionOptions}
                    onChange={setSelectedSection}
                    disabled={!classId || loadingSections}
                    loading={loadingSections}
                  />
                </View>
              </View>
              <TouchableOpacity
                style={[st.loadBtn, (loading || loadingFilters) && { opacity: 0.6 }]}
                onPress={handleFetch}
                disabled={loading || loadingFilters}
              >
                {loading
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={st.loadBtnText}> Loading…</Text></>
                  : <><Feather name="users" size={16} color="#fff" /><Text style={st.loadBtnText}> Load Students</Text></>}
              </TouchableOpacity>
            </View>
 
            {/* ── Colour Theme Picker ── */}
            <View style={st.themeCard}>
              <Text style={st.filterTitle}>🎨 Card Colour Theme</Text>
 
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
                nestedScrollEnabled={true}>
                {THEMES.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[st.themeChip, selectedTheme.id === t.id && st.themeChipActive]}
                    onPress={() => { setSelectedTheme(t); setCustomColors(null); }}
                  >
                    <View style={[st.themePreview, { backgroundColor: t.header.bg }]} />
                    <View style={[st.themePreview, { backgroundColor: t.body.bg, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: t.body.border }]} />
                    <View style={[st.themePreview, { backgroundColor: t.footer.bg }]} />
                    <Text style={[st.themeChipText, selectedTheme.id === t.id && { color: "#2563eb" }]}
                      numberOfLines={1}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
 
              <Text style={st.customLabel}>Customise Individual Zones</Text>
              <View style={st.zoneRow}>
                {[
                  { key: "header", label: "Header", bg: theme.header.bg },
                  { key: "body",   label: "Body",   bg: theme.body.bg   },
                  { key: "footer", label: "Footer", bg: theme.footer.bg },
                ].map(z => (
                  <TouchableOpacity key={z.key} style={st.zonePicker}
                    onPress={() => openPicker(z.key)}>
                    <View style={[st.zoneColorDot, { backgroundColor: z.bg }]} />
                    <Text style={st.zonePickerLabel}>{z.label}</Text>
                    <Feather name="chevron-down" size={12} color="#64748b" />
                  </TouchableOpacity>
                ))}
              </View>
 
              {customColors && (
                <TouchableOpacity style={st.resetBtn} onPress={() => setCustomColors(null)}>
                  <Feather name="rotate-ccw" size={13} color="#2563eb" />
                  <Text style={st.resetBtnText}> Reset to theme defaults</Text>
                </TouchableOpacity>
              )}
            </View>
 
            {/* ── Summary + Generate ── */}
            {students.length > 0 && (
              <>
                <View style={st.summaryBar}>
                  <View style={st.summaryLeft}>
                    <Feather name="check-circle" size={16} color="#16a34a" />
                    <Text style={st.summaryText}>
                      {students.length} student{students.length !== 1 ? "s" : ""} loaded
                    </Text>
                  </View>
                  <Text style={st.summaryPages}>
                    ~{Math.ceil(students.length / 6)} page{Math.ceil(students.length / 6) !== 1 ? "s" : ""} • 2 cols × 3 rows
                  </Text>
                </View>
                <TouchableOpacity
                  style={[st.generateBtn, generating && { opacity: 0.6 }]}
                  onPress={handleGeneratePdf}
                  disabled={generating}
                >
                  {generating
                    ? <><ActivityIndicator color="#fff" size="small" /><Text style={st.generateBtnText}>  Generating PDF…</Text></>
                    : <><Feather name="file-text" size={18} color="#fff" /><Text style={st.generateBtnText}>  Generate & Download PDF</Text></>}
                </TouchableOpacity>
                <Text style={st.previewLabel}>
                  Preview — {selectedTheme.name}{customColors ? " (customised)" : ""}
                </Text>
              </>
            )}
 
            {/* ── Empty state ── */}
            {!loading && students.length === 0 && (
              <View style={st.emptyState}>
                <Feather name="credit-card" size={48} color="#cbd5e1" />
                <Text style={st.emptyTitle}>No ID Cards Yet</Text>
                <Text style={st.emptyText}>
                  Select a class and session above, then tap Load Students.
                </Text>
              </View>
            )}
          </View>
        }
      />
 
      {/* Colour picker modal */}
      <ColourPickerModal
        visible={pickerVisible}
        zone={pickerZone}
        currentColor={currentPickerColor}
        onSelect={applyCustomColor}
        onClose={closePicker}
      />
 
    </SafeAreaView>
  );
}
 
// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#f8fafc" },
  listContent:     { padding: 16, paddingBottom: 40 },
  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 12 },
  backBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  headerTitle:     { flex: 1, fontSize: 18, fontWeight: "800", color: "#0f172a" },
  pdfBtn:          { flexDirection: "row", alignItems: "center", backgroundColor: "#16a34a", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  pdfBtnText:      { color: "#fff", fontWeight: "700", fontSize: 13 },
 
  filterCard:      { backgroundColor: "#fff", borderRadius: 20, padding: 18, marginBottom: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  filterTitle:     { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  filterRow:       { flexDirection: "row", gap: 10, marginTop: 8 },
  filterCol:       { flex: 1 },
  filterLabel:     { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 4 },
  pickerWrap:      { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, overflow: "hidden", marginBottom: 4 },
  loadBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, marginTop: 16, gap: 8 },
  loadBtnText:     { color: "#fff", fontWeight: "700", fontSize: 15 },
 
  themeCard:       { backgroundColor: "#fff", borderRadius: 20, padding: 18, marginBottom: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  themeChip:       { alignItems: "center", borderRadius: 12, borderWidth: 1.5, borderColor: "#e2e8f0", overflow: "hidden", width: 72, paddingBottom: 6 },
  themeChipActive: { borderColor: "#2563eb", borderWidth: 2 },
  themePreview:    { width: "100%", height: 14 },
  themeChipText:   { fontSize: 9, fontWeight: "600", color: "#475569", marginTop: 5, paddingHorizontal: 4, textAlign: "center" },
  customLabel:     { fontSize: 13, fontWeight: "600", color: "#475569", marginBottom: 8 },
  zoneRow:         { flexDirection: "row", gap: 10 },
  zonePicker:      { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, padding: 10 },
  zoneColorDot:    { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  zonePickerLabel: { flex: 1, fontSize: 12, fontWeight: "600", color: "#334155" },
  resetBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 10, paddingVertical: 8 },
  resetBtnText:    { fontSize: 12, color: "#2563eb", fontWeight: "600" },
 
  summaryBar:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f0fdf4", borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#bbf7d0" },
  summaryLeft:     { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryText:     { fontSize: 14, fontWeight: "700", color: "#15803d" },
  summaryPages:    { fontSize: 12, color: "#16a34a", fontWeight: "600" },
  generateBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#16a34a", borderRadius: 14, paddingVertical: 16, marginBottom: 16, gap: 8, elevation: 3, shadowColor: "#16a34a", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  generateBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  previewLabel:    { fontSize: 14, fontWeight: "700", color: "#475569", marginBottom: 10 },
 
  // ── ID Card (reference-image style) ─────────────────────────────────────────
  card:              { borderRadius: 14, overflow: "hidden", borderWidth: 2, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  // Dark top section
  darkSection:       { overflow: "hidden", position: "relative" },
  // Left diagonal accent panels (skewed parallelogram shapes)
  accentPanelL1:     { position: "absolute", left: -30, top: 0, bottom: 0, width: 80, transform: [{ skewX: "-15deg" }] },
  accentPanelL2:     { position: "absolute", left: -30, top: 0, bottom: 0, width: 52, transform: [{ skewX: "-15deg" }] },
  accentLineL1:      { position: "absolute", left: -14, top: 0, bottom: 0, width: 5, transform: [{ skewX: "-15deg" }] },
  accentLineL2:      { position: "absolute", left: 2, top: 0, bottom: 0, width: 2.5, transform: [{ skewX: "-15deg" }] },
  // Right diagonal accent panels (mirrored)
  accentPanelR1:     { position: "absolute", right: -30, top: 0, bottom: 0, width: 80, transform: [{ skewX: "15deg" }] },
  accentPanelR2:     { position: "absolute", right: -30, top: 0, bottom: 0, width: 52, transform: [{ skewX: "15deg" }] },
  accentLineR1:      { position: "absolute", right: -14, top: 0, bottom: 0, width: 5, transform: [{ skewX: "15deg" }] },
  accentLineR2:      { position: "absolute", right: 2, top: 0, bottom: 0, width: 2.5, transform: [{ skewX: "15deg" }] },
  headerRow:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 7, paddingBottom: 5, gap: 10 },
  headerLogo:        { width: 62, height: 62, borderRadius: 31, borderWidth: 2.5, overflow: "hidden" },
  headerLogoPlaceholder: { width: 70, height: 70, borderRadius: 35, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 2, alignItems: "center", justifyContent: "center" },
  headerLogoText:    { fontWeight: "900", fontSize: 16 },
  headerSchoolName:  { fontSize: 12, fontWeight: "900", letterSpacing: 0.8, textAlign: "center", lineHeight: 15 },
  headerAddress:     { fontSize: 9.5, marginTop: 2, textAlign: "center", color: "rgba(255,255,255,0.82)" },
  headerTagline:     { fontSize: 8.5, color: "rgba(255,255,255,0.72)", letterSpacing: 1.2, marginTop: 4, textAlign: "center" },
  // Photo row
  photoRow:          { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4, gap: 0 },
  estdText:          { fontSize: 6.5, fontWeight: "700", letterSpacing: 0.8, textAlign: "center" },
  busOval:           { borderRadius: 8, paddingHorizontal: 6, height: 13, alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 1 },
  busOvalTxt:        { color: "#fff", fontSize: 7, fontWeight: "800", includeFontPadding: false },
  busRouteTxt:       { fontSize: 6, fontWeight: "700", letterSpacing: 0.3, textAlign: "center", lineHeight: 8, includeFontPadding: false },
  idNoText:          { fontSize: 8, fontWeight: "900", letterSpacing: 0.5, marginTop: 1, textAlign: "center" },
  // Outer gold ring → thin semi-transparent gap → white inner ring → photo
  photoOuterRing:    { width: 156, height: 156, borderRadius: 6, borderWidth: 2, overflow: "hidden" },
  photoInnerRing:    { width: "100%", height: "100%", overflow: "hidden", backgroundColor: "#dde3ec" },
  photoCircle:       { width: "100%", height: "100%", resizeMode: "cover" },
  photoCirclePh:     { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  // V-notch: overflow:hidden clips the rotated square to a downward triangle
  vNotchWrap:        { height: 24, overflow: "hidden", alignItems: "center" },
  vNotchDiamond:     { width: 100, height: 100, transform: [{ rotate: "45deg" }], marginTop: -97 },
  // STUDENT banner (oval pill)
  studentBannerWrap: { alignItems: "center", paddingVertical: 2 },
  studentBannerPill: { borderRadius: 20, paddingVertical: 3, paddingHorizontal: 28, elevation: 2, shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  studentBannerText: { fontSize: 11, fontWeight: "900", letterSpacing: 4 },
  // Name
  nameRow:           { alignItems: "center", paddingHorizontal: 12, paddingTop: 7, paddingBottom: 2 },
  studentName:       { fontSize: 14, fontWeight: "900", letterSpacing: 0.8, textAlign: "center", lineHeight: 18 },
  // Detail rows — two fixed columns so every row aligns perfectly
  detailsBlock:      { paddingLeft: 28, paddingRight: 10, paddingBottom: 4 },
  dRow:              { flexDirection: "row", alignItems: "center", paddingVertical: 0, borderBottomWidth: 1, borderBottomColor: "#e2e8f0", minHeight: 0 },
  dIcon:             { fontSize: 9, width: 18, textAlign: "center", lineHeight: 12, includeFontPadding: false },
  dLabel:            { fontSize: 8, fontWeight: "700", color: "#64748b", width: 72, flexShrink: 0, marginLeft: 4, lineHeight: 12, includeFontPadding: false },
  dColon:            { fontSize: 9, color: "#94a3b8", width: 10, textAlign: "center", lineHeight: 12, includeFontPadding: false },
  dValue:            { fontSize: 10.5, fontWeight: "900", lineHeight: 12, flex: 1, color: "#0f172a", includeFontPadding: false },
  // Barcode
  barcodeWrap:       { paddingHorizontal: 12, paddingVertical: 2 },
  barcodeRow:        { height: 26, flexDirection: "row", alignItems: "stretch" },
  // Footer
  cardFooter:        { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#e2e8f0", backgroundColor: "#fff" },
  sigLine:           { width: 68, borderBottomWidth: 1.5, borderBottomColor: "#334155", marginBottom: 3 },
  sigImage:          { width: 80, height: 36, marginBottom: 3, backgroundColor: '#fff' },
  sigLabel:          { fontSize: 7.5, fontWeight: "700", color: "#475569" },
  validLabel:        { fontSize: 6.5, color: "#64748b", fontWeight: "600" },
  validValue:        { fontSize: 8.5, fontWeight: "900" },
  // Contact bar
  contactBar:        { flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingVertical: 5, paddingHorizontal: 8 },
  contactItem:       { color: "rgba(255,255,255,0.82)", fontSize: 7 },
  // Row (legacy)
  row:               { flexDirection: "row", marginBottom: 5, alignItems: "center" },
  rowLabel:          { fontSize: 9, fontWeight: "700", color: "#92400e", width: 68, flexShrink: 0 },
  rowValue:          { fontSize: 10, fontWeight: "700", flex: 1, paddingLeft: 6 },
 
  emptyState:      { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTitle:      { fontSize: 18, fontWeight: "700", color: "#334155" },
  emptyText:       { fontSize: 14, color: "#94a3b8", textAlign: "center", maxWidth: 260 },
});
 
const cp = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  handle:     { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:      { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 16 },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  swatch:     { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  swatchSelected: { borderWidth: 3, borderColor: "#2563eb", transform: [{ scale: 1.15 }] },
  cancelBtn:  { backgroundColor: "#f1f5f9", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelTxt:  { fontWeight: "700", color: "#475569", fontSize: 15 },
});