import React, { useContext } from "react";
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
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    {!user ? (
      // ── Unauthenticated stack — Login + public screens only ──
      <>
        <Stack.Screen name="Login"                      component={LoginScreen}                      />
        <Stack.Screen name="ForgotPassword"             component={ForgotPasswordScreen}             />
        <Stack.Screen name="TrialRegistrationScreen"    component={TrialRegistrationScreen}          />
        <Stack.Screen name="StudentParentRegistration"  component={StudentParentRegistrationScreen}  />
      </>
    ) : (
      // ── Authenticated stack — all app screens ──
      <>
        <Stack.Screen name="MainTabs"                   component={MainTabs}                          />
        <Stack.Screen name="ContactScreen"              component={ContactScreen}                     />
        <Stack.Screen name="MyAttendance"               component={MyAttendanceScreen}                />
        <Stack.Screen name="MyFee"                      component={MyFeeScreen}                       />
        <Stack.Screen name="MyMarksheet"                component={MyMarksheetScreen}                 />
        <Stack.Screen name="UserProfile"       getComponent={() => require("../screens/UserProfileScreen").default}                          />
        <Stack.Screen name="ChangePassword"    getComponent={() => require("../screens/ChangePasswordScreen").default}                       />
        <Stack.Screen name="Settings"          getComponent={() => require("../screens/SettingsScreen").default}                             />
        <Stack.Screen name="Admin"             getComponent={() => require("../screens/AdminScreen").default}                                />
        <Stack.Screen name="HostelEnrollment"  getComponent={() => require("../screens/Hostel/HostelEnrollmentScreen").default}              />
        <Stack.Screen name="TransportEnrollment"   getComponent={() => require("../screens/Transport/TransportEnrollmentScreen").default}    />
        <Stack.Screen name="StudentFeeTransport"   getComponent={() => require("../screens/Finance/StudentFeeTransportScreen").default}      />
        <Stack.Screen name="AttendanceReport"      getComponent={() => require("../screens/StudentActions/AttendanceReportScreen").default}  />
        <Stack.Screen name="NoticeBoard"           getComponent={() => require("../screens/NoticeBoardScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="SelectStudent"         getComponent={() => require("../screens/SelectStudentScreen").default} />
        <Stack.Screen name="SchoolMemories"        getComponent={() => require("../screens/SchoolMemoriesScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="SchoolMemoriesAdmin"   getComponent={() => require("../screens/SchoolMemoriesAdminScreen").default} options={{ headerShown: false }} />
        <Stack.Screen name="ChatList"              getComponent={() => require("../screens/Chat/ChatListScreen").default}      options={{ headerShown: false }} />
        <Stack.Screen name="Chat"                  getComponent={() => require("../screens/Chat/ChatScreen").default}          options={{ headerShown: false }} />
      </>
    )}
  </Stack.Navigator>
  );
};

export default AppNavigator;