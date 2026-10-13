/**
 * Setup › Notifications › Texts – the SMS / WhatsApp text of every message, per language:
 * the exact text to register (India DLT "{#var#}", WhatsApp "{{1}}"), the provider's template ID / name
 * and its approval status, and optionally the school's own wording (same placeholders).
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";
import { getTemplates, saveTemplate } from "../../services/NotifyApi";

const STATUS = { get none() { return _t("Not registered"); }, get submitted() { return _t("Waiting for approval"); }, get approved() { return _t("Approved"); }, get rejected() { return _t("Rejected"); } };

function Row({ user, t, canEdit, onSaved }) {
  const [ref, setRef] = useState(t.provider_ref ?? "");
  const [status, setStatus] = useState(t.status === "none" ? "approved" : t.status);
  const [text, setText] = useState(t.text ?? "");
  const [own, setOwn] = useState(!!t.text);
  const [busy, setBusy] = useState(false);
  const dirty = ref !== (t.provider_ref ?? "") || (ref && status !== t.status) || (own ? text : "") !== (t.text ?? "");

  const save = async () => {
    setBusy(true);
    try {
      const r = await saveTemplate(user, { kind: t.kind, channel: t.channel, lang: t.lang, provider_ref: ref, status, text: own ? text : "" });
      onSaved(r);
    } catch (e) { Alert.alert(_t("Texts"), _tx(e.message)); } finally { setBusy(false); }
  };

  return (
    <View style={s.row}>
      <View style={s.rowHead}>
        <Text style={s.kind}>{_tx(t.title)}</Text>
        <View style={[s.badge, t.status === "approved" ? s.ok : t.status === "rejected" ? s.bad : t.status === "submitted" ? s.wait : null]}>
          <Text style={s.badgeTxt}>{STATUS[t.status] ?? t.status}</Text>
        </View>
      </View>
      <Text style={s.lbl}>{t.needs_template || t.channel === "whatsapp" ? _t("Text to register") : _t("Text")}</Text>
      <Text style={s.reg} selectable>{t.register_text}</Text>
      {t.segments !== null && t.segments !== undefined && <Text style={s.help}>{t.segments === 1 ? _t("1 SMS part") : _t("{n} SMS parts", { n: t.segments })}</Text>}
      {canEdit && (
        <>
          <TextInput style={s.input} value={ref} onChangeText={setRef} autoCapitalize="none" autoCorrect={false}
            placeholder={t.channel === "whatsapp" ? _t("Template name or ID (e.g. absent_today)") : _t("DLT template ID")} placeholderTextColor="#94a3b8"
            accessibilityLabel={_t("Template name or ID")} />
          {!!ref && (
            <View style={s.chips}>
              {["submitted", "approved", "rejected"].map((k) => (
                <TouchableOpacity key={k} style={[s.chip, status === k && s.chipOn]} onPress={() => setStatus(k)}>
                  <Text style={[s.chipTxt, status === k && { color: C.brand }]}>{STATUS[k]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity style={s.ownToggle} onPress={() => { setOwn((x) => !x); if (!own && !text) setText(t.standard); }}>
            <Feather name={own ? "check-square" : "square"} size={15} color={C.brand} />
            <Text style={s.ownTxt}>{_t("Use our own wording")}</Text>
          </TouchableOpacity>
          {own && (
            <>
              <TextInput style={[s.input, { minHeight: 60, textAlignVertical: "top" }]} value={text} onChangeText={setText} multiline accessibilityLabel={_t("Use our own wording")} />
              <Text style={s.help}>{_t("Placeholders you can use: {list}", { list: t.vars.map((v) => "{" + v + "}").join(" ") })}</Text>
            </>
          )}
          {dirty && <Btn title={_t("Save")} icon="check" busy={busy} onPress={save} style={{ marginTop: 4 }} />}
        </>
      )}
    </View>
  );
}

export default function MessageTemplates() {
  const { user } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [ch, setCh] = useState("sms");
  const [lang, setLang] = useState(null);
  const load = useCallback(async () => {
    setError("");
    try { const r = await getTemplates(user); setData(r); setLang((l) => l ?? r.school_language); } catch (e) { setError(_tx(e.message)); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const langs = useMemo(() => {
    if (!data) return [];
    const used = new Set(data.templates.filter((t) => t.used).map((t) => t.lang));
    return Object.keys(data.languages).sort((a, b) => (used.has(b) - used.has(a))).map((k) => ({ k, used: used.has(k), name: data.languages[k] }));
  }, [data]);
  const rows = (data?.templates ?? []).filter((t) => t.channel === ch && t.lang === lang);

  if (!data && !error) return <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} />;
  if (error) return <TouchableOpacity onPress={load}><Text style={s.err}>{error}</Text><Text style={s.retry}>{_t("Try again")}</Text></TouchableOpacity>;
  return (
    <>
      <View style={s.chips}>
        {["sms", "whatsapp"].map((k) => (
          <TouchableOpacity key={k} style={[s.chip, ch === k && s.chipOn]} onPress={() => setCh(k)}>
            <Text style={[s.chipTxt, ch === k && { color: C.brand }]}>{k === "sms" ? _t("SMS") : _t("WhatsApp")}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={s.chips}>
        {langs.map((l) => (
          <TouchableOpacity key={l.k} style={[s.chip, lang === l.k && s.chipOn, !l.used && { opacity: 0.6 }]} onPress={() => setLang(l.k)}>
            <Text style={[s.chipTxt, lang === l.k && { color: C.brand }]}>{l.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Card>
        <Text style={s.meta}>{ch === "whatsapp"
          ? _t("Create each template in your WhatsApp provider as a Utility template with exactly this text, then enter its name (Meta, Infobip), Content SID (Twilio) or template ID (Gupshup). Whapi needs no templates.")
          : _t("India: register each text on DLT as a Service (transactional) template and enter its template ID. Other countries: no registration is needed – the text is sent as shown.")}</Text>
        <Text style={s.help}>{_t("Faded languages are not used by anyone in your school yet.")}</Text>
      </Card>
      {rows.map((t) => (
        <Card key={t.kind + t.channel + t.lang}>
          <Row user={user} t={t} canEdit={data.can_edit}
            onSaved={() => load()} />
        </Card>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 13, color: C.ink, fontWeight: "600" },
  row: {},
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  kind: { flex: 1, fontSize: 14, fontWeight: "800", color: C.ink },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#f1f5f9" },
  ok: { backgroundColor: "#dcfce7" }, bad: { backgroundColor: "#fee2e2" }, wait: { backgroundColor: "#fef3c7" },
  badgeTxt: { fontSize: 10, fontWeight: "700", color: "#334155" },
  lbl: { fontSize: 11, fontWeight: "700", color: C.muted, marginTop: 2 },
  reg: { fontSize: 13, color: C.ink, backgroundColor: "#f8fafc", borderRadius: 8, padding: 8, marginTop: 3, lineHeight: 19 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: C.ink, marginTop: 8 },
  ownToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  ownTxt: { fontSize: 13, color: C.ink },
  help: { fontSize: 11, color: C.muted, marginTop: 3 },
  meta: { fontSize: 12, color: C.muted, lineHeight: 18 },
  err: { color: C.err, fontSize: 13 },
  retry: { color: C.brand, fontWeight: "700", marginTop: 6 },
});
