/**
 * screens/Exams/PaperPreviewScreen.js
 * Renders a full A4-style question paper preview and exports to PDF or Word.
 */
import React, { useState, useContext, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView, Linking,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getWordExportUrl } from "../../services/QuestionPaperServiceApi";
import { HOST_NAME } from "../../Environment/EnvironmentConfig";

// ─── Language label maps ───────────────────────────────────────────────────────
const PAPER_LABELS = {
  hi: {
    dir: "ltr", htmlLang: "hi",
    font: "'Noto Sans Devanagari','Mangal',Arial,sans-serif",
    fontUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700;900&display=swap",
    class: "कक्षा", subject: "विषय", maxMarks: "पूर्णांक",
    session: "सत्र", time: "समय",
    instructions: "सामान्य निर्देश",
    question: "प्रश्न", marks: "अंक",
    figure: "आकृति", colA: "स्तम्भ-क", colB: "स्तम्भ-ख",
    footer: "— समाप्त —",
    sections: {
      mcq:        "नीचे दिए गए विकल्पों में से सही उत्तर चुनिए।",
      fill_blank: "रिक्त स्थानों को उचित उत्तरों से भरिए।",
      true_false: "निम्नलिखित कथनों के लिए सही या गलत लिखिए।",
      short:      "निम्नलिखित प्रश्नों के संक्षिप्त उत्तर दीजिए।",
      long:       "निम्नलिखित प्रश्नों के विस्तृत उत्तर दीजिए।",
      match:      "निम्नलिखित स्तंभों का मिलान कीजिए।",
      passage:    "निम्नलिखित गद्यांश को पढ़कर प्रश्नों के उत्तर दीजिए।",
      figure:     "निम्नलिखित आकृतियाँ / चित्र बनाइए।",
    },
  },
  en: {
    dir: "ltr", htmlLang: "en",
    font: "Arial,sans-serif",
    fontUrl: null,
    class: "Class", subject: "Subject", maxMarks: "Max. Marks",
    session: "Session", time: "Time",
    instructions: "General Instructions",
    question: "Q.", marks: "Marks",
    figure: "Fig.", colA: "Column A", colB: "Column B",
    footer: "— End —",
    sections: {
      mcq:        "Choose the correct answer from the options given below.",
      fill_blank: "Fill in the blanks with appropriate answers.",
      true_false: "State whether the following statements are True or False.",
      short:      "Answer the following questions briefly.",
      long:       "Answer the following questions in detail.",
      match:      "Match the following columns.",
      passage:    "Read the following passage and answer the questions.",
      figure:     "Draw the following figures / diagrams.",
    },
  },
  ur: {
    dir: "rtl", htmlLang: "ur",
    font: "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',Arial,sans-serif",
    fontUrl: "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap",
    class: "جماعت", subject: "مضمون", maxMarks: "کل نمبر",
    session: "سیشن", time: "وقت",
    instructions: "عمومی ہدایات",
    question: "سوال", marks: "نمبر",
    figure: "شکل", colA: "کالم الف", colB: "کالم ب",
    footer: "— ختم —",
    sections: {
      mcq:        "نیچے دیے گئے اختیارات میں سے درست جواب چنیے۔",
      fill_blank: "خالی جگہوں کو مناسب الفاظ سے پُر کریں۔",
      true_false: "درج ذیل بیانات کے لیے درست یا غلط لکھیں۔",
      short:      "درج ذیل سوالات کے مختصر جوابات دیں۔",
      long:       "درج ذیل سوالات کے تفصیلی جوابات دیں۔",
      match:      "درج ذیل کالموں کا ملان کریں۔",
      passage:    "درج ذیل عبارت پڑھ کر سوالات کے جوابات دیں۔",
      figure:     "درج ذیل اشکال / خاکے بنائیں۔",
    },
  },
  ar: {
    dir: "rtl", htmlLang: "ar",
    font: "'Noto Sans Arabic',Arial,sans-serif",
    fontUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700;900&display=swap",
    class: "الصف", subject: "المادة", maxMarks: "الدرجة الكلية",
    session: "الفصل", time: "الوقت",
    instructions: "التعليمات العامة",
    question: "س", marks: "درجة",
    figure: "شكل", colA: "العمود أ", colB: "العمود ب",
    footer: "— انتهى —",
    sections: {
      mcq:        "اختر الإجابة الصحيحة من الخيارات التالية.",
      fill_blank: "أكمل الفراغات بالإجابات المناسبة.",
      true_false: "اكتب صح أو خطأ للعبارات التالية.",
      short:      "أجب عن الأسئلة التالية باختصار.",
      long:       "أجب عن الأسئلة التالية بالتفصيل.",
      match:      "طابق بين العمودين.",
      passage:    "اقرأ الفقرة التالية وأجب عن الأسئلة.",
      figure:     "ارسم الأشكال / الرسوم البيانية التالية.",
    },
  },
};

