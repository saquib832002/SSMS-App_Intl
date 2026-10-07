/**
 * components/FeatureGate.js
 *
 * Wraps every screen of a navigator (via the navigator's `screenLayout`
 * prop). For subscription (international) schools, a screen whose feature
 * is not in the school's plan is replaced by a friendly "not included"
 * screen, so the locked screen never mounts and never calls the API.
 * Indian (legacy) schools are never affected.
 */
import React, { useContext } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { ROUTE_FEATURES, FEATURE_LABELS } from "../constants/RouteFeatures";

export function LockedFeature({ feature, navigation }) {
  const { user } = useContext(AuthContext);
  const role    = (user?.ssmsUserRole ?? "").toLowerCase().trim();
  const isOwner = ["owner", "admin", "super", "superuser"].includes(role);
  const label   = FEATURE_LABELS[feature] ?? "This feature";

  const goBack = () => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation?.navigate?.("Dashboard");
  };

  return (
    <View style={s.wrap}>
      <View style={s.icon}><Feather name="lock" size={28} color="#1e40af" /></View>
      <Text style={s.title}>{label}</Text>
      <Text style={s.msg}>
        This feature isn't included in your school's current plan, or the free trial has ended.
      </Text>
      <Text style={s.hint}>
        {isOwner
          ? "Choose a plan to unlock it for your whole school."
          : "Please ask your school administrator to upgrade the plan."}
      </Text>
      {isOwner && (
        <TouchableOpacity style={[s.btn, { marginBottom: 10 }]} onPress={() => navigation?.navigate?.("Subscription")} activeOpacity={0.8}>
          <Feather name="credit-card" size={16} color="#fff" />
          <Text style={s.btnTxt}>View plans</Text>
        </TouchableOpacity>
      )}
      {navigation?.canGoBack?.() && (
        <TouchableOpacity style={s.btnGhost} onPress={goBack} activeOpacity={0.8}>
          <Feather name="arrow-left" size={16} color="#1e40af" />
          <Text style={s.btnGhostTxt}>Go back</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function FeatureGate({ routeName, navigation, children }) {
  const { hasFeature } = useContext(AuthContext);
  const feature = ROUTE_FEATURES[routeName];
  if (feature && !hasFeature(feature)) {
    return <LockedFeature feature={feature} navigation={navigation} />;
  }
  return children;
}

/** Pass as `screenLayout={featureScreenLayout}` on a Navigator. */
export function featureScreenLayout({ children, route, navigation }) {
  return (
    <FeatureGate routeName={route?.name} navigation={navigation}>
      {children}
    </FeatureGate>
  );
}

const s = StyleSheet.create({
  wrap:   { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#f8fafc" },
  icon:   { width: 64, height: 64, borderRadius: 32, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title:  { fontSize: 18, fontWeight: "800", color: "#0f172a", marginBottom: 8, textAlign: "center" },
  msg:    { fontSize: 14, color: "#334155", textAlign: "center", lineHeight: 20, marginBottom: 8 },
  hint:   { fontSize: 13, color: "#64748b", textAlign: "center", lineHeight: 19, marginBottom: 20 },
  btn:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1e40af", paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnGhost:    { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: "#eff6ff" },
  btnGhostTxt: { color: "#1e40af", fontWeight: "700", fontSize: 14 },
});
