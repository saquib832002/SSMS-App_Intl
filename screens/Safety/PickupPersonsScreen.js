/**
 * Office: who may collect one student.
 * Guardians from the student record (only the pick-up details can be changed here: may collect, restriction note,
 * ID, dates) and pick-up-only persons (driver, nanny, one-off person …) with a photo. Approve people a parent added,
 * give a one-off person a pick-up code (shown once).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Image, Platform, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import { C, Card, Btn, Empty, Picker, Field, Toggle } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import { getPersons, savePerson, approvePerson, removePerson, uploadPhoto, takePhoto, photoSource, opts } from "../../services/SafetyApi";
import { fmtDate } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";

const blank = () => ({ id: 0, name: "", relation: "driver", phone: "", id_type: "", id_last4: "", from: "", until: "", can_pickup: true, restriction_note: "", guardian: false, photo: null, new_code: true });

export default function PickupPersonsScreen({ route }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const eid = route?.params?.enrollment_id;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);   // { name, code }

  const load = useCallback(async () => {
    if (!eid) { setErr(_t("Student not found.")); return; }
    try { setData(await getPersons(user, eid)); setErr(null); } catch (e) { setErr(_tx(e.message)); }
  }, [user, eid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const can = data?.can ?? {};
  const o = data?.options ?? {};
  const set = (k, val) => setEdit((x) => ({ ...x, [k]: val }));

  const open = (p) => setEdit(p ? {
    id: p.id, name: p.name, relation: p.relation, phone: p.phone ?? "", id_type: p.id_type ?? "", id_last4: p.id_last4 ?? "", from: p.from ?? "",
    until: p.until ?? "", can_pickup: p.can_pickup, restriction_note: p.restriction_note ?? "", guardian: p.guardian, photo: null, new_code: false, hasPhoto: p.photo, photo_v: p.photo_v,
  } : blank());

  const save = async () => {
    const e = edit;
    if (!e.guardian && e.name.trim().length < 2) { Alert.alert(_t("Pick-up persons"), _t("Enter the person's name.")); return; }
    if (e.from && e.until && e.until < e.from) { Alert.alert(_t("Pick-up persons"), _t("The end date is before the start date.")); return; }
    setBusy(true);
    try {
      const body = { id: e.id || undefined, can_pickup: e.can_pickup ? 1 : 0, restriction_note: e.restriction_note, id_type: e.id_type, id_last4: e.id_last4,
        from: e.from, until: e.until, new_code: e.new_code && !!e.until && data.settings?.temp_code === 1 ? 1 : 0 };
      if (!e.guardian) Object.assign(body, { name: e.name, relation: e.relation, phone: e.phone });
      const r = await savePerson(user, eid, body);
      if (e.photo) {
        try { await uploadPhoto(user, "person", r.person.id, e.photo); } catch (x) { Alert.alert(_t("Photo"), _tx(x.message)); }
      }
      setEdit(null);
      if (r.code) setCode({ name: r.person.name, code: r.code });
      load();
    } catch (x) { Alert.alert(_t("Pick-up persons"), _tx(x.message)); } finally { setBusy(false); }
  };

  const approve = (p, ok) => Alert.alert(ok ? _t("Approve {name}?", { name: p.name }) : _t("Do not approve {name}?", { name: p.name }),
    ok ? _t("Check their ID first. They can then collect the child.") : "", [
      { text: _t("Cancel"), style: "cancel" },
      { text: ok ? _t("Approve") : _t("Do not approve"), style: ok ? "default" : "destructive", onPress: async () => {
        try { await approvePerson(user, p.id, ok); load(); } catch (x) { Alert.alert(_t("Pick-up persons"), _tx(x.message)); }
      } },
    ]);

  const remove = (p) => Alert.alert(_t("Remove {name}?", { name: p.name }), _t("They will no longer be able to collect the child."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      try { await removePerson(user, p.id); setEdit(null); load(); } catch (x) { Alert.alert(_t("Pick-up persons"), _tx(x.message)); }
    } },
  ]);

  const photo = async (camera) => { const ph = await takePhoto({ camera }); if (ph) set("photo", ph); };

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="alert-circle" text={err} /></View>;
  if (!data) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;

  const groups = [
    { key: "pending", title: _t("Waiting for approval"), list: data.persons.filter((p) => p.can_pickup && !p.lookalike && p.status === "pending") },
    { key: "blocked", title: _t("NOT allowed to collect"), list: data.persons.filter((p) => !p.can_pickup || p.lookalike) },
    { key: "allowed", title: _t("May collect"), list: data.persons.filter((p) => p.can_pickup && !p.lookalike && p.status === "approved" && !p.ended) },
    { key: "old", title: _t("Ended or not approved"), list: data.persons.filter((p) => p.can_pickup && !p.lookalike && (p.status === "rejected" || (p.status === "approved" && p.ended))) },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Card>
          <Text style={s.big}>{data.student.name}</Text>
          <Text style={s.meta}>{data.student.class_label}</Text>
          <Text style={[s.meta, { marginTop: 6 }]}>{_t("Guardians come from the student record. Add drivers, nannies and other people who may collect the child here, with a photo.")}</Text>
          {can.edit && <Btn title={_t("Add pick-up person")} icon="user-plus" onPress={() => open(null)} style={{ marginTop: 10 }} />}
        </Card>

        {groups.map((g) => !!g.list.length && (
          <Card key={g.key} title={g.title} style={g.key === "blocked" ? { borderColor: C.err, borderWidth: 2 } : undefined}>
            {g.list.map((p) => (
              <View key={p.id}>
                <TouchableOpacity disabled={!can.edit} onPress={() => open(p)} style={[s.person, g.key === "old" && { opacity: 0.55 }]}>
                  {p.photo ? <Image source={photoSource(user, "person", p.id, undefined, p.photo_v)} style={s.pPhoto} /> : <View style={[s.pPhoto, s.empty]}><Feather name="user" size={22} color="#94a3b8" /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={[s.name, g.key === "blocked" && { color: C.err }]}>{p.name}{p.is_primary ? ` ★` : ""}</Text>
                    <Text style={s.meta}>{_tx(p.relation_label)}{p.phone ? ` · ${p.phone}` : ""}{p.id_last4 ? ` · ${_t("ID …{n}", { n: p.id_last4 })}` : ""}</Text>
                    <Text style={s.meta}>{p.guardian ? _t("Guardian (student record)") : p.added_by === "parent" ? _t("Added by the parent") : _t("Added by the school")}</Text>
                    {(p.from || p.until) && <Text style={[s.meta, { color: C.brand }]}>{_t("Valid {from} – {until}", { from: p.from ? fmtDate(p.from, "dayMonth") : "…", until: p.until ? fmtDate(p.until, "dayMonth") : "…" })}{p.needs_code ? ` · ${_t("needs code")}` : ""}</Text>}
                    {!!p.restriction_note && <Text style={[s.meta, { color: g.key === "blocked" ? C.err : C.warn, fontWeight: "700" }]}>{p.restriction_note}</Text>}
                    {p.lookalike && <Text style={[s.meta, { color: C.err, fontWeight: "700" }]}>{_t("Same name or mobile number as a person who is NOT allowed to collect.")}</Text>}
                  </View>
                  {can.edit && <Feather name="edit-2" size={16} color={C.brand} />}
                </TouchableOpacity>
                {g.key === "pending" && can.approve && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                    <Btn title={_t("Approve")} icon="check" onPress={() => approve(p, true)} style={{ flex: 1 }} />
                    <Btn title={_t("Do not approve")} kind="danger" onPress={() => approve(p, false)} style={{ flex: 1 }} />
                  </View>
                )}
              </View>
            ))}
          </Card>
        ))}
        {!data.persons.length && <Empty icon="users" text={_t("Nobody is on the list yet.")} />}
      </ScrollView>

      <KeyboardSheet visible={!!edit} onClose={() => setEdit(null)}>
            {!!edit && (
              <SheetScroll>
                <Text style={s.big}>{edit.id ? edit.name || _t("Pick-up person") : _t("Add pick-up person")}</Text>
                {edit.guardian && <Text style={s.meta}>{_t("Name, relation and phone are changed in the student record.")}</Text>}

                <View style={{ flexDirection: "row", gap: 12, alignItems: "center", marginVertical: 10 }}>
                  {edit.photo ? <Image source={{ uri: edit.photo.uri }} style={s.bigPhoto} />
                    : edit.hasPhoto ? <Image source={photoSource(user, "person", edit.id, undefined, edit.photo_v)} style={s.bigPhoto} />
                      : <View style={[s.bigPhoto, s.empty]}><Feather name="camera" size={26} color="#94a3b8" /></View>}
                  <View style={{ flex: 1, gap: 8 }}>
                    <Btn title={_t("Take photo")} icon="camera" kind="ghost" onPress={() => photo(true)} />
                    <Btn title={_t("Choose photo")} icon="image" kind="ghost" onPress={() => photo(false)} />
                  </View>
                </View>

                {!edit.guardian && (
                  <>
                    <Field label={_t("Name")} value={edit.name} onChangeText={(t) => set("name", t)} maxLength={150} />
                    <Picker label={_t("Relation")} value={edit.relation} options={opts(o.relations)} onChange={(x) => set("relation", x)} />
                    <Field label={_t("Mobile number")} value={edit.phone} onChangeText={(t) => set("phone", t)} keyboardType="phone-pad" maxLength={30} />
                  </>
                )}
                <Picker label={_t("ID shown")} value={edit.id_type} options={[{ value: "", label: _t("None") }, ...opts(o.id_types)]} onChange={(x) => set("id_type", x)} />
                {!!edit.id_type && <Field label={_t("Last 4 characters of the ID")} value={edit.id_last4} onChangeText={(t) => set("id_last4", t.toUpperCase())} maxLength={4} autoCapitalize="characters" />}
                <Text style={s.meta}>{_t("Only for a one-off or temporary person. Leave empty for someone who always may collect.")}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("From")} value={edit.from} onChange={(x) => set("from", x)} placeholder={_t("Any day")} /></View>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("Until")} value={edit.until} onChange={(x) => set("until", x)} placeholder={_t("No end")} /></View>
                </View>
                {(!!edit.from || !!edit.until) && <TouchableOpacity onPress={() => setEdit((x) => ({ ...x, from: "", until: "" }))}><Text style={[s.meta, { color: C.brand, marginBottom: 8 }]}>{_t("Clear dates")}</Text></TouchableOpacity>}
                {!!edit.until && data.settings?.temp_code === 1 && (
                  <Toggle label={_t("Give a new pick-up code")} hint={_t("The person shows this code at the gate. It is shown only once.")} value={edit.new_code} onChange={(x) => set("new_code", x)} />
                )}
                <Toggle label={_t("May collect")} value={edit.can_pickup} onChange={(x) => set("can_pickup", x)}
                  hint={!edit.can_pickup ? _t("The gate will see this person in red and must not hand the child over.") : undefined} />
                <Field label={_t("Restriction note (court order, custody …)")} value={edit.restriction_note} onChangeText={(t) => set("restriction_note", t)} maxLength={500} multiline
                  style={{ minHeight: 60, textAlignVertical: "top" }} />
                {!can.lift && edit.id > 0 && <Text style={s.meta}>{_t("Only the owner or an admin can lift a collection restriction.")}</Text>}

                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <Btn title={_t("Cancel")} kind="ghost" onPress={() => setEdit(null)} style={{ flex: 1 }} />
                  <Btn title={_t("Save")} icon="check" busy={busy} onPress={save} style={{ flex: 1 }} />
                </View>
                {edit.id > 0 && !edit.guardian && (
                  <Btn title={_t("Remove from the list")} kind="danger" icon="trash-2" onPress={() => remove(edit)} style={{ marginTop: 8 }} />
                )}
              </SheetScroll>
            )}
      </KeyboardSheet>

      <CodeModal code={code} onClose={() => setCode(null)} />
    </View>
  );
}

/** Shows a new code once (only its hash is kept on the server). */
export function CodeModal({ code, onClose, text }) {
  return (
    <Modal visible={!!code} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.overlay, { justifyContent: "center", padding: 24 }]}>
        <View style={[s.sheet, { borderRadius: 16, alignItems: "center" }]}>
          <Feather name="key" size={28} color={C.brand} />
          <Text style={[s.big, { marginTop: 8 }]}>{code?.name}</Text>
          <Text style={s.code}>{code?.code}</Text>
          <Text style={[s.meta, { textAlign: "center" }]}>{text ?? _t("Give this code to the person. They show it at the gate. It is shown only now – write it down or share it.")}</Text>
          <Btn title={_t("Done")} onPress={onClose} style={{ marginTop: 14, alignSelf: "stretch" }} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 18, fontWeight: "800", color: C.ink },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: "#f1f5f9" },
  pPhoto: { width: 60, height: 76, borderRadius: 8, backgroundColor: "#f1f5f9" },
  bigPhoto: { width: 120, height: 150, borderRadius: 12, backgroundColor: "#f1f5f9" },
  empty: { alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "92%" },
  code: { fontSize: 40, fontWeight: "900", letterSpacing: 8, color: C.brand, marginVertical: 12 },
});
