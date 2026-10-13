/**
 * Notifications (the bell) – every message the school sent this person: absences, late arrival,
 * homework, notices, fee reminders, report cards, meetings, exams, leave. Tapping one opens its screen.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { AuthContext } from "../context/AuthContext";
import { C, Empty } from "../components/ReportCardUI";
import { _t, _tx } from "../services/i18n";
import { fmtDate, fmtTime, schoolToday } from "../services/Locale";
import { getInbox, markRead, targetOf } from "../services/NotifyApi";

const ICON = {
  absence: ["user-x", "#b91c1c", "#fee2e2"], arrival: ["clock", "#b45309", "#fef3c7"], homework: ["book", "#0369a1", "#e0f2fe"],
  notice: ["bell", "#5b21b6", "#ede9fe"], fee_due: ["credit-card", "#92400e", "#ffedd5"], results: ["award", "#15803d", "#dcfce7"],
  ptm: ["users", "#0f766e", "#ccfbf1"], exam_duty: ["clipboard", "#334155", "#e2e8f0"], admit_card: ["file-text", "#334155", "#e2e8f0"],
};

const when = (ts) => {
  if (!ts) return "";
  const d = String(ts).slice(0, 10);
  return d === schoolToday() ? fmtTime(ts) : fmtDate(ts, "dayMonth") + " · " + fmtTime(ts);
};

export default function InboxScreen({ navigation }) {
  const { user, setActiveEnrollmentId } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const role = String(user?.ssmsUserRole ?? "").toLowerCase().trim();
  const family = role === "parent" || role === "student";
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const r = await getInbox(user, 0, 30);
      setItems(r.items ?? []);
      setUnread(r.unread ?? 0);
      setMore((r.items ?? []).length === 30);
    } catch (e) {
      setError(_tx(e.message));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (!more || loading || refreshing || !items.length) return;
    try {
      const r = await getInbox(user, items[items.length - 1].id, 30);
      setItems((x) => [...x, ...(r.items ?? [])]);
      setMore((r.items ?? []).length === 30);
    } catch { setMore(false); }
  };

  const open = async (it) => {
    if (!it.read) {
      setItems((x) => x.map((y) => (y.id === it.id ? { ...y, read: true } : y)));
      setUnread((n) => Math.max(0, n - 1));
      markRead(user, [it.id]).catch(() => {});
    }
    const t = targetOf(it.data, family);
    if (!t) return;
    if (it.enrollment_id && family && setActiveEnrollmentId) { try { setActiveEnrollmentId(String(it.enrollment_id)); } catch { /* ignore */ } }
    try { navigation.navigate(t[0], t[1]); } catch { /* not available for this account */ }
  };

  const readAll = async () => {
    try {
      await markRead(user, "all");
      setItems((x) => x.map((y) => ({ ...y, read: true })));
      setUnread(0);
    } catch (e) { Alert.alert(_t("Notifications"), _tx(e.message)); }
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => unread > 0 ? (
        <TouchableOpacity onPress={readAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
          <Text style={s.readAll}>{_t("Mark all read")}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => navigation.navigate("MyNotifications")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={_t("My notifications")}>
          <Feather name="sliders" size={18} color={C.brand} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, unread]);   // eslint-disable-line react-hooks/exhaustive-deps

  const Row = ({ item: it }) => {
    const [icon, color, bg] = ICON[it.event] ?? ["bell", "#475569", "#f1f5f9"];
    const t = targetOf(it.data, family);
    return (
      <TouchableOpacity style={[s.row, !it.read && s.rowNew]} activeOpacity={0.8} onPress={() => open(it)}>
        <View style={[s.icon, { backgroundColor: bg }]}><Feather name={icon} size={17} color={color} /></View>
        <View style={{ flex: 1 }}>
          <View style={s.top}>
            <Text style={[s.title, !it.read && { fontWeight: "800" }]} numberOfLines={2}>{it.title}</Text>
            <Text style={s.time}>{when(it.created)}</Text>
          </View>
          {!!it.body && <Text style={s.body} numberOfLines={4}>{it.body}</Text>}
        </View>
        {!it.read ? <View style={s.dot} /> : t ? <Feather name="chevron-right" size={16} color="#cbd5e1" /> : null}
      </TouchableOpacity>
    );
  };

  if (loading && !items.length) {
    return <View style={[s.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.brand} /></View>;
  }
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom, flexGrow: 1 }}
      data={items}
      keyExtractor={(it) => String(it.id)}
      renderItem={Row}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      ListHeaderComponent={error ? (
        <TouchableOpacity style={s.err} onPress={() => load()}><Text style={s.errTxt}>{error}</Text><Text style={s.retry}>{_t("Try again")}</Text></TouchableOpacity>
      ) : null}
      ListEmptyComponent={!error ? <Empty icon="bell" text={_t("No notifications yet. Messages from the school will appear here.")} /> : null}
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  rowNew: { borderColor: "#c4b5fd", backgroundColor: "#faf5ff" },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginTop: 1 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: "600", color: C.ink },
  time: { fontSize: 11, color: C.muted, marginTop: 2 },
  body: { fontSize: 13, color: "#334155", marginTop: 3, lineHeight: 18 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.brand, marginTop: 6 },
  readAll: { color: C.brand, fontWeight: "700", fontSize: 13 },
  err: { backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, marginBottom: 10 },
  errTxt: { color: C.err, fontSize: 13 },
  retry: { color: C.brand, fontWeight: "700", marginTop: 6 },
});
