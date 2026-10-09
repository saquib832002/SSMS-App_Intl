// screens/SetupScreen.js
import React, { useContext } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { useFeatureLock, LockBadge } from "../components/FeatureLock";

// ── Menu structure ────────────────────────────────────────────────────────────
const SECTIONS = [
  {
    id:          "school",
    label:       "School Setup",
    description: "Branches, sessions, classes and users",
    icon:        "settings",
    accent:      "#1d4ed8",
    tint:        "#dbeafe",
    items: [
      { label: "School Settings",    screen: "SchoolSettings",    icon: "sliders",    desc: "Working days, session & timings"    },
      { label: "ID Card Layout",     screen: "IdCardSettings",    icon: "credit-card", desc: "Choose fields shown on student ID cards" },
      { label: "Institute Details",  screen: "InstituteDetails",  icon: "home",       desc: "Institute profile & logo"           },
      { label: "Branches",           screen: "BranchSetup",       icon: "git-branch", desc: "Manage school branches"             },
      { label: "Sessions",           screen: "SessionSetup",      icon: "calendar",   desc: "Academic year sessions"             },
      { label: "Classes",            screen: "ClassSetup",        icon: "book-open",  desc: "Grade & class management"           },
      { label: "Sections",           screen: "SectionSetup",      icon: "layers",     desc: "Section & staff assignment"         },
      { label: "Users",              screen: "UserSetup",         icon: "users",      desc: "Roles & access control"             },
      { label: "Staff Categories",   screen: "StaffCategory",     icon: "tag",        desc: "Manage staff categories"            },
      { label: "Subjects",           screen: "SubjectSetup",      icon: "book",       desc: "School-wide subject catalogue"      },
      { label: "Class Subjects",     screen: "ClassSubject",      icon: "copy",       desc: "Assign subjects to classes"         },
      // { label: "Max Marks",          screen: "SubjectMaxMarks",   icon: "edit-3",     desc: "Define max marks per subject"       },
      { label: "Periods",            screen: "PeriodSetup",       icon: "clock",      desc: "Define school periods & breaks"     },
      { label: "Timetable",          screen: "Timetable",         icon: "grid",       desc: "Manage class timetable"             },
      { label: "Teacher Schedule",   screen: "TeacherTimetable",  icon: "user",       desc: "Teacher's weekly schedule"          },
      { label: "Master Timetable",   screen: "MasterTimetable",   icon: "align-left", desc: "School-wide schedule overview"      },
    ],
  },
  {
    id:          "hostel",
    label:       "Hostel",
    description: "Buildings, rooms, seats and enrollments",
    icon:        "home",
    accent:      "#065f46",
    tint:        "#d1fae5",
    items: [
      { label: "Buildings", screen: "HostelBuildings", icon: "grid", desc: "Buildings → Rooms → Seats" },
    ],
  },
  {
    id:          "fees",
    label:       "Fee Management",
    description: "Structure, collection and reporting",
    icon:        "dollar-sign",
    accent:      "#92400e",
    tint:        "#fef3c7",
    financeOnly: true,
    items: [
      { label: "Fee Items",       screen: "FeeItem",                icon: "tag",          desc: "Define fee categories"   },
      { label: "Class Fees",      screen: "ClassFeeStructure",      icon: "list",         desc: "Fee structure by class"  },
      { label: "Hostel Fees",     screen: "HostelFeeStructure",     icon: "home",         desc: "Hostel fee structure"    },
      { label: "Transport Fees",  screen: "TransportFeeStructure",  icon: "truck",        desc: "Transport fee structure" },
      { label: "Demand Slip",     screen: "FeeDemandSlip",          icon: "file-text",    desc: "Generate demand slips"   },
      { label: "Approvals",       screen: "FeeCollectionApproval",  icon: "check-circle", desc: "Approve collections"     },
    ],
  },
  {
    id:          "exams",
    label:       "Examinations",
    description: "Question bank and question paper generation",
    icon:        "file-text",
    accent:      "#7c3aed",
    tint:        "#ede9fe",
    items: [
      { label: "Question Bank",    screen: "QuestionBank",    icon: "database",  desc: "Add & manage reusable questions"        },
      { label: "Chapters",         screen: "ChapterManage",   icon: "book",      desc: "Manage chapters for chapter-wise tests" },
      { label: "Question Papers",  screen: "PaperList",       icon: "file-text", desc: "Build, preview & export papers"          },
      { label: "Test Series",      screen: "TestSeriesManage", icon: "layers",    desc: "Create & manage online test series"      },
    ],
  },
  {
    id:          "guides",
    label:       "References & Guides",
    description: "Role permissions and system documentation",
    icon:        "book-open",
    accent:      "#475569",
    tint:        "#f1f5f9",
    items: [
      { label: "Role Guide", screen: "RoleGuide", icon: "shield", desc: "What each role can access" },
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
export default function SetUpScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const role = (user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim();
  const isAccountant        = role === 'accountant';
  const isAccountantOrOwner = role === 'accountant' || role === 'owner';

  const visibleSections = SECTIONS.filter(s => {
    if (isAccountant) return s.financeOnly === true;
    return !s.financeOnly || isAccountantOrOwner;
  });

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
