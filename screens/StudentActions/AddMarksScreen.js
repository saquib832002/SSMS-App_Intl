// ============================================
// screens/AddMarksScreen.js
// ============================================
import React from "react";
import { View, Text } from "react-native";


export default function AddMarksScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" }}>
      <Text style={{ fontSize: 22, fontWeight: "bold" }}>Add Marks</Text>
      <Text style={{ marginTop: 8, color: "#64748b" }}>Enter or upload student marks</Text>
    </View>
  );
}