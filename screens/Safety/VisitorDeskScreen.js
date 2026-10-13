/**
 * Reception: visitors on site now, expected today, today's log, history.
 * Sign in (phone look-up, watch list, host told, photo, badge), sign out, pass codes, evacuation list, CSV.
 */
import React, { useCallback, useContext, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Image, RefreshControl, Platform, Share } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import { AuthContext } from "../../context/AuthContext";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import { C, Card, Btn, Empty, Picker, Field, Toggle } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import {
  getVisitorsToday, lookupVisitor, signInVisitor, signOutVisitor, signOutAll, findByCode, getVisitHistory, getStaff, searchStudents,
  expectVisitor, newVisitCode, cancelExpected, passCodeMessage,
  uploadPhoto, takePhoto, photoSource, photoDataUri, exportVisitsCsv, STATUS_LABEL, opts, hm, escapeHtml,
} from "../../services/SafetyApi";
import { fmtDate, fmtTime } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";

const TABS = [
  { key: "onsite", get label() { return _t("On site"); } },
  { key: "expected", get label() { return _t("Expected"); } },
  { key: "today", get label() { return _t("Today"); } },
  { key: "history", get label() { return _t("History"); } },
];
const EMPTY = { phone: "", name: "", company: "", purpose: "meeting", host_staff_id: "", host_name: "", enrollment_id: "", student: "", id_type: "", id_last4: "",
  vehicle_no: "", badge_no: "", note: "", agreed_rules: false, visit_id: null, override_reason: "" };

