// ============================================
// screens/SettingsScreen.js
// ============================================
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

export default function SettingsScreen() {
  const items = [
    { label: "Profile Preferences", icon: "user" },
    { label: "App Appearance", icon: "moon" },
    { label: "Notifications", icon: "bell" },
    { label: "Security", icon: "shield" },
  ];

  return (
    <View style={settingsStyles.container}>
      <Text style={settingsStyles.title}>Settings</Text>
      <Text style={settingsStyles.subtitle}>Manage your account and application preferences.</Text>

      {items.map((item) => (
        <TouchableOpacity key={item.label} style={settingsStyles.card}>
          <View style={settingsStyles.iconWrap}>
            <Feather name={item.icon} size={18} color="#2563eb" />
          </View>
          <Text style={settingsStyles.cardText}>{item.label}</Text>
          <Feather name="chevron-right" size={18} color="#94a3b8" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const settingsStyles = StyleSheet.create({
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
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
});
