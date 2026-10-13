/**
 * Gate / office: hand a child over safely.
 * Find the student → see who may collect them (photos, ID, one-off dates, code), who may NOT (red), today's situation
 * → check the person → hand over (the family is told). Someone else → refuse (office + family alerted) or, with
 * permission, hand over with a reason. Class list: who is still waiting at dismissal. Today's log.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Image, Platform, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import { C, Card, Btn, Empty, Picker, Field } from "../../components/ReportCardUI";
import {
  searchStudents, getPickupCard, recordPickup, refusePickup, getPickupLog, approvePerson, photoSource, studentPhotoUri, opts, escapeHtml,
} from "../../services/SafetyApi";
import { fetchClasses, fetchSections } from "../../services/StudentServiceApi";
import { fmtDate, fmtTime } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";

const TABS = [
  { key: "hand", get label() { return _t("Hand over"); } },
  { key: "class", get label() { return _t("Class list"); } },
  { key: "log", get label() { return _t("Today"); } },
];

export default function PickupDeskScreen({ navigation, route }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState("hand");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [eid, setEid] = useState(route?.params?.enrollment_id ?? null);
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);   // { person, method, code, note, kind }
  const [other, setOther] = useState(null);       // { name, relation, reason }
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [cls, setCls] = useState({ class_id: "", section_id: "" });
  const [list, setList] = useState(null);

  const loadCard = useCallback(async (id = eid) => {
    if (!id) return;
    try { setCard(await getPickupCard(user, id)); } catch (e) { Alert.alert(_t("Pick-up"), _tx(e.message)); setEid(null); }
  }, [user, eid]);
  useFocusEffect(useCallback(() => { if (eid) loadCard(eid); }, [eid, loadCard]));
  useEffect(() => { if (route?.params?.enrollment_id) setEid(route.params.enrollment_id); }, [route?.params?.enrollment_id]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setHits([]); return; }
      setSearching(true);
      try { setHits(await searchStudents(user, q.trim())); } catch { setHits([]); } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, user]);

  const loadList = useCallback(async (c = cls) => {
    try { setList(await getPickupLog(user, { class_id: c.class_id, section_id: c.section_id })); } catch (e) { Alert.alert(_t("Pick-up"), _tx(e.message)); }
  }, [user, cls]);
  useEffect(() => {
    if (tab === "class" && !classes.length) fetchClasses(user).then(setClasses).catch(() => {});
    if (tab === "log") loadList({ class_id: "", section_id: "" });
  }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSections([]);
    if (cls.class_id) fetchSections(user, cls.class_id).then(setSections).catch(() => {});
  }, [cls.class_id, user]);

  const pick = (s) => { setEid(s.enrollment_id); setCard(null); setQ(""); setHits([]); loadCard(s.enrollment_id); };

  const handOver = async () => {
    const c = confirm;
    if (c.person.needs_code && (c.code ?? "").length < 4) { Alert.alert(_t("Pick-up"), _t("Enter the pick-up code the person shows you.")); return; }
    setBusy(true);
    try {
      const r = await recordPickup(user, { enrollment_id: eid, guardian_id: c.person.id, method: c.method, code: c.code, note: c.note, kind: c.kind });
      setConfirm(null);
      Alert.alert(_t("Handed over"), _t("{student} was handed over to {person} at {time}. The family is being told.", { student: card.student.name, person: r.pickup.by, time: fmtTime(r.pickup.time) }));
      loadCard(eid);
    } catch (e) {
      Alert.alert(_t("Do not hand over"), _tx(e.message));
      loadCard(eid);
    } finally { setBusy(false); }
  };

  const doOther = async (allow) => {
    const o = other;
    if (!o.name.trim()) { Alert.alert(_t("Pick-up"), _t("Enter the person's name.")); return; }
    if (allow && !o.reason.trim()) { Alert.alert(_t("Pick-up"), _t("Write why (e.g. the parent phoned and confirmed).")); return; }
    setBusy(true);
    try {
      if (allow) {
        await recordPickup(user, { enrollment_id: eid, name: o.name, relation: o.relation, override_reason: o.reason, kind: card.kind });
        Alert.alert(_t("Handed over"), _t("Logged as collected by someone not on the list. The office has been told."));
      } else {
        await refusePickup(user, { enrollment_id: eid, name: o.name, relation: o.relation, reason: o.reason || undefined });
        Alert.alert(_t("Refused"), _t("Do not hand the child over. The office and the family have been told."));
      }
      setOther(null);
      loadCard(eid);
    } catch (e) { Alert.alert(_t("Pick-up"), _tx(e.message)); } finally { setBusy(false); }
  };

  const approve = (p, ok) => Alert.alert(ok ? _t("Approve {name}?", { name: p.name }) : _t("Do not approve {name}?", { name: p.name }),
    ok ? _t("Check their ID first. They can then collect the child.") : "", [
      { text: _t("Cancel"), style: "cancel" },
      { text: ok ? _t("Approve") : _t("Do not approve"), style: ok ? "default" : "destructive", onPress: async () => {
        try { await approvePerson(user, p.id, ok); loadCard(eid); } catch (e) { Alert.alert(_t("Pick-up"), _tx(e.message)); }
      } },
    ]);

  const classOpts = useMemo(() => [{ value: "", label: _t("Select Class") }, ...classes.map((c) => ({ value: String(c.class_id), label: c.class_name }))], [classes]);
  const sectionOpts = useMemo(() => [{ value: "", label: _t("All sections") }, ...sections.map((c) => ({ value: String(c.section_id), label: c.section_name }))], [sections]);
  const can = card?.can ?? {};
  const st = card?.student;
  const stPhoto = studentPhotoUri(user, st);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => (tab === "hand" ? loadCard(eid) : loadList())} />}>

        {tab === "hand" && (
          <>
            <Card>
              <Field placeholder={_t("Student name, roll or admission number")} value={q} onChangeText={setQ} autoCorrect={false} />
              {searching && <ActivityIndicator color={C.brand} />}
              {hits.map((h) => (
                <TouchableOpacity key={h.enrollment_id} style={s.hit} onPress={() => pick(h)}>
                  {studentPhotoUri(user, h) ? <Image source={{ uri: studentPhotoUri(user, h) }} style={s.thumb} /> : <View style={[s.thumb, s.empty]}><Feather name="user" size={16} color="#94a3b8" /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{h.name}</Text>
                    <Text style={s.meta}>{h.class_label}{h.roll_number ? ` · ${_t("Roll {n}", { n: h.roll_number })}` : ""}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={C.muted} />
                </TouchableOpacity>
              ))}
            </Card>

            {eid && !card && <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} />}
            {card && (
              <>
                <Card>
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    {stPhoto ? <Image source={{ uri: stPhoto }} style={s.stPhoto} /> : <View style={[s.stPhoto, s.empty]}><Feather name="user" size={30} color="#94a3b8" /></View>}
                    <View style={{ flex: 1 }}>
                      <Text style={s.big}>{st.name}</Text>
                      <Text style={s.meta}>{st.class_label}{st.roll_number ? ` · ${_t("Roll {n}", { n: st.roll_number })}` : ""}</Text>
                      {["A", "L"].includes(card.attendance) && <Text style={[s.meta, { color: C.warn, fontWeight: "700" }]}>{card.attendance === "A" ? _t("Marked absent today") : _t("On leave today")}</Text>}
                    </View>
                  </View>
                  {!!card.collected && (
                    <View style={[s.banner, { backgroundColor: "#dcfce7" }]}>
                      <Feather name="check-circle" size={16} color={C.ok} />
                      <Text style={[s.bannerTxt, { color: C.ok }]}>{_t("Already collected at {time} by {person}.", { time: fmtTime(card.collected.time), person: card.collected.by })}</Text>
                    </View>
                  )}
                  {!!card.early_request && (
                    <View style={[s.banner, { backgroundColor: "#ede9fe" }]}>
                      <Feather name="clock" size={16} color={C.brand} />
                      <Text style={[s.bannerTxt, { color: C.brand }]}>{_t("Parent asked for early pick-up{time}{by}.", {
                        time: card.early_request.time ? ` ${_t("at {time}", { time: fmtTime(card.early_request.time) })}` : "",
                        by: card.early_request.by ? ` – ${card.early_request.by}` : "" })}{card.early_request.reason ? ` (${card.early_request.reason})` : ""}</Text>
                    </View>
                  )}
                </Card>

                {!!card.blocked.length && (
                  <Card style={{ borderColor: C.err, borderWidth: 2 }}>
                    <Text style={[s.section, { color: C.err }]}>{_t("NOT allowed to collect")}</Text>
                    {card.blocked.map((p) => <PersonRow key={p.id} p={p} user={user} danger />)}
                  </Card>
                )}

                <Card title={_t("May collect")}>
                  {!card.allowed.length && <Text style={s.meta}>{_t("Nobody is on the list yet. Ask the office to add the family's pick-up persons.")}</Text>}
                  {card.allowed.map((p) => (
                    <TouchableOpacity key={p.id} disabled={!can.edit || !!card.collected} onPress={() => setConfirm({ person: p, method: p.needs_code ? "code" : "photo", code: "", note: "", kind: card.kind })}>
                      <PersonRow p={p} user={user} action={can.edit && !card.collected} />
                    </TouchableOpacity>
                  ))}
                </Card>

                {!!card.pending.length && (
                  <Card title={_t("Waiting for approval")}>
                    {card.pending.map((p) => (
                      <View key={p.id}>
                        <PersonRow p={p} user={user} />
                        {can.approve && (
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <Btn title={_t("Approve")} icon="check" kind="ghost" onPress={() => approve(p, true)} style={{ flex: 1 }} />
                            <Btn title={_t("Do not approve")} icon="x" kind="danger" onPress={() => approve(p, false)} style={{ flex: 1 }} />
                          </View>
                        )}
                      </View>
                    ))}
                  </Card>
                )}
                {!!card.expired.length && (
                  <Card title={_t("Not valid today")}>
                    {card.expired.map((p) => <PersonRow key={p.id} p={p} user={user} faded />)}
                  </Card>
                )}

                {can.edit && !card.collected && <Btn title={_t("Someone else is here")} icon="alert-triangle" kind="danger" onPress={() => setOther({ name: "", relation: "other", reason: "" })} />}
                {can.edit && <Btn title={_t("Manage pick-up persons")} icon="users" kind="ghost" onPress={() => navigation.navigate("PickupPersons", { enrollment_id: eid })} />}
              </>
            )}
            {!eid && !hits.length && q.trim().length < 2 && <Card><Empty icon="search" text={_t("Search for the student being collected.")} /></Card>}
          </>
        )}

        {tab === "class" && (
          <>
            <Card>
              <Picker label={_t("Class")} value={cls.class_id} options={classOpts} onChange={(v) => setCls({ class_id: String(v), section_id: "" })} />
              {!!sections.length && <Picker label={_t("Section")} value={cls.section_id} options={sectionOpts} onChange={(v) => setCls((c) => ({ ...c, section_id: String(v) }))} />}
              <Btn title={_t("Show")} icon="list" disabled={!cls.class_id} onPress={() => loadList(cls)} />
            </Card>
            {list && cls.class_id && (
              <>
                <Card title={_t("Still waiting ({n})", { n: list.waiting.filter((w) => !w.absent).length })}>
                  {!list.waiting.length && <Text style={s.meta}>{_t("Everyone has been collected.")}</Text>}
                  {list.waiting.map((w) => (
                    <TouchableOpacity key={w.enrollment_id} style={s.hit} onPress={() => { setTab("hand"); pick(w); }}>
                      <Text style={[s.name, w.absent && { color: C.muted }]}>{w.name}</Text>
                      <Text style={s.meta}>{w.absent ? _t("absent") : w.roll_number ? _t("Roll {n}", { n: w.roll_number }) : ""}</Text>
                    </TouchableOpacity>
                  ))}
                </Card>
                <LogList list={list} />
              </>
            )}
          </>
        )}

        {tab === "log" && (list ? <LogList list={list} /> : <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} />)}
      </ScrollView>

      {/* ── confirm hand-over ── */}
      <KeyboardSheet visible={!!confirm} onClose={() => setConfirm(null)}>
            {confirm && (
              <SheetScroll>
                <View style={{ alignItems: "center", marginBottom: 8 }}>
                  {confirm.person.photo ? <Image source={photoSource(user, "person", confirm.person.id, undefined, confirm.person.photo_v)} style={s.bigPhoto} /> : <View style={[s.bigPhoto, s.empty]}><Feather name="user" size={48} color="#94a3b8" /></View>}
                  <Text style={s.big}>{confirm.person.name}</Text>
                  <Text style={s.meta}>{_tx(confirm.person.relation_label)}{confirm.person.id_type ? ` · ${_tx(card?.options?.id_types?.[confirm.person.id_type] ?? confirm.person.id_type)} …${confirm.person.id_last4 ?? ""}` : ""}</Text>
                  {!!confirm.person.restriction_note && <Text style={[s.meta, { color: C.warn, fontWeight: "700", textAlign: "center" }]}>{confirm.person.restriction_note}</Text>}
                </View>
                {!confirm.person.photo && <Text style={[s.meta, { color: C.warn, textAlign: "center" }]}>{_t("No photo on file – check their ID.")}</Text>}
                {confirm.person.needs_code ? (
                  <Field label={_t("Pick-up code (from the parent)")} value={confirm.code} onChangeText={(v) => setConfirm((c) => ({ ...c, code: v.replace(/\D/g, "") }))} keyboardType="number-pad" maxLength={6} />
                ) : (
                  <Picker label={_t("How did you check them?")} value={confirm.method} options={opts({ photo: card.options.methods.photo, id: card.options.methods.id, known: card.options.methods.known })}
                    onChange={(v) => setConfirm((c) => ({ ...c, method: v }))} />
                )}
                <Picker label={_t("Type")} value={confirm.kind} options={[{ value: "early", label: _t("Early pick-up (during school)") }, { value: "pickup", label: _t("After school") }]}
                  onChange={(v) => setConfirm((c) => ({ ...c, kind: v }))} />
                <Field label={_t("Note (optional)")} value={confirm.note} onChangeText={(v) => setConfirm((c) => ({ ...c, note: v }))} maxLength={255} />
                <Btn title={_t("Hand over {student}", { student: card?.student?.name ?? "" })} icon="check-circle" busy={busy} onPress={handOver} />
                <Btn title={_t("Cancel")} kind="ghost" onPress={() => setConfirm(null)} />
              </SheetScroll>
            )}
      </KeyboardSheet>

      {/* ── someone else ── */}
      <KeyboardSheet visible={!!other} onClose={() => setOther(null)}>
            {other && card && (
              <SheetScroll>
                <Text style={s.big}>{_t("Someone not on the list")}</Text>
                <Text style={s.meta}>{_t("Do not hand the child over unless the office allows it. If unsure, refuse – the office and the family are told.")}</Text>
                <Field label={_t("Their name")} value={other.name} onChangeText={(v) => setOther((o) => ({ ...o, name: v }))} maxLength={100} />
                <Picker label={_t("Says they are")} value={other.relation} options={opts(card.options.relations)} onChange={(v) => setOther((o) => ({ ...o, relation: v }))} />
                <Field label={can.approve ? _t("Reason (needed to hand over)") : _t("Reason (optional)")} value={other.reason} onChangeText={(v) => setOther((o) => ({ ...o, reason: v }))} maxLength={255}
                  placeholder={_t("e.g. Mother phoned the office and confirmed")} />
                <Btn title={_t("Refuse and alert")} icon="slash" kind="danger" busy={busy} onPress={() => doOther(false)} />
                {can.approve && <Btn title={_t("Hand over anyway (office)")} icon="unlock" kind="ghost" busy={busy} onPress={() => doOther(true)} />}
                <Btn title={_t("Cancel")} kind="ghost" onPress={() => setOther(null)} />
              </SheetScroll>
            )}
      </KeyboardSheet>
    </View>
  );
}

