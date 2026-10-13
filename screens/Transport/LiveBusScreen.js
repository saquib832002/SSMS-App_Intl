/**
 * Parents / students: where is my child's bus.
 * While a trip runs: the bus on the map (updated every few seconds), how far it is from our stop, whether the child
 * got on / off; the driver and the bus; our stops and times; the alerts the family wants.
 */
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking, RefreshControl, AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Empty, Toggle } from "../../components/ReportCardUI";
import BusMap from "../../components/BusMap";
import { getMyBus, setMyBusAlert, DIRECTION_LABEL, ageText } from "../../services/BusApi";
import { _t, _tx } from "../../services/i18n";

const POLL = 10000;

function stateText(d) {
  const l = d.live;
  const child = d.student.name;
  const stop = l.my_stop ? d.stops.find((x) => x.stop_id === l.my_stop.stop_id)?.name ?? "" : "";
  switch (l.state) {
    case "dropped": return l.direction === "pickup" ? _t("{child} reached school.", { child }) : _t("{child} got off the bus at {time}.", { child, time: l.me?.dropped_at ?? "" });
    case "absent": return _t("{child} is marked not on the bus today.", { child });
    case "on_board": return _t("{child} is on the bus (got on at {time}).", { child, time: l.me?.boarded_at ?? "" });
    case "at_stop": return _t("The bus is at {stop} now.", { stop });
    case "passed": return _t("The bus has passed {stop}.", { stop });
    case "near": return l.my_stop?.eta_min != null ? _t("The bus is near – about {n} min to {stop}.", { n: l.my_stop.eta_min, stop }) : _t("The bus is near {stop}.", { stop });
    default: return l.my_stop?.eta_min != null ? _t("On the way – about {n} min to {stop} ({time}).", { n: l.my_stop.eta_min, stop, time: l.my_stop.eta_at ?? "" })
      : _t("The bus is on the way.");
  }
}

