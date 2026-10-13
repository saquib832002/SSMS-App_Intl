/**
 * Shown on top of the app after sign-in:
 *  1. Consent prompt – the school's privacy questions not answered yet (new person, or the text changed).
 *     Required items must be accepted to continue; the rest are yes / no.
 *  2. Two-step reminder – the school requires two-step login for this role and it isn't set up yet.
 */
import React, { useContext, useEffect, useRef, useState } from "react";
import { Modal, View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext, navigationRef } from "../context/AuthContext";
import { getPendingConsents, answerConsents } from "../services/SecurityApi";
import { C, Btn } from "./ReportCardUI";
import { _t, _tx } from "../services/i18n";

export default function SecurityGates() {
  const { user } = useContext(AuthContext);
  const [pending, setPending] = useState(null);   // [{subject_id, name, detail, types:[…]}]
  const [choice, setChoice]   = useState({});     // "subject|type" → bool
  const [open, setOpen]       = useState(null);   // expanded type text
  const [busy, setBusy]       = useState(false);
  const reminded = useRef(null);

  useEffect(() => {
    setPending(null);
    if (!user?.token) return;
    let alive = true;
    getPendingConsents(user).then((p) => {
      if (!alive || !Array.isArray(p) || !p.length) return;
      const c = {};
      p.forEach((s) => s.types.forEach((t) => { c[`${s.subject_id}|${t.id}`] = t.previous ?? (t.required ? true : false); }));
      setChoice(c);
      setPending(p);
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.token]);   // eslint-disable-line react-hooks/exhaustive-deps

  // two-step reminder (once per sign-in), after the consent prompt is done
  useEffect(() => {
    if (!user?.token || !user.mfaSetupDue || user.mfaEnabled || pending?.length) return;
    if (reminded.current === user.token) return;
    reminded.current = user.token;
    const t = setTimeout(() => {
      Alert.alert(
        _t("Two-step login needed"),
        _t("Your school requires two-step login for your role. Please set it up before {mfaSetupDue}, or you won't be able to sign in after that.", { mfaSetupDue: user.mfaSetupDue }),
        [{ text: _t("Later"), style: "cancel" },
         { text: _t("Set up now"), onPress: () => { try { navigationRef.current?.navigate("Security"); } catch { /* ignore */ } } }]
      );
    }, 1200);
    return () => clearTimeout(t);
  }, [user?.token, user?.mfaSetupDue, user?.mfaEnabled, pending?.length]);

  if (!pending?.length) return null;

  const save = async () => {
    const answers = [];
    for (const s of pending) {
      for (const t of s.types) {
        const g = !!choice[`${s.subject_id}|${t.id}`];
        if (t.required && !g) {
          Alert.alert(_t("Needed to continue"), _t("\"{title}\" is needed to use the app. If you don't agree, please contact the school.", { title: t.title }));
          return;
        }
        answers.push({ subject_id: s.subject_id, type_id: t.id, granted: g });
      }
    }
    setBusy(true);
    try {
      const r = await answerConsents(user, answers);
      setPending(r?.pending ?? []);
    } catch (e) { Alert.alert(_t("Privacy choices"), _tx(e.message)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => {}}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={sx.wrap}>
        <View style={sx.icon}><Feather name="shield" size={24} color={C.brand} /></View>
        <Text style={sx.title}>{_t("Before you continue")}</Text>
        <Text style={sx.sub}>{_t("Your school asks for your choices. You can change them any time in Settings › Privacy.")}</Text>
        {pending.map((s) => (
          <View key={s.subject_id} style={sx.card}>
            <Text style={sx.who}>{s.subject_type === "staff" ? _t("For you") : _t("For {name}", { name: s.name })}{s.detail ? ` · ${_tx(s.detail)}` : ""}</Text>
            {s.types.map((t) => {
              const k = `${s.subject_id}|${t.id}`;
              const on = !!choice[k];
              return (
                <View key={k} style={sx.item}>
                  <TouchableOpacity style={sx.itemRow} onPress={() => setChoice({ ...choice, [k]: !on })} activeOpacity={0.7}>
                    <View style={[sx.box, on && sx.boxOn]}>{on && <Feather name="check" size={13} color="#fff" />}</View>
                    <View style={{ flex: 1 }}>
                      <Text style={sx.itemTitle}>{_tx(t.title)}{t.required ? <Text style={sx.req}>{" "}{_t("· required")}</Text> : null}</Text>
                      {t.previous !== null && t.previous !== undefined && <Text style={sx.changed}>{_t("The wording changed – please check again.")}</Text>}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setOpen(open === k ? null : k)}>
                    <Text style={sx.read}>{open === k ? _t("Hide") : _t("Read")}</Text>
                  </TouchableOpacity>
                  {open === k && <Text style={sx.body}>{_tx(t.body)}</Text>}
                </View>
              );
            })}
          </View>
        ))}
        <Btn title={_t("Save my choices")} icon="check" busy={busy} onPress={save} />
      </ScrollView>
    </Modal>
  );
}

const sx = StyleSheet.create({
  wrap: { padding: 20, paddingTop: Platform.OS === "ios" ? 64 : 32, paddingBottom: 40 },
  icon: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  title: { fontSize: 22, fontWeight: "800", color: C.ink },
  sub: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 14, lineHeight: 19 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 12 },
  who: { fontSize: 12, fontWeight: "800", color: C.brand, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  item: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  itemRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: "#94a3b8", alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: C.brand, borderColor: C.brand },
  itemTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  req: { fontSize: 12, color: C.muted, fontWeight: "500" },
  changed: { fontSize: 11, color: C.warn, marginTop: 2 },
  read: { fontSize: 12, color: C.brand, fontWeight: "700", marginLeft: 32, marginTop: 4 },
  body: { fontSize: 12, color: C.muted, marginLeft: 32, marginTop: 4, lineHeight: 17 },
});
