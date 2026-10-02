// ============================================
// screens/AddExamScreen.js
// ============================================
import React from "react";
import { View, Text } from "react-native";

export default function AddExamScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" }}>
      <Text style={{ fontSize: 22, fontWeight: "bold" }}>Add Exam</Text>
      <Text style={{ marginTop: 8, color: "#64748b" }}>Create a new exam schedule</Text>
    </View>
  );
}