/**
 * constants/RouteModules.js
 *
 * Which Roles & permissions module each menu screen belongs to. Menus hide a screen when the
 * signed-in person's role has no "view" access to its module (AuthContext.can). The server
 * enforces the same rules, so this only keeps menus tidy. Keep in sync with
 * src/Service/Permissions.php (MODULES).
 */
export const ROUTE_MODULES = {
  Registration: "students", StudentDirectory: "students", EnrolledStudents: "students", StudentsList: "students",
  StudentIdCard: "students", StudentIdCardV2: "students", StudentUserAccounts: "users", UpdateRollNumber: "students", Certificates: "students",
  Attendance: "attendance", AttendanceReport: "attendance",
  StudentLeave: "student_leave", ArrivalLog: "student_leave",
  Homework: "homework",
  Exam: "exams", ExamDatesheet: "exams", QuickTestSetup: "exams", AddMarks: "exams", GenerateMarksheet: "exams", ExamResultsRank: "exams",
  StudentMarks: "exams", ReportCards: "exams", ReportComments: "exams", ReportCardSetup: "exams", GradingScales: "exams",
  StudentDiscount: "fees", FeeDemandSlip: "fees", FeeCollectionApproval: "fees", FeeCollection: "fees", FeeItem: "fees",
  LeaveApproval: "staff", StaffRegistration: "staff", HiringPending: "staff", HiredStaff: "staff",
  SubjectTeacher: "timetable", LeaveTypes: "staff",
  // MyCheckIn / StaffLeave are self-service (own check-in, own leave) – always open.
  StaffAttendance: "staff_attendance", StaffAttendanceReport: "staff_attendance", OfficeCode: "staff_attendance",
  StaffCategory: "staff",
  Enrollment: "students", StudentProfile: "students", HomeworkMark: "homework",
  // Student record: parents/students are checked by the server (own children only)
  StudentRecord: "students", HealthAlerts: "health", DocumentExpiry: "students", StudentFields: "settings",
  // Parent–teacher meetings (MyMeetings is the parent portal screen – checked by the server)
  Meetings: "meetings", MeetingSession: "meetings", MeetingEdit: "meetings",
  // Reports & analytics (the server also limits each tab to Attendance / Exams / Fees access)
  Analytics: "analytics", AnalyticsSettings: "analytics",
  // Exam halls, seating & admit cards (MyAdmitCard / MyExamDuties are self-service – checked by the server)
  ExamLogistics: "exam_logistics", ExamHalls: "exam_logistics", SeatingPlan: "exam_logistics", Invigilation: "exam_logistics", AdmitCards: "exam_logistics",
  // Exams: question bank, papers, online tests (staff side)
  QuestionBank: "exams", AddEditQuestion: "exams", ImportQuestions: "exams", ChapterManage: "exams",
  PaperList: "exams", PaperHeader: "exams", PaperBuilder: "exams", PaperPreview: "exams",
  TestSeriesManage: "exams", TestManage: "exams", TestCreate: "exams", TestQuestionPicker: "exams", TestAnalysis: "exams",
  // Fees
  StudentFee: "fees", StudentFeeTransport: "fees", HostelFee: "fees", ClassFeeStructure: "fees",
  HostelFeeStructure: "fees", TransportFeeStructure: "fees", OnlinePayments: "fees",
  // Hostel / transport (the tab and its screens)
  Hostel: "hostel", HostelHome: "hostel", HostelBuildings: "hostel", HostelRooms: "hostel", HostelSeats: "hostel",
  HostelRegistration: "hostel", HostelEnrollment: "hostel", HostelEnrolledStudents: "hostel",
  Transport: "transport", TransportEnrollment: "transport", BusFleet: "transport",   // DriverTrip / LiveBus: checked by the server
  // School setup
  SchoolSettings: "settings", RegionFormats: "settings", NotificationSettings: "settings", IdCardSettings: "settings", InstituteDetails: "settings", BranchSetup: "settings",
  SessionSetup: "settings", ClassSetup: "settings", SectionSetup: "settings", UserSetup: "users",
  SubjectSetup: "timetable", ClassSubject: "timetable", SubjectMaxMarks: "timetable", PeriodSetup: "timetable",
  Timetable: "timetable", TeacherTimetable: "timetable", MasterTimetable: "timetable",
  // Teacher cover (MyCovers is self-service – checked by the server)
  Cover: "timetable",
  // Visitors & safe pick-up (MyVisitors / MyPickup are self-service – checked by the server)
  VisitorDesk: "safety", PickupDesk: "safety", PickupPersons: "safety", SafetySettings: "safety",
  // Notices, events & gallery
  NoticeBoard: "notices", SchoolMemories: "notices", SchoolMemoriesAdmin: "notices",
  // Security & privacy screens check their own access
};

/** The "approve"-type screens need approve access, not just view. */
export const ROUTE_KIND = {
  LeaveApproval: "approve", FeeCollectionApproval: "approve", StaffRegistration: "edit", Registration: "edit",
  AddMarks: "edit", FeeCollection: "edit", DocumentExpiry: "edit", MeetingEdit: "edit",
  SafetySettings: "approve",
};
