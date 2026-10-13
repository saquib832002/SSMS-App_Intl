/**
 * Settings › Roles & permissions – list of built-in and custom roles.
 * Owner (or someone given "Users & roles · approve") can edit; admin and principal can look.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator, Modal } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getRoles, ROLE_LABEL } from "../../services/SecurityApi";
import { C, Card, Btn, Field } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const BASES = ["staff", "user", "accountant", "principal", "admin"];

export default function RolesScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [newRole, setNewRole] = useState(null);   // { name, base_role }

  const load = useCallback(async () => {
    try { setData(await getRoles(user)); } catch (e) { Alert.alert(_t("Roles"), _tx(e.message)); setData({ roles: [] }); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {!data.enforced && (
        <View style={sx.warn}><Feather name="alert-triangle" size={14} color="#92400e" />
          <Text style={sx.warnTxt}>{_t("Permission checks are turned off in Security settings, so changes here are not applied yet.")}</Text></View>
      )}
      <Card>
        {data.roles.map((r) => (
          <TouchableOpacity key={r.key} style={sx.row} disabled={r.portal}
            onPress={() => navigation.navigate("RoleEdit", { roleKey: r.key, name: r.name, canManage: data.can_manage })}>
            <View style={{ flex: 1 }}>
              <Text style={sx.name}>
                {_tx(r.name)}
                {!r.system && <Text style={sx.custom}>{" "}{_t("Custom")}</Text>}
                {r.edited && <Text style={sx.edited}>{" "}{_t("Edited")}</Text>}
              </Text>
              <Text style={sx.meta}>
                {r.portal ? _t("Portal roles · set by the app") : r.key === "owner" ? _t("Full access · can't be changed")
                  : `${_tx(r.members)} ${r.members === 1 ? "person" : "people"}${!r.system ? ` ${_t("· based on {v}", { v: ROLE_LABEL[r.base_role] ?? r.base_role })}` : ""}${r.own_classes_only ? (" " + _t("· own classes only") + "") : ""}`}
              </Text>
            </View>
            {r.key === "owner" ? <Text style={sx.fixed}>{_t("Fixed")}</Text> : !r.portal && <Feather name="chevron-right" size={18} color="#cbd5e1" />}
          </TouchableOpacity>
        ))}
      </Card>
      {data.can_manage && <Btn title={_t("New role (copy an existing one)")} kind="ghost" icon="plus" onPress={() => setNewRole({ name: "", base_role: "staff" })} />}
      <Text style={sx.foot}>{_t("A custom role starts as a copy of a built-in role and changes what its people can see and do. Users, settings and privacy are always checked; everything else (including fees and finance) is checked once you edit or customise a role.")}</Text>

      <Modal visible={!!newRole} transparent animationType="fade" onRequestClose={() => setNewRole(null)}>
        <View style={sx.overlay}><View style={sx.sheet}>
          <Text style={sx.mTitle}>{_t("New role")}</Text>
          <Field label={_t("Name")} placeholder={_t("e.g. Front office")} value={newRole?.name ?? ""} onChangeText={(v) => setNewRole({ ...newRole, name: v })} />
          <Text style={sx.label}>{_t("Start from")}</Text>
          <View style={sx.chips}>
            {BASES.map((b) => (
              <TouchableOpacity key={b} onPress={() => setNewRole({ ...newRole, base_role: b })} style={[sx.chip, newRole?.base_role === b && sx.chipOn]}>
                <Text style={[sx.chipTxt, newRole?.base_role === b && { color: C.brand }]}>{_tx(ROLE_LABEL[b])}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Btn title={_t("Continue")} onPress={() => {
            if (!newRole.name.trim()) { Alert.alert(_t("New role"), _t("Give the role a name.")); return; }
            const r = newRole; setNewRole(null);
            navigation.navigate("RoleEdit", { roleKey: "new", name: r.name.trim(), baseRole: r.base_role, canManage: true });
          }} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setNewRole(null)} />
        </View></View>
      </Modal>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 8 },
  name: { fontSize: 15, fontWeight: "800", color: C.ink },
  custom: { fontSize: 11, color: C.brand, fontWeight: "800" },
  edited: { fontSize: 11, color: C.warn, fontWeight: "800" },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  fixed: { fontSize: 11, fontWeight: "800", color: "#475569", backgroundColor: "#f1f5f9", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  foot: { fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 17 },
  warn: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginBottom: 10 },
  warnTxt: { flex: 1, fontSize: 12, color: "#92400e", fontWeight: "600" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
  mTitle: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
});
