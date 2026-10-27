import React, { useContext } from "react";
import { featureScreenLayout } from "../components/FeatureGate";
import { createStackNavigator } from '@react-navigation/stack';
import LoginScreen          from "../screens/LoginScreen";
import ForgotPasswordScreen from "../screens/ForgotPasswordScreen";
import TrialRegistrationScreen from "../screens/TrialRegistrationScreen";
import StudentParentRegistrationScreen from "../screens/StudentParentRegistrationScreen";
import ContactScreen                  from "../screens/ContactScreen";
import MyAttendanceScreen             from "../screens/StudentActions/MyAttendanceScreen";
import MyFeeScreen                    from "../screens/Finance/MyFeeScreen";
import MyMarksheetScreen              from "../screens/Exams/MyMarksheetScreen";
import MainTabs             from "./MainTabs";
import { AuthContext }      from "../context/AuthContext";
import { _t } from "../services/i18n";

const Stack = createStackNavigator();

// ── Auth guard ────────────────────────────────────────────────────────────────
// When user is null (logged out / session expired), only the public screens are
// rendered. React Navigation will automatically navigate to the first screen
// in the active set, which is always Login when unauthenticated.
// This means even if handleExpired's navigation.reset() is delayed, the user
// can never see the dashboard — the stack simply doesn't contain it.
const AppNavigator = () => {
  const { user } = useContext(AuthContext);

  return (
  <Stack.Navigator screenOptions={{ headerShown: false }} screenLayout={featureScreenLayout}>
    {!user ? (
      // ── Unauthenticated stack — Login + public screens only ──
      <>
        <Stack.Screen name="Login"                      component={LoginScreen}                      />
        <Stack.Screen name="ForgotPassword"             component={ForgotPasswordScreen}             />
        <Stack.Screen name="TrialRegistrationScreen"    component={TrialRegistrationScreen}          />
        <Stack.Screen name="StudentParentRegistration"  component={StudentParentRegistrationScreen}  />
        <Stack.Screen name="TwoStep"           getComponent={() => require("../screens/Security/TwoStepScreen").default} />
        <Stack.Screen name="BusPhone"          getComponent={() => require("../screens/Transport/BusPhoneScreen").default}
                      options={{ headerShown: true, title: _t("Bus phone") }} />
      </>
    ) : (
      // ── Authenticated stack — all app screens ──
      <>
        <Stack.Screen name="MainTabs"                   component={MainTabs}                          />
        <Stack.Screen name="ContactScreen"              component={ContactScreen}                     />
        <Stack.Screen name="MyAttendance"               component={MyAttendanceScreen}                />
        <Stack.Screen name="MyFee"                      component={MyFeeScreen}                       />
        <Stack.Screen name="MyMarksheet"                component={MyMarksheetScreen}                 />
        <Stack.Screen name="MyAbsences"        getComponent={() => require("../screens/StudentActions/MyAbsencesScreen").default}
                      options={{ headerShown: true, title: _t("Absence & Leave") }} />
        <Stack.Screen name="MyMeetings"        getComponent={() => require("../screens/Meetings/MyMeetingsScreen").default}
                      options={{ headerShown: true, title: _t("Parent–teacher meetings") }} />
        <Stack.Screen name="Meetings"          getComponent={() => require("../screens/Meetings/MeetingsScreen").default}
                      options={{ headerShown: true, title: _t("Parent–teacher meetings") }} />
        <Stack.Screen name="MeetingSession"    getComponent={() => require("../screens/Meetings/MeetingSessionScreen").default}
                      options={{ headerShown: true, title: _t("Meeting session") }} />
        <Stack.Screen name="MeetingEdit"       getComponent={() => require("../screens/Meetings/MeetingEditScreen").default}
                      options={{ headerShown: true, title: _t("Meeting slots") }} />
        <Stack.Screen name="ExamLogistics" getComponent={() => require("../screens/ExamLogistics/ExamLogisticsScreen").default}
                      options={{ headerShown: true, title: _t("Exam halls & seating") }} />
        <Stack.Screen name="ExamHalls" getComponent={() => require("../screens/ExamLogistics/ExamHallsScreen").default}
                      options={{ headerShown: true, title: _t("Exam halls") }} />
        <Stack.Screen name="SeatingPlan" getComponent={() => require("../screens/ExamLogistics/SeatingPlanScreen").default}
                      options={{ headerShown: true, title: _t("Seating plan") }} />
        <Stack.Screen name="Invigilation" getComponent={() => require("../screens/ExamLogistics/InvigilationScreen").default}
                      options={{ headerShown: true, title: _t("Invigilators") }} />
        <Stack.Screen name="AdmitCards" getComponent={() => require("../screens/ExamLogistics/AdmitCardsScreen").default}
                      options={{ headerShown: true, title: _t("Admit cards") }} />
        <Stack.Screen name="MyAdmitCard" getComponent={() => require("../screens/ExamLogistics/MyAdmitCardScreen").default}
                      options={{ headerShown: true, title: _t("Admit card") }} />
        <Stack.Screen name="MyExamDuties" getComponent={() => require("../screens/ExamLogistics/MyExamDutiesScreen").default}
                      options={{ headerShown: true, title: _t("My exam duties") }} />
        <Stack.Screen name="CalendarSync" getComponent={() => require("../screens/CalendarSyncScreen").default}
                      options={{ headerShown: true, title: _t("Calendar sync") }} />
        <Stack.Screen name="Cover"        getComponent={() => require("../screens/Staff/CoverScreen").default}
                      options={{ headerShown: true, title: _t("Cover & substitution") }} />
        <Stack.Screen name="MyCovers"     getComponent={() => require("../screens/Staff/MyCoversScreen").default}
                      options={{ headerShown: true, title: _t("My cover periods") }} />
        <Stack.Screen name="DriverTrip"   getComponent={() => require("../screens/Transport/DriverTripScreen").default}
                      options={{ headerShown: true, title: _t("My bus trip") }} />
        <Stack.Screen name="LiveBus"      getComponent={() => require("../screens/Transport/LiveBusScreen").default}
                      options={{ headerShown: true, title: _t("Where is the bus?") }} />
        <Stack.Screen name="BusPhone"     getComponent={() => require("../screens/Transport/BusPhoneScreen").default}
                      options={{ headerShown: true, title: _t("Bus phone") }} />
        <Stack.Screen name="BusFleet"     getComponent={() => require("../screens/Transport/BusFleetScreen").default}
                      options={{ headerShown: true, title: _t("Live buses") }} />
        <Stack.Screen name="VisitorDesk"  getComponent={() => require("../screens/Safety/VisitorDeskScreen").default}
                      options={{ headerShown: true, title: _t("Visitors") }} />
        <Stack.Screen name="PickupDesk"   getComponent={() => require("../screens/Safety/PickupDeskScreen").default}
                      options={{ headerShown: true, title: _t("Gate pick-up") }} />
        <Stack.Screen name="PickupPersons" getComponent={() => require("../screens/Safety/PickupPersonsScreen").default}
                      options={{ headerShown: true, title: _t("Pick-up persons") }} />
        <Stack.Screen name="SafetySettings" getComponent={() => require("../screens/Safety/SafetySettingsScreen").default}
                      options={{ headerShown: true, title: _t("Safety rules") }} />
        <Stack.Screen name="MyVisitors"   getComponent={() => require("../screens/Safety/MyVisitorsScreen").default}
                      options={{ headerShown: true, title: _t("My visitors") }} />
        <Stack.Screen name="MyPickup"     getComponent={() => require("../screens/Safety/MyPickupScreen").default}
                      options={{ headerShown: true, title: _t("Pick-up persons") }} />
        <Stack.Screen name="Analytics"         getComponent={() => require("../screens/Analytics/AnalyticsScreen").default}
                      options={{ headerShown: true, title: _t("School analytics") }} />
        <Stack.Screen name="AnalyticsSettings" getComponent={() => require("../screens/Analytics/AnalyticsSettingsScreen").default}
                      options={{ headerShown: true, title: _t("Analytics settings") }} />
        <Stack.Screen name="StudentRecord"     getComponent={() => require("../screens/StudentActions/StudentRecordScreen").default}
                      options={{ headerShown: true, title: _t("Student record") }} />
        <Stack.Screen name="MyReportCards"     getComponent={() => require("../screens/Exams/ReportCardsScreen").default}
                      options={{ headerShown: true, title: _t("Report Cards") }} />
        <Stack.Screen name="UserProfile"       getComponent={() => require("../screens/UserProfileScreen").default}                          />
        <Stack.Screen name="MyLanguage"        getComponent={() => require("../screens/MyLanguageScreen").default}
                      options={{ headerShown: true, title: _t("My language") }} />
        <Stack.Screen name="Inbox"             getComponent={() => require("../screens/InboxScreen").default}
                      options={{ headerShown: true, title: _t("Notifications") }} />
        <Stack.Screen name="MyNotifications"   getComponent={() => require("../screens/MyNotificationsScreen").default}
                      options={{ headerShown: true, title: _t("My notifications") }} />
        <Stack.Screen name="ChangePassword"    getComponent={() => require("../screens/ChangePasswordScreen").default}                       />
        <Stack.Screen name="Settings"          getComponent={() => require("../screens/SettingsScreen").default}
                      options={{ headerShown: true, title: _t("Security & Privacy") }} />
        {/* Privacy & security */}
        <Stack.Screen name="Security"          getComponent={() => require("../screens/Security/SecurityScreen").default}         options={{ headerShown: true, title: _t("Security") }} />
        <Stack.Screen name="Privacy"           getComponent={() => require("../screens/Security/PrivacyScreen").default}          options={{ headerShown: true, title: _t("Privacy") }} />
        <Stack.Screen name="SecuritySettings"  getComponent={() => require("../screens/Security/SecuritySettingsScreen").default} options={{ headerShown: true, title: _t("School Security") }} />
        <Stack.Screen name="AuditLog"          getComponent={() => require("../screens/Security/AuditLogScreen").default}         options={{ headerShown: true, title: _t("Audit Log") }} />
        <Stack.Screen name="Roles"             getComponent={() => require("../screens/Security/RolesScreen").default}            options={{ headerShown: true, title: _t("Roles & Permissions") }} />
        <Stack.Screen name="RoleEdit"          getComponent={() => require("../screens/Security/RoleEditScreen").default}         options={{ headerShown: true, title: _t("Role") }} />
        <Stack.Screen name="PrivacyRequests"   getComponent={() => require("../screens/Security/PrivacyRequestsScreen").default}  options={{ headerShown: true, title: _t("Privacy Requests") }} />
        <Stack.Screen name="Consents"          getComponent={() => require("../screens/Security/ConsentsScreen").default}         options={{ headerShown: true, title: _t("Consents") }} />
        <Stack.Screen name="Admin"             getComponent={() => require("../screens/AdminScreen").default}                                />
        <Stack.Screen name="HostelEnrollment"  getComponent={() => require("../screens/Hostel/HostelEnrollmentScreen").default}              />
        <Stack.Screen name="TransportEnrollment"   getComponent={() => require("../screens/Transport/TransportEnrollmentScreen").default}    />
        <Stack.Screen name="StudentFeeTransport"   getComponent={() => require("../screens/Finance/StudentFeeTransportScreen").default}      />
        <Stack.Screen name="AttendanceReport"      getComponent={() => require("../screens/StudentActions/AttendanceReportScreen").default}  />
        <Stack.Screen name="NoticeBoard"           getComponent={() => require("../screens/NoticeBoardScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="SelectStudent"         getComponent={() => require("../screens/SelectStudentScreen").default} />
        <Stack.Screen name="SchoolMemories"        getComponent={() => require("../screens/SchoolMemoriesScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="SchoolMemoriesAdmin"   getComponent={() => require("../screens/SchoolMemoriesAdminScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="Subscription"          getComponent={() => require("../screens/SubscriptionScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="ChatList"              getComponent={() => require("../screens/Chat/ChatListScreen").default}      options={{ headerShown: false }} />
        <Stack.Screen name="Chat"                  getComponent={() => require("../screens/Chat/ChatScreen").default}          options={{ headerShown: false }} />
      </>
    )}
  </Stack.Navigator>
  );
};

export default AppNavigator;