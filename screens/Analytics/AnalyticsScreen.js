/**
 * School analytics – attendance trends, students needing attention, fee collection against
 * what is due (and the school's monthly targets), and class performance.
 *
 * Who sees what is decided by the server (Roles & permissions › Reports & analytics, plus
 * Attendance / Exams / Fees view). Teachers with "own classes only" see their classes, and never fees.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import { LineChart, BarChart, HBars, StatTile, Legend, PALETTE, STATUS, INK } from "../../components/Charts";
import {
  getFilters, getOverview, getAttendance, getAtRisk, getFees, getPerformance, shareAtRiskCsv,
  monthLabel, monthYear, shortDate, fullDate, pct, money,
} from "../../services/AnalyticsApi";
import { _t, _tx } from "../../services/i18n";

const TABS = [
  { key: "overview", get label() { return _t("Overview"); }, icon: "grid" },
  { key: "attendance", get label() { return _t("Attendance"); }, icon: "check-square", need: "attendance" },
  { key: "risk", get label() { return _t("At risk"); }, icon: "alert-triangle" },
  { key: "fees", get label() { return _t("Fees"); }, icon: "dollar-sign", need: "fees" },
  { key: "classes", get label() { return _t("Classes"); }, icon: "bar-chart-2", need: "exams" },
];
const LOADERS = { overview: getOverview, attendance: getAttendance, risk: getAtRisk, fees: getFees, classes: getPerformance };

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

/** Date ranges worked out from the school's own "today" (not the phone's clock). */
function rangeFor(key, today) {
  if (!today) return {};
  const [y, m] = today.split("-").map(Number);
  switch (key) {
    case "30d": return { from: addDays(today, -29), to: today };
    case "90d": return { from: addDays(today, -89), to: today };
    case "month": return { from: `${y}-${pad(m)}-01`, to: today };
    case "lastmonth": {
      const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(last)}` };
    }
    default: return {};   // school year – the server's default
  }
}
const RANGES = [
  { value: "year", get label() { return _t("This school year"); } }, { value: "month", get label() { return _t("This month"); } }, { value: "lastmonth", get label() { return _t("Last month"); } },
  { value: "30d", get label() { return _t("Last 30 days"); } }, { value: "90d", get label() { return _t("Last 90 days"); } }, { value: "custom", get label() { return _t("Choose dates…"); } },
];

function Level({ level }) {
  const crit = level === "critical";
  return (
    <View style={[s.level, { borderColor: crit ? STATUS.critical : STATUS.warning }]}>
      <Feather name={crit ? "alert-octagon" : "eye"} size={11} color={crit ? STATUS.critical : "#a16207"} />
      <Text style={s.levelTxt}>{crit ? _t("At risk") : _t("Watch")}</Text>
    </View>
  );
}

function Chip({ on, label, onPress, icon }) {
  return (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress} activeOpacity={0.8}>
      {!!icon && <Feather name={icon} size={12} color={on ? C.brand : C.muted} style={{ marginRight: 4 }} />}
      <Text style={[s.chipTxt, on && { color: C.brand }]}>{_tx(label)}</Text>
    </TouchableOpacity>
  );
}

function Note({ children }) { return <Text style={s.note}>{_tx(children)}</Text>; }

export default function AnalyticsScreen({ navigation, route }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState(null);
  const [tab, setTab] = useState(route?.params?.tab ?? "overview");
  const [f, setF] = useState({ session_id: "", cls: "", branch_id: "", range: "year", from: "", to: "" });
  const [examId, setExamId] = useState("");
  const [data, setData] = useState({});
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [riskLevel, setRiskLevel] = useState("all");
  const [riskKind, setRiskKind] = useState("all");
  const [trendClass, setTrendClass] = useState(null);
  const seq = useRef(0);
  const metaSeq = useRef(0);

  const loadMeta = useCallback(async (sessionId) => {
    const my = ++metaSeq.current;
    try {
      const m = await getFilters(user, sessionId ? { session_id: sessionId } : {});
      if (my !== metaSeq.current) return true;
      setMeta(m); setMetaErr(null);
      return true;
    } catch (e) { if (my === metaSeq.current) setMetaErr(e.message); return false; }
  }, [user]);

  // back from Analytics settings after a save: thresholds changed, so start fresh
  const saved = route?.params?.saved;
  useEffect(() => {
    if (!saved) return;
    setData({});
    loadMeta(f.session_id || "").then((ok) => { if (!ok) load(tab); });   // filters failed: still reload the tab
  }, [saved]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMeta(""); }, [loadMeta]);

  const can = meta?.can ?? {};
  const tabs = TABS.filter((t) => !t.need || can[t.need]);
  useEffect(() => { if (meta && !tabs.some((t) => t.key === tab)) setTab("overview"); }, [meta]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Filters sent to the server */
  const query = useMemo(() => {
    const [classId, sectionId] = String(f.cls || "").split("|");
    const r = f.range === "custom" ? { from: f.from, to: f.to } : rangeFor(f.range, meta?.today);
    return { session_id: f.session_id || undefined, class_id: classId || undefined, section_id: sectionId || undefined,
      branch_id: f.branch_id || undefined, from: r.from || undefined, to: r.to || undefined, exam_id: tab === "classes" ? (examId || undefined) : undefined };
  }, [f, meta?.today, tab, examId]);
  const key = JSON.stringify(query);

  const load = useCallback(async (which = tab) => {
    if (!meta) return;
    const my = ++seq.current;
    setBusy(true);
    setErrs((x) => ({ ...x, [which]: null }));
    try {
      const d = await LOADERS[which](user, query);
      if (my !== seq.current) return;
      setData((x) => ({ ...x, [which]: { key, d } }));
      setErrs((x) => ({ ...x, [which]: null }));
    } catch (e) {
      if (my !== seq.current) return;
      setErrs((x) => ({ ...x, [which]: e.message }));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [meta, tab, user, query, key]);
  useEffect(() => { if (meta && data[tab]?.key !== key) load(tab); }, [meta, tab, key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { setData({}); load(tab); };
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cur = data[tab]?.key === key ? data[tab].d : null;
  const err = errs[tab];
  const currency = meta?.currency;
  const openStudent = (r) => r?.enrollment_id && navigation.navigate("StudentRecord", { enrollmentId: String(r.enrollment_id) });

  const classOpts = useMemo(() => {
    const out = [{ value: "", label: meta?.own ? _t("All my classes") : _t("All classes") }];
    (meta?.classes ?? []).forEach((c) => {
      const secs = c.sections ?? [];
      if (!meta?.own || secs.length !== 1) out.push({ value: `${c.class_id}`, label: c.name });
      secs.forEach((x) => out.push({ value: `${c.class_id}|${x.section_id}`, label: `${c.name} ${x.name}`, sub: secs.length > 1 ? _t("Section") : undefined }));
    });
    return out;
  }, [meta]);

  const exportCsv = async () => {
    setExporting(true);
    try { await shareAtRiskCsv(user, query); } catch (e) { Alert.alert(_t("Export"), _tx(e.message)); } finally { setExporting(false); }
  };

  if (!meta) {
    return (
      <View style={[s.center, { backgroundColor: C.bg }]}>
        {metaErr ? (
          <Card style={{ margin: 16, alignSelf: "stretch" }}>
            <Empty icon="alert-circle" text={_tx(metaErr)} />
            <Btn title={_t("Try again")} icon="refresh-cw" kind="ghost" onPress={() => loadMeta("")} />
          </Card>
        ) : <ActivityIndicator color={C.brand} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 6, alignItems: "center" }}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)} activeOpacity={0.8}
            accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Feather name={t.icon} size={13} color={tab === t.key ? "#fff" : C.muted} />
            <Text style={[s.tabTxt, tab === t.key && { color: "#fff" }]}>{_tx(t.label)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={busy && !!cur} onRefresh={refresh} />}>
        {/* Filters – one row */}
        <View style={s.filters}>
          <View style={{ flex: 1 }}>
            <Picker value={f.cls} options={classOpts} onChange={(v) => set("cls", v)} placeholder={_t("All classes")} />
          </View>
          <View style={{ flex: 1 }}>
            <Picker value={f.range} options={RANGES} onChange={(v) => setF((x) => ({ ...x, range: v,
              ...(v === "custom" && !x.from ? { from: meta.from, to: meta.to } : {}) }))} />
          </View>
        </View>
        {(meta.sessions?.length > 1 || meta.branches?.length > 0) && (
          <View style={s.filters}>
            {meta.sessions?.length > 1 && (
              <View style={{ flex: 1 }}>
                <Picker value={f.session_id || meta.session_id} options={meta.sessions.map((x) => ({ value: x.id, label: x.name, sub: x.current ? _t("Current") : undefined }))}
                  onChange={(v) => { setF((x) => ({ ...x, session_id: String(v), range: "year", cls: "" })); setExamId(""); setData({}); loadMeta(String(v)); }} />
              </View>
            )}
            {meta.branches?.length > 0 && (
              <View style={{ flex: 1 }}>
                <Picker value={f.branch_id} options={[{ value: "", label: _t("All branches") }, ...meta.branches.map((b) => ({ value: String(b.branch_id), label: b.name }))]}
                  onChange={(v) => set("branch_id", v)} />
              </View>
            )}
          </View>
        )}
        {f.range === "custom" && (
          <View style={s.filters}>
            <View style={{ flex: 1 }}><DateTimeField label={_t("From")} value={f.from} maximumDate={new Date(`${meta.today}T12:00:00`)} onChange={(v) => set("from", v)} /></View>
            <View style={{ flex: 1 }}><DateTimeField label={_t("To")} value={f.to} maximumDate={new Date(`${meta.today}T12:00:00`)} onChange={(v) => set("to", v)} /></View>
          </View>
        )}
        {meta.own && <Note>{_t("Showing your classes only.")}</Note>}
        {!!metaErr && <Note>{_t("Couldn't load that school year's filters:")}{" "}{metaErr}</Note>}

        {!!err && (
          <Card>
            <Empty icon="alert-circle" text={_tx(err)} />
            <Btn title={_t("Try again")} icon="refresh-cw" kind="ghost" onPress={() => load(tab)} />
          </Card>
        )}
        {!cur && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}

        {cur && tab === "overview" && <Overview d={cur} currency={currency} go={setTab} />}
        {cur && tab === "attendance" && <Attendance d={cur} open={openStudent} />}
        {cur && tab === "risk" && (
          <Risk d={cur} level={riskLevel} setLevel={setRiskLevel} kind={riskKind} setKind={setRiskKind} open={openStudent}
            canExport={can.export} exporting={exporting} onExport={exportCsv} canEdit={can.edit} onSettings={() => navigation.navigate("AnalyticsSettings", { sessionId: f.session_id || meta.session_id })} />
        )}
        {cur && tab === "fees" && <Fees d={cur} open={openStudent} canEdit={can.edit} onTargets={() => navigation.navigate("AnalyticsSettings", { sessionId: f.session_id || meta.session_id, focus: "targets" })} />}
        {cur && tab === "classes" && <Classes d={cur} examId={examId} setExamId={setExamId} trendClass={trendClass} setTrendClass={setTrendClass} />}

        {can.edit && tab === "overview" && cur && (
          <Btn title={_t("Thresholds & collection targets")} icon="sliders" kind="ghost" onPress={() => navigation.navigate("AnalyticsSettings", { sessionId: f.session_id || meta.session_id })} />
        )}
      </ScrollView>
    </View>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ d, currency, go }) {
  const a = d.attendance, fe = d.fees, ex = d.exams, r = d.at_risk ?? { critical: 0, watch: 0 };
  const change = a?.change;
  return (
    <>
      <Text style={s.period}>{_t("{from} – {to} · {students} students", { from: fullDate(d.from), to: fullDate(d.to), students: d.students })}</Text>
      <View style={s.tiles}>
        {a && (
          <StatTile label={a.ends_today === false ? _t("Week to {week_to}", { week_to: shortDate(a.week_to) }) : _t("Last 7 days")} value={pct(a.week_pct)}
            sub={change == null ? _t("No earlier week to compare") : _t("{v} {v2} points vs the week before", { v: change >= 0 ? "▲" : "▼", v2: Math.abs(change).toFixed(1) })}
            tone={change == null ? null : change >= 0 ? "good" : change <= -3 ? "critical" : "warning"} />
        )}
        {a && a.ends_today !== false && (
          <StatTile label={_t("Today")} value={a.today_marked ? pct(a.today_pct) : "–"}
            sub={a.today_marked ? _t("{today_marked} marked", { today_marked: a.today_marked }) : _t("Attendance not taken yet")} />
        )}
        <TouchableOpacity style={s.tileTouch} onPress={() => go("risk")} activeOpacity={0.8}>
          <StatTile label={_t("Students needing attention")} value={String(r.critical + r.watch)}
            sub={_t("{critical} at risk · {watch} to watch", { critical: r.critical, watch: r.watch })} tone={r.critical ? "critical" : r.watch ? "warning" : "good"} style={{ flexBasis: "auto" }} />
        </TouchableOpacity>
        {fe && (
          <TouchableOpacity style={s.tileTouch} onPress={() => go("fees")} activeOpacity={0.8}>
            <StatTile label={_t("Fee collection")} value={pct(fe.collection_rate)} sub={_t("{outstanding} still due", { outstanding: money(fe.outstanding, currency, true) })} style={{ flexBasis: "auto" }} />
          </TouchableOpacity>
        )}
        {a && <StatTile label={_t("Attendance (period)")} value={pct(a.period_pct)} sub={_t("Present ÷ school days (leave excused)")} />}
        {ex && (
          <TouchableOpacity style={s.tileTouch} onPress={() => go("classes")} activeOpacity={0.8}>
            <StatTile label={_tx(ex.exam?.name) ?? _t("Latest exam")} value={pct(ex.avg_pct)} sub={_t("Average · {pass_rate} passed", { pass_rate: pct(ex.pass_rate) })} style={{ flexBasis: "auto" }} />
          </TouchableOpacity>
        )}
      </View>
      {!a && !fe && !ex && <Card><Empty icon="lock" text={_t("Your role can see the at-risk summary only.")} /></Card>}
    </>
  );
}

// ── Attendance ──────────────────────────────────────────────────────────────
function Attendance({ d, open }) {
  const t = d.totals ?? {};
  const series = Array.isArray(d.series) ? d.series : [];
  const warn = d.settings?.att_warn, crit = d.settings?.att_critical;
  return (
    <>
      <Text style={s.period}>{fullDate(d.from)} – {fullDate(d.to)}</Text>
      <View style={s.tiles}>
        <StatTile label={_t("Attendance")} value={pct(t.pct)} sub={_t("{v} student-days", { v: t.marked ?? 0 })} />
        <StatTile label={_t("Absent")} value={String(t.absent ?? 0)} sub={_t("{v} on approved leave (not counted)", { v: t.leave ?? 0 })} />
      </View>
      <Card title={d.bucket === "week" ? _t("Attendance by week") : _t("Attendance by day")}>
        {series.length ? (
          <>
            <LineChart percent labels={series.map((x) => shortDate(x.date))}
              titles={series.map((x) => (d.bucket === "week" ? _t("Week of {date}", { date: fullDate(x.date) }) : fullDate(x.date)))}
              series={[{ name: "Present", color: PALETTE.s1, values: series.map((x) => x.pct) }]}
              refLines={[warn != null && { y: warn, label: _t("Watch {warn}%", { warn }) }, crit != null && { y: crit, label: _t("At risk {crit}%", { crit }) }].filter(Boolean)}
              format={(v) => pct(v)} />
            <Note>{_t("Tap the chart to see a day. Holidays and approved leave are not counted.")}</Note>
          </>
        ) : <Empty icon="calendar" text={_t("No attendance has been taken in this period.")} />}
      </Card>
      {d.by_class?.length > 0 && (
        <Card title={_t("By class (lowest first)")}>
          <HBars rows={d.by_class.map((c) => ({ key: `${c.class_id}|${c.section_id}`, label: c.name, value: c.pct, text: pct(c.pct),
            sub: _t("{students} students · {absent} absences", { students: c.students, absent: c.absent }) }))}
            ref={warn != null ? { value: warn, label: _t("Watch level {warn}%", { warn }) } : null} />
        </Card>
      )}
      {d.by_weekday?.length > 1 && (
        <Card title={_t("By day of the week")}>
          <HBars rows={d.by_weekday.map((w) => ({ key: w.day, label: w.day, value: w.pct, text: pct(w.pct) }))} />
        </Card>
      )}
      <Card title={_t("Low attendance ({v})", { v: d.low_count ?? 0 })}>
        {d.low?.length ? d.low.slice(0, 30).map((x) => (
          <TouchableOpacity key={x.enrollment_id} style={s.row} onPress={() => open(x)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{_tx(x.name) ?? _tx(x.enrollment_id)}</Text>
              <Text style={s.meta}>{_t("{class_name}{v} · {absent} days absent", { class_name: x.class_name, v: x.roll_number ? ` ${_t("· Roll {roll_number}", { roll_number: x.roll_number })}` : "", absent: x.absent })}</Text>
            </View>
            {x.pct < (crit ?? 0) ? <Level level="critical" /> : null}
            <Text style={s.num}>{pct(x.pct)}</Text>
            <Feather name="chevron-right" size={16} color="#cbd5e1" />
          </TouchableOpacity>
        )) : <Empty icon="smile" text={_t("Everyone is at or above {v}%.", { v: warn ?? 85 })} />}
        {(d.low_count ?? 0) > 30 && <Note>{_t("Showing the 30 lowest. Pick a class to see more.")}</Note>}
      </Card>
    </>
  );
}

// ── At risk ─────────────────────────────────────────────────────────────────
const KIND_LABEL = { attendance: "Attendance", streak: "Absent in a row", marks: "Marks", subjects: "Subjects", fees: "Fees" };
const KIND_ICON = { attendance: "check-square", streak: "calendar", marks: "trending-down", subjects: "book-open", fees: "dollar-sign" };

function Risk({ d, level, setLevel, kind, setKind, open, canExport, exporting, onExport, canEdit, onSettings }) {
  const list = (d.students ?? []).filter((x) => (level === "all" || x.level === level)
    && (kind === "all" || x.reasons.some((r) => (kind === "marks" ? ["marks", "subjects"].includes(r.kind) : kind === "attendance" ? ["attendance", "streak"].includes(r.kind) : r.kind === kind))));
  const st = d.settings ?? {};
  const checks = d.checks ?? [];
  return (
    <>
      <View style={s.tiles}>
        <StatTile label={_t("At risk")} value={String(d.counts?.critical ?? 0)} tone={d.counts?.critical ? "critical" : "good"} sub={_t("Needs action now")} />
        <StatTile label={_t("Watch")} value={String(d.counts?.watch ?? 0)} tone={d.counts?.watch ? "warning" : "good"} sub={_t("Keep an eye on")} />
      </View>
      <View style={s.chips}>
        {[["all", "Everyone"], ["critical", "At risk"], ["watch", "Watch"]].map(([k, l]) => <Chip key={k} on={level === k} label={_tx(l)} onPress={() => setLevel(k)} />)}
      </View>
      {checks.length > 1 && (
        <View style={s.chips}>
          <Chip on={kind === "all"} label={_t("All reasons")} onPress={() => setKind("all")} />
          {checks.includes("attendance") && <Chip on={kind === "attendance"} icon="check-square" label={_t("Attendance")} onPress={() => setKind("attendance")} />}
          {checks.includes("marks") && <Chip on={kind === "marks"} icon="book-open" label={_t("Marks")} onPress={() => setKind("marks")} />}
          {checks.includes("fees") && <Chip on={kind === "fees"} icon="dollar-sign" label={_t("Fees")} onPress={() => setKind("fees")} />}
        </View>
      )}
      <Card>
        {list.length ? list.map((x) => (
          <TouchableOpacity key={x.enrollment_id} style={[s.row, { alignItems: "flex-start" }]} onPress={() => open(x)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>{_tx(x.name) ?? _tx(x.enrollment_id)}</Text>
                <Level level={x.level} />
              </View>
              <Text style={s.meta}>{_tx(x.class_name)}{x.roll_number ? ` ${_t("· Roll {roll_number}", { roll_number: x.roll_number })}` : ""}</Text>
              {x.reasons.map((r, i) => (
                <View key={i} style={s.reason}>
                  <Feather name={KIND_ICON[r.kind] ?? "info"} size={12} color={r.level === "critical" ? STATUS.critical : "#a16207"} />
                  <Text style={s.reasonTxt}>{_tx(r.text)}</Text>
                </View>
              ))}
            </View>
            <Feather name="chevron-right" size={16} color="#cbd5e1" style={{ marginTop: 2 }} />
          </TouchableOpacity>
        )) : <Empty icon="smile" text={d.students?.length ? _t("Nobody matches these filters.") : _t("No students need attention right now.")} />}
        {(d.total ?? 0) > (d.students?.length ?? 0) && <Note>{_t("Showing the first")}{" "}{d.students.length}{" "}{_t("of")}{" "}{d.total}{_t(". Pick a class to narrow it down.")}</Note>}
      </Card>
      {canExport && list.length > 0 && <Btn title={_t("Export list (spreadsheet)")} icon="download" kind="ghost" busy={exporting} onPress={onExport} style={{ marginBottom: 12 }} />}
      <Card title={_t("How students are picked")}>
        {checks.includes("attendance") && <Note>{_t("• Attendance below")}{" "}{st.att_warn}{_t("% → watch, below")}{" "}{st.att_critical}{_t("% → at risk (after")}{" "}{st.min_days}{" "}{_t("school days).")}{"\n"}{_t("• Absent")}{" "}{st.absent_streak}{_t("+ school days in a row (approved leave doesn't count).")}</Note>}
        {checks.includes("marks") && <Note>{_t("• Latest exam below")}{" "}{st.pass_pct}{_t("% overall → at risk; a fall of")}{" "}{st.drop_pct}{_t("+ points since the exam before → watch.")}{"\n"}{_t("• Below the pass mark in")}{" "}{st.fail_subjects}{_t("+ subjects.")}</Note>}
        {checks.includes("fees") && <Note>{_t("• Fees overdue more than")}{" "}{st.overdue_days}{" "}{_t("days.")}</Note>}
        <Note>{_t("Three or more reasons together also count as at risk.")}</Note>
        {canEdit && <Btn title={_t("Change thresholds")} icon="sliders" kind="ghost" onPress={onSettings} />}
      </Card>
    </>
  );
}

// ── Fees ────────────────────────────────────────────────────────────────────
function Fees({ d, open, canEdit, onTargets }) {
  const t = d.totals ?? {}, cur = d.currency;
  const months = d.months ?? [];
  const hasTarget = months.some((m) => m.target != null);
  const withTarget = months.filter((m) => m.target != null && m.month <= (t.upto ?? "").slice(0, 7));
  const tgtSum = withTarget.reduce((a, m) => a + (+m.target || 0), 0);
  const tgtGot = withTarget.reduce((a, m) => a + (+m.collected || 0), 0);
  const fmt = (v, axis) => money(v, axis ? null : cur, true);
  return (
    <>
      <Text style={s.period}>{fullDate(d.from)} – {fullDate(d.to)}</Text>
      <View style={s.tiles}>
        <StatTile label={_t("Due so far")} value={money(t.due_to_date, cur, true)} sub={_t("Academic fees, after discounts, with tax")} />
        <StatTile label={_t("Collection rate")} value={pct(t.collection_rate)} tone={t.collection_rate == null ? null : t.collection_rate >= 90 ? "good" : t.collection_rate >= 75 ? "warning" : "critical"}
          sub={_t("{outstanding} still due", { outstanding: money(t.outstanding, cur, true) })} />
        <StatTile label={_t("Collected in period")} value={money(t.collected_period, cur, true)} sub={t.other_collected ? _t("+ {other_collected} other fees", { other_collected: money(t.other_collected, cur, true) }) : _t("Fee payments received")} />
        <StatTile label={_t("Awaiting approval")} value={money(t.awaiting_approval, cur, true)} sub={t.late_fees ? _t("Late fees {late_fees}", { late_fees: money(t.late_fees, cur, true) }) : _t("Online / pending payments")} />
      </View>

      <Card title={_t("Collected vs due, by month")} right={canEdit && d.targets_shown ? (
        <TouchableOpacity onPress={onTargets} hitSlop={8}><Text style={s.link}>{hasTarget ? _t("Edit targets") : _t("Set targets")}</Text></TouchableOpacity>) : null}>
        {months.length ? (
          <>
            <BarChart labels={months.map((m) => monthLabel(m.month))} titles={months.map((m) => monthYear(m.month))}
              series={[{ name: "Collected", color: PALETTE.s1, values: months.map((m) => m.collected) },
                       { name: "Due", color: PALETTE.s2, values: months.map((m) => m.due) }]}
              targets={hasTarget ? months.map((m) => m.target) : null} format={fmt} />
            <Legend items={[{ name: "Collected", color: PALETTE.s1 }, { name: "Due that month", color: PALETTE.s2 },
              ...(hasTarget ? [{ name: "Target", color: INK.primary, type: "dash" }] : [])]} />
            {withTarget.length > 0 && (
              <Text style={[s.meta, { marginTop: 8 }]}>{_t("Target so far: {tgtSum} · collected {tgtGot} ({v}%)", { tgtSum: money(tgtSum, cur), tgtGot: money(tgtGot, cur), v: tgtSum ? Math.round((tgtGot * 100) / tgtSum) : 0 })}</Text>
            )}
            <Note>{_t("\"Collected\" is counted by payment date, \"Due\" by due date. Tap a month for exact amounts.")}</Note>
            {!d.targets_shown && <Note>{_t("Targets are school-wide, so they are hidden while a class or branch is selected.")}</Note>}
          </>
        ) : <Empty icon="dollar-sign" text={_t("No fees in this period.")} />}
      </Card>

      {d.by_class?.length > 0 && (
        <Card title={_t("Collection by class (lowest first)")}>
          <HBars rows={d.by_class.map((c) => ({ key: `${c.class_id}|${c.section_id}`, label: c.name, value: c.rate, text: pct(c.rate),
            sub: _t("{outstanding} due · {owing} of {students} students owe", { outstanding: money(c.outstanding, cur), owing: c.owing, students: c.students }) }))} />
        </Card>
      )}
      {d.by_method?.length > 0 && (
        <Card title={_t("How families paid")}>
          <HBars max={Math.max(...d.by_method.map((m) => m.amount), 1)}
            rows={d.by_method.map((m) => ({ key: m.method, label: m.method, value: m.amount, text: money(m.amount, cur, true), sub: _t("{count} payments", { count: m.count }) }))} />
        </Card>
      )}
      <Card title={_t("Most owed ({v} students owe)", { v: d.owing_count ?? 0 })}>
        {d.top_owing?.length ? d.top_owing.map((x) => (
          <TouchableOpacity key={x.enrollment_id} style={s.row} onPress={() => open(x)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{_tx(x.name) ?? _tx(x.enrollment_id)}</Text>
              <Text style={s.meta}>{_tx(x.class_name)}{x.oldest ? ` ${_t("· oldest due {oldest} ({days} days)", { oldest: shortDate(x.oldest), days: x.days })}` : ""}</Text>
            </View>
            <Text style={s.num}>{money(x.outstanding, cur)}</Text>
            <Feather name="chevron-right" size={16} color="#cbd5e1" />
          </TouchableOpacity>
        )) : <Empty icon="check-circle" text={_t("Nothing is outstanding.")} />}
      </Card>
    </>
  );
}

// ── Classes (exam performance) ──────────────────────────────────────────────
function Classes({ d, examId, setExamId, trendClass, setTrendClass }) {
  if (!d.exams?.length) return <Card><Empty icon="book-open" text={_t("No marks have been entered for this session yet.")} /></Card>;
  const pass = d.pass_pct;
  const trend = d.trend ?? [];
  const classes = d.classes ?? [];
  const sel = trendClass && classes.some((c) => c.key === trendClass) ? trendClass : null;
  const selName = sel ? classes.find((c) => c.key === sel)?.name : null;
  return (
    <>
      <View style={s.chips}>
        {d.exams.map((e) => <Chip key={e.id} on={d.exam?.id === e.id} label={_tx(e.name)} onPress={() => setExamId(String(e.id))} />)}
      </View>
      <Card title={_t("{v} · class average", { v: d.exam?.name ?? _t("Exam") })}>
        <HBars rows={classes.map((c) => ({ key: c.key, label: c.name, value: c.avg_pct, text: pct(c.avg_pct),
          sub: _t("Median {median_pct} · top {top_pct} · {pass_rate} passed · {students} students", { median_pct: pct(c.median_pct), top_pct: pct(c.top_pct), pass_rate: pct(c.pass_rate), students: c.students }) }))}
          ref={{ value: pass, label: _t("Pass mark {pass}%", { pass }) }} />
      </Card>
      {d.subjects?.length > 0 && (
        <Card title={_t("Subjects (weakest first)")}>
          <HBars rows={d.subjects.map((x) => ({ key: x.subject_id, label: x.name, value: x.avg_pct, text: pct(x.avg_pct), sub: _t("{pass_rate} passed", { pass_rate: pct(x.pass_rate) }) }))}
            ref={{ value: pass, label: _t("Pass mark {pass}%", { pass }) }} />
        </Card>
      )}
      {trend.length > 1 && (
        <Card title={_t("Average across exams")}>
          {classes.length > 1 && (
            <View style={s.chips}>
              <Chip on={!sel} label={_t("School only")} onPress={() => setTrendClass(null)} />
              {classes.map((c) => <Chip key={c.key} on={sel === c.key} label={_tx(c.name)} onPress={() => setTrendClass(c.key)} />)}
            </View>
          )}
          <LineChart percent labels={trend.map((t) => t.exam)} format={(v) => pct(v)}
            series={[{ name: classes.length > 1 ? "Whole school" : (classes[0]?.name ?? "Average"), color: PALETTE.s1, values: trend.map((t) => t.overall) },
              ...(sel ? [{ name: selName, color: PALETTE.s2, values: trend.map((t) => t.classes?.[sel] ?? null) }] : [])]}
            refLines={[{ y: pass, label: _t("Pass {pass}%", { pass }) }]} />
          {sel && <Legend items={[{ name: "Whole school", color: PALETTE.s1, type: "line" }, { name: selName, color: PALETTE.s2, type: "line" }]} />}
        </Card>
      )}
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabBar: { flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#f1f5f9" },
  tabOn: { backgroundColor: C.brand },
  tabTxt: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  filters: { flexDirection: "row", gap: 8 },
  period: { fontSize: 12, color: C.muted, marginBottom: 8 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  tileTouch: { flexGrow: 1, flexBasis: "45%" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  num: { fontSize: 13.5, fontWeight: "800", color: C.ink },
  note: { fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 16 },
  link: { fontSize: 12.5, fontWeight: "700", color: C.brand },
  level: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1.2, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: "#fff" },
  levelTxt: { fontSize: 10.5, fontWeight: "800", color: INK.primary },
  reason: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  reasonTxt: { flex: 1, fontSize: 12.5, color: INK.secondary },
});
