// screens/Guide/RoleGuideScreen.js
// In-app role & access guide — shows every role and what it can do.
// Add to navigation so admins/owners can reference when creating users.

import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

// ── Role definitions ──────────────────────────────────────────────────────────
const ROLES = [
  {
    id:          "owner",
    label:       "Owner",
    icon:        "star",
    accent:      "#5b21b6",
    tint:        "#ede9fe",
    assignedTo:  "School owner / principal — one per institution",
    summary:     "Unrestricted access to every module, setting and report.",
    modules: [
      {
        name: "Dashboard",
        icon: "home",
        items: ["School stats (students, teachers, branches, classes)", "Attendance overview", "Notice board", "WhatsApp community & channel banners", "School gallery"],
      },
      {
        name: "School — Students",
        icon: "users",
        items: ["New registration", "Enrollment management", "Enrolled students list", "Attendance marking & reports", "Homework assign & track", "ID card generation", "Student & parent portal accounts"],
      },
      {
        name: "School — Teachers",
        icon: "briefcase",
        items: ["Staff registration", "Hiring review & approval", "Staff list management", "Subject teacher assignments"],
      },
      {
        name: "School — Examinations",
        icon: "edit-3",
        items: ["Create / edit exams", "Exam setup (subjects & max marks)", "Enter marks", "Generate marksheets", "Exam ranks & analytics", "Subject-wise marks view"],
      },
      {
        name: "School — Finance",
        icon: "dollar-sign",
        items: ["Fee discounts (EWS / scholarship)", "Demand slip generation", "Fee collection approvals"],
      },
      {
        name: "Setup",
        icon: "settings",
        items: ["School settings (working days, timings, session)", "Institute details & logo", "Branches, sessions, classes, sections", "Users & roles", "Staff categories", "Subjects & class subjects", "Max marks configuration", "Periods & timetable", "Teacher schedule & master timetable", "Fee items, class fees, hostel fees, transport fees"],
      },
      {
        name: "Hostel",
        icon: "home",
        items: ["Enrolled students", "Buildings → rooms → seats", "Hostel fee structure", "Fee collection approvals"],
      },
      {
        name: "Transport",
        icon: "truck",
        items: ["Routes, stops & GPS mapping", "Vehicles management", "Drivers management", "Route assignments", "Student transport enrollments", "Fee collection (Pay button)"],
      },
    ],
  },

  {
    id:          "admin",
    label:       "Admin",
    icon:        "shield",
    accent:      "#1d4ed8",
    tint:        "#dbeafe",
    assignedTo:  "Vice principal, registrar or senior office staff",
    summary:     "Full operational access — all student, teacher, exam, hostel and transport functions. Cannot access fee collection or finance reports.",
    modules: [
      {
        name: "Dashboard",
        icon: "home",
        items: ["School stats, attendance overview, notice board, gallery"],
      },
      {
        name: "School — Students",
        icon: "users",
        items: ["New registration", "Enrollment management", "Enrolled students list", "Attendance marking & reports", "Homework", "ID card generation", "Student & parent portal accounts"],
      },
      {
        name: "School — Teachers",
        icon: "briefcase",
        items: ["Staff registration", "Hiring review", "Staff list", "Subject teacher assignments"],
      },
      {
        name: "School — Examinations",
        icon: "edit-3",
        items: ["Create exams, exam setup, enter marks, marksheets, ranks, subject marks"],
      },
      {
        name: "Setup",
        icon: "settings",
        items: ["School settings, institute details, branches, sessions, classes, sections, users, staff categories, subjects, periods, timetable"],
        note: "Cannot access Fee Management in Setup",
      },
      {
        name: "Hostel",
        icon: "home",
        items: ["Enrolled students", "Buildings → rooms → seats"],
        note: "Cannot access Hostel Finance",
      },
      {
        name: "Transport",
        icon: "truck",
        items: ["Full CRUD on routes, stops, vehicles, drivers, assignments", "Student transport enrollments"],
      },
    ],
    restricted: ["Fee Management (Setup)", "School Finance section", "Hostel Finance"],
  },

  {
    id:          "accountant",
    label:       "Accountant",
    icon:        "dollar-sign",
    accent:      "#92400e",
    tint:        "#fef3c7",
    assignedTo:  "Fee clerk, accounts staff or bursar",
    summary:     "Finance-only access. Can view enrolled students and collect fees but cannot manage academic data.",
    modules: [
      {
        name: "School — Students (limited)",
        icon: "users",
        items: ["Enrolled students list (view only — to identify who to collect fees from)"],
      },
      {
        name: "School — Finance",
        icon: "dollar-sign",
        items: ["Fee discounts (EWS / scholarship)", "Demand slip generation", "Fee collection approvals"],
      },
      {
        name: "Setup — Fee Management",
        icon: "settings",
        items: ["Fee items / categories", "Class fee structure", "Hostel fee structure", "Transport fee structure", "Demand slip generation", "Fee collection approvals"],
      },
      {
        name: "Hostel Finance",
        icon: "home",
        items: ["Hostel fee structure", "Fee collection approvals"],
      },
      {
        name: "Transport",
        icon: "truck",
        items: ["View enrolled students with route details", "Collect transport fee (Pay button)"],
      },
    ],
    restricted: ["Student registration & enrollment management", "Attendance, homework, exams", "Teacher management", "Hostel buildings/rooms", "School / Hostel Setup"],
  },

  {
    id:          "user",
    label:       "User (Teacher)",
    icon:        "user",
    accent:      "#065f46",
    tint:        "#d1fae5",
    assignedTo:  "Class teacher or subject teacher",
    summary:     "Academic operations — can register students, mark attendance, assign homework and manage exams. No access to teacher management, finance or admin settings.",
    modules: [
      {
        name: "Dashboard",
        icon: "home",
        items: ["School stats, attendance overview, notice board, gallery"],
      },
      {
        name: "School — Students",
        icon: "users",
        items: ["New student registration", "Attendance marking & reports", "Homework assign & track"],
        note: "Cannot see: Enrollment list, ID Cards, Portal Accounts",
      },
      {
        name: "School — Examinations",
        icon: "edit-3",
        items: ["Create / edit exams", "Exam setup", "Enter marks", "Generate marksheets", "Exam ranks", "Subject-wise marks"],
      },
      {
        name: "Setup",
        icon: "settings",
        items: ["View school settings, classes, subjects, timetable, teacher schedule"],
        note: "No access to user management or fee setup",
      },
      {
        name: "Transport",
        icon: "truck",
        items: ["View student transport enrollments (read-only)"],
      },
    ],
    restricted: ["Teacher section (hiring, staff list)", "Finance sections", "Fee Management", "Hostel management", "ID card generation", "Portal account control"],
  },

  {
    id:          "student",
    label:       "Student",
    icon:        "book-open",
    accent:      "#0891b2",
    tint:        "#cffafe",
    assignedTo:  "Enrolled student — login created via Portal Accounts screen",
    summary:     "Student self-service portal. Can view their own academic and fee records only.",
    modules: [
      {
        name: "Student Portal",
        icon: "user",
        items: [
          "My Attendance — last 30 days attendance record",
          "My Marksheet — exam results and marksheet view",
          "My Homework — daily homework and teacher remarks",
          "Fee Due & History — outstanding fees and past payments",
        ],
      },
      {
        name: "Dashboard",
        icon: "home",
        items: ["School notices", "School gallery & memories", "WhatsApp community & channel links"],
      },
    ],
    restricted: ["All admin, teacher and finance modules"],
  },

  {
    id:          "parent",
    label:       "Parent",
    icon:        "users",
    accent:      "#be185d",
    tint:        "#fce7f3",
    assignedTo:  "Parent or guardian — login linked to their child's enrollment",
    summary:     "Parent portal — same view as the student, but accessed using the parent's own login. If a parent has multiple children, they can switch between them.",
    modules: [
      {
        name: "Parent Portal",
        icon: "user",
        items: [
          "Child's Attendance — last 30 days",
          "Child's Marksheet — exam results",
          "Child's Homework — daily tasks and remarks",
          "Child's Fee Due & History — outstanding and paid fees",
          "Switch child — if linked to more than one enrolled student",
        ],
      },
      {
        name: "Dashboard",
        icon: "home",
        items: ["School notices", "School gallery", "WhatsApp community & channel links"],
      },
    ],
    restricted: ["All admin, teacher and finance modules"],
  },
];

