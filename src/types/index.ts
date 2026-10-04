export interface Course {
  course_id: string;
  class_no: string;
  course_nm: string;
  prof_nm?: string;
  alarm_count?: number;
}

export interface AssignmentItem {
  id: string;
  courseId: string;
  courseNm: string;
  title: string;
  deadlineStr: string;
  deadlineDate: string | null;
  statusInfo: string;
  isSubmitted: boolean;
  ddayBadgeText: string;
  badgeType: 'urgent' | 'warning' | 'done' | 'normal';
  timeLeftText: string;
  scoreText: string;
  description: string;
}

export interface LectureItem {
  id: string;
  courseId: string;
  courseNm: string;
  title: string;
  periodStr: string;
  statusInfo: string;
  isAttended: boolean;
  timeStr: string;
  progressPercent: number;
}

export interface NoticeItem {
  id: string;
  courseId: string;
  courseNm: string;
  boardNo: string;
  boardItemNo: string;
  title: string;
  author: string;
  dateStr: string;
  isUrgent: boolean;
  summaryLines: string[];
  fullBody: string;
  attachments: string[];
}

export interface TodoListResult {
  assignments: AssignmentItem[];
  lectures: LectureItem[];
  quizzes: AssignmentItem[];
  notices: NoticeItem[];
}

export interface UserConfig {
  userId: string;
  userPw: string;
  geminiApiKey: string;
  discordWebhookUrl: string;
  pushNotificationsEnabled: boolean;
  ddayReminderEnabled: boolean;
  threeHourReminderEnabled: boolean;
  syncIntervalMinutes: number;
  autoLogin: boolean;
  rememberId?: boolean;
  useGeminiSummary?: boolean;
  backgroundSyncEnabled?: boolean;
}

export interface GradeSubject {
  subjCode: string;
  subjNm: string;
  compDiv: string;
  credits: number;
  grade: string;
  gpaPoint?: number;
  retake?: boolean; // 재수강 대상(COPL_CNFI_GBCD) — 졸업학점에서 제외
  parenthesizedCredit?: boolean; // 괄호 학점 "(0)" — 졸업학점 미산입
}

export interface SemesterGrade {
  year: string;
  semester: string;
  appliedCredits: number;
  acquiredCredits: number;
  semesterGpa: number;
  percentile?: number;
  subjects: GradeSubject[];
}

export interface GradeSummary {
  totalAppliedCredits: number;
  totalAcquiredCredits: number;
  totalGpa: number;
  totalPercentile?: number;
  semesters: SemesterGrade[];
}

export interface TimetableItem {
  id: string;
  dayOfWeek: number; // 1: 월, 2: 화, 3: 수, 4: 목, 5: 금, 6: 토
  dayName: string;
  startTime: string; // e.g. "11:00"
  endTime: string; // e.g. "12:15"
  startMinutes: number; // e.g. 660
  endMinutes: number; // e.g. 735
  durationMinutes: number; // e.g. 75
  timeStr: string; // e.g. "11:00 - 12:15"
  subjectNm: string;
  profNm: string;
  classroom: string;
  colorIndex?: number;
  period?: number;
  unscheduled?: boolean; // 수업 시간 미지정 과목 (예: "(:~:)") — dayOfWeek 0, 그리드에 표시하지 않음
}

export interface GraduationRequiredCourse {
  name: string; // 과목/요건명 (예: 채플, 글쓰기의기초, 비교과프로그램)
  category: string; // 교양필수 / 주전공필수 / 비교과필수
  completedCount: number | null; // 이수 과목 수 (TOT)
  earned: string; // 이수 학점 또는 점수 (PNT, 예: "1.5", "2학기125")
  unit: string; // 과목 / 점
  note: string; // 적용 대상 안내 (예: "2023학번부터(편입생 면제)")
}

export interface GraduationDiagnosis {
  totalRequiredCredits: number;
  totalAcquiredCredits: number;
  majorRequiredCredits: number;
  majorAcquiredCredits: number;
  generalRequiredCredits: number;
  generalAcquiredCredits: number;
  otherAcquiredCredits: number;
  status: 'in_progress' | 'satisfied' | 'insufficient';
  completionPercent: number;
  note?: string;
  generalMaxCredits?: number; // 교양 최대 인정학점 (초과분은 졸업학점 미인정)
  commonRequiredCredits?: number; // 계열공통 기준학점 (2023학번부터)
  commonAcquiredCredits?: number;
  ruleText?: string; // 종합정보 졸업기준 안내 (DAN)
  multiMajorText?: string; // 다전공 기준 안내 (BOK)
  requiredCourses?: GraduationRequiredCourse[];
  creditsComputed?: boolean; // 성적 데이터로 취득학점을 계산했는지 여부
}

export interface AcademicData {
  lastUpdated: string | null;
  gradeSummary: GradeSummary | null;
  timetable: TimetableItem[];
  graduation: GraduationDiagnosis | null;
}

export interface AppStateData {
  lastSyncTime: string | null;
  courses: Course[];
  assignments: AssignmentItem[];
  lectures: LectureItem[];
  notices: NoticeItem[];
  seenItemKeys: string[];
  sentReminders: Record<string, string[]>;
  readNoticeIds?: string[]; // 사용자가 열어봤거나 '모두 읽음' 처리한 공지 ID
  academicData?: AcademicData;
}

