/**
 * Driver: my bus trip.
 * Pick the route and the direction → Start trip (the phone shares its location until the trip ends) → see the
 * stops in order with the students to pick up / drop at each → mark them got on / got off / not on the bus →
 * End trip (on the drop trip nobody may still be marked on the bus).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking, RefreshControl, AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty } from "../../components/ReportCardUI";
import BusMap from "../../components/BusMap";
import { getDriverHome, startTrip, getDriverTrip, markStudent, endTrip, DIRECTION_LABEL, ageText } from "../../services/BusApi";
import * as Tracker from "../../services/BusTracker";
import { _t, _tx } from "../../services/i18n";

const STOP_COLOR = { arrived: C.ok, left: C.muted, passed: C.muted, pending: C.brand };

export default function DriverTripScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [trip, setTrip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(Tracker.getStatus());
  const [now, setNow] = useState(Date.now());

  const loadHome = useCallback(async () => {
    try { setHome(await getDriverHome(user)); setErr(null); } catch (e) { setErr(_tx(e.message)); }
  }, [user]);

  const loadTrip = useCallback(async (id) => {
    try { setTrip((await getDriverTrip(user, id)).trip); } catch (e) { Alert.alert(_t("My bus trip"), _tx(e.message)); }
  }, [user]);

  // carry on with a trip this phone was sharing (app was closed)
  useEffect(() => {
    let alive = true;
    Tracker.resumeIfRunning(user).then((id) => { if (alive && id) loadTrip(id); }).catch(() => {});
    const unsub = Tracker.subscribe((s) => {
      setShare(s);
      if (s.trip && alive) setTrip((t) => (t && t.trip_id === s.trip.trip_id ? { ...t, ...s.trip, students: t.students } : t));
      if (s.ended && alive) { setTrip(null); loadHome(); }
    });
    return () => { alive = false; unsub(); };
  }, [user, loadTrip, loadHome]);

  useFocusEffect(useCallback(() => {
    loadHome();
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [loadHome]));

  // students' marks change from other phones too (an attendant): refresh now and then
  useEffect(() => {
    if (!trip?.trip_id || trip.status !== "running") return undefined;
    const t = setInterval(() => { if (AppState.currentState === "active") loadTrip(trip.trip_id); }, 20000);
    return () => clearInterval(t);
  }, [trip?.trip_id, trip?.status, loadTrip]);

  const start = (route, direction) => Alert.alert(
    _t("Share this phone's location?"),
    _t("While the trip runs, this phone shares its location with the school and with the parents of the students on this route – also when the app is closed or the screen is off. It stops when you end the trip."),
    [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Start trip"), onPress: async () => {
        setBusy(true);
        try {
          const r = await startTrip(user, route.route_id, direction);
          const { mode } = await Tracker.startSharing(user, r.trip.trip_id);
          setTrip(r.trip);
          if (mode !== "background") {
            Alert.alert(_t("Keep the app open"), _t("Location is shared only while the app is open. To share it with the screen off, allow location \"All the time\" for this app in the phone's settings."));
          }
        } catch (e) { Alert.alert(_t("My bus trip"), _tx(e.message)); } finally { setBusy(false); }
      } },
    ],
  );

  const shareTrip = async (t) => {
    const { mode } = await Tracker.startSharing(user, t.trip_id);
    if (mode !== "background") Alert.alert(_t("Keep the app open"), _t("Location is shared only while the app is open. To share it with the screen off, allow location \"All the time\" for this app in the phone's settings."));
  };

  /** Open a trip; mine: my own route (share at once). Someone else's trip is only shown, sharing is asked for. */
  const openTrip = async (t, mine = true) => {
    setBusy(true);
    try {
      await loadTrip(t.trip_id);
      if (mine && t.status === "running" && Tracker.getStatus().tripId !== t.trip_id) await shareTrip(t);
    } catch (e) { Alert.alert(_t("My bus trip"), _tx(e.message)); } finally { setBusy(false); }
  };

  const shareHere = (t) => Alert.alert(_t("Share this phone's location?"),
    _t("Only do this if you are on this bus: parents will see this phone's position as the bus."), [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Share"), onPress: async () => { setBusy(true); try { await shareTrip(t); } catch (e) { Alert.alert(_t("My bus trip"), _tx(e.message)); } finally { setBusy(false); } } },
    ]);

  const finish = (force = false) => {
    const go = async () => {
      setBusy(true);
      try {
        await Tracker.flush().catch(() => {});
        const r = await endTrip(user, trip.trip_id, force);
        if (!r.ended && r.check) {
          Alert.alert(_t("Check the bus"), `${_tx(r.message)}\n\n${r.on_bus.map((s) => `• ${s.name}`).join("\n")}`, [
            { text: _t("Go back"), style: "cancel" },
            { text: _t("Checked – nobody on the bus"), style: "destructive", onPress: () => finish(true) },
          ]);
          return;
        }
        await Tracker.stopSharing({ skipFlush: true });
        setTrip(null);
        loadHome();
      } catch (e) { Alert.alert(_t("My bus trip"), _tx(e.message)); } finally { setBusy(false); }
    };
    if (force) { go(); return; }
    Alert.alert(_t("End the trip?"), _t("The phone stops sharing its location."), [{ text: _t("Cancel"), style: "cancel" }, { text: _t("End trip"), style: "destructive", onPress: go }]);
  };

  const mark = async (s, status) => {
    try {
      const r = await markStudent(user, trip.trip_id, s.enrollment_id, s.status === status ? "clear" : status);
      setTrip((t) => ({ ...t, students: r.students }));
    } catch (e) { Alert.alert(_t("My bus trip"), _tx(e.message)); }
  };

  // students grouped by the trip's stop order
  const groups = useMemo(() => {
    if (!trip) return [];
    const byStop = {};
    (trip.students ?? []).forEach((s) => { (byStop[s.stop_id ?? 0] = byStop[s.stop_id ?? 0] || []).push(s); });
    const out = (trip.stops ?? []).map((st) => ({ stop: st, students: byStop[st.stop_id] ?? [] }));
    const onTrip = new Set((trip.stops ?? []).map((st) => st.stop_id));
    const others = (trip.students ?? []).filter((st) => !st.stop_id || !onTrip.has(st.stop_id));
    if (others.length) out.push({ stop: { stop_id: 0, name: _t("No stop set"), status: "pending" }, students: others });
    return out;
  }, [trip]);

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="alert-circle" text={err} /></View>;
  if (!home) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;

  // ── a trip is open
  if (trip) {
    const pick = trip.direction === "pickup";
    const running = trip.status === "running";
    const sentAgo = share.lastSentAt ? Math.round((now - share.lastSentAt) / 1000) : null;
    const onBoard = (trip.students ?? []).filter((s) => s.status === "boarded").length;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadTrip(trip.trip_id)} />}>
          <Card>
            <Text style={s.big}>{trip.route_name}</Text>
            <Text style={s.meta}>{DIRECTION_LABEL[trip.direction]?.()} · {_t("started {time}", { time: trip.started_at })}{!running ? ` · ${_t("ended {time}", { time: trip.ended_at })}` : ""}</Text>
            {running && (
              <View style={[s.banner, { backgroundColor: share.active && share.tripId === trip.trip_id ? (share.error ? "#fef3c7" : "#dcfce7") : "#fee2e2" }]}>
                <Feather name={share.active && share.tripId === trip.trip_id ? "radio" : "alert-triangle"} size={16}
                  color={share.active && share.tripId === trip.trip_id ? (share.error ? C.warn : C.ok) : C.err} />
                <Text style={s.bannerTxt}>
                  {share.active && share.tripId === trip.trip_id
                    ? (share.error ? _tx(share.error)
                      : `${share.mode === "background" ? _t("Sharing the location (also with the screen off).") : _t("Sharing the location – keep the app open.")}${sentAgo != null ? ` ${_t("Sent {ago}.", { ago: ageText(sentAgo) })}` : ""}${share.queued > 1 ? ` ${_t("{n} waiting to be sent.", { n: share.queued })}` : ""}`)
                    : _t("This phone is not sharing the location of this trip.")}
                </Text>
              </View>
            )}
            {running && !(share.active && share.tripId === trip.trip_id) && <Btn title={_t("Share from this phone")} icon="radio" onPress={() => shareHere(trip)} busy={busy} />}
            <View style={s.stats}>
              <Stat n={onBoard} label={_t("on the bus")} />
              <Stat n={(trip.students ?? []).length} label={_t("students")} />
              <Stat n={trip.next_stop ?? "—"} label={_t("next stop")} />
            </View>
          </Card>

          <BusMap height={220}
            stops={(trip.stops ?? []).map((x) => ({ id: x.stop_id, name: x.name, lat: x.lat, lng: x.lng, status: x.status }))}
            me={share.lastFix ? { lat: share.lastFix.lat, lng: share.lastFix.lng } : (trip.bus ? { lat: trip.bus.lat, lng: trip.bus.lng } : null)}
            follow="me" style={{ marginBottom: 12 }} />

          {groups.map(({ stop, students }) => (
            <Card key={stop.stop_id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[s.dot, { backgroundColor: STOP_COLOR[stop.status] ?? C.brand }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, stop.status !== "pending" && stop.status !== "arrived" && { color: C.muted }]}>{stop.name}</Text>
                  <Text style={s.meta}>
                    {stop.time ? _t("planned {time}", { time: stop.time }) : ""}
                    {stop.status === "arrived" ? ` · ${_t("here since {time}", { time: stop.arrived_at })}` : stop.status === "left" ? ` · ${_t("left {time}", { time: stop.left_at })}`
                      : stop.status === "passed" ? ` · ${_t("passed")}` : stop.eta_min != null ? ` · ${_t("in about {n} min", { n: stop.eta_min })}` : ""}
                    {stop.lat == null && stop.stop_id ? ` · ${_t("no map point")}` : ""}
                  </Text>
                </View>
              </View>
              {students.map((st) => (
                <View key={st.enrollment_id} style={s.student}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sName}>{st.name}</Text>
                    <Text style={s.meta}>{st.class_label}{st.status === "boarded" && st.boarded_at ? ` · ${_t("on at {time}", { time: st.boarded_at })}` : ""}{st.status === "dropped" && st.dropped_at ? ` · ${_t("off at {time}", { time: st.dropped_at })}` : ""}</Text>
                  </View>
                  {!!st.phone && <TouchableOpacity onPress={() => Linking.openURL(`tel:${String(st.phone).replace(/[^\d+]/g, "")}`)} style={s.iconBtn} accessibilityLabel={_t("Call the parent")}><Feather name="phone" size={16} color={C.brand} /></TouchableOpacity>}
                  <Chip on={st.status === "boarded"} color={C.ok} label={_t("On")} onPress={() => mark(st, "boarded")} />
                  {!pick && <Chip on={st.status === "dropped"} color={C.brand} label={_t("Off")} onPress={() => mark(st, "dropped")} />}
                  <Chip on={st.status === "absent"} color={C.err} label={_t("Absent")} onPress={() => mark(st, "absent")} />
                </View>
              ))}
            </Card>
          ))}

          {running ? <Btn title={_t("End trip")} icon="square" kind="danger" busy={busy} onPress={() => finish(false)} />
            : <Btn title={_t("Back to my routes")} kind="ghost" onPress={() => { setTrip(null); loadHome(); }} />}
          {pick && running && <Text style={[s.meta, { marginTop: 6, textAlign: "center" }]}>{_t("At school, End trip marks everyone on the bus as reached school.")}</Text>}
        </ScrollView>
      </View>
    );
  }

  // ── my routes
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={false} onRefresh={loadHome} />}>
        {!home.routes.length && (
          <Card>
            <Empty icon="truck" text={home.linked ? _t("Your driver record has no route this school year. Ask the office (Transport › Assignments).")
              : _t("This login is not linked to a bus driver. Ask the office to link it (Transport › Live buses › Drivers).")} />
          </Card>
        )}
        {home.routes.map((r) => {
          const running = r.trips.find((t) => t.status === "running");
          return (
            <Card key={r.route_id}>
              <Text style={s.big}>{r.route_name}</Text>
              <Text style={s.meta}>{[r.vehicle_number, r.driver_name].filter(Boolean).join(" · ")}{!r.mine ? ` · ${_t("not your route")}` : ""}</Text>
              <Text style={s.meta}>{_t("{n} stops", { n: r.stops })}{r.stops_on_map < r.stops ? ` · ${_t("{n} without a map point (no alerts for them)", { n: r.stops - r.stops_on_map })}` : ""}</Text>
              {r.trips.map((t) => (
                <TouchableOpacity key={t.trip_id} style={s.tripRow} onPress={() => openTrip(t, r.mine)}>
                  <Feather name={t.status === "running" ? "radio" : "check-circle"} size={15} color={t.status === "running" ? C.ok : C.muted} />
                  <Text style={[s.meta, { flex: 1, marginTop: 0 }]}>{DIRECTION_LABEL[t.direction]?.()} · {t.status === "running" ? _t("running since {time}", { time: t.started_at }) : _t("{from} – {to}", { from: t.started_at, to: t.ended_at })}</Text>
                  <Feather name="chevron-right" size={16} color={C.muted} />
                </TouchableOpacity>
              ))}
              {running ? <Btn title={r.mine ? _t("Continue the trip") : _t("Open the trip")} icon="play" busy={busy} onPress={() => openTrip(running, r.mine)} style={{ marginTop: 8 }} />
                : (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    {["pickup", "drop"].map((dir) => (
                      <Btn key={dir} title={DIRECTION_LABEL[dir]()} icon={dir === "pickup" ? "sunrise" : "sunset"} kind={home.suggested === dir ? "primary" : "ghost"}
                        busy={busy} onPress={() => start(r, dir)} style={{ flex: 1 }} disabled={!r.stops} />
                    ))}
                  </View>
                )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Stat({ n, label }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={s.statN} numberOfLines={1}>{n}</Text><Text style={s.meta}>{label}</Text></View>;
}

function Chip({ on, color, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, { borderColor: color }, on && { backgroundColor: color }]}>
      <Text style={[s.chipTxt, { color: on ? "#fff" : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 17, fontWeight: "800", color: C.ink },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  sName: { fontSize: 13, fontWeight: "700", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  banner: { flexDirection: "row", gap: 8, alignItems: "center", borderRadius: 10, padding: 10, marginTop: 10 },
  bannerTxt: { flex: 1, fontSize: 12, fontWeight: "600", color: C.ink },
  stats: { flexDirection: "row", marginTop: 10, borderTopWidth: 1, borderColor: "#f1f5f9", paddingTop: 10 },
  statN: { fontSize: 16, fontWeight: "800", color: C.brand },
  dot: { width: 12, height: 12, borderRadius: 6 },
  student: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, borderTopWidth: 1, borderColor: "#f1f5f9" },
  chip: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipTxt: { fontSize: 12, fontWeight: "800" },
  iconBtn: { padding: 6 },
  tripRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderColor: "#f1f5f9", marginTop: 6 },
});
