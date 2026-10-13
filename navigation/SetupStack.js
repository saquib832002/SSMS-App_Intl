/**
 * navigation/SetupStack.js
 * All Setup + Exam screens live here so bottom tabs always stay visible.
 */
import React from "react";
import { featureScreenLayout } from "../components/FeatureGate";
import { createStackNavigator } from "@react-navigation/stack";

// // Setup screens
import SetupScreen              from "../screens/SetupScreen";
import InstituteDetailsScreen   from "../screens/Setup/InstituteDetailsScreen";
import BranchSetupScreen        from "../screens/Setup/BranchSetupScreen";
import SessionSetupScreen       from "../screens/Setup/SessionSetupScreen";
import ClassSetupScreen         from "../screens/Setup/ClassSetupScreen";
import SectionSetupScreen       from "../screens/Setup/SectionSetupScreen";
import UserSetupScreen          from "../screens/Setup/UserSetupScreen";
import OnlinePaymentsScreen     from "../screens/Setup/OnlinePaymentsScreen";
import StaffCategoryScreen      from "../screens/Staff/StaffCategoryScreen";
import SubjectSetupScreen       from "../screens/Setup/SubjectSetupScreen";
import ClassSubjectScreen       from "../screens/Setup/ClassSubjectScreen";
import PeriodSetupScreen        from "../screens/timetable/PeriodSetupScreen";
import TimetableScreen          from "../screens/timetable/TimetableScreen";
import TeacherTimetableScreen   from "../screens/timetable/TeacherTimetableScreen";
import MasterTimetableScreen    from "../screens/timetable/MasterTimetableScreen";
import SubjectTeacherScreen     from "../screens/Staff/SubjectTeacherScreen";
import SubjectMaxMarksScreen    from "../screens/Setup/SubjectMaxMarksScreen";
import SchoolSettingsScreen     from "../screens/Setup/SchoolSettingsScreen";
import RegionFormatsScreen      from "../screens/Setup/RegionFormatsScreen";
import NotificationSettingsScreen from "../screens/Setup/NotificationSettingsScreen";
import IdCardSettingsScreen     from "../screens/Setup/IdCardSettingsScreen";
import RoleGuideScreen         from "../screens/Guide/RoleGuideScreen";


// Finance screens reachable from Setup
import FeeItemScreen            from "../screens/Finance/FeeItemScreen";
import ClassFeeStructureScreen  from "../screens/Finance/ClassFeeStructureScreen";
import HostelFeeStructureScreen from "../screens/Finance/HostelFeeStructureScreen";
import TransportFeeStructureScreen from "../screens/Finance/TransportFeeStructureScreen";
import { _t } from "../services/i18n";


const Stack = createStackNavigator();

