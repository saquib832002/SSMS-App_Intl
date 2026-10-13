/**
 * Setup › Region & formats – currency, number / date / time formats, time zone and local names
 * (tax, postal code). Choosing a country fills in its usual settings; each can then be changed.
 * Everyone in the school (staff, parents, students) sees amounts and dates this way.
 */
import React, { useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, I18nManager, ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, TouchableOpacity, Modal, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Field, Picker } from "../../components/ReportCardUI";
import { safeFetch } from "../../services/apiInterceptor";
import { BASE_URL as _BASE } from "../../Environment/EnvironmentConfig";
import { setLocale, withLocale, fmtMoney, fmtDate, fmtTime, fmtNumber, getUserLanguage } from "../../services/Locale";
import { _t, _tx, getLanguage, LANGUAGES } from "../../services/i18n";

const BASE_URL = _BASE.replace(/\/+$/, "");

async function call(user, path, body) {
  const res = await safeFetch(`${BASE_URL}/LocaleApi/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-App-Version": Constants.expoConfig?.version ?? "", Authorization: `Bearer ${user?.token ?? ""}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!data || !res.ok || data.status === false) throw new Error(data?.message || _t("Something went wrong (HTTP {status}).", { status: res.status }));
  return data.data;
}

/** Searchable list for long lists (time zones). */
function SearchPicker({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => (q.trim() ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options), [q, options]);
  return (
    <>
      <Text style={s.label}>{_tx(label)}</Text>
      <TouchableOpacity style={[s.picker, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={() => setOpen(true)}>
        <Text style={s.pickerTxt}>{_tx(value)}</Text>
        <Feather name="chevron-down" size={15} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <TextInput value={q} onChangeText={setQ} placeholder={_t("Search, e.g. Dubai, London")} placeholderTextColor="#94a3b8" style={s.search} autoFocus />
            <FlatList data={list} keyExtractor={(x) => x} keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.opt} onPress={() => { onChange(item); setOpen(false); setQ(""); }}>
                  <Text style={[s.optTxt, item === value && { color: C.brand, fontWeight: "800" }]}>{_tx(item)}</Text>
                </TouchableOpacity>
              )} />
            <Btn title={_t("Close")} kind="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function RegionFormatsScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [opt, setOpt] = useState(null);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    call(user, "options").then((r) => { if (!off) { setOpt(r); setF({ ...r.locale }); } }).catch((e) => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [user]);

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const applyCountry = (cc) => {
    const c = opt.countries.find((x) => x.code === cc);
    if (!c) return;
    Alert.alert(_t("Use {name}'s usual settings?", { name: c.name }), _t("Currency {currency_code} ({currency_symbol}), dates {date_format}, {v} time, time zone {timezone}. You can still change each one.", { currency_code: c.preset.currency_code, currency_symbol: c.preset.currency_symbol, date_format: c.preset.date_format, v: c.preset.time_format === "24h" ? "24-hour" : "12-hour", timezone: c.preset.timezone }), [
      { text: _t("Only the country"), onPress: () => setF((x) => ({ ...x, country: cc })) },
      { text: _t("Use them"), onPress: () => setF((x) => ({ ...x, ...c.preset, country: cc })) },
    ]);
  };

  // live preview with the form's choices (the rest of the app is untouched until saved)
  const preview = useMemo(() => {
    if (!f) return null;
    const nf = { intl: [",", "."], indian: [",", "."], eu: [".", ","], space: [" ", ","], swiss: ["'", "."] }[f.number_format] ?? [",", "."];
    const dec = ["JPY", "KRW", "IDR", "VND", "CLP", "UGX"].includes(f.currency_code) ? 0 : ["KWD", "BHD", "OMR", "JOD", "TND"].includes(f.currency_code) ? 3 : 2;
    return withLocale({ ...f, decimals: dec, group_separator: nf[0], decimal_separator: nf[1] }, () => (
      { money: fmtMoney(1234567.5), small: fmtMoney(99), num: fmtNumber(1234567, 0), date: fmtDate("2026-03-07"), medium: fmtDate("2026-03-07", "long"), time: fmtTime("15:05") }));
  }, [f]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await call(user, "save", { country: f.country, currency_code: (f.currency_code || "").toUpperCase(), currency_symbol: f.currency_symbol, currency_position: f.currency_position,
        number_format: f.number_format, date_format: f.date_format, time_format: f.time_format, tax_label: f.tax_label, postal_label: f.postal_label,
        timezone: f.timezone, week_start: +f.week_start, language: f.language || "en" });
      // the school's language – people who chose their own (My language) keep theirs
      const newLang = getUserLanguage() || r.locale?.language || "en";
      if (newLang === getLanguage()) {
        setLocale(r.locale);
        Alert.alert(_t("Saved"), _t("Amounts, dates and times now follow these settings for everyone in your school. Other phones pick them up the next time the app opens."));
        navigation.goBack();
      } else {
        // the screens are re-drawn in the new language once this is closed
        const rtl = !!LANGUAGES.find((l) => l.code === newLang)?.rtl;
        const flip = rtl !== I18nManager.isRTL;
        Alert.alert(_t("Saved"), _t("The app will now switch to the new language for everyone in your school. Other phones pick it up the next time the app opens.")
          + (flip ? "\n\n" + _t("Close and reopen the app to finish changing the screen direction.") : ""),
          [{ text: _t("OK"), onPress: () => setLocale(r.locale) }]);
      }
    } catch (e) { Alert.alert(_t("Region & formats"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (err) return <View style={s.wrap}><Card style={{ margin: 16 }}><Empty icon="alert-circle" text={_tx(err)} /></Card></View>;
  if (!opt || !f) return <View style={[s.wrap, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={C.brand} /></View>;
  const ro = !opt.can_edit;

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {ro && <Card><Text style={s.meta}>{_t("You can see these settings but not change them.")}</Text></Card>}
        <Card title={_t("Preview")}>
          <Text style={s.prev}>{_tx(preview.money)} · {_tx(preview.small)}</Text>
          <Text style={s.prev}>{_tx(preview.num)} · {_tx(preview.date)} · {_tx(preview.medium)} · {_tx(preview.time)}</Text>
          <Text style={s.meta}>{_tx(f.tax_label)} · {_tx(f.postal_label)} · {_tx(f.timezone)}</Text>
        </Card>
        <Card title={_t("Country")}>
          <Picker label={_t("Country")} value={f.country} disabled={ro} options={opt.countries.map((c) => ({ value: c.code, label: c.name }))} onChange={applyCountry} />
          <SearchPicker label={_t("Time zone (used for 'today', attendance and reminders)")} value={f.timezone} options={opt.timezones} onChange={set("timezone")} disabled={ro} />
        </Card>
        <Card title={_t("Currency")}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Field label={_t("Code")} value={f.currency_code} editable={!ro} autoCapitalize="characters" maxLength={3} onChangeText={(v) => set("currency_code")(v.replace(/[^A-Za-z]/g, "").toUpperCase())} /></View>
            <View style={{ flex: 1 }}><Field label={_t("Symbol")} value={f.currency_symbol} editable={!ro} maxLength={6} onChangeText={set("currency_symbol")} /></View>
          </View>
          <Picker label={_t("Symbol position")} value={f.currency_position} disabled={ro} options={Object.entries(opt.currency_positions).map(([k, v]) => ({ value: k, label: v.replace("₹", f.currency_symbol || "₹") }))} onChange={set("currency_position")} />
        </Card>
        <Card title={_t("Numbers, dates and times")}>
          <Picker label={_t("Numbers")} value={f.number_format} disabled={ro} options={opt.number_formats} onChange={set("number_format")} />
          <Picker label={_t("Dates")} value={f.date_format} disabled={ro} options={opt.date_formats.map((x) => ({ value: x, label: x }))} onChange={set("date_format")} />
          <Picker label={_t("Time")} value={f.time_format} disabled={ro} options={[{ value: "12h", label: _t("12-hour (3:05 PM)") }, { value: "24h", label: _t("24-hour (15:05)") }]} onChange={set("time_format")} />
          <Picker label={_t("Week starts on")} value={String(f.week_start)} disabled={ro} options={[{ value: "1", label: _t("Monday") }, { value: "6", label: _t("Saturday") }, { value: "7", label: _t("Sunday") }]} onChange={(v) => set("week_start")(+v)} />
        </Card>
        <Card title={_t("Local names")}>
          <Field label={_t("Tax name (on fee slips and receipts)")} value={f.tax_label} editable={!ro} maxLength={30} onChangeText={set("tax_label")} placeholder={_t("GST, VAT, Sales tax")} />
          <Field label={_t("Postal code name (on forms)")} value={f.postal_label} editable={!ro} maxLength={30} onChangeText={set("postal_label")} placeholder={_t("PIN code, Postcode, ZIP code")} />
          <Picker label={_t("School language (app, notifications and e-mails)")} value={f.language || "en"} disabled={ro}
            options={Object.entries(opt.languages ?? { en: "English" }).map(([k, v]) => ({ value: k, label: v }))} onChange={set("language")} />
          <Text style={s.meta}>{_t("Names, notices and other text typed by the school are not translated.")} {_t("Each person can choose their own language in the menu › My language.")}</Text>
        </Card>
        {!ro && <Btn title={_t("Save")} icon="save" busy={busy} onPress={save} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  meta: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 4 },
  prev: { fontSize: 14, fontWeight: "700", color: C.ink, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  picker: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10 },
  pickerTxt: { flex: 1, fontSize: 14, color: C.ink, fontWeight: "500" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 14 },
  search: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, marginBottom: 8 },
  opt: { paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  optTxt: { fontSize: 14, color: C.ink },
});
