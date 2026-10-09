// screens/Hostel/HostelScreen.js
import React, { useContext, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { useFeatureLock, LockBadge } from "../../components/FeatureLock";

// ── Menu structure ────────────────────────────────────────────────────────────
// adminOnly    → visible to admin + owner only
// financeOnly  → visible to accountant + owner only
const SECTIONS = [
  {
    id:          "hostel",
    label:       "Hostel",
    description: "Enrollment, buildings, rooms and seats",
    icon:        "home",
    accent:      "#065f46",
    tint:        "#d1fae5",
    adminOnly:   true,
    items: [
      { label: "Enrolled",   screen: "HostelEnrolledStudents", icon: "users",    desc: "View enrolled students"    },
      { label: "Buildings",  screen: "HostelBuildings",        icon: "grid",     desc: "Buildings → Rooms → Seats" },
    ],
  },
  {
    id:          "finance",
    label:       "Hostel Finance",
    description: "Fee structure and collection approvals",
    icon:        "dollar-sign",
    accent:      "#92400e",
    tint:        "#fef3c7",
    financeOnly: true,
    items: [
      { label: "Fee Structure", screen: "HostelFeeStructure",    icon: "list",         desc: "Set hostel fee amounts"  },
      { label: "Approvals",     screen: "FeeCollectionApproval", icon: "check-circle", desc: "Approve fee collections" },
    ],
  },
];

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ section }) {
  return (
    <View style={[sc.sectionHead, { backgroundColor: section.accent }]}>
      <View style={sc.sectionIconWrap}>
        <Feather name={section.icon} size={18} color={section.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={sc.sectionLabel}>{section.label}</Text>
        <Text style={sc.sectionDesc}>{section.description}</Text>
      </View>
      <View style={sc.sectionCountBadge}>
        <Text style={sc.sectionCountTxt}>{section.items.length}</Text>
      </View>
    </View>
  );
}

// ── Item Tile ─────────────────────────────────────────────────────────────────
function ItemTile({ item, section, navigation }) {
  const { isLocked, guard } = useFeatureLock();
  const locked = isLocked(item.screen);
  return (
    <TouchableOpacity
      style={sc.tile}
      onPress={guard(item.screen, () => navigation.navigate(item.screen))}
      activeOpacity={0.75}
    >
      <View style={[sc.tileIcon, { backgroundColor: section.tint }]}>
        <Feather name={item.icon} size={22} color={locked ? "#94a3b8" : section.accent} />
        {locked && <LockBadge />}
      </View>
      <Text style={[sc.tileLabel, locked && { color: "#94a3b8" }]} numberOfLines={2}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({ section, navigation }) {
  return (
    <View style={sc.section}>
      <SectionHeader section={section} />
      <View style={sc.tileGrid}>
        {section.items.map((item) => (
          <ItemTile
            key={item.screen}
            item={item}
            section={section}
            navigation={navigation}
          />
        ))}
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function HostelScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const role = (user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim();
  const isAdminOrOwner      = useMemo(() => ['admin', 'owner'].includes(role),      [role]);
  const isAccountantOrOwner = useMemo(() => ['accountant', 'owner'].includes(role), [role]);

  const visibleSections = useMemo(() =>
    SECTIONS.filter(s => {
      if (s.adminOnly)   return isAdminOrOwner;
      if (s.financeOnly) return isAccountantOrOwner;
      return true;
    }),
  [isAdminOrOwner, isAccountantOrOwner]);

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f1f5f9" />
      <ScrollView
        contentContainerStyle={sc.scroll}
        showsVerticalScrollIndicator={false}
      >
        {visibleSections.map(section => (
          <Section key={section.id} section={section} navigation={navigation} />
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#f1f5f9" },
  scroll: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16 },

  // Section card
  section: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

  // Section header (colored band)
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  sectionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: { fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  sectionDesc:  { fontSize: 11, color: "rgba(255,255,255,0.80)", marginTop: 1 },
  sectionCountBadge: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 26,
    alignItems: "center",
  },
  sectionCountTxt: { fontSize: 12, fontWeight: "700", color: "#fff" },

  // 3-column tile grid
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 10,
    gap: 8,
  },
  tile: {
    width: "30.5%",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
    color: "#1e293b",
  },
});
