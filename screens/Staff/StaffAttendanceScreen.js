/**
 * Staff › Staff Attendance (owner / admin / principal)
 * See who checked in today, mark or correct any day (Present, Absent, Half day, Leave, Holiday),
 * open the office code screen, the monthly report, and the check-in settings.
 * Approved staff leave already shows as "L".
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getDay, markDay, getSettings, saveSettings, setSchoolLocation, STATUS } from "../../services/StaffAttendanceApi";
import { getPosition } from "../../services/DeviceSensors";
import { ymd, niceDate, niceTime } from "../../services/StudentLeaveApi";
import { C, Card, Btn, Field, Toggle, Empty } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import { _t, _tx } from "../../services/i18n";

const CHOICES = ["P", "A", "HD", "L"];

// How staff check in = two server flags (require_office_code, require_location)
const METHODS = [
  { key: "tap",      code: false, loc: false, icon: "log-in",   get label() { return _t("Just tap Check in"); },
    get hint() { return _t("Quickest, but staff could check in from anywhere."); } },
  { key: "location", code: false, loc: true,  icon: "map-pin",  get label() { return _t("Location – must be at school"); },
    get hint() { return _t("One tap; the phone's GPS must be within the allowed distance of school."); } },
  { key: "either",   code: false, loc: true,  either: true, icon: "life-buoy", get label() { return _t("Location, or office code if GPS fails"); },
    get hint() { return _t("Staff tap Check in at school; if the phone can't get a good location (e.g. indoors), they scan the QR or type the code instead."); } },
  { key: "code",     code: true,  loc: false, icon: "hash",     get label() { return _t("Office code / QR"); },
    get hint() { return _t("Staff scan the QR or type the 6-digit code from the office screen (code changes every minute)."); } },
  { key: "both",     code: true,  loc: true,  icon: "shield",   get label() { return _t("Office code / QR + location"); },
    get hint() { return _t("Strictest: both the code and the phone's location are checked."); } },
];
const methodOf = (s) => METHODS.find((m) => m.code === !!s.require_office_code && m.loc === !!s.require_location
  && !!m.either === !!(s.location_or_code && s.require_location && !s.require_office_code))?.key ?? "tap";

export default function StaffAttendanceScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [date, setDate]   = useState(ymd(new Date()));
  const [day, setDay]     = useState(null);
  const [edits, setEdits] = useState({});          // staff_id → status
  const [busy, setBusy]   = useState(false);
  const [showSet, setShowSet] = useState(false);

  const load = useCallback(async () => {
    try { const d = await getDay(user, date); setDay({ ...(d ?? {}), staff: Array.isArray(d?.staff) ? d.staff : [] }); setEdits({}); }
    catch (e) { Alert.alert(_t("Staff attendance"), _tx(e.message)); setDay({ staff: [] }); }
  }, [user, date]);
  useEffect(() => { setDay(null); load(); }, [load]);

  const statusOf = (s) => edits[s.staff_id] ?? s.record?.status ?? null;
  const counts = useMemo(() => {
    const c = { P: 0, A: 0, HD: 0, L: 0, H: 0, none: 0, late: 0 };
    (day?.staff ?? []).forEach((s) => {
      const x = statusOf(s);
      x ? (c[x] = (c[x] ?? 0) + 1) : c.none++;
      if (s.record?.late_minutes > 0) c.late++;
    });
    return c;
  }, [day, edits]);   // eslint-disable-line react-hooks/exhaustive-deps

  const allPresent = () => {
    const e = { ...edits };
    (day?.staff ?? []).forEach((s) => { if (!statusOf(s)) e[s.staff_id] = "P"; });
    setEdits(e);
  };

  const save = async () => {
    const marks = Object.entries(edits).map(([staff_id, status]) => ({ staff_id: Number(staff_id), status }));
    if (!marks.length) return;
    setBusy(true);
    try { const n = await markDay(user, date, marks); await load(); Alert.alert(_t("Staff attendance"), _t("Saved {n} staff.", { n })); }
    catch (e) { Alert.alert(_t("Staff attendance"), _tx(e.message)); }
    finally { setBusy(false); }
  };

  const changed = Object.keys(edits).length;
  const future  = date > ymd(new Date());

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <View style={sx.actions}>
          <Action icon="monitor" label={_t("Office code")} onPress={() => navigation.navigate("OfficeCode")} />
          <Action icon="bar-chart-2" label={_t("Monthly report")} onPress={() => navigation.navigate("StaffAttendanceReport")} />
          <Action icon="settings" label={_t("Settings")} onPress={() => setShowSet(!showSet)} active={showSet} />
        </View>

        {showSet && <SettingsCard user={user} />}

        <Card>
          <DateTimeField label={_t("Date")} value={date} onChange={setDate} />
          {day && !day.school_day && day.off_reason && (
            <View style={sx.off}>
              <Feather name="sun" size={14} color="#92400e" />
              <Text style={sx.offTxt}>{_t("{v} · not counted as a working day", { v: day.off_reason.why === "holiday" ? _t("Holiday – {name}", { name: day.off_reason.name }) : _t("Weekly off day") })}</Text>
            </View>
          )}
          {!!day?.staff?.length && (
            <Text style={sx.sum}>{_t("{P} present{v} · {HD} half day · {L} leave · {A} absent{v2}", { P: counts.P, v: counts.late ? ` ${_t("({late} late)", { late: counts.late })}` : "", HD: counts.HD, L: counts.L, A: counts.A, v2: counts.none ? ` ${_t("· {none} not marked", { none: counts.none })}` : "" })}</Text>
          )}
          {!!counts.none && !future && <Btn title={_t("Mark {none} not marked as present", { none: counts.none })} kind="ghost" icon="check" onPress={allPresent} />}
        </Card>

        {!day ? <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} /> : !day.staff.length ? (
          <Card><Empty icon="users" text={_t("No active staff. Add staff under Teachers › Staff Registration.")} /></Card>
        ) : (
          <Card>
            {day.staff.map((s) => {
              const cur = statusOf(s);
              const rec = s.record;
              return (
                <View key={s.staff_id} style={sx.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={sx.name}>{_tx(s.staff_name)}</Text>
                    <Text style={sx.meta}>
                      {rec?.check_in ? _t("In {check_in}", { check_in: niceTime(rec.check_in) }) : _t("Not checked in")}
                      {rec?.check_out ? ` ${_t("· Out {check_out}", { check_out: niceTime(rec.check_out) })}` : ""}
                      {rec?.late_minutes > 0 ? ` ${_t("· {late_minutes} min late", { late_minutes: rec.late_minutes })}` : ""}
                      {rec?.method === "qr" ? (" " + _t("· QR") + "") : ""}
                      {rec?.distance_m != null ? ` ${_t("· {v} from school", { v: rec.distance_m >= 1000 ? _t("{v} km", { v: (rec.distance_m / 1000).toFixed(1) }) : _t("{distance_m} m", { distance_m: rec.distance_m }) })}` : ""}
                      {rec?.method === "leave" ? (" " + _t("· approved leave") + "") : ""}
                      {rec?.leave_half ? (" " + _t("(half day)") + "") : ""}
                    </Text>
                  </View>
                  <View style={sx.chips}>
                    {CHOICES.map((k) => {
                      const on = cur === k;
                      const t = STATUS[k];
                      return (
                        <TouchableOpacity key={k} onPress={() => setEdits({ ...edits, [s.staff_id]: k })}
                          style={[sx.chip, on && { backgroundColor: t.bg, borderColor: t.fg }]} hitSlop={4}>
                          <Text style={[sx.chipTxt, on && { color: t.fg }]}>{_tx(t.short)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
            <Text style={sx.legend}>{_t("P present · A absent · ½ half day · L leave")}</Text>
          </Card>
        )}
      </ScrollView>
      {changed > 0 && (
        <View style={sx.bar}>
          <Btn title={_t("Save {changed} change{pl}", { changed, pl: changed === 1 ? "" : "s" })} icon="save" busy={busy} onPress={save} style={{ flex: 1, marginTop: 0 }} />
          <Btn title={_t("Undo")} kind="ghost" onPress={() => setEdits({})} style={{ marginTop: 0, marginLeft: 8 }} />
        </View>
      )}
    </View>
  );
}

function Action({ icon, label, onPress, active }) {
  return (
    <TouchableOpacity style={[sx.action, active && { borderColor: C.brand, backgroundColor: C.brandSoft }]} onPress={onPress} activeOpacity={0.8}>
      <Feather name={icon} size={18} color={C.brand} />
      <Text style={sx.actionTxt}>{_tx(label)}</Text>
    </TouchableOpacity>
  );
}

function SettingsCard({ user }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const shape = (x) => ({ ...x, late_grace_minutes: String(x.late_grace_minutes), half_day_after: x.half_day_after ?? "",
                          geo_radius_m: String(x.geo_radius_m ?? 150) });
  useEffect(() => {
    getSettings(user).then((x) => { setS(shape(x ?? {})); setLoadErr(null); }).catch((e) => setLoadErr(e.message || _t("Could not load settings.")));
  }, [user]);   // eslint-disable-line react-hooks/exhaustive-deps

  const useHere = () => Alert.alert(
    _t("School location"),
    _t("Use where you are standing now as the school's location? Do this while you are at school (the middle of the campus is best)."),
    [{ text: _t("Cancel"), style: "cancel" }, { text: _t("Use this location"), onPress: async () => {
      setLocBusy(true);
      try {
        const p = await getPosition();
        const x = await setSchoolLocation(user, p.lat, p.lng);
        // keep unsaved edits in the form, just take the new location
        setS((cur) => ({ ...cur, geo_lat: x.geo_lat, geo_lng: x.geo_lng, location_set: x.location_set }));
        Alert.alert(_t("School location"), _t("Saved (accuracy about {accuracy} m).", { accuracy: p.accuracy }));
      } catch (e) { Alert.alert(_t("School location"), _tx(e.message)); }
      finally { setLocBusy(false); }
    } }],
  );
  if (!s && loadErr) return <Card><Empty icon="alert-circle" text={_tx(loadErr)} /></Card>;
  if (!s) return <ActivityIndicator color={C.brand} style={{ marginBottom: 12 }} />;
  const save = async () => {
    setBusy(true);
    try {
      const x = await saveSettings(user, {
        late_grace_minutes: Number(s.late_grace_minutes) || 0, half_day_after: s.half_day_after || "",
        require_office_code: s.require_office_code, self_checkin: s.self_checkin,
        ...(s.phase2 ? {
          allow_qr: s.allow_qr, require_location: s.require_location, remind_staff: s.remind_staff,
          location_or_code: !!s.location_or_code,
          geo_radius_m: Number(s.geo_radius_m) || 150,
        } : {}),
      });
      setS(shape(x ?? s));
      Alert.alert(_t("Settings"), _t("Saved."));
    } catch (e) { Alert.alert(_t("Settings"), _tx(e.message)); }
    finally { setBusy(false); }
  };
  return (
    <Card title={_t("Check-in settings")}>
      <Text style={sx.meta}>{_t("School starts at {school_start} (from School Settings).", { school_start: niceTime(s.school_start) })}</Text>
      <Field label={_t("Late after (minutes past start)")} keyboardType="number-pad" value={s.late_grace_minutes}
        onChangeText={(v) => setS({ ...s, late_grace_minutes: v.replace(/\D/g, "") })} />
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <DateTimeField label={_t("Half day if checking in after (optional)")} mode="time" value={s.half_day_after}
            onChange={(v) => setS({ ...s, half_day_after: v })} placeholder={_t("Never")} />
        </View>
        {!!s.half_day_after && (
          <TouchableOpacity onPress={() => setS({ ...s, half_day_after: "" })} style={{ padding: 10, marginBottom: 10 }}>
            <Feather name="x-circle" size={18} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>
      <Toggle label={_t("Staff can check themselves in from the app")} value={s.self_checkin} onChange={(v) => setS({ ...s, self_checkin: v })} />

      {s.self_checkin && (
        <>
          <Text style={sx.sub}>{_t("How staff check in")}</Text>
          {METHODS.map((m) => {
            const on = methodOf(s) === m.key;
            return (
              <TouchableOpacity key={m.key} activeOpacity={0.8} style={[sx.method, on && sx.methodOn]}
                onPress={() => {
                  if (m.loc && !s.phase2) {
                    Alert.alert(_t("Location check"), _t("Run the database update 2026_10_staff_checkin_gps_qr.sql first.")); return;
                  }
                  if (m.loc && !s.location_set) {
                    Alert.alert(_t("Location check"), _t("Set the school location first – use the button below while you are at school.")); return;
                  }
                  setS({ ...s, require_office_code: m.code, require_location: m.loc, location_or_code: !!m.either });
                }}>
                <Feather name={on ? "check-circle" : "circle"} size={18} color={on ? C.brand : "#94a3b8"} />
                <View style={{ flex: 1 }}>
                  <Text style={[sx.methodTxt, on && { color: C.brand }]}><Feather name={m.icon} size={13} /> {_tx(m.label)}</Text>
                  <Text style={sx.meta}>{_tx(m.hint)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </>
      )}
      {!s.phase2 ? (
        <Text style={[sx.meta, { color: C.warn, marginTop: 8 }]}>{_t("QR scan, location check and reminders need the database update 2026_10_staff_checkin_gps_qr.sql.")}</Text>
      ) : (
        <>
          {(s.require_office_code || s.location_or_code) && (
            <Toggle label={_t("Show a QR code on the office screen")} value={s.allow_qr} onChange={(v) => setS({ ...s, allow_qr: v })}
              hint={_t("Staff can scan it instead of typing the code (needs the latest app version).")} />
          )}
          <Text style={sx.sub}>{_t("School location")}</Text>
          {s.location_set ? (
            <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${s.geo_lat},${s.geo_lng}`)}>
              <Text style={sx.meta}>{_t("School location:")}{" "}{Number(s.geo_lat).toFixed(5)}, {Number(s.geo_lng).toFixed(5)} <Text style={{ color: C.brand }}>{_t("(view on map)")}</Text></Text>
            </TouchableOpacity>
          ) : <Text style={sx.meta}>{_t("School location not set yet.")}</Text>}
          <Btn title={s.location_set ? _t("Update to my current location") : _t("Use my current location as the school")} icon="map-pin"
            kind="ghost" busy={locBusy} onPress={useHere} />
          {s.require_location && (
            <Field label={_t("Allowed distance from school (metres)")} keyboardType="number-pad" value={s.geo_radius_m}
              onChangeText={(v) => setS({ ...s, geo_radius_m: v.replace(/\D/g, "") })} />
          )}
          <Text style={sx.sub}>{_t("Reminder")}</Text>
          <Toggle label={_t("Remind staff who haven't checked in")} value={s.remind_staff}
            onChange={(v) => setS({ ...s, remind_staff: v })}
            hint={_t("{v}not to staff on approved leave or already marked. Goes out while the office code screen is open, or every few minutes if the server's scheduled task is set up.", { v: `${_t("A push notification at {school_start} + {v} min on school days, once a day,", { school_start: niceTime(s.school_start), v: s.late_grace_minutes || 0 })} ` })} />
        </>
      )}
      <Btn title={_t("Save settings")} icon="save" busy={busy} onPress={save} />
    </Card>
  );
}

const sx = StyleSheet.create({
  actions: { flexDirection: "row", gap: 8, marginBottom: 12 },
  action: { flex: 1, alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingVertical: 12, gap: 4 },
  actionTxt: { fontSize: 12, fontWeight: "700", color: C.ink },
  off: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef3c7", borderRadius: 8, padding: 8, marginBottom: 6 },
  offTxt: { fontSize: 12, color: "#92400e", fontWeight: "600", flex: 1 },
  sum: { fontSize: 13, color: C.ink, fontWeight: "600", marginTop: 2 },
  item: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 8 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  sub: { fontSize: 12, fontWeight: "800", color: C.brand, textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
  method: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1.5, borderColor: C.line, borderRadius: 10,
            padding: 10, marginBottom: 6, backgroundColor: "#fff" },
  methodOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  methodTxt: { fontSize: 14, fontWeight: "700", color: C.ink },
  chips: { flexDirection: "row", gap: 5 },
  chip: { width: 32, height: 32, borderRadius: 8, borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  chipTxt: { fontWeight: "800", fontSize: 13, color: "#94a3b8" },
  legend: { fontSize: 11, color: C.muted, marginTop: 8, textAlign: "center" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", padding: 12, paddingBottom: 20,
         backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line },
});
