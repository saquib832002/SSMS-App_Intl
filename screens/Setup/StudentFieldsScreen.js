/**
 * Setup › Student fields – extra fields this school keeps for every student
 * (e.g. House, Bus pass number, Previous school ID). They appear in each student's
 * record under "More". Hiding a field keeps the answers already given.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, RefreshControl, Platform, KeyboardAvoidingView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Field, Toggle, Empty, Picker } from "../../components/ReportCardUI";
import { getFieldDefs, saveFieldDef, FIELD_TYPE_LABEL } from "../../services/StudentRecordApi";
import { _t, _tx } from "../../services/i18n";

export default function StudentFieldsScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getFieldDefs(user, true)); setErr(null); }
    catch (e) { setErr(e.message); setData((d) => d ?? { fields: [], types: [] }); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const fields = Array.isArray(data?.fields) ? data.fields : [];
  const canManage = !!data?.can_manage;
  const types = (Array.isArray(data?.types) && data.types.length ? data.types : Object.keys(FIELD_TYPE_LABEL))
    .map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] ?? t }));

  const save = async (patch = {}) => {
    const f = { ...edit, ...patch };
    if (Array.isArray(f.options)) f.options = f.options.join("\n");
    setBusy(true);
    try {
      const r = await saveFieldDef(user, f);
      setData({ ...data, fields: Array.isArray(r.fields) ? r.fields : fields });
      setEdit(null);
    } catch (e) { Alert.alert(_t("Student field"), _tx(e.message)); } finally { setBusy(false); }
  };
  const toggleActive = async (f) => {
    try {
      const r = await saveFieldDef(user, { ...f, options: (f.options ?? []).join("\n"), active: !f.active });
      setData({ ...data, fields: Array.isArray(r.fields) ? r.fields : fields });
    } catch (e) { Alert.alert(_t("Student field"), _tx(e.message)); }
  };

  if (!data) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
      <Card title={_t("Extra student fields")} right={canManage ? <TouchableOpacity onPress={() => setEdit({ label: "", field_type: "text", options: "", active: true })}><Text style={s.link}>{_t("+ Add")}</Text></TouchableOpacity> : null}>
        {!fields.length && <Text style={s.meta}>{_t("No extra fields yet. Add things your school records that aren't on the admission form, for example House, Bus pass number or Previous school ID.")}</Text>}
        {fields.map((f) => (
          <TouchableOpacity key={f.id} style={s.row} disabled={!canManage} onPress={() => setEdit({ ...f, options: (f.options ?? []).join("\n") })}>
            <View style={{ flex: 1 }}>
              <Text style={[s.name, !f.active && { color: C.muted }]}>{_tx(f.label)}{f.required ? " *" : ""}</Text>
              <Text style={s.meta}>{_tx(FIELD_TYPE_LABEL[f.field_type]) ?? _tx(f.field_type)}
                {f.visible_to_parent ? (f.parent_can_edit ? (" " + _t("· parents can edit") + "") : (" " + _t("· parents can see") + "")) : (" " + _t("· staff only") + "")}
                {!f.active ? (" " + _t("· hidden") + "") : ""}</Text>
            </View>
            {canManage && (
              <TouchableOpacity onPress={() => toggleActive(f)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name={f.active ? "eye" : "eye-off"} size={18} color={f.active ? C.brand : C.muted} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}
      </Card>
      <Text style={s.meta}>{_t("Fields appear in each student's record under \"More\". Hiding a field keeps the answers already given. {v}", { v: canManage ? "" : _t("Only someone who can change school settings can add or edit fields.") })}</Text>

      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[s.sheetHead, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
            <Text style={s.sheetTitle}>{edit?.id ? _t("Edit field") : _t("New field")}</Text>
            <TouchableOpacity onPress={() => setEdit(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
            <Field label={_t("Name")} placeholder={_t("e.g. House")} value={edit?.label ?? ""} onChangeText={(v) => setEdit({ ...edit, label: v })} />
            <Picker label={_t("Type")} value={edit?.field_type} options={types} onChange={(v) => setEdit({ ...edit, field_type: v })} />
            {edit?.field_type === "select" && (
              <Field label={_t("Choices (one per line)")} value={edit?.options ?? ""} onChangeText={(v) => setEdit({ ...edit, options: v })} multiline
                style={{ minHeight: 100, textAlignVertical: "top" }} placeholder={_t("Red\nBlue\nGreen\nYellow")} />
            )}
            <Field label={_t("Help text (optional)")} value={edit?.help_text ?? ""} onChangeText={(v) => setEdit({ ...edit, help_text: v })} />
            <Toggle label={_t("Required")} value={!!edit?.required} onChange={(v) => setEdit({ ...edit, required: v })}
              hint={_t("Staff must fill it in when they save a student's extra details.")} />
            <Toggle label={_t("Parents can see it")} value={!!edit?.visible_to_parent} onChange={(v) => setEdit({ ...edit, visible_to_parent: v, parent_can_edit: v ? edit?.parent_can_edit : false })} />
            {!!edit?.visible_to_parent && (
              <Toggle label={_t("Parents can fill it in")} value={!!edit?.parent_can_edit} onChange={(v) => setEdit({ ...edit, parent_can_edit: v })} />
            )}
            <Field label={_t("Order")} keyboardType="number-pad" value={String(edit?.sort_order ?? "")} onChangeText={(v) => setEdit({ ...edit, sort_order: v.replace(/\D/g, "") })} />
            {!!edit?.id && <Toggle label={_t("Show this field")} value={edit?.active !== false} onChange={(v) => setEdit({ ...edit, active: v })} />}
            <Btn title={_t("Save")} busy={busy} onPress={() => save()} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 10 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: C.ink },
});
