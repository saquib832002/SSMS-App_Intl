/**
 * Staff: my invigilation duties (published seating plans) – where, when, how many students, with whom.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Empty } from "../../components/ReportCardUI";
import { getMyDuties, niceDate, timeRange } from "../../services/ExamLogisticsApi";
import { _t, _tx } from "../../services/i18n";

export default function MyExamDutiesScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await getMyDuties(user)); setErr(null); } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = d?.today ?? "";
  const list = d?.duties ?? [];
  const upcoming = list.filter((x) => x.exam_date >= today);
  const past = list.filter((x) => x.exam_date < today);

  const item = (x) => (
    <Card key={x.id} style={x.exam_date < today && { opacity: 0.65 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Feather name={x.role === "chief" ? "star" : "user-check"} size={18} color={C.brand} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{_tx(x.hall)}{x.location ? ` · ${_tx(x.location)}` : ""}</Text>
          <Text style={s.meta}>{niceDate(x.exam_date)}{x.exam_date === today ? (" " + _t("(today)") + "") : ""} · {timeRange(x.start_time, x.end_time)}</Text>
          <Text style={s.meta}>{_t("{exam} · {role_label} · {students} students", { exam: x.exam, role_label: x.role_label, students: x.students })}</Text>
          {!!x.with?.length && <Text style={s.meta}>{_t("With {v}", { v: x.with.join(", ") })}</Text>}
        </View>
      </View>
    </Card>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} />}>
      {!d && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
      {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
      {d && !d.has_staff && <Card><Empty icon="user-x" text={_t("Your account isn't linked to a staff record, so no duties can be shown. Ask the office to link it.")} /></Card>}
      {d && d.has_staff && !list.length && <Card><Empty icon="calendar" text={_t("No exam duties for you right now.")} /></Card>}
      {upcoming.map(item)}
      {past.length > 0 && <Text style={s.section}>{_t("Last week")}</Text>}
      {past.map(item)}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 17 },
  section: { fontSize: 12, fontWeight: "800", color: C.muted, textTransform: "uppercase", marginVertical: 8 },
});
