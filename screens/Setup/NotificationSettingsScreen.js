/**
 * Setup › Notifications – what the school sends automatically, and how (phone / e-mail).
 * Absence, late arrival / early pick-up, homework, notices, fee due / overdue, report card published.
 * "Delivery" shows what went out in the last days, and lets the office send failed e-mails again.
 * Saving needs School settings · edit (the server checks it too).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";
import { fmtDate, fmtTime } from "../../services/Locale";
import { getSettings, saveSettings, getLog, retryFailed } from "../../services/NotifyApi";
import MessagingSetup from "./MessagingSetup";
import MessageTemplates from "./MessageTemplates";

const CH_ICON = { push: "smartphone", email: "mail", sms: "message-square", whatsapp: "message-circle" };
const CH_NAME = { get push() { return _t("Phone"); }, get email() { return _t("E-mail"); }, get sms() { return _t("SMS"); }, get whatsapp() { return _t("WhatsApp"); } };
const ICON = { absence: "user-x", arrival: "clock", homework: "book", notice: "bell", fee_due: "credit-card", results: "award" };
const HELP = {
  get absence() { return _t("Sent when a child is marked absent. Waits a few minutes so a mistake can be fixed first."); },
  get arrival() { return _t("Sent when a late arrival or early pick-up is recorded."); },
  get homework() { return _t("New homework for the child's class."); },
  get notice() { return _t("New notices, to the people the notice is for. Staff see who has read each notice."); },
  get fee_due() { return _t("Reminders before the due date, on the day, and while a fee is overdue."); },
  get results() { return _t("Sent when a report card is published for the child's class."); },
};

function Row({ label, hint, value, onChange, disabled }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTxt}>{label}</Text>
        {!!hint && <Text style={s.hint}>{hint}</Text>}
      </View>
      <Switch value={!!value} disabled={disabled} onValueChange={onChange} accessibilityLabel={label}
        trackColor={{ true: "#c4b5fd", false: "#e2e8f0" }} thumbColor={value ? C.brand : "#f8fafc"} />
    </View>
  );
}

function Num({ label, value, onChange, disabled, suffix, width = 64 }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowTxt, { flex: 1 }]}>{label}</Text>
      <TextInput style={[s.num, { width }, disabled && { opacity: 0.6 }]} editable={!disabled} value={String(value ?? "")}
        keyboardType={suffix === null ? "numbers-and-punctuation" : "number-pad"} onChangeText={onChange} accessibilityLabel={label} />
      {!!suffix && <Text style={s.suffix}>{suffix}</Text>}
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState("settings");
  const [list, setList] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [paid, setPaid] = useState({ allowed: false, sms: false, whatsapp: false });

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await getSettings(user);
      setList(r.settings ?? []);
      setCanEdit(!!r.can_edit);
      if (r.paid) setPaid(r.paid);
      setDirty(false);
    } catch (e) { setError(_tx(e.message)); setList([]); }
  }, [user]);
  const loadLog = useCallback(async () => {
    try { setLog(await getLog(user, {})); } catch (e) { setLog({ rows: [], last30: {}, error: _tx(e.message) }); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (ev, patch, opt = false) => {
    setDirty(true);
    setList((l) => l.map((x) => (x.event !== ev ? x : opt ? { ...x, options: { ...x.options, ...patch } } : { ...x, ...patch })));
  };

  const save = async () => {
    const events = {};
    for (const x of list) {
      const o = { ...x.options };
      for (const k of ["delay_minutes", "days_before", "overdue_every", "overdue_for_days", "unread_minutes"]) if (k in o) o[k] = parseInt(o[k], 10) || 0;
      events[x.event] = { enabled: x.enabled, push: x.push, email: x.email, sms: !!x.sms, whatsapp: !!x.whatsapp, essential: x.essential, options: o };
    }
    setSaving(true);
    try {
      const r = await saveSettings(user, events);
      setList(r.settings ?? []);
      if (r.paid) setPaid(r.paid);
      setDirty(false);
      Alert.alert(_t("Notifications"), r.changed?.length ? _t("Saved.") : _t("Nothing changed."));
    } catch (e) {
      Alert.alert(_t("Notifications"), _tx(e.message));
    } finally { setSaving(false); }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      const r = await retryFailed(user);
      Alert.alert(_t("Delivery"), _t("{n} e-mails queued again.", { n: r.queued ?? 0 }));
      loadLog();
    } catch (e) { Alert.alert(_t("Delivery"), _tx(e.message)); } finally { setRetrying(false); }
  };

  const Tabs = (
    <View style={s.tabs}>
      {[["settings", _t("What is sent")], ["messaging", _t("SMS & WhatsApp")], ["texts", _t("Texts")], ["log", _t("Delivery")]].map(([k, l]) => (
        <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => {
          setTab(k);
          if (k === "log") loadLog();
          // back from the SMS & WhatsApp tab: show the switches for a channel just connected
          if (k === "settings") getSettings(user).then((r) => r.paid && setPaid(r.paid)).catch(() => {});
        }} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
          <Text style={[s.tabTxt, tab === k && { color: C.brand }]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (list === null) return <View style={[s.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.brand} /></View>;

  if (tab === "messaging" || tab === "texts") {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {Tabs}
        {tab === "messaging" ? <MessagingSetup /> : <MessageTemplates />}
      </ScrollView>
    );
  }

  if (tab === "log") {
    const t = log?.last30 ?? {};
    const n = (ch, st) => t?.[ch]?.[st] ?? 0;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
        {Tabs}
        {log === null ? <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} /> : (
          <>
            {!!log.error && <Text style={s.errTxt}>{log.error}</Text>}
            <Card title={_t("Last 30 days")}>
              {["push", "email", "sms", "whatsapp"].filter((ch) => ch === "push" || ch === "email" || t?.[ch] || log?.usage?.[ch]?.active).map((ch) => (
                <View key={ch} style={s.statRow}>
                  <Feather name={CH_ICON[ch]} size={14} color={C.muted} />
                  <Text style={s.statLbl}>{CH_NAME[ch]}</Text>
                  <Text style={[s.stat, { color: C.ok }]}>{_t("{n} sent", { n: n(ch, "sent") })}</Text>
                  <Text style={[s.stat, { color: C.err }]}>{_t("{n} not sent", { n: n(ch, "failed") })}</Text>
                  {ch === "push" && <Text style={s.stat}>{_t("{n} without the app", { n: n(ch, "skipped") })}</Text>}
                </View>
              ))}
              {canEdit && (n("email", "failed") + n("sms", "failed") + n("whatsapp", "failed")) > 0 && <Btn kind="ghost" icon="refresh-cw" title={_t("Send failed messages again")} busy={retrying} onPress={retry} />}
            </Card>
            {["sms", "whatsapp"].filter((ch) => log?.usage?.[ch]?.active).map((ch) => {
              const u = log.usage[ch];
              return (
                <Card key={ch} title={_t("{channel} this month", { channel: CH_NAME[ch] })}>
                  <Text style={s.rowTxt}>{u.limit ? _t("{used} of {limit} used", { used: u.used, limit: u.limit }) : _t("{used} used", { used: u.used })}
                    {u.cost > 0 ? " · " + _t("about {cost}", { cost: u.cost.toFixed(2) + " " + (u.currency || "") }) : ""}</Text>
                  {!!u.limit && <View style={s.ubar}><View style={[s.ubarFill, { width: `${Math.min(100, Math.round(100 * u.used / u.limit))}%`, backgroundColor: u.used >= u.limit ? C.err : u.used >= 0.8 * u.limit ? C.warn : C.brand }]} /></View>}
                  <Text style={s.hint}>{_t("{d} delivered, {r} read, {s} not needed (read in the app or sent by WhatsApp)", { d: u.totals.delivered, r: u.totals.read, s: u.totals.skipped })}</Text>
                </Card>
              );
            })}
            <Card title={_t("Latest")}>
              {(log.rows ?? []).length === 0 && <Empty icon="send" text={_t("Nothing sent yet.")} />}
              {(log.rows ?? []).map((r) => (
                <View key={r.id} style={s.logRow}>
                  <Feather name={CH_ICON[r.channel] ?? "smartphone"} size={13} color={C.muted} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.logTitle} numberOfLines={1}>{r.title}</Text>
                    <Text style={s.hint}>{r.to} · {fmtDate(r.created, "dayMonth")} {fmtTime(r.created)}{r.error ? " · " + _tx(r.error) : ""}</Text>
                  </View>
                  <Text style={[s.status, { color: r.status === "sent" ? C.ok : r.status === "failed" ? C.err : C.muted }]}>
                    {r.read ? _t("Read") + " ✓✓" : r.delivered ? _t("Delivered") + " ✓" : ({ sent: _t("Sent"), failed: _t("Not sent"), queued: _t("Waiting"), skipped: r.channel === "push" ? _t("No app") : _t("Not needed") }[r.status] ?? r.status)}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}>
        {Tabs}
        {!!error && <TouchableOpacity onPress={load}><Text style={s.errTxt}>{error}</Text></TouchableOpacity>}
        {!canEdit && !error && <Text style={s.ro}>{_t("You can see these settings. Only someone with School settings edit access can change them.")}</Text>}
        {list.map((x) => {
          const off = !canEdit;
          const o = x.options ?? {};
          return (
            <Card key={x.event}>
              <View style={s.head}>
                <Feather name={ICON[x.event] ?? "bell"} size={16} color={x.enabled ? C.brand : C.muted} />
                <Text style={[s.title, !x.enabled && { color: C.muted }]}>{_tx(x.label)}</Text>
                <Switch value={!!x.enabled} disabled={off} onValueChange={(v) => set(x.event, { enabled: v })} accessibilityLabel={_tx(x.label)}
                  trackColor={{ true: "#c4b5fd", false: "#e2e8f0" }} thumbColor={x.enabled ? C.brand : "#f8fafc"} />
              </View>
              <Text style={s.hint}>{HELP[x.event]}</Text>
              {x.enabled && (
                <View style={{ marginTop: 6 }}>
                  <Row label={_t("Phone notification")} value={x.push} disabled={off} onChange={(v) => set(x.event, { push: v })} />
                  <Row label={_t("E-mail")} value={x.email} disabled={off} onChange={(v) => set(x.event, { email: v })} />
                  {paid.sms && <Row label={_t("SMS")} value={x.sms} disabled={off} onChange={(v) => set(x.event, { sms: v })} />}
                  {paid.whatsapp && <Row label={_t("WhatsApp")} value={x.whatsapp} disabled={off} onChange={(v) => set(x.event, { whatsapp: v })} />}
                  {(x.sms && paid.sms) || (x.whatsapp && paid.whatsapp) ? (
                    <>
                      <View style={s.chips}>
                        {[["unread", _t("Only if not read in the app")], ["always", _t("Always")]].map(([k, l]) => (
                          <TouchableOpacity key={k} style={[s.chip, o.paid_when === k && s.chipOn]} disabled={off} onPress={() => set(x.event, { paid_when: k }, true)}>
                            <Text style={[s.chipTxt, o.paid_when === k && { color: C.brand }]}>{l}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {o.paid_when === "unread" && (
                        <Num label={_t("Wait for the app")} suffix={_t("min")} value={o.unread_minutes} disabled={off} onChange={(v) => set(x.event, { unread_minutes: v.replace(/\D/g, "") }, true)} />
                      )}
                    </>
                  ) : null}
                  {x.event !== "notice" && (
                    <Row label={_t("Every family gets it")} hint={_t("Parents cannot switch it off.")} value={x.essential} disabled={off} onChange={(v) => set(x.event, { essential: v })} />
                  )}
                  {x.event === "absence" && (
                    <>
                      <Num label={_t("Wait before sending")} suffix={_t("min")} value={o.delay_minutes} disabled={off} onChange={(v) => set("absence", { delay_minutes: v.replace(/\D/g, "") }, true)} />
                      <Row label={_t("Send a correction")} hint={_t("If the child is marked present after the message went out.")} value={o.correction} disabled={off} onChange={(v) => set("absence", { correction: v ? 1 : 0 }, true)} />
                    </>
                  )}
                  {x.event === "homework" && (
                    <>
                      <View style={s.chips}>
                        {[["digest", _t("One message a day")], ["instant", _t("Straight away")]].map(([k, l]) => (
                          <TouchableOpacity key={k} style={[s.chip, o.mode === k && s.chipOn]} disabled={off} onPress={() => set("homework", { mode: k }, true)}>
                            <Text style={[s.chipTxt, o.mode === k && { color: C.brand }]}>{l}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {o.mode === "digest" && (
                        <Num label={_t("Send at (HH:MM)")} suffix={null} width={72} value={o.digest_time} disabled={off} onChange={(v) => set("homework", { digest_time: v.replace(/[^\d:]/g, "").slice(0, 5) }, true)} />
                      )}
                    </>
                  )}
                  {x.event === "fee_due" && (
                    <>
                      <Num label={_t("Remind before the due date")} suffix={_t("days")} value={o.days_before} disabled={off} onChange={(v) => set("fee_due", { days_before: v.replace(/\D/g, "") }, true)} />
                      <Row label={_t("Remind on the due date")} value={o.on_due_day} disabled={off} onChange={(v) => set("fee_due", { on_due_day: v ? 1 : 0 }, true)} />
                      <Num label={_t("Overdue: remind every")} suffix={_t("days")} value={o.overdue_every} disabled={off} onChange={(v) => set("fee_due", { overdue_every: v.replace(/\D/g, "") }, true)} />
                      <Num label={_t("Overdue: stop after")} suffix={_t("days")} value={o.overdue_for_days} disabled={off} onChange={(v) => set("fee_due", { overdue_for_days: v.replace(/\D/g, "") }, true)} />
                    </>
                  )}
                </View>
              )}
            </Card>
          );
        })}
        {!paid.sms && !paid.whatsapp && (
          <TouchableOpacity onPress={() => setTab("messaging")}><Text style={[s.foot, { color: C.brand }]}>{paid.allowed ? _t("Connect SMS or WhatsApp in the \"SMS & WhatsApp\" tab to send these by text message too.") : _t("SMS and WhatsApp messages are a paid add-on.")}</Text></TouchableOpacity>
        )}
        <Text style={s.foot}>{_t("Messages are written in each person's own language.")}</Text>
      </ScrollView>
      {canEdit && (
        <View style={[s.bar, { paddingBottom: 12 + insets.bottom }]}>
          <Btn title={_t("Save")} icon="check" busy={saving} disabled={!dirty} onPress={save} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 3, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 8 },
  tabOn: { backgroundColor: C.brandSoft },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted, textAlign: "center" },
  ubar: { height: 6, borderRadius: 3, backgroundColor: "#e2e8f0", overflow: "hidden", marginTop: 8 },
  ubarFill: { height: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "800", color: C.ink },
  hint: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  rowTxt: { fontSize: 14, color: C.ink },
  num: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, color: C.ink, textAlign: "center" },
  suffix: { fontSize: 13, color: C.muted, minWidth: 30 },
  chips: { flexDirection: "row", gap: 8, marginVertical: 6 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 13, color: C.ink, fontWeight: "600" },
  ro: { fontSize: 12, color: C.warn, marginBottom: 10 },
  foot: { fontSize: 12, color: C.muted, textAlign: "center", marginTop: 4 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 6, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line },
  errTxt: { color: C.err, fontSize: 13, marginBottom: 10 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, flexWrap: "wrap" },
  statLbl: { fontSize: 13, fontWeight: "700", color: C.ink, minWidth: 50 },
  stat: { fontSize: 12, color: C.muted },
  logRow: { flexDirection: "row", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  logTitle: { fontSize: 13, color: C.ink, fontWeight: "600" },
  status: { fontSize: 11, fontWeight: "800" },
});
