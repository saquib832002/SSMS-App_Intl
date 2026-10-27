/**
 * Office: live buses.
 * Live – every bus on a trip today on one map, with the last update, next stop and who is on board; tap one for its
 *        stops, students and the way it drove (end a trip that was left running).
 * Buses – how each bus is tracked: the driver's phone (app login), a bus phone paired once with a QR code (no login), or a
 *         GPS tracker device that forwards its positions to the school's secret address.
 * Drivers – which app login shares the location for each driver.
 * Rules – when "bus is near" is sent, the stop circle, which alerts, how long positions are kept, and the times in which a
 *         bus phone / GPS tracker starts and ends trips by itself.
 */
import React, { useCallback, useContext, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking, RefreshControl, AppState, Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Picker, Field, Toggle } from "../../components/ReportCardUI";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import BusMap from "../../components/BusMap";
import { getLiveBuses, getTrip, endTrip, getBusSettings, saveBusSettings, getBusDrivers, linkDriver, getVehicles, setVehicleMode, getPairCode, unpairBusPhone, newGpsKey, gpsUrl,
  DIRECTION_LABEL, ageText } from "../../services/BusApi";
import { _t, _tx } from "../../services/i18n";

const TABS = [
  { key: "live", get label() { return _t("Live"); } },
  { key: "buses", get label() { return _t("Buses"); } },
  { key: "drivers", get label() { return _t("Drivers"); } },
  { key: "rules", get label() { return _t("Rules"); } },
];
const MODE_OPTS = () => [
  { value: "driver", label: _t("Driver's phone (app login)") },
  { value: "phone", label: _t("Bus phone (paired with a QR code, no login)") },
  { value: "gps", label: _t("GPS tracker device") },
];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
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
  const [fleet, setFleet] = useState(null);       // { vehicles, gps, can }
  const [trackerIds, setTrackerIds] = useState({});
  const [pair, setPair] = useState(null);         // the QR code being shown

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

  const loadFleet = async () => {
    const f = await getVehicles(user);
    setFleet(f);
    setTrackerIds(Object.fromEntries(f.vehicles.map((v) => [v.vehicle_id, v.tracker_id ?? ""])));
  };
  const putVehicle = (v) => setFleet((f) => f && ({ ...f, vehicles: f.vehicles.map((x) => (x.vehicle_id === v.vehicle_id ? { ...x, ...v } : x)) }));

  const changeMode = (v, mode) => {
    if (mode === v.mode) return;
    const go = async () => {
      if (mode === "gps") { putVehicle({ vehicle_id: v.vehicle_id, mode: "gps", pending: true }); return; }   // saved with the tracker ID
      try { putVehicle((await setVehicleMode(user, v.vehicle_id, mode)).vehicle); } catch (e) { Alert.alert(_t("Buses"), _tx(e.message)); }
    };
    if (v.mode === "phone" && v.paired) {
      Alert.alert(_t("Unpair the bus phone?"), _t("The paired phone stops sharing this bus's location."), [
        { text: _t("Cancel"), style: "cancel" }, { text: _t("Change"), style: "destructive", onPress: go },
      ]);
    } else go();
  };
  const saveTracker = async (v) => {
    setBusy(true);
    try { putVehicle({ ...(await setVehicleMode(user, v.vehicle_id, "gps", trackerIds[v.vehicle_id] ?? "")).vehicle, pending: false }); Alert.alert(_t("Buses"), _t("Saved.")); }
    catch (e) { Alert.alert(_t("Buses"), _tx(e.message)); } finally { setBusy(false); }
  };
  const showPair = async (v) => {
    setBusy(true);
    try { const r = await getPairCode(user, v.vehicle_id); putVehicle(r.vehicle); setPair(r); }
    catch (e) { Alert.alert(_t("Buses"), _tx(e.message)); } finally { setBusy(false); }
  };
  const unpairPhone = (v) => Alert.alert(_t("Unpair the bus phone?"), _t("The paired phone stops sharing this bus's location."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Unpair"), style: "destructive", onPress: async () => {
      try { putVehicle((await unpairBusPhone(user, v.vehicle_id)).vehicle); } catch (e) { Alert.alert(_t("Buses"), _tx(e.message)); }
    } },
  ]);
  const renewKey = () => Alert.alert(_t("Make a new address?"), _t("The old address stops working. Every GPS tracker must then be set up with the new one."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("New address"), style: "destructive", onPress: async () => {
      try { const g = await newGpsKey(user); setFleet((f) => f && ({ ...f, gps: g })); } catch (e) { Alert.alert(_t("Buses"), _tx(e.message)); }
    } },
  ]);
  const shareGps = (url) => Share.share({ message: url }).catch(() => {});

  const openTab = async (k) => {
    setTab(k);
    try {
      if (k === "drivers" && !drivers) setDrivers(await getBusDrivers(user));
      if (k === "buses") await loadFleet();
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
      for (const k of ["morning_from", "morning_to", "afternoon_from", "afternoon_to"]) {
        if (!TIME_RE.test(String(f[k] ?? "").trim())) { Alert.alert(_t("Rules"), _t("Enter the times as HH:MM, for example 07:30.")); setBusy(false); return; }
      }
      const st = await saveBusSettings(user, f);
      setRules({ ...rules, settings: st, form: Object.fromEntries(Object.entries(st).map(([a, b]) => [a, String(b)])) });
      Alert.alert(_t("Rules"), _t("Saved."));
    } catch (e) { Alert.alert(_t("Rules"), _tx(e.message)); } finally { setBusy(false); }
  };

  const setLogin = async (d, username) => {
    try { setDrivers(await linkDriver(user, d.driver_id, username)); } catch (e) { Alert.alert(_t("Drivers"), _tx(e.message)); }
  };

  const running = useMemo(() => (live?.trips ?? []).filter((t) => t.status === "running"), [live]);
  const buses = useMemo(() => [
    ...running.filter((t) => t.bus).map((t) => ({ id: String(t.trip_id), lat: t.bus.lat, lng: t.bus.lng, heading: t.bus.heading, live: t.bus.live, label: t.route_name })),
    ...(live?.parked ?? []).map((v) => ({ id: `v${v.vehicle_id}`, lat: v.lat, lng: v.lng, live: false, label: v.number })),
  ], [running, live]);
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
            {!!live.parked?.length && (
              <Card title={_t("Buses not on a trip")}>
                {live.parked.map((v) => <Text key={v.vehicle_id} style={s.row}>{v.number}<Text style={s.meta}>{`  ${_t("seen {ago}", { ago: ageText(v.last_seen) })}`}</Text></Text>)}
              </Card>
            )}
            {!!live.not_running.length && (
              <Card title={_t("Not on a trip now")}>
                {live.not_running.map((r) => <Text key={r.route_id} style={s.row}>{r.route_name}<Text style={s.meta}>{`  ${[r.vehicle_number, r.driver_name].filter(Boolean).join(" · ")}`}</Text></Text>)}
              </Card>
            )}
          </>
        )}

        {tab === "buses" && (!fleet ? <ActivityIndicator color={C.brand} /> : (
          <>
            <Card>
              <Text style={s.meta}>{_t("Choose how each bus shares its location. Driver's phone: the driver signs in and starts the trip. Bus phone: a phone that stays in the bus, paired once with a QR code – no login, trips start and end by themselves. GPS tracker: a tracker fitted in the bus sends its positions to the school.")}</Text>
            </Card>
            {!fleet.vehicles.length && <Card><Empty icon="truck" text={_t("No buses yet. Add them in Transport › Vehicles.")} /></Card>}
            {fleet.vehicles.map((v) => (
              <Card key={v.vehicle_id}>
                <Text style={s.name}>{v.number}{v.name ? <Text style={s.meta}>{`  ${v.name}`}</Text> : null}</Text>
                <Text style={s.meta}>{v.routes.length ? v.routes.join(", ") : _t("No route this school year")}</Text>
                <Picker label={_t("Tracked by")} value={v.mode} options={MODE_OPTS()} onChange={(m) => changeMode(v, m)} disabled={!fleet.can?.edit} />
                {v.mode === "phone" && (
                  <>
                    <Text style={[s.meta, { color: v.paired ? C.ok : C.warn, fontWeight: "700" }]}>
                      {v.paired ? _t("Paired: {name} on {date}", { name: v.device_name ?? "—", date: v.paired_at ?? "" }) : _t("No phone paired yet.")}
                    </Text>
                    {v.last_seen != null && <Text style={s.meta}>{_t("Last position {ago}", { ago: ageText(v.last_seen) })}</Text>}
                    {!!fleet.can?.edit && (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                        <Btn title={v.paired ? _t("Pair another phone") : _t("Pair a phone")} icon="smartphone" busy={busy} onPress={() => showPair(v)} style={{ flex: 1 }} />
                        {v.paired && <Btn title={_t("Unpair")} icon="link-2" kind="ghost" onPress={() => unpairPhone(v)} style={{ flex: 1 }} />}
                      </View>
                    )}
                  </>
                )}
                {v.mode === "gps" && (
                  <>
                    <Field label={_t("Tracker ID (IMEI or the unique ID in the tracking platform)")} value={trackerIds[v.vehicle_id] ?? ""} editable={!!fleet.can?.edit}
                      autoCapitalize="none" autoCorrect={false} onChangeText={(x) => setTrackerIds({ ...trackerIds, [v.vehicle_id]: x.trim() })} />
                    {v.last_seen != null && !v.pending && <Text style={s.meta}>{_t("Last position {ago}", { ago: ageText(v.last_seen) })}</Text>}
                    {v.pending && <Text style={[s.meta, { color: C.warn, fontWeight: "700" }]}>{_t("Not saved yet – enter the tracker ID and save.")}</Text>}
                    {!!fleet.can?.edit && <Btn title={_t("Save")} icon="check" busy={busy} onPress={() => saveTracker(v)} style={{ marginTop: 8 }} />}
                  </>
                )}
              </Card>
            ))}
            {!!fleet.gps && fleet.vehicles.some((v) => v.mode === "gps") && (
              <Card title={_t("GPS tracker set-up")}>
                <Text style={s.meta}>{_t("Your trackers usually report to a tracking platform (for example Traccar). Set that platform to forward every position to this address, as JSON. In Traccar: forward.enable = true, forward.json = true, forward.url = the address below.")}</Text>
                <Text selectable style={s.url}>{gpsUrl(fleet.gps.path)}</Text>
                <Text style={s.meta}>{_t("Trackers that send OsmAnd requests can use the same address directly: ?id=TRACKER_ID&lat=…&lon=…")}</Text>
                <Text style={[s.meta, { color: C.warn }]}>{_t("Keep this address secret – anyone with it can send positions for your buses.")}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Btn title={_t("Share")} icon="share-2" kind="ghost" onPress={() => shareGps(gpsUrl(fleet.gps.path))} style={{ flex: 1 }} />
                  <Btn title={_t("New address")} icon="refresh-cw" kind="ghost" onPress={renewKey} style={{ flex: 1 }} />
                </View>
              </Card>
            )}
          </>
        ))}

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
            <Toggle label={_t("Bus phones and GPS trackers start and end trips by themselves")} value={rules.form.auto_trips === "1"}
              onChange={(v) => canEdit && setRules({ ...rules, form: { ...rules.form, auto_trips: v ? "1" : "0" } })} />
            <Text style={s.meta}>{_t("A trip starts when the bus starts moving in one of these times, and ends at the last stop.")}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[["morning_from", _t("Pick-up from")], ["morning_to", _t("until")]].map(([k, l]) => (
                <View key={k} style={{ flex: 1 }}><Field label={l} value={rules.form[k]} editable={canEdit} placeholder="07:00" maxLength={5}
                  onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, [k]: v.replace(/[^\d:]/g, "") } })} /></View>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[["afternoon_from", _t("Drop from")], ["afternoon_to", _t("until")]].map(([k, l]) => (
                <View key={k} style={{ flex: 1 }}><Field label={l} value={rules.form[k]} editable={canEdit} placeholder="14:00" maxLength={5}
                  onChangeText={(v) => setRules({ ...rules, form: { ...rules.form, [k]: v.replace(/[^\d:]/g, "") } })} /></View>
              ))}
            </View>
            {[["alert_start", _t("Tell families when the trip starts")], ["alert_near", _t("Tell families when the bus is near")], ["alert_arrived", _t("Tell families when the bus is at their stop")],
              ["alert_board", _t("Tell families when their child gets on / off")]].map(([k, label]) => (
              <Toggle key={k} label={label} value={rules.form[k] === "1"} onChange={(v) => canEdit && setRules({ ...rules, form: { ...rules.form, [k]: v ? "1" : "0" } })} />
            ))}
            {canEdit ? <Btn title={_t("Save")} icon="check" busy={busy} onPress={saveRules} /> : <Text style={s.meta}>{_t("Only people with Transport edit rights can change the rules.")}</Text>}
          </Card>
        ))}
      </ScrollView>

      <KeyboardSheet visible={!!pair} onClose={() => setPair(null)}>
        {!!pair && (
          <SheetScroll>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text style={[s.big, { flex: 1 }]}>{_t("Pair the bus phone – {bus}", { bus: pair.vehicle?.number ?? "" })}</Text>
              <TouchableOpacity onPress={() => setPair(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <Text style={s.meta}>{_t("On the bus phone: install the app, tap \"School bus phone (no login)\" on the sign-in screen, then scan this code.")}</Text>
            <View style={{ alignItems: "center", padding: 16, backgroundColor: "#fff", borderRadius: 12, marginVertical: 10 }}>
              <QRCode value={pair.qr} size={220} backgroundColor="#ffffff" color="#0f172a" ecl="M" />
            </View>
            <Text style={s.meta}>{_t("Or type: school code {school}, pairing code", { school: pair.school })}</Text>
            <Text selectable style={s.code}>{`${pair.code.slice(0, 4)} ${pair.code.slice(4)}`}</Text>
            <Text style={s.meta}>{_t("Works once, until {time}.", { time: pair.valid_until })}</Text>
            <Btn title={_t("Done")} icon="check" onPress={() => { setPair(null); loadFleet().catch(() => {}); }} style={{ marginTop: 12 }} />
          </SheetScroll>
        )}
      </KeyboardSheet>

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
  url: { fontSize: 12, color: C.ink, backgroundColor: "#f1f5f9", borderRadius: 8, padding: 8, marginVertical: 8, fontFamily: "monospace" },
  code: { fontSize: 28, fontWeight: "800", color: C.ink, letterSpacing: 4, textAlign: "center", marginVertical: 6 },
  row: { fontSize: 13, color: C.ink, paddingVertical: 5, borderTopWidth: 1, borderColor: "#f1f5f9" },
});