function PersonRow({ p, user, danger, faded, action }) {
  return (
    <View style={[s.person, faded && { opacity: 0.5 }]}>
      {p.photo ? <Image source={photoSource(user, "person", p.id, undefined, p.photo_v)} style={s.pPhoto} /> : <View style={[s.pPhoto, s.empty]}><Feather name="user" size={22} color="#94a3b8" /></View>}
      <View style={{ flex: 1 }}>
        <Text style={[s.name, danger && { color: C.err }]}>{p.name}</Text>
        <Text style={s.meta}>{_tx(p.relation_label)}{p.phone ? ` · ${p.phone}` : ""}{p.id_last4 ? ` · ID …${p.id_last4}` : ""}</Text>
        {p.one_off && <Text style={[s.meta, { color: C.brand }]}>{_t("One-off: {from} – {until}", { from: fmtDate(p.from, "dayMonth"), until: fmtDate(p.until, "dayMonth") })}{p.needs_code ? ` · ${_t("needs code")}` : ""}</Text>}
        {!!p.restriction_note && <Text style={[s.meta, { color: danger ? C.err : C.warn, fontWeight: "700" }]}>{p.restriction_note}</Text>}
        {p.added_by === "parent" && <Text style={s.meta}>{_t("Added by the parent")}</Text>}
      </View>
      {action && <Feather name="chevron-right" size={18} color={C.brand} />}
    </View>
  );
}