export default function SetupStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: true }} screenLayout={featureScreenLayout}>
      {/* Root — no header, shows bottom tabs */}
      <Stack.Screen name="SetupHome"        component={SetupScreen}            options={{ headerShown: false }} />

      {/* School Setup */}
      <Stack.Screen name="SchoolSettings"   component={SchoolSettingsScreen}   options={{ title: _t("School Settings") }} />
      <Stack.Screen name="RegionFormats"    component={RegionFormatsScreen}    options={{ title: _t("Region & Formats") }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: _t("Notifications") }} />
      <Stack.Screen name="IdCardSettings"   component={IdCardSettingsScreen}   options={{ title: _t("ID Card Layout") }} />
      <Stack.Screen name="InstituteDetails" component={InstituteDetailsScreen} options={{ title: _t("Institute Details") }} />
      <Stack.Screen name="BranchSetup"      component={BranchSetupScreen}      options={{ title: _t("Branches") }} />
      <Stack.Screen name="SessionSetup"     component={SessionSetupScreen}     options={{ title: _t("Sessions") }} />
      <Stack.Screen name="ClassSetup"       component={ClassSetupScreen}       options={{ title: _t("Classes") }} />
      <Stack.Screen name="SectionSetup"     component={SectionSetupScreen}     options={{ title: _t("Sections") }} />
      <Stack.Screen name="UserSetup"        component={UserSetupScreen}        options={{ title: _t("Users") }} />
      <Stack.Screen name="OnlinePayments"   component={OnlinePaymentsScreen}   options={{ title: _t("Online Payments"), headerShown: false }} />
      <Stack.Screen name="RoleGuide"        component={RoleGuideScreen}        options={{ title: _t("User Role Guide") }} />
      <Stack.Screen name="StaffCategory"    component={StaffCategoryScreen}    options={{ title: _t("Staff Categories") }} />
      <Stack.Screen name="SubjectSetup"     component={SubjectSetupScreen}     options={{ title: _t("Subjects") }} />
      <Stack.Screen name="ClassSubject"       component={ClassSubjectScreen}       options={{ title: _t("Class Subjects") }} />
      <Stack.Screen name="PeriodSetup"       component={PeriodSetupScreen}        options={{ title: _t("Periods") }} />
      <Stack.Screen name="Timetable"         component={TimetableScreen}          options={{ title: _t("Timetable") }} />
      <Stack.Screen name="TeacherTimetable"  component={TeacherTimetableScreen}   options={{ title: _t("Teacher Timetable") }} />
      <Stack.Screen name="MasterTimetable"  component={MasterTimetableScreen}    options={{ title: _t("Master Timetable") }} />
      <Stack.Screen name="SubjectMaxMarks"  component={SubjectMaxMarksScreen}  options={{ title: _t("Max Marks") }} />
      <Stack.Screen name="StudentFields"    getComponent={() => require("../screens/Setup/StudentFieldsScreen").default} options={{ title: _t("Student fields") }} />
    
    <Stack.Screen name="HostelBuildings" getComponent={() => require("../screens/Hostel/HostelBuildingScreen").default}
      />
       <Stack.Screen name="HostelRooms" getComponent={() => require("../screens/Hostel/HostelRoomScreen").default}
      />
      <Stack.Screen name="HostelSeats" getComponent={() => require("../screens/Hostel/HostelRoomSeatScreen").default}
      />
      {/* Question Bank & Papers (reachable from Setup) */}
      <Stack.Screen name="ChapterManage"    getComponent={() => require("../screens/Exams/ChapterManageScreen").default}     options={{ headerShown: false }} />
      <Stack.Screen name="QuestionBank"     getComponent={() => require("../screens/Exams/QuestionBankScreen").default}      options={{ title: _t("Question Bank")    }} />
      <Stack.Screen name="AddEditQuestion"  getComponent={() => require("../screens/Exams/AddEditQuestionScreen").default}   options={{ title: _t("Question")         }} />
      <Stack.Screen name="ImportQuestions"  getComponent={() => require("../screens/Exams/ImportQuestionsScreen").default}   options={{ title: _t("Import Questions") }} />
      <Stack.Screen name="PaperList"       getComponent={() => require("../screens/Exams/PaperListScreen").default}      options={{ title: _t("Question Papers")  }} />
      <Stack.Screen name="PaperHeader"     getComponent={() => require("../screens/Exams/PaperHeaderScreen").default}    options={{ title: _t("Paper Setup")      }} />
      <Stack.Screen name="PaperBuilder"    getComponent={() => require("../screens/Exams/PaperBuilderScreen").default}   options={{ title: _t("Paper Builder")    }} />
      <Stack.Screen name="PaperPreview"    getComponent={() => require("../screens/Exams/PaperPreviewScreen").default}   options={{ title: _t("Preview & Export") }} />

      {/* Test Series (admin) */}
      <Stack.Screen name="TestSeriesManage"   getComponent={() => require("../screens/Exams/TestSeriesManageScreen").default}   options={{ headerShown: false }} />
      <Stack.Screen name="TestManage"         getComponent={() => require("../screens/Exams/TestManageScreen").default}         options={{ title: _t("Manage Tests"), headerShown: true }} />
      <Stack.Screen name="TestCreate"         getComponent={() => require("../screens/Exams/TestCreateScreen").default}         options={{ headerShown: false }} />
      <Stack.Screen name="TestQuestionPicker" getComponent={() => require("../screens/Exams/TestQuestionPickerScreen").default}  options={{ headerShown: false }} />
      <Stack.Screen name="TestResult"         getComponent={() => require("../screens/Exams/TestResultScreen").default}         options={{ headerShown: false }} />
      <Stack.Screen name="TestAnalysis"       getComponent={() => require("../screens/Exams/TestAnalysisScreen").default}       options={{ headerShown: false }} />
      <Stack.Screen name="TestLeaderboard"    getComponent={() => require("../screens/Exams/TestLeaderboardScreen").default}    options={{ headerShown: false }} />

      {/* Finance (reachable from Setup) */}
      <Stack.Screen name="FeeItem"            component={FeeItemScreen}             options={{ title: _t("Fee Items") }} />
      <Stack.Screen name="ClassFeeStructure"  component={ClassFeeStructureScreen}   options={{ title: _t("Class Fees") }} />
      <Stack.Screen name="HostelFeeStructure" component={HostelFeeStructureScreen}  options={{ title: _t("Hostel Fees") }} />
      <Stack.Screen name="TransportFeeStructure" component={TransportFeeStructureScreen} />
      <Stack.Screen name="FeeDemandSlip"         getComponent={() => require("../screens/Finance/FeeDemandSlipScreen").default}          options={{ title: _t("Demand Slip"), headerShown: false }} />
      <Stack.Screen name="FeeCollectionApproval" getComponent={() => require("../screens/Finance/FeeCollectionApprovalScreen").default}   options={{ title: _t("Approve Collection") }} />

      {/* Chat */}
      <Stack.Screen name="ChatList" getComponent={() => require("../screens/Chat/ChatListScreen").default} options={{ headerShown: false }} />
      <Stack.Screen name="Chat"     getComponent={() => require("../screens/Chat/ChatScreen").default}     options={{ headerShown: false }} />
    
    </Stack.Navigator>
  );
}