/**
 * Parent–teacher meetings (staff) – my sessions, or every teacher's for the office.
 * "Publish slots" opens the form; tap a session to see bookings.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty } from "../../components/ReportCardUI";
import { getSessions, niceDay, niceTime, MODE_ICON } from "../../services/MeetingApi";
import { _t, _tx } from "../../services/i18n";

export default function MeetingsScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [scope, setScope] = useState("mine");
  const [when, setWhen] = useState("upcoming");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getSessions(user, { scope, when })); setErr(null); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [user, scope, when]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const can = data?.can ?? {};
  const list = Array.isArray(data?.sessions) ? data.sessions : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {can.all && (
        <View style={s.tabs}>
          {[["mine", "My sessions"], ["all", "All teachers"]].map(([k, l]) => (
            <TouchableOpacity key={k} style={[s.tab, scope === k && s.tabOn]} onPress={() => setScope(k)}>
              <Text style={[s.tabTxt, scope === k && { color: C.brand }]}>{_tx(l)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={s.tabs}>
        {[["upcoming", "Upcoming"], ["past", "Past"]].map(([k, l]) => (
          <TouchableOpacity key={k} style={[s.tab, when === k && s.tabOn]} onPress={() => setWhen(k)}>
            <Text style={[s.tabTxt, when === k && { color: C.brand }]}>{_tx(l)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {(can.edit || can.all) && when === "upcoming" && (
        <Btn title={_t("Publish meeting slots")} icon="plus" onPress={() => navigation.navigate("MeetingEdit", { hasStaff: !!can.has_staff })} style={{ marginTop: 0, marginBottom: 12 }} />
      )}
      {data && !can.has_staff && !can.all && (
        <Card><Text style={s.meta}>{_t("Your account isn't linked to a staff record, so you can't publish slots. Ask the office to link it, or to publish slots for you.")}</Text></Card>
      )}

      {!data && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
      {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
      {data && !list.length && !err && (
        <Card><Empty icon="calendar" text={when === "upcoming" ? _t("No meeting sessions yet. Publish slots and parents of your classes can book.") : _t("No past sessions.")} /></Card>
      )}
      {list.map((x) => (
        <TouchableOpacity key={x.id} activeOpacity={0.8} onPress={() => navigation.navigate("MeetingSession", { id: x.id, title: x.title })}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View style={s.dateBox}>
                <Text style={s.dateDay}>{_tx(niceDay(x.meet_date).split(" ")[0])}</Text>
                <Text style={s.dateNum}>{niceDay(x.meet_date).split(" ").slice(1).join(" ")}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{_tx(x.title)}</Text>
                <Text style={s.meta}>{_t("{start_time} – {end_time} · {slot_minutes} min slots{v}", { start_time: niceTime(x.start_time), end_time: niceTime(x.end_time), slot_minutes: x.slot_minutes, v: scope === "all" ? ` · ${x.teacher}` : "" })}</Text>
                <View style={s.row}>
                  <Feather name={MODE_ICON[x.mode] ?? "map-pin"} size={12} color={C.muted} />
                  <Text style={s.meta}> {_tx(x.mode_label)}{x.location && x.mode !== "video" ? ` · ${_tx(x.location)}` : ""}</Text>
                </View>
                <Text style={s.meta}>{_tx(x.audience_label)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {x.status === "cancelled" ? <Text style={[s.pill, { backgroundColor: "#fee2e2", color: "#991b1b" }]}>{_t("Cancelled")}</Text>
                  : x.status === "closed" ? <Text style={[s.pill, { backgroundColor: "#f1f5f9", color: "#475569" }]}>{_t("Closed")}</Text>
                  : <Text style={[s.pill, { backgroundColor: "#dcfce7", color: "#166534" }]}>{_t("Open")}</Text>}
                <Text style={[s.meta, { marginTop: 6 }]}>{_t("{booked}/{slots} booked", { booked: x.booked, slots: x.slots })}</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 6, marginBottom: 10 },
  tab: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: "#fff" },
  tabOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  name: { fontSize: 15, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  pill: { fontSize: 11, fontWeight: "800", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  dateBox: { width: 52, borderRadius: 10, backgroundColor: C.brandSoft, alignItems: "center", paddingVertical: 6 },
  dateDay: { fontSize: 11, fontWeight: "800", color: C.brand },
  dateNum: { fontSize: 12, fontWeight: "800", color: C.ink, textAlign: "center" },
});
