/**
 * constants/RouteFeatures.js
 *
 * Which plan feature each screen (route name) belongs to. Used by
 * components/FeatureGate.js to show a "not included in your plan" screen
 * INSTEAD of opening a locked screen (so it never calls the locked API).
 *
 * Only subscription (international) schools are gated. Indian (legacy)
 * schools always pass. Screens not listed here are free ('core').
 * Keep this in sync with src/Service/Entitlements.php on the server.
 */
export const ROUTE_FEATURES = {
  // Attendance
  Attendance: "attendance", AttendanceReport: "attendance", MyAttendance: "attendance",

  // Notice board & events
  NoticeBoard: "notices",

  // Fees
  StudentFee: "fees", FeeDemandSlip: "fees", FeeCollectionApproval: "fees", FeeItem: "fees",
  FeeCollection: "fees", StudentDiscount: "fees", ClassFeeStructure: "fees", MyFee: "fees",

  // Exams & results
  QuickTestSetup: "exams", Exam: "exams", AddMarks: "exams", GenerateMarksheet: "exams",
  ExamResultsRank: "exams", StudentMarks: "exams", ExamDatesheet: "exams", MyDatesheet: "exams",
  MyMarksheet: "exams", SubjectMaxMarks: "exams",

  // Timetable, homework & leave
  PeriodSetup: "academics", Timetable: "academics", TeacherTimetable: "academics",
  MasterTimetable: "academics", Homework: "academics", HomeworkMark: "academics",
  MyHomework: "academics", StaffLeave: "academics", LeaveApproval: "academics", LeaveTypes: "academics",

  // Question bank & test series
  ChapterManage: "assessments", QuestionBank: "assessments", AddEditQuestion: "assessments",
  ImportQuestions: "assessments", PaperList: "assessments", PaperHeader: "assessments",
  PaperBuilder: "assessments", PaperPreview: "assessments", TestSeriesManage: "assessments",
  TestManage: "assessments", TestCreate: "assessments", TestQuestionPicker: "assessments",
  MyTestSeries: "assessments", TestLobby: "assessments", TestAttempt: "assessments",
  TestResult: "assessments", TestAnalysis: "assessments", TestLeaderboard: "assessments",

  // Hostel (tab + every hostel screen)
  Hostel: "hostel", HostelHome: "hostel", HostelBuildings: "hostel", HostelRooms: "hostel",
  HostelSeats: "hostel", HostelRegistration: "hostel", HostelEnrollment: "hostel",
  HostelEnrolledStudents: "hostel", HostelFeeStructure: "hostel", HostelFee: "hostel",

  // Transport (tab + screens)
  Transport: "transport", TransportEnrollment: "transport", TransportFeeStructure: "transport",
  StudentFeeTransport: "transport",

  // Chat, gallery, certificates, ID cards
  ChatList: "communication", Chat: "communication", Certificates: "communication",
  StudentIdCard: "communication", StudentIdCardV2: "communication", IdCardSettings: "communication",
  SchoolMemories: "communication", SchoolMemoriesAdmin: "communication",
};

export const FEATURE_LABELS = {
  attendance:    "Attendance",
  notices:       "Notice Board & Events",
  fees:          "Fees",
  exams:         "Exams & Results",
  academics:     "Timetable, Homework & Leave",
  assessments:   "Question Bank & Test Series",
  hostel:        "Hostel",
  transport:     "Transport",
  communication: "Chat, Gallery, Certificates & ID Cards",
};
