// ============================================
// screens/GenerateMarksheetScreen.js
// ============================================
import React from "react";
import { View, Text } from "react-native";
import { _t } from "../../services/i18n";

export default function GenerateMarksheetScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" }}>
      <Text style={{ fontSize: 22, fontWeight: "bold" }}>{_t("Generate Marksheet")}</Text>
      <Text style={{ marginTop: 8, color: "#64748b" }}>{_t("Generate marksheets and results")}</Text>
    </View>
  );
}
