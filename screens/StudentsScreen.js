// screens/StudentsScreen.js
import React, { useContext, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { ROUTE_MODULES, ROUTE_KIND } from "../constants/RouteModules";
import { useFeatureLock, LockBadge } from "../components/FeatureLock";
import { _t, _tx } from "../services/i18n";

// ── Student / Parent portal menu ─────────────────────────────────────────────
const buildStudentSections = (enrollmentId) => [
  {
    id:          "academics",
    label:       _t("My Academics"),
    description: _t("Attendance and exam results"),
    icon:        "book-open",
    accent:      "#1d4ed8",
    tint:        "#dbeafe",
    items: [
      { label: _t("My Attendance"),  icon: "check-square", desc: _t("View your last 30 days attendance"), screen: "MyAttendance", params: {} },
      { label: _t("Absence & Leave"), icon: "calendar",    desc: _t("Absence notes, leave, late / early pickup"), screen: "MyAbsences", params: {} },
      { label: _t("My Marksheet"),   icon: "file-text",    desc: _t("View exam results & marksheet"),    screen: "MyMarksheet",  params: {} },
      { label: _t("Report Cards"),   icon: "award",        desc: _t("Term & annual report cards"),       screen: "MyReportCards", params: {} },
      { label: _t("My Date Sheet"),  icon: "calendar",     desc: _t("View exam schedule & countdown"),   screen: "MyDatesheet",  params: {} },
      { label: _t("Admit Card"),     icon: "credit-card",  desc: _t("Hall ticket with your exam seats"),  screen: "MyAdmitCard",  params: {} },
      { label: _t("My Homework"),    icon: "book",          desc: _t("View daily homework & remarks"),    screen: "MyHomework",   params: {} },
      { label: _t("Teacher Meetings"), icon: "users",        desc: _t("Book a parent–teacher meeting"), screen: "MyMeetings", params: {} },
      { label: _t("Family & Health"), icon: "heart",        desc: _t("Guardians, emergency contacts, medical, documents"), screen: "StudentRecord", params: {} },
      { label: _t("Bus Tracking"),   icon: "truck",        desc: _t("Where the school bus is now, bus alerts"), screen: "LiveBus", params: {} },
      { label: _t("Pick-up Persons"), icon: "user-check",   desc: _t("Who may collect my child, one-off pick-up codes"), screen: "MyPickup", params: {}, parentOnly: true },
    ],
  },
  {
    id:          "myfinance",
    label:       _t("My Finance"),
    description: _t("Fee dues and payment history"),
    icon:        "dollar-sign",
    accent:      "#b45309",
    tint:        "#fef3c7",
    items: [
      { label: _t("Fee Due & History"), icon: "dollar-sign", desc: _t("View outstanding fees & past payments"), screen: "MyFee", params: {} },
    ],
  },
];

// ── Admin / Staff full menu ───────────────────────────────────────────────────
const SECTIONS = [
  {
    id:               "reports",
    get label() { return _t("Reports"); },
    get description() { return _t("Attendance trends, students at risk, fees and results"); },
    icon:             "trending-up",
    accent:           "#0f766e",
    tint:             "#ccfbf1",
    accountantVisible: true,
    items: [
      { get label() { return _t("School Analytics"); }, screen: "Analytics", icon: "pie-chart", get desc() { return _t("Attendance, at-risk students, fees vs target, classes"); }, accountantVisible: true },
    ],
  },
  {
    id:               "students",
    get label() { return _t("Students"); },
    get description() { return _t("Registration, enrollment and identity"); },
    icon:             "users",
    accent:           "#1d4ed8",
    tint:             "#dbeafe",
    accountantVisible: true,
    items: [
      { get label() { return _t("New Registration"); },    screen: "Registration",        icon: "user-plus",    get desc() { return _t("Register a new student"); }                },
      { get label() { return _t("Enrollment"); },          screen: "StudentDirectory",    icon: "user",          get desc() { return _t("View registered students"); },   hideForUser: true },
      { get label() { return _t("Enrolled Students"); },   screen: "EnrolledStudents",    icon: "check-circle",  get desc() { return _t("Manage enrolled students"); },   hideForUser: true, accountantVisible: true },
      { get label() { return _t("Attendance"); },          screen: "Attendance",          icon: "check-square",  get desc() { return _t("Mark & view attendance"); }                },
      { get label() { return _t("Attend. Report"); },      screen: "AttendanceReport",    icon: "bar-chart-2",   get desc() { return _t("View attendance reports"); }               },
      { get label() { return _t("Student Leave"); },       screen: "StudentLeave",        icon: "calendar",      get desc() { return _t("Absence notes & leave requests"); }        },
      { get label() { return _t("Late & Early"); },        screen: "ArrivalLog",          icon: "clock",         get desc() { return _t("Late arrivals & early pickups"); }         },
      { get label() { return _t("Homework"); },            screen: "Homework",            icon: "book",          get desc() { return _t("Assign & track homework"); }               },
      { get label() { return _t("ID Cards"); },            screen: "StudentIdCard",       icon: "credit-card",   get desc() { return _t("Generate student ID cards"); }, hideForUser: true },
      { get label() { return _t("ID Cards v2"); },         screen: "StudentIdCardV2",     icon: "layers",        get desc() { return _t("10 designer templates"); },     hideForUser: true },
      { get label() { return _t("Portal Accounts"); },     screen: "StudentUserAccounts", icon: "shield",        get desc() { return _t("Student & parent logins"); },  adminOnly: true },
      { get label() { return _t("Roll Numbers"); },        screen: "UpdateRollNumber",    icon: "hash",          get desc() { return _t("Assign & update roll numbers"); }, adminOnly: true },
      { get label() { return _t("Health Alerts"); },       screen: "HealthAlerts",        icon: "heart",         get desc() { return _t("Allergies & medical needs by class"); }    },
      { get label() { return _t("Expiring Documents"); },  screen: "DocumentExpiry",      icon: "alert-circle",  get desc() { return _t("Passports & visas about to expire"); }, hideForUser: true },
      { get label() { return _t("Certificates"); },        screen: "Certificates",        icon: "file-text",     get desc() { return _t("TC, Bonafide, Character, Conduct"); }, hideForUser: true },
    ],
  },
  {
    id:        "teachers",
    get label() { return _t("Teachers"); },
    get description() { return _t("Staff management, profiles and leave"); },
    icon:      "briefcase",
    accent:    "#065f46",
    tint:      "#d1fae5",
    staffOnly: true,
    items: [
      { get label() { return _t("My Check-in"); },         screen: "MyCheckIn",         icon: "log-in",       get desc() { return _t("Check in / out & my month"); }                            },
      { get label() { return _t("Staff Attendance"); },    screen: "StaffAttendance",   icon: "user-check",   get desc() { return _t("Daily staff attendance, office code"); }, principalOk: true },
      { get label() { return _t("Staff Att. Report"); },   screen: "StaffAttendanceReport", icon: "bar-chart-2", get desc() { return _t("Monthly report & payable days"); }, principalOk: true },
      { get label() { return _t("Parent Meetings"); },     screen: "Meetings",          icon: "users",        get desc() { return _t("Publish meeting slots & see bookings"); }                },
      { get label() { return _t("My Exam Duties"); },      screen: "MyExamDuties",      icon: "clipboard",    get desc() { return _t("Where and when I invigilate"); }                          },
      { get label() { return _t("Cover & Substitution"); }, screen: "Cover",            icon: "repeat",       get desc() { return _t("Who is away today and who covers their classes"); }      },
      { get label() { return _t("My Cover Periods"); },    screen: "MyCovers",          icon: "user-check",   get desc() { return _t("Classes I cover for colleagues"); }                       },
      { get label() { return _t("My Bus Trip"); },         screen: "DriverTrip",        icon: "truck",        get desc() { return _t("Drivers: share the bus location, mark students"); }       },
      { get label() { return _t("Apply / Track Leave"); }, screen: "StaffLeave",        icon: "calendar",     get desc() { return _t("Apply for leave & view balance"); }                       },
      { get label() { return _t("Leave Approval"); },      screen: "LeaveApproval",     icon: "check-circle", get desc() { return _t("Approve / reject staff leave requests"); }, principalOk: true },
      { get label() { return _t("Staff Registration"); },  screen: "StaffRegistration", icon: "user-plus",    get desc() { return _t("Register a new teacher"); },            adminOnly: true },
      { get label() { return _t("Hiring Review"); },       screen: "HiringPending",     icon: "user-check",   get desc() { return _t("Review & approve applications"); },     adminOnly: true },
      { get label() { return _t("Staff List"); },          screen: "HiredStaff",        icon: "list",         get desc() { return _t("Manage enrolled teachers"); },          adminOnly: true },
      { get label() { return _t("Subject Teachers"); },    screen: "SubjectTeacher",    icon: "layers",       get desc() { return _t("Assign teachers to subjects"); },       adminOnly: true },
      { get label() { return _t("Leave Types"); },         screen: "LeaveTypes",        icon: "tag",          get desc() { return _t("Configure leave categories"); },        adminOnly: true },
    ],
  },
  {
    id:        "safety",
    get label() { return _t("Safety"); },
    get description() { return _t("Visitor log and safe pick-up at the gate"); },
    icon:      "shield",
    accent:    "#9f1239",
    tint:      "#ffe4e6",
    staffOnly: true,
    items: [
      { get label() { return _t("Visitors"); },        screen: "VisitorDesk",    icon: "user-plus",   get desc() { return _t("Sign visitors in and out, badges, log"); }              },
      { get label() { return _t("Gate Pick-up"); },    screen: "PickupDesk",     icon: "user-check",  get desc() { return _t("Check who may collect a child, hand over"); }          },
      { get label() { return _t("My Visitors"); },     screen: "MyVisitors",     icon: "calendar",    get desc() { return _t("Tell reception who is coming to see me"); }           },
      { get label() { return _t("Safety Rules"); },    screen: "SafetySettings", icon: "sliders",     get desc() { return _t("Visitor rules, watch list, pick-up settings"); }      },
      { get label() { return _t("Live Buses"); },      screen: "BusFleet",       icon: "navigation",  get desc() { return _t("Every school bus on the map, who is on board"); }    },
    ],
  },
  {
    id:          "exams",
    get label() { return _t("Examinations"); },
    get description() { return _t("Assessments, marks and results"); },
    icon:        "edit-3",
    accent:      "#5b21b6",
    tint:        "#ede9fe",
    items: [
      { get label() { return _t("Create Exam"); },     screen: "Exam",               icon: "plus-circle", get desc() { return _t("Create Annual/Major/Minor exam"); }  },
      { get label() { return _t("Date Sheet"); },      screen: "ExamDatesheet",      icon: "calendar",    get desc() { return _t("Schedule exam dates per class"); }   },
      { get label() { return _t("Halls & Seating"); }, screen: "ExamLogistics",      icon: "grid",        get desc() { return _t("Seating plans, invigilators, admit cards"); } },
      { get label() { return _t("Exam Setup"); },      screen: "QuickTestSetup",     icon: "settings",    get desc() { return _t("Set subjects and max marks"); }      },
      { get label() { return _t("Enter Marks"); },     screen: "AddMarks",           icon: "edit-2",      get desc() { return _t("Record student marks"); }            },
      { get label() { return _t("Marksheet"); },       screen: "GenerateMarksheet",  icon: "file-text",   get desc() { return _t("Generate marksheets"); }             },
      { get label() { return _t("Exam Ranks"); },      screen: "ExamResultsRank",    icon: "award",       get desc() { return _t("Exam analytics & rankings"); }       },
      { get label() { return _t("Subject Marks"); },   screen: "StudentMarks",       icon: "book-open",   get desc() { return _t("Subject-wise marks"); }              },
      { get label() { return _t("Report Cards"); },    screen: "ReportCards",        icon: "award",       get desc() { return _t("Generate, print & email report cards"); } },
      { get label() { return _t("Teacher Comments"); },screen: "ReportComments",     icon: "message-square", get desc() { return _t("Comments for report cards"); }     },
      { get label() { return _t("Report Card Setup"); }, screen: "ReportCardSetup",  icon: "layout",      get desc() { return _t("Exams, weighting & template"); }, adminOnly: true },
      { get label() { return _t("Grading Scales"); },  screen: "GradingScales",      icon: "sliders",     get desc() { return _t("Letter, GPA, IB, Cambridge…"); }, adminOnly: true },
    ],
  },
  {
    id:          "finance",
    get label() { return _t("Finance"); },
    get description() { return _t("Fees, receipts and collections"); },
    icon:        "dollar-sign",
    accent:      "#92400e",
    tint:        "#fef3c7",
    financeOnly: true,
    items: [
      { get label() { return _t("Fee Discounts"); }, screen: "StudentDiscount",       icon: "percent",      get desc() { return _t("EWS/scholarship discounts"); }     },
      { get label() { return _t("Demand Slip"); },   screen: "FeeDemandSlip",         icon: "file-minus",   get desc() { return _t("Generate demand slips"); }         },
      { get label() { return _t("Approvals"); },     screen: "FeeCollectionApproval", icon: "check-circle", get desc() { return _t("Approve fee collections"); }       },
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
      onPress={guard(item.screen, () => navigation.navigate(item.screen, item.params ?? {}))}
      activeOpacity={0.75}
    >
      <View style={[sc.tileIcon, { backgroundColor: section.tint }]}>
        <Feather name={item.icon} size={22} color={locked ? "#94a3b8" : section.accent} />
        {locked && <LockBadge />}
      </View>
      <Text style={[[sc.tileLabel, { color: "#1e293b" }], locked && { color: "#94a3b8" }]} numberOfLines={2}>
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
export default function StudentsScreen({ navigation }) {
  const { user, can } = useContext(AuthContext);
  // Roles & permissions: hide screens the person's role can't use (self-service screens always show)
  const allowedByRole = (screen) => {
    if (screen === "MyCheckIn" || screen === "StaffLeave" || screen === "MyExamDuties" || screen === "MyCovers" || screen === "MyVisitors" || screen === "DriverTrip") return true;
    const m = ROUTE_MODULES[screen];
    return !m || can(m, ROUTE_KIND[screen] ?? "view");
  };

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
      return buildStudentSections(user?.ssmsUserName ?? '')
        .map((s) => ({ ...s, items: s.items.filter((it) => !it.parentOnly || role === 'parent') }));
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
          if (!allowedByRole(item.screen)) return false;
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
  }, [isStudentOrParent, isAdminOrOwner, isAdminOwnerOrPrincipal, isAccountant, isAccountantOrOwner, isUser, user, can]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f1f5f9" />

      {/* Portal banner for Student / Parent */}
      {isStudentOrParent && (
        <View style={sc.portalBanner}>
          <Feather name="user" size={13} color="#1d4ed8" />
          <Text style={sc.portalBannerText}>
            {role === 'parent' ? _t("Parent Portal") : _t("Student Portal")}
            {user?.ssmsUserName ? `  ${_t("·  ID: {ssmsUserName}", { ssmsUserName: user.ssmsUserName })}` : ''}
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