// ─── HTML Generator ────────────────────────────────────────────────────────────
function generatePaperHTML(paper, questions) {
  const cfg        = paper?.header_config ?? {};
  const lbl        = PAPER_LABELS[cfg.language] ?? PAPER_LABELS.hi;
  const schoolName = cfg.schoolName || paper?.school_name || "School Name";
  const schoolAddr = cfg.address    || paper?.school_address || "";
  const logoUrl    = cfg.logoUrl    || null;
  const className  = paper?.class_name    || "";
  const subjectName= paper?.subject_name  || "";
  const totalMarks = paper?.total_marks   || questions.reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
  const session    = paper?.session       || "";
  const examType   = paper?.exam_type     || "";
  const duration   = paper?.duration_minutes ? `${paper.duration_minutes} min` : "";
  const instructions = Array.isArray(paper?.instructions)
    ? paper.instructions
    : (paper?.instructions ? String(paper.instructions).split("\n").filter(Boolean) : []);

  // ── Render individual question ──────────────────────────────────────────
  // fmtText: converts __word__ → <u>word</u> (underline), then ___ → blank line
  const fmtText = (str) => (str ?? "")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*\n]+)\*/g, "<i>$1</i>")
    .replace(/__([^_\n]+)__/g, "<u>$1</u>")
    .replace(/___+/g, '<span style="border-bottom:1px solid #000;display:inline-block;min-width:60px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');

  const renderQuestion = (q, idx) => {
    const qNum    = `${lbl.question} ${idx + 1}.`;
    const marks   = `(${q.marks ?? 1} ${lbl.marks})`;
    const qText   = fmtText(q.question_text);
    const hasImage = !!q.image_url;

    let bodyHtml  = "";

    if (q.type === "mcq" || q.type === "true_false") {
      let opts = [];
      try { opts = typeof q.options === "string" ? JSON.parse(q.options) : (q.options ?? []); } catch {}
      const optLetters = ["(A)", "(B)", "(C)", "(D)"];
      bodyHtml = `<table style="width:100%;border-collapse:collapse;margin-top:4px;">
        ${opts.map((o, i) => i % 2 === 0
          ? `<tr>
              <td style="width:50%;padding:2px 6px;font-size:9pt;">${optLetters[i]} ${fmtText(o.text)}</td>
              ${opts[i + 1] ? `<td style="width:50%;padding:2px 6px;font-size:9pt;">${optLetters[i + 1]} ${fmtText(opts[i + 1].text)}</td>` : "<td></td>"}
             </tr>`
          : ""
        ).filter(Boolean).join("")}
      </table>`;
    } else if (q.type === "match") {
      let pairs = [];
      try { pairs = typeof q.match_pairs === "string" ? JSON.parse(q.match_pairs) : (q.match_pairs ?? []); } catch {}
      const shuffledRight = [...pairs].sort(() => Math.random() - 0.5);
      bodyHtml = `<table style="width:70%;border-collapse:collapse;margin-top:4px;margin-left:12px;">
        <tr><th style="text-align:left;font-size:9pt;padding:2px 8px;border-bottom:1px solid #ccc;">${lbl.colA}</th>
            <th style="text-align:left;font-size:9pt;padding:2px 8px;border-bottom:1px solid #ccc;">${lbl.colB}</th></tr>
        ${pairs.map((p, i) => `<tr>
          <td style="padding:2px 8px;font-size:9pt;">${i + 1}. ${fmtText(p.left)}</td>
          <td style="padding:2px 8px;font-size:9pt;">${String.fromCharCode(97 + i)}. ${fmtText(shuffledRight[i]?.right)}</td>
        </tr>`).join("")}
      </table>`;
    } else if (q.type === "short" || q.type === "long" || q.type === "figure") {
      const lines = parseInt(q.answer_lines) ?? (q.type === "short" ? 5 : 10);
      bodyHtml = lines > 0
        ? Array(lines).fill('<div style="border-bottom:1px solid #d1d5db;height:20px;"></div>').join("")
        : "";
    } else if (q.type === "passage") {
      bodyHtml = `<div style="background:#f8f8f8;padding:6px 10px;border-left:3px solid #999;font-size:9pt;margin-top:4px;">${qText}</div>`;
    }

    // ── Layout: image floats to the right; content fills remaining width ──
    // This keeps the question on one horizontal band instead of stacking
    // image below text and doubling the vertical space used.
    const imgCol = hasImage
      ? `<div style="flex:0 0 auto;width:150pt;margin-left:10pt;text-align:center;">
           <img src="${HOST_NAME}${q.image_url}" style="max-width:148pt;max-height:120pt;border:1px solid #e5e7eb;border-radius:3px;" />
           <div style="font-size:7.5pt;color:#6b7280;margin-top:2px;">${lbl.figure} ${idx + 1}.</div>
         </div>`
      : "";

    const contentCol = `
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4pt;">
          <div style="font-weight:700;font-size:10pt;white-space:nowrap;">${qNum}</div>
          <div style="flex:1;font-size:10pt;">${q.type === "passage" ? "" : qText}</div>
          <div style="font-size:9pt;font-weight:700;white-space:nowrap;margin-left:6pt;">${marks}</div>
        </div>
        ${bodyHtml}
      </div>`;

    return `
      <div style="page-break-inside:avoid;margin-bottom:12pt;display:flex;align-items:flex-start;gap:0;">
        ${contentCol}
        ${imgCol}
      </div>`
  };

  // ── Multi-subject grouping helpers ─────────────────────────────────────
  const TYPE_ORDER_HTML = ["mcq","true_false","fill_blank","match","short","long","passage","figure"];
  const isMultiSubj = questions.some(q => q.section_label && q.section_label.trim());

  // Subject display for meta row
  const subjectDisplay = (() => {
    if (!isMultiSubj) return subjectName || "______";
    const seen = new Set();
    const names = [];
    questions.forEach(q => {
      const s = (q.section_label || "").trim();
      if (s && !seen.has(s)) { seen.add(s); names.push(s); }
    });
    return names.join(" | ");
  })();

  // Build all question HTML, grouped by subject → type with global numbering
  const renderAllQuestions = () => {
    const parts = [];
    let qNum = 0; // 0-based global counter → renderQuestion shows qNum+1

    if (!isMultiSubj) {
      const sorted = [...questions].sort((a, b) => {
        const ai = TYPE_ORDER_HTML.indexOf(a.type), bi = TYPE_ORDER_HTML.indexOf(b.type);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      let lastType = null;
      sorted.forEach(q => {
        if (q.type !== lastType) {
          lastType = q.type;
          const inst = lbl.sections?.[q.type];
          if (inst) parts.push(`<div class="section-head">${inst}</div>`);
        }
        parts.push(renderQuestion(q, qNum));
        qNum++;
      });
    } else {
      // Group by section_label, maintain insertion order of subjects
      const subjOrder = [];
      const subjMap = {};
      questions.forEach(q => {
        const s = (q.section_label || "").trim() || "General";
        if (!subjMap[s]) { subjMap[s] = []; subjOrder.push(s); }
        subjMap[s].push(q);
      });
      subjOrder.forEach(subj => {
        const sorted = [...subjMap[subj]].sort((a, b) => {
          const ai = TYPE_ORDER_HTML.indexOf(a.type), bi = TYPE_ORDER_HTML.indexOf(b.type);
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        });
        parts.push(`<div class="subject-head">📚 ${subj}</div>`);
        let lastType = null;
        sorted.forEach(q => {
          if (q.type !== lastType) {
            lastType = q.type;
            const inst = lbl.sections?.[q.type];
            if (inst) parts.push(`<div class="section-head">${inst}</div>`);
          }
          parts.push(renderQuestion(q, qNum));
          qNum++;
        });
      });
    }
    return parts.join("");
  };

  return `<!DOCTYPE html>
<html lang="${lbl.htmlLang}" dir="${lbl.dir}">
<head>
  <meta charset="UTF-8"/>
  <script>MathJax={tex:{inlineMath:[['$','$']],displayMath:[['$$','$$']]}};</script>
  <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>
  <style>
    @page { size: A4; margin: 15mm 20mm; }
    * { box-sizing: border-box; }
    body { font-family: ${lbl.font}; font-size: 10pt; color: #000; margin: 0; padding: 0; }
    @media print { body { margin: 0; } }
    .school-header { width: 100%; border-collapse: collapse; margin-bottom: 4pt; direction: ltr; }
    .school-header td { padding: 0; vertical-align: middle; }
    .school-logo-cell { width: 64pt; text-align: left; }
    .school-logo-cell img { width: 60pt; height: 60pt; object-fit: contain; display: block; }
    .school-name-cell { text-align: center; }
    .school-spacer-cell { width: 64pt; }
    h1 { margin: 0; padding: 0; line-height: 1.2; font-size: 16pt; text-align: center; font-weight: 900; }
    .addr { margin: 0; padding: 0; line-height: 1.3; text-align: center; font-size: 9pt; color: #444; }
    .meta-block { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; margin: 6px 0; }
    .meta-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 10pt; font-weight: 700; }
    .hr { border: none; border-top: 2px solid #000; margin: 6px 0; }
    .instructions { margin-bottom: 8pt; }
    .instructions ol { margin: 0; padding-left: 18px; font-size: 9pt; }
    .q-divider { height: 0; border: none; border-top: 1.5px dashed #555; margin: 8pt 0 6pt; }
    .subject-head { background:#1e3a8a; color:#fff; font-size:11pt; font-weight:900; padding:6pt 12pt; border-radius:4pt; margin:14pt 0 4pt; letter-spacing:0.3pt; }
    .section-head { font-size: 9.5pt; font-weight: 700; font-style: italic; margin: 10pt 0 4pt; color:#1e40af; border-left:3px solid #2563eb; padding-left:7pt; }
    .questions { margin-top: 0; }
    .footer { text-align: center; margin-top: 20pt; font-size: 9pt; border-top: 1px solid #000; padding-top: 4px; }
  </style>
  ${lbl.fontUrl ? `<link href="${lbl.fontUrl}" rel="stylesheet"/>` : ""}
</head>
<body>
  <!-- HEADER: table keeps logo physically top-left regardless of dir -->
  <table class="school-header">
    <tr>
      <td class="school-logo-cell">
        ${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : ""}
      </td>
      <td class="school-name-cell">
        <h1>${schoolName}</h1>
        ${schoolAddr ? `<div class="addr">${schoolAddr}</div>` : ""}
      </td>
      <td class="school-spacer-cell"></td>
    </tr>
  </table>
  <div class="hr"></div>
  <div class="meta-block">
    <div class="meta-row">
      <span>${lbl.class} : ${className || "______"}</span>
      <span>${lbl.subject} : ${subjectDisplay}</span>
      <span>${lbl.maxMarks} : ${totalMarks}</span>
    </div>
    ${(examType || session || duration) ? `<div class="meta-row">
      ${examType ? `<span>${examType}</span>` : "<span></span>"}
      ${session  ? `<span>${lbl.session} : ${session}</span>` : "<span></span>"}
      ${duration ? `<span>${lbl.time} : ${duration}</span>` : "<span></span>"}
    </div>` : ""}
  </div>

  <!-- INSTRUCTIONS -->
  ${instructions.length ? `<div class="instructions">
    <b style="font-size:9pt;">${lbl.instructions} :</b>
    <ol>${instructions.map(i => `<li>${i}</li>`).join("")}</ol>
  </div>` : ""}

  <!-- Dotted separator before questions -->
  <hr class="q-divider" />

  <!-- QUESTIONS -->
  <div class="questions">
    ${renderAllQuestions()}
  </div>

  <!-- FOOTER -->
  <div class="footer">----------- ${lbl.footer} -----------</div>
</body>
</html>`;
}

// ─── Screen ────────────────────────────────────────────────────────────────────
export default function PaperPreviewScreen({ navigation, route }) {
  const { paper, questions = [] } = route.params ?? {};
  const { user } = useContext(AuthContext);
  const [exporting, setExporting] = useState(false);

  const html = useMemo(() => generatePaperHTML(paper, questions), [paper, questions]);

  const handlePrint = async () => {
    setExporting(true);
    try {
      await Print.printAsync({ html, base64: false });
    } catch (e) {
      Alert.alert("Error", e.message || "Print failed");
    } finally {
      setExporting(false);
    }
  };

  const handleSharePDF = async () => {
    setExporting(true);
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      // Same pattern as ID card export — opens system share sheet so user can
      // save to Files, WhatsApp, email, or open directly in a PDF viewer
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: paper?.title ?? "Question Paper",
        UTI: "com.adobe.pdf",
      });
    } catch (e) {
      Alert.alert("Error", e.message || "PDF export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleWordExport = async () => {
    const url = getWordExportUrl(user, paper?.id);
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert("Cannot open URL", url);
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Could not open Word export URL");
    }
  };

  return (
    <View style={st.root}>
      {/* Toolbar */}
      <View style={st.toolbar}>
        <Text style={st.toolbarTitle} numberOfLines={1}>{paper?.title ?? "Paper Preview"}</Text>
        <View style={st.toolbarBtns}>
          <TouchableOpacity style={st.exportBtn} onPress={handlePrint} disabled={exporting}>
            <Feather name="printer" size={15} color="#fff" />
            <Text style={st.exportTxt}>Print</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.exportBtn, { backgroundColor: "#dc2626" }]} onPress={handleSharePDF} disabled={exporting}>
            <Feather name="share-2" size={15} color="#fff" />
            <Text style={st.exportTxt}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.exportBtn, { backgroundColor: "#2563eb" }]} onPress={handleWordExport}>
            <Feather name="file-text" size={15} color="#fff" />
            <Text style={st.exportTxt}>Word</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Paper preview */}
      <View style={st.webviewWrap}>
        <WebView
          source={{ html }}
          style={st.webview}
          scalesPageToFit={false}
          scrollEnabled
          originWhitelist={["*"]}
        />
      </View>

      {exporting && (
        <View style={st.exportingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={st.exportingTxt}>Generating…</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root:             { flex: 1, backgroundColor: "#1e293b" },
  toolbar:          { backgroundColor: "#1e3a8a", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  toolbarTitle:     { flex: 1, color: "#fff", fontSize: 14, fontWeight: "800" },
  toolbarBtns:      { flexDirection: "row", gap: 7 },
  exportBtn:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#059669", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  exportTxt:        { color: "#fff", fontSize: 11, fontWeight: "700" },
  webviewWrap:      { flex: 1, backgroundColor: "#fff", margin: 10, borderRadius: 8, overflow: "hidden", elevation: 4 },
  webview:          { flex: 1 },
  exportingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", gap: 12 },
  exportingTxt:     { color: "#fff", fontSize: 15, fontWeight: "700" },
});
