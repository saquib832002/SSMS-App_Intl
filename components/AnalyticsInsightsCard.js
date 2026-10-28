/**
 * Small "School insights" card for the staff dashboard: attendance this week, students needing
 * attention and fee collection, with a tap through to School analytics.
 * It stays hidden when the person can't see analytics, the server is older, or anything fails –
 * the dashboard must never break because of it.
 */
import React, { useCallback, useContext, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { getOverview, pct, money } from "../services/AnalyticsApi";
import { STATUS, INK } from "./Charts";
import { _t, _tx } from "../services/i18n";

export default function AnalyticsInsightsCard({ navigation }) {
  const { user, can, hasFeature } = useContext(AuthContext);
  const [d, setD] = useState(null);
  const last = useRef(0);
  const role = (user?.ssmsUserRole ?? "").toLowerCase();
  const allowed = !!user?.token && !["parent", "student"].includes(role) && can("analytics", "view") && hasFeature("analytics");   // Pro plan: no call (and no "upgrade" pop-up) on Basic

  useFocusEffect(useCallback(() => {
    if (!allowed || Date.now() - last.current < 120000) return undefined;   // at most every 2 minutes
    let off = false;
    last.current = Date.now();
    getOverview(user, {}).then((r) => { if (!off) setD(r && typeof r === "object" ? r : null); }).catch(() => { if (!off) setD(null); });
    return () => { off = true; };
  }, [allowed, user]));

  if (!allowed || !d) return null;
  const a = d.attendance, f = d.fees, r = d.at_risk ?? { critical: 0, watch: 0 };
  const items = [
    a && { key: "att", label: _t("Attendance, 7 days"), value: pct(a.week_pct),
      sub: a.change == null ? null : _t("{v} {v2} vs last week", { v: a.change >= 0 ? "▲" : "▼", v2: Math.abs(a.change).toFixed(1) }), tab: "attendance" },
    { key: "risk", label: _t("Need attention"), value: String((r.critical ?? 0) + (r.watch ?? 0)), sub: _t("{v} at risk", { v: r.critical ?? 0 }), tone: r.critical ? "critical" : null, tab: "risk" },
    f && { key: "fees", label: _t("Fees collected"), value: pct(f.collection_rate), sub: _t("{outstanding} due", { outstanding: money(f.outstanding, f.currency, true) }), tab: "fees" },
  ].filter(Boolean);

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate("Analytics")} style={s.card} accessibilityRole="button" accessibilityLabel={_t("Open school analytics")}>
      <View style={s.head}>
        <Feather name="trending-up" size={15} color="#0f766e" />
        <Text style={s.title}>{_t("School insights")}</Text>
        <Feather name="chevron-right" size={16} color="#94a3b8" />
      </View>
      <View style={s.row}>
        {items.map((it) => (
          <TouchableOpacity key={it.key} style={s.item} onPress={() => navigation.navigate("Analytics", { tab: it.tab })} activeOpacity={0.8}>
            <Text style={s.label} numberOfLines={1}>{_tx(it.label)}</Text>
            <Text style={s.value}>{_tx(it.value)}</Text>
            {!!it.sub && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {it.tone === "critical" && <Feather name="alert-octagon" size={10} color={STATUS.critical} />}
                <Text style={s.sub} numberOfLines={1}>{_tx(it.sub)}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 12, marginTop: 10, borderLeftWidth: 3, borderLeftColor: "#0f766e", borderWidth: 1, borderColor: "#e2e8f0" },
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  title: { flex: 1, fontSize: 13, fontWeight: "800", color: INK.primary },
  row: { flexDirection: "row", gap: 8 },
  item: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 10, padding: 10 },
  label: { fontSize: 10.5, color: INK.muted, fontWeight: "600" },
  value: { fontSize: 18, fontWeight: "800", color: INK.primary, marginTop: 2 },
  sub: { fontSize: 10.5, color: INK.secondary },
});
