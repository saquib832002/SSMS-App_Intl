/**
 * Bus phone – a phone kept in the bus that shares the bus location without anyone signing in.
 * Set up once: the office shows a QR code (Transport › Live buses › Buses › Pair a phone); scan it here (or type the
 * school code and the 8-character code). From then on the phone shares the location by itself in the trip windows,
 * and the trips start / end by themselves. The driver only keeps the phone charged in the bus.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, AppState, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Application from "expo-application";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import BusMap from "../../components/BusMap";
import QrScanner from "../../components/QrScanner";
import { hasCamera, askCamera } from "../../services/DeviceSensors";
import { pairBusPhone, busPhoneHome, busPhoneTrip, parsePairQr, DIRECTION_LABEL, ageText } from "../../services/BusApi";
import * as Tracker from "../../services/BusTracker";
import { _t, _tx } from "../../services/i18n";

export default function BusPhoneScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [paired, setPaired] = useState(undefined);   // undefined = loading, null = not paired
  const [home, setHome] = useState(null);
  const [share, setShare] = useState(Tracker.getStatus());
  const [form, setForm] = useState({ school: "", code: "", name: "" });
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const loadHome = useCallback(async (p) => {
    const d = p ?? (await Tracker.getBusPhone());
    if (!d?.token) return;
    try {
      const h = await busPhoneHome(d.token);
      setHome(h);
      Tracker.setBusPhoneStatus({ trip: h.trip, window: h.window });
    } catch (e) {
      if (e?.unpaired) { await Tracker.unpairBusPhone(); setPaired(null); setHome(null); Alert.alert(_t("Bus phone"), _tx(e.message)); }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Tracker.getBusPhone().then(async (d) => {
      if (!alive) return;
      setPaired(d?.token ? d : null);
      if (d?.token) { await Tracker.resumeBusPhone().catch(() => {}); loadHome(d); }
    });
    const unsub = Tracker.subscribe((s) => {
      setShare(s);
      if (s.unpaired) { setPaired(null); setHome(null); }
    });
    return () => { alive = false; unsub(); };
  }, [loadHome]);

  useFocusEffect(useCallback(() => {
    const t = setInterval(() => { setNow(Date.now()); if (AppState.currentState === "active") loadHome(); }, 30000);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [loadHome]));

  const doPair = (school, code) => Alert.alert(
    _t("Make this the bus phone?"),
    _t("This phone will share its location with the school and with the parents of the students on this bus, all through the school day – also when the app is closed. Keep it in the bus, plugged in. Allow location \"All the time\" when asked."),
    [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Continue"), onPress: async () => {
        setBusy(true);
        try {
          const name = form.name.trim() || `${Application.applicationName ?? "Bus"} ${Platform.OS === "android" ? "Android" : "iPhone"}`;
          const r = await pairBusPhone(school, code, name);
          const { mode } = await Tracker.startBusPhone(r);
          const d = await Tracker.getBusPhone();
          setPaired(d);
          setHome(r);
          if (mode === "none") {
            Alert.alert(_t("Bus phone"), _t("Paired. Now allow location for this app (\"All the time\") in the phone's settings, then open this screen again."));
          } else if (mode !== "background") {
            Alert.alert(_t("Keep the app open"), _t("Location is shared only while the app is open. To share it with the screen off, allow location \"All the time\" for this app in the phone's settings."));
          }
        } catch (e) { Alert.alert(_t("Bus phone"), _tx(e.message)); } finally { setBusy(false); }
      } },
    ],
  );

  const onScan = (text) => {
    setScan(false);
    const p = parsePairQr(text);
    if (!p) { Alert.alert(_t("Bus phone"), _t("This is not a bus pairing code. Open Transport › Live buses › Buses › Pair a phone on the office phone.")); return; }
    doPair(p.school, p.code);
  };

  const startScan = async () => {
    try { if (await askCamera()) setScan(true); else Alert.alert(_t("Bus phone"), _t("Allow the camera to scan the code, or type the codes below.")); }
    catch (e) { Alert.alert(_t("Bus phone"), _tx(e.message)); }
  };

  const manual = async (action, direction, routeId) => {
    setBusy(true);
    try {
      const h = await busPhoneTrip(paired.token, action, direction, routeId);
      setHome(h);
      Tracker.setBusPhoneStatus({ trip: h.trip, window: h.window });
      Tracker.flush();
    } catch (e) { Alert.alert(_t("Bus phone"), _tx(e.message)); } finally { setBusy(false); }
  };

  const startManual = (direction) => {
    const routes = home?.routes ?? [];
    if (routes.length <= 1) { manual("start", direction, routes[0]?.route_id); return; }
    Alert.alert(_t("Which route?"), "", [...routes.map((r) => ({ text: r.route_name, onPress: () => manual("start", direction, r.route_id) })), { text: _t("Cancel"), style: "cancel" }]);
  };

  const unpair = () => Alert.alert(_t("Unpair this phone?"), _t("It stops sharing the bus location. The office can pair a phone again with a new code."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Unpair"), style: "destructive", onPress: async () => { await Tracker.unpairBusPhone(); setPaired(null); setHome(null); } },
  ]);

  if (paired === undefined) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;

  // ── not paired: set up
  if (!paired) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 16 + insets.top, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>{_t("Bus phone")}</Text>
          <Text style={s.meta}>{_t("Use a phone that stays in the bus. Nobody signs in on it: it is paired with the bus once, then it shares the bus location by itself during the school's trip times.")}</Text>
          <Card style={{ marginTop: 12 }}>
            <Text style={s.step}>{_t("1. On the office phone: Transport › Live buses › Buses → the bus → Pair a phone.")}</Text>
            <Text style={s.step}>{_t("2. Scan the QR code it shows with this phone.")}</Text>
            {hasCamera() && <Btn title={_t("Scan the QR code")} icon="maximize" busy={busy} onPress={startScan} style={{ marginTop: 8 }} />}
            <Text style={[s.meta, { marginTop: 12 }]}>{_t("Or type the codes shown under the QR code:")}</Text>
            <Field label={_t("School code")} value={form.school} onChangeText={(t) => setForm((f) => ({ ...f, school: t.toUpperCase() }))} autoCapitalize="characters" autoCorrect={false} />
            <Field label={_t("Pairing code")} value={form.code} onChangeText={(t) => setForm((f) => ({ ...f, code: t.toUpperCase() }))} autoCapitalize="characters" autoCorrect={false} maxLength={9} />
            <Field label={_t("Name of this phone (optional)")} value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} placeholder={_t("e.g. Bus 3 phone")} maxLength={60} />
            <Btn title={_t("Pair with the bus")} icon="link" kind="ghost" busy={busy} disabled={!form.school.trim() || form.code.replace(/[^A-Za-z0-9]/g, "").length !== 8}
              onPress={() => doPair(form.school.trim(), form.code)} />
          </Card>
          <Btn title={_t("Back to sign in")} kind="ghost" onPress={() => navigation.goBack()} style={{ marginTop: 8 }} />
        </ScrollView>
        <QrScanner visible={scan} onScan={onScan} onClose={() => setScan(false)} title={_t("Scan the bus pairing code")} />
      </View>
    );
  }

  // ── paired
  const trip = share.trip ?? null;   // the tracker's latest answer (also set from each refresh), so an ended trip goes away at once
  const sentAgo = share.lastSentAt ? Math.round((now - share.lastSentAt) / 1000) : null;
  const win = share.window ?? home?.window ?? null;
  const w = home?.windows;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 12 + insets.top, paddingBottom: 40 + insets.bottom }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={s.busIcon}><Feather name="truck" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{home?.vehicle?.number ?? paired.vehicle?.number ?? _t("Bus")}</Text>
              <Text style={s.meta}>{home?.school?.name ?? paired.school?.name ?? ""}{home?.routes?.length ? ` · ${home.routes.map((r) => r.route_name).join(", ")}` : ""}</Text>
            </View>
          </View>
          <View style={[s.banner, { backgroundColor: share.active ? (share.error ? "#fef3c7" : "#dcfce7") : "#fee2e2" }]}>
            <Feather name={share.active ? "radio" : "alert-triangle"} size={16} color={share.active ? (share.error ? C.warn : C.ok) : C.err} />
            <Text style={s.bannerTxt}>
              {!share.active ? _t("Not sharing the location. Open this screen again or allow location for this app.")
                : share.error ? _tx(share.error)
                  : `${share.mode === "background" ? _t("Sharing the bus location (also with the screen off).") : _t("Sharing the location – keep the app open.")}${sentAgo != null ? ` ${_t("Sent {ago}.", { ago: ageText(sentAgo) })}` : ""}`}
            </Text>
          </View>
        </Card>

        <Card title={trip ? `${DIRECTION_LABEL[trip.direction]?.()} · ${trip.route_name ?? ""}` : _t("No trip now")}>
          {trip ? (
            <>
              <Text style={s.meta}>{_t("started {time}", { time: trip.started_at })}{trip.next_stop ? ` · ${_t("next stop: {stop}", { stop: trip.next_stop })}` : ""}</Text>
              <BusMap height={220} style={{ marginTop: 8 }} follow="me"
                stops={(trip.stops ?? []).map((x) => ({ id: x.stop_id, name: x.name, lat: x.lat, lng: x.lng, status: x.status }))}
                me={share.lastFix ? { lat: share.lastFix.lat, lng: share.lastFix.lng } : (trip.bus ? { lat: trip.bus.lat, lng: trip.bus.lng } : null)} />
              <Btn title={_t("End trip")} icon="square" kind="danger" busy={busy} onPress={() => Alert.alert(_t("End the trip?"), "", [{ text: _t("Cancel"), style: "cancel" }, { text: _t("End trip"), style: "destructive", onPress: () => manual("end") }])} style={{ marginTop: 10 }} />
            </>
          ) : (
            <>
              <Text style={s.meta}>
                {home?.auto
                  ? (win ? _t("Trip time now: the trip starts by itself when the bus starts moving.")
                    : _t("Trips start by themselves when the bus moves between {mf}–{mt} (morning) and {af}–{at} (afternoon).", { mf: w?.morning_from ?? "", mt: w?.morning_to ?? "", af: w?.afternoon_from ?? "", at: w?.afternoon_to ?? "" }))
                  : _t("Start the trip below when the bus leaves.")}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <Btn title={DIRECTION_LABEL.pickup()} icon="sunrise" kind={win === "pickup" ? "primary" : "ghost"} busy={busy} onPress={() => startManual("pickup")} style={{ flex: 1 }} />
                <Btn title={DIRECTION_LABEL.drop()} icon="sunset" kind={win === "drop" ? "primary" : "ghost"} busy={busy} onPress={() => startManual("drop")} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </Card>

        <Card>
          <Text style={s.step}>{_t("Keep this phone in the bus, plugged into the charger, with mobile data on. Do not close the app from the recent apps list.")}</Text>
          {!home?.routes?.length && <Text style={[s.meta, { color: C.warn, fontWeight: "700" }]}>{_t("This bus has no route this school year. Ask the office to set it in Transport › Assignments.")}</Text>}
        </Card>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn title={_t("Sign in")} icon="log-in" kind="ghost" onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Login"))} style={{ flex: 1 }} />
          <Btn title={_t("Unpair")} icon="link-2" kind="ghost" onPress={unpair} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  step: { fontSize: 13, color: C.ink, lineHeight: 19, marginBottom: 4 },
  busIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", gap: 8, alignItems: "center", borderRadius: 10, padding: 10, marginTop: 10 },
  bannerTxt: { flex: 1, fontSize: 12, fontWeight: "600", color: C.ink },
});
