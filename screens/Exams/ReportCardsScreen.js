/**
 * Exams › Report Cards
 * Staff: pick a report card + class → see each student's result, preview / share the PDF,
 *        email it to the parent, or email / print the whole class at once.
 * Students & parents: their published report cards.
 */
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, FlatList, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AuthContext } from "../../context/AuthContext";
import { getClassReports, getReportCard, emailReportCard, getMyReportCards } from "../../services/ReportCardApi";
import { buildReportCardHTML, loadSchoolLogo } from "../../constants/reportCardTemplates";
import { C, Card, Btn, Empty, u } from "../../components/ReportCardUI";
import { useReportCardFilters, ReportCardFilters } from "../../components/ReportCardFilters";
import { _t, _th, _tx } from "../../services/i18n";

const STAFF = ["owner", "admin", "user", "teacher", "staff", "principal", "accountant"];

/** Report card data → HTML (school logo fetched once and reused). */
function useReportHtml(user) {
  const logo = useRef(undefined);
  return useCallback(async (planId, enrollmentId) => {
    const rc = await getReportCard(user, planId, enrollmentId);
    if (logo.current === undefined) logo.current = await loadSchoolLogo(user, rc.school?.logo_name);
    return { rc, html: buildReportCardHTML(rc, logo.current) };
  }, [user]);
}

const fileName = (rc) => `Report_Card_${String(rc.student?.student_name ?? "student").replace(/[^A-Za-z0-9]+/g, "_")}`;

async function sharePdf(html, name) {
  const { uri } = await Print.printToFileAsync({ html: _th(html) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: name, UTI: "com.adobe.pdf" });
  } else {
    await Print.printAsync({ uri });
  }
}

export default function ReportCardsScreen() {
  const { user } = useContext(AuthContext);
  const role = String(user?.ssmsUserRole ?? "").toLowerCase();
  return STAFF.includes(role) ? <StaffView user={user} /> : <MyView user={user} />;
}

