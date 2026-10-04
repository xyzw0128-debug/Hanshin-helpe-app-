import {
  AcademicData,
  GradeSummary,
  SemesterGrade,
  GradeSubject,
  TimetableItem,
  GraduationDiagnosis,
} from '../types';
import { NexacroClient, NexacroResult, unescapeXml } from './nexacroClient';
import { HsctisAuthService } from './hsctisAuth';
import { LmsAuthService } from './lmsAuth';

function safeBtoa(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return typeof Buffer !== 'undefined' ? Buffer.from(str).toString('base64') : btoa(str);
  }
}

function parseCredits(pntStr: any): number {
  if (pntStr === undefined || pntStr === null) return 0;
  const cleaned = String(pntStr).replace(/[()]/g, '').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function mapCompDiv(rawCodeOrName: string): string {
  if (!rawCodeOrName) return '전공';
  const val = unescapeXml(rawCodeOrName).trim();
  const codeMap: Record<string, string> = {
    '01': '교필',
    '02': '교선',
    '03': '전필',
    '04': '전선',
    '05': '일선',
    '11': '교필',
    '12': '교선',
    '21': '전필',
    '22': '전선',
    '31': '일선',
  };
  return codeMap[val] || val;
}

const DAY_NAMES = ['', '월', '화', '수', '목', '금', '토'];

function normalizeSubjectName(subjectNm: string): string {
  return (subjectNm || '').replace(/\s+/g, '').replace(/\([^)]*\)/g, '').toLowerCase();
}

// 종합정보 메뉴 코드 (cs/init/user 메뉴 목록 HAR 기준)
const MENU_GRADES = '1487'; // 전체성적조회 (um72_0272005_m)
const MENU_TIMETABLE = '2430'; // 수강신청및시간표조회 (ul72_0272017_m)
const MENU_GRADUATION = '1486'; // 교양및전공필수이수현황 (um72_0272004_m)

/**
 * 현재 조회할 학년도/학기 (1월은 전년도 2학기, 2~7월 1학기, 8~12월 2학기)
 */
function resolveCurrentTerm(year?: string, semester?: string): { year: string; semester: string } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const defaultYear = month === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultSemester = month >= 2 && month <= 7 ? '1' : '2';
  return { year: year || String(defaultYear), semester: semester || defaultSemester };
}

// 에브리타임 업로드 이미지 과목 기준 일치 매핑
const KNOWN_SUBJECT_COLORS: Record<string, number> = {
  '자율지능iot시스템': 0, // 살몬 코랄 (#ee7968)
  '데이터베이스': 1,       // 머스타드 앰버 (#ecb559)
  '데이터베이스시스템': 1, // 머스타드 앰버 (#ecb559)
  '논리회로': 2,           // 올리브 그린 (#9dc462)
  '인지감성ai에이전트': 3, // 민트 틸 (#6bc8ba)
  '운영체제': 4,           // 소프트 퍼플 (#9782e0)
  '채플': 5,               // 스카이 블루 (#709ee8)
  '1인미디어만들기': 6,     // 웜 오렌지 (#fca15d)
};

/**
 * 과목명 해시 기반 고유 컬러 인덱스 도출
 * (8색 파스텔/비비드 팔레트와 1:1 매핑)
 */
export function getSubjectColorIndex(subjectNm: string, paletteSize: number = 8): number {
  if (!subjectNm) return 0;
  const normalized = normalizeSubjectName(subjectNm);

  if (KNOWN_SUBJECT_COLORS[normalized] !== undefined) {
    return KNOWN_SUBJECT_COLORS[normalized];
  }

  // 31-bit string hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % paletteSize;
}

/**
 * 시간표 과목별 색상을 서로 겹치지 않게 배정
 * 고정 매핑 과목 → 해시 선호 색상 순으로 배정하고, 이미 쓰인 색이면 다음 빈 색으로 이동 (과목명 정렬 기준이라 결정론적)
 */
export function assignDistinctSubjectColors<T extends { subjectNm: string; colorIndex?: number }>(
  items: T[],
  paletteSize: number = 8
): T[] {
  const subjects = Array.from(new Set(items.map(it => normalizeSubjectName(it.subjectNm)))).sort();
  const known = subjects.filter(n => KNOWN_SUBJECT_COLORS[n] !== undefined);
  const others = subjects.filter(n => KNOWN_SUBJECT_COLORS[n] === undefined);
  const used = new Set<number>();
  const assigned = new Map<string, number>();

  for (const n of [...known, ...others]) {
    const preferred = getSubjectColorIndex(n, paletteSize);
    let idx = preferred;
    if (used.size < paletteSize) {
      for (let step = 0; step < paletteSize && used.has(idx); step++) {
        idx = (preferred + step + 1) % paletteSize;
      }
    }
    used.add(idx);
    assigned.set(n, idx);
  }

  return items.map(it => {
    const idx = assigned.get(normalizeSubjectName(it.subjectNm));
    return idx === undefined ? it : { ...it, colorIndex: idx };
  });
}

/**
 * 한신대학교 공식 75분 수업 + 15분 휴식 교시 체계 (09:30 시작)
 */
export const PERIOD_TIMES: Record<number, string> = {
  1: '09:30 - 10:45', // 1교시 (1블록)
  2: '11:00 - 12:15', // 2교시 (2블록)
  3: '13:00 - 14:15', // 3교시 (3블록)
  4: '14:30 - 15:45', // 4교시 (4블록)
  5: '16:00 - 17:15', // 5교시 (5블록)
  6: '17:30 - 18:45', // 6교시 (야간 1블록)
  7: '19:00 - 20:15', // 7교시 (야간 2블록)
  8: '20:30 - 21:45', // 8교시 (야간 3블록)
  9: '22:00 - 23:15', // 9교시 (야간 4블록)
  10: '18:00 - 19:15', // 10교시 (야간 레거시 매핑)
  11: '19:25 - 20:40', // 11교시 (야간 레거시 매핑)
  12: '20:50 - 22:05', // 12교시 (야간 레거시 매핑)
  13: '22:15 - 23:30', // 13교시 (야간 레거시 매핑)
  14: '23:40 - 00:55', // 14교시 (야간 레거시 매핑)
};

export interface ScheduleSlot {
  dayOfWeek: number;
  dayName: string;
  period: number;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  timeStr: string;
}

export function resolveTimeFields(
  timeStr?: string,
  period?: number
): {
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  timeStr: string;
} {
  if (timeStr) {
    const match = /(\d{1,2}):(\d{2})\s*[~–—\-∼〜]\s*(\d{1,2}):(\d{2})/.exec(timeStr);
    if (match) {
      const startH = parseInt(match[1], 10);
      const startM = parseInt(match[2], 10);
      const endH = parseInt(match[3], 10);
      const endM = parseInt(match[4], 10);
      const startMinutes = startH * 60 + startM;
      let endMinutes = endH * 60 + endM;
      if (endMinutes < startMinutes) {
        // 자정을 넘기는 수업 (e.g. 23:40 ~ 00:55)
        endMinutes += 24 * 60;
      }
      const durationMinutes = endMinutes - startMinutes;
      const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
      const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      return {
        startTime,
        endTime,
        startMinutes,
        endMinutes,
        durationMinutes,
        timeStr: `${startTime} - ${endTime}`,
      };
    }
  }

  const p = period || 1;
  if (PERIOD_TIMES[p]) {
    return resolveTimeFields(PERIOD_TIMES[p], p);
  }

  const startMinutes = (8 + p) * 60;
  const endMinutes = startMinutes + 75;
  const startH = Math.floor(startMinutes / 60) % 24;
  const startM = startMinutes % 60;
  const endH = Math.floor(endMinutes / 60) % 24;
  const endM = endMinutes % 60;
  const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
  const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  return {
    startTime,
    endTime,
    startMinutes,
    endMinutes,
    durationMinutes: 75,
    timeStr: `${startTime} - ${endTime}`,
  };
}

