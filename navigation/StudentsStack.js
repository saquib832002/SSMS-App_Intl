import React from "react";
import { featureScreenLayout } from "../components/FeatureGate";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import StudentsScreen from "../screens/StudentsScreen";

const Stack = createNativeStackNavigator();

const StudentsStack = () => (
    <Stack.Navigator screenOptions={{ headerShown: false }} screenLayout={featureScreenLayout}>
    <Stack.Screen name="StudentsList"     component={StudentsScreen} />
    <Stack.Screen name="Registration"     getComponent={() => require("../screens/StudentActions/StudentRegistrationScreen").default} options={{ title: "Registration",  headerShown: false }} />
    <Stack.Screen name="StudentDirectory" getComponent={() => require("../screens/StudentActions/RegisteredStudentsScreen").default}  options={{ title: "Reg. Students", headerShown: true }} />
    <Stack.Screen name="EnrolledStudents" getComponent={() => require("../screens/StudentActions/EnrolledStudentsScreen").default}    options={{ title: "Enr. Students" , headerShown: true }} />
    <Stack.Screen name="Attendance" getComponent={() => require("../screens/StudentActions/AttendanceScreen").default}    options={{ title: "Attendance", headerShown: true  }} />
    <Stack.Screen name="Enrollment"       getComponent={() => require("../screens/StudentActions/EnrollmentScreen").default}          options={{ title: "Enrollment"     }} />
    <Stack.Screen name="StudentProfile"   getComponent={() => require("../screens/StudentActions/StudentProfileScreen").default}      options={{ title: "Profile"        }} />
    <Stack.Screen name="StudentFee"       getComponent={() => require("../screens/Finance/StudentFeeScreen").default}                 options={{ title: "Student Fee" , headerShown: true   }} />
    <Stack.Screen name="FeeDemandSlip"    getComponent={() => require("../screens/Finance/FeeDemandSlipScreen").default}              options={{ title: "Demand Slip", headerShown: false}} />
    <Stack.Screen name="FeeCollectionApproval" getComponent={() => require("../screens/Finance/FeeCollectionApprovalScreen").default} options={{ title: "Approve Collection", headerShown: true }} />
    <Stack.Screen name="FeeItem"          getComponent={() => require("../screens/Finance/FeeItemScreen").default}                    options={{ title: "Fee Item"       }} />
    <Stack.Screen name="FeeCollection"    getComponent={() => require("../screens/Finance/FeeCollectionScreen").default}              options={{ title: "Fee Collection" }} />
    <Stack.Screen name="BranchSetup"      getComponent={() => require("../screens/Setup/BranchSetupScreen").default}                 options={{ title: "Branch"         }} />
    <Stack.Screen name="ClassSetup"       getComponent={() => require("../screens/Setup/ClassSetupScreen").default}                   options={{ title: "Class"          }} />
    <Stack.Screen name="SectionSetup"     getComponent={() => require("../screens/Setup/SectionSetupScreen").default}                 options={{ title: "Section"        }} />
    <Stack.Screen name="SubjectTeacher"   getComponent={() => require("../screens/Staff/SubjectTeacherScreen").default}   options={{ title: "Subject Teachers" }} />
    <Stack.Screen name="TransportEnrollment"   getComponent={() => require("../screens/Transport/TransportEnrollmentScreen").default}   options={{ title: "Transport Enrollment" }} />

    {/* Teacher screens reachable from Students */}
    <Stack.Screen name="HiringPending" getComponent={() => require("../screens/Staff/HiringPendingScreen").default}  options={{ title: "Hiring Review", headerShown: true }}/>
    <Stack.Screen name="HiredStaff"   getComponent={() => require("../screens/Staff/HiredStaffScreen").default} options={{ title: "Hired Staff", headerShown: true }}/>
    <Stack.Screen name="StaffRegistration"   getComponent={() => require("../screens/Staff/StaffRegistrationScreen").default} options={{ title: "Staff Registration", headerShown: true }}/>
 
    {/* <Stack.Screen name="UserSetup"        getComponent={() => require("../screens/Setup/UserSetupScreen").default}                    options={{ title: "User Setup"     }} /> */}
    <Stack.Screen name="StudentIdCard"    getComponent={() => require("../screens/StudentActions/StudentIdCardScreen").default}   options={{ title: "ID Card",    headerShown: false }} />
    <Stack.Screen name="StudentIdCardV2"  getComponent={() => require("../screens/StudentActions/StudentIdCardV2Screen").default} options={{ title: "ID Cards V2", headerShown: false }} />
    <Stack.Screen name="HostelBuildings" getComponent={() => require("../screens/Hostel/HostelBuildingScreen").default} />
    <Stack.Screen name="HostelRooms"     getComponent={() => require("../screens/Hostel/HostelRoomScreen").default} />
    <Stack.Screen name="HostelSeats"     getComponent={() => require("../screens/Hostel/HostelRoomSeatScreen").default} />
 
    {/* Examinations */}
    <Stack.Screen name="QuickTestSetup" getComponent={() => require("../screens/Exams/QuickTestSetupScreen").default} options={{ title: "Quick Test Setup", headerShown: false }} />
    <Stack.Screen name="Exam"  getComponent={() => require("../screens/Exams/ExamScreen").default}              options={{ title: "Exams" }} />
    <Stack.Screen name="AddMarks" getComponent={() => require("../screens/Exams/AddMarksScreen").default}           options={{ title: "Add Marks" }} />
    <Stack.Screen name="GenerateMarksheet" getComponent={() => require("../screens/Exams/GenerateMarksheetScreen").default} options={{ title: "Marksheet" }} />
    <Stack.Screen name="ExamResultsRank"   getComponent={() => require("../screens/Exams/ExamResultsRankScreen").default}   options={{ title: "Exam Rankings" }} />
    <Stack.Screen name="StudentMarks"      getComponent={() => require("../screens/Exams/StudentMarksScreen").default}        options={{ title: "Student Marks", headerShown: false }} />
    
    <Stack.Screen name="StudentDiscount"
  getComponent={() => require("../screens/Finance/StudentDiscountScreen").default}
  options={{ title: "Student Discounts" }} />

    {/* Date Sheets */}
    <Stack.Screen name="ExamDatesheet" getComponent={() => require("../screens/Exams/ExamDatesheetScreen").default} options={{ headerShown: false }} />
    <Stack.Screen name="MyDatesheet"   getComponent={() => require("../screens/Exams/MyDatesheetScreen").default}   options={{ headerShown: false }} />

    {/* Homework */}
    <Stack.Screen name="Homework"     getComponent={() => require("../screens/StudentActions/HomeworkCreateScreen").default}  options={{ title: "Homework",         headerShown: false }} />
    <Stack.Screen name="HomeworkMark" getComponent={() => require("../screens/StudentActions/HomeworkMarkScreen").default}    options={{ title: "Mark Students",    headerShown: false }} />
    <Stack.Screen name="MyHomework"   getComponent={() => require("../screens/StudentActions/HomeworkStudentScreen").default} options={{ title: "My Homework",      headerShown: false }} />

    {/* Student / Parent user account management (admin/owner only) */}
    <Stack.Screen name="StudentUserAccounts" getComponent={() => require("../screens/StudentActions/StudentUserAccountsScreen").default} options={{ title: "Student Accounts", headerShown: false }} />

    {/* Roll Numbers */}
    <Stack.Screen name="UpdateRollNumber" getComponent={() => require("../screens/StudentActions/UpdateRollNumberScreen").default} options={{ title: "Roll Numbers", headerShown: false }} />

    {/* Question Paper */}
    <Stack.Screen name="QuestionBank"    getComponent={() => require("../screens/Exams/QuestionBankScreen").default}      options={{ title: "Question Bank",   headerShown: true }} />
    <Stack.Screen name="AddEditQuestion" getComponent={() => require("../screens/Exams/AddEditQuestionScreen").default}   options={{ title: "Question",        headerShown: true }} />
    <Stack.Screen name="ImportQuestions" getComponent={() => require("../screens/Exams/ImportQuestionsScreen").default}   options={{ title: "Import Questions", headerShown: true }} />
    <Stack.Screen name="PaperList"       getComponent={() => require("../screens/Exams/PaperListScreen").default}      options={{ title: "Question Papers", headerShown: true }} />
    <Stack.Screen name="PaperHeader"     getComponent={() => require("../screens/Exams/PaperHeaderScreen").default}    options={{ title: "Paper Setup",     headerShown: true }} />
    <Stack.Screen name="PaperBuilder"    getComponent={() => require("../screens/Exams/PaperBuilderScreen").default}   options={{ title: "Paper Builder",   headerShown: true }} />
    <Stack.Screen name="PaperPreview"    getComponent={() => require("../screens/Exams/PaperPreviewScreen").default}   options={{ title: "Preview & Export",headerShown: true }} />

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
    <Stack.Screen name="LeaveTypes"    getComponent={() => require("../screens/Staff/LeaveTypesScreen").default}    options={{ headerShown: false }} />
  </Stack.Navigator>
);

export default StudentsStack;