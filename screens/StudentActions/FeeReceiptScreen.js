// ============================================
// screens/FeeReceiptScreen.js
// ============================================
import React from "react";
import { View, Text } from "react-native";

export default function FeeReceiptScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" }}>
      <Text style={{ fontSize: 22, fontWeight: "bold" }}>Fee Receipt</Text>
      <Text style={{ marginTop: 8, color: "#64748b" }}>Manage payments and receipts</Text>
    </View>
  );
}