export class HsctisScraperService {
  /**
   * 실제 학번(USER_ID)을 HsctisAuthService 또는 입력값에서 안전하게 추출
   */
  private static resolveStudentNo(userId?: string): string {
    const studentNo = HsctisAuthService.getStudentNo();
    if (studentNo && /^\d+$/.test(studentNo)) {
      return studentNo;
    }
    const lmsUser = LmsAuthService.getUserNo();
    if (lmsUser && /^\d+$/.test(lmsUser)) {
      return lmsUser;
    }
    if (userId && /^\d+$/.test(userId)) {
      return userId;
    }
    return studentNo || lmsUser || userId || HsctisAuthService.getLoggedInUser();
  }

  /**
   * 1. 성적/학점 조회 서비스 (um72_0272005)
   */
  public static async getGrades(userId?: string): Promise<GradeSummary> {
    const activeUser = this.resolveStudentNo(userId);
    if (!activeUser) {
      throw new Error('학번 정보가 없습니다. 다시 로그인해주세요.');
    }

    const transInfo = [
      { id: 'select', recvDataset: 'ds_main', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.select', fileOptions: null },
      { id: 'selectSmstScre', recvDataset: 'ds_smst', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.selectSmstScre', fileOptions: null },
      { id: 'selectSubj', recvDataset: 'ds_subj', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.selectSubj', fileOptions: null },
      { id: 'selectToal', recvDataset: 'ds_sub', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.selectToal', fileOptions: null },
    ];

    await NexacroClient.initMenu(MENU_GRADES);

    const result: NexacroResult = await NexacroClient.postService('um72_0272005', {
      variables: {
        TRANS_INFO: JSON.stringify(transInfo),
        SYSTEM_MENU_CD: MENU_GRADES,
        SYSTEM_LOGGING: 'Y',
        SYSTEM_CHECK_SCHE: 'N',
        crypto_STD_NO: safeBtoa(activeUser),
      },
    });

    return this.parseGradesData(result);
  }

  /** initMenu가 이미 호출된 후 사용하는 내부 전용 메서드 */
  private static async getGradesAfterInit(userId?: string): Promise<GradeSummary> {
    const activeUser = this.resolveStudentNo(userId);
    if (!activeUser) {
      throw new Error('학번 정보가 없습니다. 다시 로그인해주세요.');
    }

    const transInfo = [
      { id: 'select', recvDataset: 'ds_main', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.select', fileOptions: null },
      { id: 'selectSmstScre', recvDataset: 'ds_smst', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.selectSmstScre', fileOptions: null },
      { id: 'selectSubj', recvDataset: 'ds_subj', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.selectSubj', fileOptions: null },
      { id: 'selectToal', recvDataset: 'ds_sub', sqlId: 'kr.co.codefarm.svcm.um.um72_0272005.selectToal', fileOptions: null },
    ];

    const result: NexacroResult = await NexacroClient.postService('um72_0272005', {
      variables: {
        TRANS_INFO: JSON.stringify(transInfo),
        SYSTEM_MENU_CD: MENU_GRADES,
        SYSTEM_LOGGING: 'Y',
        SYSTEM_CHECK_SCHE: 'N',
        crypto_STD_NO: safeBtoa(activeUser),
      },
    });

    return this.parseGradesData(result);
  }

  /**
   * 2. 주간 강의시간표 조회 서비스 (ul72_0272017)
   */
  public static async getTimetable(
    userId?: string,
    year?: string,
    semester?: string
  ): Promise<TimetableItem[]> {
    const activeUser = this.resolveStudentNo(userId);
    if (!activeUser) {
      throw new Error('학번 정보가 없습니다. 다시 로그인해주세요.');
    }

    const { year: currentYear, semester: defaultSmtr } = resolveCurrentTerm(year, semester);

    const transInfo = [
      { id: 'select', recvDataset: 'ds_main', sqlId: 'kr.co.codefarm.svcm.ul.ul72_0272017.select', fileOptions: null },
    ];

    await NexacroClient.initMenu(MENU_TIMETABLE);

    const result: NexacroResult = await NexacroClient.postService('ul72_0272017', {
      variables: {
        TRANS_INFO: JSON.stringify(transInfo),
        SYSTEM_MENU_CD: MENU_TIMETABLE,
        SYSTEM_LOGGING: 'Y',
        SYSTEM_CHECK_SCHE: 'N',
        crypto_SHYR: safeBtoa(currentYear),
        crypto_SMST_GBCD: safeBtoa(defaultSmtr),
        crypto_STD_NO: safeBtoa(activeUser),
      },
    });

    return this.parseTimetableData(result);
  }

  private static async getTimetableAfterInit(
    userId?: string,
    year?: string,
    semester?: string
  ): Promise<TimetableItem[]> {
    const activeUser = this.resolveStudentNo(userId);
    if (!activeUser) {
      throw new Error('학번 정보가 없습니다. 다시 로그인해주세요.');
    }

    const { year: currentYear, semester: defaultSmtr } = resolveCurrentTerm(year, semester);

    const transInfo = [
      { id: 'select', recvDataset: 'ds_main', sqlId: 'kr.co.codefarm.svcm.ul.ul72_0272017.select', fileOptions: null },
    ];

    const result: NexacroResult = await NexacroClient.postService('ul72_0272017', {
      variables: {
        TRANS_INFO: JSON.stringify(transInfo),
        SYSTEM_MENU_CD: MENU_TIMETABLE,
        SYSTEM_LOGGING: 'Y',
        SYSTEM_CHECK_SCHE: 'N',
        crypto_SHYR: safeBtoa(currentYear),
        crypto_SMST_GBCD: safeBtoa(defaultSmtr),
        crypto_STD_NO: safeBtoa(activeUser),
      },
    });

    return this.parseTimetableData(result);
  }

  /**
   * 3. 졸업사정 학점 진단 서비스 (um72_0272004)
   */
  public static async getGraduationDiagnosis(userId?: string): Promise<GraduationDiagnosis> {
    const activeUser = this.resolveStudentNo(userId);
    if (!activeUser) {
      throw new Error('학번 정보가 없습니다. 다시 로그인해주세요.');
    }

    const transInfo = [
      { id: 'selectGrdtnPnt', recvDataset: 'ds_grdtnPnt', sqlId: 'kr.co.codefarm.svcm.um.um72_0272004.selectGrdtnPnt', fileOptions: null },
      { id: 'selectCltrEsse', recvDataset: 'ds_cltrEsse', sqlId: 'kr.co.codefarm.svcm.um.um72_0272004.selectCltrEsse', fileOptions: null },
    ];

    await NexacroClient.initMenu(MENU_GRADUATION);

    const result: NexacroResult = await NexacroClient.postService('um72_0272004', {
      variables: {
        TRANS_INFO: JSON.stringify(transInfo),
        SYSTEM_MENU_CD: MENU_GRADUATION,
        SYSTEM_LOGGING: 'Y',
        SYSTEM_CHECK_SCHE: 'N',
        crypto_STD_NO: safeBtoa(activeUser),
      },
    });

    return this.parseGraduationData(result);
  }

  private static async getGraduationDiagnosisAfterInit(userId?: string): Promise<GraduationDiagnosis> {
    const activeUser = this.resolveStudentNo(userId);
    if (!activeUser) {
      throw new Error('학번 정보가 없습니다. 다시 로그인해주세요.');
    }

    const transInfo = [
      { id: 'selectGrdtnPnt', recvDataset: 'ds_grdtnPnt', sqlId: 'kr.co.codefarm.svcm.um.um72_0272004.selectGrdtnPnt', fileOptions: null },
      { id: 'selectCltrEsse', recvDataset: 'ds_cltrEsse', sqlId: 'kr.co.codefarm.svcm.um.um72_0272004.selectCltrEsse', fileOptions: null },
    ];

    const result: NexacroResult = await NexacroClient.postService('um72_0272004', {
      variables: {
        TRANS_INFO: JSON.stringify(transInfo),
        SYSTEM_MENU_CD: MENU_GRADUATION,
        SYSTEM_LOGGING: 'Y',
        SYSTEM_CHECK_SCHE: 'N',
        crypto_STD_NO: safeBtoa(activeUser),
      },
    });

    return this.parseGraduationData(result);
  }

  /**
   * 종합정보 전체 학사 데이터 조회 및 통합
   * 넥사크로 세션 메뉴 컨텍스트의 충돌/레이스 컨디션을 방지하기 위해 순차적으로 안정적 수집
   */
  public static async getAllAcademicData(userId?: string): Promise<AcademicData> {
    const activeUser = userId || HsctisAuthService.getLoggedInUser();

    // 3개 메뉴 컨텍스트를 동시 초기화 (병렬)
    await Promise.all([
      NexacroClient.initMenu(MENU_GRADES),
      NexacroClient.initMenu(MENU_TIMETABLE),
      NexacroClient.initMenu(MENU_GRADUATION),
    ]);

    // 3개 서비스를 동시 호출 (병렬) — initMenu는 이미 완료되었으므로 캐시 히트
    const [gradesResult, timetableResult, graduationResult] = await Promise.allSettled([
      this.getGradesAfterInit(activeUser),
      this.getTimetableAfterInit(activeUser),
      this.getGraduationDiagnosisAfterInit(activeUser),
    ]);

    const gradeSummary = gradesResult.status === 'fulfilled' ? gradesResult.value : null;
    const timetable = timetableResult.status === 'fulfilled' ? timetableResult.value : [];
    // 졸업 기준(서버) + 이수구분별 취득학점(성적 데이터) 합산
    const graduation =
      graduationResult.status === 'fulfilled'
        ? this.applyGradesToGraduation(graduationResult.value, gradeSummary)
        : null;

    if (gradesResult.status === 'rejected') console.warn('Failed to fetch grades', gradesResult.reason);
    if (timetableResult.status === 'rejected') console.warn('Failed to fetch timetable', timetableResult.reason);
    if (graduationResult.status === 'rejected') console.warn('Failed to fetch graduation', graduationResult.reason);

    // 전부 실패한 경우 에러를 throw하여 기존 데이터 보존
    if (!gradeSummary && timetable.length === 0 && !graduation) {
      throw new Error('종합정보시스템 데이터를 조회할 수 없습니다. 네트워크 또는 인증 상태를 확인해주세요.');
    }

    const now = new Date();
    const timeStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
      now.getDate()
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0'
    )}`;

    return {
      lastUpdated: timeStr,
      gradeSummary: gradeSummary || undefined,
      timetable: timetable || [],
      graduation: graduation || undefined,
    };
  }

  /**
   * 성적 응답 데이터셋 파싱
   */
  private static parseGradesData(result: NexacroResult): GradeSummary {
    const dsNames = Object.keys(result.datasets);
    const emptySummary: GradeSummary = {
      totalAppliedCredits: 0,
      totalAcquiredCredits: 0,
      totalGpa: 0,
      totalPercentile: 0,
      semesters: [],
    };

    if (dsNames.length === 0) {
      return emptySummary;
    }

    // 과목 상세 행인지 확인 (COURSE_NM, SUBJ_NM 등의 과목명 컬럼 포함 여부)
    const isSubjectRow = (row: any) =>
      Boolean(row && (row['COURSE_NM'] || row['SUBJ_NM'] || row['SUBJECT_NM'] || row['GWAMOK_NM']));

    // 1. 총괄 요약 데이터셋 탐색 (output4, ds_sub, ds_toal, ds_main, ds_summary 등)
    let totalAppliedCredits = 0;
    let totalAcquiredCredits = 0;
    let totalGpa = 0;
    let totalPercentile = 0;

    const hasSummaryColumns = (row: any) =>
      Boolean(
        row &&
          (row['RQST_PNT'] ||
            row['COPL_PNT'] ||
            row['REQ_PNT'] ||
            row['GET_PNT'] ||
            row['GRDTN_GENE_RAT_AVRG'] ||
            row['GPA'] ||
            row['TOT_GPA'])
      );

    const summaryCandidates = ['output4', 'ds_sub', 'ds_toal', 'ds_summary', 'ds_tot', 'ds_score'];
    let summaryDs: Array<Record<string, string>> | undefined;
    for (const name of summaryCandidates) {
      if (
        result.datasets[name] &&
        result.datasets[name].length > 0 &&
        !isSubjectRow(result.datasets[name][0]) &&
        hasSummaryColumns(result.datasets[name][0])
      ) {
        summaryDs = result.datasets[name];
        break;
      }
    }
    if (!summaryDs && dsNames.length > 0) {
      for (const name of dsNames) {
        if (
          name !== 'ds_main' &&
          name !== 'output1' &&
          result.datasets[name] &&
          result.datasets[name].length > 0 &&
          !isSubjectRow(result.datasets[name][0]) &&
          hasSummaryColumns(result.datasets[name][0])
        ) {
          summaryDs = result.datasets[name];
          break;
        }
      }
    }

    if (summaryDs && summaryDs.length > 0) {
      const row = summaryDs[0];
      totalAppliedCredits = parseCredits(
        row['RQST_PNT'] || row['REQ_PNT'] || row['APP_PNT'] || row['TOT_APP_PNT'] || 0
      );
      totalAcquiredCredits = parseCredits(
        row['COPL_PNT'] || row['GET_PNT'] || row['ACQ_PNT'] || row['TOT_GET_PNT'] || 0
      );
      totalGpa = Number(
        row['GRDTN_GENE_RAT_AVRG'] || row['GPA'] || row['AVG_MARK'] || row['TOT_GPA'] || 0
      );
      // 한신대 학사시스템에서 TOAL_SCOR는 백분율이 아닌 평점 총점(예: 164)이므로 제외
      const rawPercentile = Number(
        row['SCORE_100'] || row['AVG_SCORE'] || row['PERCENTILE'] || 0
      );
      if (rawPercentile > 0 && rawPercentile <= 100) {
        totalPercentile = rawPercentile;
      }
    }

    // 2. 학기별 평점 데이터셋 탐색 (output2, ds_smst)
    const semesterGradeMap = new Map<string, { applied: number; acquired: number; gpa: number; name: string }>();
    const smstCandidates = ['output2', 'ds_smst'];
    let smstDs: Array<Record<string, string>> | undefined;
    for (const name of smstCandidates) {
      if (result.datasets[name] && result.datasets[name].length > 0) {
        smstDs = result.datasets[name];
        break;
      }
    }

    if (smstDs) {
      for (const row of smstDs) {
        const year = row['SHYR'] || row['YEAR'] || '';
        const smstGb = row['SMST_GBCD'] || row['SMTR'] || '1';
        const semName = row['SHYR_SMST'] || `${year}-${smstGb}학기`;

        // 전체학기('Z') 또는 전체/총계/합계 요약 행인 경우 학기 목록에서 제외하되 요약 fallback으로 사용
        if (
          smstGb === 'Z' ||
          year === 'Z' ||
          semName.includes('전체') ||
          semName.includes('총계') ||
          semName.includes('합계')
        ) {
          if (totalAcquiredCredits === 0) {
            totalAppliedCredits = parseCredits(row['RQST_PNT'] || row['REQ_PNT'] || 0);
            totalAcquiredCredits = parseCredits(row['COPL_PNT'] || row['GET_PNT'] || 0);
            totalGpa = Number(row['COPL_RAT_AVRG'] || row['SMST_RAT_AVRG'] || 0);
          }
          continue;
        }

        const semKey = `${year}-${smstGb}`;
        if (year) {
          semesterGradeMap.set(semKey, {
            applied: parseCredits(row['RQST_PNT'] || row['SEM_REQ_PNT'] || 0),
            acquired: parseCredits(row['COPL_PNT'] || row['SEM_GET_PNT'] || 0),
            gpa: Number(row['SMST_RAT_AVRG'] || row['COPL_RAT_AVRG'] || row['SEM_GPA'] || 0),
            name: semName,
          });
        }
      }
    }

    // 3. 학기별 과목 상세 목록 탐색 (output3, ds_subj, ds_detail, ds_grade 등)
    let detailDs: Array<Record<string, string>> | undefined;
    const detailCandidates = ['output3', 'ds_subj', 'ds_detail', 'ds_grade', 'ds_list', 'ds_output'];
    for (const name of detailCandidates) {
      if (result.datasets[name] && result.datasets[name].length > 0 && isSubjectRow(result.datasets[name][0])) {
        detailDs = result.datasets[name];
        break;
      }
    }
    if (!detailDs) {
      for (const name of dsNames) {
        if (result.datasets[name] && result.datasets[name].length > 0 && isSubjectRow(result.datasets[name][0])) {
          detailDs = result.datasets[name];
          break;
        }
      }
    }

    const semesterMap = new Map<string, SemesterGrade>();

    if (detailDs) {
      for (const row of detailDs) {
        const year = row['SHYR'] || row['YEAR'] || row['SCH_YEAR'] || '';
        const smstGb = row['SMST_GBCD'] || row['SMTR'] || '1';
        const semester = row['SHYR_SMST'] || row['SMTR_NM'] || `${smstGb}학기`;
        const semKey = `${year}-${smstGb}`;

        if (!year) continue;

        if (!semesterMap.has(semKey)) {
          const semMeta = semesterGradeMap.get(semKey);
          semesterMap.set(semKey, {
            year,
            semester,
            appliedCredits: semMeta?.applied || parseCredits(row['SEM_REQ_PNT'] || 0),
            acquiredCredits: semMeta?.acquired || parseCredits(row['SEM_GET_PNT'] || 0),
            semesterGpa: semMeta?.gpa || Number(row['SEM_GPA'] || 0),
            percentile: Number(row['SEM_SCORE_100'] || 0),
            subjects: [],
          });
        }

        const semEntry = semesterMap.get(semKey)!;
        const rawSubjNm = row['COURSE_NM'] || row['SUBJ_NM'] || row['SUBJECT_NM'] || row['GWAMOK_NM'];
        const subjNm = unescapeXml(rawSubjNm || '');
        if (subjNm) {
          const rawPnt = row['PNT'] || row['POINT'] || row['CREDIT'] || '3';
          const credits = parseCredits(rawPnt);
          const rawGrade = unescapeXml(row['SCRE_GRAD_GBCD'] || row['GRD'] || row['GRADE'] || 'A+');
          const grade = rawGrade.trim();
          const gpaPoint = Number(row['GPA_POINT'] || row['MARK'] || this.gradeToGpa(grade));
          const rawComp = row['COPL_GBNM'] || row['COMP_DIV'] || row['CMPT_DIV_NM'] || row['COPL_GBCD'] || '전공';
          const compDiv = mapCompDiv(rawComp);

          // 재수강 대상(COPL_CNFI_GBCD="재수강")은 서버 총 취득학점에서 제외됨 (HAR: 과목합 50.5 vs COPL_PNT 47.5)
          const confirmFlag = unescapeXml(row['COPL_CNFI_GBCD'] || '').trim();
          semEntry.subjects.push({
            subjCode: unescapeXml(row['COURSE_CD'] || row['SUBJ_CD'] || row['SUBJECT_CD'] || ''),
            subjNm,
            compDiv,
            credits,
            grade,
            gpaPoint,
            retake: /재수강|포기|삭제/.test(confirmFlag),
            parenthesizedCredit: String(rawPnt).trim().startsWith('('),
          });
        }
      }
    }

    const semesters = Array.from(semesterMap.values());
    if (semesters.length === 0 && totalAcquiredCredits === 0) {
      return emptySummary;
    }

    // 학기별 취득학점 및 평점 보정
    for (const sem of semesters) {
      if (sem.subjects.length > 0) {
        let sumApplied = 0;
        let sumAcquired = 0;
        let sumGpaCredits = 0;
        let sumGradePoints = 0;

        for (const sub of sem.subjects) {
          sumApplied += sub.credits;
          if (this.isAcquiredGrade(sub.grade)) {
            sumAcquired += sub.credits;
          }
          if (sub.credits > 0 && this.isGpaBearingGrade(sub.grade)) {
            sumGpaCredits += sub.credits;
            sumGradePoints += (sub.gpaPoint || 0) * sub.credits;
          }
        }

        if (sem.appliedCredits === 0) sem.appliedCredits = sumApplied;
        if (sem.acquiredCredits === 0) sem.acquiredCredits = sumAcquired;
        if (sem.semesterGpa === 0 && sumGpaCredits > 0) {
          sem.semesterGpa = Number((sumGradePoints / sumGpaCredits).toFixed(2));
        }
      }
    }

    if (totalAcquiredCredits === 0 && semesters.length > 0) {
      totalAppliedCredits = semesters.reduce((acc, s) => acc + s.appliedCredits, 0);
      totalAcquiredCredits = semesters.reduce((acc, s) => acc + s.acquiredCredits, 0);

      let totalGpaPoints = 0;
      let totalGpaCredits = 0;
      for (const sem of semesters) {
        for (const sub of sem.subjects) {
          if (sub.credits > 0 && this.isGpaBearingGrade(sub.grade)) {
            totalGpaCredits += sub.credits;
            totalGpaPoints += (sub.gpaPoint || 0) * sub.credits;
          }
        }
      }
      totalGpa = totalGpaCredits > 0 ? Number((totalGpaPoints / totalGpaCredits).toFixed(2)) : 0;
    }

    return {
      totalAppliedCredits,
      totalAcquiredCredits,
      totalGpa,
      totalPercentile:
        totalPercentile && totalPercentile <= 100
          ? totalPercentile
          : totalGpa > 0
          ? Number((totalGpa * 20 + 10).toFixed(1))
          : 0,
      semesters: semesters.sort((a, b) => (b.year + b.semester).localeCompare(a.year + a.semester)),
    };
  }

  /**
   * 시작 시간(HH:mm) 기반 한신대 75분 교시 산출
   */
  public static getTimeSlotPeriod(startTime: string): number {
    const [hStr, mStr] = startTime.split(':');
    const totalMinutes = (parseInt(hStr, 10) || 0) * 60 + (parseInt(mStr, 10) || 0);

    if (totalMinutes < 615) return 1;       // < 10:15 -> 1교시 (09:30 - 10:45)
    if (totalMinutes < 720) return 2;       // 10:15 ~ 12:00 -> 2교시 (11:00 - 12:15)
    if (totalMinutes < 825) return 3;       // 12:00 ~ 13:45 -> 3교시 (13:00 - 14:15)
    if (totalMinutes < 915) return 4;       // 13:45 ~ 15:15 -> 4교시 (14:30 - 15:45)
    if (totalMinutes < 1005) return 5;      // 15:15 ~ 16:45 -> 5교시 (16:00 - 17:15)
    if (totalMinutes < 1095) return 6;      // 16:45 ~ 18:15 -> 6교시 (17:30 - 18:45)
    if (totalMinutes < 1185) return 7;      // 18:15 ~ 19:45 -> 7교시 (19:00 - 20:15)
    if (totalMinutes < 1275) return 8;      // 19:45 ~ 21:15 -> 8교시 (20:30 - 21:45)
    return 9;                               // >= 21:15 -> 9교시 (22:00 - 23:15)
  }

  /**
   * 한신대학교 시간표 요일 및 교시 ("화1,2,목3,4" 또는 "월요일(11:00~12:15)") 분해 파서
   */
  public static parseHanshinScheduleSlots(
    scheduleStr: string
  ): ScheduleSlot[] {
    const slots: ScheduleSlot[] = [];
    if (!scheduleStr || typeof scheduleStr !== 'string') return slots;

    const dayMap: Record<string, number> = {
      '월': 1,
      '화': 2,
      '수': 3,
      '목': 4,
      '금': 5,
      '토': 6,
    };

    // 1. 시간 기반 포맷: "월요일(11:00~12:15),수요일(09:30~10:45)", "월(11:00-12:15)", "월 11:00~12:15", "월[11:00 – 12:15]"
    const timeFormatRegex = /([월화수목금토])(?:요일)?\s*[\(\[]?\s*(\d{1,2}:\d{2})\s*[~–—\-∼〜]\s*(\d{1,2}:\d{2})\s*[\)\]]?/g;
    let timeMatch: RegExpExecArray | null;
    let hasTimeMatch = false;

    while ((timeMatch = timeFormatRegex.exec(scheduleStr)) !== null) {
      hasTimeMatch = true;
      const dayName = timeMatch[1];
      const dayOfWeek = dayMap[dayName] || 0;
      const startTime = timeMatch[2];
      const endTime = timeMatch[3];
      const timeFields = resolveTimeFields(`${startTime}~${endTime}`);
      const period = this.getTimeSlotPeriod(timeFields.startTime);

      slots.push({
        dayOfWeek,
        dayName,
        period,
        ...timeFields,
      });
    }

    if (hasTimeMatch) {
      return slots;
    }

    // 1-b. 요일 없이 시간만 있는 경우: "09:30~10:45" 또는 "11:00 - 12:15"
    const bareTimeMatch = /^\s*(\d{1,2}:\d{2})\s*[~–—\-∼〜]\s*(\d{1,2}:\d{2})\s*$/.exec(scheduleStr);
    if (bareTimeMatch) {
      const timeFields = resolveTimeFields(`${bareTimeMatch[1]}~${bareTimeMatch[2]}`);
      const period = this.getTimeSlotPeriod(timeFields.startTime);
      return [{ dayOfWeek: 0, dayName: '', period, ...timeFields }];
    }

    // 2. 교시 기반 포맷: "화1,2,목3,4", "월1~2", "목3-4", "월1교시,2교시", "화 1, 2"
    const periodRegex = /([월화수목금토])(?:요일)?\s*([0-9,\s~–—\-∼〜교시]+)/g;
    let match: RegExpExecArray | null;

    while ((match = periodRegex.exec(scheduleStr)) !== null) {
      const dayName = match[1];
      const dayOfWeek = dayMap[dayName] || 0;
      const rawTokens = match[2].replace(/교시/g, '').split(',');

      for (const token of rawTokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;

        const rangeMatch = /^(\d{1,2})\s*[~–—\-∼〜]\s*(\d{1,2})$/.exec(trimmed);
        if (rangeMatch) {
          const startP = parseInt(rangeMatch[1], 10);
          const endP = parseInt(rangeMatch[2], 10);
          if (!isNaN(startP) && !isNaN(endP) && startP <= endP) {
            for (let p = startP; p <= endP; p++) {
              if (p >= 1 && p <= 14) {
                const timeFields = resolveTimeFields(PERIOD_TIMES[p], p);
                slots.push({
                  dayOfWeek,
                  dayName,
                  period: p,
                  ...timeFields,
                });
              }
            }
          }
        } else {
          const p = parseInt(trimmed, 10);
          if (!isNaN(p) && p >= 1 && p <= 14) {
            const timeFields = resolveTimeFields(PERIOD_TIMES[p], p);
            slots.push({
              dayOfWeek,
              dayName,
              period: p,
              ...timeFields,
            });
          }
        }
      }
    }

    if (slots.length > 0) {
      return slots;
    }

    // 2-b. 요일 없이 교시만 있는 경우 (e.g. "1,2", "1~2", "3-4", "1,2교시")
    const barePeriodMatch = /^[0-9,\s~–—\-∼〜교시]+$/.test(scheduleStr);
    if (barePeriodMatch) {
      const rawTokens = scheduleStr.replace(/교시/g, '').split(',');
      for (const token of rawTokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;

        const rangeMatch = /^(\d{1,2})\s*[~–—\-∼〜]\s*(\d{1,2})$/.exec(trimmed);
        if (rangeMatch) {
          const startP = parseInt(rangeMatch[1], 10);
          const endP = parseInt(rangeMatch[2], 10);
          if (!isNaN(startP) && !isNaN(endP) && startP <= endP) {
            for (let p = startP; p <= endP; p++) {
              if (p >= 1 && p <= 14) {
                const timeFields = resolveTimeFields(PERIOD_TIMES[p], p);
                slots.push({
                  dayOfWeek: 0,
                  dayName: '',
                  period: p,
                  ...timeFields,
                });
              }
            }
          }
        } else {
          const p = parseInt(trimmed, 10);
          if (!isNaN(p) && p >= 1 && p <= 14) {
            const timeFields = resolveTimeFields(PERIOD_TIMES[p], p);
            slots.push({
              dayOfWeek: 0,
              dayName: '',
              period: p,
              ...timeFields,
            });
          }
        }
      }
    }

    return slots;
  }

  /**
   * 시간표 응답 데이터셋 파싱
   */
  private static parseTimetableData(result: NexacroResult): TimetableItem[] {
    const dsNames = Object.keys(result.datasets);
    if (dsNames.length === 0) {
      return [];
    }

    const ds =
      result.datasets['ds_main'] ||
      result.datasets['output1'] ||
      result.datasets['ds_timetable'] ||
      result.datasets['ds_list'] ||
      result.datasets['ds_output'] ||
      result.datasets[dsNames[0]];

    if (!ds || ds.length === 0) {
      return [];
    }

    const timetable: TimetableItem[] = [];
    let itemIdx = 0;

    for (const row of ds) {
      const subjectNm = (row['COURSE_NM'] || row['SUBJ_NM'] || row['SUBJECT_NM'] || '').trim();
      const profNm = (row['PESN_GEND_NM'] || row['PROF_NM'] || row['PROFESSOR_NM'] || '').trim();
      const classroom = (row['CLAS_ROOM_CD'] || row['CLAS_ROOM_NM'] || row['ROOM_NM'] || row['CLASS_ROOM'] || '').trim();
      const scheduleRaw = (row['LESS_DYWEK_GBCD'] || row['TIME_STR'] || '').trim();

      if (!subjectNm) continue;

      const colorIndex = getSubjectColorIndex(subjectNm, 8);

      // 1. "화1,2,목3,4" 또는 "월요일(11:00~12:15)" 형태의 복합 교시 파싱
      const slots = this.parseHanshinScheduleSlots(scheduleRaw);
      if (slots.length > 0) {
        for (const slot of slots) {
          const slotDayOfWeek = slot.dayOfWeek || Number(row['DAY_CD'] || row['DAY_OF_WEEK'] || 0);
          const slotDayName = slot.dayName || DAY_NAMES[slotDayOfWeek] || '';

          if (slotDayOfWeek >= 1 && slotDayOfWeek <= 6) {
            timetable.push({
              id: `tt_${itemIdx++}_d${slotDayOfWeek}_p${slot.period}`,
              dayOfWeek: slotDayOfWeek,
              dayName: slotDayName,
              period: slot.period,
              startTime: slot.startTime,
              endTime: slot.endTime,
              startMinutes: slot.startMinutes,
              endMinutes: slot.endMinutes,
              durationMinutes: slot.durationMinutes,
              timeStr: slot.timeStr,
              subjectNm,
              profNm,
              classroom,
              colorIndex,
            });
          }
        }
        continue;
      }

      // 2. 단일 요일/교시 컬럼 파싱 (Fallback)
      let dayOfWeek = Number(row['DAY_CD'] || row['DAY_OF_WEEK'] || 0);
      let dayName = row['DAY_NM'] || '';
      if (!dayOfWeek && dayName) {
        dayOfWeek = DAY_NAMES.indexOf(dayName);
      }
      if (dayOfWeek >= 1 && dayOfWeek <= 6 && !dayName) {
        dayName = DAY_NAMES[dayOfWeek];
      }

      const period = Number(row['PRD'] || row['PERIOD'] || row['LESSON_TIME'] || 1);
      const timeFields = resolveTimeFields(row['TIME_STR'] || PERIOD_TIMES[period], period);

      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        timetable.push({
          id: `tt_${itemIdx++}`,
          dayOfWeek,
          dayName,
          period,
          startTime: timeFields.startTime,
          endTime: timeFields.endTime,
          startMinutes: timeFields.startMinutes,
          endMinutes: timeFields.endMinutes,
          durationMinutes: timeFields.durationMinutes,
          timeStr: timeFields.timeStr,
          subjectNm,
          profNm,
          classroom,
          colorIndex,
        });
      } else {
        // 수업 시간이 지정되지 않은 과목 (예: 진로와상담 "(:~:)") — 시간표 하단 목록에 표시
        timetable.push({
          id: `tt_${itemIdx++}_unscheduled`,
          dayOfWeek: 0,
          dayName: '',
          startTime: '',
          endTime: '',
          startMinutes: 0,
          endMinutes: 0,
          durationMinutes: 0,
          timeStr: '시간 미지정',
          subjectNm,
          profNm,
          classroom,
          colorIndex,
          unscheduled: true,
        });
      }
    }

    return assignDistinctSubjectColors(timetable, 8);
  }

  /**
   * 졸업사정 응답 데이터셋 파싱
   */
  /**
   * 졸업 기준 파싱 (um72_0272004 교양및전공필수이수현황, HAR 확인)
   * - output1: 학번·학과별 졸업 기준 (교양 최소/최대, 전공, 졸업학점, 안내문 DAN/BOK)
   * - output2: 교양필수·주전공필수·비교과 이수 현황
   * 서버는 취득학점을 주지 않으므로 applyGradesToGraduation()으로 성적 데이터와 합산한다.
   */
  public static parseGraduationData(result: NexacroResult): GraduationDiagnosis {
    const emptyGrad: GraduationDiagnosis = {
      totalRequiredCredits: 130,
      totalAcquiredCredits: 0,
      majorRequiredCredits: 0,
      majorAcquiredCredits: 0,
      generalRequiredCredits: 0,
      generalAcquiredCredits: 0,
      otherAcquiredCredits: 0,
      completionPercent: 0,
      status: 'in_progress',
      note: '종합정보시스템 졸업사정 데이터를 동기화해주세요.',
    };

    const ds = result.datasets['output1'] || result.datasets['ds_grdtnPnt'];
    if (!ds || ds.length === 0) {
      return emptyGrad;
    }

    const row = ds[0];
    const ruleText = unescapeXml(row['DAN'] || '').trim();
    const multiMajorText = unescapeXml(row['BOK'] || '').trim();

    // 안내문 "교양(최소35이상~최대45까지만 인정) + 계열공통(36) + 전공(24) + 타전공학점 = 총(130이상)"
    // CPNO_MAJR_PNT 컬럼의 의미가 학번별로 다를 수 있어 계열공통 기준은 안내문에서만 추출
    const commonMatch = ruleText.match(/계열공통\s*\(\s*([\d.]+)\s*\)/);
    const commonRequiredCredits = commonMatch ? parseCredits(commonMatch[1]) : 0;

    const requiredCourses = (result.datasets['output2'] || result.datasets['ds_cltrEsse'] || [])
      .filter(r => r['COURSE_NM'])
      .map(r => {
        const tot = (r['TOT'] || '').trim();
        return {
          name: unescapeXml(r['COURSE_NM']).trim(),
          category: unescapeXml(r['CONF_GBCD'] || '').trim(),
          completedCount: tot === '' || isNaN(Number(tot)) ? null : Number(tot),
          earned: unescapeXml(r['PNT'] || '').trim(),
          unit: unescapeXml(r['UNIT'] || '').trim(),
          note: unescapeXml(r['NOTE'] || '').trim(),
        };
      });

    return {
      ...emptyGrad,
      totalRequiredCredits: parseCredits(row['GRDTN_PNT']) || 130,
      majorRequiredCredits: parseCredits(row['MAJR_PNT']),
      generalRequiredCredits: parseCredits(row['CLTR_MINM_ADMIT_PNT']),
      generalMaxCredits: parseCredits(row['CLTR_MXMM_ADMIT_PNT']) || undefined,
      commonRequiredCredits,
      commonAcquiredCredits: 0,
      ruleText,
      multiMajorText,
      requiredCourses,
      creditsComputed: false,
      note: ruleText || emptyGrad.note,
    };
  }

  /**
   * 성적 데이터(전체성적조회)로 이수구분별 취득학점을 계산하여 졸업 기준과 합산
   * 서버 총 취득학점(COPL_PNT)과 동일하게 F/NP, 미확정 성적, 재수강 대상, 괄호 학점은 제외
   */
  public static applyGradesToGraduation(
    graduation: GraduationDiagnosis,
    grades: GradeSummary | null | undefined
  ): GraduationDiagnosis {
    if (!grades || grades.semesters.length === 0) {
      return {
        ...graduation,
        creditsComputed: false,
        note: '성적 데이터를 불러오지 못해 취득학점을 계산하지 못했습니다.',
      };
    }

    let general = 0;
    let common = 0;
    let major = 0;
    let other = 0;

    for (const sem of grades.semesters) {
      for (const sub of sem.subjects) {
        const grade = (sub.grade || '').toUpperCase().trim();
        if (!grade || ['F', 'NP', 'FAIL', 'U'].includes(grade)) continue;
        if (sub.retake || sub.parenthesizedCredit || !(sub.credits > 0)) continue;

        const div = sub.compDiv || '';
        if (div.startsWith('교')) general += sub.credits;
        else if (div.startsWith('계')) common += sub.credits;
        else if (div.startsWith('전')) major += sub.credits;
        else other += sub.credits; // 일반선택, 타전공(복수/부전공) 등
      }
    }

    const round = (n: number) => Math.round(n * 10) / 10;
    const generalCounted =
      graduation.generalMaxCredits && graduation.generalMaxCredits > 0
        ? Math.min(general, graduation.generalMaxCredits)
        : general;
    const total = round(generalCounted + common + major + other);
    const commonReq = graduation.commonRequiredCredits || 0;

    const areasMet =
      general >= graduation.generalRequiredCredits &&
      major >= graduation.majorRequiredCredits &&
      common >= commonReq;
    const totalMet = total >= graduation.totalRequiredCredits;
    const status: GraduationDiagnosis['status'] = totalMet && areasMet ? 'satisfied' : totalMet ? 'insufficient' : 'in_progress';

    return {
      ...graduation,
      totalAcquiredCredits: total,
      generalAcquiredCredits: round(general),
      commonAcquiredCredits: round(common),
      majorAcquiredCredits: round(major),
      otherAcquiredCredits: round(other),
      completionPercent:
        graduation.totalRequiredCredits > 0
          ? Math.min(100, Number(((total / graduation.totalRequiredCredits) * 100).toFixed(1)))
          : 0,
      status,
      creditsComputed: true,
      note:
        status === 'satisfied'
          ? '졸업 기준 학점을 모두 충족하였습니다.'
          : `잔여 필요학점: ${round(Math.max(0, graduation.totalRequiredCredits - total))}학점`,
    };
  }

  private static isGpaBearingGrade(grade: string): boolean {
    const g = grade.toUpperCase().trim();
    return ['A+', 'A0', 'A', 'B+', 'B0', 'B', 'C+', 'C0', 'C', 'D+', 'D0', 'D', 'F'].includes(g);
  }

  private static isAcquiredGrade(grade: string): boolean {
    const g = grade.toUpperCase().trim();
    return !['F', 'NP', 'FAIL', 'U'].includes(g);
  }

  private static gradeToGpa(grade: string): number {
    switch (grade.toUpperCase().trim()) {
      case 'A+':
        return 4.5;
      case 'A0':
      case 'A':
        return 4.0;
      case 'B+':
        return 3.5;
      case 'B0':
      case 'B':
        return 3.0;
      case 'C+':
        return 2.5;
      case 'C0':
      case 'C':
        return 2.0;
      case 'D+':
        return 1.5;
      case 'D0':
      case 'D':
        return 1.0;
      case 'F':
      default:
        return 0.0;
    }
  }

  /**
   * 한신대학교 실제 교과과정 기준 기본/샘플 학사 데이터 제공 (오프라인 및 데모용)
   */
  public static getSampleAcademicData(): AcademicData {
    return {
      lastUpdated: '동기화 대기 중',
      gradeSummary: {
        totalAppliedCredits: 74,
        totalAcquiredCredits: 74,
        totalGpa: 4.18,
        totalPercentile: 96.5,
        semesters: [
          {
            year: '2026',
            semester: '1학기',
            appliedCredits: 18,
            acquiredCredits: 18,
            semesterGpa: 4.33,
            percentile: 98.0,
            subjects: [
              { subjCode: 'AI201', subjNm: '인공지능개론', compDiv: '전공선택', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'CS302', subjNm: '운영체제', compDiv: '전공필수', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'CS204', subjNm: '알고리즘응용', compDiv: '전공선택', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'CS305', subjNm: '데이터베이스시스템', compDiv: '전공필수', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'GE103', subjNm: '공학윤리와사회', compDiv: '교양필수', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'GE205', subjNm: '비판적사고와토론', compDiv: '교양선택', credits: 3, grade: 'A+', gpaPoint: 4.5 },
            ],
          },
          {
            year: '2025',
            semester: '2학기',
            appliedCredits: 19,
            acquiredCredits: 19,
            semesterGpa: 4.21,
            percentile: 96.8,
            subjects: [
              { subjCode: 'CS201', subjNm: '자료구조및실습', compDiv: '전공필수', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'CS202', subjNm: '객체지향프로그래밍', compDiv: '전공선택', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'CS203', subjNm: '컴퓨터구조', compDiv: '전공필수', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'GE102', subjNm: '대학영어회화', compDiv: '교양필수', credits: 2, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'GE105', subjNm: '현대사회와철학', compDiv: '교양선택', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'SW101', subjNm: '오픈소스SW입문', compDiv: '전공선택', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'SD001', subjNm: '사회봉사', compDiv: '일반선택', credits: 2, grade: 'P', gpaPoint: 0.0 },
            ],
          },
          {
            year: '2025',
            semester: '1학기',
            appliedCredits: 19,
            acquiredCredits: 19,
            semesterGpa: 4.05,
            percentile: 94.2,
            subjects: [
              { subjCode: 'CS101', subjNm: '컴퓨터과학입문', compDiv: '전공필수', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'CS102', subjNm: 'C프로그래밍기초', compDiv: '전공필수', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'MA101', subjNm: '이산수학', compDiv: '전공선택', credits: 3, grade: 'B+', gpaPoint: 3.5 },
              { subjCode: 'MA102', subjNm: '공업선형대수', compDiv: '전공선택', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'GE101', subjNm: '글쓰기와소통', compDiv: '교양필수', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'GE104', subjNm: '한신정신과평화', compDiv: '교양필수', credits: 2, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'CC001', subjNm: '채플(1)', compDiv: '교양필수', credits: 2, grade: 'P', gpaPoint: 0.0 },
            ],
          },
          {
            year: '2024',
            semester: '2학기',
            appliedCredits: 18,
            acquiredCredits: 18,
            semesterGpa: 4.11,
            percentile: 95.0,
            subjects: [
              { subjCode: 'PY101', subjNm: '파이썬프로그래밍', compDiv: '전공기초', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'PY102', subjNm: '컴퓨팅사고와SW코딩', compDiv: '전공기초', credits: 3, grade: 'A+', gpaPoint: 4.5 },
              { subjCode: 'GE106', subjNm: '인간과환경', compDiv: '교양선택', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'GE107', subjNm: '심리학의이해', compDiv: '교양선택', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'GE108', subjNm: '세계문화의이해', compDiv: '교양선택', credits: 3, grade: 'A0', gpaPoint: 4.0 },
              { subjCode: 'CC002', subjNm: '채플(2)', compDiv: '교양필수', credits: 3, grade: 'P', gpaPoint: 0.0 },
            ],
          },
        ],
      },
      timetable: [
        // 월요일 (Monday)
        {
          id: 'tt_1',
          dayOfWeek: 1,
          dayName: '월',
          period: 1,
          startTime: '09:30',
          endTime: '10:45',
          startMinutes: 570,
          endMinutes: 645,
          durationMinutes: 75,
          timeStr: '09:30 - 10:45',
          subjectNm: '자율지능IoT시스템',
          profNm: '이교수',
          classroom: '18424()',
          colorIndex: 0,
        },
        {
          id: 'tt_2',
          dayOfWeek: 1,
          dayName: '월',
          period: 2,
          startTime: '11:00',
          endTime: '12:15',
          startMinutes: 660,
          endMinutes: 735,
          durationMinutes: 75,
          timeStr: '11:00 - 12:15',
          subjectNm: '데이터베이스',
          profNm: '박교수',
          classroom: '18308()',
          colorIndex: 1,
        },
        {
          id: 'tt_3',
          dayOfWeek: 1,
          dayName: '월',
          period: 3,
          startTime: '13:00',
          endTime: '14:15',
          startMinutes: 780,
          endMinutes: 855,
          durationMinutes: 75,
          timeStr: '13:00 - 14:15',
          subjectNm: '논리회로',
          profNm: '정교수',
          classroom: '18417()',
          colorIndex: 2,
        },
        {
          id: 'tt_4',
          dayOfWeek: 1,
          dayName: '월',
          period: 4,
          startTime: '14:30',
          endTime: '15:45',
          startMinutes: 870,
          endMinutes: 945,
          durationMinutes: 75,
          timeStr: '14:30 - 15:45',
          subjectNm: '인지감성AI에이전트',
          profNm: '김교수',
          classroom: '18314()',
          colorIndex: 3,
        },
        {
          id: 'tt_5',
          dayOfWeek: 1,
          dayName: '월',
          period: 5,
          startTime: '16:00',
          endTime: '17:15',
          startMinutes: 960,
          endMinutes: 1035,
          durationMinutes: 75,
          timeStr: '16:00 - 17:15',
          subjectNm: '채플',
          profNm: '교목실',
          classroom: '채플실()',
          colorIndex: 5,
        },
        // 수요일 (Wednesday)
        {
          id: 'tt_6',
          dayOfWeek: 3,
          dayName: '수',
          period: 1,
          startTime: '09:30',
          endTime: '10:45',
          startMinutes: 570,
          endMinutes: 645,
          durationMinutes: 75,
          timeStr: '09:30 - 10:45',
          subjectNm: '데이터베이스',
          profNm: '박교수',
          classroom: '18308()',
          colorIndex: 1,
        },
        {
          id: 'tt_7',
          dayOfWeek: 3,
          dayName: '수',
          period: 2,
          startTime: '11:00',
          endTime: '12:15',
          startMinutes: 660,
          endMinutes: 735,
          durationMinutes: 75,
          timeStr: '11:00 - 12:15',
          subjectNm: '자율지능IoT시스템',
          profNm: '이교수',
          classroom: '18424()',
          colorIndex: 0,
        },
        {
          id: 'tt_8',
          dayOfWeek: 3,
          dayName: '수',
          period: 3,
          startTime: '13:00',
          endTime: '14:15',
          startMinutes: 780,
          endMinutes: 855,
          durationMinutes: 75,
          timeStr: '13:00 - 14:15',
          subjectNm: '논리회로',
          profNm: '정교수',
          classroom: '18417()',
          colorIndex: 2,
        },
        {
          id: 'tt_9',
          dayOfWeek: 3,
          dayName: '수',
          period: 4,
          startTime: '14:30',
          endTime: '15:45',
          startMinutes: 870,
          endMinutes: 945,
          durationMinutes: 75,
          timeStr: '14:30 - 15:45',
          subjectNm: '인지감성AI에이전트',
          profNm: '김교수',
          classroom: '18314()',
          colorIndex: 3,
        },
        {
          id: 'tt_10',
          dayOfWeek: 3,
          dayName: '수',
          period: 5,
          startTime: '16:00',
          endTime: '17:15',
          startMinutes: 960,
          endMinutes: 1035,
          durationMinutes: 75,
          timeStr: '16:00 - 17:15',
          subjectNm: '1인미디어만들기',
          profNm: '최교수',
          classroom: '20404()',
          colorIndex: 6,
        },
        // 목요일 (Thursday) - 연속 수업 (13:00 ~ 15:45)
        {
          id: 'tt_11',
          dayOfWeek: 4,
          dayName: '목',
          period: 3,
          startTime: '13:00',
          endTime: '14:15',
          startMinutes: 780,
          endMinutes: 855,
          durationMinutes: 75,
          timeStr: '13:00 - 14:15',
          subjectNm: '운영체제',
          profNm: '강교수',
          classroom: '18521()',
          colorIndex: 4,
        },
        {
          id: 'tt_12',
          dayOfWeek: 4,
          dayName: '목',
          period: 4,
          startTime: '14:30',
          endTime: '15:45',
          startMinutes: 870,
          endMinutes: 945,
          durationMinutes: 75,
          timeStr: '14:30 - 15:45',
          subjectNm: '운영체제',
          profNm: '강교수',
          classroom: '18521()',
          colorIndex: 4,
        },
      ],
      graduation: {
        totalRequiredCredits: 130,
        totalAcquiredCredits: 74,
        majorRequiredCredits: 66,
        majorAcquiredCredits: 39,
        generalRequiredCredits: 36,
        generalAcquiredCredits: 30,
        otherAcquiredCredits: 5,
        status: 'in_progress',
        completionPercent: 56.9,
      },
    };
  }
}
