/**
 * components/FeatureGate.js
 *
 * Wraps every screen of a navigator (via the navigator's `screenLayout`
 * prop). For subscription (international) schools, a screen whose feature
 * is not in the school's plan is replaced by a friendly "not included"
 * screen, so the locked screen never mounts and never calls the API.
 * Indian (legacy) schools are never affected.
 *
 * It also applies Settings › Roles & permissions: a screen whose module the
 * person's role can't see is replaced by a "no access" screen, so it never
 * mounts or calls an API that would only be refused.
 */
import React, { useContext } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { ROUTE_FEATURES, FEATURE_LABELS } from "../constants/RouteFeatures";
import { PLANS_SOLD_IN_APP } from "../constants/Store";
import { ROUTE_MODULES, ROUTE_KIND } from "../constants/RouteModules";
import { _t, _tx } from "../services/i18n";

/** Hub screens that list other screens – never blocked themselves. */
const NOT_GATED = ["StudentsList", "SetupHome"];
const MODULE_LABELS = {
  students: "Students", health: "Student health", attendance: "Attendance", student_leave: "Student leave & late/early", exams: "Exams, marks & report cards", exam_logistics: "Exam halls, seating & admit cards",
  homework: "Homework", fees: "Fees", finance: "Finance & payroll", staff: "Staff & HR", staff_attendance: "Staff attendance",
  timetable: "Timetable & subjects", transport: "Transport", hostel: "Hostel", library: "Library",
  notices: "Notices, events & gallery", messages: "Messages", meetings: "Parent–teacher meetings", analytics: "Reports & analytics", settings: "School settings", users: "Users & roles", privacy: "Privacy & audit",
};

export function NoAccess({ module, kind = "view", navigation }) {
  const label = MODULE_LABELS[module] ?? "This screen";
  const what = { view: "see", edit: "add or change", delete: "delete", approve: "approve", export: "export" }[kind] ?? "use";
  const goBack = () => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation?.navigate?.("Dashboard");
  };
  return (
    <View style={s.wrap}>
      <View style={s.icon}><Feather name="shield-off" size={28} color="#1e40af" /></View>
      <Text style={s.title}>{_tx(label)}</Text>
      <Text style={s.msg}>{_t("Your role doesn't allow you to {what} {v}.", { what, v: label.toLowerCase() })}</Text>
      <Text style={s.hint}>{_t("If you need it, ask the school owner to change your role in Settings › Roles & permissions.")}</Text>
      <TouchableOpacity style={s.btnGhost} onPress={goBack} activeOpacity={0.8}>
        <Feather name="arrow-left" size={16} color="#1e40af" />
        <Text style={s.btnGhostTxt}>{_t("Go back")}</Text>
      </TouchableOpacity>
    </View>
  );
}

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
      <Text style={s.title}>{_tx(label)}</Text>
      <Text style={s.msg}>{_t("This feature isn't included in your school's current plan, or the free trial has ended.")}</Text>
      <Text style={s.hint}>
        {!PLANS_SOLD_IN_APP
          ? (isOwner ? _t("Your school's plan is managed by your school's account. It can't be changed in this app.")
                     : _t("Please ask your school administrator about the school's plan."))
          : isOwner
            ? _t("Choose a plan to unlock it for your whole school.")
            : _t("Please ask your school administrator to upgrade the plan.")}
      </Text>
      {isOwner && PLANS_SOLD_IN_APP && (
        <TouchableOpacity style={[s.btn, { marginBottom: 10 }]} onPress={() => navigation?.navigate?.("Subscription")} activeOpacity={0.8}>
          <Feather name="credit-card" size={16} color="#fff" />
          <Text style={s.btnTxt}>{_t("View plans")}</Text>
        </TouchableOpacity>
      )}
      {navigation?.canGoBack?.() && (
        <TouchableOpacity style={s.btnGhost} onPress={goBack} activeOpacity={0.8}>
          <Feather name="arrow-left" size={16} color="#1e40af" />
          <Text style={s.btnGhostTxt}>{_t("Go back")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function FeatureGate({ routeName, navigation, children }) {
  const { hasFeature, can } = useContext(AuthContext);
  const feature = ROUTE_FEATURES[routeName];
  if (feature && !hasFeature(feature)) {
    return <LockedFeature feature={feature} navigation={navigation} />;
  }
  const module = NOT_GATED.includes(routeName) ? null : ROUTE_MODULES[routeName];
  const kind = ROUTE_KIND[routeName] ?? "view";
  if (module && typeof can === "function" && !can(module, kind)) {
    return <NoAccess module={module} kind={kind} navigation={navigation} />;
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
