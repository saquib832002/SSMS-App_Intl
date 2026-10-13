/**
 * Sign-in step 2 (two-step login).
 *  purpose "verify": enter the 6-digit authenticator code, an e-mailed code, or a backup code.
 *  purpose "setup":  the school requires two-step login and this person hasn't set it up yet –
 *                    scan the QR in an authenticator app, confirm a code, save the backup codes.
 */
import React, { useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Share, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { AuthContext } from "../../context/AuthContext";
import {
  loginVerify, loginEmailCode, loginSetupStart, loginSetupConfirm, toUserData, saveTrustToken,
} from "../../services/SecurityApi";
import { C, Card, Btn, Field, Toggle } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const METHODS = [
  { key: "totp", get label() { return _t("Authenticator"); } },
  { key: "email", get label() { return _t("E-mail code"); } },
  { key: "backup", get label() { return _t("Backup code"); } },
];

export default function TwoStepScreen({ route, navigation }) {
  const { login } = useContext(AuthContext);
  const { challenge, purpose, email, username } = route.params ?? {};
  const [method, setMethod] = useState("totp");
  const [code, setCode]     = useState("");
  const [trust, setTrust]   = useState(true);
  const [busy, setBusy]     = useState(false);
  const [setup, setSetup]   = useState(null);     // { secret, uri }
  const [codes, setCodes]   = useState(null);     // backup codes after setup
  const [done, setDone]     = useState(null);     // login data waiting for "Continue"

  useEffect(() => {
    if (purpose !== "setup") return;
    loginSetupStart(challenge).then((r) => {
      if (r.status) setSetup(r.data);
      else { Alert.alert(_t("Two-step login"), _tx(r.message) || _t("Please sign in again.")); navigation.goBack(); }
    }).catch(() => Alert.alert(_t("Two-step login"), _t("Unable to connect to server")));
  }, [challenge, purpose]);   // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async (data) => {
    if (data.deviceToken) await saveTrustToken(username, data.deviceToken);
    login(toUserData(data));
  };

  const verify = async () => {
    const clean = code.trim();
    if (!clean) { Alert.alert(_t("Two-step sign-in"), _t("Enter the code.")); return; }
    setBusy(true);
    try {
      const r = await loginVerify(challenge, method, clean, trust);
      if (r.status && r.data?.token) await finish(r.data);
      else {
        Alert.alert(_t("Two-step sign-in"), _tx(r.message) || _t("That code is not right."));
        if ((r.message || "").includes("timed out")) navigation.goBack();
      }
    } catch { Alert.alert(_t("Error"), _t("Unable to connect to server")); }
    finally { setBusy(false); }
  };

  const sendEmail = async () => {
    setBusy(true);
    try {
      const r = await loginEmailCode(challenge);
      Alert.alert(_t("E-mail code"), _tx(r.message) || (r.status ? _t("Code sent.") : _t("Could not send the code.")));
      if (r.status) { setMethod("email"); setCode(""); }
    } catch { Alert.alert(_t("Error"), _t("Unable to connect to server")); }
    finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    if (code.replace(/\D/g, "").length !== 6) { Alert.alert(_t("Two-step login"), _t("Enter the 6-digit code from the app.")); return; }
    setBusy(true);
    try {
      const r = await loginSetupConfirm(challenge, code, trust);
      if (r.status && r.data?.token) { setCodes(r.data.backupCodes ?? []); setDone(r.data); }
      else Alert.alert(_t("Two-step login"), _tx(r.message) || _t("That code is not right."));
    } catch { Alert.alert(_t("Error"), _t("Unable to connect to server")); }
    finally { setBusy(false); }
  };

  // ── Backup codes after setup ─────────────────────────────────────────────
  if (codes && done) {
    return (
      <SafeAreaView style={sx.safe}>
        <ScrollView contentContainerStyle={sx.wrap}>
          <Text style={sx.title}>{_t("Two-step login is on")}</Text>
          <Text style={sx.sub}>{_t("Save these backup codes somewhere safe (not on this phone only). Each one works once if you lose your phone. They won't be shown again.")}</Text>
          <Card><BackupCodes codes={codes} /></Card>
          <Btn title={_t("Share / save codes")} kind="ghost" icon="share-2"
            onPress={() => Share.share({ message: _t("ManageMyAcademy backup codes for {username}:\n\n{v}", { username, v: codes.join("\n") }) })} />
          <Btn title={_t("I've saved them – continue")} icon="check" onPress={() => finish(done)} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={sx.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sx.wrap} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => navigation.goBack()} style={sx.back} hitSlop={10}>
            <Feather name="arrow-left" size={20} color={C.ink} /><Text style={sx.backTxt}>{_t("Back to sign in")}</Text>
          </TouchableOpacity>
          <View style={sx.icon}><Feather name="shield" size={26} color={C.brand} /></View>

          {purpose === "setup" ? (
            <>
              <Text style={sx.title}>{_t("Set up two-step login")}</Text>
              <Text style={sx.sub}>{_t("Your school requires this for your role. Install Google Authenticator or Microsoft Authenticator, then scan this code.")}</Text>
              {!setup ? <ActivityIndicator color={C.brand} style={{ marginVertical: 30 }} /> : (
                <Card>
                  <View style={{ alignItems: "center", paddingVertical: 8 }}>
                    <QRCode value={setup.uri} size={190} />
                  </View>
                  <Text style={sx.hint}>{_t("Can't scan? In the app choose \"Enter a setup key\" and type:")}</Text>
                  <Text selectable style={sx.key}>{_tx(setup.secret)}</Text>
                </Card>
              )}
              <Field label={_t("Enter the 6-digit code it shows")} keyboardType="number-pad" maxLength={7} value={code}
                onChangeText={setCode} style={sx.codeInput} placeholder="123456" />
              <Toggle label={_t("Trust this phone for 30 days")} value={trust} onChange={setTrust} />
              <Btn title={_t("Turn on two-step login")} icon="check" busy={busy} onPress={confirmSetup} disabled={!setup} />
            </>
          ) : (
            <>
              <Text style={sx.title}>{_t("Two-step sign-in")}</Text>
              <Text style={sx.sub}>
                {method === "totp" ? _t("Open your authenticator app and enter the 6-digit code for ManageMyAcademy · {username}.", { username })
                  : method === "email" ? _t("Enter the code we e-mailed{v}.", { v: email ? ` ${_t("to {email}", { email })}` : "" })
                  : _t("Enter one of your backup codes (like 7Q2K-9XHB). Each works once.")}
              </Text>
              <View style={sx.tabs}>
                {METHODS.map((m) => (
                  <TouchableOpacity key={m.key} onPress={() => { setMethod(m.key); setCode(""); }}
                    style={[sx.tab, method === m.key && sx.tabOn]}>
                    <Text style={[sx.tabTxt, method === m.key && { color: C.brand }]}>{_tx(m.label)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Field value={code} onChangeText={setCode} autoFocus
                keyboardType={method === "backup" ? "default" : "number-pad"} autoCapitalize="characters"
                maxLength={method === "backup" ? 9 : 7} style={sx.codeInput} placeholder={method === "backup" ? _t("XXXX-XXXX") : "123456"} />
              <Toggle label={_t("Trust this phone for 30 days")} value={trust} onChange={setTrust} />
              <Btn title={_t("Verify")} icon="log-in" busy={busy} onPress={verify} />
              {method === "email" && <Btn title={_t("E-mail me a code{v}", { v: email ? ` (${email})` : "" })} kind="ghost" icon="mail" onPress={sendEmail} disabled={busy} />}
              <Text style={sx.foot}>{_t("Lost your phone? Use a backup code, or ask the school owner to reset your two-step login.")}</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function BackupCodes({ codes }) {
  return (
    <View style={sx.codes}>
      {codes.map((c) => <Text key={c} selectable style={sx.codeItem}>{_tx(c)}</Text>)}
    </View>
  );
}

const sx = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { padding: 20, paddingBottom: 40 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
  backTxt: { color: C.ink, fontWeight: "600" },
  icon: { width: 56, height: 56, borderRadius: 18, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "800", color: C.ink, textAlign: "center" },
  sub: { fontSize: 14, color: C.muted, textAlign: "center", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  hint: { fontSize: 12, color: C.muted, textAlign: "center", marginTop: 6 },
  key: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 16, fontWeight: "700", color: C.ink, textAlign: "center", marginTop: 6, letterSpacing: 1 },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: "center", fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 6, marginBottom: 10 },
  tab: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: "#fff" },
  tabOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  foot: { fontSize: 12, color: C.muted, textAlign: "center", marginTop: 16 },
  codes: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  codeItem: { width: "48%", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 16, fontWeight: "700", color: C.ink,
              backgroundColor: C.bg, borderRadius: 8, paddingVertical: 8, textAlign: "center", marginBottom: 8 },
});
