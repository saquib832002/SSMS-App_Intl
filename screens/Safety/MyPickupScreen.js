/**
 * Parents: who may collect my child. See the approved people (with photos), add a regular person (the school checks
 * and approves, per its rules) or a one-off person for given days (with a pick-up code), remove people I added,
 * and see who collected my child and when.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Image, Platform, RefreshControl, Share } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import { C, Card, Btn, Empty, Picker, Field } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import { getMyPickup, addMyPerson, removeMyPerson, newMyCode, uploadMyPersonPhoto, takePhoto, photoSource, opts } from "../../services/SafetyApi";
import { fmtDate, fmtTime } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";

export default function MyPickupScreen({ route }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const eid = route?.params?.enrollment_id ?? activeEnrollmentId ?? user?.enrollmentId ?? user?.ssmsUserName ?? "";
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);   // { name, code, from, until }

  const load = useCallback(async () => {
    try { setData(await getMyPickup(user, eid)); setErr(null); } catch (e) { setErr(_tx(e.message)); }
  }, [user, eid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k, val) => setForm((x) => ({ ...x, [k]: val }));

  const save = async () => {
    const f = form;
    if (f.name.trim().length < 2) { Alert.alert(_t("Pick-up persons"), _t("Enter the person's name.")); return; }
    if (!f.phone.trim()) { Alert.alert(_t("Pick-up persons"), _t("Add the person's mobile number (the school may need to call them).")); return; }
    if (f.oneOff && (!f.from || !f.until)) { Alert.alert(_t("Pick-up persons"), _t("Choose the days this person will collect your child.")); return; }
    if (f.oneOff && f.until < f.from) { Alert.alert(_t("Pick-up persons"), _t("The end date is before the start date.")); return; }
    setBusy(true);
    try {
      const r = await addMyPerson(user, eid, {
        name: f.name, relation: f.relation, phone: f.phone, id_type: f.id_type, id_last4: f.id_last4,
        from: f.oneOff ? f.from : "", until: f.oneOff ? f.until : "",
      });
      let photoFailed = false;
      if (f.photo) {
        try { await uploadMyPersonPhoto(user, eid, r.person.id, f.photo); } catch { photoFailed = true; }
      }
      setForm(null);
      if (r.code) setCode({ name: r.person.name, code: r.code, from: r.person.from, until: r.person.until });
      else {
        Alert.alert(_t("Pick-up persons"), r.status === "pending"
          ? _t("{name} was added. The school will check and approve them – you will be told.", { name: r.person.name })
          : _t("{name} can now collect your child.", { name: r.person.name }));
      }
      if (photoFailed) Alert.alert(_t("Photo"), _t("The person was added but the photo could not be sent. Open them and try again."));
      load();
    } catch (e) { Alert.alert(_t("Pick-up persons"), _tx(e.message)); } finally { setBusy(false); }
  };

  const remove = (p) => Alert.alert(_t("Remove {name}?", { name: p.name }), _t("They will no longer be able to collect your child."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      try { await removeMyPerson(user, eid, p.id); load(); } catch (e) { Alert.alert(_t("Pick-up persons"), _tx(e.message)); }
    } },
  ]);

  const regen = (p) => Alert.alert(_t("New pick-up code for {name}?", { name: p.name }), _t("The old code will stop working."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("New code"), onPress: async () => {
      try { const r = await newMyCode(user, eid, p.id); setCode({ name: p.name, code: r.code, from: p.from, until: p.until }); } catch (e) { Alert.alert(_t("Pick-up persons"), _tx(e.message)); }
    } },
  ]);

  const addPhoto = async (p) => {
    const ph = await takePhoto({ camera: false });
    if (!ph) return;
    try { await uploadMyPersonPhoto(user, eid, p.id, ph); load(); } catch (e) { Alert.alert(_t("Photo"), _tx(e.message)); }
  };

  const shareCode = () => Share.share({ message: _t("Pick-up code for {student}: {code} (valid {from} – {until}). Show it at the school gate with your ID.", {
    student: data?.student?.name ?? "", code: code.code, from: fmtDate(code.from), until: fmtDate(code.until) }) }).catch(() => {});

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="alert-circle" text={err} /></View>;
  if (!data) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;

  const active = data.persons.filter((p) => p.status !== "rejected" && !p.ended);
  const old = data.persons.filter((p) => p.status === "rejected" || p.ended);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Card>
          <Text style={s.big}>{data.student.name}</Text>
          <Text style={s.meta}>{data.student.class_label}</Text>
          <Text style={[s.meta, { marginTop: 6 }]}>{_t("The school hands your child over only to the people below. They must show an ID at the gate.")}</Text>
          {data.mode !== "off" ? (
            <Btn title={_t("Add a person")} icon="user-plus" style={{ marginTop: 10 }} onPress={() => setForm({
              name: "", relation: "family_friend", phone: "", id_type: "", id_last4: "", oneOff: false, from: data.today, until: data.today, photo: null })} />
          ) : <Text style={[s.meta, { marginTop: 8, fontWeight: "700" }]}>{_t("To change who may collect your child, please contact the school office.")}</Text>}
        </Card>

        <Card title={_t("May collect")}>
          {!active.length && <Text style={s.meta}>{_t("Nobody yet.")}</Text>}
          {active.map((p) => (
            <View key={p.id} style={s.person}>
              <TouchableOpacity disabled={!p.mine} onPress={() => addPhoto(p)}>
                {p.photo ? <Image source={photoSource(user, "person", p.id, eid, p.photo_v)} style={s.pPhoto} />
                  : <View style={[s.pPhoto, s.empty]}><Feather name={p.mine ? "camera" : "user"} size={20} color="#94a3b8" /></View>}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <Text style={s.meta}>{_tx(p.relation_label)}{p.phone ? ` · ${p.phone}` : ""}</Text>
                {p.one_off && <Text style={[s.meta, { color: C.brand }]}>{_t("Valid {from} – {until}", { from: fmtDate(p.from, "dayMonth"), until: fmtDate(p.until, "dayMonth") })}</Text>}
                {p.status === "pending" && <Text style={[s.meta, { color: C.warn, fontWeight: "700" }]}>{_t("Waiting for the school to approve")}</Text>}
                {p.mine && <View style={{ flexDirection: "row", gap: 14, marginTop: 4 }}>
                  {p.one_off && data.temp_code && <TouchableOpacity onPress={() => regen(p)}><Text style={s.link}>{_t("New code")}</Text></TouchableOpacity>}
                  <TouchableOpacity onPress={() => remove(p)}><Text style={[s.link, { color: C.err }]}>{_t("Remove")}</Text></TouchableOpacity>
                </View>}
              </View>
            </View>
          ))}
        </Card>

        {!!old.length && (
          <Card title={_t("Ended or not approved")}>
            {old.map((p) => (
              <View key={p.id} style={[s.person, { opacity: 0.6 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{p.name}</Text>
                  <Text style={s.meta}>{p.status === "rejected" ? _t("Not approved by the school") : _t("Ended {date}", { date: fmtDate(p.until, "dayMonth") })}</Text>
                </View>
                {p.mine && <TouchableOpacity onPress={() => remove(p)}><Text style={[s.link, { color: C.err }]}>{_t("Remove")}</Text></TouchableOpacity>}
              </View>
            ))}
          </Card>
        )}

        <Card title={_t("Collected")}>
          {!data.history.length && <Text style={s.meta}>{_t("Nothing yet.")}</Text>}
          {data.history.map((h) => (
            <View key={h.id} style={s.logRow}>
              <Text style={s.time}>{fmtDate(h.date, "dayMonth")}</Text>
              <Text style={[s.meta, { flex: 1, marginTop: 0 }]}>{_t("{time} by {person}", { time: fmtTime(h.time), person: h.by || "—" })}{h.kind === "early" ? ` · ${_t("early")}` : ""}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>

      <KeyboardSheet visible={!!form} onClose={() => setForm(null)}>
            {!!form && (
              <SheetScroll>
                <Text style={s.big}>{_t("Add a person")}</Text>
                <View style={s.seg}>
                  {[[false, _t("Regularly")], [true, _t("Only on some days")]].map(([val, label]) => (
                    <TouchableOpacity key={String(val)} style={[s.segBtn, form.oneOff === val && s.segOn]} onPress={() => set("oneOff", val)}>
                      <Text style={[s.segTxt, form.oneOff === val && { color: "#fff" }]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.meta}>{form.oneOff
                  ? (data.temp_code ? _t("Valid at once for the days you choose (up to a month). You get a pick-up code to give them.") : _t("Valid at once for the days you choose (up to a month)."))
                  : data.mode === "approve" ? _t("The school checks and approves this person first.") : _t("Valid at once.")}</Text>

                <View style={{ flexDirection: "row", gap: 12, alignItems: "center", marginVertical: 10 }}>
                  {form.photo ? <Image source={{ uri: form.photo.uri }} style={s.bigPhoto} /> : <View style={[s.bigPhoto, s.empty]}><Feather name="camera" size={24} color="#94a3b8" /></View>}
                  <View style={{ flex: 1, gap: 8 }}>
                    <Btn title={_t("Take photo")} icon="camera" kind="ghost" onPress={async () => { const p = await takePhoto({ camera: true }); if (p) set("photo", p); }} />
                    <Btn title={_t("Choose photo")} icon="image" kind="ghost" onPress={async () => { const p = await takePhoto({ camera: false }); if (p) set("photo", p); }} />
                  </View>
                </View>
                <Text style={s.meta}>{_t("A clear photo of the face helps the gate staff recognise them.")}</Text>

                <Field label={_t("Name")} value={form.name} onChangeText={(t) => set("name", t)} maxLength={150} />
                <Picker label={_t("Relation")} value={form.relation} options={opts(data.options?.relations)} onChange={(x) => set("relation", x)} />
                <Field label={_t("Mobile number")} value={form.phone} onChangeText={(t) => set("phone", t)} keyboardType="phone-pad" maxLength={30} />
                <Picker label={_t("ID they will show")} value={form.id_type} options={[{ value: "", label: _t("None") }, ...opts(data.options?.id_types)]} onChange={(x) => set("id_type", x)} />
                {!!form.id_type && <Field label={_t("Last 4 characters of the ID")} value={form.id_last4} onChangeText={(t) => set("id_last4", t.toUpperCase())} maxLength={4} autoCapitalize="characters" />}
                {form.oneOff && (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}><DateTimeField label={_t("From")} value={form.from} onChange={(x) => set("from", x)} minimumDate={new Date(`${data.today}T00:00:00`)} /></View>
                    <View style={{ flex: 1 }}><DateTimeField label={_t("Until")} value={form.until} onChange={(x) => set("until", x)} minimumDate={new Date(`${form.from || data.today}T00:00:00`)} /></View>
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Btn title={_t("Cancel")} kind="ghost" onPress={() => setForm(null)} style={{ flex: 1 }} />
                  <Btn title={_t("Save")} icon="check" busy={busy} onPress={save} style={{ flex: 1 }} />
                </View>
              </SheetScroll>
            )}
      </KeyboardSheet>

      <Modal visible={!!code} transparent animationType="fade" onRequestClose={() => setCode(null)}>
        <View style={[s.overlay, { justifyContent: "center", padding: 24 }]}>
          <View style={[s.sheet, { borderRadius: 16, alignItems: "center" }]}>
            <Feather name="key" size={28} color={C.brand} />
            <Text style={[s.big, { marginTop: 8 }]}>{code?.name}</Text>
            <Text style={s.code}>{code?.code}</Text>
            <Text style={[s.meta, { textAlign: "center" }]}>{_t("Give this code to the person. They show it at the gate. It is shown only now – write it down or share it.")}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14, alignSelf: "stretch" }}>
              <Btn title={_t("Share")} icon="share-2" kind="ghost" onPress={shareCode} style={{ flex: 1 }} />
              <Btn title={_t("Done")} onPress={() => setCode(null)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 4 },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  link: { fontSize: 13, fontWeight: "700", color: C.brand },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: "#f1f5f9" },
  pPhoto: { width: 60, height: 76, borderRadius: 8, backgroundColor: "#f1f5f9" },
  bigPhoto: { width: 110, height: 140, borderRadius: 12, backgroundColor: "#f1f5f9" },
  empty: { alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" },
  logRow: { flexDirection: "row", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderColor: "#f1f5f9", alignItems: "center" },
  time: { width: 64, fontSize: 13, fontWeight: "800", color: C.brand },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: C.brand, borderRadius: 10, overflow: "hidden", marginVertical: 8 },
  segBtn: { flex: 1, paddingVertical: 9, alignItems: "center" },
  segOn: { backgroundColor: C.brand },
  segTxt: { fontSize: 13, fontWeight: "700", color: C.brand },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "92%" },
  code: { fontSize: 40, fontWeight: "900", letterSpacing: 8, color: C.brand, marginVertical: 12 },
});
