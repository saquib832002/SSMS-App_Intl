/**
 * My account › Security
 * Two-step login (turn on / off, backup codes), trusted devices, where you're signed in,
 * sign out everywhere, change password.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, Modal, TouchableOpacity, ActivityIndicator, Share, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { AuthContext } from "../../context/AuthContext";
import {
  getSecurityStatus, mfaStart, mfaConfirm, mfaDisable, newBackupCodes, forgetDevices, revokeSession,
  signOutEverywhere, clearTrustToken, niceWhen,
} from "../../services/SecurityApi";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import { BackupCodes } from "./TwoStepScreen";
import { _t, _tx } from "../../services/i18n";

export default function SecurityScreen({ navigation }) {
  const { user, logout, updateUser } = useContext(AuthContext);
  const [st, setSt]       = useState(null);
  const [setup, setSetup] = useState(null);   // { secret, uri }
  const [codes, setCodes] = useState(null);
  const [ask, setAsk]     = useState(null);   // { title, action(code) } – asks for a code
  const [code, setCode]   = useState("");
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    try { setSt(await getSecurityStatus(user)); } catch (e) { Alert.alert(_t("Security"), _tx(e.message)); setSt({}); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert(_t("Security"), _tx(e.message)); } finally { setBusy(false); }
  };

  const startSetup = () => run(async () => { setSetup(await mfaStart(user)); setCode(""); });
  const confirmSetup = () => run(async () => {
    const r = await mfaConfirm(user, code);
    setSetup(null); setCodes(r.backup_codes); setCode("");
    updateUser?.({ mfaEnabled: true, mfaSetupDue: null });
    await load();
  });

  const withCode = (title, action) => { setCode(""); setAsk({ title, action }); };

  if (!st) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Card title={_t("Two-step login")}>
        <View style={sx.statusRow}>
          <View style={[sx.dot, { backgroundColor: st.enabled ? C.ok : C.warn }]} />
          <Text style={sx.statusTxt}>{st.enabled ? _t("On") : _t("Off")}</Text>
          {st.required && <Text style={sx.req}>{_t("Required for your role")}</Text>}
        </View>
        <Text style={sx.hint}>
          {st.enabled
            ? _t("After your password you enter a code from your authenticator app. {backup_remaining} backup code{pl} left.", { backup_remaining: st.backup_remaining, pl: st.backup_remaining === 1 ? "" : "s" })
            : st.required
              ? _t("Your school requires it. Please turn it on{v} – after that you can't sign in without it.", { v: st.deadline ? ` ${_t("by {deadline}", { deadline: st.deadline })}` : "" })
              : _t("Adds a code from your phone after your password, so a stolen password alone can't get in.")}
        </Text>
        {!st.enabled ? (
          <Btn title={_t("Turn on two-step login")} icon="shield" busy={busy} onPress={startSetup} />
        ) : (
          <>
            <Btn title={_t("Make new backup codes")} kind="ghost" icon="refresh-cw"
              onPress={() => withCode("Make new backup codes", async (c) => { const r = await newBackupCodes(user, c); setCodes(r.backup_codes); await load(); })} />
            {!st.required && (
              <Btn title={_t("Turn off two-step login")} kind="danger" icon="x-circle"
                onPress={() => withCode("Turn off two-step login", async (c) => { await mfaDisable(user, c); updateUser?.({ mfaEnabled: false }); await load(); })} />
            )}
          </>
        )}
      </Card>

      {!!st.trusted_devices?.length && (
        <Card title={_t("Trusted devices")} right={
          <TouchableOpacity onPress={() => run(async () => { await forgetDevices(user); await clearTrustToken(user.ssmsUserName); await load(); })}>
            <Text style={sx.link}>{_t("Forget all")}</Text>
          </TouchableOpacity>}>
          {st.trusted_devices.map((d) => (
            <View key={d.id} style={sx.row}>
              <Feather name="smartphone" size={16} color={C.muted} />
              <View style={{ flex: 1 }}>
                <Text style={sx.rowTitle}>{_tx(d.label) || _t("Device")}</Text>
                <Text style={sx.hint}>{_t("Skips the code until {expires}", { expires: niceWhen(d.expires) })}</Text>
              </View>
              <TouchableOpacity onPress={() => run(async () => { await forgetDevices(user, d.id); await load(); })}><Text style={sx.link}>{_t("Forget")}</Text></TouchableOpacity>
            </View>
          ))}
        </Card>
      )}

      <Card title={_t("Where you're signed in")}>
        {!st.sessions?.length ? <Empty icon="monitor" text={_t("No other sign-ins.")} /> : st.sessions.map((s) => (
          <View key={s.ref} style={sx.row}>
            <Feather name={s.platform === "web" ? "monitor" : "smartphone"} size={16} color={C.muted} />
            <View style={{ flex: 1 }}>
              <Text style={sx.rowTitle}>{_tx(s.device) || _t("App")}{s.current ? ("  " + _t("· this device") + "") : ""}</Text>
              <Text style={sx.hint}>{_t("Last used {last_seen}{v}{v2}", { last_seen: niceWhen(s.last_seen), v: s.app_version ? ` ${_t("· v{app_version}", { app_version: s.app_version })}` : "", v2: s.mfa ? (" " + _t("· two-step") + "") : "" })}</Text>
            </View>
            {!s.current && (
              <TouchableOpacity onPress={() => run(async () => { await revokeSession(user, s.ref); await load(); })}>
                <Text style={sx.link}>{_t("Sign out")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <Btn title={_t("Sign out everywhere else")} kind="ghost" icon="log-out" busy={busy}
          onPress={() => Alert.alert(_t("Sign out everywhere else"), _t("All your other phones and browsers will be signed out. This phone stays signed in."), [
            { text: _t("Cancel"), style: "cancel" },
            { text: _t("Sign out others"), onPress: () => run(async () => { const r = await signOutEverywhere(user, true); Alert.alert(_t("Done"), _t("{ended} sign-in{pl} ended.", { ended: r.ended, pl: r.ended === 1 ? "" : "s" })); await load(); }) },
          ])} />
        <Btn title={_t("Sign out everywhere (including here)")} kind="danger" icon="power"
          onPress={() => Alert.alert(_t("Sign out everywhere"), _t("Every device, including this one, will be signed out."), [
            { text: _t("Cancel"), style: "cancel" },
            { text: _t("Sign out"), style: "destructive", onPress: () => run(async () => { await signOutEverywhere(user, false); await clearTrustToken(user.ssmsUserName); logout(); }) },
          ])} />
      </Card>

      <Card title={_t("Password")}>
        <Btn title={_t("Change password")} kind="ghost" icon="lock" onPress={() => navigation.navigate("ChangePassword")} />
        <Text style={sx.hint}>{_t("Changing your password signs out your other devices.")}</Text>
      </Card>

      {/* Set up: QR + code */}
      <Modal visible={!!setup} animationType="slide" onRequestClose={() => setSetup(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }}>
          <Text style={sx.mTitle}>{_t("Set up two-step login")}</Text>
          <Text style={sx.mSub}>{_t("1. Install Google Authenticator or Microsoft Authenticator.\n2. Add an account and scan this code.")}</Text>
          {setup && (
            <Card>
              <View style={{ alignItems: "center", paddingVertical: 8 }}><QRCode value={setup.uri} size={190} /></View>
              <Text style={sx.hint}>{_t("Setting up on this same phone? Choose \"Enter a setup key\" and type:")}</Text>
              <Text selectable style={sx.key}>{_tx(setup.secret)}</Text>
            </Card>
          )}
          <Field label={_t("3. Enter the 6-digit code it shows")} keyboardType="number-pad" maxLength={7} value={code} onChangeText={setCode} style={sx.codeInput} placeholder="123456" />
          <Btn title={_t("Turn on")} icon="check" busy={busy} onPress={confirmSetup} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setSetup(null)} />
        </ScrollView>
      </Modal>

      {/* Backup codes */}
      <Modal visible={!!codes} animationType="slide" onRequestClose={() => setCodes(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }}>
          <Text style={sx.mTitle}>{_t("Your backup codes")}</Text>
          <Text style={sx.mSub}>{_t("Save them somewhere safe. Each works once if you lose your phone. Older backup codes no longer work.")}</Text>
          {codes && <Card><BackupCodes codes={codes} /></Card>}
          <Btn title={_t("Share / save codes")} kind="ghost" icon="share-2"
            onPress={() => Share.share({ message: _t("ManageMyAcademy backup codes for {ssmsUserName}:\n\n{v}", { ssmsUserName: user.ssmsUserName, v: (codes ?? []).join("\n") }) })} />
          <Btn title={_t("Done")} icon="check" onPress={() => setCodes(null)} />
        </ScrollView>
      </Modal>

      {/* Ask for a code */}
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => setAsk(null)}>
        <View style={sx.overlay}>
          <View style={sx.sheet}>
            <Text style={sx.mTitle}>{_tx(ask?.title)}</Text>
            <Text style={sx.mSub}>{_t("Enter the code from your authenticator app (or a backup code) to confirm.")}</Text>
            <Field value={code} onChangeText={setCode} autoFocus autoCapitalize="characters" maxLength={9} style={sx.codeInput} placeholder="123456" />
            <Btn title={_t("Confirm")} busy={busy} onPress={() => run(async () => { await ask.action(code.trim()); setAsk(null); })} />
            <Btn title={_t("Cancel")} kind="ghost" onPress={() => setAsk(null)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusTxt: { fontSize: 18, fontWeight: "800", color: C.ink },
  req: { marginLeft: "auto", fontSize: 11, fontWeight: "800", color: C.warn, backgroundColor: "#fef3c7", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  hint: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  mTitle: { fontSize: 20, fontWeight: "800", color: C.ink, marginBottom: 6 },
  mSub: { fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 19 },
  key: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 16, fontWeight: "700", color: C.ink, textAlign: "center", marginTop: 6 },
  codeInput: { fontSize: 22, letterSpacing: 5, textAlign: "center", fontWeight: "700" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
});
