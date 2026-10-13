/**
 * Settings › Roles & permissions › one role
 * Grid of modules × View / Edit / Delete / Approve / Export. Tap a square to switch it.
 * Grey squares don't apply. Saving shows what changes; money, users, settings and privacy
 * changes ask for the two-step code again. Custom roles: add / remove people, delete the role.
 */
import React, { useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, ActivityIndicator, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import { getRole, saveRole, removeRole, getRolePeople, assignRole, ROLE_LABEL } from "../../services/SecurityApi";
import { C, Card, Btn, Field, Toggle } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const KIND_LABEL = { view: "View", edit: "Edit", delete: "Del.", approve: "Appr.", export: "Exp." };
const SENSITIVE = ["fees", "finance", "users", "settings", "privacy"];
const STAFFISH = ["user", "teacher", "staff"];

export default function RoleEditScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const { roleKey, name: initialName, baseRole, canManage } = route.params ?? {};
  const isNew = roleKey === "new";
  const [role, setRole]   = useState(null);
  const [grid, setGrid]   = useState(null);
  const [name, setName]   = useState(initialName ?? "");
  const [own, setOwn]     = useState(false);
  const [confirm, setConfirm] = useState(null);   // { changes, sensitive }
  const [code, setCode]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [people, setPeople] = useState(null);
  const [picker, setPicker] = useState(false);

  const load = async () => {
    try {
      const r = await getRole(user, isNew ? baseRole : roleKey);
      setRole(r); setGrid(JSON.parse(JSON.stringify(r.grid))); setOwn(!!r.own_classes_only);
      if (!isNew) setName(r.name);
    } catch (e) { Alert.alert(_t("Role"), _tx(e.message)); navigation.goBack(); }
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { navigation.setOptions({ title: isNew ? _t("New role") : (initialName || _t("Role")) }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const editable = canManage && role && (role.editable || isNew);
  const isCustom = !isNew && String(roleKey).startsWith("custom:");
  const base = isNew ? baseRole : role?.base_role;

  const diff = useMemo(() => {
    if (!role || !grid) return [];
    const out = [];
    Object.keys(role.modules).forEach((m) => role.kinds.forEach((k) => {
      if (!!grid[m]?.[k] !== !!role.grid[m]?.[k]) out.push({ m, k, on: !!grid[m]?.[k] });
    }));
    return out;
  }, [role, grid]);

  if (!role || !grid) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;

  const na = (m, k) => (role.not_applicable?.[m] ?? []).includes(k);
  const flip = (m, k) => {
    if (!editable || na(m, k)) return;
    const g = { ...grid, [m]: { ...grid[m], [k]: !grid[m][k] } };
    if (k === "view" && !g[m].view) role.kinds.forEach((x) => { g[m][x] = false; });     // no view → nothing else
    if (k !== "view" && g[m][k]) g[m].view = true;                                       // anything else needs view
    setGrid(g);
  };

  const askSave = () => {
    if (isNew && !name.trim()) { Alert.alert(_t("Role"), _t("Give the role a name.")); return; }
    const sensitive = isNew || diff.some((d) => SENSITIVE.includes(d.m));
    if (!isNew && !diff.length && own === !!role.own_classes_only && (!isCustom || name === role.name)) { navigation.goBack(); return; }
    setCode(""); setConfirm({ changes: diff, sensitive });
  };

  const doSave = async () => {
    setBusy(true);
    try {
      const r = await saveRole(user, { key: isNew ? "new" : roleKey, name: name.trim(), base_role: base, own_classes_only: own ? 1 : 0, grid, code: code.trim() });
      setConfirm(null);
      Alert.alert(_t("Role saved"), r.changes?.length ? _t("{length} change{pl} saved. They apply within a minute.", { length: r.changes.length, pl: r.changes.length === 1 ? "" : "s" }) : _t("Saved."));
      navigation.goBack();
    } catch (e) { Alert.alert(_t("Role"), _tx(e.message)); } finally { setBusy(false); }
  };

  const doRemove = () => Alert.alert(isCustom ? _t("Delete role") : _t("Reset to defaults"),
    isCustom ? _t("People in this role go back to their built-in role and are signed out.") : _t("This role goes back to how the app works by default."), [
      { text: _t("Cancel"), style: "cancel" },
      { text: isCustom ? _t("Delete") : _t("Reset"), style: "destructive", onPress: () => { setCode(""); setConfirm({ remove: true, sensitive: true, changes: [] }); } },
    ]);

  const finishRemove = async () => {
    setBusy(true);
    try { await removeRole(user, roleKey, code.trim()); setConfirm(null); navigation.goBack(); }
    catch (e) { Alert.alert(_t("Role"), _tx(e.message)); } finally { setBusy(false); }
  };

  const openPicker = async () => {
    try { setPeople(await getRolePeople(user)); setPicker(true); } catch (e) { Alert.alert(_t("People"), _tx(e.message)); }
  };
  const assign = async (username, key) => {
    setBusy(true);
    try { await assignRole(user, username, key); setPicker(false); await load(); }
    catch (e) { Alert.alert(_t("Role"), _tx(e.message)); } finally { setBusy(false); }
  };

  const modules = Object.keys(role.modules);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {(isNew || isCustom) && (
          <Card>
            <Field label={_t("Role name")} value={name} onChangeText={setName} editable={!!editable} />
            <Text style={sx.meta}>{_t("Based on {v}. People in this role must have that built-in role.", { v: ROLE_LABEL[base] ?? base })}</Text>
          </Card>
        )}
        {!editable && <Text style={sx.note}>{role.base_role === "owner" && !isCustom ? _t("The Owner role always has full access.") : _t("You can look but not change roles.")}</Text>}

        <Card>
          <View style={sx.headRow}>
            <Text style={[sx.hcell, { flex: 1, textAlign: "left" }]}>{_t("Module")}</Text>
            {role.kinds.map((k) => <Text key={k} style={sx.hcell}>{_tx(KIND_LABEL[k])}</Text>)}
          </View>
          {modules.map((m) => (
            <View key={m} style={sx.mRow}>
              <Text style={sx.mName} numberOfLines={2}>{_tx(role.modules[m])}{SENSITIVE.includes(m) ? " •" : ""}</Text>
              {role.kinds.map((k) => {
                const off = na(m, k);
                const on = !!grid[m]?.[k];
                return (
                  <TouchableOpacity key={k} style={sx.cell} onPress={() => flip(m, k)} disabled={!editable || off} hitSlop={4}>
                    <View style={[sx.sq, off ? sx.sqNa : on ? sx.sqOn : null]}>{on && !off && <Feather name="check" size={12} color="#fff" />}</View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <Text style={sx.meta}>{_t("• users, settings and privacy are always checked; once a role is edited every module is. Changes to money, users, settings or privacy need your two-step code. Grey = doesn't apply.")}</Text>
        </Card>

        {STAFFISH.includes(base) && (
          <Card><Toggle label={_t("Own classes only")} value={own} onChange={(v) => editable && setOwn(v)}
            hint={_t("Teachers see students, attendance and leave only for the classes they teach.")} /></Card>
        )}

        {isCustom && (
          <Card title={_t("People ({v})", { v: role.members?.length ?? 0 })} right={canManage ? <TouchableOpacity onPress={openPicker}><Text style={sx.link}>{_t("+ Add")}</Text></TouchableOpacity> : null}>
            {(role.members ?? []).map((p) => (
              <View key={p.ssms_user_name} style={sx.pRow}>
                <Text style={sx.pName}>{`${p.ssms_user_firstname ?? ""} ${p.ssms_user_lastname ?? ""}`.trim() || _tx(p.ssms_user_name)}</Text>
                {canManage && <TouchableOpacity onPress={() => assign(p.ssms_user_name, null)}><Text style={[sx.link, { color: C.err }]}>{_t("Remove")}</Text></TouchableOpacity>}
              </View>
            ))}
            {!role.members?.length && <Text style={sx.meta}>{_t("Nobody yet. Add people whose built-in role is {v}.", { v: ROLE_LABEL[base] ?? base })}</Text>}
          </Card>
        )}

        {canManage && !isNew && (isCustom || role.editable) && (isCustom || role.system) && (
          <Btn title={isCustom ? _t("Delete this role") : _t("Reset to defaults")} kind="danger" icon={isCustom ? "trash-2" : "rotate-ccw"} onPress={doRemove} />
        )}
      </ScrollView>

      {editable && (
        <View style={[sx.bar, { paddingBottom: 12 + Math.max(insets.bottom, 8) }]}>
          <Btn title={isNew ? _t("Create role") : _t("Save{v}", { v: diff.length ? ` (${diff.length})` : "" })} icon="save" onPress={askSave} style={{ flex: 1, marginTop: 0 }} />
        </View>
      )}

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={sx.overlay}><View style={sx.sheet}>
          <Text style={sx.mTitle}>{confirm?.remove ? (isCustom ? _t("Delete role") : _t("Reset role")) : _t("Confirm changes")}</Text>
          {!confirm?.remove && (
            <ScrollView style={{ maxHeight: 220 }}>
              {(confirm?.changes ?? []).map((d) => (
                <View key={`${d.m}${d.k}`} style={sx.cRow}>
                  <View style={[sx.cIc, { backgroundColor: d.on ? C.ok : C.err }]}><Text style={sx.cIcTxt}>{d.on ? "+" : "−"}</Text></View>
                  <Text style={sx.cTxt}>{_tx(role.modules[d.m])} · {_tx(d.k)}</Text>
                </View>
              ))}
              {!confirm?.changes?.length && <Text style={sx.meta}>{isNew ? _t("New role \"{name}\" with the access shown.", { name }) : _t("Name or class setting changed.")}</Text>}
              {(confirm?.changes ?? []).some((d) => d.on && ["fees", "finance"].includes(d.m)) && (
                <Text style={sx.warnTxt}>{_t("Money access is sensitive – give it only to people who handle money.")}</Text>
              )}
            </ScrollView>
          )}
          {confirm?.sensitive && user?.mfaEnabled && (
            <Field label={_t("Your two-step code")} value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={9} placeholder="123456" style={sx.code} />
          )}
          <Btn title={confirm?.remove ? _t("Confirm") : _t("Save")} busy={busy} onPress={confirm?.remove ? finishRemove : doSave} />
          <Btn title={_t("Back")} kind="ghost" onPress={() => setConfirm(null)} />
        </View></View>
      </Modal>

      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <View style={sx.overlay}><View style={[sx.sheet, { maxHeight: "75%" }]}>
          <Text style={sx.mTitle}>{_t("Add to {name}", { name })}</Text>
          <ScrollView>
            {(people ?? []).filter((p) => {
              const r = (p.ssms_user_role || "").toLowerCase();
              return (r === base || (STAFFISH.includes(r) && STAFFISH.includes(base))) && String(p.custom_role_id ?? "") !== String(roleKey).slice(7);
            }).map((p) => (
              <TouchableOpacity key={p.ssms_user_name} style={sx.pRow} onPress={() => assign(p.ssms_user_name, roleKey)}>
                <Text style={sx.pName}>{`${p.ssms_user_firstname ?? ""} ${p.ssms_user_lastname ?? ""}`.trim() || _tx(p.ssms_user_name)}</Text>
                <Text style={sx.meta}>{p.custom_role_id ? _t("in another role") : _tx(ROLE_LABEL[(p.ssms_user_role || "").toLowerCase()])}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={sx.meta}>{_t("They are signed out once, so their menus refresh.")}</Text>
          <Btn title={_t("Close")} kind="ghost" onPress={() => setPicker(false)} />
        </View></View>
      </Modal>
    </View>
  );
}

const sx = StyleSheet.create({
  meta: { fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 17 },
  note: { fontSize: 12, color: C.warn, fontWeight: "600", marginBottom: 8 },
  headRow: { flexDirection: "row", alignItems: "center", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  hcell: { width: 42, textAlign: "center", fontSize: 10, fontWeight: "800", color: C.muted },
  mRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  mName: { flex: 1, fontSize: 12.5, fontWeight: "600", color: C.ink, paddingRight: 4 },
  cell: { width: 42, alignItems: "center" },
  sq: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  sqOn: { backgroundColor: C.brand, borderColor: C.brand },
  sqNa: { backgroundColor: "#e2e8f0", borderColor: "#e2e8f0" },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  pRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  pName: { fontSize: 14, fontWeight: "600", color: C.ink },
  bar: { flexDirection: "row", padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
  mTitle: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 8 },
  cRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  cIc: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  cIcTxt: { color: "#fff", fontWeight: "900", fontSize: 12 },
  cTxt: { fontSize: 13, color: C.ink },
  warnTxt: { fontSize: 12, color: "#92400e", backgroundColor: "#fef3c7", borderRadius: 8, padding: 8, marginTop: 8 },
  code: { fontSize: 20, letterSpacing: 4, textAlign: "center", fontWeight: "700" },
});