// ── Staff ─────────────────────────────────────────────────────────────────
function StaffView({ user }) {
  const f = useReportCardFilters(user);
  const makeHtml = useReportHtml(user);
  const [list, setList]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(null);       // "view-12" | "mail-12" | "bulk"
  const [progress, setProgress] = useState("");

  const load = useCallback(async () => {
    if (!f.planId || !f.classId) { setList(null); return; }
    setLoading(true);
    try { setList(await getClassReports(user, f.planId, f.classId, f.sectionId)); }
    catch (e) { Alert.alert(_t("Report cards"), _tx(e.message)); setList(null); }
    finally { setLoading(false); }
  }, [user, f.planId, f.classId, f.sectionId]);
  useEffect(() => { load(); }, [load]);

  const students = Array.isArray(list?.students) ? list.students : [];

  const onView = async (s) => {
    setBusy("view-" + s.enrollment_id);
    try { const { rc, html } = await makeHtml(f.planId, s.enrollment_id); await sharePdf(html, fileName(rc)); }
    catch (e) { Alert.alert(_t("Report card"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  const emailOne = async (s) => {
    const { html } = await makeHtml(f.planId, s.enrollment_id);
    const { base64 } = await Print.printToFileAsync({ html: _th(html), base64: true });
    return emailReportCard(user, f.planId, s.enrollment_id, base64);
  };

  const onEmail = async (s) => {
    if (!s.email) { Alert.alert(_t("Email"), _t("There is no email address on this student's record.")); return; }
    setBusy("mail-" + s.enrollment_id);
    try { const r = await emailOne(s); Alert.alert(_t("Email"), _tx(r.message)); load(); }
    catch (e) { Alert.alert(_t("Email"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  const onEmailAll = () => {
    const withEmail = students.filter((s) => s.email);
    if (!withEmail.length) { Alert.alert(_t("Email"), _t("None of these students has an email address.")); return; }
    Alert.alert(_t("Email report cards"),
      _t("Email the report card to {length} parent{pl}?", { length: withEmail.length, pl: withEmail.length > 1 ? "s" : "" }) +
      (withEmail.length < students.length ? `
${_t("{v} without an email will be skipped.", { v: students.length - withEmail.length })}` : ""),
      [{ text: _t("Cancel"), style: "cancel" }, { text: _t("Send"), onPress: async () => {
        setBusy("bulk");
        let ok = 0; const failed = [];
        for (let i = 0; i < withEmail.length; i++) {
          setProgress(_t("Sending {n} of {total}…", { n: i + 1, total: withEmail.length }));
          try { await emailOne(withEmail[i]); ok++; } catch (e) { failed.push(withEmail[i].student_name); }
        }
        setBusy(null); setProgress(""); load();
        Alert.alert(_t("Email report cards"), `${ok} sent.` + (failed.length ? `
${_t("Not sent: {v}", { v: failed.join(", ") })}` : ""));
      } }]);
  };

  const onPrintAll = async () => {
    if (!students.length) return;
    setBusy("bulk");
    try {
      const pages = [];
      for (let i = 0; i < students.length; i++) {
        setProgress(_t("Preparing {n} of {total}…", { n: i + 1, total: students.length }));
        const { html } = await makeHtml(f.planId, students[i].enrollment_id);
        // keep each card's <style>, put each on its own page
        pages.push(html.replace("<body>", `<body><div style="page-break-after:always">`).replace("</body>", "</div></body>"));
      }
      const head = pages[0].split("<body>")[0];
      const bodies = pages.map((p) => p.split("<body>")[1].replace("</body></html>", "")).join("");
      await sharePdf(`${head}<body>${bodies}</body></html>`, `Report_Cards_${list?.plan?.name ?? ""}`);
    } catch (e) { Alert.alert(_t("Report cards"), _tx(e.message)); }
    finally { setBusy(null); setProgress(""); }
  };

  if (!f.ready) return <View style={st.center}><ActivityIndicator color={C.brand} size="large" /></View>;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={students}
      keyExtractor={(s) => String(s.enrollment_id)}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      ListHeaderComponent={
        <>
          <Card><ReportCardFilters f={f} /></Card>
          {f.plans.length === 0 && <Empty icon="file-text" text={_t("No report cards yet. An admin can create one in Report Card Setup.")} />}
          {loading && <ActivityIndicator color={C.brand} style={{ marginVertical: 20 }} />}
          {!loading && Array.isArray(list?.coverage) && list.coverage.length > 0 && (
            <Card title={_t("Exams in this report card")}>
              {list.coverage.map((c) => {
                const none = c.students_with_marks === 0;
                return (
                  <View key={String(c.exam_id)} style={st.cov}>
                    <Feather name={none || !c.max_marks_set ? "alert-circle" : "check-circle"} size={16}
                      color={none || !c.max_marks_set ? C.warn : C.ok} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={st.covTitle}>{_tx(c.label)} · {_tx(c.exam_name) || _t("Exam #{exam_id}", { exam_id: c.exam_id })} · {Number(c.weight)}%</Text>
                      <Text style={st.meta}>{_t("Marks entered for {students_with_marks} of {students} students{v}{v2}", { students_with_marks: c.students_with_marks, students: c.students, v: !c.max_marks_set ? (" " + _t("· max marks not set for this class (Exam Setup)") + "") : "", v2: none && c.marks_in_school > 0 ? (" " + _t("· this exam has marks for other classes – check the exam chosen in Report Card Setup") + "") : "" })}</Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
          {students.length > 0 && !loading && (
            <Card title={_t("{length} students", { length: students.length })}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn title={_t("Email all")} icon="mail" style={{ flex: 1 }} busy={busy === "bulk"} disabled={!!busy} onPress={onEmailAll} />
                <Btn title={_t("One PDF")} icon="printer" kind="ghost" style={{ flex: 1 }} disabled={!!busy} onPress={onPrintAll} />
              </View>
              {!!progress && <Text style={[u.hint, { marginTop: 8 }]}>{_tx(progress)}</Text>}
            </Card>
          )}
        </>
      }
      ListEmptyComponent={!!list && !loading ? <Empty icon="users" text={_t("No students found for this class.")} /> : null}
      renderItem={({ item: s }) => (
        <View style={st.row}>
          <View style={{ flex: 1 }}>
            <Text style={st.name} numberOfLines={1}>{s.roll_number ? `${_tx(s.roll_number)}. ` : ""}{_tx(s.student_name)}</Text>
            <Text style={st.meta}>
              {s.percent === null || s.percent === undefined ? _t("No marks yet") : `${_tx(s.percent)}% · ${_tx(s.grade) ?? "—"}`}
              {s.gpa !== null && s.gpa !== undefined && list?.plan?.show_gpa ? ` ${_t("· GPA {gpa}", { gpa: s.gpa })}` : ""}
              {s.rank ? ` ${_t("· Rank {rank}", { rank: s.rank })}` : ""}
            </Text>
            {!!s.error && <Text style={[st.sent, { color: C.err }]} numberOfLines={2}>{_tx(s.error)}</Text>}
            {!!s.last_sent && (
              <Text style={[st.sent, s.last_sent.status !== "sent" && { color: C.err }]}>
                {s.last_sent.status === "sent" ? _t("✓ Emailed") : _t("Email failed")} {String(s.last_sent.created ?? "").slice(0, 10)}
              </Text>
            )}
          </View>
          <TouchableOpacity style={st.icon} onPress={() => onView(s)} disabled={!!busy}>
            {busy === "view-" + s.enrollment_id ? <ActivityIndicator color={C.brand} /> : <Feather name="file-text" size={20} color={C.brand} />}
          </TouchableOpacity>
          <TouchableOpacity style={[st.icon, !s.email && { opacity: 0.35 }]} onPress={() => onEmail(s)} disabled={!!busy}>
            {busy === "mail-" + s.enrollment_id ? <ActivityIndicator color={C.brand} /> : <Feather name="mail" size={20} color={C.brand} />}
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

// ── Students & parents ────────────────────────────────────────────────────
function MyView({ user }) {
  const makeHtml = useReportHtml(user);
  const [items, setItems]     = useState(null);
  const [busy, setBusy]       = useState(null);

  const load = useCallback(async () => {
    try { const r = await getMyReportCards(user); setItems(Array.isArray(r) ? r : []); }
    catch (e) { Alert.alert(_t("Report cards"), _tx(e.message)); setItems([]); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const open = async (it) => {
    const key = `${it.id}-${it.enrollment_id}`;
    setBusy(key);
    try { const { rc, html } = await makeHtml(it.id, it.enrollment_id); await sharePdf(html, fileName(rc)); }
    catch (e) { Alert.alert(_t("Report card"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  if (items === null) return <View style={st.center}><ActivityIndicator color={C.brand} size="large" /></View>;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16 }}
      data={items}
      keyExtractor={(it) => `${it.id}-${it.enrollment_id}`}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      ListEmptyComponent={<Empty icon="file-text" text={_t("No report cards have been published yet.")} />}
      renderItem={({ item: it }) => (
        <TouchableOpacity style={st.row} onPress={() => open(it)} disabled={!!busy} activeOpacity={0.75}>
          <View style={[st.icon, { backgroundColor: C.brandSoft, borderRadius: 10 }]}>
            <Feather name="award" size={20} color={C.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{_tx(it.name)}</Text>
            <Text style={st.meta}>{[it.student_name, it.class_name, it.session_name].filter(Boolean).join(" · ")}</Text>
          </View>
          {busy === `${it.id}-${it.enrollment_id}` ? <ActivityIndicator color={C.brand} /> : <Feather name="download" size={18} color={C.brand} />}
        </TouchableOpacity>
      )}
    />
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8,
         borderWidth: 1, borderColor: C.line, gap: 8 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  sent: { fontSize: 11, color: C.ok, marginTop: 2, fontWeight: "600" },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  cov: { flexDirection: "row", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  covTitle: { fontSize: 13, fontWeight: "700", color: C.ink },
});
