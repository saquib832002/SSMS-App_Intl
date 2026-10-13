// ============================================
// screens/AdminScreen.js
// ============================================
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { _t, _tx } from "../services/i18n";

export default function AdminScreen() {
  const items = [
    { label: _t("Manage Users"), icon: "users" },
    { label: _t("Roles & Permissions"), icon: "lock" },
    { label: _t("Academic Setup"), icon: "book-open" },
    { label: _t("System Reports"), icon: "bar-chart-2" },
  ];

  return (
    <View style={adminStyles.container}>
      <Text style={adminStyles.title}>{_t("Admin Panel")}</Text>
      <Text style={adminStyles.subtitle}>{_t("Administrative shortcuts and system controls.")}</Text>

      <View style={adminStyles.grid}>
        {items.map((item) => (
          <TouchableOpacity key={item.label} style={adminStyles.tile}>
            <Feather name={item.icon} size={22} color="#2563eb" />
            <Text style={adminStyles.tileText}>{_tx(item.label)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const adminStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 18,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  tile: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: "center",
    marginBottom: 14,
  },
  tileText: {
    marginTop: 10,
    textAlign: "center",
    fontWeight: "700",
    color: "#0f172a",
  },
});
