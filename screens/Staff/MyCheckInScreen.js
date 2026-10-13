/**
 * Staff › My Check-in
 * Check in when you arrive and check out when you leave. If the school asks for it,
 * type the 6-digit code shown on the office screen or scan its QR code, and/or the phone's
 * location is checked against the school's (so check-in only works on site).
 * Below: this month's summary (present, late, half days, leave, absent).
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getMyToday, checkIn, checkOut, getMyMonth, STATUS, thisMonth, addMonths, monthName, days,
} from "../../services/StaffAttendanceApi";
import { niceDate, niceTime } from "../../services/StudentLeaveApi";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import QrScanner from "../../components/QrScanner";
import { hasCamera, askCamera, getPosition } from "../../services/DeviceSensors";
import { _t, _tx } from "../../services/i18n";

export default function MyCheckInScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [today, setToday] = useState(null);
  const [month, setMonth] = useState(thisMonth());
  const [sum, setSum]     = useState(null);
  const [code, setCode]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);
  const [scan, setScan]   = useState(false);
  const [step, setStep]   = useState("");
  const [showCode, setShowCode] = useState(false);   // fallback: office code when GPS fails

  const loadToday = useCallback(async () => {
    try { setToday((await getMyToday(user)) ?? {}); setErr(null); } catch (e) { setErr(e.message); }
  }, [user]);
  const loadMonth = useCallback(async () => {
    try { setSum(await getMyMonth(user, month)); } catch { setSum({ summary: null }); }
  }, [user, month]);
  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { if (today?.linked) loadMonth(); }, [today?.linked, loadMonth]);

  const set0   = today?.settings ?? {};
  // "Location, or the office code if GPS fails"
  const either = !!(set0.require_location && set0.location_or_code && !set0.require_office_code);

  const act = async (fn, onFail) => {
    setBusy(true);
    try { await fn(); setCode(""); setShowCode(false); await Promise.all([loadToday(), loadMonth()]); }
    catch (e) { onFail ? onFail(e) : Alert.alert(_t("Check-in"), _tx(e.message)); }
    finally { setBusy(false); setStep(""); }
  };

  /**
   * Check in with a typed code or scanned QR text; adds the phone's location when the school asks for it.
   * In "location or code" mode a code replaces the location check, and a failed location check
   * opens the code option.
   */
  const doCheckIn = (codeText) => {
    const viaCode = either && !!String(codeText ?? "").trim();
    return act(async () => {
      let where;
      if (set0.require_location && !viaCode) {
        setStep(_t("Checking your location…"));
        where = await getPosition();
      }
      setStep(_t("Checking in…"));
      await checkIn(user, codeText, where);
    }, either && !viaCode ? (e) => {
      setShowCode(true);
      const msg = e.message.includes("office code") ? _tx(e.message) : `${_tx(e.message)}\n\n${_t("You can check in with the office code / QR instead.")}`;
      Alert.alert(_t("Check-in"), msg);
    } : null);
  };

  const openScanner = async () => {
    try {
      if (await askCamera()) setScan(true);
      else Alert.alert(_t("Camera"), _t("Allow camera access for this app to scan the code, or type the code instead."));
    } catch (e) { Alert.alert(_t("Camera"), _tx(e.message)); }
  };

  if (!today && !err) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  if (err) return <Empty icon="alert-circle" text={_tx(err)} />;
  if (!today.linked) {
    return (
      <View style={{ padding: 16 }}>
        <Card><Empty icon="user-x" text={_t("Your login is not linked to a staff record, so you can't check in. Ask the office to link your login to your staff profile.")} /></Card>
        {today.is_admin && <Btn title={_t("Mark staff attendance")} icon="users" onPress={() => navigation.navigate("StaffAttendance")} />}
      </View>
    );
  }

  const r   = today.record;
  const set = today.settings ?? {};
  const s   = sum?.summary;
  const st  = r ? STATUS[r.status] : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { loadToday(); loadMonth(); }} />}>
      <Card title={_t("Today · {today}", { today: niceDate(today.today) })}>
        <View style={sx.row}>
          <View style={sx.timeBox}>
            <Text style={sx.timeLbl}>{_t("Checked in")}</Text>
            <Text style={sx.time}>{r?.check_in ? niceTime(r.check_in) : "—"}</Text>
          </View>
          <View style={sx.timeBox}>
            <Text style={sx.timeLbl}>{_t("Checked out")}</Text>
            <Text style={sx.time}>{r?.check_out ? niceTime(r.check_out) : "—"}</Text>
          </View>
        </View>
        {!!st && (
          <View style={[sx.badge, { backgroundColor: st.bg }]}>
            <Text style={[sx.badgeTxt, { color: st.fg }]}>
              {r.status === "L" && r.leave_half ? _t("Half-day leave") : _tx(st.label)}
              {r.late_minutes > 0 ? ` ${_t("· {late_minutes} min late", { late_minutes: r.late_minutes })}` : ""}
            </Text>
          </View>
        )}
        {!r?.check_in && r?.status !== "L" && r?.status !== "H" && (
          <>
            {either && (
              <>
                <Btn title={_t("Check in at school")} icon="map-pin" kind={showCode ? "ghost" : "primary"} busy={busy}
                  onPress={() => doCheckIn("")} />
                {!showCode && (
                  <TouchableOpacity onPress={() => setShowCode(true)} style={{ alignSelf: "center", padding: 8 }}>
                    <Text style={sx.link}>{_t("Location not working? Use the office code")}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {set.self_checkin && (set.require_office_code || (either && showCode)) && (
              <>
                {either && <Text style={sx.or}>{_t("or use the office code")}</Text>}
                {set.allow_qr && hasCamera() && (
                  <Btn title={_t("Scan QR to check in")} icon="maximize" busy={busy} onPress={openScanner} />
                )}
                {set.allow_qr && hasCamera() && <Text style={sx.or}>{_t("or type the code")}</Text>}
                <Field label={_t("Office code")} placeholder={_t("6-digit code on the office screen")} keyboardType="number-pad"
                  maxLength={7} value={code} onChangeText={setCode} />
              </>
            )}
            {!(either && !showCode) && (
              <Btn title={either ? _t("Check in with code") : set.require_location && !set.require_office_code ? _t("Check in at school") : _t("Check in")}
                icon={set.require_location && !set.require_office_code && !either ? "map-pin" : "log-in"}
                kind={(set.require_office_code || either) && set.allow_qr && hasCamera() ? "ghost" : "primary"}
                busy={busy} disabled={!set.self_checkin}
                onPress={() => {
                  if ((set.require_office_code || either) && code.replace(/\D/g, "").length !== 6) {
                    Alert.alert(_t("Check-in"), set.allow_qr && hasCamera()
                      ? _t("Scan the QR code, or type the 6-digit code shown on the office screen.")
                      : _t("Type the 6-digit code shown on the office screen."));
                    return;
                  }
                  doCheckIn(code);
                }} />
            )}
            {!!step && <Text style={sx.hint}>{_tx(step)}</Text>}
            <Text style={sx.hint}>
              {set.self_checkin
                ? _t("School starts {school_start} – after {late_grace_minutes} min you're marked late.", { school_start: niceTime(set.school_start), late_grace_minutes: set.late_grace_minutes })
                  + (either ? " Your location is checked – or use the office code if location doesn't work."
                    : set.require_location ? " Your location is checked when you check in." : "")
                : _t("Self check-in is turned off – the office marks attendance.")}
            </Text>
          </>
        )}
        {!!r?.check_in && !r?.check_out && (
          <Btn title={_t("Check out")} icon="log-out" kind="ghost" busy={busy} onPress={() => act(() => checkOut(user))} />
        )}
        {r?.status === "L" && !r.leave_half && <Text style={sx.hint}>{_t("You are on approved leave today.")}</Text>}
      </Card>

      <QrScanner visible={scan} onClose={() => setScan(false)}
        onScan={(text) => { setScan(false); doCheckIn(text); }} />

      <Card title={_t("My month")} right={
        <View style={sx.monthNav}>
          <TouchableOpacity onPress={() => setMonth(addMonths(month, -1))} hitSlop={10}><Feather name="chevron-left" size={20} color={C.brand} /></TouchableOpacity>
          <Text style={sx.monthTxt}>{monthName(month)}</Text>
          <TouchableOpacity onPress={() => month < thisMonth() && setMonth(addMonths(month, 1))} hitSlop={10}>
            <Feather name="chevron-right" size={20} color={month < thisMonth() ? C.brand : "#cbd5e1"} />
          </TouchableOpacity>
        </View>
      }>
        {!s ? <Empty icon="calendar" text={_t("Nothing yet for this month.")} /> : (
          <>
            <View style={sx.grid}>
              <Stat n={s.present} label={_t("Present")} color={C.ok} />
              <Stat n={s.late} label={_t("Late")} color={C.warn} />
              <Stat n={s.half_days} label={_t("Half days")} color="#92400e" />
              <Stat n={days(s.leave_paid + s.leave_unpaid)} label={_t("Leave")} color="#3730a3" />
              <Stat n={s.absent} label={_t("Absent")} color={C.err} />
              <Stat n={s.not_marked} label={_t("Not marked")} color={C.muted} />
            </View>
            <Text style={sx.hint}>{_t("{working_days} working days this month (weekly offs and holidays not counted).", { working_days: s.working_days })}</Text>
            {Object.entries(s.days ?? {}).sort(([a], [b]) => (a < b ? 1 : -1)).map(([d, x]) => {
              const t = STATUS[x.status] ?? STATUS.P;
              return (
                <View key={d} style={sx.day}>
                  <Text style={sx.dayDate}>{niceDate(d)}</Text>
                  <Text style={sx.dayMeta}>
                    {[x.check_in && niceTime(x.check_in), x.check_out && niceTime(x.check_out)].filter(Boolean).join(" – ")}
                    {x.late_minutes > 0 ? ` ${_t("· {late_minutes} min late", { late_minutes: x.late_minutes })}` : ""}
                    {x.leave_type ? ` · ${_tx(x.leave_type)}` : ""}
                  </Text>
                  <View style={[sx.chip, { backgroundColor: t.bg }]}><Text style={[sx.chipTxt, { color: t.fg }]}>{x.half && x.status === "L" ? _t("½L") : _tx(t.short)}</Text></View>
                </View>
              );
            })}
          </>
        )}
      </Card>
    </ScrollView>
  );
}

function Stat({ n, label, color }) {
  return (
    <View style={sx.stat}>
      <Text style={[sx.statN, { color }]}>{_tx(n)}</Text>
      <Text style={sx.statL}>{_tx(label)}</Text>
    </View>
  );
}

const sx = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginBottom: 8 },
  timeBox: { flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 12, alignItems: "center" },
  timeLbl: { fontSize: 11, color: C.muted, fontWeight: "700", textTransform: "uppercase" },
  time: { fontSize: 22, fontWeight: "800", color: C.ink, marginTop: 4 },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 6 },
  badgeTxt: { fontWeight: "800", fontSize: 12 },
  hint: { fontSize: 12, color: C.muted, marginTop: 6 },
  or: { fontSize: 12, color: C.muted, textAlign: "center", marginVertical: 8 },
  link: { fontSize: 13, color: C.brand, fontWeight: "700" },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthTxt: { fontSize: 13, fontWeight: "700", color: C.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  stat: { width: "33.33%", padding: 4 },
  statN: { fontSize: 22, fontWeight: "800", textAlign: "center", backgroundColor: C.bg, borderTopLeftRadius: 10, borderTopRightRadius: 10, paddingTop: 8 },
  statL: { fontSize: 11, color: C.muted, textAlign: "center", backgroundColor: C.bg, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, paddingBottom: 8 },
  day: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 8 },
  dayDate: { fontSize: 13, fontWeight: "700", color: C.ink, width: 92 },
  dayMeta: { flex: 1, fontSize: 12, color: C.muted },
  chip: { minWidth: 30, alignItems: "center", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  chipTxt: { fontWeight: "800", fontSize: 12 },
});
