/**
 * screens/SelectStudentScreen.js
 *
 * Shown when a parent has 2+ children enrolled in the same school.
 * Lets the parent pick whose dashboard to view.
 * Sets activeEnrollmentId in AuthContext and navigates back to the dashboard.
 */
import React, { useContext } from "react";
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";

export default function SelectStudentScreen({ navigation }) {
  const { linkedStudents, setActiveEnrollmentId } = useContext(AuthContext);
  const students = Array.isArray(linkedStudents) ? linkedStudents : [];

  const handleSelect = (student) => {
    setActiveEnrollmentId(student.enrollment_id);
    navigation.goBack();
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={20} color="#1e3a5f" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Select Student</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={s.subtitle}>Tap a student to view their dashboard</Text>

      <FlatList
        data={students}
        keyExtractor={(item) => String(item.enrollment_id)}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.card}
            onPress={() => handleSelect(item)}
            activeOpacity={0.75}
          >
            {/* Avatar */}
            <View style={s.avatar}>
              <Text style={s.avatarEmoji}>🎓</Text>
            </View>

            {/* Info */}
            <View style={s.info}>
              <Text style={s.name} numberOfLines={1}>{item.student_name}</Text>

              {/* Chips */}
              <View style={s.chips}>
                {!!item.class_name && (
                  <View style={s.chip}>
                    <Feather name="book-open" size={10} color="#1e40af" />
                    <Text style={s.chipTxt}>{item.class_name}</Text>
                  </View>
                )}
                {!!item.section_name && (
                  <View style={[s.chip, s.chipPurple]}>
                    <Feather name="users" size={10} color="#7c3aed" />
                    <Text style={[s.chipTxt, { color: "#7c3aed" }]}>{item.section_name}</Text>
                  </View>
                )}
                {!!item.session_name && (
                  <View style={[s.chip, s.chipTeal]}>
                    <Feather name="calendar" size={10} color="#0369a1" />
                    <Text style={[s.chipTxt, { color: "#0369a1" }]}>{item.session_name}</Text>
                  </View>
                )}
              </View>

              {!!item.roll_number && (
                <Text style={s.roll}>Roll No: {item.roll_number}</Text>
              )}
            </View>

            <Feather name="chevron-right" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="users" size={40} color="#cbd5e1" />
            <Text style={s.emptyTxt}>No linked students found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },

  // Header
  header:      { flexDirection: "row", alignItems: "center",
                 justifyContent: "space-between", paddingHorizontal: 16,
                 paddingVertical: 14, backgroundColor: "#fff",
                 borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:     { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#1e3a5f" },

  subtitle:    { fontSize: 13, color: "#64748b", textAlign: "center",
                 marginTop: 14, marginBottom: 2, paddingHorizontal: 24 },

  list:        { padding: 16, gap: 12 },

  // Student card
  card:        { flexDirection: "row", alignItems: "center", gap: 12,
                 backgroundColor: "#fff", borderRadius: 14, padding: 14,
                 borderWidth: 1, borderColor: "#e2e8f0",
                 shadowColor: "#000", shadowOpacity: 0.05,
                 shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
                 elevation: 2 },

  avatar:      { width: 52, height: 52, borderRadius: 26, backgroundColor: "#eff6ff",
                 alignItems: "center", justifyContent: "center" },
  avatarEmoji: { fontSize: 26 },

  info:        { flex: 1 },
  name:        { fontSize: 15, fontWeight: "700", color: "#1e293b", marginBottom: 6 },

  chips:       { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip:        { flexDirection: "row", alignItems: "center", gap: 3,
                 paddingHorizontal: 6, paddingVertical: 2,
                 backgroundColor: "#eff6ff", borderRadius: 6,
                 borderWidth: 1, borderColor: "#bfdbfe" },
  chipPurple:  { backgroundColor: "#faf5ff", borderColor: "#ddd6fe" },
  chipTeal:    { backgroundColor: "#f0f9ff", borderColor: "#bae6fd" },
  chipTxt:     { fontSize: 10, fontWeight: "600", color: "#1e40af" },

  roll:        { fontSize: 11, color: "#94a3b8", marginTop: 5 },

  // Empty state
  empty:       { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt:    { fontSize: 14, color: "#94a3b8" },
});