export default function VisitorDeskScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("onsite");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [denied, setDenied] = useState(null);
  const [staff, setStaff] = useState([]);
  const [stuQ, setStuQ] = useState("");
  const [stuHits, setStuHits] = useState([]);
  const [badge, setBadge] = useState(null);
  const [codeBox, setCodeBox] = useState(null);
  const [codeHits, setCodeHits] = useState(null);   // guests found by a pass code
  const [expect, setExpect] = useState(null);       // booking form (one guest or a group)
  const [issued, setIssued] = useState(null);       // { code, visits } – shown once
  const [hist, setHist] = useState({ q: "", status: "", page: 1, data: null });

  const load = useCallback(async () => {
    try { setD(await getVisitorsToday(user)); setErr(null); } catch (e) { setErr(e.message); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadHist = useCallback(async (h) => {
    try { const r = await getVisitHistory(user, { q: h.q, status: h.status, page: h.page }); setHist({ ...h, data: r }); }
    catch (e) { Alert.alert(_t("Visitors"), _tx(e.message)); }
  }, [user]);

  const can = d?.can ?? {};
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openForm = async (prefill = {}) => {
    setForm({ ...EMPTY, ...prefill }); setPhoto(null); setLookup(null); setDenied(null); setStuQ(""); setStuHits([]);
    if (!staff.length) getStaff(user).then(setStaff).catch(() => {});
  };

  const doLookup = async () => {
    if (!form?.phone || form.phone.replace(/\D/g, "").length < 6) return;
    try {
      const r = await lookupVisitor(user, form.phone);
      setLookup(r);
      if (r.found) setForm((f) => ({ ...f, name: f.name || r.found.name || "", company: f.company || r.found.company || "", vehicle_no: f.vehicle_no || r.found.vehicle_no || "" }));
    } catch { /* look-up is only a help */ }
  };

  const findStudent = async (q) => {
    setStuQ(q);
    if (q.trim().length < 2) { setStuHits([]); return; }
    try { setStuHits(await searchStudents(user, q)); } catch { setStuHits([]); }
  };

  const submit = async () => {
    if (!form.name.trim()) { Alert.alert(_t("Sign in visitor"), _t("Enter the visitor's name.")); return; }
    if (d?.settings?.require_photo && !photo) { Alert.alert(_t("Sign in visitor"), _t("Take the visitor's photo first.")); return; }
    setBusy(true);
    try {
      const body = { ...form, host_staff_id: form.host_staff_id || "", agreed_rules: form.agreed_rules ? 1 : 0 };
      delete body.student;
      const r = await signInVisitor(user, body);
      if (r.denied) { setDenied(r.message); load(); return; }
      if (photo) { try { await uploadPhoto(user, "visit", r.visit.id, photo); } catch (e) { Alert.alert(_t("Photo"), _tx(e.message)); } }
      setForm(null); setBadge({ visit: r.visit, img: photo?.base64 ? `data:image/jpeg;base64,${photo.base64}` : null });
      load();
    } catch (e) { Alert.alert(_t("Sign in visitor"), _tx(e.message)); } finally { setBusy(false); }
  };

  const out = (v) => Alert.alert(_t("Sign out {name}?", { name: v.name }), "", [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Sign out"), onPress: async () => { try { await signOutVisitor(user, v.id); load(); } catch (e) { Alert.alert(_t("Visitors"), _tx(e.message)); } } },
  ]);
  const allOut = () => Alert.alert(_t("Sign everyone out?"), _t("Everyone still on site is signed out now."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Sign out all"), style: "destructive", onPress: async () => { try { const r = await signOutAll(user); load(); Alert.alert(_t("Visitors"), _t("{n} signed out.", { n: r.signed_out })); } catch (e) { Alert.alert(_t("Visitors"), _tx(e.message)); } } },
  ]);

  const byCode = async () => {
    try {
      const r = await findByCode(user, codeBox);
      const visits = r.visits ?? [r.visit];
      setCodeBox(null);
      if (visits.length === 1) arrived(visits[0]); else setCodeHits(visits);
    } catch (e) { Alert.alert(_t("Pass code"), _tx(e.message)); }
  };

  const openExpect = () => {
    setExpect({ names: "", phone: "", company: "", purpose: "meeting", host_staff_id: "", host_name: "", date: d?.today ?? "", time: "", note: "" });
    if (!staff.length) getStaff(user).then(setStaff).catch(() => {});
  };
  const saveExpect = async () => {
    const names = expect.names.split(/\n/).map((x) => x.trim()).filter(Boolean);
    if (!names.length) { Alert.alert(_t("Expect a visitor"), _t("Enter the visitor's name.")); return; }
    setBusy(true);
    try {
      const r = await expectVisitor(user, { ...expect, names, host_staff_id: expect.host_staff_id || "" });
      setExpect(null);
      setIssued({ code: r.code, visits: r.visits ?? [r.visit] });
      load();
    } catch (e) { Alert.alert(_t("Expect a visitor"), _tx(e.message)); } finally { setBusy(false); }
  };
  const regenCode = (v) => Alert.alert(_t("New pass code?"), v.group ? _t("The old code stops working for everyone in this group.") : _t("The old code will stop working."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("New code"), onPress: async () => {
      try { const r = await newVisitCode(user, v.id); setIssued({ code: r.code, visits: r.visits }); load(); } catch (e) { Alert.alert(_t("Pass code"), _tx(e.message)); }
    } },
  ]);
  const cancelVisit = (v) => Alert.alert(_t("Cancel the visit of {name}?", { name: v.name }), _t("Their pass code will stop working."), [
    { text: _t("Keep"), style: "cancel" },
    { text: _t("Cancel visit"), style: "destructive", onPress: async () => { try { await cancelExpected(user, v.id); load(); } catch (e) { Alert.alert(_t("Visitors"), _tx(e.message)); } } },
  ]);
  const shareCode = () => Share.share({ message: passCodeMessage(issued.code, issued.visits, { date: (x) => fmtDate(x), time: fmtTime }) }).catch(() => {});
  const arrived = (v) => openForm({ visit_id: v.id, name: v.name, phone: v.phone ?? "", company: v.company ?? "", purpose: v.purpose, host_staff_id: v.host_staff_id ?? "",
    host_name: v.host_staff_id ? "" : v.host ?? "", enrollment_id: v.enrollment_id ?? "", student: v.student ?? "", note: v.note ?? "", vehicle_no: v.vehicle_no ?? "" });

  const printBadge = async (b) => {
    const v = b.visit;
    const img = b.img || (v.photo ? await photoDataUri(user, "visit", v.id) : null);
    const html = `<html><head><meta name="viewport" content="width=device-width"/><style>
      body{font-family:-apple-system,Roboto,Arial;margin:0;padding:16px}.b{border:3px solid #5b21b6;border-radius:14px;padding:14px;width:300px}
      .t{background:#5b21b6;color:#fff;font-weight:800;text-align:center;padding:6px;border-radius:8px;font-size:20px;letter-spacing:2px}
      .r{display:flex;gap:12px;margin-top:12px}.p{width:90px;height:120px;object-fit:cover;border-radius:8px;background:#eee}
      .n{font-size:20px;font-weight:800}.m{font-size:13px;color:#333;margin-top:4px}.f{font-size:11px;color:#666;margin-top:10px}</style></head><body>
      <div class="b"><div class="t">${escapeHtml(_t("VISITOR"))}${v.badge_no ? ` · ${escapeHtml(v.badge_no)}` : ""}</div><div class="r">
      ${img ? `<img class="p" src="${img}"/>` : `<div class="p"></div>`}<div><div class="n">${escapeHtml(v.name)}</div>
      ${v.company ? `<div class="m">${escapeHtml(v.company)}</div>` : ""}<div class="m">${escapeHtml(_t("To see: {host}", { host: v.host || _tx(d?.options?.purposes?.[v.purpose] ?? "") }))}</div>
      <div class="m">${escapeHtml(fmtDate(v.date, "medium"))} · ${escapeHtml(fmtTime(hm(v.signed_in_at)))}</div></div></div>
      <div class="f">${escapeHtml(_t("Please wear this badge where it can be seen and return it when you leave."))}</div></div></body></html>`;
    try { await Print.printAsync({ html }); } catch { /* cancelled */ }
  };

  const printEvacuation = async () => {
    const rows = (d?.onsite ?? []).map((v) => `<tr><td>${escapeHtml(v.badge_no ?? "")}</td><td>${escapeHtml(v.name)}</td><td>${escapeHtml(v.company ?? "")}</td><td>${escapeHtml(v.host ?? "")}</td><td>${escapeHtml(fmtTime(hm(v.signed_in_at)))}</td><td style="width:60px"></td></tr>`).join("");
    const html = `<html><head><style>body{font-family:Arial;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;font-size:12px;text-align:left}</style></head><body>
      <h2>${escapeHtml(_t("Visitors on site – roll call"))}</h2><p>${escapeHtml(fmtDate(d?.today, "long"))} · ${escapeHtml(_t("{n} visitors", { n: d?.onsite?.length ?? 0 }))}</p>
      <table><tr><th>${escapeHtml(_t("Badge"))}</th><th>${escapeHtml(_t("Name"))}</th><th>${escapeHtml(_t("Company"))}</th><th>${escapeHtml(_t("Visiting"))}</th><th>${escapeHtml(_t("In"))}</th><th>${escapeHtml(_t("Safe"))}</th></tr>${rows}</table></body></html>`;
    try { await Print.printAsync({ html }); } catch { /* cancelled */ }
  };

  const staffOpts = useMemo(() => [{ value: "", label: _t("Nobody / other") }, ...staff.map((s) => ({ value: s.staff_id, label: s.name }))], [staff]);

  if (!d) return <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>{err ? <Card><Empty icon="alert-circle" text={_tx(err)} /></Card> : <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}</View>;

  const list = tab === "onsite" ? d.onsite : tab === "expected" ? d.expected : tab === "today" ? [...d.onsite, ...d.left, ...d.denied].filter((v) => v.date === d.today) : (hist.data?.visits ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <View style={s.chips}>
          <Chip n={d.counts.onsite} label={_t("on site")} color={C.ok} />
          <Chip n={d.counts.expected} label={_t("expected")} color={C.brand} />
          <Chip n={d.counts.left} label={_t("left")} color={C.muted} />
          <Chip n={d.counts.denied} label={_t("refused")} color={d.counts.denied ? C.err : C.muted} />
        </View>
        {can.edit && (
          <View style={s.actions}>
            <Act icon="user-plus" label={_t("Sign in visitor")} onPress={() => openForm()} primary />
            <Act icon="calendar" label={_t("Expect a visitor")} onPress={openExpect} />
            <Act icon="hash" label={_t("Pass code")} onPress={() => setCodeBox("")} />
            {!!d.onsite.length && <Act icon="log-out" label={_t("Sign out all")} onPress={allOut} />}
            <Act icon="printer" label={_t("Roll call")} onPress={printEvacuation} />
            {can.approve && <Act icon="shield" label={_t("Rules & watch list")} onPress={() => navigation.navigate("SafetySettings")} />}
          </View>
        )}
        <View style={s.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => { setTab(t.key); if (t.key === "history" && !hist.data) loadHist({ ...hist, page: 1 }); }}>
              <Text style={[s.tabTxt, tab === t.key && s.tabTxtOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {tab === "history" && (
          <Card>
            <Field placeholder={_t("Search name, company, vehicle or phone")} value={hist.q} onChangeText={(q) => setHist({ ...hist, q })} onSubmitEditing={() => loadHist({ ...hist, page: 1 })} returnKeyType="search" />
            <Picker value={hist.status} options={[{ value: "", label: _t("All") }, ...Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k]() }))]}
              onChange={(v) => loadHist({ ...hist, status: v, page: 1 })} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn title={_t("Search")} icon="search" kind="ghost" onPress={() => loadHist({ ...hist, page: 1 })} style={{ flex: 1 }} />
              {can.export && <Btn title={_t("Export CSV")} icon="download" kind="ghost" style={{ flex: 1 }}
                onPress={async () => { try { await exportVisitsCsv(user, { q: hist.q, status: hist.status, from: "2000-01-01" }); } catch (e) { Alert.alert(_t("Visitors"), _tx(e.message)); } }} />}
            </View>
            {!!hist.data && <Text style={s.meta}>{_t("{n} visits", { n: hist.data.total })} · {_t("page {p} of {n}", { p: hist.data.page, n: hist.data.pages })}</Text>}
          </Card>
        )}
        {!list.length && <Card><Empty icon="users" text={tab === "onsite" ? _t("Nobody is signed in right now.") : _t("Nothing here.")} /></Card>}
        {list.map((v) => (
          <Card key={v.id}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {v.photo ? <Image source={photoSource(user, "visit", v.id, undefined, v.photo_v)} style={s.ph} /> : <View style={[s.ph, s.phEmpty]}><Feather name="user" size={22} color="#94a3b8" /></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{v.name}{v.company ? <Text style={s.meta}>{`  ·  ${v.company}`}</Text> : null}</Text>
                <Text style={s.meta}>{_tx(d.options.purposes[v.purpose] ?? v.purpose)}{v.host ? ` → ${v.host}` : ""}{v.student ? ` · ${v.student}` : ""}</Text>
                <Text style={s.meta}>
                  {tab === "history" ? `${fmtDate(v.date, "medium")} · ` : ""}{STATUS_LABEL[v.status]?.() ?? v.status}
                  {v.signed_in_at ? ` · ${_t("in")} ${fmtTime(hm(v.signed_in_at))}` : v.expected_time ? ` · ${fmtTime(v.expected_time)}` : ""}
                  {v.signed_out_at ? ` · ${_t("out")} ${fmtTime(hm(v.signed_out_at))}` : v.auto_out ? ` · ${_t("not signed out")}` : ""}
                  {v.badge_no ? ` · ${_t("badge {n}", { n: v.badge_no })}` : ""}
                </Text>
                {!!v.watch_level && <Text style={[s.meta, { color: v.watch_level === "deny" ? C.err : C.warn, fontWeight: "700" }]}>{v.watch_level === "deny" ? _t("On the watch list – refused") : _t("On the watch list – office told")}</Text>}
                {!!v.note && <Text style={s.meta}>{v.note}</Text>}
                {v.has_code && <Text style={[s.meta, { color: C.brand, fontWeight: "700" }]}>{_t("Has a pass code")}{groupSize(list, v) > 1 ? ` · ${_t("group of {n}", { n: groupSize(list, v) })}` : ""}</Text>}
              </View>
            </View>
            {can.edit && v.status === "in" && (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <Btn title={_t("Sign out")} icon="log-out" kind="ghost" onPress={() => out(v)} style={{ flex: 1 }} />
                <Btn title={_t("Badge")} icon="printer" kind="ghost" onPress={() => printBadge({ visit: v, img: null })} style={{ flex: 1 }} />
                {!v.photo && <Btn title={_t("Photo")} icon="camera" kind="ghost" style={{ flex: 1 }}
                  onPress={async () => { const p = await takePhoto(); if (p) { try { await uploadPhoto(user, "visit", v.id, p); load(); } catch (e) { Alert.alert(_t("Photo"), _tx(e.message)); } } }} />}
              </View>
            )}
            {can.edit && v.status === "expected" && (
              <>
                <Btn title={_t("Arrived – sign in")} icon="log-in" onPress={() => arrived(v)} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Btn title={v.has_code ? _t("New pass code") : _t("Give a pass code")} icon="hash" kind="ghost" onPress={() => regenCode(v)} style={{ flex: 1 }} />
                  <Btn title={_t("Cancel visit")} icon="x" kind="ghost" onPress={() => cancelVisit(v)} style={{ flex: 1 }} />
                </View>
              </>
            )}
          </Card>
        ))}
        {tab === "history" && hist.data && hist.data.pages > 1 && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn title={_t("Previous")} kind="ghost" disabled={hist.page <= 1} onPress={() => loadHist({ ...hist, page: hist.page - 1 })} style={{ flex: 1 }} />
            <Btn title={_t("Next")} kind="ghost" disabled={hist.page >= hist.data.pages} onPress={() => loadHist({ ...hist, page: hist.page + 1 })} style={{ flex: 1 }} />
          </View>
        )}
      </ScrollView>

      {/* ── sign-in form ── */}
      <KeyboardSheet visible={!!form} onClose={() => setForm(null)}>
            <View style={s.sheetHead}>
              <Text style={[s.title, { flex: 1 }]}>{form?.visit_id ? _t("Expected visitor arrived") : _t("Sign in visitor")}</Text>
              <TouchableOpacity onPress={() => setForm(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {form && (
              <SheetScroll>
                {!!denied && (
                  <View style={s.alarm}>
                    <Feather name="alert-octagon" size={18} color="#fff" />
                    <Text style={s.alarmTxt}>{_tx(denied)}</Text>
                  </View>
                )}
                {!!denied && can.approve && (
                  <>
                    <Field label={_t("Let in anyway – reason (owner / office)")} value={form.override_reason} onChangeText={(v) => set("override_reason", v)} placeholder={_t("e.g. With a police escort")} />
                    <Btn title={_t("Let in anyway")} icon="unlock" kind="danger" busy={busy} disabled={!form.override_reason.trim()} onPress={submit} />
                  </>
                )}
                {!denied && (
                  <>
                    <Field label={_t("Mobile number")} value={form.phone} onChangeText={(v) => set("phone", v)} onBlur={doLookup} keyboardType="phone-pad" maxLength={30} />
                    {!!lookup?.found && <Text style={[s.meta, { color: C.ok }]}>{_t("Visited before ({n} times, last {date})", { n: lookup.visits, date: fmtDate(lookup.found.last_visit, "medium") })}</Text>}
                    {!!lookup?.watch && <Text style={[s.meta, { color: lookup.watch.level === "deny" ? C.err : C.warn, fontWeight: "700" }]}>{lookup.watch.level === "deny" ? _t("This number is on the watch list (do not let in).") : _t("This number is on the watch list (office will be told).")}{lookup.watch.reason ? ` ${lookup.watch.reason}` : ""}</Text>}
                    <Field label={_t("Name")} value={form.name} onChangeText={(v) => set("name", v)} maxLength={120} />
                    <Field label={_t("Company / organisation (optional)")} value={form.company} onChangeText={(v) => set("company", v)} maxLength={120} />
                    <Picker label={_t("Reason for visit")} value={form.purpose} options={opts(d.options.purposes)} onChange={(v) => set("purpose", v)} />
                    <Picker label={_t("Visiting")} value={form.host_staff_id} options={staffOpts} onChange={(v) => set("host_staff_id", v)} />
                    {!form.host_staff_id && <Field placeholder={_t("Office / person (optional)")} value={form.host_name} onChangeText={(v) => set("host_name", v)} maxLength={120} />}
                    {(form.purpose === "parent" || form.purpose === "pickup") && (
                      <>
                        <Field label={_t("Student (optional)")} value={form.student || stuQ} onChangeText={(q) => { set("student", ""); set("enrollment_id", ""); findStudent(q); }} placeholder={_t("Type a name")} />
                        {!form.enrollment_id && stuHits.slice(0, 5).map((st) => (
                          <TouchableOpacity key={st.enrollment_id} style={s.hit} onPress={() => { setForm((f) => ({ ...f, enrollment_id: st.enrollment_id, student: `${st.name} (${st.class_label})` })); setStuHits([]); }}>
                            <Text style={s.meta}>{st.name} · {st.class_label}</Text>
                          </TouchableOpacity>
                        ))}
                      </>
                    )}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}><Picker label={d.settings.require_id ? _t("ID (required)") : _t("ID checked")} value={form.id_type} options={[{ value: "", label: _t("None") }, ...opts(d.options.id_types)]} onChange={(v) => set("id_type", v)} /></View>
                      <View style={{ width: 110 }}><Field label={_t("Last 4")} value={form.id_last4} onChangeText={(v) => set("id_last4", v)} maxLength={20} autoCapitalize="characters" /></View>
                    </View>
                    <Text style={s.small}>{_t("Only the last 4 characters of the ID number are kept.")}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}><Field label={_t("Vehicle (optional)")} value={form.vehicle_no} onChangeText={(v) => set("vehicle_no", v)} autoCapitalize="characters" maxLength={30} /></View>
                      <View style={{ width: 110 }}><Field label={_t("Badge no.")} value={form.badge_no} onChangeText={(v) => set("badge_no", v)} placeholder={_t("auto")} maxLength={20} /></View>
                    </View>
                    <Field label={_t("Note (optional)")} value={form.note} onChangeText={(v) => set("note", v)} maxLength={500} />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      {photo ? <Image source={{ uri: photo.uri }} style={s.ph} /> : <View style={[s.ph, s.phEmpty]}><Feather name="camera" size={22} color="#94a3b8" /></View>}
                      <Btn title={photo ? _t("Retake photo") : d.settings.require_photo ? _t("Take photo (required)") : _t("Take photo")} icon="camera" kind="ghost" onPress={async () => { const p = await takePhoto(); if (p) setPhoto(p); }} style={{ flex: 1 }} />
                    </View>
                    {!!d.settings.visitor_rules && (
                      <View style={s.rules}>
                        <Text style={s.small}>{d.settings.visitor_rules}</Text>
                        <Toggle label={_t("The visitor has read and agrees to the rules")} value={!!form.agreed_rules} onChange={(v) => set("agreed_rules", v)} />
                      </View>
                    )}
                    <Btn title={_t("Sign in")} icon="log-in" busy={busy} onPress={submit} />
                  </>
                )}
              </SheetScroll>
            )}
      </KeyboardSheet>

      {/* ── badge after sign-in ── */}
      <Modal visible={!!badge} animationType="fade" transparent onRequestClose={() => setBadge(null)}>
        <View style={[s.overlay, { justifyContent: "center", padding: 24 }]}>
          <View style={[s.sheet, { borderRadius: 16 }]}>
            <Text style={s.title}>{_t("Signed in")}</Text>
            {badge && <Text style={s.meta}>{badge.visit.name}{badge.visit.host ? ` → ${badge.visit.host}` : ""} · {_t("badge {n}", { n: badge.visit.badge_no ?? "–" })}</Text>}
            {badge?.visit?.host_staff_id ? <Text style={[s.meta, { color: C.ok }]}>{_t("The host has been told.")}</Text> : null}
            <Btn title={_t("Print badge")} icon="printer" onPress={() => printBadge(badge)} />
            <Btn title={_t("Done")} kind="ghost" onPress={() => setBadge(null)} />
          </View>
        </View>
      </Modal>

      {/* ── pass code ── */}
      <KeyboardSheet center visible={codeBox !== null} onClose={() => setCodeBox(null)}>
            <Text style={s.title}>{_t("Expected visitor – pass code")}</Text>
            <Field value={codeBox ?? ""} onChangeText={setCodeBox} keyboardType="number-pad" maxLength={6} placeholder="000000" />
            <Btn title={_t("Find")} icon="search" disabled={(codeBox ?? "").length !== 6} onPress={byCode} />
            <Btn title={_t("Cancel")} kind="ghost" onPress={() => setCodeBox(null)} />
      </KeyboardSheet>

      {/* ── guests found by a pass code (a group shares one code) ── */}
      <KeyboardSheet center visible={!!codeHits} onClose={() => setCodeHits(null)}>
        <Text style={s.title}>{_t("{n} guests with this pass code", { n: codeHits?.length ?? 0 })}</Text>
        <SheetScroll>
          {(codeHits ?? []).map((v) => (
            <TouchableOpacity key={v.id} style={[s.hit, { flexDirection: "row", alignItems: "center", gap: 10 }]} onPress={() => { setCodeHits((h) => (h ?? []).filter((x) => x.id !== v.id)); arrived(v); }}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{v.name}{v.company ? <Text style={s.meta}>{`  ·  ${v.company}`}</Text> : null}</Text>
                <Text style={s.meta}>{_tx(d.options.purposes[v.purpose] ?? v.purpose)}{v.host ? ` → ${v.host}` : ""}{v.expected_time ? ` · ${fmtTime(v.expected_time)}` : ""}</Text>
              </View>
              <Feather name="log-in" size={18} color={C.brand} />
            </TouchableOpacity>
          ))}
          <Text style={[s.small, { marginTop: 8 }]}>{_t("Tap a guest to sign them in. The others stay on the list until they arrive.")}</Text>
          <Btn title={_t("Close")} kind="ghost" onPress={() => setCodeHits(null)} />
        </SheetScroll>
      </KeyboardSheet>

      {/* ── book an expected visitor / group ── */}
      <KeyboardSheet visible={!!expect} onClose={() => setExpect(null)}>
        <View style={s.sheetHead}>
          <Text style={[s.title, { flex: 1 }]}>{_t("Expect a visitor")}</Text>
          <TouchableOpacity onPress={() => setExpect(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
        </View>
        {!!expect && (
          <SheetScroll>
            <Text style={s.small}>{_t("The visitor gets a 6-digit pass code. At reception, Pass code finds them for a quick sign-in.")}</Text>
            <Field label={_t("Guest name(s) – one per line for a group")} value={expect.names} onChangeText={(t) => setExpect((x) => ({ ...x, names: t }))} multiline
              style={{ minHeight: 70, textAlignVertical: "top" }} />
            <Field label={_t("Mobile number")} value={expect.phone} onChangeText={(t) => setExpect((x) => ({ ...x, phone: t }))} keyboardType="phone-pad" maxLength={30} />
            <Field label={_t("Company / organisation (optional)")} value={expect.company} onChangeText={(t) => setExpect((x) => ({ ...x, company: t }))} maxLength={120} />
            <Picker label={_t("Reason for visit")} value={expect.purpose} options={opts(d.options.purposes)} onChange={(v) => setExpect((x) => ({ ...x, purpose: v }))} />
            <Picker label={_t("Visiting")} value={expect.host_staff_id} options={staffOpts} onChange={(v) => setExpect((x) => ({ ...x, host_staff_id: v }))} />
            {!expect.host_staff_id && <Field placeholder={_t("Office / person (optional)")} value={expect.host_name} onChangeText={(t) => setExpect((x) => ({ ...x, host_name: t }))} maxLength={120} />}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><DateTimeField label={_t("Date")} value={expect.date} onChange={(v) => setExpect((x) => ({ ...x, date: v }))} minimumDate={d.today ? new Date(`${d.today}T00:00:00`) : undefined} /></View>
              <View style={{ flex: 1 }}><DateTimeField label={_t("Time")} mode="time" value={expect.time} onChange={(v) => setExpect((x) => ({ ...x, time: v }))} placeholder={_t("Any time")} /></View>
            </View>
            <Field label={_t("Note (optional)")} value={expect.note} onChangeText={(t) => setExpect((x) => ({ ...x, note: t }))} maxLength={500} />
            <Btn title={_t("Save and get pass code")} icon="hash" busy={busy} onPress={saveExpect} />
          </SheetScroll>
        )}
      </KeyboardSheet>

      {/* ── a new pass code, shown once ── */}
      <KeyboardSheet center visible={!!issued} onClose={() => setIssued(null)}>
        <Text style={[s.title, { textAlign: "center" }]}>{_t("Pass code")}</Text>
        <Text style={s.code}>{issued?.code}</Text>
        <Text style={[s.meta, { textAlign: "center" }]}>
          {(issued?.visits ?? []).map((v) => v.name).join(", ")}{issued?.visits?.[0] ? ` · ${fmtDate(issued.visits[0].date)}` : ""}{issued?.visits?.[0]?.expected_time ? ` · ${fmtTime(issued.visits[0].expected_time)}` : ""}
        </Text>
        <Text style={[s.small, { textAlign: "center", marginTop: 6 }]}>{_t("Send this pass code to the visitor. It is shown only now.")}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Btn title={_t("Share")} icon="share-2" kind="ghost" onPress={shareCode} style={{ flex: 1 }} />
          <Btn title={_t("Done")} onPress={() => setIssued(null)} style={{ flex: 1 }} />
        </View>
      </KeyboardSheet>
    </View>
  );
}

/** How many guests on the list share this visitor's pass code. */
const groupSize = (list, v) => (v.group ? list.filter((x) => x.group === v.group).length : 1);

function Chip({ n, label, color }) {
  return <View style={s.chip}><Text style={[s.chipN, { color }]}>{n}</Text><Text style={s.chipL}>{label}</Text></View>;
}
function Act({ icon, label, onPress, primary }) {
  return (
    <TouchableOpacity style={[s.act, primary && { backgroundColor: C.brand }]} onPress={onPress} activeOpacity={0.8}>
      <Feather name={icon} size={15} color={primary ? "#fff" : C.brand} />
      <Text style={[s.actTxt, primary && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingVertical: 10, alignItems: "center" },
  chipN: { fontSize: 20, fontWeight: "800" },
  chipL: { fontSize: 11, color: C.muted, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  act: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.brandSoft, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  actTxt: { fontSize: 13, fontWeight: "700", color: C.brand },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 12, overflow: "hidden" },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabOn: { backgroundColor: C.brand },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  tabTxtOn: { color: "#fff" },
  ph: { width: 54, height: 68, borderRadius: 8, backgroundColor: "#f1f5f9" },
  phEmpty: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontWeight: "800", color: C.ink },
  title: { fontSize: 16, fontWeight: "800", color: C.ink, marginBottom: 6 },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  small: { fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 15 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  code: { fontSize: 40, fontWeight: "900", letterSpacing: 8, color: C.brand, marginVertical: 10, textAlign: "center" },
  hit: { paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: "#f1f5f9" },
  rules: { backgroundColor: C.bg, borderRadius: 10, padding: 10, marginBottom: 8 },
  alarm: { flexDirection: "row", gap: 10, backgroundColor: C.err, borderRadius: 10, padding: 12, marginBottom: 10, alignItems: "center" },
  alarmTxt: { flex: 1, color: "#fff", fontWeight: "800", fontSize: 14, lineHeight: 19 },
});