export default function LiveBusScreen({ route }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const eid = route?.params?.enrollment_id ?? activeEnrollmentId ?? user?.enrollmentId ?? user?.ssmsUserName ?? "";
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [offline, setOffline] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { setD(await getMyBus(user, eid)); setErr(null); setOffline(false); } catch (e) {
      if (e?.network) setOffline(true); else setErr(_tx(e.message));
    } finally { busy.current = false; }
  }, [user, eid]);

  // poll while the screen is open and the app is in front
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(() => { if (AppState.currentState === "active") load(); }, POLL);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") load(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [load]));

  const toggle = async (a) => {
    try { const r = await setMyBusAlert(user, a.key, !a.on); setD((x) => ({ ...x, alerts: r.alerts })); } catch (e) { Alert.alert(_t("Bus alerts"), _tx(e.message)); }
  };

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="alert-circle" text={err} /></View>;
  if (!d) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;
  if (!d.enrolled) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="truck" text={_t("{child} does not use the school bus this year.", { child: d.student.name })} /></View>;

  const l = d.live;
  const myIds = [d.my_stops.pickup, d.my_stops.drop].filter(Boolean);
  const dirStop = l ? d.my_stops[l.direction] : null;
  const stops = d.stops.map((x) => ({ id: x.stop_id, name: x.name, lat: x.lat, lng: x.lng, mine: l ? x.stop_id === dirStop : myIds.includes(x.stop_id) }));
  const bus = l?.bus ? [{ id: "bus", lat: l.bus.lat, lng: l.bus.lng, heading: l.bus.heading, live: l.bus.live }] : [];
  const stopName = (id) => d.stops.find((x) => x.stop_id === id)?.name ?? "—";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Card>
          <Text style={s.big}>{d.route.name}</Text>
          <Text style={s.meta}>{d.student.name}{d.vehicle ? ` · ${d.vehicle}` : ""}</Text>
          {l ? (
            <>
              <View style={[s.banner, { backgroundColor: l.state === "near" || l.state === "at_stop" ? "#fef3c7" : l.state === "absent" ? "#fee2e2" : "#ede9fe" }]}>
                <Feather name={l.state === "at_stop" ? "map-pin" : l.state === "dropped" ? "check-circle" : "navigation"} size={18} color={C.brand} />
                <Text style={s.bannerTxt}>{stateText(d)}</Text>
              </View>
              <Text style={s.meta}>
                {DIRECTION_LABEL[l.direction]?.()} · {_t("started {time}", { time: l.started_at })}
                {l.next_stop ? ` · ${_t("next stop: {stop}", { stop: l.next_stop })}` : ""}
              </Text>
              {l.bus ? (
                <Text style={[s.meta, !l.bus.live && { color: C.warn, fontWeight: "700" }]}>
                  {l.bus.live ? _t("Live – updated {ago}", { ago: ageText(l.bus.age) }) : _t("No new position since {time} (the phone may have no signal).", { time: l.bus.at })}
                  {l.bus.live && l.bus.speed_kmh != null ? ` · ${_t("{n} km/h", { n: l.bus.speed_kmh })}` : ""}
                </Text>
              ) : <Text style={[s.meta, { color: C.warn }]}>{_t("Waiting for the bus's first position…")}</Text>}
            </>
          ) : (
            <View style={[s.banner, { backgroundColor: "#f1f5f9" }]}>
              <Feather name="moon" size={18} color={C.muted} />
              <Text style={s.bannerTxt}>{_t("The bus is not on a trip right now. You will be told when it starts.")}</Text>
            </View>
          )}
          {offline && <Text style={[s.meta, { color: C.warn }]}>{_t("No connection – showing the last known position.")}</Text>}
        </Card>

        <BusMap stops={stops} buses={bus} follow={bus.length ? "bus" : null} height={300} style={{ marginBottom: 12 }} />

        {!!d.driver && (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Feather name="user" size={18} color={C.brand} />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{d.driver.name}</Text>
                <Text style={s.meta}>{_t("Driver")}</Text>
              </View>
              {!!d.driver.phone && (
                <TouchableOpacity style={s.call} onPress={() => Linking.openURL(`tel:${String(d.driver.phone).replace(/[^\d+]/g, "")}`)}>
                  <Feather name="phone" size={16} color="#fff" /><Text style={s.callTxt}>{_t("Call")}</Text>
                </TouchableOpacity>
              )}
            </View>
          </Card>
        )}

        <Card title={_t("Our stops")}>
          {!!d.my_stops.pickup && <Text style={s.row}>{_t("Morning pick-up")}: <Text style={s.name}>{stopName(d.my_stops.pickup)}</Text>{d.stops.find((x) => x.stop_id === d.my_stops.pickup)?.pickup_time ? ` · ${d.stops.find((x) => x.stop_id === d.my_stops.pickup).pickup_time}` : ""}</Text>}
          {!!d.my_stops.drop && <Text style={s.row}>{_t("Afternoon drop")}: <Text style={s.name}>{stopName(d.my_stops.drop)}</Text>{d.stops.find((x) => x.stop_id === d.my_stops.drop)?.dropoff_time ? ` · ${d.stops.find((x) => x.stop_id === d.my_stops.drop).dropoff_time}` : ""}</Text>}
        </Card>

        {!!d.trips_today.length && (
          <Card title={_t("Today")}>
            {d.trips_today.map((t) => (
              <View key={t.trip_id} style={s.trip}>
                <Text style={s.name}>{DIRECTION_LABEL[t.direction]?.()} <Text style={s.meta}>{t.started_at} – {t.ended_at ?? ""}</Text></Text>
                <Text style={s.meta}>
                  {t.me?.status === "dropped" ? (t.direction === "pickup" ? _t("Reached school at {time}", { time: t.me.dropped_at }) : _t("Got off at {time}", { time: t.me.dropped_at }))
                    : t.me?.status === "boarded" ? _t("Got on at {time}", { time: t.me.boarded_at })
                      : t.me?.status === "absent" ? _t("Not on the bus") : _t("Not marked by the driver")}
                  {t.my_stop?.arrived_at ? ` · ${_t("bus at our stop {time}", { time: t.my_stop.arrived_at })}` : ""}
                </Text>
              </View>
            ))}
          </Card>
        )}

        <Card title={_t("Bus alerts")}>
          {d.alerts.map((a) => <Toggle key={a.key} label={_tx(a.label)} value={a.on} onChange={() => toggle(a)} />)}
        </Card>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 17, fontWeight: "800", color: C.ink },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  row: { fontSize: 13, color: C.ink, paddingVertical: 4 },
  banner: { flexDirection: "row", gap: 10, alignItems: "center", borderRadius: 12, padding: 12, marginTop: 10 },
  bannerTxt: { flex: 1, fontSize: 14, fontWeight: "700", color: C.ink, lineHeight: 19 },
  call: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: C.ok, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  callTxt: { color: "#fff", fontWeight: "800" },
  trip: { paddingVertical: 6, borderTopWidth: 1, borderColor: "#f1f5f9" },
});
