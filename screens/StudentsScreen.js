// screens/StudentsScreen.js
import React, { useContext, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { useFeatureLock, LockBadge } from "../components/FeatureLock";

// ── Student / Parent portal menu ─────────────────────────────────────────────
const buildStudentSections = (enrollmentId) => [
  {
    id:          "academics",
    label:       "My Academics",
    description: "Attendance and exam results",
    icon:        "book-open",
    accent:      "#1d4ed8",
    tint:        "#dbeafe",
    items: [
      { label: "My Attendance",  icon: "check-square", desc: "View your last 30 days attendance", screen: "MyAttendance", params: {} },
      { label: "My Marksheet",   icon: "file-text",    desc: "View exam results & marksheet",    screen: "MyMarksheet",  params: {} },
      { label: "My Date Sheet",  icon: "calendar",     desc: "View exam schedule & countdown",   screen: "MyDatesheet",  params: {} },
      { label: "My Homework",    icon: "book",          desc: "View daily homework & remarks",    screen: "MyHomework",   params: {} },
    ],
  },
  {
    id:          "myfinance",
    label:       "My Finance",
    description: "Fee dues and payment history",
    icon:        "dollar-sign",
    accent:      "#b45309",
    tint:        "#fef3c7",
    items: [
      { label: "Fee Due & History", icon: "dollar-sign", desc: "View outstanding fees & past payments", screen: "MyFee", params: {} },
    ],
  },
];

// ── Admin / Staff full menu ───────────────────────────────────────────────────
const SECTIONS = [
  {
    id:               "students",
    label:            "Students",
    description:      "Registration, enrollment and identity",
    icon:             "users",
    accent:           "#1d4ed8",
    tint:             "#dbeafe",
    accountantVisible: true,
    items: [
      { label: "New Registration",    screen: "Registration",        icon: "user-plus",    desc: "Register a new student"                },
      { label: "Enrollment",          screen: "StudentDirectory",    icon: "user",          desc: "View registered students",   hideForUser: true },
      { label: "Enrolled Students",   screen: "EnrolledStudents",    icon: "check-circle",  desc: "Manage enrolled students",   hideForUser: true, accountantVisible: true },
      { label: "Attendance",          screen: "Attendance",          icon: "check-square",  desc: "Mark & view attendance"                },
      { label: "Attend. Report",      screen: "AttendanceReport",    icon: "bar-chart-2",   desc: "View attendance reports"               },
      { label: "Homework",            screen: "Homework",            icon: "book",          desc: "Assign & track homework"               },
      { label: "ID Cards",            screen: "StudentIdCard",       icon: "credit-card",   desc: "Generate student ID cards", hideForUser: true },
      { label: "ID Cards v2",         screen: "StudentIdCardV2",     icon: "layers",        desc: "10 designer templates",     hideForUser: true },
      { label: "Portal Accounts",     screen: "StudentUserAccounts", icon: "shield",        desc: "Student & parent logins",  adminOnly: true },
      { label: "Roll Numbers",        screen: "UpdateRollNumber",    icon: "hash",          desc: "Assign & update roll numbers", adminOnly: true },
      { label: "Certificates",        screen: "Certificates",        icon: "file-text",     desc: "TC, Bonafide, Character, Conduct", hideForUser: true },
    ],
  },
  {
    id:        "teachers",
    label:     "Teachers",
    description: "Staff management, profiles and leave",
    icon:      "briefcase",
    accent:    "#065f46",
    tint:      "#d1fae5",
    staffOnly: true,
    items: [
      { label: "Apply / Track Leave", screen: "StaffLeave",        icon: "calendar",     desc: "Apply for leave & view balance"                       },
      { label: "Leave Approval",      screen: "LeaveApproval",     icon: "check-circle", desc: "Approve / reject staff leave requests", principalOk: true },
      { label: "Staff Registration",  screen: "StaffRegistration", icon: "user-plus",    desc: "Register a new teacher",            adminOnly: true },
      { label: "Hiring Review",       screen: "HiringPending",     icon: "user-check",   desc: "Review & approve applications",     adminOnly: true },
      { label: "Staff List",          screen: "HiredStaff",        icon: "list",         desc: "Manage enrolled teachers",          adminOnly: true },
      { label: "Subject Teachers",    screen: "SubjectTeacher",    icon: "layers",       desc: "Assign teachers to subjects",       adminOnly: true },
      { label: "Leave Types",         screen: "LeaveTypes",        icon: "tag",          desc: "Configure leave categories",        adminOnly: true },
    ],
  },
  {
    id:          "exams",
    label:       "Examinations",
    description: "Assessments, marks and results",
    icon:        "edit-3",
    accent:      "#5b21b6",
    tint:        "#ede9fe",
    items: [
      { label: "Create Exam",     screen: "Exam",               icon: "plus-circle", desc: "Create Annual/Major/Minor exam"  },
      { label: "Date Sheet",      screen: "ExamDatesheet",      icon: "calendar",    desc: "Schedule exam dates per class"   },
      { label: "Exam Setup",      screen: "QuickTestSetup",     icon: "settings",    desc: "Set subjects and max marks"      },
      { label: "Enter Marks",     screen: "AddMarks",           icon: "edit-2",      desc: "Record student marks"            },
      { label: "Marksheet",       screen: "GenerateMarksheet",  icon: "file-text",   desc: "Generate marksheets"             },
      { label: "Exam Ranks",      screen: "ExamResultsRank",    icon: "award",       desc: "Exam analytics & rankings"       },
      { label: "Subject Marks",   screen: "StudentMarks",       icon: "book-open",   desc: "Subject-wise marks"              },
    ],
  },
  {
    id:          "finance",
    label:       "Finance",
    description: "Fees, receipts and collections",
    icon:        "dollar-sign",
    accent:      "#92400e",
    tint:        "#fef3c7",
    financeOnly: true,
    items: [
      { label: "Fee Discounts", screen: "StudentDiscount",       icon: "percent",      desc: "EWS/scholarship discounts"     },
      { label: "Demand Slip",   screen: "FeeDemandSlip",         icon: "file-minus",   desc: "Generate demand slips"         },
      { label: "Approvals",     screen: "FeeCollectionApproval", icon: "check-circle", desc: "Approve fee collections"       },
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
      onPress={guard(item.screen, () => navigation.navigate(item.screen, item.params ?? {}))}
      activeOpacity={0.75}
    >
      <View style={[sc.tileIcon, { backgroundColor: section.tint }]}>
        <Feather name={item.icon} size={22} color={locked ? "#94a3b8" : section.accent} />
        {locked && <LockBadge />}
      </View>
      <Text style={[[sc.tileLabel, { color: "#1e293b" }], locked && { color: "#94a3b8" }]} numberOfLines={2}>
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
export default function StudentsScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const role = (user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim();
  const isStudentOrParent   = role === 'student'    || role === 'parent';
  const isAdminOrOwner      = role === 'admin'      || role === 'owner';
  const isPrincipal         = role === 'principal';
  const isAdminOwnerOrPrincipal = isAdminOrOwner || isPrincipal;
  const isAccountant        = role === 'accountant';
  const isAccountantOrOwner = role === 'accountant' || role === 'owner';
  const isUser              = role === 'user';

  const visibleSections = useMemo(() => {
    if (isStudentOrParent) {
      return buildStudentSections(user?.ssmsUserName ?? '');
    }
    return SECTIONS
      .filter(s => {
        if (isAccountant) return s.financeOnly === true || s.accountantVisible === true;
        if (s.staffOnly) return !isStudentOrParent; // visible to all school staff (student/parent already early-returned)
        return (!s.adminOnly   || isAdminOrOwner) &&
               (!s.financeOnly || isAccountantOrOwner);
      })
      .map(s => ({
        ...s,
        items: s.items.filter(item => {
          if (isAccountant) {
            return s.financeOnly ? true : item.accountantVisible === true;
          }
          // principalOk items show for admin, owner AND principal; hide from plain staff/teacher
          if (item.principalOk) return isAdminOwnerOrPrincipal;
          return (!item.hideForUser || !isUser) &&
                 (!item.adminOnly   || isAdminOrOwner) &&
                 (!item.financeOnly || isAccountantOrOwner);
        }),
      }))
      .filter(s => s.items.length > 0);
  }, [isStudentOrParent, isAdminOrOwner, isAdminOwnerOrPrincipal, isAccountant, isAccountantOrOwner, isUser, user]);

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f1f5f9" />

      {/* Portal banner for Student / Parent */}
      {isStudentOrParent && (
        <View style={sc.portalBanner}>
          <Feather name="user" size={13} color="#1d4ed8" />
          <Text style={sc.portalBannerText}>
            {role === 'parent' ? 'Parent Portal' : 'Student Portal'}
            {user?.ssmsUserName ? `  ·  ID: ${user.ssmsUserName}` : ''}
          </Text>
        </View>
      )}

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

  // Portal banner
  portalBanner: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#bfdbfe",
    paddingHorizontal: 14, paddingVertical: 8,
  },
  portalBannerText: { fontSize: 12, fontWeight: "700", color: "#1d4ed8" },

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
