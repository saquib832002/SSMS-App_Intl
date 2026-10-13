/**
 * Analytics settings – when a student shows as "watch" / "at risk", and the school's monthly
 * fee collection targets for a session. Needs Reports & analytics · edit (targets also need Fees · view).
 */
import React, { useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Field, Empty, Picker } from "../../components/ReportCardUI";
import { getSettings, saveSettings, monthYear, money } from "../../services/AnalyticsApi";
import { _t, _tx } from "../../services/i18n";

const FIELDS = [
  { k: "att_warn", get label() { return _t("Watch when attendance is below (%)"); } },
  { k: "att_critical", get label() { return _t("At risk when attendance is below (%)"); } },
  { k: "min_days", get label() { return _t("Only after this many school days are marked"); } },
  { k: "absent_streak", get label() { return _t("Flag after this many days absent in a row"); } },
  { k: "pass_pct", get label() { return _t("Pass mark (%)"); } },
  { k: "drop_pct", get label() { return _t("Flag a fall in marks of (points)"); } },
  { k: "fail_subjects", get label() { return _t("Flag when below the pass mark in (subjects)"); } },
  { k: "overdue_days", get label() { return _t("Flag fees overdue for more than (days)"); } },
];
const GROUPS = [
  { get title() { return _t("Attendance"); }, keys: ["att_warn", "att_critical", "min_days", "absent_streak"] },
  { get title() { return _t("Marks"); }, keys: ["pass_pct", "drop_pct", "fail_subjects"] },
  { get title() { return _t("Fees"); }, keys: ["overdue_days"], need: "fees" },
];

const pad = (n) => String(n).padStart(2, "0");
function months12(from) {
  const m = /^(\d{4})-(\d{2})/.exec(String(from || ""));
  if (!m) return [];
  let y = +m[1], mo = +m[2];
  const out = [];
  for (let i = 0; i < 12; i++) { out.push(`${y}-${pad(mo)}`); mo++; if (mo > 12) { mo = 1; y++; } }
  return out;
}

export default function AnalyticsSettingsScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [sessionId, setSessionId] = useState(route?.params?.sessionId ? String(route.params.sessionId) : "");
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [vals, setVals] = useState({});
  const [targets, setTargets] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    setD(null); setErr(null);
    getSettings(user, sessionId ? { session_id: sessionId } : {}).then((r) => {
      if (off) return;
      setD(r);
      setVals(Object.fromEntries(Object.entries(r.settings ?? {}).map(([k, v]) => [k, String(v)])));
      setTargets(Object.fromEntries(Object.entries(r.targets ?? {}).map(([k, v]) => [k, String(Math.round(+v * 100) / 100)])));
    }).catch((e) => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [user, sessionId]);

  const months = useMemo(() => months12(d?.session_start || d?.from), [d?.session_start, d?.from]);
  const can = d?.can ?? {};
  const readOnly = !can.edit;

  const save = async () => {
    const settings = {};
    for (const f of FIELDS) {
      const v = String(vals[f.k] ?? "").trim();
      if (!/^\d+$/.test(v)) { Alert.alert(_t("Settings"), _t("\"{label}\" must be a whole number.", { label: f.label })); return; }
      settings[f.k] = +v;
    }
    if (settings.att_critical > settings.att_warn) { Alert.alert(_t("Settings"), _t("The \"at risk\" attendance level must be at or below the \"watch\" level.")); return; }
    const body = { session_id: d.session_id, settings };
    if (can.fees) {
      const t = {};
      for (const m of months) {
        const v = String(targets[m] ?? "").replace(/,/g, "").trim();
        if (v === "") { t[m] = ""; continue; }
        if (!/^\d+(\.\d{1,2})?$/.test(v)) { Alert.alert(_t("Targets"), _t("The target for {m} must be an amount, e.g. 150000.", { m: monthYear(m) })); return; }
        t[m] = +v;
      }
      // keep targets saved for months outside this list (e.g. from an older school year layout)
      Object.entries(d.targets ?? {}).forEach(([m, v]) => { if (!(m in t)) t[m] = v; });
      body.targets = t;
    }
    setBusy(true);
    try {
      await saveSettings(user, body);
      Alert.alert(_t("Saved"), _t("The dashboard now uses these settings."));
      navigation.navigate({ name: "Analytics", params: { saved: Date.now() }, merge: true });
    } catch (e) { Alert.alert(_t("Settings"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (err) return <View style={s.wrap}><Card style={{ margin: 16 }}><Empty icon="alert-circle" text={_tx(err)} /></Card></View>;
  if (!d) return <View style={[s.wrap, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={C.brand} /></View>;

  const def = d.defaults ?? {};
  const lim = d.limits ?? {};
  const total = months.reduce((a, m) => a + (+String(targets[m] ?? "").replace(/,/g, "") || 0), 0);

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {readOnly && <Card><Text style={s.meta}>{_t("You can see these settings but not change them. Ask the school owner if you need to.")}</Text></Card>}
        {GROUPS.filter((g) => !g.need || can[g.need]).map((g) => (
          <Card key={g.title} title={_tx(g.title)}>
            {g.keys.map((k) => {
              const f = FIELDS.find((x) => x.k === k);
              return (
                <View key={k}>
                  <Field label={_tx(f.label)} value={vals[k] ?? ""} editable={!readOnly} keyboardType="number-pad" maxLength={3}
                    onChangeText={(v) => setVals((x) => ({ ...x, [k]: v.replace(/\D/g, "") }))} />
                  <Text style={s.hint}>{k === "pass_pct" ? _t("Many boards use 33 or 40") : _t("Usual: {v}", { v: def[k] })}{lim[k] ? ` ${_t("· allowed {v}–{v2}", { v: lim[k][0], v2: lim[k][1] })}` : ""}</Text>
                </View>
              );
            })}
          </Card>
        ))}

        {can.fees && (
          <Card title={_t("Monthly collection targets")}>
            {(d.sessions?.length ?? 0) > 1 && (
              <Picker label={_t("School year")} value={String(d.session_id)} options={d.sessions.map((x) => ({ value: String(x.id), label: x.name, sub: x.current ? _t("Current") : undefined }))}
                onChange={(v) => setSessionId(String(v))} />
            )}
            <Text style={s.meta}>{_t("How much fee money you aim to collect each month. Leave a month blank for no target. The Fees chart shows these as a black line.")}</Text>
            {months.map((m) => (
              <View key={m} style={s.tRow}>
                <Text style={s.tMonth}>{monthYear(m)}</Text>
                <View style={{ flex: 1 }}>
                  <Field value={targets[m] ?? ""} editable={!readOnly} keyboardType="decimal-pad" placeholder={_t("No target")} style={{ marginBottom: 6 }}
                    onChangeText={(v) => setTargets((x) => ({ ...x, [m]: v.replace(/[^\d.]/g, "") }))} />
                </View>
              </View>
            ))}
            {total > 0 && <Text style={s.meta}>{_t("Year total: {total}", { total: money(total, d.currency) })}</Text>}
          </Card>
        )}

        {!readOnly && <Btn title={_t("Save")} icon="save" busy={busy} onPress={save} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  meta: { fontSize: 12, color: C.muted, lineHeight: 17, marginBottom: 8 },
  hint: { fontSize: 11, color: C.muted, marginTop: -6, marginBottom: 10 },
  tRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  tMonth: { width: 84, fontSize: 13, fontWeight: "600", color: C.ink },
});
