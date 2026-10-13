/**
 * Seating plan for one sitting (exam + date + time): choose classes and halls, generate, adjust seats
 * by tapping (tap a student, then the seat to move to – an occupied seat swaps), publish, print.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker } from "../../components/ReportCardUI";
import { StatusChip } from "./ExamLogisticsScreen";
import {
  getPlan, getHalls, generatePlan, moveSeat, publishPlan, deletePlan, seatingHtml, attendanceSheetHtml, sharePdf, letterheadFor,
  niceDate, timeRange, rowLabel, CLASS_COLORS,
} from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

const MODES = [{ value: "mixed", get label() { return _t("Mix classes"); }, get sub() { return _t("Neighbours write different papers"); } }, { value: "class", get label() { return _t("Class by class"); }, get sub() { return _t("Roll order, one class after another"); } }];
const SPACINGS = [{ value: "all", get label() { return _t("Every seat"); } }, { value: "alternate", get label() { return _t("Every other seat in a row"); } }, { value: "checker", get label() { return _t("Chessboard (no one beside or in front)"); } }];

function usable(h, spacing) {
  const blocked = new Set(h.blocked ?? []);
  let n = 0;
  for (let r = 1; r <= h.rows; r++) for (let c = 1; c <= h.cols; c++) {
    if (blocked.has(`${rowLabel(r)}${c}`)) continue;
    if (spacing === "alternate" && c % 2 === 0) continue;
    if (spacing === "checker" && (r + c) % 2 === 1) continue;
    n++;
  }
  return n;
}

export default function SeatingPlanScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const p = route?.params ?? {};
  const sitting = p.sitting ?? {};
  const [planId, setPlanId] = useState(p.planId ?? null);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(!p.planId && p.canEdit !== false);
  const [halls, setHalls] = useState(null);
  const [sel, setSel] = useState({});          // class_id → "all" | [section_id…]
  const [hallIds, setHallIds] = useState([]);
  const [mode, setMode] = useState("mixed");
  const [spacing, setSpacing] = useState("all");
  const [busy, setBusy] = useState(false);
  const [hallTab, setHallTab] = useState(0);
  const [picked, setPicked] = useState(null);  // enrollment_id selected for moving
  const [find, setFind] = useState("");

  const loadPlan = useCallback(async (id = planId) => {
    if (!id) return;
    try { const r = await getPlan(user, id); setPlan(r.plan); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [user, planId]);
  useFocusEffect(useCallback(() => { loadPlan(); }, [loadPlan]));

  useEffect(() => {
    navigation.setOptions?.({ title: `${niceDate(sitting.exam_date ?? plan?.exam_date).replace(/ \d{4}$/, "")} · ${p.examName ?? plan?.exam?.name ?? _t("Seating")}` });
  }, [plan?.exam_date]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the setup form: halls + default choices (from the plan when redoing it)
  useEffect(() => {
    if (!editing) return;
    let off = false;
    getHalls(user, { branch_id: p.branchId || undefined }).then((r) => {
      if (off) return;
      const list = (r.halls ?? []).filter((h) => h.active);
      setHalls(list);
      if (plan) {
        setHallIds(plan.hall_ids.filter((id) => list.some((h) => h.hall_id === id)));
        setMode(plan.mode); setSpacing(plan.spacing);
        const s = {};
        plan.classes.forEach((g) => { if (!g.section_id) s[g.class_id] = "all"; else s[g.class_id] = s[g.class_id] === "all" ? "all" : [...(s[g.class_id] ?? []), g.section_id]; });
        setSel(s);
      } else {
        const s = {};
        (sitting.classes ?? []).forEach((c) => { s[c.class_id] = "all"; });
        setSel(s);
        // enough halls for everyone, in name order
        const need = sitting.students ?? 0;
        let cap = 0; const ids = [];
        for (const h of list) { if (cap >= need) break; ids.push(h.hall_id); cap += h.capacity; }
        setHallIds(ids);
      }
    }).catch((e) => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [editing]);   // eslint-disable-line react-hooks/exhaustive-deps

  const classesForForm = useMemo(() => {
    if (sitting.classes?.length) return sitting.classes;
    // opened from a plan whose sitting info isn't at hand: use the plan's classes
    return (plan?.classes ?? []).map((g, i) => ({ class_id: g.class_id, name: plan.class_names?.[i] ?? `Class ${g.class_id}`, sections: [], students: null, subjects: [] }));
  }, [sitting, plan]);

  const chosenStudents = useMemo(() => classesForForm.reduce((a, c) => {
    const v = sel[c.class_id];
    if (!v) return a;
    if (v === "all") return a + (c.students ?? 0);
    return a + (c.sections ?? []).filter((x) => v.includes(x.section_id)).reduce((b, x) => b + x.students, 0);
  }, 0), [classesForForm, sel]);
  const seats = useMemo(() => (halls ?? []).filter((h) => hallIds.includes(h.hall_id)).reduce((a, h) => a + usable(h, spacing), 0), [halls, hallIds, spacing]);

  const toggleClass = (cid) => setSel((x) => { const n = { ...x }; if (n[cid]) delete n[cid]; else n[cid] = "all"; return n; });
  const toggleSection = (cid, sid, allIds) => setSel((x) => {
    const cur = x[cid] === "all" ? allIds : (x[cid] ?? []);
    const next = cur.includes(sid) ? cur.filter((y) => y !== sid) : [...cur, sid];
    const n = { ...x };
    if (!next.length) delete n[cid]; else n[cid] = next.length === allIds.length ? "all" : next;
    return n;
  });
  const toggleHall = (id) => setHallIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  const generate = async () => {
    const classes = [];
    Object.entries(sel).forEach(([cid, v]) => { if (v === "all") classes.push({ class_id: +cid }); else v.forEach((sid) => classes.push({ class_id: +cid, section_id: sid })); });
    if (!classes.length) { Alert.alert(_t("Seating plan"), _t("Choose at least one class.")); return; }
    if (!hallIds.length) { Alert.alert(_t("Seating plan"), _t("Choose at least one hall.")); return; }
    setBusy(true);
    try {
      const r = await generatePlan(user, { exam_id: p.examId ?? plan?.exam?.exam_id, session_id: p.sessionId ?? plan?.session_id, branch_id: p.branchId ?? plan?.branch_id ?? 0,
        exam_date: sitting.exam_date ?? plan?.exam_date, start_time: sitting.start_time ?? plan?.start_time, end_time: sitting.end_time ?? plan?.end_time,
        classes, hall_ids: hallIds, mode, spacing });
      setPlan(r.plan); setPlanId(r.plan.plan_id); setEditing(false); setHallTab(0); setPicked(null);
    } catch (e) { Alert.alert(_t("Seating plan"), _tx(e.message)); } finally { setBusy(false); }
  };

  const tapSeat = (hall, r, c, student) => {
    if (!plan?.can?.edit) return;
    if (!picked) { if (student) setPicked(student.enrollment_id); return; }
    if (student && student.enrollment_id === picked) { setPicked(null); return; }
    const who = plan.halls.flatMap((h) => h.seats).find((x) => x.enrollment_id === picked);
    const target = `${hall.name} ${rowLabel(r)}${c}`;
    Alert.alert(student ? _t("Swap seats?") : _t("Move student?"),
      student ? _t("{name} and {name2} swap seats.", { name: who?.name, name2: student.name }) : _t("{name} moves to {target}.", { name: who?.name, target }), [
        { text: _t("Cancel"), style: "cancel", onPress: () => setPicked(null) },
        { text: student ? _t("Swap") : _t("Move"), onPress: async () => {
          setBusy(true);
          try { const res = await moveSeat(user, { plan_id: plan.plan_id, enrollment_id: picked, hall_id: hall.hall_id, row: r, col: c }); setPlan(res.plan); }
          catch (e) { Alert.alert(_t("Seat"), _tx(e.message)); } finally { setBusy(false); setPicked(null); }
        } },
      ]);
  };

  const togglePublish = () => {
    const pub = plan.status !== "published";
    Alert.alert(pub ? _t("Publish seating plan?") : _t("Unpublish?"), pub
      ? _t("Students see their hall and seat on the admit card, and invigilators are told about their duty.")
      : _t("Seats disappear from admit cards until you publish again."), [
      { text: _t("Cancel"), style: "cancel" },
      { text: pub ? _t("Publish") : _t("Unpublish"), onPress: async () => {
        setBusy(true);
        try { const r = await publishPlan(user, plan.plan_id, pub); setPlan(r.plan); if (pub && r.notified) Alert.alert(_t("Published"), _t("{notified} invigilator notification{pl} sent.", { notified: r.notified, pl: r.notified === 1 ? "" : "s" })); }
        catch (e) { Alert.alert(_t("Seating plan"), _tx(e.message)); } finally { setBusy(false); }
      } },
    ]);
  };

  const remove = () => Alert.alert(_t("Delete seating plan?"), _t("Seats and invigilator duties for this sitting are removed."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Delete"), style: "destructive", onPress: async () => {
      setBusy(true);
      try { await deletePlan(user, plan.plan_id); navigation.goBack(); } catch (e) { Alert.alert(_t("Seating plan"), _tx(e.message)); setBusy(false); }
    } },
  ]);

  const print = async (kind) => {
    setBusy(true);
    try {
      const school = await letterheadFor(user);
      await sharePdf(kind === "sheet" ? attendanceSheetHtml(plan, school) : seatingHtml(plan, school), kind === "sheet" ? "Attendance sheets" : "Seating chart");
    }
    catch (e) { Alert.alert(_t("Print"), _tx(e.message)); } finally { setBusy(false); }
  };

  // ── setup form ──
  if (editing) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <Text style={s.head}>{niceDate(sitting.exam_date ?? plan?.exam_date)} · {timeRange(sitting.start_time ?? plan?.start_time, sitting.end_time ?? plan?.end_time)}</Text>
        <Card title={_t("Who sits this paper")}>
          {classesForForm.map((c) => {
            const v = sel[c.class_id];
            const secIds = (c.sections ?? []).map((x) => x.section_id).filter((x) => x !== null);
            return (
              <View key={c.class_id} style={{ marginBottom: 8 }}>
                <TouchableOpacity style={s.check} onPress={() => toggleClass(c.class_id)}>
                  <Feather name={v ? "check-square" : "square"} size={18} color={v ? C.brand : C.muted} />
                  <Text style={s.checkTxt}>{_tx(c.name)}{c.students != null ? ` ${_t("· {students} students", { students: c.students })}` : ""}</Text>
                </TouchableOpacity>
                {!!c.subjects?.length && <Text style={s.sub}>{c.subjects.join(", ")}</Text>}
                {secIds.length > 1 && !!v && (
                  <View style={s.chips}>
                    {c.sections.filter((x) => x.section_id !== null).map((x) => {
                      const on = v === "all" || v.includes(x.section_id);
                      return (
                        <TouchableOpacity key={x.section_id} style={[s.pill, on && s.pillOn]} onPress={() => toggleSection(c.class_id, x.section_id, secIds)}>
                          <Text style={[s.pillTxt, on && { color: C.brand }]}>{_tx(x.name)} · {_tx(x.students)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
          {!classesForForm.length && <Text style={s.sub}>{_t("No classes have a paper at this time.")}</Text>}
        </Card>
        <Card title={_t("Halls (filled in the order you pick them)")}>
          {!halls && <ActivityIndicator color={C.brand} />}
          {halls && !halls.length && <Empty icon="grid" text={_t("No exam halls yet. Add them under Exam halls first.")} />}
          {(halls ?? []).map((h) => {
            const i = hallIds.indexOf(h.hall_id);
            return (
              <TouchableOpacity key={h.hall_id} style={s.check} onPress={() => toggleHall(h.hall_id)}>
                {i >= 0 ? <View style={s.order}><Text style={s.orderTxt}>{i + 1}</Text></View> : <Feather name="square" size={18} color={C.muted} />}
                <Text style={s.checkTxt}>{_tx(h.name)}</Text>
                <Text style={s.sub}>{_t("{h} seats", { h: usable(h, spacing) })}</Text>
              </TouchableOpacity>
            );
          })}
        </Card>
        <Card title={_t("How to seat")}>
          <Picker label={_t("Arrangement")} value={mode} options={MODES} onChange={setMode} />
          <Picker label={_t("Spacing")} value={spacing} options={SPACINGS} onChange={setSpacing} />
          <View style={[s.counter, seats < chosenStudents && { borderColor: "#d03b3b" }]}>
            <Feather name={seats >= chosenStudents ? "check-circle" : "alert-octagon"} size={15} color={seats >= chosenStudents ? "#0ca30c" : "#d03b3b"} />
            <Text style={s.counterTxt}>{_t("{chosenStudents} students · {seats} seats{v}", { chosenStudents, seats, v: seats < chosenStudents ? ` ${_t("– {v} short", { v: chosenStudents - seats })}` : "" })}</Text>
          </View>
        </Card>
        <Btn title={plan ? _t("Generate again") : _t("Generate seating plan")} icon="shuffle" busy={busy} onPress={generate} disabled={!chosenStudents || seats < chosenStudents} />
        {plan && <Btn title={_t("Cancel")} kind="ghost" onPress={() => setEditing(false)} />}
      </ScrollView>
    );
  }

  if (!plan && !planId) {
    return <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}><Card><Empty icon="grid" text={_t("No seating plan for this sitting yet. The exam office makes it.")} /></Card></View>;
  }
  if (!plan) {
    return <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>{err ? <Card><Empty icon="alert-circle" text={_tx(err)} /></Card> : <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}</View>;
  }

  const can = plan.can ?? {};
  const halls2 = plan.halls;
  const hall = halls2[Math.min(hallTab, halls2.length - 1)];
  const classIdx = {};
  halls2.forEach((h) => h.seats.forEach((x) => { if (!(x.class_id in classIdx)) classIdx[x.class_id] = Object.keys(classIdx).length; }));
  const classLegend = {};
  halls2.forEach((h) => h.seats.forEach((x) => { classLegend[x.class_id] = x.class_only || x.class_name; }));
  const found = find.trim().length >= 2 ? halls2.flatMap((h) => h.seats.filter((x) => `${x.name} ${x.roll}`.toLowerCase().includes(find.trim().toLowerCase())).map((x) => ({ ...x, hall: h.name }))) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{niceDate(plan.exam_date)}</Text>
            <Text style={s.sub}>{_t("{start_time} · {students} students · {label} · {label2}", { start_time: timeRange(plan.start_time, plan.end_time), students: plan.students, label: MODES.find((m) => m.value === plan.mode)?.label, label2: SPACINGS.find((m) => m.value === plan.spacing)?.label })}</Text>
            <Text style={s.sub}>{plan.class_names.join(", ")}</Text>
          </View>
          <StatusChip status={plan.status} />
        </View>
        <View style={s.actions}>
          {can.approve && <Btn title={plan.status === "published" ? _t("Unpublish") : _t("Publish")} icon={plan.status === "published" ? "eye-off" : "send"} kind={plan.status === "published" ? "ghost" : "primary"} onPress={togglePublish} disabled={busy} style={s.act} />}
          <Btn title={_t("Invigilators")} icon="user-check" kind="ghost" onPress={() => navigation.navigate("Invigilation", { planId: plan.plan_id, schoolName: p.schoolName })} style={s.act} />
          <Btn title={_t("Seating chart")} icon="printer" kind="ghost" onPress={() => print("chart")} disabled={busy} style={s.act} />
          <Btn title={_t("Sign-in sheets")} icon="file-text" kind="ghost" onPress={() => print("sheet")} disabled={busy} style={s.act} />
          {can.edit && plan.status !== "published" && <Btn title={_t("Change & regenerate")} icon="shuffle" kind="ghost" onPress={() => setEditing(true)} style={s.act} />}
        </View>
        {plan.status === "published" && can.edit && <Text style={s.sub}>{_t("To regenerate, unpublish first. Single seats can still be moved.")}</Text>}
      </Card>

      <TextInput value={find} onChangeText={setFind} placeholder={_t("Find a student (name or roll)")} placeholderTextColor="#94a3b8" style={s.search} />
      {found.slice(0, 8).map((x) => (
        <TouchableOpacity key={x.enrollment_id} onPress={() => { setHallTab(halls2.findIndex((h) => h.name === x.hall)); setPicked(can.edit ? x.enrollment_id : null); setFind(""); }}>
          <Text style={s.found}>{_tx(x.name)} · {_tx(x.class_name)}{" "}{_t("· Roll")}{" "}{_tx(x.roll)} → {_tx(x.hall)} <Text style={{ fontWeight: "800" }}>{_tx(x.label)}</Text></Text>
        </TouchableOpacity>
      ))}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
        {halls2.map((h, i) => (
          <TouchableOpacity key={h.hall_id} style={[s.pill, i === hallTab && s.pillOn]} onPress={() => setHallTab(i)}>
            <Text style={[s.pillTxt, i === hallTab && { color: C.brand }]}>{_tx(h.name)} · {_tx(h.used)}/{_tx(h.usable)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {hall && (
        <Card title={_tx(hall.name)} right={hall.location ? <Text style={s.sub}>{_tx(hall.location)}</Text> : null}>
          {Object.keys(classLegend).length > 1 && (
            <View style={s.legend}>
              {Object.entries(classLegend).map(([cid, name]) => (
                <View key={cid} style={s.legendItem}><View style={[s.legendBox, { backgroundColor: CLASS_COLORS[(classIdx[cid] ?? 0) % 3] }]} /><Text style={s.legendTxt}>{_tx(name)}</Text></View>
              ))}
            </View>
          )}
          {can.edit && <Text style={s.sub}>{picked ? _t("Now tap the seat to move to (an occupied seat swaps). Tap the student again to cancel.") : _t("Tap a student to move them.")}</Text>}
          <Text style={s.front}>{_t("Front of the room")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {Array.from({ length: hall.rows }, (_, i) => {
                const r = i + 1;
                return (
                  <View key={r} style={{ flexDirection: "row", marginBottom: 4 }}>
                    {Array.from({ length: hall.cols }, (_, j) => {
                      const c = j + 1;
                      const lab = `${rowLabel(r)}${c}`;
                      const st = hall.seats.find((x) => x.row === r && x.col === c);
                      const blocked = hall.blocked.includes(lab);
                      const col = st ? CLASS_COLORS[(classIdx[st.class_id] ?? 0) % 3] : null;
                      const isPicked = st && st.enrollment_id === picked;
                      return (
                        <TouchableOpacity key={c} disabled={blocked || busy || !can.edit} onPress={() => tapSeat(hall, r, c, st)} activeOpacity={0.7}
                          style={[s.seat, blocked && s.seatBlocked, st && { borderLeftColor: col, borderLeftWidth: 4, backgroundColor: `${col}1a` }, isPicked && s.seatPicked]}
                          accessibilityLabel={st ? _t("{lab}, {name}, {class_name}, roll {roll}", { lab, name: st.name, class_name: st.class_name, roll: st.roll }) : `${_tx(lab)}${blocked ? _t(", blocked") : _t(", empty")}`}>
                          <Text style={s.seatLab}>{_tx(lab)}</Text>
                          {blocked ? <Feather name="x" size={12} color="#94a3b8" /> : st ? (
                            <>
                              <Text style={s.seatCls} numberOfLines={1}>{_tx(st.class_name)}</Text>
                              <Text style={s.seatRoll} numberOfLines={1}>{st.roll ? _t("Roll {roll}", { roll: st.roll }) : _tx(st.name.split(" ")[0])}</Text>
                            </>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
          <Text style={[s.head, { marginTop: 10 }]}>{_t("Door list")}</Text>
          {hall.door.map((d) => (
            <Text key={d.class_name} style={s.doorRow}>{_t("{class_name}: roll {from}{v} ({count})", { class_name: d.class_name, from: d.from, v: d.to && d.to !== d.from ? ` – ${d.to}` : "", count: d.count })}</Text>
          ))}
          <Text style={[s.head, { marginTop: 10 }]}>{_t("Invigilators")}</Text>
          <Text style={s.sub}>{hall.duties.length ? hall.duties.map((d) => `${d.name} (${d.role_label})`).join(", ") : _t("None yet – tap Invigilators above.")}</Text>
        </Card>
      )}
      {can.delete && <Btn title={_t("Delete seating plan")} icon="trash-2" kind="danger" onPress={remove} disabled={busy} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { fontSize: 13, fontWeight: "800", color: C.ink, marginBottom: 8 },
  title: { fontSize: 16, fontWeight: "800", color: C.ink },
  sub: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 17 },
  check: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  checkTxt: { flex: 1, fontSize: 14, fontWeight: "600", color: C.ink },
  order: { width: 18, height: 18, borderRadius: 4, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  orderTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginLeft: 28, marginTop: 4 },
  pill: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  pillOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  pillTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  counter: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, padding: 10, marginTop: 4 },
  counterTxt: { fontSize: 13, fontWeight: "700", color: C.ink },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  act: { flexGrow: 1, flexBasis: "45%", marginTop: 0 },
  search: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink },
  found: { fontSize: 12.5, color: C.ink, paddingVertical: 6, paddingHorizontal: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendBox: { width: 10, height: 10, borderRadius: 2 },
  legendTxt: { fontSize: 11.5, color: "#334155" },
  front: { fontSize: 10.5, color: C.muted, textAlign: "center", marginVertical: 6, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  seat: { width: 62, height: 52, marginRight: 4, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", padding: 3, alignItems: "center", justifyContent: "center" },
  seatBlocked: { backgroundColor: "#e2e8f0", borderColor: "#e2e8f0" },
  seatPicked: { borderColor: "#0f172a", borderWidth: 2 },
  seatLab: { fontSize: 9, fontWeight: "800", color: C.muted },
  seatCls: { fontSize: 9.5, fontWeight: "700", color: C.ink },
  seatRoll: { fontSize: 9.5, color: "#334155" },
  doorRow: { fontSize: 12.5, color: C.ink, marginBottom: 3 },
});
