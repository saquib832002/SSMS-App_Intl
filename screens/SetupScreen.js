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
import { ROUTE_MODULES, ROUTE_KIND } from "../constants/RouteModules";
import { _t, _tx } from "../services/i18n";

// ── Menu structure ────────────────────────────────────────────────────────────
const SECTIONS = [
  {
    id:          "school",
    get label() { return _t("School Setup"); },
    get description() { return _t("Branches, sessions, classes and users"); },
    icon:        "settings",
    accent:      "#1d4ed8",
    tint:        "#dbeafe",
    items: [
      { get label() { return _t("School Settings"); },    screen: "SchoolSettings",    icon: "sliders",    get desc() { return _t("Working days, session & timings"); }    },
      { get label() { return _t("Region & Formats"); },   screen: "RegionFormats",     icon: "globe",      get desc() { return _t("Currency, dates, time zone, tax name"); } },
      { get label() { return _t("Notifications"); },      screen: "NotificationSettings", icon: "bell",    get desc() { return _t("Absence, homework, notices, fees, results – phone & e-mail"); } },
      { get label() { return _t("ID Card Layout"); },     screen: "IdCardSettings",    icon: "credit-card", get desc() { return _t("Choose fields shown on student ID cards"); } },
      { get label() { return _t("Institute Details"); },  screen: "InstituteDetails",  icon: "home",       get desc() { return _t("Institute profile & logo"); }           },
      { get label() { return _t("Branches"); },           screen: "BranchSetup",       icon: "git-branch", get desc() { return _t("Manage school branches"); }             },
      { get label() { return _t("Sessions"); },           screen: "SessionSetup",      icon: "calendar",   get desc() { return _t("Academic year sessions"); }             },
      { get label() { return _t("Classes"); },            screen: "ClassSetup",        icon: "book-open",  get desc() { return _t("Grade & class management"); }           },
      { get label() { return _t("Sections"); },           screen: "SectionSetup",      icon: "layers",     get desc() { return _t("Section & staff assignment"); }         },
      { get label() { return _t("Student Fields"); },     screen: "StudentFields",     icon: "list",       get desc() { return _t("Extra fields your school keeps per student"); } },
      { get label() { return _t("Users"); },              screen: "UserSetup",         icon: "users",      get desc() { return _t("Roles & access control"); }             },
      { get label() { return _t("Staff Categories"); },   screen: "StaffCategory",     icon: "tag",        get desc() { return _t("Manage staff categories"); }            },
      { get label() { return _t("Subjects"); },           screen: "SubjectSetup",      icon: "book",       get desc() { return _t("School-wide subject catalogue"); }      },
      { get label() { return _t("Class Subjects"); },     screen: "ClassSubject",      icon: "copy",       get desc() { return _t("Assign subjects to classes"); }         },
      // { label: "Max Marks",          screen: "SubjectMaxMarks",   icon: "edit-3",     desc: "Define max marks per subject"       },
      { get label() { return _t("Periods"); },            screen: "PeriodSetup",       icon: "clock",      get desc() { return _t("Define school periods & breaks"); }     },
      { get label() { return _t("Timetable"); },          screen: "Timetable",         icon: "grid",       get desc() { return _t("Manage class timetable"); }             },
      { get label() { return _t("Teacher Schedule"); },   screen: "TeacherTimetable",  icon: "user",       get desc() { return _t("Teacher's weekly schedule"); }          },
      { get label() { return _t("Master Timetable"); },   screen: "MasterTimetable",   icon: "align-left", get desc() { return _t("School-wide schedule overview"); }      },
    ],
  },
  {
    id:          "hostel",
    get label() { return _t("Hostel"); },
    get description() { return _t("Buildings, rooms, seats and enrollments"); },
    icon:        "home",
    accent:      "#065f46",
    tint:        "#d1fae5",
    items: [
      { get label() { return _t("Buildings"); }, screen: "HostelBuildings", icon: "grid", get desc() { return _t("Buildings → Rooms → Seats"); } },
    ],
  },
  {
    id:          "fees",
    get label() { return _t("Fee Management"); },
    get description() { return _t("Structure, collection and reporting"); },
    icon:        "dollar-sign",
    accent:      "#92400e",
    tint:        "#fef3c7",
    financeOnly: true,
    items: [
      { get label() { return _t("Fee Items"); },       screen: "FeeItem",                icon: "tag",          get desc() { return _t("Define fee categories"); }   },
      { get label() { return _t("Class Fees"); },      screen: "ClassFeeStructure",      icon: "list",         get desc() { return _t("Fee structure by class"); }  },
      { get label() { return _t("Hostel Fees"); },     screen: "HostelFeeStructure",     icon: "home",         get desc() { return _t("Hostel fee structure"); }    },
      { get label() { return _t("Transport Fees"); },  screen: "TransportFeeStructure",  icon: "truck",        get desc() { return _t("Transport fee structure"); } },
      { get label() { return _t("Demand Slip"); },     screen: "FeeDemandSlip",          icon: "file-text",    get desc() { return _t("Generate demand slips"); }   },
      { get label() { return _t("Approvals"); },       screen: "FeeCollectionApproval",  icon: "check-circle", get desc() { return _t("Approve collections"); }     },
      { get label() { return _t("Online Payments"); }, screen: "OnlinePayments",         icon: "credit-card",  get desc() { return _t("Parents pay fees online"); } },
    ],
  },
  {
    id:          "exams",
    get label() { return _t("Examinations"); },
    get description() { return _t("Question bank and question paper generation"); },
    icon:        "file-text",
    accent:      "#7c3aed",
    tint:        "#ede9fe",
    items: [
      { get label() { return _t("Question Bank"); },    screen: "QuestionBank",    icon: "database",  get desc() { return _t("Add & manage reusable questions"); }        },
      { get label() { return _t("Chapters"); },         screen: "ChapterManage",   icon: "book",      get desc() { return _t("Manage chapters for chapter-wise tests"); } },
      { get label() { return _t("Question Papers"); },  screen: "PaperList",       icon: "file-text", get desc() { return _t("Build, preview & export papers"); }          },
      { get label() { return _t("Test Series"); },      screen: "TestSeriesManage", icon: "layers",    get desc() { return _t("Create & manage online test series"); }      },
    ],
  },
  {
    id:          "guides",
    get label() { return _t("References & Guides"); },
    get description() { return _t("Role permissions and system documentation"); },
    icon:        "book-open",
    accent:      "#475569",
    tint:        "#f1f5f9",
    items: [
      { get label() { return _t("Role Guide"); }, screen: "RoleGuide", icon: "shield", get desc() { return _t("What each role can access"); } },
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
        <Text style={sc.sectionLabel}>{_tx(section.label)}</Text>
        <Text style={sc.sectionDesc}>{_tx(section.description)}</Text>
      </View>
      <View style={sc.sectionCountBadge}>
        <Text style={sc.sectionCountTxt}>{_tx(section.items.length)}</Text>
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
        {_tx(item.label)}
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
  const { user, can } = useContext(AuthContext);
  const role = (user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim();
  const isAccountant        = role === 'accountant';
  const isAccountantOrOwner = role === 'accountant' || role === 'owner';

  // Roles & permissions: hide items the person's role can't open
  const allowed = (screen) => { const m = ROUTE_MODULES[screen]; return !m || !can || can(m, ROUTE_KIND[screen] ?? "view"); };
  const visibleSections = SECTIONS.filter(s => {
    if (isAccountant) return s.financeOnly === true;
    return !s.financeOnly || isAccountantOrOwner;
  }).map(s => ({ ...s, items: s.items.filter(i => allowed(i.screen)) })).filter(s => s.items.length > 0);

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
