// ============================================
// screens/SettingsScreen.js – Security & privacy hub
// ============================================
import React, { useContext, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { getPrivacyOpenCount } from "../services/SecurityApi";
import { _t, _tx } from "../services/i18n";

export default function SettingsScreen({ navigation }) {
  const { user, can } = useContext(AuthContext);
  const role = (user?.ssmsUserRole ?? "").toLowerCase();
  const isOwner = role === "owner";
  const isAdmin = ["owner", "admin"].includes(role);
  const isPortal = ["parent", "student"].includes(role);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    if (isAdmin) getPrivacyOpenCount(user).then(setOpen).catch(() => {});
  }, [user, isAdmin]);

  const mine = [
    { label: _t("Security"), sub: user?.mfaEnabled ? _t("Two-step login on · devices") : _t("Two-step login, devices, sign-ins"), icon: "shield", screen: "Security",
      warn: !!user?.mfaSetupDue && !user?.mfaEnabled },
    { label: _t("Privacy"), sub: isPortal ? _t("Your choices and your child's data") : _t("Your choices and your data"), icon: "eye-off", screen: "Privacy" },
    { label: _t("Change password"), sub: _t("Signs out your other devices"), icon: "lock", screen: "ChangePassword" },
  ];
  const school = [
    isAdmin && { label: _t("School security"), sub: isOwner ? _t("Two-step rules, retention, COPPA") : _t("View the school's security rules"), icon: "settings", screen: "SecuritySettings" },
    (isAdmin || role === "principal" || can("users", "approve")) && { label: _t("Roles & permissions"), sub: _t("Who can see and do what"), icon: "key", screen: "Roles" },
    (isOwner || can("privacy", "view")) && !isPortal && role !== "user" && role !== "teacher" && role !== "staff" && role !== "accountant"
      && { label: _t("Audit log"), sub: _t("Who did what, when"), icon: "list", screen: "AuditLog" },
    (isOwner || (isAdmin && can("privacy", "edit"))) && { label: _t("Privacy requests"), sub: _t("Copies, corrections, deletions"), icon: "inbox", screen: "PrivacyRequests", badge: open },
    !isPortal && role !== "accountant" && { label: _t("Consents"), sub: isAdmin ? _t("Report and what the school asks") : _t("Who agreed to photos and more"), icon: "check-square", screen: "Consents" },
  ].filter(Boolean);

  const Row = ({ item }) => (
    <TouchableOpacity style={s.card} onPress={() => navigation.navigate(item.screen)} activeOpacity={0.8}>
      <View style={s.iconWrap}><Feather name={item.icon} size={18} color="#5b21b6" /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardText}>{_tx(item.label)}</Text>
        <Text style={[s.cardSub, item.warn && { color: "#b45309" }]}>{item.warn ? _t("Required – set up by {mfaSetupDue}", { mfaSetupDue: user.mfaSetupDue }) : _tx(item.sub)}</Text>
      </View>
      {!!item.badge && <View style={s.badge}><Text style={s.badgeTxt}>{_tx(item.badge)}</Text></View>}
      <Feather name="chevron-right" size={18} color="#94a3b8" />
    </TouchableOpacity>
  );

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={s.subtitle}>{_t("Your account, and how the school protects its data.")}</Text>
      <Text style={s.section}>{_t("My account")}</Text>
      {mine.map((i) => <Row key={i.screen} item={i} />)}
      {!!school.length && <Text style={s.section}>{_t("School")}</Text>}
      {school.map((i) => <Row key={i.screen} item={i} />)}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  title: { fontSize: 24, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  subtitle: { color: "#64748b", marginBottom: 10 },
  section: { fontSize: 12, fontWeight: "800", color: "#5b21b6", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 8 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center", marginRight: 12 },
  cardText: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  cardSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  badge: { backgroundColor: "#b91c1c", borderRadius: 999, minWidth: 20, paddingHorizontal: 6, height: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  badgeTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
