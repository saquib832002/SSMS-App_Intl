/**
 * screens/Exams/ImportQuestionsScreen.js
 *
 * Bulk-import questions from an Excel (.xlsx) file.
 *
 * Flow:
 *  1. Download Template  → builds an .xlsx with two sheets:
 *       "Questions"  — column headers + 3 example rows
 *       "Reference"  — all valid branch/session/class/subject names
 *  2. Pick & Parse       → expo-document-picker → SheetJS parse → validate rows
 *  3. Preview            → scrollable table with error rows highlighted in red
 *  4. Import             → sends valid rows to /QuestionBankApi/importQuestions
 *  5. Results            → summary: imported / failed / row-level errors
 *
 * Excel column layout (Questions sheet):
 *  A  type          | mcq / multi_correct / true_false / short / long
 *  B  question_text | Required
 *  C  option_a      | Required for MCQ / true_false
 *  D  option_b      | Required for MCQ / true_false
 *  E  option_c      | Optional (MCQ only)
 *  F  option_d      | Optional (MCQ only)
 *  G  answer        | A/B/C/D  — comma-separated for multi_correct (A,C)
 *                   | True or False for true_false  — blank for short/long
 *  H  marks         | Number (default 1)
 *  I  negative_marks| Number (default 0)
 *  J  difficulty    | easy / medium / hard
 *  K  chapter       | Text (optional)
 *  L  explanation   | Text (optional)
 *  M  subject_name  | Must match a name in the Reference sheet
 *  N  class_name    | Must match a name in the Reference sheet
 *  O  branch_name   | Optional — defaults to your branch
 *  P  session_name  | Optional — defaults to the active session
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert, FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { read as xlsxRead, utils as xlsxUtils, write as xlsxWrite } from "xlsx";
import { AuthContext } from "../../context/AuthContext";
import { getImportReference, importQuestions } from "../../services/QuestionPaperServiceApi";

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMNS = [
  { key: "type",           header: "Type *",          example1: "mcq",          example2: "true_false",  example3: "short"  },
  { key: "question_text",  header: "Question Text *",  example1: "What is 2+2?", example2: "The sun rises in the east.", example3: "Explain photosynthesis." },
  { key: "option_a",       header: "Option A",         example1: "3",            example2: "True",        example3: ""       },
  { key: "option_b",       header: "Option B",         example1: "4",            example2: "False",       example3: ""       },
  { key: "option_c",       header: "Option C",         example1: "5",            example2: "",            example3: ""       },
  { key: "option_d",       header: "Option D",         example1: "6",            example2: "",            example3: ""       },
  { key: "answer",         header: "Answer *",         example1: "B",            example2: "True",        example3: ""       },
  { key: "marks",          header: "Marks",            example1: "2",            example2: "1",           example3: "5"      },
  { key: "negative_marks", header: "Negative Marks",   example1: "0.5",          example2: "0",           example3: "0"      },
  { key: "difficulty",     header: "Difficulty",       example1: "easy",         example2: "medium",      example3: "hard"   },
  { key: "chapter",        header: "Chapter",          example1: "Arithmetic",   example2: "Solar System","example3": ""     },
  { key: "explanation",    header: "Explanation",      example1: "",             example2: "",            example3: ""       },
  { key: "subject_name",   header: "Subject Name *",   example1: "Mathematics",  example2: "Science",     example3: "Biology"},
  { key: "class_name",     header: "Class Name *",     example1: "Grade 5",      example2: "Grade 6",     example3: "Grade 9"},
  { key: "branch_name",    header: "Branch Name",      example1: "",             example2: "",            example3: ""       },
  { key: "session_name",   header: "Session Name",     example1: "",             example2: "",            example3: ""       },
];

const COL_KEYS = COLUMNS.map(c => c.key);

// ── Validate a single parsed row (client-side pre-check) ──────────────────────
function validateRow(row, refData) {
  const errs = [];
  const type = (row.type ?? "").toLowerCase().trim();
  const validTypes = ["mcq", "multi_correct", "true_false", "short", "long",
                      "fill_blank", "passage", "figure", "match"];
  if (!type)                     errs.push("Type is required");
  else if (!validTypes.includes(type)) errs.push(`Unknown type "${row.type}"`);
  if (!(row.question_text ?? "").trim()) errs.push("Question text is required");

  const subjectNames = (refData?.subjects ?? []).map(s => s.name.toLowerCase());
  const className    = (refData?.classes  ?? []).map(c => c.name.toLowerCase());
  const sn = (row.subject_name ?? "").toLowerCase().trim();
  const cn = (row.class_name   ?? "").toLowerCase().trim();
  if (!sn) errs.push("Subject name is required");
  else if (refData && subjectNames.length && !subjectNames.includes(sn))
    errs.push(`Subject "${row.subject_name}" not found — check Reference sheet`);
  if (!cn) errs.push("Class name is required");
  else if (refData && className.length && !className.includes(cn))
    errs.push(`Class "${row.class_name}" not found — check Reference sheet`);

  if (["mcq", "multi_correct", "true_false"].includes(type)) {
    if (!(row.option_a ?? "").trim()) errs.push("Option A is required");
    if (!(row.option_b ?? "").trim()) errs.push("Option B is required");
    if (!(row.answer   ?? "").trim()) errs.push("Answer is required");
  }
  return errs;
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ImportQuestionsScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [refData,      setRefData]      = useState(null);
  const [refLoading,   setRefLoading]   = useState(true);
  const [parsedRows,   setParsedRows]   = useState(null);  // null = nothing picked yet
  const [rowErrors,    setRowErrors]    = useState({});    // idx → [string]
  const [fileName,     setFileName]     = useState("");
  const [importing,    setImporting]    = useState(false);
  const [result,       setResult]       = useState(null);  // import summary

  // ── Load reference data ────────────────────────────────────────────────────
  useEffect(() => {
    getImportReference(user)
      .then(data => setRefData(data))
      .catch(() => setRefData({}))
      .finally(() => setRefLoading(false));
  }, [user]);

  // ── Download template ──────────────────────────────────────────────────────
  const handleDownloadTemplate = useCallback(async () => {
    try {
      const wb = xlsxUtils.book_new();

      // ── Sheet 1: Questions ─────────────────────────────────────────────────
      const headers  = COLUMNS.map(c => c.header);
      const example1 = COLUMNS.map(c => c.example1);
      const example2 = COLUMNS.map(c => c.example2);
      const example3 = COLUMNS.map(c => c.example3);
      const wsData   = [headers, example1, example2, example3];
      const ws1      = xlsxUtils.aoa_to_sheet(wsData);
      // Widen columns
      ws1["!cols"] = COLUMNS.map((_, i) => ({ wch: i < 2 ? 14 : i < 6 ? 22 : 18 }));
      xlsxUtils.book_append_sheet(wb, ws1, "Questions");

      // ── Sheet 2: Reference ─────────────────────────────────────────────────
      const ref     = refData ?? {};
      const maxLen  = Math.max(
        (ref.branches ?? []).length,
        (ref.sessions ?? []).length,
        (ref.classes  ?? []).length,
        (ref.subjects ?? []).length,
        1,
      );
      const refHeaders = ["Branch Names", "Session Names", "Class Names", "Subject Names"];
      const refRows    = [[...refHeaders]];
      for (let i = 0; i < maxLen; i++) {
        refRows.push([
          ref.branches?.[i]?.name ?? "",
          ref.sessions?.[i]?.name ?? "",
          ref.classes?.[i]?.name  ?? "",
          ref.subjects?.[i]?.name ?? "",
        ]);
      }
      const ws2  = xlsxUtils.aoa_to_sheet(refRows);
      ws2["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
      xlsxUtils.book_append_sheet(wb, ws2, "Reference");

      // ── Write & share ──────────────────────────────────────────────────────
      const b64  = xlsxWrite(wb, { type: "base64", bookType: "xlsx" });
      const path = FileSystem.cacheDirectory + "QuestionImportTemplate.xlsx";
      await FileSystem.writeAsStringAsync(path, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: "Save Question Import Template",
        });
      } else {
        Alert.alert("Saved", "Template saved to app cache:\n" + path);
      }
    } catch (e) {
      Alert.alert("Error", "Could not generate template: " + e.message);
    }
  }, [refData]);

  // ── Pick & parse Excel file ────────────────────────────────────────────────
  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset) return;
      setFileName(asset.name ?? "file.xlsx");
      setParsedRows(null);
      setRowErrors({});
      setResult(null);

      // Read as base64 → SheetJS
      const b64  = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const wb   = xlsxRead(b64, { type: "base64" });
      const wsName = wb.SheetNames[0];
      const ws   = wb.Sheets[wsName];
      const raw  = xlsxUtils.sheet_to_json(ws, { defval: "" });

      // Normalise header keys: strip *, lowercase, replace spaces with _
      const normalise = (key) =>
        key.replace(/\s*\*\s*/g, "").toLowerCase().replace(/\s+/g, "_").trim();

      const rows = raw.map(r => {
        const out = {};
        Object.entries(r).forEach(([k, v]) => { out[normalise(k)] = String(v ?? "").trim(); });
        return out;
      }).filter(r => Object.values(r).some(v => v !== ""));

      if (rows.length === 0) {
        Alert.alert("Empty file", "No data rows found. Make sure the Questions sheet has data below the header.");
        return;
      }

      // Validate each row
      const errs = {};
      rows.forEach((row, i) => {
        const e = validateRow(row, refData);
        if (e.length) errs[i] = e;
      });

      setParsedRows(rows);
      setRowErrors(errs);
    } catch (e) {
      Alert.alert("Error", "Could not read file: " + e.message);
    }
  }, [refData]);

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!parsedRows?.length) return;
    const errorCount = Object.keys(rowErrors).length;
    if (errorCount > 0) {
      Alert.alert(
        "Validation errors",
        `${errorCount} row(s) have errors and will be skipped. Import the remaining ${parsedRows.length - errorCount} valid rows?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Import valid rows", onPress: doImport },
        ],
      );
    } else {
      doImport();
    }
  }, [parsedRows, rowErrors]);

  const doImport = useCallback(async () => {
    setImporting(true);
    try {
      const res = await importQuestions(user, parsedRows);
      setResult(res);
      if (res.imported > 0) setParsedRows(null);
    } catch (e) {
      Alert.alert("Import failed", e.message);
    } finally {
      setImporting(false);
    }
  }, [user, parsedRows]);

  // ── Counts ─────────────────────────────────────────────────────────────────
  const totalRows   = parsedRows?.length ?? 0;
  const errorRows   = Object.keys(rowErrors).length;
  const validRows   = totalRows - errorRows;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Step 1: Download template ──────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.stepRow}>
            <View style={s.stepBadge}><Text style={s.stepNum}>1</Text></View>
            <Text style={s.stepTitle}>Download the Template</Text>
          </View>
          <Text style={s.stepDesc}>
            Get the Excel template with two sheets:{"\n"}
            • <Text style={s.bold}>Questions</Text> — fill in your questions here{"\n"}
            • <Text style={s.bold}>Reference</Text> — lists valid names for subject, class, branch &amp; session
          </Text>
          {refLoading
            ? <ActivityIndicator color="#2563eb" style={{ marginTop: 12 }} />
            : (
              <TouchableOpacity style={s.btn} onPress={handleDownloadTemplate}>
                <Feather name="download" size={16} color="#fff" />
                <Text style={s.btnTxt}>Download Template (.xlsx)</Text>
              </TouchableOpacity>
            )}
        </View>

        {/* ── Step 2: Pick file ──────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.stepRow}>
            <View style={s.stepBadge}><Text style={s.stepNum}>2</Text></View>
            <Text style={s.stepTitle}>Fill in &amp; Pick your File</Text>
          </View>
          <Text style={s.stepDesc}>
            Fill in the template and save it. Then tap below to pick the file.
          </Text>
          <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={handlePickFile}>
            <Feather name="upload" size={16} color="#2563eb" />
            <Text style={[s.btnTxt, { color: "#2563eb" }]}>
              {fileName ? `Re-pick file` : "Pick Excel File"}
            </Text>
          </TouchableOpacity>
          {!!fileName && (
            <View style={s.fileNameRow}>
              <Feather name="file-text" size={13} color="#64748b" />
              <Text style={s.fileNameTxt} numberOfLines={1}>{fileName}</Text>
            </View>
          )}
        </View>

        {/* ── Step 3: Preview ───────────────────────────────────────────── */}
        {parsedRows !== null && (
          <View style={s.card}>
            <View style={s.stepRow}>
              <View style={s.stepBadge}><Text style={s.stepNum}>3</Text></View>
              <Text style={s.stepTitle}>Preview &amp; Validate</Text>
            </View>

            {/* Summary chips */}
            <View style={s.chipRow}>
              <View style={[s.chip, { backgroundColor: "#dcfce7" }]}>
                <Text style={[s.chipTxt, { color: "#16a34a" }]}>✓ {validRows} valid</Text>
              </View>
              {errorRows > 0 && (
                <View style={[s.chip, { backgroundColor: "#fee2e2" }]}>
                  <Text style={[s.chipTxt, { color: "#dc2626" }]}>✗ {errorRows} errors</Text>
                </View>
              )}
              <View style={[s.chip, { backgroundColor: "#f1f5f9" }]}>
                <Text style={[s.chipTxt, { color: "#475569" }]}>{totalRows} total rows</Text>
              </View>
            </View>

            {/* Row preview */}
            <ScrollView horizontal showsHorizontalScrollIndicator style={s.tableScroll}>
              <View>
                {/* Header */}
                <View style={[s.tableRow, s.tableHeader]}>
                  <Text style={[s.cell, s.cellNum, s.headerTxt]}>#</Text>
                  {["Type","Question","Opt A","Opt B","Answer","Marks","Subject","Class"].map(h => (
                    <Text key={h} style={[s.cell, s.headerTxt]}>{h}</Text>
                  ))}
                  <Text style={[s.cell, s.cellStatus, s.headerTxt]}>Status</Text>
                </View>
                {parsedRows.map((row, i) => {
                  const errs = rowErrors[i];
                  const hasErr = !!(errs?.length);
                  return (
                    <View key={i} style={[s.tableRow, hasErr && s.tableRowErr]}>
                      <Text style={[s.cell, s.cellNum]}>{i + 2}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.type ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.question_text ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.option_a ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.option_b ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.answer ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.marks ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.subject_name ?? ""}</Text>
                      <Text style={s.cell} numberOfLines={1}>{row.class_name ?? ""}</Text>
                      <Text style={[s.cell, s.cellStatus, hasErr ? s.errTxt : s.okTxt]}>
                        {hasErr ? "✗ Error" : "✓ OK"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Error details */}
            {errorRows > 0 && (
              <View style={s.errBox}>
                <Text style={s.errBoxTitle}>Errors to fix before importing:</Text>
                {Object.entries(rowErrors).map(([idx, errs]) =>
                  errs.map((msg, j) => (
                    <Text key={`${idx}-${j}`} style={s.errItem}>
                      Row {Number(idx) + 2}: {msg}
                    </Text>
                  ))
                )}
              </View>
            )}

            {/* Import button */}
            <TouchableOpacity
              style={[s.btn, s.btnImport, importing && { opacity: 0.6 }]}
              onPress={handleImport}
              disabled={importing || validRows === 0}
            >
              {importing
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="upload-cloud" size={16} color="#fff" />}
              <Text style={s.btnTxt}>
                {importing
                  ? "Importing…"
                  : `Import ${validRows} Question${validRows !== 1 ? "s" : ""}`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 4: Result ────────────────────────────────────────────── */}
        {result && (
          <View style={[s.card, s.resultCard]}>
            <Text style={s.resultTitle}>Import Complete</Text>
            <View style={s.resultRow}>
              <View style={[s.resultBadge, { backgroundColor: "#dcfce7" }]}>
                <Text style={[s.resultNum, { color: "#16a34a" }]}>{result.imported}</Text>
                <Text style={s.resultLabel}>Imported</Text>
              </View>
              <View style={[s.resultBadge, { backgroundColor: "#fee2e2" }]}>
                <Text style={[s.resultNum, { color: "#dc2626" }]}>{result.failed ?? 0}</Text>
                <Text style={s.resultLabel}>Failed</Text>
              </View>
            </View>
            {result.errors?.length > 0 && (
              <View style={s.errBox}>
                <Text style={s.errBoxTitle}>Server-side errors:</Text>
                {result.errors.map((e, i) => (
                  <Text key={i} style={s.errItem}>Row {e.row}: {e.message}</Text>
                ))}
              </View>
            )}
            {result.imported > 0 && (
              <TouchableOpacity
                style={[s.btn, { marginTop: 12 }]}
                onPress={() => navigation.goBack()}
              >
                <Feather name="check" size={16} color="#fff" />
                <Text style={s.btnTxt}>Back to Question Bank</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#f8fafc" },
  scroll:        { padding: 16, paddingBottom: 40 },
  card:          { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 14,
                   borderWidth: 1, borderColor: "#e2e8f0",
                   shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6,
                   shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  stepRow:       { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  stepBadge:     { width: 26, height: 26, borderRadius: 13, backgroundColor: "#2563eb",
                   alignItems: "center", justifyContent: "center", marginRight: 10 },
  stepNum:       { color: "#fff", fontWeight: "800", fontSize: 13 },
  stepTitle:     { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  stepDesc:      { fontSize: 13, color: "#475569", lineHeight: 20, marginBottom: 12 },
  bold:          { fontWeight: "700" },

  btn:           { flexDirection: "row", alignItems: "center", gap: 8,
                   backgroundColor: "#2563eb", borderRadius: 10,
                   paddingVertical: 11, paddingHorizontal: 16, justifyContent: "center" },
  btnSecondary:  { backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe" },
  btnImport:     { backgroundColor: "#16a34a", marginTop: 14 },
  btnTxt:        { color: "#fff", fontWeight: "700", fontSize: 14 },
  fileNameRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  fileNameTxt:   { fontSize: 12, color: "#64748b", flex: 1 },

  chipRow:       { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  chip:          { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  chipTxt:       { fontSize: 12, fontWeight: "700" },

  tableScroll:   { marginBottom: 4 },
  tableRow:      { flexDirection: "row", borderBottomWidth: 1, borderColor: "#f1f5f9" },
  tableHeader:   { backgroundColor: "#f8fafc" },
  tableRowErr:   { backgroundColor: "#fff5f5" },
  cell:          { width: 110, paddingHorizontal: 8, paddingVertical: 7,
                   fontSize: 12, color: "#334155", borderRightWidth: 1, borderColor: "#f1f5f9" },
  cellNum:       { width: 36 },
  cellStatus:    { width: 72 },
  headerTxt:     { fontWeight: "700", color: "#0f172a", fontSize: 11 },
  errTxt:        { color: "#dc2626", fontWeight: "700" },
  okTxt:         { color: "#16a34a", fontWeight: "700" },

  errBox:        { backgroundColor: "#fff5f5", borderRadius: 8, padding: 12,
                   borderWidth: 1, borderColor: "#fecaca", marginTop: 12 },
  errBoxTitle:   { fontWeight: "700", color: "#991b1b", marginBottom: 6, fontSize: 13 },
  errItem:       { fontSize: 12, color: "#b91c1c", marginBottom: 3 },

  resultCard:    { borderColor: "#bbf7d0", backgroundColor: "#f9fffe" },
  resultTitle:   { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 12 },
  resultRow:     { flexDirection: "row", gap: 12, marginBottom: 8 },
  resultBadge:   { flex: 1, borderRadius: 10, padding: 14, alignItems: "center" },
  resultNum:     { fontSize: 28, fontWeight: "900" },
  resultLabel:   { fontSize: 12, color: "#64748b", marginTop: 2, fontWeight: "600" },
});
