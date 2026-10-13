/**
 * Settings › School security (owner edits; admins can look)
 * Who must use two-step login, grace period, audit-log retention, COPPA, consents on/off,
 * role-permission checks on/off, how long records are kept after someone leaves,
 * and a staff list with two-step status (owner can reset; admins can send a set-password link).
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, Modal, TouchableOpacity, ActivityIndicator, Share } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getSecuritySettings, saveSecuritySettings, getSecurityPeople, resetMfaFor, sendSetPasswordLink, ROLE_LABEL,
} from "../../services/SecurityApi";
import { C, Card, Btn, Field, Toggle } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const MFA_ROLES = ["admin", "principal", "accountant", "user", "staff"];
const RET = [
  { key: "fees", get label() { return _t("Fee receipts & payments"); } },
  { key: "payroll", get label() { return _t("Payslips & salary"); } },
  { key: "academic", get label() { return _t("Marks & report cards"); } },
  { key: "attendance", get label() { return _t("Attendance"); } },
];

export default function SecuritySettingsScreen() {
  const { user } = useContext(AuthContext);
  const [s, setS]         = useState(null);
  const [people, setPeople] = useState([]);
  const [busy, setBusy]   = useState(false);
  const [ask, setAsk]     = useState(null);
  const [code, setCode]   = useState("");

  const load = useCallback(async () => {
    try {
      const x = await getSecuritySettings(user);
      setS({ ...x, mfa_grace_days: String(x.mfa_grace_days), audit_retention_years: String(x.audit_retention_years),
             retention: Object.fromEntries(Object.entries(x.retention ?? {}).map(([k, v]) => [k, String(v)])) });
      setPeople(await getSecurityPeople(user));
    } catch (e) { Alert.alert(_t("Security"), _tx(e.message)); setS({}); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  if (!s) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  const edit = !!s.can_edit;
  const toggleRole = (r) => {
    if (!edit) return;
    const set = new Set(s.mfa_roles ?? []);
    set.has(r) ? set.delete(r) : set.add(r);
    setS({ ...s, mfa_roles: [...set] });
  };

  const doSave = async (c) => {
    setBusy(true);
    try {
      await saveSecuritySettings(user, {
        mfa_roles: s.mfa_roles, mfa_grace_days: Number(s.mfa_grace_days) || 0, audit_retention_years: Number(s.audit_retention_years) || 2,
        coppa_mode: s.coppa_mode, consent_enabled: s.consent_enabled, permissions_enforced: s.permissions_enforced,
        retention: Object.fromEntries(Object.entries(s.retention ?? {}).map(([k, v]) => [k, Number(v) || 0])), code: c,
      });
      setAsk(null);
      await load();
      Alert.alert(_t("Security"), _t("Saved."));
    } catch (e) {
      if (/code/i.test(e.message) && !c) { setCode(""); setAsk({ action: doSave }); }
      else Alert.alert(_t("Security"), _tx(e.message));
    } finally { setBusy(false); }
  };

  const reset = (p) => Alert.alert(_t("Reset two-step login"), _t("{name} will have to set up two-step login again at their next sign-in, and is signed out everywhere now.", { name: p.name }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Reset"), style: "destructive", onPress: () => { setCode(""); setAsk({ action: async (c) => { await resetMfaFor(user, p.username, c); setAsk(null); await load(); Alert.alert(_t("Done"), _t("Two-step login reset for {name}.", { name: p.name })); } }); } },
  ]);

  const link = async (p) => {
    try {
      const r = await sendSetPasswordLink(user, p.username);
      Alert.alert(_t("Set-password link"), r.emailed ? _t("E-mailed to {email}. It works once, for 48 hours.", { email: r.email }) : _t("No e-mail on this account – share the link yourself."), [
        { text: _t("OK") },
        { text: _t("Share link"), onPress: () => Share.share({ message: _t("Set your ManageMyAcademy password (works once, 48 hours):\n{link}", { link: r.link }) }) },
      ]);
    } catch (e) { Alert.alert(_t("Set-password link"), _tx(e.message)); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {!edit && <Text style={sx.note}>{_t("Only the school owner can change these settings.")}</Text>}

      <Card title={_t("Two-step login")}>
        <Text style={sx.label}>{_t("Required for")}</Text>
        <View style={sx.chips}>
          <View style={[sx.chip, sx.chipOn, { opacity: 0.7 }]}><Text style={[sx.chipTxt, { color: C.brand }]}>{_t("Owner (always)")}</Text></View>
          {MFA_ROLES.map((r) => {
            const on = (s.mfa_roles ?? []).includes(r);
            return (
              <TouchableOpacity key={r} onPress={() => toggleRole(r)} style={[sx.chip, on && sx.chipOn]} disabled={!edit}>
                <Text style={[sx.chipTxt, on && { color: C.brand }]}>{_tx(ROLE_LABEL[r])}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Field label={_t("Days to set it up after it becomes required")} keyboardType="number-pad" value={s.mfa_grace_days} editable={edit}
          onChangeText={(v) => setS({ ...s, mfa_grace_days: v.replace(/\D/g, "") })} />
        {!!s.mfa_required_since && <Text style={sx.hint}>{_t("Required since {mfa_required_since}.", { mfa_required_since: s.mfa_required_since })}</Text>}
      </Card>

      <Card title={_t("Privacy")}>
        <Toggle label={_t("Ask parents and staff for consent")} value={!!s.consent_enabled} onChange={(v) => edit && setS({ ...s, consent_enabled: v })}
          hint={_t("Shown once after sign-in, and again when you change the wording (Settings › Consents).")} />
        <Text style={sx.label}>{_t("Children under 13 (COPPA)")}</Text>
        <View style={sx.chips}>
          {[["parent", "Parent consents"], ["school", "School consents for education use"]].map(([k, l]) => (
            <TouchableOpacity key={k} onPress={() => edit && setS({ ...s, coppa_mode: k })} style={[sx.chip, s.coppa_mode === k && sx.chipOn]}>
              <Text style={[sx.chipTxt, s.coppa_mode === k && { color: C.brand }]}>{_tx(l)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={sx.hint}>{_t("With \"Parent consents\", a student login under 13 stays off until a parent accepts the terms in the app.")}</Text>
        <Field label={_t("Keep the audit log for (years, 1–7)")} keyboardType="number-pad" value={s.audit_retention_years} editable={edit}
          onChangeText={(v) => setS({ ...s, audit_retention_years: v.replace(/\D/g, "") })} />
      </Card>

      <Card title={_t("Records kept after someone leaves")}>
        <Text style={sx.hint}>{_t("When a deletion is approved, these stay (with the name removed) for this many years, because the law or the school needs them.")}</Text>
        {RET.map((r) => (
          <View key={r.key} style={sx.retRow}>
            <Text style={sx.retLbl}>{_tx(r.label)}</Text>
            <Field value={s.retention?.[r.key] ?? ""} keyboardType="number-pad" editable={edit} style={sx.retInput}
              onChangeText={(v) => setS({ ...s, retention: { ...s.retention, [r.key]: v.replace(/\D/g, "") } })} />
            <Text style={sx.retUnit}>{_t("yrs")}</Text>
          </View>
        ))}
      </Card>

      <Card title={_t("Roles & permissions")}>
        <Toggle label={_t("Check role permissions on the server")} value={!!s.permissions_enforced} onChange={(v) => edit && setS({ ...s, permissions_enforced: v })}
          hint={_t("Keep this on. Turn it off only if a role change stops people doing their normal work, then fix the role.")} />
      </Card>

      {edit && <Btn title={_t("Save settings")} icon="save" busy={busy} onPress={() => doSave("")} />}

      <Card title={_t("Staff two-step status")} style={{ marginTop: 12 }}>
        {people.map((p) => (
          <View key={p.username} style={sx.person}>
            <View style={{ flex: 1 }}>
              <Text style={sx.pName}>{_tx(p.name)}</Text>
              <Text style={sx.hint}>{_tx(ROLE_LABEL[(p.role || "").toLowerCase()]) ?? _tx(p.role)} · {p.mfa_enabled ? _t("two-step on") : p.mfa_required ? _t("needed by {deadline}", { deadline: p.deadline }) : _t("two-step off")}</Text>
            </View>
            <View style={[sx.pill, { backgroundColor: p.mfa_enabled ? "#dcfce7" : p.mfa_required ? "#fef3c7" : "#f1f5f9" }]}>
              <Feather name={p.mfa_enabled ? "shield" : "shield-off"} size={13} color={p.mfa_enabled ? C.ok : p.mfa_required ? C.warn : C.muted} />
            </View>
            <TouchableOpacity onPress={() => Alert.alert(_tx(p.name), "", [
              { text: _t("Send set-password link"), onPress: () => link(p) },
              ...(edit && p.mfa_enabled && p.username !== user.ssmsUserName ? [{ text: _t("Reset two-step login"), style: "destructive", onPress: () => reset(p) }] : []),
              { text: _t("Close"), style: "cancel" },
            ])} hitSlop={8}>
              <Feather name="more-vertical" size={18} color={C.muted} />
            </TouchableOpacity>
          </View>
        ))}
      </Card>

      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => setAsk(null)}>
        <View style={sx.overlay}><View style={sx.sheet}>
          <Text style={sx.mTitle}>{_t("Confirm with your code")}</Text>
          <Text style={sx.hint}>{_t("Enter the code from your authenticator app (or a backup code).")}</Text>
          <Field value={code} onChangeText={setCode} autoFocus autoCapitalize="characters" maxLength={9} style={sx.codeInput} placeholder="123456" />
          <Btn title={_t("Confirm")} busy={busy} onPress={async () => { setBusy(true); try { await ask.action(code.trim()); } catch (e) { Alert.alert(_t("Security"), _tx(e.message)); } finally { setBusy(false); } }} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setAsk(null)} />
        </View></View>
      </Modal>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  note: { fontSize: 12, color: C.warn, marginBottom: 10, fontWeight: "600" },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginTop: 6, marginBottom: 6 },
  hint: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  retRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  retLbl: { flex: 1, fontSize: 13, color: C.ink },
  retInput: { width: 60, textAlign: "center", marginBottom: 6 },
  retUnit: { fontSize: 12, color: C.muted, width: 24 },
  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  pName: { fontSize: 14, fontWeight: "700", color: C.ink },
  pill: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
  mTitle: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 4 },
  codeInput: { fontSize: 22, letterSpacing: 5, textAlign: "center", fontWeight: "700", marginTop: 10 },
});
