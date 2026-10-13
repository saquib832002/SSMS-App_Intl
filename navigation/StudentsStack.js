import React from "react";
import { featureScreenLayout } from "../components/FeatureGate";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import StudentsScreen from "../screens/StudentsScreen";
import { _t } from "../services/i18n";

const Stack = createNativeStackNavigator();

const StudentsStack = () => (
    <Stack.Navigator screenOptions={{ headerShown: false }} screenLayout={featureScreenLayout}>
    <Stack.Screen name="StudentsList"     component={StudentsScreen} />
    <Stack.Screen name="Registration"     getComponent={() => require("../screens/StudentActions/StudentRegistrationScreen").default} options={{ title: _t("Registration"),  headerShown: false }} />
    <Stack.Screen name="StudentDirectory" getComponent={() => require("../screens/StudentActions/RegisteredStudentsScreen").default}  options={{ title: _t("Reg. Students"), headerShown: true }} />
    <Stack.Screen name="EnrolledStudents" getComponent={() => require("../screens/StudentActions/EnrolledStudentsScreen").default}    options={{ title: _t("Enr. Students") , headerShown: true }} />
    <Stack.Screen name="Attendance" getComponent={() => require("../screens/StudentActions/AttendanceScreen").default}    options={{ title: _t("Attendance"), headerShown: true  }} />
    <Stack.Screen name="Enrollment"       getComponent={() => require("../screens/StudentActions/EnrollmentScreen").default}          options={{ title: _t("Enrollment")     }} />
    <Stack.Screen name="StudentRecord"    getComponent={() => require("../screens/StudentActions/StudentRecordScreen").default}       options={{ headerShown: true, title: _t("Student record") }} />
    <Stack.Screen name="HealthAlerts"     getComponent={() => require("../screens/StudentActions/HealthAlertsScreen").default}        options={{ headerShown: true, title: _t("Health alerts") }} />
    <Stack.Screen name="DocumentExpiry"   getComponent={() => require("../screens/StudentActions/HealthAlertsScreen").default}        options={{ headerShown: true, title: _t("Expiring documents") }} initialParams={{ mode: "expiry" }} />
    <Stack.Screen name="StudentProfile"   getComponent={() => require("../screens/StudentActions/StudentProfileScreen").default}      options={{ title: _t("Profile")        }} />
    <Stack.Screen name="StudentFee"       getComponent={() => require("../screens/Finance/StudentFeeScreen").default}                 options={{ title: _t("Student Fee") , headerShown: true   }} />
    <Stack.Screen name="FeeDemandSlip"    getComponent={() => require("../screens/Finance/FeeDemandSlipScreen").default}              options={{ title: _t("Demand Slip"), headerShown: false}} />
    <Stack.Screen name="FeeCollectionApproval" getComponent={() => require("../screens/Finance/FeeCollectionApprovalScreen").default} options={{ title: _t("Approve Collection"), headerShown: true }} />
    <Stack.Screen name="FeeItem"          getComponent={() => require("../screens/Finance/FeeItemScreen").default}                    options={{ title: _t("Fee Item")       }} />
    <Stack.Screen name="FeeCollection"    getComponent={() => require("../screens/Finance/FeeCollectionScreen").default}              options={{ title: _t("Fee Collection") }} />
    <Stack.Screen name="BranchSetup"      getComponent={() => require("../screens/Setup/BranchSetupScreen").default}                 options={{ title: _t("Branch")         }} />
    <Stack.Screen name="ClassSetup"       getComponent={() => require("../screens/Setup/ClassSetupScreen").default}                   options={{ title: _t("Class")          }} />
    <Stack.Screen name="SectionSetup"     getComponent={() => require("../screens/Setup/SectionSetupScreen").default}                 options={{ title: _t("Section")        }} />
    <Stack.Screen name="SubjectTeacher"   getComponent={() => require("../screens/Staff/SubjectTeacherScreen").default}   options={{ title: _t("Subject Teachers") }} />
    <Stack.Screen name="TransportEnrollment"   getComponent={() => require("../screens/Transport/TransportEnrollmentScreen").default}   options={{ title: _t("Transport Enrollment") }} />

    {/* Teacher screens reachable from Students */}
    <Stack.Screen name="HiringPending" getComponent={() => require("../screens/Staff/HiringPendingScreen").default}  options={{ title: _t("Hiring Review"), headerShown: true }}/>
    <Stack.Screen name="HiredStaff"   getComponent={() => require("../screens/Staff/HiredStaffScreen").default} options={{ title: _t("Hired Staff"), headerShown: true }}/>
    <Stack.Screen name="StaffRegistration"   getComponent={() => require("../screens/Staff/StaffRegistrationScreen").default} options={{ title: _t("Staff Registration"), headerShown: true }}/>
 
    {/* <Stack.Screen name="UserSetup"        getComponent={() => require("../screens/Setup/UserSetupScreen").default}                    options={{ title: "User Setup"     }} /> */}
    <Stack.Screen name="StudentIdCard"    getComponent={() => require("../screens/StudentActions/StudentIdCardScreen").default}   options={{ title: _t("ID Card"),    headerShown: false }} />
    <Stack.Screen name="StudentIdCardV2"  getComponent={() => require("../screens/StudentActions/StudentIdCardV2Screen").default} options={{ title: _t("ID Cards V2"), headerShown: false }} />
    <Stack.Screen name="HostelBuildings" getComponent={() => require("../screens/Hostel/HostelBuildingScreen").default} />
    <Stack.Screen name="HostelRooms"     getComponent={() => require("../screens/Hostel/HostelRoomScreen").default} />
    <Stack.Screen name="HostelSeats"     getComponent={() => require("../screens/Hostel/HostelRoomSeatScreen").default} />
 
    {/* Examinations */}
    <Stack.Screen name="QuickTestSetup" getComponent={() => require("../screens/Exams/QuickTestSetupScreen").default} options={{ title: _t("Quick Test Setup"), headerShown: false }} />
    <Stack.Screen name="Exam"  getComponent={() => require("../screens/Exams/ExamScreen").default}              options={{ title: _t("Exams") }} />
    <Stack.Screen name="AddMarks" getComponent={() => require("../screens/Exams/AddMarksScreen").default}           options={{ title: _t("Add Marks") }} />
    <Stack.Screen name="GenerateMarksheet" getComponent={() => require("../screens/Exams/GenerateMarksheetScreen").default} options={{ title: _t("Marksheet") }} />
    <Stack.Screen name="ExamResultsRank"   getComponent={() => require("../screens/Exams/ExamResultsRankScreen").default}   options={{ title: _t("Exam Rankings") }} />
    <Stack.Screen name="StudentMarks"      getComponent={() => require("../screens/Exams/StudentMarksScreen").default}        options={{ title: _t("Student Marks"), headerShown: false }} />
    <Stack.Screen name="StudentLeave"      getComponent={() => require("../screens/StudentActions/StudentLeaveScreen").default} options={{ title: _t("Student Leave"), headerShown: true }} />
    <Stack.Screen name="ArrivalLog"        getComponent={() => require("../screens/StudentActions/ArrivalLogScreen").default}   options={{ title: _t("Late & Early Log"), headerShown: true }} />
    <Stack.Screen name="GradingScales"     getComponent={() => require("../screens/Exams/GradingScalesScreen").default}       options={{ title: _t("Grading Scales"), headerShown: true }} />
    <Stack.Screen name="ReportCardSetup"   getComponent={() => require("../screens/Exams/ReportCardSetupScreen").default}     options={{ title: _t("Report Card Setup"), headerShown: true }} />
    <Stack.Screen name="ReportComments"    getComponent={() => require("../screens/Exams/ReportCommentsScreen").default}      options={{ title: _t("Teacher Comments"), headerShown: true }} />
    <Stack.Screen name="ReportCards"       getComponent={() => require("../screens/Exams/ReportCardsScreen").default}         options={{ title: _t("Report Cards"), headerShown: true }} />
    
    <Stack.Screen name="StudentDiscount"
  getComponent={() => require("../screens/Finance/StudentDiscountScreen").default}
  options={{ title: _t("Student Discounts") }} />

    {/* Date Sheets */}
    <Stack.Screen name="ExamDatesheet" getComponent={() => require("../screens/Exams/ExamDatesheetScreen").default} options={{ headerShown: false }} />
    <Stack.Screen name="MyDatesheet"   getComponent={() => require("../screens/Exams/MyDatesheetScreen").default}   options={{ headerShown: false }} />

    {/* Homework */}
    <Stack.Screen name="Homework"     getComponent={() => require("../screens/StudentActions/HomeworkCreateScreen").default}  options={{ title: _t("Homework"),         headerShown: false }} />
    <Stack.Screen name="HomeworkMark" getComponent={() => require("../screens/StudentActions/HomeworkMarkScreen").default}    options={{ title: _t("Mark Students"),    headerShown: false }} />
    <Stack.Screen name="MyHomework"   getComponent={() => require("../screens/StudentActions/HomeworkStudentScreen").default} options={{ title: _t("My Homework"),      headerShown: false }} />

    {/* Student / Parent user account management (admin/owner only) */}
    <Stack.Screen name="StudentUserAccounts" getComponent={() => require("../screens/StudentActions/StudentUserAccountsScreen").default} options={{ title: _t("Student Accounts"), headerShown: false }} />

    {/* Roll Numbers */}
    <Stack.Screen name="UpdateRollNumber" getComponent={() => require("../screens/StudentActions/UpdateRollNumberScreen").default} options={{ title: _t("Roll Numbers"), headerShown: false }} />

    {/* Question Paper */}
    <Stack.Screen name="QuestionBank"    getComponent={() => require("../screens/Exams/QuestionBankScreen").default}      options={{ title: _t("Question Bank"),   headerShown: true }} />
    <Stack.Screen name="AddEditQuestion" getComponent={() => require("../screens/Exams/AddEditQuestionScreen").default}   options={{ title: _t("Question"),        headerShown: true }} />
    <Stack.Screen name="ImportQuestions" getComponent={() => require("../screens/Exams/ImportQuestionsScreen").default}   options={{ title: _t("Import Questions"), headerShown: true }} />
    <Stack.Screen name="PaperList"       getComponent={() => require("../screens/Exams/PaperListScreen").default}      options={{ title: _t("Question Papers"), headerShown: true }} />
    <Stack.Screen name="PaperHeader"     getComponent={() => require("../screens/Exams/PaperHeaderScreen").default}    options={{ title: _t("Paper Setup"),     headerShown: true }} />
    <Stack.Screen name="PaperBuilder"    getComponent={() => require("../screens/Exams/PaperBuilderScreen").default}   options={{ title: _t("Paper Builder"),   headerShown: true }} />
    <Stack.Screen name="PaperPreview"    getComponent={() => require("../screens/Exams/PaperPreviewScreen").default}   options={{ title: _t("Preview & Export"),headerShown: true }} />

    {/* Test Series */}
    <Stack.Screen name="TestSeriesManage"  getComponent={() => require("../screens/Exams/TestSeriesManageScreen").default}  options={{ headerShown: false }} />
    <Stack.Screen name="TestCreate"        getComponent={() => require("../screens/Exams/TestCreateScreen").default}        options={{ headerShown: false }} />
    <Stack.Screen name="TestQuestionPicker" getComponent={() => require("../screens/Exams/TestQuestionPickerScreen").default} options={{ headerShown: false }} />
    <Stack.Screen name="MyTestSeries"      getComponent={() => require("../screens/Exams/MyTestSeriesScreen").default}      options={{ headerShown: false }} />
    <Stack.Screen name="TestLobby"         getComponent={() => require("../screens/Exams/TestLobbyScreen").default}         options={{ headerShown: false }} />
    <Stack.Screen name="TestAttempt"       getComponent={() => require("../screens/Exams/TestAttemptScreen").default}       options={{ headerShown: false, gestureEnabled: false }} />
    <Stack.Screen name="TestResult"        getComponent={() => require("../screens/Exams/TestResultScreen").default}        options={{ headerShown: false }} />
    <Stack.Screen name="TestAnalysis"      getComponent={() => require("../screens/Exams/TestAnalysisScreen").default}      options={{ headerShown: false }} />
    <Stack.Screen name="TestLeaderboard"   getComponent={() => require("../screens/Exams/TestLeaderboardScreen").default}   options={{ headerShown: false }} />

    {/* Chat */}
    <Stack.Screen name="ChatList" getComponent={() => require("../screens/Chat/ChatListScreen").default} options={{ headerShown: false }} />
    <Stack.Screen name="Chat"     getComponent={() => require("../screens/Chat/ChatScreen").default}     options={{ headerShown: false }} />

    {/* Certificates */}
    <Stack.Screen name="Certificates" getComponent={() => require("../screens/StudentActions/CertificateScreen").default} options={{ headerShown: false }} />

    {/* Leave Management */}
    <Stack.Screen name="StaffLeave"    getComponent={() => require("../screens/Staff/StaffLeaveScreen").default}    options={{ headerShown: false }} />
    <Stack.Screen name="LeaveApproval" getComponent={() => require("../screens/Staff/LeaveApprovalScreen").default} options={{ headerShown: false }} />
    {/* Staff attendance */}
    <Stack.Screen name="MyCheckIn"             getComponent={() => require("../screens/Staff/MyCheckInScreen").default}             options={{ title: _t("My Check-in"), headerShown: true }} />
    <Stack.Screen name="StaffAttendance"       getComponent={() => require("../screens/Staff/StaffAttendanceScreen").default}       options={{ title: _t("Staff Attendance"), headerShown: true }} />
    <Stack.Screen name="StaffAttendanceReport" getComponent={() => require("../screens/Staff/StaffAttendanceReportScreen").default} options={{ title: _t("Staff Attendance Report"), headerShown: true }} />
    <Stack.Screen name="OfficeCode"            getComponent={() => require("../screens/Staff/OfficeCodeScreen").default}            options={{ title: _t("Office Check-in Code"), headerShown: true }} />
    <Stack.Screen name="LeaveTypes"    getComponent={() => require("../screens/Staff/LeaveTypesScreen").default}    options={{ headerShown: false }} />
  </Stack.Navigator>
);

export default StudentsStack;