// ── Role card ─────────────────────────────────────────────────────────────────
function RoleCard({ role }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={gc.card}>
      {/* Header band */}
      <TouchableOpacity
        style={[gc.cardHead, { backgroundColor: role.accent }]}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.85}
      >
        <View style={gc.headIconWrap}>
          <Feather name={role.icon} size={20} color={role.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={gc.headLabel}>{role.label}</Text>
          <Text style={gc.headAssigned}>{role.assignedTo}</Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color="rgba(255,255,255,0.80)"
        />
      </TouchableOpacity>

      {/* Summary — always visible */}
      <View style={gc.summaryRow}>
        <Feather name="info" size={13} color={role.accent} style={{ marginTop: 1 }} />
        <Text style={[gc.summaryTxt, { color: role.accent }]}>{role.summary}</Text>
      </View>

      {/* Expanded detail */}
      {expanded && (
        <View style={gc.detail}>
          {/* Accessible modules */}
          {role.modules.map((mod, mi) => (
            <View key={mi} style={gc.modBlock}>
              <View style={gc.modHeader}>
                <View style={[gc.modIconWrap, { backgroundColor: role.tint }]}>
                  <Feather name={mod.icon} size={12} color={role.accent} />
                </View>
                <Text style={[gc.modName, { color: role.accent }]}>{mod.name}</Text>
              </View>
              {mod.items.map((item, ii) => (
                <View key={ii} style={gc.modItem}>
                  <View style={[gc.dot, { backgroundColor: role.accent }]} />
                  <Text style={gc.modItemTxt}>{item}</Text>
                </View>
              ))}
              {mod.note && (
                <View style={gc.noteRow}>
                  <Feather name="alert-circle" size={11} color="#f59e0b" />
                  <Text style={gc.noteTxt}>{mod.note}</Text>
                </View>
              )}
            </View>
          ))}

          {/* Restrictions */}
          {role.restricted?.length > 0 && (
            <View style={gc.restrictBlock}>
              <View style={gc.restrictHeader}>
                <Feather name="slash" size={12} color="#dc2626" />
                <Text style={gc.restrictTitle}>No access to</Text>
              </View>
              {role.restricted.map((r, ri) => (
                <View key={ri} style={gc.modItem}>
                  <View style={[gc.dot, { backgroundColor: "#dc2626" }]} />
                  <Text style={[gc.modItemTxt, { color: "#dc2626" }]}>{r}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Expand hint */}
      <TouchableOpacity
        style={[gc.expandBtn, { borderTopColor: role.tint }]}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={[gc.expandTxt, { color: role.accent }]}>
          {expanded ? "Show less" : `View ${role.modules.length} modules & permissions`}
        </Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={13} color={role.accent} />
      </TouchableOpacity>
    </View>
  );
}

// ── Quick reference table ─────────────────────────────────────────────────────
const QUICK_REF = [
  { module: "School Setup",        owner: true,  admin: true,  accountant: false, user: true,  student: false, parent: false },
  { module: "Fee Setup",           owner: true,  admin: false, accountant: true,  user: false, student: false, parent: false },
  { module: "Student Registration",owner: true,  admin: true,  accountant: false, user: true,  student: false, parent: false },
  { module: "Attendance",          owner: true,  admin: true,  accountant: false, user: true,  student: "view", parent: "view" },
  { module: "Homework",            owner: true,  admin: true,  accountant: false, user: true,  student: "view", parent: "view" },
  { module: "Examinations",        owner: true,  admin: true,  accountant: false, user: true,  student: "view", parent: "view" },
  { module: "Teacher Management",  owner: true,  admin: true,  accountant: false, user: false, student: false, parent: false },
  { module: "Finance / Fees",      owner: true,  admin: false, accountant: true,  user: false, student: "view", parent: "view" },
  { module: "Hostel",              owner: true,  admin: true,  accountant: "fees",user: false, student: false, parent: false },
  { module: "Transport",           owner: true,  admin: true,  accountant: "fees",user: "view",student: false, parent: false },
  { module: "ID Cards",            owner: true,  admin: true,  accountant: false, user: false, student: false, parent: false },
  { module: "Portal Accounts",     owner: true,  admin: true,  accountant: false, user: false, student: false, parent: false },
];

const COL_ROLES = ["owner", "admin", "accountant", "user", "student", "parent"];
const COL_COLORS = {
  owner: "#5b21b6", admin: "#1d4ed8", accountant: "#92400e",
  user: "#065f46", student: "#0891b2", parent: "#be185d",
};

function AccessIcon({ val }) {
  if (val === true)     return <Feather name="check-circle" size={14} color="#16a34a" />;
  if (val === false)    return <Feather name="x-circle"     size={14} color="#dc2626" />;
  if (val === "view")   return <Feather name="eye"          size={14} color="#0891b2" />;
  if (val === "fees")   return <Feather name="dollar-sign"  size={14} color="#92400e" />;
  return null;
}

function QuickRefTable() {
  return (
    <View style={gc.tableWrap}>
      {/* Header row */}
      <View style={gc.tableHeadRow}>
        <Text style={[gc.tableCell, gc.tableCellModule, gc.tableHeadTxt]}>Module</Text>
        {COL_ROLES.map(r => (
          <View key={r} style={[gc.tableCell, gc.tableCellRole, { backgroundColor: COL_COLORS[r] + "18" }]}>
            <Text style={[gc.tableHeadTxt, { color: COL_COLORS[r], fontSize: 8 }]}>
              {r.toUpperCase().slice(0, 5)}
            </Text>
          </View>
        ))}
      </View>
      {/* Data rows */}
      {QUICK_REF.map((row, ri) => (
        <View key={ri} style={[gc.tableRow, ri % 2 === 0 && gc.tableRowAlt]}>
          <Text style={[gc.tableCell, gc.tableCellModule, gc.tableRowTxt]} numberOfLines={1}>{row.module}</Text>
          {COL_ROLES.map(r => (
            <View key={r} style={[gc.tableCell, gc.tableCellRole, { alignItems: "center", justifyContent: "center" }]}>
              <AccessIcon val={row[r]} />
            </View>
          ))}
        </View>
      ))}
      {/* Legend */}
      <View style={gc.legend}>
        <View style={gc.legendItem}><Feather name="check-circle" size={12} color="#16a34a" /><Text style={gc.legendTxt}>Full access</Text></View>
        <View style={gc.legendItem}><Feather name="eye"          size={12} color="#0891b2" /><Text style={gc.legendTxt}>View own data</Text></View>
        <View style={gc.legendItem}><Feather name="dollar-sign"  size={12} color="#92400e" /><Text style={gc.legendTxt}>Finance only</Text></View>
        <View style={gc.legendItem}><Feather name="x-circle"     size={12} color="#dc2626" /><Text style={gc.legendTxt}>No access</Text></View>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function RoleGuideScreen() {
  const [tab, setTab] = useState("roles"); // "roles" | "table"

  return (
    <SafeAreaView style={gc.safe} edges={["bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f1f5f9" />

      {/* Screen header */}
      <View style={gc.screenHead}>
        <View style={gc.screenHeadIcon}>
          <Feather name="book-open" size={18} color="#5b21b6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={gc.screenHeadTitle}>User Role Guide</Text>
          <Text style={gc.screenHeadSub}>6 roles · assign the right one to each user</Text>
        </View>
      </View>

      {/* Tab toggle */}
      <View style={gc.tabRow}>
        <TouchableOpacity
          style={[gc.tabBtn, tab === "roles" && gc.tabBtnActive]}
          onPress={() => setTab("roles")}
          activeOpacity={0.8}
        >
          <Feather name="users" size={13} color={tab === "roles" ? "#fff" : "#64748b"} />
          <Text style={[gc.tabBtnTxt, tab === "roles" && gc.tabBtnTxtActive]}>Role Cards</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[gc.tabBtn, tab === "table" && gc.tabBtnActive]}
          onPress={() => setTab("table")}
          activeOpacity={0.8}
        >
          <Feather name="grid" size={13} color={tab === "table" ? "#fff" : "#64748b"} />
          <Text style={[gc.tabBtnTxt, tab === "table" && gc.tabBtnTxtActive]}>Quick Reference</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={gc.scroll}
        showsVerticalScrollIndicator={false}
      >
        {tab === "roles"
          ? ROLES.map(role => <RoleCard key={role.id} role={role} />)
          : <QuickRefTable />
        }
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const gc = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#f1f5f9" },
  scroll: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16 },

  // Screen header
  screenHead:      { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  screenHeadIcon:  { width: 36, height: 36, borderRadius: 11, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  screenHeadTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a", letterSpacing: -0.2 },
  screenHeadSub:   { fontSize: 11, color: "#64748b", marginTop: 1 },

  // Tab toggle
  tabRow:       { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tabBtn:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f1f5f9" },
  tabBtnActive: { backgroundColor: "#5b21b6" },
  tabBtnTxt:    { fontSize: 13, fontWeight: "700", color: "#64748b" },
  tabBtnTxtActive: { color: "#fff" },

  // Role card
  card: { backgroundColor: "#fff", borderRadius: 16, marginBottom: 12, overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },

  // Card header
  cardHead:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  headIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  headLabel:    { fontSize: 17, fontWeight: "900", color: "#fff", letterSpacing: -0.3 },
  headAssigned: { fontSize: 11, color: "rgba(255,255,255,0.78)", marginTop: 2 },

  // Summary
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fafafa", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  summaryTxt: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "500" },

  // Detail
  detail:     { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },

  // Module block
  modBlock:   { marginBottom: 12 },
  modHeader:  { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  modIconWrap:{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  modName:    { fontSize: 12, fontWeight: "800", letterSpacing: -0.1 },
  modItem:    { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4, paddingLeft: 6 },
  dot:        { width: 5, height: 5, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  modItemTxt: { flex: 1, fontSize: 12, color: "#334155", lineHeight: 17 },

  // Note inside module
  noteRow:    { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#fffbeb", borderRadius: 8, padding: 7, marginTop: 4 },
  noteTxt:    { flex: 1, fontSize: 11, color: "#92400e", fontWeight: "500" },

  // Restrictions
  restrictBlock:  { backgroundColor: "#fff5f5", borderRadius: 10, padding: 10, marginTop: 2, marginBottom: 10 },
  restrictHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  restrictTitle:  { fontSize: 11, fontWeight: "800", color: "#dc2626", textTransform: "uppercase", letterSpacing: 0.4 },

  // Expand button
  expandBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 11, borderTopWidth: 1 },
  expandTxt:  { fontSize: 12, fontWeight: "700" },

  // Quick reference table
  tableWrap:        { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  tableHeadRow:     { flexDirection: "row", backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tableRow:         { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tableRowAlt:      { backgroundColor: "#fafafa" },
  tableCell:        { paddingVertical: 9, paddingHorizontal: 4 },
  tableCellModule:  { flex: 1, paddingLeft: 10 },
  tableCellRole:    { width: 40 },
  tableHeadTxt:     { fontSize: 9, fontWeight: "800", color: "#475569", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRowTxt:      { fontSize: 11, color: "#334155", fontWeight: "500" },

  // Legend
  legend:      { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12, backgroundColor: "#f8fafc", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 4 },
  legendTxt:   { fontSize: 11, color: "#475569", fontWeight: "500" },
});
