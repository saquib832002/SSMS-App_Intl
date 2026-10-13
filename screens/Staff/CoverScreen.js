/**
 * Cover & substitution (office): who is away on a day, their periods, and who covers them.
 * Away = approved staff leave (half days → morning / afternoon), staff attendance A / L, exam duties, or "Mark away".
 * Tap a period → free teachers best first (same subject, knows the class, fewest covers) → assign, or "No cover".
 * "Suggest for all" fills the day within the school's limits; the cover sheet can be shared.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, RefreshControl, Share, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker, Field, Toggle } from "../../components/ReportCardUI";
import {
  getCoverDay, getSuggestions, assignCover, unassignCover, autoAssignCover, markAway, removeAway,
  getCoverReport, saveCoverSettings, addDays, niceDay, periodLabel, reasonLabel, fitLabels, coverSheetText,
} from "../../services/CoverApi";
import { schoolToday, fmtDate } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";

const STATUS = {
  assigned: { color: C.brand, get label() { return _t("Assigned"); } },
  accepted: { color: C.ok, get label() { return _t("Accepted"); } },
  declined: { color: C.err, get label() { return _t("Declined"); } },
};

export default function CoverScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(route?.params?.date || schoolToday());
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null);      // { slot, away, data }
  const [note, setNote] = useState("");
  const [showBusy, setShowBusy] = useState(false);
  const [plan, setPlan] = useState(null);      // suggest-for-all preview
  const [away, setAway] = useState(null);      // mark-away form
  const [rules, setRules] = useState(null);    // settings form
  const [report, setReport] = useState(null);  // { month, data }

  const seq = useRef(0);   // only the newest answer counts (quick taps on ‹ ›)
  const load = useCallback(async (dt = date) => {
    const my = ++seq.current;
    setLoading(true);
    try { const r = await getCoverDay(user, dt); if (my === seq.current) { setD(r); setErr(null); } }
    catch (e) { if (my === seq.current) setErr(e.message); }
    finally { if (my === seq.current) setLoading(false); }
  }, [user, date]);
  useFocusEffect(useCallback(() => { load(date); }, [load, date]));
  // opened again from a notification for another day
  const wanted = route?.params?.date;
  useEffect(() => { if (wanted && wanted !== date) { setD(null); setDate(wanted); } }, [wanted]);   // eslint-disable-line react-hooks/exhaustive-deps

  const go = (n) => { const nd = addDays(date, n); setD(null); setDate(nd); };
  const canEdit = !!d?.can_edit;

  // ── one period ────────────────────────────────────────────────────────
  const openSlot = async (slot, awayName) => {
    setPick({ slot, away: awayName, data: null }); setNote(slot.cover?.note ?? ""); setShowBusy(false);
    try { const r = await getSuggestions(user, date, slot.timetable_id); setPick({ slot, away: awayName, data: r }); }
    catch (e) { setPick(null); Alert.alert(_t("Cover"), _tx(e.message)); }
  };

  const doAssign = async (staffId, force = false) => {
    setBusy(true);
    try {
      const r = await assignCover(user, { date, timetable_id: pick.slot.timetable_id, staff_id: staffId, note, force });
      if (r.confirm) {
        Alert.alert(_t("Limit reached"), _tx(r.confirm), [{ text: _t("No"), style: "cancel" }, { text: _t("Give it"), onPress: () => doAssign(staffId, true) }]);
        return;
      }
      setPick(null); await load(date);
    } catch (e) { Alert.alert(_t("Cover"), _tx(e.message)); } finally { setBusy(false); }
  };

  const doRemove = () => Alert.alert(_t("Remove cover?"), _t("The cover teacher is told that they are no longer needed."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      setBusy(true);
      try { await unassignCover(user, date, pick.slot.timetable_id); setPick(null); await load(date); }
      catch (e) { Alert.alert(_t("Cover"), _tx(e.message)); } finally { setBusy(false); }
    } },
  ]);

  // ── suggest for all ───────────────────────────────────────────────────
  const preview = async () => {
    setBusy(true);
    try { setPlan(await autoAssignCover(user, date, false)); } catch (e) { Alert.alert(_t("Suggest for all"), _tx(e.message)); } finally { setBusy(false); }
  };
  const applyPlan = async () => {
    setBusy(true);
    try {
      const r = await autoAssignCover(user, date, true, plan?.plan ?? []);
      setPlan(null); await load(date);
      Alert.alert(_t("Cover arranged"), _t("{n} periods given to teachers.", { n: r.plan.length })
        + (r.unfilled.length ? ` ${_t("{n} still need someone – the teacher was no longer free or nobody is free within the limits.", { n: r.unfilled.length })}` : ""));
    } catch (e) { Alert.alert(_t("Suggest for all"), _tx(e.message)); } finally { setBusy(false); }
  };

  // ── away ──────────────────────────────────────────────────────────────
  const saveAway = async () => {
    if (!away.staff_id) { Alert.alert(_t("Mark away"), _t("Choose a teacher.")); return; }
    setBusy(true);
    try {
      const r = await markAway(user, { staff_id: away.staff_id, date, reason: away.reason,
        ...(away.whole ? {} : { from_period: away.from, to_period: away.to || away.from }) });
      setAway(null); setD(r.day);
    } catch (e) { Alert.alert(_t("Mark away"), _tx(e.message)); } finally { setBusy(false); }
  };
  const dropAway = (w) => Alert.alert(_t("Remove away?"), _t("{name} is no longer away. Covers arranged for it are cancelled.", { name: w.name }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      setBusy(true);
      try { setD((await removeAway(user, w.id)).day); } catch (e) { Alert.alert(_t("Away"), _tx(e.message)); } finally { setBusy(false); }
    } },
  ]);

  // ── rules / report / share ────────────────────────────────────────────
  const saveRules = async () => {
    setBusy(true);
    try { await saveCoverSettings(user, rules); setRules(null); await load(date); }
    catch (e) { Alert.alert(_t("Cover rules"), _tx(e.message)); } finally { setBusy(false); }
  };
  const openReport = async (month) => {
    setReport({ month, data: null });
    try { setReport({ month, data: await getCoverReport(user, month) }); } catch (e) { setReport(null); Alert.alert(_t("Cover report"), _tx(e.message)); }
  };
  const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); const t = new Date(Date.UTC(y, mo - 1 + n, 1)); return t.toISOString().slice(0, 7); };
  const share = () => { if (d) Share.share({ message: coverSheetText(d) }).catch(() => {}); };

  const periodOpts = useMemo(() => (d?.periods ?? []).map((p) => ({ value: p.period_number, label: `${_tx(p.name)} · ${p.start}` })), [d]);
  const staffOpts = useMemo(() => (d?.staff ?? []).map((x) => ({ value: x.staff_id, label: x.name })), [d]);

  const sum = d?.summary;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.dateBar}>
        <TouchableOpacity onPress={() => go(-1)} hitSlop={10} style={s.arrow}><Feather name="chevron-left" size={22} color={C.brand} /></TouchableOpacity>
        <TouchableOpacity onPress={() => { if (date !== schoolToday()) { setD(null); setDate(schoolToday()); } }} style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.dateTxt}>{niceDay(date)}</Text>
          <Text style={s.dateSub}>{date === schoolToday() ? _t("Today") : _t("Tap for today")}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => go(1)} hitSlop={10} style={s.arrow}><Feather name="chevron-right" size={22} color={C.brand} /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={() => load(date)} />}>
        {!d && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
        {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}

        {d && !d.school_day && (
          <Card><Empty icon="sun" text={d.off?.why === "holiday" ? _t("Holiday: {name}. No cover needed.", { name: d.off.name ?? "" }) : _t("Not a school day. No cover needed.")} /></Card>
        )}

        {d && d.school_day && (
          <>
            <View style={s.chips}>
              <Chip n={sum.periods} label={_t("periods")} color={C.ink} />
              <Chip n={sum.covered} label={_t("covered")} color={C.ok} />
              <Chip n={sum.free} label={_t("no cover")} color={C.muted} />
              <Chip n={sum.open} label={_t("open")} color={sum.open ? C.err : C.muted} />
            </View>

            <View style={s.actions}>
              {canEdit && sum.open > 0 && <Act icon="zap" label={_t("Suggest for all")} onPress={preview} busy={busy} />}
              {canEdit && <Act icon="user-minus" label={_t("Mark away")} onPress={() => setAway({ staff_id: null, whole: true, from: null, to: null, reason: "" })} />}
              <Act icon="share-2" label={_t("Share")} onPress={share} />
              {canEdit && <Act icon="bar-chart-2" label={_t("Report")} onPress={() => openReport(date.slice(0, 7))} />}
              {canEdit && <Act icon="sliders" label={_t("Rules")} onPress={() => setRules({ ...d.settings, max_per_day: String(d.settings.max_per_day), max_per_week: String(d.settings.max_per_week) })} />}
            </View>

            {!!d.pending_leave?.length && (
              <Card title={_t("Leave waiting for approval")}>
                {d.pending_leave.map((l) => (
                  <Text key={l.leave_id} style={s.meta}>• {l.name}{l.type ? ` · ${_tx(l.type)}` : ""} ({l.from === l.to ? fmtDate(l.from, "medium") : `${fmtDate(l.from, "dayMonth")} – ${fmtDate(l.to, "medium")}`})</Text>
                ))}
                <Text style={s.hint}>{_t("Their periods show here once the leave is approved.")}</Text>
                <Btn title={_t("Leave approval")} icon="check-circle" kind="ghost" onPress={() => navigation.navigate("MainTabs", { screen: "School", params: { screen: "LeaveApproval" } })} />
              </Card>
            )}

            {!d.absent.length && <Card><Empty icon="check-circle" text={_t("Nobody is away. No periods need cover.")} /></Card>}

            {d.absent.map((a) => (
              <Card key={a.staff_id} title={a.name}
                right={a.open > 0 ? <Text style={[s.badge, { color: C.err, borderColor: C.err }]}>{_t("{n} open", { n: a.open })}</Text> : null}>
                <Text style={s.meta}>{a.reasons.map((r) => reasonLabel(r.type, r.type === "away" ? r.label : r.label ? _tx(r.label) : "")
                  + (r.half ? ` · ${r.half === "morning" ? _t("morning") : _t("afternoon")}` : "")
                  + (r.type === "away" && r.from_period != null ? ` · ${_t("periods {from}–{to}", { from: r.from_period, to: r.to_period })}` : "")).join(" · ")}</Text>
                {!a.slots.length && <Text style={[s.meta, { marginTop: 6 }]}>{_t("No classes this day.")}</Text>}
                {a.slots.map((sl) => (
                  <TouchableOpacity key={sl.timetable_id} style={s.slot} disabled={!canEdit && !sl.cover} onPress={() => canEdit ? openSlot(sl, a.name) : null}>
                    <View style={{ width: 92 }}>
                      <Text style={s.pName} numberOfLines={1}>{_tx(sl.period_name) || _t("Period {n}", { n: sl.period_number })}</Text>
                      <Text style={s.meta}>{sl.start}{sl.end ? `–${sl.end}` : ""}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cls} numberOfLines={1}>{sl.class_label}{sl.subject ? ` · ${_tx(sl.subject)}` : ""}</Text>
                      <CoverLine c={sl.cover} />
                    </View>
                    {canEdit && <Feather name={sl.state === "open" ? "plus-circle" : "edit-2"} size={18} color={sl.state === "open" ? C.err : C.muted} />}
                  </TouchableOpacity>
                ))}
              </Card>
            ))}

            {!!d.away?.length && (
              <Card title={_t("Marked away")}>
                {d.away.map((w) => (
                  <View key={w.id} style={s.row}>
                    <Feather name="user-minus" size={14} color={C.muted} />
                    <Text style={[s.meta, { flex: 1 }]}>{w.name}{w.from_period != null ? ` · ${_t("periods {from}–{to}", { from: w.from_period, to: w.to_period })}` : ` · ${_t("whole day")}`}{w.reason ? ` · ${w.reason}` : ""}</Text>
                    {canEdit && <TouchableOpacity onPress={() => dropAway(w)} hitSlop={10}><Feather name="x-circle" size={18} color={C.err} /></TouchableOpacity>}
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {/* ── one period: choose a teacher ── */}
      <Modal visible={!!pick} animationType="slide" transparent onRequestClose={() => setPick(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.head}>{pick ? `${pick.slot.class_label}${pick.slot.subject ? ` · ${_tx(pick.slot.subject)}` : ""}` : ""}</Text>
                <Text style={s.meta}>{pick ? `${periodLabel(pick.slot)} · ${_t("for {teacher}", { teacher: pick.away })}${pick.slot.room ? ` · ${pick.slot.room}` : ""}` : ""}</Text>
              </View>
              <TouchableOpacity onPress={() => setPick(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {!pick?.data ? <ActivityIndicator color={C.brand} style={{ marginVertical: 30 }} /> : (
              <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
                {pick.data.slot.cover && <View style={s.current}><CoverLine c={pick.data.slot.cover} /></View>}
                <Field label={_t("Note for the cover teacher (optional)")} value={note} onChangeText={setNote} placeholder={_t("e.g. Worksheet on the desk")} maxLength={255} />
                <Text style={s.section}>{_t("Free teachers")}</Text>
                {!pick.data.candidates.length && <Text style={s.meta}>{_t("Nobody is free in this period.")}</Text>}
                {pick.data.candidates.map((c, i) => {
                  const mine = pick.data.slot.cover?.staff_id === c.staff_id && pick.data.slot.cover?.status !== "declined";
                  return (
                    <TouchableOpacity key={c.staff_id} style={[s.cand, mine && { borderColor: C.brand }]} disabled={busy} onPress={() => doAssign(c.staff_id)}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.name}>{c.name}{i === 0 && !c.over_limit ? `  ★ ${_t("best fit")}` : ""}{mine ? `  · ${_t("current")}` : ""}</Text>
                        <Text style={s.meta}>{fitLabels(c.reasons).join(" · ")}</Text>
                        {!!c.over_limit && <Text style={[s.meta, { color: C.warn }]}>{c.over_limit.per === "day" ? _t("Daily limit reached ({n}/{limit})", c.over_limit) : _t("Weekly limit reached ({n}/{limit})", c.over_limit)}</Text>}
                      </View>
                      <Feather name="user-check" size={18} color={c.over_limit ? C.warn : C.brand} />
                    </TouchableOpacity>
                  );
                })}
                {!!pick.data.busy.length && (
                  <TouchableOpacity onPress={() => setShowBusy(!showBusy)} style={s.row}>
                    <Feather name={showBusy ? "chevron-up" : "chevron-down"} size={14} color={C.muted} />
                    <Text style={s.meta}>{_t("Not free ({n})", { n: pick.data.busy.length })}</Text>
                  </TouchableOpacity>
                )}
                {showBusy && pick.data.busy.map((b) => (
                  <Text key={b.staff_id} style={[s.meta, { marginLeft: 22 }]}>• {b.name}: {reasonLabel(b.why, b.detail ? _tx(b.detail) : "")}</Text>
                ))}
                <Btn title={_t("No cover (self-study, merged class …)")} icon="slash" kind="ghost" busy={busy} onPress={() => doAssign(null)} />
                {!!pick.data.slot.cover && <Btn title={_t("Remove")} icon="trash-2" kind="danger" busy={busy} onPress={doRemove} />}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── suggest for all ── */}
      <Modal visible={!!plan} animationType="slide" transparent onRequestClose={() => setPlan(null)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={s.sheetHead}>
              <Text style={[s.head, { flex: 1 }]}>{_t("Suggest for all")}</Text>
              <TouchableOpacity onPress={() => setPlan(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <Text style={s.hint}>{_t("Best free teacher for each open period, within the limits. Nothing is saved until you assign.")}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {plan?.plan.map((x) => (
                <View key={x.timetable_id} style={s.row}>
                  <Text style={[s.meta, { width: 70 }]}>{x.start || `#${x.period_number}`}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cls}>{x.class_label}{x.subject ? ` · ${_tx(x.subject)}` : ""}</Text>
                    <Text style={s.meta}>→ {x.name} · {fitLabels(x.reasons).slice(0, 2).join(" · ")}</Text>
                  </View>
                </View>
              ))}
              {plan?.unfilled.map((x) => (
                <View key={`u${x.timetable_id}`} style={s.row}>
                  <Text style={[s.meta, { width: 70 }]}>{x.start || `#${x.period_number}`}</Text>
                  <Text style={[s.meta, { flex: 1, color: C.err }]}>{x.class_label}: {_t("nobody free")}</Text>
                </View>
              ))}
            </ScrollView>
            {!!plan?.plan.length && <Btn title={_t("Assign {n} periods", { n: plan.plan.length })} icon="check" busy={busy} onPress={applyPlan} />}
          </View>
        </View>
      </Modal>

      {/* ── mark away ── */}
      <Modal visible={!!away} animationType="slide" transparent onRequestClose={() => setAway(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={s.sheetHead}>
              <Text style={[s.head, { flex: 1 }]}>{_t("Mark away – {date}", { date: niceDay(date) })}</Text>
              <TouchableOpacity onPress={() => setAway(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <Text style={s.hint}>{_t("For training, trips or meetings without a leave application. Leave, absence in staff attendance and exam duties are picked up by themselves.")}</Text>
            {away && (
              <>
                <Picker label={_t("Teacher")} value={away.staff_id} options={staffOpts} onChange={(v) => setAway({ ...away, staff_id: v })} placeholder={_t("Choose a teacher")} />
                <Toggle label={_t("Whole day")} value={away.whole} onChange={(v) => setAway({ ...away, whole: v })} />
                {!away.whole && (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}><Picker label={_t("From")} value={away.from} options={periodOpts} onChange={(v) => setAway({ ...away, from: v, to: away.to && away.to >= v ? away.to : v })} /></View>
                    <View style={{ flex: 1 }}><Picker label={_t("To")} value={away.to} options={periodOpts.filter((o) => !away.from || o.value >= away.from)} onChange={(v) => setAway({ ...away, to: v })} /></View>
                  </View>
                )}
                <Field label={_t("Reason (optional)")} value={away.reason} onChangeText={(v) => setAway({ ...away, reason: v })} placeholder={_t("e.g. Science fair")} maxLength={120} />
                <Btn title={_t("Save")} icon="check" busy={busy} onPress={saveAway} disabled={!away.whole && !away.from} />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── rules ── */}
      <Modal visible={!!rules} animationType="slide" transparent onRequestClose={() => setRules(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={s.sheetHead}>
              <Text style={[s.head, { flex: 1 }]}>{_t("Cover rules")}</Text>
              <TouchableOpacity onPress={() => setRules(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {rules && (
              <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}><Field label={_t("Most covers a day")} value={rules.max_per_day} onChangeText={(v) => setRules({ ...rules, max_per_day: v.replace(/\D/g, "") })} keyboardType="number-pad" maxLength={1} /></View>
                  <View style={{ flex: 1 }}><Field label={_t("Most covers a week")} value={rules.max_per_week} onChangeText={(v) => setRules({ ...rules, max_per_week: v.replace(/\D/g, "") })} keyboardType="number-pad" maxLength={2} /></View>
                </View>
                <Text style={s.hint}>{_t("0 = no limit. Over the limit you are asked first.")}</Text>
                <Toggle label={_t("Tell the cover teacher (bell + push)")} value={!!rules.notify_teacher} onChange={(v) => setRules({ ...rules, notify_teacher: v ? 1 : 0 })} />
                <Toggle label={_t("Teachers may decline a cover")} hint={_t("The office is told and the period shows as open again.")} value={!!rules.allow_decline} onChange={(v) => setRules({ ...rules, allow_decline: v ? 1 : 0 })} />
                <Toggle label={_t("Morning message when periods still need cover")} value={!!rules.alert_on} onChange={(v) => setRules({ ...rules, alert_on: v ? 1 : 0 })} />
                {!!rules.alert_on && <Field label={_t("Time (24-hour)")} value={rules.alert_time} onChangeText={(v) => setRules({ ...rules, alert_time: v })} placeholder="07:00" maxLength={5} />}
                <Btn title={_t("Save")} icon="check" busy={busy} onPress={saveRules} />
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── report ── */}
      <Modal visible={!!report} animationType="slide" transparent onRequestClose={() => setReport(null)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={s.sheetHead}>
              <TouchableOpacity onPress={() => openReport(shiftMonth(report.month, -1))} hitSlop={10}><Feather name="chevron-left" size={20} color={C.brand} /></TouchableOpacity>
              <Text style={[s.head, { flex: 1, textAlign: "center" }]}>{report ? _t("Cover in {month}", { month: fmtDate(report.month + "-01", "monthYearLong") }) : ""}</Text>
              <TouchableOpacity onPress={() => openReport(shiftMonth(report.month, 1))} hitSlop={10}><Feather name="chevron-right" size={20} color={C.brand} /></TouchableOpacity>
              <TouchableOpacity onPress={() => setReport(null)} hitSlop={10} style={{ marginLeft: 12 }}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {!report?.data ? <ActivityIndicator color={C.brand} style={{ marginVertical: 30 }} /> : (
              <ScrollView style={{ maxHeight: 460 }}>
                <Text style={s.meta}>{_t("{cover} covered · {free} no cover · {declined} declined", report.data.totals)}</Text>
                <View style={[s.tr, { borderBottomWidth: 1, borderColor: C.line, marginTop: 8 }]}>
                  <Text style={[s.th, { flex: 1 }]}>{_t("Teacher")}</Text>
                  <Text style={s.th}>{_t("Gave")}</Text>
                  <Text style={s.th}>{_t("Got")}</Text>
                  <Text style={s.th}>{_t("Declined")}</Text>
                </View>
                {report.data.teachers.map((t) => (
                  <View key={t.staff_id} style={s.tr}>
                    <Text style={[s.td, { flex: 1, textAlign: "left" }]} numberOfLines={1}>{t.name}</Text>
                    <Text style={[s.td, { fontWeight: "800" }]}>{t.covered}</Text>
                    <Text style={s.td}>{t.covered_for_them + t.no_cover}</Text>
                    <Text style={s.td}>{t.declined}</Text>
                  </View>
                ))}
                {!report.data.teachers.length && <Empty icon="calendar" text={_t("No cover this month.")} />}
                <Text style={s.hint}>{_t("Gave = cover periods taken for others. Got = their periods others covered (or no cover).")}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Chip({ n, label, color }) {
  return (
    <View style={s.chip}>
      <Text style={[s.chipN, { color }]}>{n}</Text>
      <Text style={s.chipL}>{label}</Text>
    </View>
  );
}

function Act({ icon, label, onPress, busy }) {
  return (
    <TouchableOpacity style={s.act} onPress={onPress} disabled={busy} activeOpacity={0.8}>
      {busy ? <ActivityIndicator size="small" color={C.brand} /> : <Feather name={icon} size={16} color={C.brand} />}
      <Text style={s.actTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

function CoverLine({ c }) {
  if (!c) return <Text style={[s.meta, { color: C.err, fontWeight: "700" }]}>{_t("Needs cover")}</Text>;
  if (c.kind === "free") return <Text style={s.meta}>{_t("No cover")}{c.note ? ` · ${c.note}` : ""}</Text>;
  const st = STATUS[c.status] ?? STATUS.assigned;
  return (
    <View>
      <Text style={s.meta}>
        <Text style={{ color: C.ink, fontWeight: "700" }}>{c.name}</Text>
        <Text style={{ color: st.color }}>{`  ${st.label}`}</Text>
        {c.status === "declined" ? <Text style={{ color: C.err }}>{` · ${_t("needs someone else")}`}</Text> : null}
      </Text>
      {!!c.response_note && <Text style={s.meta}>“{c.response_note}”</Text>}
      {!!c.conflict && <Text style={[s.meta, { color: C.warn }]}>{_t("Check: {why}", { why: reasonLabel(c.conflict.why, c.conflict.detail ? _tx(c.conflict.detail) : "") })}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  dateBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10, paddingHorizontal: 8 },
  arrow: { padding: 6 },
  dateTxt: { fontSize: 15, fontWeight: "800", color: C.ink },
  dateSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingVertical: 10, alignItems: "center" },
  chipN: { fontSize: 20, fontWeight: "800" },
  chipL: { fontSize: 11, color: C.muted, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  act: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.brandSoft, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  actTxt: { fontSize: 13, fontWeight: "700", color: C.brand },
  badge: { fontSize: 11, fontWeight: "800", borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  slot: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: "#f1f5f9" },
  pName: { fontSize: 13, fontWeight: "700", color: C.ink },
  cls: { fontSize: 14, fontWeight: "700", color: C.ink },
  head: { fontSize: 15, fontWeight: "800", color: C.ink },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  hint: { fontSize: 12, color: C.muted, marginVertical: 6, lineHeight: 17 },
  section: { fontSize: 12, fontWeight: "800", color: C.muted, textTransform: "uppercase", marginTop: 4, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  current: { backgroundColor: C.bg, borderRadius: 10, padding: 10, marginBottom: 8 },
  cand: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10, marginBottom: 8 },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  th: { width: 64, fontSize: 11, fontWeight: "800", color: C.muted, textAlign: "center", textTransform: "uppercase" },
  td: { width: 64, fontSize: 13, color: C.ink, textAlign: "center" },
});
