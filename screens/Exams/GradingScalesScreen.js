/**
 * Exams › Grading Scales
 * School-defined grading: letter grades, CBSE 9-point, US GPA 4.0, IB 1–7,
 * Cambridge A*–U, standards-based 4–1, or fully custom. Every band is editable.
 * The default scale is used by marksheets, rankings and report cards.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, Modal, TouchableOpacity,
  RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getScales, saveScale, addPresetScale, setDefaultScale, deleteScale,
} from "../../services/ReportCardApi";
import { C, Card, Btn, Field, Toggle, Empty, u } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const blankBand = () => ({ label: "", min_percent: "", gpa_points: "", descriptor: "", is_pass: true });

export default function GradingScalesScreen() {
  const { user } = useContext(AuthContext);
  const role    = String(user?.ssmsUserRole ?? "").toLowerCase();
  const canEdit = role === "owner" || role === "admin";

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState(null);   // scale being edited (copy)

  const load = useCallback(async () => {
    try { setData(await getScales(user)); }
    catch (e) { Alert.alert(_t("Grading scales"), _tx(e.message)); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); await load(); }
    catch (e) { Alert.alert(_t("Grading scales"), _tx(e.message)); }
    finally { setBusy(null); }
  };

  const onPreset = (p) => run("preset-" + p.key, async () => {
    const isFirst = !(data?.scales?.length);
    await addPresetScale(user, p.key, isFirst);
    setAdding(false);
  });

  const onDelete = (s) => Alert.alert(_t("Delete scale"), _t("Delete \"{name}\"?", { name: s.name }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Delete"), style: "destructive", onPress: () => run("del-" + s.id, () => deleteScale(user, s.id)) },
  ]);

  const openEditor = (s) => setEditing({
    id: s?.id ?? null,
    name: s?.name ?? "",
    scale_type: s?.scale_type ?? "custom",
    show_gpa: !!s?.show_gpa,
    is_default: !!s?.is_default,
    bands: (s?.bands?.length ? s.bands : [blankBand(), blankBand()]).map((b) => ({
      label: String(b.label ?? ""), min_percent: b.min_percent === "" ? "" : String(b.min_percent ?? ""),
      gpa_points: b.gpa_points === null || b.gpa_points === undefined ? "" : String(b.gpa_points),
      descriptor: b.descriptor ?? "", is_pass: b.is_pass !== false,
    })),
  });

  const onSave = () => run("save", async () => {
    await saveScale(user, editing);
    setEditing(null);
  });

  if (loading) return <View style={st.center}><ActivityIndicator color={C.brand} size="large" /></View>;

  const scales = Array.isArray(data?.scales) ? data.scales : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Text style={st.intro}>{_t("Choose how marks turn into grades. The default scale is used on marksheets, rankings and report cards.{v}", { v: scales.length === 0 ? (" " + _t("Until you add one, the built-in A+ to F grades are used.") + "") : "" })}</Text>

        {scales.length === 0 && (
          <Card title={_t("Built-in grades (in use)")}>
            <BandChips bands={data?.builtin?.bands ?? []} />
          </Card>
        )}

        {scales.map((s) => (
          <Card key={s.id} title={_tx(s.name)}
            right={s.is_default ? <Text style={st.badge}>{_t("Default")}</Text> : null}>
            <BandChips bands={s.bands} showGpa={s.show_gpa} />
            {canEdit && (
              <View style={st.row}>
                <Btn title={_t("Edit")} icon="edit-2" kind="ghost" style={st.flex} onPress={() => openEditor(s)} />
                {!s.is_default && (
                  <Btn title={_t("Make default")} icon="star" kind="ghost" style={st.flex} busy={busy === "def-" + s.id}
                    onPress={() => run("def-" + s.id, () => setDefaultScale(user, s.id))} />
                )}
                <Btn title="" icon="trash-2" kind="danger" style={{ width: 48 }} busy={busy === "del-" + s.id}
                  onPress={() => onDelete(s)} />
              </View>
            )}
          </Card>
        ))}

        {canEdit ? (
          <Btn title={_t("Add a grading scale")} icon="plus" onPress={() => setAdding(true)} />
        ) : (
          <Text style={u.hint}>{_t("Only the school owner or an admin can change grading scales.")}</Text>
        )}
      </ScrollView>

      {/* ── Add: presets ── */}
      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)}>
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={st.modalHead}>
            <Text style={st.modalTitle}>{_t("Add a grading scale")}</Text>
            <TouchableOpacity onPress={() => setAdding(false)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={st.intro}>{_t("Start from a common scale – you can change every grade and % afterwards.")}</Text>
            {(Array.isArray(data?.presets) ? data.presets : []).map((p) => (
              <Card key={p.key} title={_tx(p.name)}>
                <Text style={[u.hint, { marginBottom: 8 }]}>{_tx(p.note)}</Text>
                <BandChips bands={p.bands} showGpa={p.show_gpa} />
                <Btn title={_t("Use this scale")} icon="plus" busy={busy === "preset-" + p.key} onPress={() => onPreset(p)} />
              </Card>
            ))}
            <Card title={_t("Custom scale")}>
              <Text style={[u.hint, { marginBottom: 8 }]}>{_t("Make your own grades from scratch.")}</Text>
              <Btn title={_t("Create custom scale")} icon="edit-3" kind="ghost"
                onPress={() => { setAdding(false); openEditor(null); }} />
            </Card>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Editor ── */}
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.modalHead}>
            <Text style={st.modalTitle}>{editing?.id ? _t("Edit grading scale") : _t("New grading scale")}</Text>
            <TouchableOpacity onPress={() => setEditing(null)}><Feather name="x" size={22} color={C.muted} /></TouchableOpacity>
          </View>
          {!!editing && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <Field label={_t("Name")} value={editing.name} placeholder={_t("e.g. Middle school grades")}
                onChangeText={(v) => setEditing((e) => ({ ...e, name: v }))} />
              <Toggle label={_t("Show grade points (GPA)")} value={editing.show_gpa}
                hint={_t("Adds a GPA column and an overall GPA to report cards.")}
                onChange={(v) => setEditing((e) => ({ ...e, show_gpa: v }))} />
              {!editing.id && (
                <Toggle label={_t("Make this the default scale")} value={editing.is_default}
                  onChange={(v) => setEditing((e) => ({ ...e, is_default: v }))} />
              )}
              <Text style={[u.label, { marginTop: 12 }]}>{_t("Grades (highest first)")}</Text>
              <Text style={[u.hint, { marginBottom: 8 }]}>{_t("Each grade applies from its % upwards. The lowest grade always starts at 0%.")}</Text>
              {editing.bands.map((b, i) => {
                const set = (k, v) => setEditing((e) => {
                  const bands = e.bands.slice(); bands[i] = { ...bands[i], [k]: v }; return { ...e, bands };
                });
                return (
                  <View key={i} style={st.band}>
                    <View style={st.row}>
                      <View style={{ width: 80 }}><Field label={_t("Grade")} value={b.label} placeholder={_t("A+")} onChangeText={(v) => set("label", v)} /></View>
                      <View style={{ width: 90 }}><Field label={_t("From %")} value={b.min_percent} placeholder="90" keyboardType="decimal-pad" onChangeText={(v) => set("min_percent", v)} /></View>
                      {editing.show_gpa && (
                        <View style={{ width: 70 }}><Field label={_t("GPA")} value={b.gpa_points} placeholder="4.0" keyboardType="decimal-pad" onChangeText={(v) => set("gpa_points", v)} /></View>
                      )}
                      <TouchableOpacity style={st.remove} onPress={() => setEditing((e) => ({ ...e, bands: e.bands.filter((_, j) => j !== i) }))}>
                        <Feather name="x-circle" size={20} color={C.err} />
                      </TouchableOpacity>
                    </View>
                    <Field value={b.descriptor} placeholder={_t("Description, e.g. Excellent")} onChangeText={(v) => set("descriptor", v)} />
                    <Toggle label={_t("Counts as a pass")} value={b.is_pass} onChange={(v) => set("is_pass", v)} />
                  </View>
                );
              })}
              <Btn title={_t("Add grade")} icon="plus" kind="ghost" onPress={() => setEditing((e) => ({ ...e, bands: [...e.bands, blankBand()] }))} />
              <Btn title={_t("Save scale")} icon="check" busy={busy === "save"} onPress={onSave} style={{ marginTop: 14 }} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function BandChips({ bands, showGpa }) {
  if (!Array.isArray(bands) || !bands.length) return <Empty text={_t("No grades yet.")} />;
  return (
    <View style={st.chips}>
      {bands.map((b, i) => (
        <View key={i} style={[st.chip, b.is_pass === false && { backgroundColor: "#fee2e2" }]}>
          <Text style={[st.chipLabel, b.is_pass === false && { color: C.err }]}>{_tx(b.label)}</Text>
          <Text style={st.chipSub}>
            {Number(b.min_percent)}%+{showGpa && b.gpa_points !== null && b.gpa_points !== undefined ? ` · ${_tx(b.gpa_points)}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 13, color: C.muted, marginBottom: 12, lineHeight: 19 },
  badge: { backgroundColor: "#dcfce7", color: C.ok, fontWeight: "800", fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  chip: { backgroundColor: C.brandSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, alignItems: "center", minWidth: 50 },
  chipLabel: { fontWeight: "800", color: C.brand, fontSize: 13 },
  chipSub: { fontSize: 10, color: C.muted },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
               paddingTop: Platform.OS === "ios" ? 54 : 18, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
  band: { backgroundColor: "#fff", borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: C.line },
  remove: { paddingBottom: 18, paddingLeft: 4 },
});