function LogList({ list }) {
  return (
    <>
      <Card title={_t("Collected ({n})", { n: list.collected.length })}>
        {!list.collected.length && <Text style={s.meta}>{_t("Nothing yet.")}</Text>}
        {list.collected.map((c) => (
          <View key={c.id} style={s.logRow}>
            <Text style={s.time}>{fmtTime(c.time)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{c.student} <Text style={s.meta}>{c.class_label}</Text></Text>
              <Text style={s.meta}>{c.kind === "early" ? _t("Early") : _t("After school")} · {c.by}{c.relation ? ` (${_tx(c.relation)})` : ""} · {escapeHtml(METHOD()[c.method] ?? c.method)}</Text>
              {!!c.override_reason && <Text style={[s.meta, { color: C.warn }]}>{c.override_reason}</Text>}
            </View>
          </View>
        ))}
      </Card>
      {!!list.refused.length && (
        <Card title={_t("Refused ({n})", { n: list.refused.length })}>
          {list.refused.map((r) => (
            <View key={r.id} style={s.logRow}>
              <Text style={s.time}>{fmtTime(String(r.signed_in_at ?? "").slice(11, 16) || "")}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.name, { color: C.err }]}>{r.name}</Text>
                <Text style={s.meta}>{r.student ?? ""}{r.note ? ` · ${r.note}` : ""}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

const METHOD = () => ({ photo: _t("Photo matched"), id: _t("ID checked"), code: _t("Pick-up code"), known: _t("Known to staff"), override: _t("Not on the list (approved)") });

const s = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderColor: C.line },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabOn: { borderBottomWidth: 3, borderColor: C.brand },
  tabTxt: { fontSize: 13, fontWeight: "700", color: C.muted },
  tabTxtOn: { color: C.brand },
  hit: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: "#f1f5f9" },
  thumb: { width: 36, height: 44, borderRadius: 6, backgroundColor: "#f1f5f9" },
  empty: { alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" },
  stPhoto: { width: 76, height: 96, borderRadius: 10, backgroundColor: "#f1f5f9" },
  bigPhoto: { width: 180, height: 230, borderRadius: 14, backgroundColor: "#f1f5f9", marginBottom: 8 },
  pPhoto: { width: 60, height: 76, borderRadius: 8, backgroundColor: "#f1f5f9" },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: "#f1f5f9" },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  big: { fontSize: 18, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  section: { fontSize: 13, fontWeight: "800", textTransform: "uppercase", marginBottom: 4 },
  banner: { flexDirection: "row", gap: 8, alignItems: "center", borderRadius: 10, padding: 10, marginTop: 10 },
  bannerTxt: { flex: 1, fontSize: 13, fontWeight: "700" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "92%" },
  logRow: { flexDirection: "row", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: "#f1f5f9" },
  time: { width: 64, fontSize: 13, fontWeight: "800", color: C.brand },
});
