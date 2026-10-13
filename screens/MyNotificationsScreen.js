/**
 * My notifications – which school messages this person gets on the phone and by e-mail.
 * Messages the school marked "for every family" (e.g. absences) cannot be switched off.
 * Everything still appears in the in-app list (the bell).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { AuthContext } from "../context/AuthContext";
import { C, Card, Empty } from "../components/ReportCardUI";
import { _t, _tx } from "../services/i18n";
import { getPrefs, savePref } from "../services/NotifyApi";

const CHANNEL = { get push() { return _t("Phone"); }, get email() { return _t("E-mail"); }, get sms() { return _t("SMS"); }, get whatsapp() { return _t("WhatsApp"); } };
const CH_ICON = { push: "smartphone", email: "mail", sms: "message-square", whatsapp: "message-circle" };

export default function MyNotificationsScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setPrefs((await getPrefs(user)).prefs ?? []); } catch (e) { setError(_tx(e.message)); setPrefs([]); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flip = async (ev, ch, on) => {
    const k = ev + "|" + ch;
    setBusy(k);
    setPrefs((p) => p.map((x) => (x.event === ev ? { ...x, channels: { ...x.channels, [ch]: { ...x.channels[ch], on } } } : x)));
    try {
      setPrefs((await savePref(user, ev, ch, on)).prefs ?? []);
    } catch (e) {
      Alert.alert(_t("My notifications"), _tx(e.message));
      load();
    } finally {
      setBusy(null);
    }
  };

  if (prefs === null) return <View style={[s.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.brand} /></View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
      <Card>
        <Text style={s.meta}>{_t("Choose how the school reaches you. Everything also appears under the bell at the top of the app.")}</Text>
      </Card>
      {!!error && (
        <TouchableOpacity style={s.err} onPress={load}><Text style={s.errTxt}>{error}</Text><Text style={s.retry}>{_t("Try again")}</Text></TouchableOpacity>
      )}
      {!error && prefs.length === 0 && <Empty icon="bell-off" text={_t("Your school has not switched on any automatic notifications yet.")} />}
      {prefs.map((p) => (
        <Card key={p.event}>
          <View style={s.head}>
            <Text style={s.title}>{_tx(p.label)}</Text>
            {p.essential && (
              <View style={s.lock}><Feather name="lock" size={10} color={C.warn} /><Text style={s.lockTxt}>{_t("Sent to every family")}</Text></View>
            )}
          </View>
          {Object.entries(p.channels).map(([ch, c]) => (
            <View key={ch} style={s.line}>
              <Feather name={CH_ICON[ch] ?? "bell"} size={15} color={C.muted} />
              <Text style={s.ch}>{CHANNEL[ch] ?? ch}</Text>
              {busy === p.event + "|" + ch ? <ActivityIndicator color={C.brand} /> : (
                <Switch value={!!c.on} disabled={c.locked} onValueChange={(v) => flip(p.event, ch, v)}
                  accessibilityLabel={`${_tx(p.label)} – ${CHANNEL[ch] ?? ch}`}
                  trackColor={{ true: "#c4b5fd", false: "#e2e8f0" }} thumbColor={c.on ? C.brand : "#f8fafc"} />
              )}
            </View>
          ))}
          {Object.keys(p.channels).length === 0 && <Text style={s.meta}>{_t("Only in the app.")}</Text>}
        </Card>
      ))}
      <Text style={s.foot}>{_t("Phone notifications also need to be allowed for this app in your phone's settings.")}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  meta: { fontSize: 13, color: C.muted, lineHeight: 19 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" },
  title: { fontSize: 15, fontWeight: "800", color: C.ink },
  lock: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fef3c7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  lockTxt: { fontSize: 10, fontWeight: "700", color: C.warn },
  line: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  ch: { flex: 1, fontSize: 14, color: C.ink },
  foot: { fontSize: 12, color: C.muted, textAlign: "center", marginTop: 6 },
  err: { backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, marginBottom: 10 },
  errTxt: { color: C.err, fontSize: 13 },
  retry: { color: C.brand, fontWeight: "700", marginTop: 6 },
});
