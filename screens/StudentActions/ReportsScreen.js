// ============================================
// screens/ReportsScreen.js
// ============================================
import React from "react";
import { View, Text } from "react-native";

export default function ReportsScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" }}>
      <Text style={{ fontSize: 22, fontWeight: "bold" }}>Reports</Text>
      <Text style={{ marginTop: 8, color: "#64748b" }}>Analytics and reporting screen</Text>
    </View>
  );
}