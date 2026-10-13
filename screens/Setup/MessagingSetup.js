/**
 * Setup › Notifications › SMS & WhatsApp – connect the school's own provider account, or use
 * ManageMyAcademy's. Keys are sent once and never shown again ("saved"). Shows the country's rules,
 * the webhook address for delivery reports, this month's use, and sends a test message.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Switch, ActivityIndicator, Alert, Share } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Picker } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";
import { fmtDateTime } from "../../services/Locale";
import { getMessaging, saveChannel, testChannel, testSend } from "../../services/NotifyApi";

const NAME = { get sms() { return _t("SMS"); }, get whatsapp() { return _t("WhatsApp"); } };
const ICON = { sms: "message-square", whatsapp: "message-circle" };

function Field({ label, help, value, onChangeText, secret, saved, editable = true, keyboardType, multiline }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={s.label}>{_tx(label)}</Text>
      <TextInput style={[s.input, multiline && { minHeight: 64, textAlignVertical: "top" }, !editable && { opacity: 0.6 }]} value={value ?? ""} onChangeText={onChangeText}
        editable={editable} secureTextEntry={!!secret && !multiline} autoCapitalize="none" autoCorrect={false} keyboardType={keyboardType} multiline={multiline}
        placeholder={secret && saved ? _t("Saved – leave empty to keep") : ""} placeholderTextColor="#94a3b8" accessibilityLabel={_tx(label)} />
      {!!help && <Text style={s.help}>{_tx(help)}</Text>}
    </View>
  );
}

function ChannelCard({ user, ch, data, providers, canEdit, onSaved }) {
  const [d, setD] = useState(data);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(null);
  const [to, setTo] = useState("");
  useEffect(() => { setD(data); setFields({}); }, [data]);

  const list = providers.filter((p) => p.channels.includes(ch))
    .sort((a, b) => { const r = (k) => (d.recommended.indexOf(k) === -1 ? 99 : d.recommended.indexOf(k)); return r(a.key) - r(b.key); });
  const prov = providers.find((p) => p.key === d.provider);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const fieldVal = (k) => (k in fields ? fields[k] : (d.fields?.[k] ?? ""));

  const save = async () => {
    setBusy("save");
    try {
      const body = { mode: d.mode, provider: d.provider, sender: d.sender, monthly_limit: d.monthly_limit ?? "", cost_per_message: d.cost_per_message ?? "",
        currency: d.currency ?? "", quiet_start: d.quiet_start || "", quiet_end: d.quiet_end || "", consent_required: d.consent_required === null ? "" : d.consent_required ? 1 : 0,
        sms_after_whatsapp: d.sms_after_whatsapp ? 1 : 0, fields };
      const r = await saveChannel(user, ch, body);
      onSaved(ch, r.channel);
      if (r.test) {
        Alert.alert(NAME[ch], r.test.ok ? _t("Connected.") + (r.test.info ? "\n" + r.test.info : "") : _t("The provider did not accept the details: {error}", { error: _tx(r.test.error) }));
      } else {
        Alert.alert(NAME[ch], _t("Saved."));
      }
    } catch (e) { Alert.alert(NAME[ch], _tx(e.message)); } finally { setBusy(null); }
  };
  const check = async () => {
    setBusy("check");
    try {
      const r = await testChannel(user, ch);
      if (r.channel) onSaved(ch, r.channel);
      Alert.alert(NAME[ch], r.test.ok ? _t("Connected.") + (r.test.info ? "\n" + r.test.info : "") : _tx(r.test.error));
    } catch (e) { Alert.alert(NAME[ch], _tx(e.message)); } finally { setBusy(null); }
  };
  const test = async () => {
    if (!to.trim()) return;
    setBusy("test");
    try {
      const r = await testSend(user, ch, to.trim());
      Alert.alert(NAME[ch], r.ok ? _t("Test message sent to {to}.", { to: r.to }) : _t("Not sent: {error}", { error: _tx(r.error) }));
    } catch (e) { Alert.alert(NAME[ch], _tx(e.message)); } finally { setBusy(null); }
  };

  const Mode = ({ k, label }) => (
    <TouchableOpacity style={[s.chip, d.mode === k && s.chipOn]} disabled={!canEdit} onPress={() => set({ mode: k })} accessibilityRole="radio" accessibilityState={{ checked: d.mode === k }}>
      <Text style={[s.chipTxt, d.mode === k && { color: C.brand }]}>{label}</Text>
    </TouchableOpacity>
  );
  const status = d.mode === "off" ? null : d.active ? ["check-circle", C.ok, _t("Sending")] : d.status === "error" ? ["alert-circle", C.err, _t("Not working: {error}", { error: _tx(d.last_error) || "" })]
    : ["clock", C.warn, _t("Not checked yet")];

  return (
    <Card>
      <View style={s.head}>
        <Feather name={ICON[ch]} size={17} color={C.brand} />
        <Text style={s.title}>{NAME[ch]}</Text>
        {!!status && <View style={s.status}><Feather name={status[0]} size={13} color={status[1]} /><Text style={[s.statusTxt, { color: status[1] }]} numberOfLines={2}>{status[2]}</Text></View>}
      </View>
      <View style={s.chips}>
        <Mode k="off" label={_t("Off")} />
        <Mode k="own" label={_t("Our own account")} />
        {(data.managed_available || d.mode === "managed") && <Mode k="managed" label={_t("ManageMyAcademy's account")} />}
      </View>

      {d.mode === "managed" && (
        <Text style={s.meta}>{_t("Sent through ManageMyAcademy ({provider}). This month: {used} of {allowance} messages.", { provider: d.managed_provider || "", used: d.used ?? 0, allowance: d.allowance ?? 0 })}</Text>
      )}

      {d.mode === "own" && (
        <>
          <Picker label={_t("Provider")} value={d.provider} disabled={!canEdit} placeholder={_t("Choose a provider")}
            options={list.map((p) => ({ value: p.key, label: p.name + (d.recommended.includes(p.key) ? " · " + _t("common in your country") : "") }))}
            onChange={(v) => { set({ provider: v, fields: {} }); setFields({}); }} />
          {!!prov && prov.fields.map((f) => (
            <Field key={f.key} label={f.label} help={f.help} secret={f.secret} saved={!!d.fields?.[f.key + "__saved"]} editable={canEdit}
              multiline={f.key === "headers" || f.key === "body"} value={fieldVal(f.key)} onChangeText={(v) => setFields((x) => ({ ...x, [f.key]: v }))} />
          ))}
          {!!prov && !(["meta", "msg91", "whapi"].includes(prov.key)) && (
            <Field label={ch === "whatsapp" ? _t("WhatsApp number messages come from") : _t("Sender ID or number")} value={d.sender} editable={canEdit} onChangeText={(v) => set({ sender: v })}
              help={ch === "sms" ? _t("Register it first where your country requires it.") : _t("With the country code, e.g. +971501234567")} />
          )}
          {!!prov && prov.template.includes(ch) && <Text style={s.note}>{_t("This provider needs a registered template for each message – add them in the Texts tab.")}</Text>}
          {prov?.key === "whapi" && <Text style={s.note}>{_t("Whapi sends from a normal WhatsApp number linked to your phone. WhatsApp may block numbers that send many messages – use it for small schools only.")}</Text>}
          <Field label={_t("Messages per month (limit)")} value={d.monthly_limit === null || d.monthly_limit === undefined ? "" : String(d.monthly_limit)} editable={canEdit} keyboardType="number-pad"
            onChangeText={(v) => set({ monthly_limit: v.replace(/\D/g, "") === "" ? null : v.replace(/\D/g, "") })} help={_t("Leave empty for no limit. The office is told at 80%.")} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Field label={_t("Price per message")} value={d.cost_per_message === null || d.cost_per_message === undefined ? "" : String(d.cost_per_message)} editable={canEdit}
              keyboardType="decimal-pad" onChangeText={(v) => set({ cost_per_message: v.replace(/[^\d.]/g, "") })} /></View>
            <View style={{ width: 90 }}><Field label={_t("Currency")} value={d.currency} editable={canEdit} onChangeText={(v) => set({ currency: v.toUpperCase().slice(0, 3) })} /></View>
          </View>
          <Text style={s.meta}>{_t("Used this month: {used}", { used: d.used ?? 0 })}{d.monthly_limit ? " / " + d.monthly_limit : ""}</Text>
        </>
      )}

      {d.mode !== "off" && (
        <>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <View style={{ flex: 1 }}><Field label={_t("Quiet hours from")} value={d.quiet_start ?? ""} editable={canEdit} keyboardType="numbers-and-punctuation"
              help={_t("Default {from}", { from: d.quiet_default?.[0] })} onChangeText={(v) => set({ quiet_start: v.replace(/[^\d:]/g, "").slice(0, 5) })} /></View>
            <View style={{ flex: 1 }}><Field label={_t("until")} value={d.quiet_end ?? ""} editable={canEdit} keyboardType="numbers-and-punctuation"
              help={_t("Default {to}", { to: d.quiet_default?.[1] })} onChangeText={(v) => set({ quiet_end: v.replace(/[^\d:]/g, "").slice(0, 5) })} /></View>
          </View>
          <Text style={s.help}>{_t("Only absence and late / early messages are sent during quiet hours.")}</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTxt}>{_t("Only families who agreed (consent)")}</Text>
              <Text style={s.help}>{_t("Uses the consent \"Messages by SMS / WhatsApp\". Usual in your country: {v}", { v: d.consent_default ? _t("yes") : _t("no") })}</Text>
            </View>
            <Switch value={d.consent_required === null ? !!d.consent_default : !!d.consent_required} disabled={!canEdit} onValueChange={(v) => set({ consent_required: v })}
              trackColor={{ true: "#c4b5fd", false: "#e2e8f0" }} thumbColor={C.brand} accessibilityLabel={_t("Only families who agreed (consent)")} />
          </View>
          {ch === "sms" && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTxt}>{_t("SMS only when WhatsApp did not reach the family")}</Text>
                <Text style={s.help}>{_t("When both are on for a message, WhatsApp goes first; SMS waits 10 minutes.")}</Text>
              </View>
              <Switch value={!!d.sms_after_whatsapp} disabled={!canEdit} onValueChange={(v) => set({ sms_after_whatsapp: v })}
                trackColor={{ true: "#c4b5fd", false: "#e2e8f0" }} thumbColor={C.brand} accessibilityLabel={_t("SMS only when WhatsApp did not reach the family")} />
            </View>
          )}
          {!!d.hook_url && d.mode === "own" && (
            <TouchableOpacity style={s.hook} onPress={() => Share.share({ message: d.hook_url }).catch(() => {})} accessibilityRole="button">
              <Text style={s.hookLbl}>{_t("Delivery reports and replies – paste this address in the provider's dashboard:")}</Text>
              <Text style={s.hookUrl} selectable>{d.hook_url}</Text>
              {d.provider === "meta" && <Text style={s.hookLbl} selectable>{_t("Verify token")}: {d.verify_token}</Text>}
              <Feather name="share-2" size={14} color={C.brand} style={{ position: "absolute", right: 10, top: 10 }} />
            </TouchableOpacity>
          )}
          {!!d.tested_at && <Text style={s.help}>{_t("Last checked {when}", { when: fmtDateTime(d.tested_at) })}</Text>}
        </>
      )}

      {canEdit && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Btn style={{ flex: 1 }} title={_t("Save")} icon="check" busy={busy === "save"} onPress={save} />
          {d.mode === "own" && !!data.provider && <Btn style={{ flex: 1 }} kind="ghost" title={_t("Check again")} icon="refresh-cw" busy={busy === "check"} onPress={check} />}
        </View>
      )}
      {canEdit && d.active && (
        <View style={s.testRow}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={to} onChangeText={setTo} keyboardType="phone-pad" placeholder={_t("Mobile number for a test")} placeholderTextColor="#94a3b8"
            accessibilityLabel={_t("Mobile number for a test")} />
          <TouchableOpacity style={s.testBtn} onPress={test} disabled={busy === "test"} accessibilityLabel={_t("Send a test message")}>
            {busy === "test" ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="send" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}

export default function MessagingSetup() {
  const { user } = useContext(AuthContext);
  const [m, setM] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setM(await getMessaging(user)); } catch (e) { setError(_tx(e.message)); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  if (!m && !error) return <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} />;
  if (error) return <TouchableOpacity onPress={load}><Text style={s.err}>{error}</Text><Text style={s.retry}>{_t("Try again")}</Text></TouchableOpacity>;
  if (!m.allowed) {
    return (
      <Card>
        <View style={s.head}><Feather name="lock" size={16} color={C.warn} /><Text style={s.title}>{_t("SMS & WhatsApp messages")}</Text></View>
        <Text style={s.meta}>{_t("Automatic SMS and WhatsApp messages are a paid add-on. Ask ManageMyAcademy to switch them on for your school. Push notifications and e-mail stay free.")}</Text>
      </Card>
    );
  }
  const r = m.rules;
  return (
    <>
      <Card>
        <View style={s.head}><Feather name="globe" size={16} color={C.brand} /><Text style={s.title}>{_t("Rules in your country ({country})", { country: m.country })}</Text></View>
        <Text style={s.meta}>{_tx(r.note)}</Text>
        <Text style={s.bullet}>• {r.sender === "required" ? _t("The sender name must be registered first: {format}.", { format: _tx(r.sender_format) }) : _t("Sender: {format}.", { format: _tx(r.sender_format) })}</Text>
        {r.templates && <Text style={s.bullet}>• {_t("Every SMS text must be registered (DLT). The Texts tab shows the exact text.")}</Text>}
        {r.optout && <Text style={s.bullet}>• {_t("SMS end with \"Reply STOP to opt out.\"")}</Text>}
        <Text style={s.bullet}>• {_t("WhatsApp: messages the school starts use templates approved by Meta (except Whapi). Parents should agree to get them.")}</Text>
      </Card>
      {["sms", "whatsapp"].map((ch) => (
        <ChannelCard key={ch} user={user} ch={ch} data={m.channels[ch]} providers={m.providers} canEdit={m.can_edit}
          onSaved={(c, view) => setM((x) => ({ ...x, channels: { ...x.channels, [c]: view } }))} />
      ))}
      <Text style={s.foot}>{_t("Provider keys are stored encrypted and never shown again. Delivery reports come back to the address shown above.")}</Text>
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "800", color: C.ink },
  status: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "55%" },
  statusTxt: { fontSize: 12, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 6 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 13, color: C.ink, fontWeight: "600" },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 4 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, marginBottom: 2 },
  help: { fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 15 },
  meta: { fontSize: 13, color: C.muted, lineHeight: 19 },
  note: { fontSize: 12, color: C.warn, marginBottom: 8, lineHeight: 17 },
  bullet: { fontSize: 12, color: C.ink, marginTop: 4, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  rowTxt: { fontSize: 14, color: C.ink },
  hook: { backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 10, marginTop: 8 },
  hookLbl: { fontSize: 11, color: C.muted, paddingRight: 20 },
  hookUrl: { fontSize: 12, color: C.ink, fontWeight: "600", marginTop: 4 },
  testRow: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  testBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  foot: { fontSize: 12, color: C.muted, textAlign: "center", marginVertical: 4 },
  err: { color: C.err, fontSize: 13 },
  retry: { color: C.brand, fontWeight: "700", marginTop: 6 },
});
