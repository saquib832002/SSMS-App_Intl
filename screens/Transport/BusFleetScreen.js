/**
 * Office: live buses.
 * Live – every bus on a trip today on one map, with the last update, next stop and who is on board; tap one for its
 *        stops, students and the way it drove (end a trip that was left running).
 * Drivers – which app login shares the location for each driver.
 * Rules – when "bus is near" is sent, the stop circle, which alerts, how long positions are kept.
 */
import React, { useCallback, useContext, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking, RefreshControl, AppState } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker, Field, Toggle } from "../../components/ReportCardUI";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import BusMap from "../../components/BusMap";
import { getLiveBuses, getTrip, endTrip, getBusSettings, saveBusSettings, getBusDrivers, linkDriver, DIRECTION_LABEL, ageText } from "../../services/BusApi";
import { _t, _tx } from "../../services/i18n";

const TABS = [
  { key: "live", get label() { return _t("Live"); } },
  { key: "drivers", get label() { return _t("Drivers"); } },
  { key: "rules", get label() { return _t("Rules"); } },
];
const STATUS_TXT = { boarded: () => _t("on the bus"), dropped: () => _t("got off"), absent: () => _t("not on the bus") };

export default function BusFleetScreen() {
  const { user } = useContext(AuthContext);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState("live");
  const [live, setLive] = useState(null);
  const [err, setErr] = useState(null);
  const [detail, setDetail] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadLive = useCallback(async () => {
    try { setLive(await getLiveBuses(user)); setErr(null); } catch (e) { if (!e?.network) setErr(_tx(e.message)); }
  }, [user]);
  const loadDetail = useCallback(async (id) => {
    try { setDetail(await getTrip(user, id)); } catch (e) { Alert.alert(_t("Live buses"), _tx(e.message)); }
  }, [user]);

  useFocusEffect(useCallback(() => {
    loadLive();
    const t = setInterval(() => { if (AppState.currentState === "active") loadLive(); }, 15000);
    return () => clearInterval(t);
  }, [loadLive]));

  const openTab = async (k) => {
    setTab(k);
    try {
      if (k === "drivers" && !drivers) setDrivers(await getBusDrivers(user));
      if (k === "rules" && !rules) { const r = await getBusSettings(user); setRules({ ...r, form: Object.fromEntries(Object.entries(r.settings).map(([a, b]) => [a, String(b)])) }); }
    } catch (e) { Alert.alert(_t("Live buses"), _tx(e.message)); }
  };

  const stopTrip = (t) => Alert.alert(_t("End this trip?"), _t("Only do this if the driver forgot to end it. The driver's phone stops sharing."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("End trip"), style: "destructive", onPress: async () => {
      try { await endTrip(user, t.trip_id, true); setDetail(null); loadLive(); } catch (e) { Alert.alert(_t("Live buses"), _tx(e.message)); }
    } },
  ]);

  const saveRules = async () => {
    setBusy(true);
    try {
      const f = rules.form;
      const st = await saveBusSettings(user, f);
      setRules({ ...rules, settings: st, form: Object.fromEntries(Object.entries(st).map(([a, b]) => [a, String(b)])) });
      Alert.alert(_t("Rules"), _t("Saved."));
    } catch (e) { Alert.alert(_t("Rules"), _tx(e.message)); } finally { setBusy(false); }
  };

  const setLogin = async (d, username) => {
    try { setDrivers(await linkDriver(user, d.driver_id, username)); } catch (e) { Alert.alert(_t("Drivers"), _tx(e.message)); }
  };

  const running = useMemo(() => (live?.trips ?? []).filter((t) => t.status === "running"), [live]);
  const buses = useMemo(() => running.filter((t) => t.bus).map((t) => ({ id: String(t.trip_id), lat: t.bus.lat, lng: t.bus.lng, heading: t.bus.heading, live: t.bus.live, label: t.route_name })), [running]);
  const loginOpts = useMemo(() => [{ value: "", label: _t("Same mobile number as the driver") }, ...((drivers?.logins ?? []).map((u) => ({ value: u.username, label: `${u.name} (${u.username})` })))], [drivers]);

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="lock" text={err} /></View>;
  if (!live) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;
  const canEdit = !!live.can?.edit;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => openTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={loadLive} />}>
        {tab === "live" && (
          <>
            <BusMap buses={buses} height={280} style={{ marginBottom: 12 }} />
            <Btn title={_t("Drive a trip")} icon="truck" kind="ghost" onPress={() => navigation.navigate("DriverTrip")} style={{ marginBottom: 8 }} />
            {!live.trips.length && <Card><Empty icon="truck" text={_t("No bus has started a trip today.")} /></Card>}
            {live.trips.map((t) => (
              <TouchableOpacity key={t.trip_id} onPress={() => loadDetail(t.trip_id)} activeOpacity={0.8}>
                <Card>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Feather name={t.status === "running" ? "radio" : "check-circle"} size={18} color={t.status === "running" ? (t.bus?.live ? C.ok : C.warn) : C.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{t.route_name} <Text style={s.meta}>{DIRECTION_LABEL[t.direction]?.()}</Text></Text>
                      <Text style={s.meta}>{[t.vehicle_number, t.driver_name].filter(Boolean).join(" · ")}</Text>
                      {t.status === "running" ? (
                        <Text style={[s.meta, t.bus && !t.bus.live && { color: C.warn, fontWeight: "700" }]}>
                          {t.bus ? (t.bus.live ? _t("Live – updated {ago}", { ago: ageText(t.bus.age) }) : _t("No position for {ago}", { ago: ageText(t.bus.age) })) : _t("Waiting for the first position")}
                          {t.next_stop ? ` · ${_t("next: {stop}", { stop: t.next_stop })}` : ""}
                        </Text>
                      ) : <Text style={s.meta}>{_t("{from} – {to}", { from: t.started_at, to: t.ended_at })}{t.end_reason === "idle" ? ` · ${_t("ended: no position")}` : ""}</Text>}
                      <Text style={s.meta}>{_t("{on} on the bus · {off} got off · {abs} absent · {n} riders", { on: t.on_board, off: t.dropped, abs: t.absent, n: t.riders })}</Text>
                    </View>
                    {!!t.driver_phone && (
                      <TouchableOpacity onPress={() => Linking.openURL(`tel:${String(t.driver_phone).replace(/[^\d+]/g, "")}`)} style={{ padding: 6 }} accessibilityLabel={_t("Call the driver")}>
                        <Feather name="phone" size={18} color={C.brand} />
                      </TouchableOpacity>
                    )}
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
            {!!live.not_running.length && (
              <Card title={_t("Not on a trip now")}>
                {live.not_running.map((r) => <Text key={r.route_id} style={s.row}>{r.route_name}<Text style={s.meta}>{`  ${[r.vehicle_number, r.driver_name].filter(Boolean).join(" · ")}`}</Text></Text>)}
              </Card>
            )}
          </>
        )}

        {tab === "drivers" && (!drivers ? <ActivityIndicator color={C.brand} /> : (
          <>
            <Card>
              <Text style={s.meta}>{_t("The driver signs in to the app on the bus phone and starts the trip there. Choose the driver's login here, or give the login the same mobile number as the driver.")}</Text>
            </Card>
            {!drivers.drivers.length && <Card><Empty icon="user" text={_t("No drivers yet. Add them in Transport › Drivers.")} /></Card>}
            {drivers.drivers.map((d) => (
              <Card key={d.driver_id}>
                <Text style={s.name}>{d.name}</Text>
                <Text style={s.meta}>{d.mobile ?? "—"}{d.status !== "active" ? ` · ${_t("inactive")}` : ""}</Text>
                <Picker label={_t("App login")} value={d.username ?? ""} options={loginOpts} onChange={(v) => setLogin(d, v)} disabled={!canEdit} />
                {!d.username && <Text style={[s.meta, { color: d.auto_username ? C.ok : C.warn }]}>{d.auto_username ? _t("Found by mobile number: {u}", { u: d.auto_username }) : _t("No login found – the driver cannot start trips yet.")}</Text>}
              </Card>
            ))}
          </>
        ))}

        {tab === "rules" && (!rules ? <ActivityIndicator color={C.brand} /> : (
          <Card>
            <Field label={_t("\"Bus is near\": minutes before the stop (1 – 30)")} value={rules.form.near_minutes} keyboardType="number-pad" editable={canEdit}
              onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, near_minutes: v.replace(/\D/g, "") } })} />
            <Field label={_t("… or when this close, in metres (100 – 5000)")} value={rules.form.near_meters} keyboardType="number-pad" editable={canEdit}
              onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, near_meters: v.replace(/\D/g, "") } })} />
            <Field label={_t("The bus is at a stop within (metres, 30 – 500)")} value={rules.form.stop_radius} keyboardType="number-pad" editable={canEdit}
              onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, stop_radius: v.replace(/\D/g, "") } })} />
            <Field label={_t("End a trip with no position after (minutes, 20 – 360)")} value={rules.form.idle_minutes} keyboardType="number-pad" editable={canEdit}
              onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, idle_minutes: v.replace(/\D/g, "") } })} />
            <Field label={_t("Keep the positions for (days, 7 – 365)")} value={rules.form.keep_days} keyboardType="number-pad" editable={canEdit}
              onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, keep_days: v.replace(/\D/g, "") } })} />
            {[["alert_start", _t("Tell families when the trip starts")], ["alert_near", _t("Tell families when the bus is near")], ["alert_arrived", _t("Tell families when the bus is at their stop")],
              ["alert_board", _t("Tell families when their child gets on / off")]].map(([k, label]) => (
              <Toggle key={k} label={label} value={rules.form[k] === "1"} onChange={(v) => canEdit && setRules({ ...rules, form: { ...rules.form, [k]: v ? "1" : "0" } })} />
            ))}
            {canEdit ? <Btn title={_t("Save")} icon="check" busy={busy} onPress={saveRules} /> : <Text style={s.meta}>{_t("Only people with Transport edit rights can change the rules.")}</Text>}
          </Card>
        ))}
      </ScrollView>

      <KeyboardSheet visible={!!detail} onClose={() => setDetail(null)}>
        {!!detail && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text style={[s.big, { flex: 1 }]}>{detail.trip.route_name} · {DIRECTION_LABEL[detail.trip.direction]?.()}</Text>
              <TouchableOpacity onPress={() => setDetail(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <SheetScroll>
              <BusMap height={240} path={detail.path}
                stops={detail.trip.stops.map((x) => ({ id: x.stop_id, name: x.name, lat: x.lat, lng: x.lng, status: x.status }))}
                buses={detail.trip.bus && detail.trip.status === "running" ? [{ id: "bus", lat: detail.trip.bus.lat, lng: detail.trip.bus.lng, heading: detail.trip.bus.heading, live: detail.trip.bus.live }] : []}
                style={{ marginBottom: 10 }} />
              {detail.trip.stops.map((x) => (
                <Text key={x.stop_id} style={s.row}>
                  <Text style={[s.name, x.status !== "pending" && x.status !== "arrived" && { color: C.muted }]}>{x.name}</Text>
                  <Text style={s.meta}>{`  ${x.time ? _t("planned {time}", { time: x.time }) : ""}${x.arrived_at ? ` · ${_t("at {time}", { time: x.arrived_at })}` : x.status === "passed" ? ` · ${_t("passed")}` : x.eta_at ? ` · ${_t("expected {time}", { time: x.eta_at })}` : ""}`}</Text>
                </Text>
              ))}
              <Text style={[s.name, { marginTop: 10 }]}>{_t("Students")}</Text>
              {detail.trip.students.map((x) => (
                <Text key={x.enrollment_id} style={s.row}>{x.name} <Text style={s.meta}>{`${x.stop_name ?? ""} · ${x.status ? STATUS_TXT[x.status]?.() : _t("not marked")}${x.boarded_at ? ` ${x.boarded_at}` : ""}${x.dropped_at ? ` – ${x.dropped_at}` : ""}`}</Text></Text>
              ))}
              {detail.trip.status === "running" && detail.can?.edit && <Btn title={_t("End trip")} icon="square" kind="danger" onPress={() => stopTrip(detail.trip)} style={{ marginTop: 12 }} />}
            </SheetScroll>
          </>
        )}
      </KeyboardSheet>
    </View>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderColor: C.line },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabOn: { borderBottomWidth: 3, borderColor: C.brand },
  tabTxt: { fontSize: 13, fontWeight: "700", color: C.muted },
  tabTxtOn: { color: C.brand },
  big: { fontSize: 16, fontWeight: "800", color: C.ink },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17, fontWeight: "400" },
  row: { fontSize: 13, color: C.ink, paddingVertical: 5, borderTopWidth: 1, borderColor: "#f1f5f9" },
});
