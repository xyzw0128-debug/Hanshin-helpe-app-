import assert from 'assert';
import {
  RS,
  US,
  buildSsvPayload,
  parseDatasets,
} from '../src/services/nexacroClient.js';
import fs from 'fs';

// HAR 캡처 폴더 (토큰·개인정보가 있어 저장소에 넣지 않음). 폴더를 옮겨도 찾도록 후보를 차례로 확인 (HS_HAR_DIR로 지정 가능)
const HAR_DIRS = [
  process.env.HS_HAR_DIR,
  '/home/lael/Downloads/개발/LMS알림봇/HAR캡처/hsackr',
  '/home/lael/Downloads/hsackr',
].filter(Boolean);
const harFile = name => {
  for (const dir of HAR_DIRS) {
    if (fs.existsSync(`${dir}/${name}`)) return `${dir}/${name}`;
  }
  return `${HAR_DIRS[0]}/${name}`;
};
import {
  HsctisScraperService,
  getSubjectColorIndex,
  PERIOD_TIMES,
  resolveTimeFields,
} from '../src/services/hsctisScraper.js';
import {
  mergeDayTimetable,
  SUBJECT_PALETTE,
} from '../src/components/AcademicView.js';
import {
  LmsScraperService,
  isEmergencyNotice,
  cleanLecName,
  parseLectureDeadline,
} from '../src/services/lmsScraper.js';
import {
  CAMPUS_APPS,
  buildIntentUri,
} from '../src/utils/campusLauncher.js';
import {
  SSO_CLIENT_ID,
  SSO_BASE,
  HSCTIS_BASE,
  HsctisAuthError,
  HsctisAuthService,
} from '../src/services/hsctisAuth.js';
import {
  hashNotificationId,
  toNotificationNumericId,
  NotificationService,
} from '../src/services/notifications.js';

// Node.js test mock for Web storage fallbacks
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
  };
}

console.log('=== STARTING HSCTIS & NEXACRO & CAMPUS LAUNCHER TEST SUITE ===\n');

// -------------------------------------------------------------
// Test 1: buildSsvPayload (Nexacro 17 SSV Builder)
// -------------------------------------------------------------
console.log('Test 1: buildSsvPayload basic & complex payloads...');
{
  // 1-1. Header and variables only
  const ssv1 = buildSsvPayload({
    variables: {
      gv_userId: '20240001',
      ErrorCode: 0,
      emptyVar: '',
    },
  });

  assert(ssv1.startsWith(`SSV:utf-8${RS}`), 'SSV payload must start with SSV:utf-8 + RS');
  assert(ssv1.includes(`gv_userId=20240001${RS}`), 'Payload must include gv_userId variable');
  assert(ssv1.includes(`ErrorCode=0${RS}`), 'Payload must include ErrorCode variable');
  assert(ssv1.includes(`emptyVar=${RS}`), 'Payload must handle empty variable');

  // 1-2. Datasets with multiple rows and columns
  const ssv2 = buildSsvPayload({
    variables: { YEAR: '2026', SMTR: '1' },
    datasets: [
      {
        id: 'ds_input',
        columns: ['COL_A', 'COL_B'],
        rows: [
          { COL_A: 'val1', COL_B: 'val2' },
          { COL_A: 'val3', COL_B: '' },
        ],
      },
    ],
  });

  assert(ssv2.includes(`Dataset:ds_input${RS}`), 'Payload must have Dataset header');
  assert(ssv2.includes(`_RowType_${US}COL_A:String(256)${US}COL_B:String(256)${RS}`), 'Column header format check');
  assert(ssv2.includes(`N${US}val1${US}val2${RS}`), 'Data row 1 check');
  assert(ssv2.includes(`N${US}val3${US}${RS}`), 'Data row 2 with empty string check');

  console.log('  -> buildSsvPayload PASSED');
}

// -------------------------------------------------------------
// Test 2: parseDatasets (XML Dataset format)
// -------------------------------------------------------------
console.log('\nTest 2: parseDatasets with XML Datasets...');
{
  const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<Root xmlns="http://www.nexacroplatform.com/platform/dataset">
  <Parameters>
    <Parameter id="ErrorCode">0</Parameter>
    <Parameter id="ErrorMsg">SUCCESS</Parameter>
  </Parameters>
  <Dataset id="ds_summary">
    <ColumnInfo>
      <Column id="REQ_PNT" type="BIGDECIMAL" size="10"/>
      <Column id="GET_PNT" type="BIGDECIMAL" size="10"/>
      <Column id="GPA" type="BIGDECIMAL" size="10"/>
      <Column id="SCORE_100" type="BIGDECIMAL" size="10"/>
    </ColumnInfo>
    <Rows>
      <Row>
        <Col id="REQ_PNT">74</Col>
        <Col id="GET_PNT">74</Col>
        <Col id="GPA">4.18</Col>
        <Col id="SCORE_100">96.5</Col>
      </Row>
    </Rows>
  </Dataset>
  <Dataset id="ds_detail">
    <Rows>
      <Row>
        <Col id="YEAR">2026</Col>
        <Col id="SMTR_NM">1학기</Col>
        <Col id="SUBJ_CD">AI201</Col>
        <Col id="SUBJ_NM"><![CDATA[인공지능개론 & 머신러닝]]></Col>
        <Col id="COMP_DIV">전공선택</Col>
        <Col id="PNT">3</Col>
        <Col id="GRD">A+</Col>
      </Row>
      <Row>
        <Col id="YEAR">2026</Col>
        <Col id="SMTR_NM">1학기</Col>
        <Col id="SUBJ_CD">CS302</Col>
        <Col id="SUBJ_NM">운영체제</Col>
        <Col id="COMP_DIV">전공필수</Col>
        <Col id="PNT">3</Col>
        <Col id="GRD">A0</Col>
      </Row>
    </Rows>
  </Dataset>
</Root>`;

  const parsed = parseDatasets(mockXml);

  assert.strictEqual(parsed.errorCode, '0', 'ErrorCode should be 0');
  assert.strictEqual(parsed.errorMsg, 'SUCCESS', 'ErrorMsg should be SUCCESS');

  // Verify ds_summary
  assert(parsed.datasets['ds_summary'], 'ds_summary should exist');
  assert.strictEqual(parsed.datasets['ds_summary'].length, 1);
  assert.strictEqual(parsed.datasets['ds_summary'][0]['GPA'], '4.18');
  assert.strictEqual(parsed.datasets['ds_summary'][0]['GET_PNT'], '74');

  // Verify ds_detail with CDATA and entities
  assert(parsed.datasets['ds_detail'], 'ds_detail should exist');
  assert.strictEqual(parsed.datasets['ds_detail'].length, 2);
  assert.strictEqual(parsed.datasets['ds_detail'][0]['SUBJ_NM'], '인공지능개론 & 머신러닝');
  assert.strictEqual(parsed.datasets['ds_detail'][0]['GRD'], 'A+');
  assert.strictEqual(parsed.datasets['ds_detail'][1]['SUBJ_NM'], '운영체제');

  console.log('  -> parseDatasets XML PASSED');
}

// -------------------------------------------------------------
// Test 3: parseDatasets (SSV format response)
// -------------------------------------------------------------
console.log('\nTest 3: parseDatasets with SSV response...');
{
  const mockSsv = `SSV:utf-8${RS}ErrorCode=0${RS}ErrorMsg=NORMAL${RS}Dataset:ds_timetable${RS}_RowType_${US}DAY_CD:String(10)${US}PRD:String(10)${US}SUBJ_NM:String(100)${US}ROOM_NM:String(100)${RS}N${US}1${US}2${US}운영체제${US}만우관 201호${RS}N${US}2${US}4${US}인공지능개론${US}임마누엘관 B102호${RS}`;

  const parsed = parseDatasets(mockSsv);

  assert.strictEqual(parsed.errorCode, '0');
  assert.strictEqual(parsed.errorMsg, 'NORMAL');
  assert(parsed.datasets['ds_timetable']);
  assert.strictEqual(parsed.datasets['ds_timetable'].length, 2);
  assert.strictEqual(parsed.datasets['ds_timetable'][0]['SUBJ_NM'], '운영체제');
  assert.strictEqual(parsed.datasets['ds_timetable'][0]['ROOM_NM'], '만우관 201호');
  assert.strictEqual(parsed.datasets['ds_timetable'][1]['SUBJ_NM'], '인공지능개론');
  assert.strictEqual(parsed.datasets['ds_timetable'][1]['PRD'], '4');

  console.log('  -> parseDatasets SSV PASSED');
}

// -------------------------------------------------------------
// Test 4: parseDatasets edge cases (empty, malformed, null)
// -------------------------------------------------------------
console.log('\nTest 4: parseDatasets edge cases...');
{
  const emptyRes = parseDatasets('');
  assert.strictEqual(emptyRes.errorCode, '0');
  assert.deepStrictEqual(emptyRes.datasets, {});

  const nullRes = parseDatasets(null);
  assert.strictEqual(nullRes.errorCode, '0');

  const malformed = parseDatasets('<not xml');
  assert.strictEqual(malformed.errorCode, '0');

  console.log('  -> parseDatasets edge cases PASSED');
}

// -------------------------------------------------------------
// Test 5: HsctisScraperService dataset mapping
// -------------------------------------------------------------
console.log('\nTest 5: HsctisScraperService dataset mapping & calculation...');
{
  // 5-1. Sample Academic Data
  const sample = HsctisScraperService.getSampleAcademicData();
  assert(sample.gradeSummary !== null, 'Sample gradeSummary must not be null');
  assert.strictEqual(sample.gradeSummary.totalGpa, 4.18, 'GPA check');
  assert.strictEqual(sample.gradeSummary.totalAcquiredCredits, 74, 'Credits check');
  assert(sample.gradeSummary.semesters.length >= 4, 'Semesters count check');
  assert(sample.timetable.length >= 5, 'Timetable count check');
  assert(sample.graduation !== null, 'Graduation diagnosis check');
  assert.strictEqual(sample.graduation.completionPercent, 56.9, 'Graduation completion % check');

  // 5-2. Internal parser methods with custom dataset result
  const customResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_summary: [
        { TOT_APP_PNT: '80', TOT_GET_PNT: '80', TOT_GPA: '4.25', SCORE_100: '97.2' },
      ],
      ds_detail: [
        {
          YEAR: '2026',
          SMTR: '1',
          SUBJ_CD: 'CS100',
          SUBJ_NM: '자료구조',
          COMP_DIV: '전필',
          PNT: '3',
          GRD: 'A+',
          GPA_POINT: '4.5',
        },
      ],
      ds_timetable: [
        {
          DAY_CD: '3', // 수요일
          PRD: '2',
          SUBJ_NM: '자료구조',
          PROF_NM: '이교수',
          ROOM_NM: '만우관 101호',
        },
      ],
      ds_grad: [
        {
          REQ_TOT_PNT: '130',
          GET_TOT_PNT: '80',
          MJR_REQ_PNT: '66',
          MJR_GET_PNT: '45',
          GEN_REQ_PNT: '36',
          GEN_GET_PNT: '30',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const gradeSummary = HsctisScraperService['parseGradesData'](customResult);
  assert.strictEqual(gradeSummary.totalGpa, 4.25);
  assert.strictEqual(gradeSummary.totalAcquiredCredits, 80);
  assert.strictEqual(gradeSummary.semesters[0].subjects[0].subjNm, '자료구조');

  const timetable = HsctisScraperService['parseTimetableData'](customResult);
  assert.strictEqual(timetable.length, 1);
  assert.strictEqual(timetable[0].dayName, '수');
  assert.strictEqual(timetable[0].period, 2);
  assert.strictEqual(timetable[0].subjectNm, '자료구조');
  assert.strictEqual(timetable[0].classroom, '만우관 101호');

  // 졸업 기준은 실제 스키마(um72_0272004 output1), 취득학점은 성적 데이터에서 이수구분별로 계산
  const gradReq = HsctisScraperService.parseGraduationData({
    parameters: {}, errorCode: '0', errorMsg: '',
    datasets: { ds_grdtnPnt: [{ GRDTN_PNT: '130', MAJR_PNT: '24', CLTR_MINM_ADMIT_PNT: '35', CLTR_MXMM_ADMIT_PNT: '45',
      DAN: '교양(최소35이상~최대45까지만 인정) + 계열공통(36) + 전공(24) + 타전공학점 = 총(130이상)' }] },
  });
  const grad = HsctisScraperService.applyGradesToGraduation(gradReq, gradeSummary);
  assert.strictEqual(grad.majorAcquiredCredits, 3); // 자료구조(전필) 3학점
  assert.strictEqual(grad.totalAcquiredCredits, 3);
  assert.strictEqual(grad.commonRequiredCredits, 36);
  assert.strictEqual(grad.completionPercent, 2.3); // 3 / 130

  console.log('  -> HsctisScraperService mapping PASSED');
}

// -------------------------------------------------------------
// Test 6: Campus Launcher & Intent URI
// -------------------------------------------------------------
console.log('\nTest 6: Campus Launcher utilities & Intent URI...');
{
  // 6-1. Check official packages registered
  assert(CAMPUS_APPS.attendance, 'Attendance app must be configured');
  assert.strictEqual(
    CAMPUS_APPS.attendance.packageName,
    'kr.ac.hanshin.attendance',
    'Hanshin attendance package match'
  );
  assert(CAMPUS_APPS.attendance.fallbackPackages.includes('kr.ac.hs.ucheck'));

  assert(CAMPUS_APPS.sugang, 'Course registration app must be configured');
  assert.strictEqual(CAMPUS_APPS.sugang.packageName, 'kr.ac.hanshin.sugang', 'Hanshin sugang package match');
  assert(CAMPUS_APPS.sugang.fallbackPackages.includes('kr.ac.hs.sugang'));

  assert(CAMPUS_APPS.library, 'Hanshin Library membership app must be configured');
  assert.strictEqual(CAMPUS_APPS.library.packageName, 'liberty.hslib', 'Library package match');
  assert.deepStrictEqual(CAMPUS_APPS.library.fallbackPackages, []);
  assert.strictEqual(CAMPUS_APPS.library.name, '한신대 도서관 회원증');
  assert.strictEqual(CAMPUS_APPS.library.shortName, '도서관 회원증');
  assert.strictEqual(CAMPUS_APPS.library.description, '중앙도서관 모바일 출입 및 열람증');
  assert.strictEqual(CAMPUS_APPS.library.badgeText, '모바일 이용증');
  assert.strictEqual(CAMPUS_APPS.library.actionText, '도서관 회원증 실행');
  assert.strictEqual(CAMPUS_APPS.library.storeUrl, 'https://play.google.com/store/apps/details?id=liberty.hslib');

  // 6-2. Intent URI format verification
  const intentUri = buildIntentUri(
    'kr.ac.hanshin.ucheck',
    'https://play.google.com/store/apps/details?id=kr.ac.hanshin.ucheck'
  );
  assert(intentUri.startsWith('intent:#Intent;package=kr.ac.hanshin.ucheck;'));
  assert(intentUri.includes('S.browser_fallback_url=https%3A%2F%2Fplay.google.com'));
  assert(intentUri.endsWith(';end'));

  const libIntentUri = buildIntentUri(CAMPUS_APPS.library.packageName, CAMPUS_APPS.library.storeUrl);
  assert(libIntentUri.startsWith('intent:#Intent;package=liberty.hslib;'));
  assert(libIntentUri.includes('S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dliberty.hslib'));

  console.log('  -> Campus Launcher PASSED');
}

// -------------------------------------------------------------
// Test 7: HsctisAuthService configuration & errors
// -------------------------------------------------------------
console.log('\nTest 7: HsctisAuthService configuration...');
{
  assert.strictEqual(SSO_BASE, 'https://sso2.hs.ac.kr');
  assert.strictEqual(HSCTIS_BASE, 'https://hsctis.hs.ac.kr');
  assert.strictEqual(SSO_CLIENT_ID, '5f0869ab6c0f4178874754fbd6c5bf64');

  const err = new HsctisAuthError('테스트 오류');
  assert.strictEqual(err.name, 'HsctisAuthError');
  assert.strictEqual(err.message, '테스트 오류');

  assert.strictEqual(HsctisAuthService.isLoggedIn(), false);
  console.log('  -> HsctisAuthService PASSED');
}

// -------------------------------------------------------------
// Test 8: Graduation Satisfied Edge Case & Fallbacks
// -------------------------------------------------------------
console.log('\nTest 8: Graduation Satisfied & Timetable Saturday Edge Cases...');
{
  const gradSatisfiedResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_grad: [
        {
          REQ_TOT_PNT: '130',
          GET_TOT_PNT: '135',
          MJR_REQ_PNT: '66',
          MJR_GET_PNT: '70',
          GEN_REQ_PNT: '36',
          GEN_GET_PNT: '40',
        },
      ],
      ds_timetable: [
        {
          DAY_NM: '토',
          PRD: '1',
          SUBJ_NM: '특별토요세미나',
          ROOM_NM: '만우관 대강당',
          PROF_NM: '초빙교수',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const toSummary = (subjects) => ({ totalAppliedCredits: 0, totalAcquiredCredits: 0, totalGpa: 0,
    semesters: [{ year: '2026', semester: '1', appliedCredits: 0, acquiredCredits: 0, semesterGpa: 0,
      subjects: subjects.map(([compDiv, credits]) => ({ subjCode: '', subjNm: 'x', compDiv, credits, grade: 'A0' })) }] });
  const grad = HsctisScraperService.applyGradesToGraduation(
    HsctisScraperService.parseGraduationData({
    parameters: {}, errorCode: '0', errorMsg: '',
    datasets: { ds_grdtnPnt: [{ GRDTN_PNT: '130', MAJR_PNT: '24', CLTR_MINM_ADMIT_PNT: '35', CLTR_MXMM_ADMIT_PNT: '45',
      DAN: '교양(최소35이상~최대45까지만 인정) + 계열공통(36) + 전공(24) + 타전공학점 = 총(130이상)' }] },
  }),
    toSummary([['교선', 40], ['계공', 36], ['전선', 59]])
  );
  assert.strictEqual(grad.totalAcquiredCredits, 135);
  assert.strictEqual(grad.status, 'satisfied', 'Graduation status should be satisfied');
  assert.strictEqual(grad.completionPercent, 100, 'Completion % capped at 100%');

  const tt = HsctisScraperService['parseTimetableData'](gradSatisfiedResult);
  assert.strictEqual(tt.length, 1);
  assert.strictEqual(tt[0].dayOfWeek, 6, 'Saturday is day 6');
  assert.strictEqual(tt[0].dayName, '토');

  console.log('  -> Edge cases PASSED');
}

// -------------------------------------------------------------
// Test 9: SSV parameters appearing AFTER a Dataset
// -------------------------------------------------------------
console.log('\nTest 9: SSV parameters following a dataset (error codes & messages)...');
{
  const ssvWithTrailingParams =
    'SSV:utf-8' +
    RS +
    'Dataset:ds_test' +
    RS +
    '_RowType_' +
    US +
    'COL_1:String(10)' +
    RS +
    'N' +
    US +
    'val1' +
    RS +
    'ErrorCode=-100' +
    RS +
    'ErrorMsg=Session Expired' +
    RS;

  const parsed = parseDatasets(ssvWithTrailingParams);
  assert.strictEqual(parsed.errorCode, '-100', 'Should extract ErrorCode after dataset');
  assert.strictEqual(parsed.errorMsg, 'Session Expired', 'Should extract ErrorMsg after dataset');
  assert.strictEqual(parsed.parameters['ErrorCode'], '-100');
  assert.strictEqual(parsed.parameters['ErrorMsg'], 'Session Expired');
  assert.strictEqual(parsed.datasets['ds_test'].length, 1);
  assert.strictEqual(parsed.datasets['ds_test'][0]['COL_1'], 'val1');

  console.log('  -> SSV trailing parameters PASSED');
}

// -------------------------------------------------------------
// Test 10: Accurate GPA calculation with Pass/Fail (P) and F grades
// -------------------------------------------------------------
console.log('\nTest 10: Accurate GPA calculation with Pass/Fail (P) and F grades...');
{
  // 학생: 3학점 A+ (4.5), 2학점 채플 P (취득은 되나 GPA 분모/분자 제외), 3학점 전공 F (0점, GPA 분모에 포함, 취득학점 미포함)
  const gpaResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_detail: [
        { YEAR: '2026', SMTR: '1', SUBJ_NM: '인공지능', PNT: '3', GRD: 'A+', GPA_POINT: '4.5' },
        { YEAR: '2026', SMTR: '1', SUBJ_NM: '채플', PNT: '2', GRD: 'P', GPA_POINT: '0.0' },
        { YEAR: '2026', SMTR: '1', SUBJ_NM: '어려운과목', PNT: '3', GRD: 'F', GPA_POINT: '0.0' },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const grades = HsctisScraperService['parseGradesData'](gpaResult);
  const sem = grades.semesters[0];

  // 총 신청학점: 3 + 2 + 3 = 8
  assert.strictEqual(sem.appliedCredits, 8, 'Applied credits should be 8');
  // 총 취득학점: 3 (A+) + 2 (P) = 5 (F는 취득학점 제외)
  assert.strictEqual(sem.acquiredCredits, 5, 'Acquired credits should be 5 (excluding F)');

  // GPA 계산:
  // GPA 대상 과목: A+ (3학점 * 4.5 = 13.5), F (3학점 * 0.0 = 0.0) -> 총 6학점, 총 13.5점
  // 채플 P는 GPA 계산에서 분모/분자 모두 제외되어야 함
  // 예상 GPA = 13.5 / 6 = 2.25
  assert.strictEqual(sem.semesterGpa, 2.25, 'Semester GPA should be 2.25 (not distorted by P)');
  assert.strictEqual(grades.totalGpa, 2.25, 'Total GPA should match 2.25');
  assert.strictEqual(grades.totalAcquiredCredits, 5, 'Total acquired credits should be 5');

  console.log('  -> Accurate GPA & Pass/Fail handling PASSED');
}

// -------------------------------------------------------------
// Test 11: Graduation Diagnosis with 'insufficient' status
// -------------------------------------------------------------
console.log('\nTest 11: Graduation diagnosis insufficient status...');
{
  const insufficientGradResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_grad: [
        {
          REQ_TOT_PNT: '130',
          GET_TOT_PNT: '132', // 전체 이수학점은 130 초과
          MJR_REQ_PNT: '66',
          MJR_GET_PNT: '50', // 전공 이수학점 66 미달
          GEN_REQ_PNT: '36',
          GEN_GET_PNT: '36',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const toSummary = (subjects) => ({ totalAppliedCredits: 0, totalAcquiredCredits: 0, totalGpa: 0,
    semesters: [{ year: '2026', semester: '1', appliedCredits: 0, acquiredCredits: 0, semesterGpa: 0,
      subjects: subjects.map(([compDiv, credits]) => ({ subjCode: '', subjNm: 'x', compDiv, credits, grade: 'A0' })) }] });
  const grad = HsctisScraperService.applyGradesToGraduation(
    HsctisScraperService.parseGraduationData({
    parameters: {}, errorCode: '0', errorMsg: '',
    datasets: { ds_grdtnPnt: [{ GRDTN_PNT: '130', MAJR_PNT: '24', CLTR_MINM_ADMIT_PNT: '35', CLTR_MXMM_ADMIT_PNT: '45',
      DAN: '교양(최소35이상~최대45까지만 인정) + 계열공통(36) + 전공(24) + 타전공학점 = 총(130이상)' }] },
  }),
    toSummary([['교선', 45], ['계공', 60], ['전선', 20], ['일선', 7]]) // 전체 132 / 전공 20 < 24
  );
  assert.strictEqual(grad.status, 'insufficient', 'Status should be insufficient when major credits are lacking');
  assert.strictEqual(grad.totalAcquiredCredits, 132);
  assert.strictEqual(grad.majorAcquiredCredits, 20);

  console.log('  -> Graduation insufficient status PASSED');
}

// -------------------------------------------------------------
// Test 12: Timetable Night Classes (> 9교시)
// -------------------------------------------------------------
console.log('\nTest 12: Timetable night classes (> 9교시)...');
{
  const nightResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_timetable: [
        {
          DAY_CD: '1',
          PRD: '10',
          SUBJ_NM: '야간캡스톤',
          PROF_NM: '홍교수',
          ROOM_NM: '만우관 501호',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const tt = HsctisScraperService['parseTimetableData'](nightResult);
  assert.strictEqual(tt.length, 1);
  assert.strictEqual(tt[0].period, 10);
  assert.strictEqual(tt[0].timeStr, '18:00 - 19:15', '10교시 야간 시간 매핑 확인');
  assert.strictEqual(tt[0].startTime, '18:00');
  assert.strictEqual(tt[0].endTime, '19:15');
  assert.strictEqual(tt[0].startMinutes, 18 * 60);
  assert.strictEqual(tt[0].endMinutes, 19 * 60 + 15);
  assert.strictEqual(tt[0].durationMinutes, 75);

  console.log('  -> Timetable night classes PASSED');
}

// -------------------------------------------------------------
// Test 13: Single dataset fallback with course details
// -------------------------------------------------------------
console.log('\nTest 13: Single dataset fallback with course detail rows...');
{
  const singleDsResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_grade: [
        { YEAR: '2026', SMTR: '1', SUBJ_NM: '소프트웨어공학', PNT: '3', GRD: 'A0', GPA_POINT: '4.0', GET_PNT: '3' },
        { YEAR: '2026', SMTR: '1', SUBJ_NM: '컴퓨터네트워크', PNT: '3', GRD: 'A+', GPA_POINT: '4.5', GET_PNT: '3' },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const grades = HsctisScraperService['parseGradesData'](singleDsResult);
  // 총 취득학점은 첫 번째 행의 GET_PNT(3)가 아닌 전체 과목 합(6)이어야 함
  assert.strictEqual(grades.totalAcquiredCredits, 6, 'Total credits should sum up all courses (6)');
  assert.strictEqual(grades.totalGpa, 4.25, 'Total GPA should be (4.0 + 4.5) / 2 = 4.25');

  console.log('  -> Single dataset fallback PASSED');
}

// -------------------------------------------------------------
// Test 14: XML self-closing tags and attributes for Parameter & Col
// -------------------------------------------------------------
console.log('\nTest 14: XML self-closing tags for Parameter and Col...');
{
  const xmlWithAttrs = `<?xml version="1.0" encoding="UTF-8"?>
<Root>
  <Parameters>
    <Parameter id="ErrorCode" value="0"/>
    <Parameter id="ErrorMsg" value="OK_STATUS"/>
  </Parameters>
  <Dataset id="ds_sample">
    <Rows>
      <Row>
        <Col id="NAME" value="테스트과목"/>
        <Col id="SCORE" value="95"/>
      </Row>
    </Rows>
  </Dataset>
</Root>`;

  const parsed = parseDatasets(xmlWithAttrs);
  assert.strictEqual(parsed.errorCode, '0');
  assert.strictEqual(parsed.errorMsg, 'OK_STATUS');
  assert.strictEqual(parsed.parameters['ErrorCode'], '0');
  assert.strictEqual(parsed.datasets['ds_sample'].length, 1);
  assert.strictEqual(parsed.datasets['ds_sample'][0]['NAME'], '테스트과목');
  assert.strictEqual(parsed.datasets['ds_sample'][0]['SCORE'], '95');

  console.log('  -> XML self-closing tags PASSED');
}

// -------------------------------------------------------------
// Test 15: LMS Portal Notices (MainView.dunet HAR & urgent parsing)
// -------------------------------------------------------------
console.log('\nTest 15: LMS Portal Notices parsing from real HAR data...');
{
  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-01 00-55-40].har');
  if (fs.existsSync(harPath)) {
    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entry = har.log.entries.find(e => e.request.url.includes('MainView.dunet'));
    assert(entry, 'MainView.dunet entry must exist in HAR file');
    const html = entry.response.content.text;

    const notices = LmsScraperService.parsePortalNotices(html);
    assert(notices.length >= 10, 'Should parse at least 10 portal notices');

    // 15-1. Check first urgent notice: [긴급] LMS 기능 업데이트를 위한 서버 작업
    const urgentNotice = notices.find(n => n.boardItemNo === '576567');
    assert(urgentNotice, 'Urgent notice 576567 must exist');
    assert.strictEqual(urgentNotice.boardNo, '14');
    assert.strictEqual(urgentNotice.isUrgent, true, 'isUrgent must be true for [긴급]');
    assert.strictEqual(urgentNotice.courseId, 'PORTAL_LMS');
    assert.strictEqual(urgentNotice.courseNm, '이러닝 공지');
    assert.strictEqual(urgentNotice.dateStr, '2026-09-21');

    // 15-2. Check CTL notice: board 140
    const ctlNotice = notices.find(n => n.boardNo === '140');
    assert(ctlNotice, 'CTL notice must exist');
    assert.strictEqual(ctlNotice.courseNm, '교수학습 공지');

    console.log('  -> LMS Portal Notices (HAR data) PASSED');
  } else {
    // Fallback HTML string test
    const sampleHtml = `
      <div class="learn_pds">
        <div class="top"><h3>이러닝 공지사항</h3></div>
        <div class="cont_list">
          <ul>
            <li>
              <a href="/" class="boardlist" id="board14_576567">[긴급] LMS 기능 업데이트를 위한 서버 작업</a>
              <span class="date">2026-09-21</span>
            </li>
          </ul>
        </div>
      </div>
    `;
    const notices = LmsScraperService.parsePortalNotices(sampleHtml);
    assert.strictEqual(notices.length, 1);
    assert.strictEqual(notices[0].isUrgent, true);
    console.log('  -> LMS Portal Notices (Mock fallback) PASSED');
  }
}

// -------------------------------------------------------------
// Test 16: LMS Board Item Detail HTML parser
// -------------------------------------------------------------
console.log('\nTest 16: LMS Board Item Detail HTML parser...');
{
  const mockDetailHtml = `
    <table class="table_view_basic">
      <tr><th>[긴급] 서버 점검 작업 안내</th></tr>
      <tr><td>작성자 : 관리자 | 등록일 : 2026-09-21 14:00 | 조회수 : 520</td></tr>
      <tr><td>LMS 시스템 업데이트 작업으로 인해 서비스가 일시 중단됩니다.</td></tr>
      <tr><td>첨부파일 : <a href="/download">update_manual.pdf</a></td></tr>
    </table>
  `;

  const detail = LmsScraperService.parseBoardItemDetailHtml(mockDetailHtml);
  assert.strictEqual(detail.title, '[긴급] 서버 점검 작업 안내');
  assert.strictEqual(detail.author, '관리자');
  assert.strictEqual(detail.date, '2026-09-21 14:00');
  assert(detail.body.includes('LMS 시스템 업데이트'));
  assert(detail.attachments.includes('update_manual.pdf'));

  console.log('  -> LMS Board Item Detail HTML parser PASSED');
}

// -------------------------------------------------------------
// Test 17: Hsctis Grades Edge Cases ((0) credit, .5 credit, 'Z' row, TOAL_SCOR 164, XML entities)
// -------------------------------------------------------------
console.log('\nTest 17: Hsctis Grades Edge Cases...');
{
  const complexGradeResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_sub: [
        {
          RQST_PNT: '40',
          COPL_PNT: '40',
          TOAL_SCOR: '164', // 평점 총합 164 (백분율 아님)
          GRDTN_GENE_RAT_AVRG: '4.10',
        },
      ],
      ds_smst: [
        {
          SHYR: '1',
          SMST_GBCD: '1',
          SHYR_SMST: '1학년 1학기',
          COPL_PNT: '20',
          COPL_RAT_AVRG: '4.15',
          SMST_RAT_AVRG: '4.15',
          SCHA_WARN_YN: 'N',
        },
        {
          SHYR: 'Z',
          SMST_GBCD: 'Z',
          SHYR_SMST: '전체학기',
          COPL_PNT: '40',
          COPL_RAT_AVRG: '4.10',
          SMST_RAT_AVRG: '4.10',
          SCHA_WARN_YN: 'N',
        },
      ],
      ds_subj: [
        {
          SHYR: '1',
          SMST_GBCD: '1',
          SHYR_SMST: '1학년 1학기',
          COPL_GBCD: '11', // 교필
          COURSE_CD: 'GE101',
          COURSE_NM: '진로와&#32;상담',
          PNT: '(0)', // 괄호 0학점
          SCRE_GRAD_GBCD: 'P',
          COPL_CNFI_GBCD: '이수',
        },
        {
          SHYR: '1',
          SMST_GBCD: '1',
          SHYR_SMST: '1학년 1학기',
          COPL_GBCD: '21', // 전필
          COURSE_CD: 'CS101',
          COURSE_NM: '소프트웨어&#32;&amp;&#32;인공지능',
          PNT: '3',
          SCRE_GRAD_GBCD: 'A+',
          COPL_CNFI_GBCD: '이수',
        },
        {
          SHYR: '1',
          SMST_GBCD: '1',
          SHYR_SMST: '1학년 1학기',
          COPL_GBCD: '11', // 교필
          COURSE_CD: 'GE102',
          COURSE_NM: '채플',
          PNT: '.5', // 0.5학점
          SCRE_GRAD_GBCD: 'P',
          COPL_CNFI_GBCD: '이수',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };

  const grades = HsctisScraperService['parseGradesData'](complexGradeResult);

  // 17-1. Z 행 제외 확인 (개별 학기 목록에 전체학기가 포함되지 않아야 함)
  assert.strictEqual(grades.semesters.length, 1, 'Only individual semester (Z excluded)');

  // 17-2. 백분율 164 방지 확인
  assert(grades.totalPercentile <= 100, 'totalPercentile must not exceed 100 (TOAL_SCOR 164 excluded)');

  // 17-3. 과목별 파싱 확인
  const subjs = grades.semesters[0].subjects;
  assert.strictEqual(subjs.length, 3);

  // 진로와 상담 (0학점, 교필, XML entity decoding)
  assert.strictEqual(subjs[0].subjNm, '진로와 상담');
  assert.strictEqual(subjs[0].compDiv, '교필');
  assert.strictEqual(subjs[0].credits, 0);

  // 소프트웨어 & 인공지능 (3학점, 전필)
  assert.strictEqual(subjs[1].subjNm, '소프트웨어 & 인공지능');
  assert.strictEqual(subjs[1].compDiv, '전필');
  assert.strictEqual(subjs[1].credits, 3);

  // 채플 (.5 -> 0.5학점)
  assert.strictEqual(subjs[2].credits, 0.5);

  console.log('  -> Hsctis Grades Edge Cases PASSED');
}

// -------------------------------------------------------------
// Test 18: Timetable time-based slots & Graduation criteria mapping
// -------------------------------------------------------------
console.log('\nTest 18: Timetable time slots & Graduation criteria mapping...');
{
  // 18-1. 시간 기반 시간표 파싱
  const timeSlots = HsctisScraperService['parseHanshinScheduleSlots']('월요일(11:00~12:15),수요일(09:30~10:45)');
  assert.strictEqual(timeSlots.length, 2);
  assert.strictEqual(timeSlots[0].dayName, '월');
  assert.strictEqual(timeSlots[0].period, 2); // 11:00은 75분 체계 2교시
  assert.strictEqual(timeSlots[0].timeStr, '11:00 - 12:15');
  assert.strictEqual(timeSlots[1].dayName, '수');
  assert.strictEqual(timeSlots[1].period, 1); // 09:30은 75분 체계 1교시
  assert.strictEqual(timeSlots[1].timeStr, '09:30 - 10:45');

  // 18-2. 종합 시간표 데이터셋
  const ttResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_main: [
        {
          COURSE_NM: '모바일프로그래밍',
          PROF_NM: '김교수',
          CLAS_ROOM_NM: '만우관 301호',
          LESS_DYWEK_GBCD: '화요일(13:30~15:00)',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };
  const timetable = HsctisScraperService['parseTimetableData'](ttResult);
  assert.strictEqual(timetable.length, 1);
  assert.strictEqual(timetable[0].dayName, '화');
  assert.strictEqual(timetable[0].period, 3); // 13:30은 3교시 블록
  assert.strictEqual(timetable[0].timeStr, '13:30 - 15:00');

  // 18-3. 졸업 기준 매핑 (CPNO_MAJR_PNT, CLTR_MINM_ADMIT_PNT)
  const gradResult = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_grdtnPnt: [
        {
          GRDTN_PNT: '130',
          COPL_PNT: '90',
          MAJR_PNT: '66',
          CPNO_MAJR_PNT: '50', // 계열공통/전공 취득
          CLTR_MINM_ADMIT_PNT: '36', // 교양 최소
          CLTR_GET_PNT: '32',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };
  // 서버 응답은 기준 학점만 제공 (취득학점은 성적 데이터로 별도 계산)
  const grad = HsctisScraperService['parseGraduationData'](gradResult);
  assert.strictEqual(grad.totalRequiredCredits, 130);
  assert.strictEqual(grad.majorRequiredCredits, 66);
  assert.strictEqual(grad.generalRequiredCredits, 36);
  assert.strictEqual(grad.totalAcquiredCredits, 0);
  assert.strictEqual(grad.creditsComputed, false);

  console.log('  -> Timetable time slots & Graduation criteria mapping PASSED');
}

// -------------------------------------------------------------
// Test 19: Real HAR hsctis um72_0272005 (Entry 241) dataset parsing
// -------------------------------------------------------------
console.log('\nTest 19: Real HAR hsctis um72_0272005 (Entry 241) dataset parsing...');
{
  const harPath = harFile('hsctis.hs.ac.kr_Archive [26-10-01 00-54-54].har');
  if (fs.existsSync(harPath)) {
    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entry241 = har.log.entries[241];
    assert(entry241, 'Entry 241 must exist in HAR file');
    const xml = entry241.response.content.text;

    const nexaRes = parseDatasets(xml);
    assert(nexaRes.datasets['output1'], 'output1 must exist');
    assert(nexaRes.datasets['output2'], 'output2 must exist');
    assert(nexaRes.datasets['output3'], 'output3 must exist');
    assert(nexaRes.datasets['output4'], 'output4 must exist');

    const grades = HsctisScraperService['parseGradesData'](nexaRes);
    assert.strictEqual(grades.totalAppliedCredits, 56.5, 'Total applied credits must be 56.5');
    assert.strictEqual(grades.totalAcquiredCredits, 47.5, 'Total acquired credits must be 47.5');
    assert.strictEqual(grades.totalGpa, 3.07, 'Total GPA must be 3.07');
    assert.strictEqual(grades.semesters.length, 3, 'Must have 3 semesters');

    const totalSubjCount = grades.semesters.reduce((acc, s) => acc + s.subjects.length, 0);
    assert.strictEqual(totalSubjCount, 24, 'Must have 24 total subjects');

    console.log('  -> Real HAR Entry 241 dataset parsing PASSED');
  } else {
    console.log('  -> Real HAR file not present, skipping Test 19');
  }
}

// -------------------------------------------------------------
// Test 20: isEmergencyNotice (Unified Emergency Notice Filtering)
// -------------------------------------------------------------
console.log('\nTest 20: isEmergencyNotice unified filter with bracket headers and keywords...');
{
  // 20-1. Bracket headers prioritization
  assert.strictEqual(isEmergencyNotice('[긴급] 서버 긴급 점검 및 서비스 중단 안내'), true);
  assert.strictEqual(isEmergencyNotice('[필독] 2026학년도 2학기 중간고사 일정 공지'), true);
  assert.strictEqual(isEmergencyNotice('[휴강] 10월 5일 데이터베이스 휴강 안내'), true);
  assert.strictEqual(isEmergencyNotice('[중요] 1인 미디어 만들기 패들렛 주소'), true);
  assert.strictEqual(isEmergencyNotice('[시험] 운영체제 퀴즈 안내'), true);
  assert.strictEqual(isEmergencyNotice('[보강] 논리회로 보강 수업 공지'), true);
  assert.strictEqual(isEmergencyNotice('[일정변경] 수강신청 정정 기간 변경'), true);

  // 20-2. Normal bracket headers
  assert.strictEqual(isEmergencyNotice('[일반] 교재 구매 안내'), false);
  assert.strictEqual(isEmergencyNotice('[자료] 4주차 강의자료 업로드'), false);
  assert.strictEqual(isEmergencyNotice('[안내] 조별 과제 명단'), false);

  // 20-3. Body keyword fallback
  assert.strictEqual(isEmergencyNotice('수업 관련 공지사항', '교수님 개인 사정으로 이번주 수업은 휴강 안내 드립니다.'), true);
  assert.strictEqual(isEmergencyNotice('학습 자료 안내', '자료실을 확인하시기 바랍니다.'), false);

  // 20-4. Empty and edge cases
  assert.strictEqual(isEmergencyNotice(''), false);
  assert.strictEqual(isEmergencyNotice('   '), false);
  assert.strictEqual(LmsScraperService.isEmergencyNotice('[긴급] 알림'), true);

  console.log('  -> isEmergencyNotice PASSED');
}

// -------------------------------------------------------------
// Test 21: LmsScraperService.calculateDDay (Accurate Deadline & Seconds)
// -------------------------------------------------------------
console.log('\nTest 21: LmsScraperService.calculateDDay parsing and precise calculation...');
{
  // 21-1. Submitted status
  const submittedRes = LmsScraperService.calculateDDay('(종료시한 : 2026.10.15 14:20:30)', true);
  assert.strictEqual(submittedRes.badgeText, '제출완료');
  assert.strictEqual(submittedRes.badgeType, 'done');
  assert.strictEqual(submittedRes.timeLeftText, '제출완료됨');
  assert(submittedRes.deadlineDate !== null, 'Deadline date should be preserved');

  // 21-2. Past deadline
  const pastRes = LmsScraperService.calculateDDay('(종료시한 : 2020.01.01 00:00:00)', false);
  assert.strictEqual(pastRes.badgeText, '마감 지남');
  assert.strictEqual(pastRes.badgeType, 'normal');
  assert.strictEqual(pastRes.timeLeftText, '기한 만료');

  // 21-3. Far future deadline (> 3 days)
  const futureYear = new Date().getFullYear() + 2;
  const farFutureRes = LmsScraperService.calculateDDay(`(종료시한 : ${futureYear}.12.31 23:59:59)`, false);
  assert(farFutureRes.badgeText.startsWith('D-'), 'Far future should start with D-');
  assert.strictEqual(farFutureRes.badgeType, 'normal');

  // 21-4. Missing / invalid date
  const invalidRes = LmsScraperService.calculateDDay('마감일 없음', false);
  assert.strictEqual(invalidRes.badgeText, '마감일 미지정');
  assert.strictEqual(invalidRes.badgeType, 'normal');
  assert.strictEqual(invalidRes.deadlineDate, null);

  // 21-5. Seconds-level precision verification
  const exactDateStr = '(종료시한 : 2026.10.15 14:20:45)';
  const exactRes = LmsScraperService.calculateDDay(exactDateStr, false);
  const parsedD = new Date(exactRes.deadlineDate);
  assert.strictEqual(parsedD.getSeconds(), 45, 'Seconds must be parsed accurately');

  console.log('  -> calculateDDay PASSED');
}

// -------------------------------------------------------------
// Test 22: Real HAR doTodoList.dunet parsing (to_do_type=all)
// -------------------------------------------------------------
console.log('\nTest 22: Real HAR doTodoList.dunet parsing with to_do_type=all...');
{
  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-02 18-36-01].har');
  if (fs.existsSync(harPath)) {
    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entryAll = har.log.entries.filter(e => e.request.url.includes('doTodoList.dunet'))[3];
    assert(entryAll, 'doTodoList to_do_type=all entry must exist');
    const html = entryAll.response.content.text;

    const mockCourses = [
      { course_id: '202620HS00AS012A', class_no: 'A', course_nm: '데이터베이스' },
      { course_id: '202620HS00AS009C', class_no: 'C', course_nm: '논리회로' },
      { course_id: '202620HS00AS011D', class_no: 'D', course_nm: '운영체제' },
      { course_id: '202620HS00SH352A', class_no: 'A', course_nm: '자율지능IoT시스템' },
      { course_id: '202620HS00SH351A', class_no: 'A', course_nm: '인지감성AI에이전트' },
      { course_id: '202620HS00KY508A', class_no: 'A', course_nm: '1인미디어만들기' },
    ];

    const result = LmsScraperService.parseTodoListHtml(html, mockCourses);
    assert.strictEqual(result.assignments.length, 9, 'Must parse exactly 9 assignments');
    assert.strictEqual(result.lectures.length, 40, 'Must parse exactly 40 lectures');
    assert.strictEqual(result.quizzes.length, 1, 'Must parse exactly 1 quiz');
    assert.strictEqual(result.notices.length, 9, 'Must parse exactly 9 notices');

    // Verify Quiz details
    const quiz = result.quizzes[0];
    assert.strictEqual(quiz.courseId, '202620HS00AS011D');
    assert.strictEqual(quiz.courseNm, '운영체제');
    assert.strictEqual(quiz.id, '202620HS00AS011D_quiz_4008');
    assert(quiz.title.includes('운영체제 퀴즈1'), 'Quiz title must match');

    // Verify Lectures progress parsing
    const attendedLecture = result.lectures.find(l => l.progressPercent === 100);
    assert(attendedLecture, 'Must find 100% attended lecture');
    assert.strictEqual(attendedLecture.isAttended, true);

    const unattendedLecture = result.lectures.find(l => l.progressPercent === 0);
    assert(unattendedLecture, 'Must find 0% lecture');
    assert.strictEqual(unattendedLecture.isAttended, false);

    console.log('  -> Real HAR doTodoList.dunet parsing PASSED');
  } else {
    console.log('  -> Real HAR file not present, skipping Test 22');
  }
}

// -------------------------------------------------------------
// Test 23: parseCompletedItemIds and Submitted Matching
// -------------------------------------------------------------
console.log('\nTest 23: parseCompletedItemIds and submission state integration...');
{
  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-02 18-36-01].har');
  if (fs.existsSync(harPath)) {
    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entryComplete = har.log.entries.filter(e => e.request.url.includes('doTodoList.dunet'))[1];
    const entryAll = har.log.entries.filter(e => e.request.url.includes('doTodoList.dunet'))[3];
    assert(entryComplete && entryAll, 'Both complete and all entries must exist');

    const completeHtml = entryComplete.response.content.text;
    const allHtml = entryAll.response.content.text;

    const completedIds = LmsScraperService.parseCompletedItemIds(completeHtml);
    assert(completedIds.has('55435'), 'Assignment 55435 must be completed');
    assert(completedIds.has('55800'), 'Assignment 55800 must be completed');
    assert(completedIds.has('55565'), 'Assignment 55565 must be completed');
    assert(completedIds.has('55420'), 'Assignment 55420 must be completed');
    assert(!completedIds.has('56040'), 'Assignment 56040 must NOT be in completed list');

    const result = LmsScraperService.parseTodoListHtml(allHtml, [], completedIds);
    const submittedItems = result.assignments.filter(a => a.isSubmitted);
    const unsubmittedItems = result.assignments.filter(a => !a.isSubmitted);

    assert.strictEqual(submittedItems.length, 4, 'Must have 4 submitted assignments');
    assert.strictEqual(unsubmittedItems.length, 5, 'Must have 5 unsubmitted assignments');

    console.log('  -> Completed ID extraction & submission matching PASSED');
  } else {
    console.log('  -> Real HAR file not present, skipping Test 23');
  }
}

// -------------------------------------------------------------
// Test 24: cleanLecName & parseLectureDeadline & Lecture Sorting
// -------------------------------------------------------------
console.log('\nTest 24: cleanLecName, parseLectureDeadline & Lecture sorting...');
{
  // 24-1. cleanLecName bracket variations
  assert.strictEqual(cleanLecName('[2026-2학기)데이터베이스(A반)]'), '데이터베이스(A반)');
  assert.strictEqual(cleanLecName('[2026-1학기] 컴퓨터구조'), '컴퓨터구조');
  assert.strictEqual(cleanLecName('(2026-2학기) 운영체제'), '운영체제');
  assert.strictEqual(cleanLecName('자율지능IoT시스템'), '자율지능IoT시스템');

  // 24-2. parseLectureDeadline
  const dl1 = parseLectureDeadline('(종료시한 : 2026.09.07 23:59:59)');
  const d1 = new Date(dl1);
  assert.strictEqual(d1.getFullYear(), 2026);
  assert.strictEqual(d1.getMonth(), 8); // September (0-indexed)
  assert.strictEqual(d1.getDate(), 7);
  assert.strictEqual(d1.getHours(), 23);
  assert.strictEqual(d1.getMinutes(), 59);
  assert.strictEqual(d1.getSeconds(), 59);

  const dl2 = parseLectureDeadline('2026.09.01 ~ 2026.09.14');
  const d2 = new Date(dl2);
  assert.strictEqual(d2.getFullYear(), 2026);
  assert.strictEqual(d2.getMonth(), 8);
  assert.strictEqual(d2.getDate(), 14);

  const dl3 = parseLectureDeadline('출석 기간');
  assert.strictEqual(dl3, Infinity);

  // 24-3. Lecture sorting (unattended sorted by earliest deadline first)
  const mockLectures = [
    { id: '1', courseNm: 'B', title: '강의2', periodStr: '(종료시한 : 2026.09.14 23:59:59)', isAttended: false },
    { id: '2', courseNm: 'A', title: '강의1', periodStr: '(종료시한 : 2026.09.07 23:59:59)', isAttended: false },
    { id: '3', courseNm: 'C', title: '강의3', periodStr: '(종료시한 : 2026.09.01 23:59:59)', isAttended: true },
  ];

  mockLectures.sort((a, b) => {
    if (a.isAttended !== b.isAttended) return a.isAttended ? 1 : -1;
    const aDl = parseLectureDeadline(a.periodStr);
    const bDl = parseLectureDeadline(b.periodStr);
    if (aDl !== bDl) return aDl - bDl;
    return a.title.localeCompare(b.title);
  });

  assert.strictEqual(mockLectures[0].title, '강의1', 'Earliest unattended deadline must come first');
  assert.strictEqual(mockLectures[1].title, '강의2', 'Later unattended deadline must come second');
  assert.strictEqual(mockLectures[2].title, '강의3', 'Attended lecture must come last');

  console.log('  -> cleanLecName, parseLectureDeadline & Lecture sorting PASSED');
}

// -------------------------------------------------------------
// Test 25: Tab 9 clean notice date & Assignment active vs expired sorting
// -------------------------------------------------------------
console.log('\nTest 25: Tab 9 clean notice date & Assignment active/expired sorting...');
{
  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-02 18-36-01].har');
  if (fs.existsSync(harPath)) {
    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entryAll = har.log.entries.filter(e => e.request.url.includes('doTodoList.dunet'))[3];
    const html = entryAll.response.content.text;
    const result = LmsScraperService.parseTodoListHtml(html);

    // Verify Tab 9 notices dateStr does not have redundant (등록일 : ...) wrapper
    assert(result.notices.length > 0, 'Must have parsed notices');
    for (const n of result.notices) {
      assert(!n.dateStr.includes('등록일 :'), 'dateStr must not contain raw "등록일 :" prefix');
      assert(!n.dateStr.startsWith('(') && !n.dateStr.endsWith(')'), 'dateStr must not have surrounding parens');
    }
  }

  // Verify Assignment sorting: active upcoming before expired
  const now = new Date('2026-10-04T12:00:00Z');
  const nowMs = now.getTime();
  const mockAssignments = [
    { id: '1', title: '만료된 과제', deadlineDate: new Date('2026-09-01T23:59:00Z').toISOString(), isSubmitted: false },
    { id: '2', title: '오늘 마감 과제', deadlineDate: new Date('2026-10-04T18:00:00Z').toISOString(), isSubmitted: false },
    { id: '3', title: '내일 마감 과제', deadlineDate: new Date('2026-10-05T23:59:00Z').toISOString(), isSubmitted: false },
    { id: '4', title: '제출완료된 과제', deadlineDate: new Date('2026-10-01T23:59:00Z').toISOString(), isSubmitted: true },
  ];

  mockAssignments.sort((a, b) => {
    if (a.isSubmitted !== b.isSubmitted) return a.isSubmitted ? 1 : -1;
    if (a.deadlineDate && b.deadlineDate) {
      const aTime = new Date(a.deadlineDate).getTime();
      const bTime = new Date(b.deadlineDate).getTime();
      const aExpired = aTime < nowMs;
      const bExpired = bTime < nowMs;
      if (aExpired !== bExpired) return aExpired ? 1 : -1;
      if (!aExpired) return aTime - bTime;
      return bTime - aTime;
    }
    if (!a.deadlineDate) return 1;
    if (!b.deadlineDate) return -1;
    return 0;
  });

  assert.strictEqual(mockAssignments[0].title, '오늘 마감 과제', 'Active soonest deadline must be first');
  assert.strictEqual(mockAssignments[1].title, '내일 마감 과제', 'Active later deadline must be second');
  assert.strictEqual(mockAssignments[2].title, '만료된 과제', 'Expired unsubmitted must be placed after active');
  assert.strictEqual(mockAssignments[3].title, '제출완료된 과제', 'Submitted assignment must be last');

  console.log('  -> Tab 9 clean notice date & Assignment active/expired sorting PASSED');
}

// -------------------------------------------------------------
// Test 26: Edge Cases - 2-digit years, robust date parsing, parenthesized urgent notices, lecture sorting
// -------------------------------------------------------------
console.log('\nTest 26: Phase 3 Edge Cases (2-digit years, hyphens/no-time DDay, paren/body urgent notices, lecture sorting, regex fallback)...');
{
  // 26-1. cleanLecName with 2-digit years
  assert.strictEqual(cleanLecName('[26-2학기] 운영체제'), '운영체제');
  assert.strictEqual(cleanLecName('(26-1) 논리회로'), '논리회로');
  assert.strictEqual(cleanLecName('[26/2학기) 데이터베이스(B반)]'), '데이터베이스(B반)');

  // 26-2. parseLectureDeadline with hyphens, slashes, and no time
  const dlHyphen = parseLectureDeadline('2026-10-15 14:20');
  const dHyphen = new Date(dlHyphen);
  assert.strictEqual(dHyphen.getFullYear(), 2026);
  assert.strictEqual(dHyphen.getMonth(), 9);
  assert.strictEqual(dHyphen.getDate(), 15);
  assert.strictEqual(dHyphen.getHours(), 14);
  assert.strictEqual(dHyphen.getMinutes(), 20);

  const dlNoTime = parseLectureDeadline('2026.10.15');
  const dNoTime = new Date(dlNoTime);
  assert.strictEqual(dNoTime.getFullYear(), 2026);
  assert.strictEqual(dNoTime.getMonth(), 9);
  assert.strictEqual(dNoTime.getDate(), 15);
  assert.strictEqual(dNoTime.getHours(), 23);
  assert.strictEqual(dNoTime.getMinutes(), 59);

  // 26-3. calculateDDay with hyphen and no-time
  const ddayHyphen = LmsScraperService.calculateDDay('2026-10-15 14:20:00', false);
  assert(ddayHyphen.deadlineDate !== null, 'Hyphen date must produce deadlineDate');
  assert(ddayHyphen.deadlineDate.startsWith('2026-10-15'), 'Deadline date string match');

  const ddaySubmittedHyphen = LmsScraperService.calculateDDay('2026-10-15 14:20:00', true);
  assert.strictEqual(ddaySubmittedHyphen.badgeText, '제출완료');
  assert(ddaySubmittedHyphen.deadlineDate !== null);

  const ddayNoTime = LmsScraperService.calculateDDay('2026.10.15', false);
  assert(ddayNoTime.deadlineDate !== null, 'Date without time must produce deadlineDate');

  // 26-4. isEmergencyNotice with parenthesized headers and body variations
  assert.strictEqual(isEmergencyNotice('(긴급) 서버 점검 안내'), true);
  assert.strictEqual(isEmergencyNotice('(휴강) 10월 5일 휴강 안내'), true);
  assert.strictEqual(isEmergencyNotice('(중요) 강의실 변경 안내'), true);
  assert.strictEqual(isEmergencyNotice('2학기 중간고사 시험 안내'), true);
  assert.strictEqual(isEmergencyNotice('과제 마감 연장 공지'), true);
  assert.strictEqual(isEmergencyNotice('운영체제 퀴즈 안내'), true);
  assert.strictEqual(isEmergencyNotice('수업 공지', '이번 주 수업은 휴강합니다.'), true);
  assert.strictEqual(isEmergencyNotice('강의 공지', '보강 수업을 진행합니다.'), true);
  assert.strictEqual(isEmergencyNotice('공지사항', '시스템 점검으로 서비스가 일시 중단됩니다.'), true);

  // 26-5. Lecture sorting: active unattended before expired unattended
  const nowMs = new Date(2026, 9, 4, 12, 0, 0).getTime();
  const testLectures = [
    { id: '1', title: '지난 강의 (만료)', periodStr: '(종료시한 : 2026.09.07 23:59:59)', isAttended: false },
    { id: '2', title: '오늘 마감 강의 (활성)', periodStr: '(종료시한 : 2026.10.04 18:00:00)', isAttended: false },
    { id: '3', title: '내일 마감 강의 (활성)', periodStr: '(종료시한 : 2026.10.05 23:59:59)', isAttended: false },
    { id: '4', title: '출석 완료 강의', periodStr: '(종료시한 : 2026.09.01 23:59:59)', isAttended: true },
  ];

  testLectures.sort((a, b) => {
    if (a.isAttended !== b.isAttended) return a.isAttended ? 1 : -1;
    const aDeadline = parseLectureDeadline(a.periodStr);
    const bDeadline = parseLectureDeadline(b.periodStr);
    const aHasDeadline = aDeadline !== Infinity;
    const bHasDeadline = bDeadline !== Infinity;

    if (aHasDeadline && bHasDeadline) {
      const aExpired = aDeadline < nowMs;
      const bExpired = bDeadline < nowMs;
      if (aExpired !== bExpired) return aExpired ? 1 : -1;
      if (!aExpired) return aDeadline - bDeadline;
      return bDeadline - aDeadline;
    }
    if (!aHasDeadline && bHasDeadline) return 1;
    if (aHasDeadline && !bHasDeadline) return -1;
    return a.title.localeCompare(b.title);
  });

  assert.strictEqual(testLectures[0].title, '오늘 마감 강의 (활성)', 'Active upcoming lecture must be first');
  assert.strictEqual(testLectures[1].title, '내일 마감 강의 (활성)', 'Active later lecture must be second');
  assert.strictEqual(testLectures[2].title, '지난 강의 (만료)', 'Expired unattended lecture must come after active');
  assert.strictEqual(testLectures[3].title, '출석 완료 강의', 'Attended lecture must come last');

  // 26-6. Fallback regex with multiple classes on li and onclick attribute
  const multiClassHtml = `
    <li class="tab tab5 active on">
      <a href="#" onclick="fnGoContent('3', '202620HS00AS012A', 'A', '56040', 'S')">
        <div class="info">
          <span class="cata cata_task">과제</span>
          <span class="lec_name">[26-2학기] 데이터베이스(A반)</span>
          <span class="subject">실습 1 새 글이 등록되었습니다.</span>
        </div>
        <div class="date">
          <span>(종료시한 : 2026-10-15 23:59:00)</span>
        </div>
      </a>
    </li>
  `;
  const parsedMulti = LmsScraperService.parseTodoListHtml(multiClassHtml, [], new Set(['56040']));
  assert.strictEqual(parsedMulti.assignments.length, 1);
  assert.strictEqual(parsedMulti.assignments[0].courseId, '202620HS00AS012A');
  assert.strictEqual(parsedMulti.assignments[0].courseNm, '데이터베이스(A반)');
  assert.strictEqual(parsedMulti.assignments[0].title, '실습 1');
  assert.strictEqual(parsedMulti.assignments[0].isSubmitted, true);
  assert.strictEqual(parsedMulti.assignments[0].statusInfo, '제출완료');

  console.log('  -> Test 26 Edge Cases PASSED');
}

// -------------------------------------------------------------
// Test 27: Notification deterministic 1:1 ID mapping & scheduling (Phase 1)
// -------------------------------------------------------------
console.log('\nTest 27: Notification deterministic 1:1 ID mapping & scheduling & cancellation...');
{
  // 27-1. Deterministic hashing properties
  const h1 = hashNotificationId('tab5_56040');
  const h2 = hashNotificationId('tab5_56040');
  assert.strictEqual(h1, h2, 'Hashing the same assignment ID must be strictly deterministic');
  assert(h1 >= 1 && h1 <= 2147483647, 'Hash must be a positive 31-bit integer');

  const hDiff = hashNotificationId('tab5_56041');
  assert.notStrictEqual(h1, hDiff, 'Different assignment IDs must yield different notification IDs');

  // Fallbacks & edge cases
  assert.strictEqual(hashNotificationId(''), 1, 'Empty string must return safe fallback 1');
  assert.strictEqual(hashNotificationId(null), 1, 'Null must return safe fallback 1');
  assert.strictEqual(hashNotificationId(undefined), 1, 'Undefined must return safe fallback 1');
  assert.strictEqual(hashNotificationId(12345), 1, 'Non-string must return safe fallback 1');
  assert.strictEqual(toNotificationNumericId(undefined), hashNotificationId('hs_lms_notification'));
  assert.strictEqual(toNotificationNumericId(100), 100);
  assert.strictEqual(toNotificationNumericId(-100), 100);
  assert.strictEqual(toNotificationNumericId(NaN), hashNotificationId('hs_lms_notification'));
  assert.strictEqual(toNotificationNumericId(Infinity), hashNotificationId('hs_lms_notification'));
  assert.strictEqual(toNotificationNumericId(-Infinity), hashNotificationId('hs_lms_notification'));

  // NotificationService.getNotificationId
  assert.strictEqual(NotificationService.getNotificationId('tab5_56040'), h1);

  // Setup mock for LocalNotifications
  class MockNotification {
    static permission = 'granted';
    static async requestPermission() { return 'granted'; }
    constructor(title, opts) {
      this.title = title;
      this.body = opts?.body;
      this.tag = opts?.tag;
    }
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.window = globalThis;
  globalThis.Notification = MockNotification;

  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...args) => {
    const timer = origSetTimeout(fn, Math.min(delay || 0, 10), ...args);
    timer.unref?.();
    return timer;
  };

  try {
    // 27-2. Future reminder scheduling (deterministic ID & overwrite support)
    const futureTime = Date.now() + 60 * 60 * 1000;
    const scheduledId = await NotificationService.scheduleReminderNotification({
      id: 'tab5_56040',
      title: '데이터베이스 과제 1',
      body: '마감 1시간 전입니다.',
      scheduleAt: futureTime,
    });
    assert.strictEqual(scheduledId, h1, 'Scheduled notification ID must match deterministic hash of assignment ID');

    // Overwrite test with positional parameters
    const overwriteId = await NotificationService.scheduleReminderNotification(
      'tab5_56040',
      '데이터베이스 과제 1 [수정]',
      '마감 30분 전입니다.',
      futureTime + 1000
    );
    assert.strictEqual(overwriteId, h1, 'Overwriting notification with the same ID must keep identical numeric ID');

    // Scheduling with ISO string date
    const isoStringDate = new Date(futureTime + 2000).toISOString();
    const isoScheduledId = await NotificationService.scheduleReminderNotification({
      id: 'tab5_56040',
      title: '데이터베이스 과제 1 [ISO]',
      body: '마감 25분 전입니다.',
      scheduleAt: isoStringDate,
    });
    assert.strictEqual(isoScheduledId, h1, 'ISO string date scheduling must succeed with matching deterministic ID');

    // 27-3. Past reminder time or invalid ID should not schedule (returns null)
    const pastId = await NotificationService.scheduleReminderNotification({
      id: 'tab5_56040',
      title: '지난 과제',
      body: '과거 마감',
      scheduleAt: Date.now() - 1000,
    });
    assert.strictEqual(pastId, null, 'Past reminder time must return null without scheduling');

    const emptyIdRes = await NotificationService.scheduleReminderNotification({
      id: '',
      title: '과제',
      body: '내용',
      scheduleAt: futureTime,
    });
    assert.strictEqual(emptyIdRes, null, 'Empty string ID must return null without scheduling');

    const nullIdRes = await NotificationService.scheduleReminderNotification({
      id: null,
      title: '과제',
      body: '내용',
      scheduleAt: futureTime,
    });
    assert.strictEqual(nullIdRes, null, 'Null ID must return null without scheduling');

    const invalidDateRes = await NotificationService.scheduleReminderNotification({
      id: 'tab5_56040',
      title: '과제',
      body: '내용',
      scheduleAt: 'not-a-valid-date-str',
    });
    assert.strictEqual(invalidDateRes, null, 'Invalid schedule date must return null without scheduling');

    // 27-4. Cancellation of specific assignment notification & invalid input safety
    const cancelResult = await NotificationService.cancelAssignmentNotification('tab5_56040');
    assert.strictEqual(cancelResult, true, 'Cancellation of assignment notification must succeed');

    const cancelEmpty = await NotificationService.cancelAssignmentNotification('');
    assert.strictEqual(cancelEmpty, false, 'Cancellation with empty ID must safely return false');

    const cancelNull = await NotificationService.cancelAssignmentNotification(null);
    assert.strictEqual(cancelNull, false, 'Cancellation with null ID must safely return false');

    const cancelUndefined = await NotificationService.cancelAssignmentNotification(undefined);
    assert.strictEqual(cancelUndefined, false, 'Cancellation with undefined ID must safely return false');

    const cancelNaN = await NotificationService.cancelAssignmentNotification(NaN);
    assert.strictEqual(cancelNaN, false, 'Cancellation with NaN ID must safely return false');

    // 27-5. sendLocalNotification deterministic fallback ID (no Math.random())
    const idA = await NotificationService.sendLocalNotification('과제 알림', '내용');
    const idB = await NotificationService.sendLocalNotification('과제 알림', '내용');
    assert.strictEqual(idA, idB, 'sendLocalNotification without ID must deterministically hash title and body');
    assert(idA >= 1 && idA <= 2147483647);
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }

  console.log('  -> Test 27 Notification deterministic 1:1 ID mapping & scheduling PASSED');
}

// -------------------------------------------------------------
// Test 28: Phase 2 - BackgroundSync & Session Policy
// -------------------------------------------------------------
console.log('\nTest 28: Phase 2 - BackgroundSync & Session Policy Verification...');
{
  const { LmsAuthService } = await import('../src/services/lmsAuth.js');
  const { configureBackgroundSync, getBackgroundSyncStatus } = await import('../src/services/backgroundSync.js');
  const { HttpClient } = await import('../src/services/httpClient.js');

  // 28-1. configureBackgroundSync and getBackgroundSyncStatus (Web fallback)
  const conf1 = await configureBackgroundSync(true, 15);
  assert.strictEqual(conf1, true, 'configureBackgroundSync(true, 15) must succeed');
  const st1 = await getBackgroundSyncStatus();
  assert.strictEqual(st1.enabled, true, 'Status enabled must be true');
  assert.strictEqual(st1.intervalMinutes, 15, 'Status interval must be 15');

  const conf2 = await configureBackgroundSync(false, 60);
  assert.strictEqual(conf2, true, 'configureBackgroundSync(false, 60) must succeed');
  const st2 = await getBackgroundSyncStatus();
  assert.strictEqual(st2.enabled, false, 'Status enabled must be false');
  assert.strictEqual(st2.intervalMinutes, 60, 'Status interval must be 60');

  // 28-2. LmsAuthService.isSessionValid with mock responses
  const origPost = HttpClient.post;
  try {
    // Valid session test
    HttpClient.post = async () => ({
      data: { data: { user_no: '20240001', user_name: '테스트' } },
      status: 200,
      headers: {},
      url: '',
    });
    const isValid1 = await LmsAuthService.isSessionValid();
    assert.strictEqual(isValid1, true, 'isSessionValid must be true for valid user_no');
    assert.strictEqual(LmsAuthService.getUserNo(), '20240001');
    assert.strictEqual(LmsAuthService.getUserName(), '테스트');
    assert.strictEqual(LmsAuthService.isLoggedIn(), true);

    // Invalidate session
    LmsAuthService.invalidateSession();
    assert.strictEqual(LmsAuthService.isLoggedIn(), false);

    // Expired session test (empty user_no)
    HttpClient.post = async () => ({
      data: { data: {} },
      status: 200,
      headers: {},
      url: '',
    });
    const isValid2 = await LmsAuthService.isSessionValid();
    assert.strictEqual(isValid2, false, 'isSessionValid must be false for empty user_no');
    assert.strictEqual(LmsAuthService.isLoggedIn(), false);

    // Redirect HTML response (session expired / login page)
    HttpClient.post = async () => ({
      data: '<html><script>location.href="https://sso2.hs.ac.kr/login";</script></html>',
      status: 200,
      headers: {},
      url: '',
    });
    const isValid3 = await LmsAuthService.isSessionValid();
    assert.strictEqual(isValid3, false, 'isSessionValid must be false when response is HTML redirect');

    // Network error test (must return false without throwing disruptive errors)
    HttpClient.post = async () => {
      throw new Error('Network timeout');
    };
    const isValid4 = await LmsAuthService.isSessionValid();
    assert.strictEqual(isValid4, false, 'isSessionValid must safely return false on network failure');

    // 28-3. Login with force = false reuses valid session (protects PC session)
    let ssoCallCount = 0;
    HttpClient.post = async (opts) => {
      if (opts.url.includes('select/getSessionInfo.dunet')) {
        return {
          data: { data: { user_no: '20240001', user_name: '홍길동' } },
          status: 200,
          headers: {},
          url: '',
        };
      }
      if (opts.url.includes('authoriza.do')) {
        ssoCallCount++;
        return { data: { error: '0000', code: 'test_code' }, status: 200, headers: {}, url: '' };
      }
      return { data: 'name="access_token" value="dummy"', status: 200, headers: {}, url: '' };
    };

    const loginRes = await LmsAuthService.login('20240001', 'password123', false);
    assert.strictEqual(loginRes, true, 'login with valid session must succeed');
    assert.strictEqual(ssoCallCount, 0, 'Must NOT invoke SSO login when session is already valid');

    // 28-3b. Login with force = false WHEN session is EXPIRED must silently invoke SSO re-auth
    let ssoReauthCount = 0;
    const origGet = HttpClient.get;
    try {
      HttpClient.get = async () => ({
        data: '<input type="hidden" id="loginIp" value="127.0.0.1" />',
        status: 200,
        headers: {},
        url: '',
      });
      HttpClient.post = async (opts) => {
        if (opts.url.includes('select/getSessionInfo.dunet')) {
          // First check returns expired session
          return { data: { data: {} }, status: 200, headers: {}, url: '' };
        }
        if (opts.url.includes('authoriza.do')) {
          ssoReauthCount++;
          return { data: { error: '0000', code: 'reauth_code' }, status: 200, headers: {}, url: '' };
        }
        if (opts.url.includes('token2.do')) {
          return { data: 'name="access_token" value="reauth_token"', status: 200, headers: {}, url: '' };
        }
        if (opts.url.includes('MainView.dunet')) {
          return { data: '<div class="learn_pds"></div>', status: 200, headers: {}, url: '' };
        }
        return { data: {}, status: 200, headers: {}, url: '' };
      };

      const reauthRes = await LmsAuthService.login('20240001', 'password123', false);
      assert.strictEqual(reauthRes, true, 'Silent re-auth must succeed');
      assert.strictEqual(ssoReauthCount, 1, 'Must invoke SSO re-auth when session was expired');
    } finally {
      HttpClient.get = origGet;
    }
  } finally {
    HttpClient.post = origPost;
  }

  // 28-4. Background sync worker HTML session expiry detection rules
  const validTodoListHtml = `
    <div class="todolist_pop">
      <ul class="todolist_list">
        <li class="tab tab5">
          <a href="javascript:fnGoContent('1', '202620HS00AS012A', 'A', '56040');">
            <span class="lec_name">데이터베이스</span>
            <span class="subject">SQL 과제 1 새로운 글이 등록되었습니다.</span>
          </a>
          <div class="date"><span>(종료시한 : 2026.10.15 14:20:00)</span></div>
        </li>
      </ul>
    </div>
  `;
  const isExpired1 = !validTodoListHtml.includes('todolist_pop') || validTodoListHtml.includes('sso2.hs.ac.kr');
  assert.strictEqual(isExpired1, false, 'Valid todolist HTML must not be expired');

  const expiredHtml = `
    <html>
      <head><title>SSO Login</title></head>
      <body><a href="https://sso2.hs.ac.kr/login">로그인이 필요합니다</a></body>
    </html>
  `;
  const isExpired2 = !expiredHtml.includes('todolist_pop') || expiredHtml.includes('sso2.hs.ac.kr') || expiredHtml.includes('로그인이 필요합니다');
  assert.strictEqual(isExpired2, true, 'SSO / Login page must be flagged as expired session');

  // 28-5. Course name cleaning with mismatched brackets (protect against empty courseNm in background notifications)
  const cleanWorkerLecName = (raw) => {
    return raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/^[\(\[]\d{2,4}[^\]\)]*[\]\)]\s*/, '')
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .trim();
  };
  assert.strictEqual(cleanWorkerLecName('[2026-2학기)데이터베이스(A반)]'), '데이터베이스(A반)');
  assert.strictEqual(cleanWorkerLecName('[2026-1학기] 컴퓨터구조'), '컴퓨터구조');
  assert.strictEqual(cleanWorkerLecName('(26-1) 논리회로'), '논리회로');

  console.log('  -> Test 28 Phase 2 BackgroundSync & Session Policy PASSED');
}

// -------------------------------------------------------------
// Test 29: Phase 4 - 75-minute class schedule, deterministic color index & block parsing
// -------------------------------------------------------------
console.log('\nTest 29: Phase 4 - 75-minute class schedule, deterministic color index & block parsing...');
{
  // 29-1. 75-minute period blocks verification
  assert.strictEqual(PERIOD_TIMES[1], '09:30 - 10:45', '1교시: 09:30 - 10:45');
  assert.strictEqual(PERIOD_TIMES[2], '11:00 - 12:15', '2교시: 11:00 - 12:15');
  assert.strictEqual(PERIOD_TIMES[3], '13:00 - 14:15', '3교시: 13:00 - 14:15');
  assert.strictEqual(PERIOD_TIMES[4], '14:30 - 15:45', '4교시: 14:30 - 15:45');
  assert.strictEqual(PERIOD_TIMES[5], '16:00 - 17:15', '5교시: 16:00 - 17:15');
  assert.strictEqual(PERIOD_TIMES[6], '17:30 - 18:45', '6교시 (야간): 17:30 - 18:45');
  assert.strictEqual(PERIOD_TIMES[7], '19:00 - 20:15', '7교시 (야간): 19:00 - 20:15');
  assert.strictEqual(PERIOD_TIMES[8], '20:30 - 21:45', '8교시 (야간): 20:30 - 21:45');

  // 29-2. Consistent deterministic hash coloring across days
  const dbMon = getSubjectColorIndex('데이터베이스');
  const dbWed = getSubjectColorIndex('데이터베이스');
  assert.strictEqual(dbMon, dbWed, 'Identical subjects on different days must yield identical color index');

  const iotMon = getSubjectColorIndex('자율지능IoT시스템');
  const iotWed = getSubjectColorIndex('자율지능IoT시스템');
  assert.strictEqual(iotMon, iotWed);

  const logicMon = getSubjectColorIndex('논리회로');
  const logicWed = getSubjectColorIndex('논리회로');
  assert.strictEqual(logicMon, logicWed);

  const osThu = getSubjectColorIndex('운영체제');
  assert.notStrictEqual(dbMon, iotMon, 'Different subjects must have distinct colors in palette');

  // Any arbitrary subject hash validity
  const testSubjColor = getSubjectColorIndex('임의의 신설 교양 과목');
  assert(testSubjColor >= 0 && testSubjColor < 8, 'Color index must be within 0..7 palette range');

  // 29-3. Period-based parsing (월1,2,목3,4)
  const periodSlots = HsctisScraperService.parseHanshinScheduleSlots('월1,2,목3,4');
  assert.strictEqual(periodSlots.length, 4);
  assert.strictEqual(periodSlots[0].dayName, '월');
  assert.strictEqual(periodSlots[0].period, 1);
  assert.strictEqual(periodSlots[0].timeStr, '09:30 - 10:45');
  assert.strictEqual(periodSlots[1].dayName, '월');
  assert.strictEqual(periodSlots[1].period, 2);
  assert.strictEqual(periodSlots[1].timeStr, '11:00 - 12:15');
  assert.strictEqual(periodSlots[2].dayName, '목');
  assert.strictEqual(periodSlots[2].period, 3);
  assert.strictEqual(periodSlots[2].timeStr, '13:00 - 14:15');
  assert.strictEqual(periodSlots[3].dayName, '목');
  assert.strictEqual(periodSlots[3].period, 4);
  assert.strictEqual(periodSlots[3].timeStr, '14:30 - 15:45');

  // 29-4. Sample timetable consistency
  const sample = HsctisScraperService.getSampleAcademicData();
  const monDb = sample.timetable.find(t => t.dayName === '월' && t.subjectNm === '데이터베이스');
  const wedDb = sample.timetable.find(t => t.dayName === '수' && t.subjectNm === '데이터베이스');
  assert(monDb && wedDb, 'Both Monday and Wednesday Database classes must exist');
  assert.strictEqual(monDb.colorIndex, wedDb.colorIndex, 'Sample DB colorIndex must match on Mon and Wed');
  assert.strictEqual(monDb.timeStr, '11:00 - 12:15');
  assert.strictEqual(wedDb.timeStr, '09:30 - 10:45');

  // 29-5. Contiguous block merging on the same day
  const thuItems = [
    {
      id: 'tt_11',
      dayOfWeek: 4,
      dayName: '목',
      period: 3,
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
      timeStr: '14:30 - 15:45',
      subjectNm: '운영체제',
      profNm: '강교수',
      classroom: '18521()',
      colorIndex: 4,
    },
  ];

  const mergedThu = mergeDayTimetable(thuItems);
  assert.strictEqual(mergedThu.length, 1, 'Consecutive periods of the same subject on Thursday must merge into 1 card');
  assert.strictEqual(mergedThu[0].subjectNm, '운영체제');
  assert.strictEqual(mergedThu[0].periodStart, 3);
  assert.strictEqual(mergedThu[0].periodEnd, 4);
  assert.strictEqual(mergedThu[0].startMinutes, 13 * 60); // 780
  assert.strictEqual(mergedThu[0].endMinutes, 15 * 60 + 45); // 945
  assert.strictEqual(mergedThu[0].timeStr, '13:00 - 15:45');
  assert.strictEqual(mergedThu[0].rawItems.length, 2);

  // Non-consecutive or different subjects must NOT merge
  const mixedItems = [
    {
      id: 'm1',
      dayOfWeek: 1,
      dayName: '월',
      period: 1,
      timeStr: '09:30 - 10:45',
      subjectNm: '자율지능IoT시스템',
      profNm: '',
      classroom: '18424()',
    },
    {
      id: 'm2',
      dayOfWeek: 1,
      dayName: '월',
      period: 2,
      timeStr: '11:00 - 12:15',
      subjectNm: '데이터베이스',
      profNm: '',
      classroom: '18308()',
    },
  ];
  const mergedMixed = mergeDayTimetable(mixedItems);
  assert.strictEqual(mergedMixed.length, 2, 'Different subjects must not merge');

  // 29-6. 8-color palette properties
  assert.strictEqual(SUBJECT_PALETTE.length, 8, 'Palette must have exactly 8 colors');
  for (const c of SUBJECT_PALETTE) {
    assert(c.bg.startsWith('#'), 'Palette color bg must be a valid hex code');
    assert(c.name.length > 0, 'Palette color must have a name');
    assert(c.cardClass.includes('text-white'), 'Palette card text must be crisp white');
  }

  // 29-7. Empty / Malformed schedule slot edge cases
  assert.deepStrictEqual(HsctisScraperService.parseHanshinScheduleSlots(''), []);
  assert.deepStrictEqual(HsctisScraperService.parseHanshinScheduleSlots(null), []);
  assert.deepStrictEqual(HsctisScraperService.parseHanshinScheduleSlots(undefined), []);
  assert.deepStrictEqual(HsctisScraperService.parseHanshinScheduleSlots('   '), []);

  // Single bare time string
  const bareSlots = HsctisScraperService.parseHanshinScheduleSlots('09:30~10:45');
  assert.strictEqual(bareSlots.length, 1);
  assert.strictEqual(bareSlots[0].period, 1);
  assert.strictEqual(bareSlots[0].timeStr, '09:30 - 10:45');

  // 29-8. Period ranges (~, -) and '교시' suffix tests
  const rangeTilde = HsctisScraperService.parseHanshinScheduleSlots('월1~2');
  assert.strictEqual(rangeTilde.length, 2, '월1~2 must parse into 2 periods');
  assert.strictEqual(rangeTilde[0].period, 1);
  assert.strictEqual(rangeTilde[1].period, 2);

  const rangeHyphen = HsctisScraperService.parseHanshinScheduleSlots('목3-4');
  assert.strictEqual(rangeHyphen.length, 2, '목3-4 must parse into 2 periods');
  assert.strictEqual(rangeHyphen[0].period, 3);
  assert.strictEqual(rangeHyphen[1].period, 4);

  const suffixKyoshi = HsctisScraperService.parseHanshinScheduleSlots('월1교시,2교시');
  assert.strictEqual(suffixKyoshi.length, 2, '월1교시,2교시 must parse into 2 periods');
  assert.strictEqual(suffixKyoshi[0].period, 1);
  assert.strictEqual(suffixKyoshi[1].period, 2);

  const suffixRangeKyoshi = HsctisScraperService.parseHanshinScheduleSlots('화1~3교시');
  assert.strictEqual(suffixRangeKyoshi.length, 3, '화1~3교시 must parse into 3 periods');
  assert.strictEqual(suffixRangeKyoshi[0].period, 1);
  assert.strictEqual(suffixRangeKyoshi[1].period, 2);
  assert.strictEqual(suffixRangeKyoshi[2].period, 3);

  // Bare period string without day name
  const barePeriods = HsctisScraperService.parseHanshinScheduleSlots('1,2');
  assert.strictEqual(barePeriods.length, 2, 'Bare 1,2 must parse into 2 periods');
  assert.strictEqual(barePeriods[0].period, 1);
  assert.strictEqual(barePeriods[1].period, 2);

  // 29-9. Merge boundary check: same subject on different days must NEVER merge
  const multiDayItems = [
    {
      id: 'm_mon',
      dayOfWeek: 1,
      dayName: '월',
      period: 1,
      timeStr: '09:30 - 10:45',
      subjectNm: '데이터베이스',
      classroom: '18308()',
    },
    {
      id: 'm_wed',
      dayOfWeek: 3,
      dayName: '수',
      period: 1,
      timeStr: '09:30 - 10:45',
      subjectNm: '데이터베이스',
      classroom: '18308()',
    },
  ];
  const mergedMultiDay = mergeDayTimetable(multiDayItems);
  assert.strictEqual(mergedMultiDay.length, 2, 'Same subject across different days must not merge');

  // Large time gap between consecutive periods must not merge
  const gapItems = [
    {
      id: 'g1',
      dayOfWeek: 1,
      dayName: '월',
      period: 1,
      timeStr: '09:30 - 10:45',
      subjectNm: '데이터베이스',
      classroom: '18308()',
    },
    {
      id: 'g2',
      dayOfWeek: 1,
      dayName: '월',
      period: 2,
      timeStr: '15:00 - 16:15', // gap of > 4 hours despite period numbers
      subjectNm: '데이터베이스',
      classroom: '18308()',
    },
  ];
  const mergedGap = mergeDayTimetable(gapItems);
  assert.strictEqual(mergedGap.length, 2, 'Periods separated by > 30 minutes must not merge');

  console.log('  -> Test 29 Phase 4 - 75-minute class schedule, deterministic color index & block parsing PASSED');
}

// -------------------------------------------------------------
// Test 30: Time-based Timetable (Pure Time Table Architecture)
// -------------------------------------------------------------
console.log('\nTest 30: Time-based Timetable (Pure Time Table Architecture)...');
{
  // 30-1. Direct resolveTimeFields unit test
  const tf1 = resolveTimeFields('11:00~12:15');
  assert.strictEqual(tf1.startTime, '11:00');
  assert.strictEqual(tf1.endTime, '12:15');
  assert.strictEqual(tf1.startMinutes, 660);
  assert.strictEqual(tf1.endMinutes, 735);
  assert.strictEqual(tf1.durationMinutes, 75);
  assert.strictEqual(tf1.timeStr, '11:00 - 12:15');

  // Non-standard duration test (e.g. 90-minute lecture: 13:30 ~ 15:00)
  const tf2 = resolveTimeFields('13:30 - 15:00');
  assert.strictEqual(tf2.startTime, '13:30');
  assert.strictEqual(tf2.endTime, '15:00');
  assert.strictEqual(tf2.startMinutes, 810);
  assert.strictEqual(tf2.endMinutes, 900);
  assert.strictEqual(tf2.durationMinutes, 90);

  // Period-based fallback to clean 75-minute block
  const tf3 = resolveTimeFields(undefined, 1);
  assert.strictEqual(tf3.startTime, '09:30');
  assert.strictEqual(tf3.endTime, '10:45');
  assert.strictEqual(tf3.startMinutes, 570);
  assert.strictEqual(tf3.endMinutes, 645);
  assert.strictEqual(tf3.durationMinutes, 75);

  // 30-2. parseHanshinScheduleSlots time format parsing
  const timeSlots = HsctisScraperService.parseHanshinScheduleSlots('월(11:00~12:15),수(09:30~10:45)');
  assert.strictEqual(timeSlots.length, 2);
  assert.strictEqual(timeSlots[0].startTime, '11:00');
  assert.strictEqual(timeSlots[0].endTime, '12:15');
  assert.strictEqual(timeSlots[0].durationMinutes, 75);
  assert.strictEqual(timeSlots[0].startMinutes, 660);
  assert.strictEqual(timeSlots[0].endMinutes, 735);
  assert.strictEqual(timeSlots[0].timeStr, '11:00 - 12:15');
  assert.strictEqual(timeSlots[1].startTime, '09:30');
  assert.strictEqual(timeSlots[1].endTime, '10:45');
  assert.strictEqual(timeSlots[1].durationMinutes, 75);

  // 30-3. parseHanshinScheduleSlots period number parsing
  const periodSlots = HsctisScraperService.parseHanshinScheduleSlots('월1,2');
  assert.strictEqual(periodSlots.length, 2);
  assert.strictEqual(periodSlots[0].startTime, '09:30');
  assert.strictEqual(periodSlots[0].endTime, '10:45');
  assert.strictEqual(periodSlots[0].durationMinutes, 75);
  assert.strictEqual(periodSlots[1].startTime, '11:00');
  assert.strictEqual(periodSlots[1].endTime, '12:15');
  assert.strictEqual(periodSlots[1].durationMinutes, 75);

  // 30-4. parseTimetableData dataset verification
  const mockTimetableDs = {
    parameters: { ErrorCode: '0' },
    datasets: {
      ds_main: [
        {
          COURSE_NM: '모바일프로그래밍',
          PROF_NM: '김교수',
          CLAS_ROOM_NM: '만우관 301호',
          LESS_DYWEK_GBCD: '화요일(13:30~15:00)',
        },
        {
          COURSE_NM: '웹서버보안',
          PROF_NM: '이교수',
          CLAS_ROOM_NM: '만우관 202호',
          DAY_CD: '4',
          PRD: '2',
        },
      ],
    },
    errorCode: '0',
    errorMsg: '',
  };
  const parsedTt = HsctisScraperService['parseTimetableData'](mockTimetableDs);
  assert.strictEqual(parsedTt.length, 2);
  // Item 0: Time-based format
  assert.strictEqual(parsedTt[0].startTime, '13:30');
  assert.strictEqual(parsedTt[0].endTime, '15:00');
  assert.strictEqual(parsedTt[0].durationMinutes, 90);
  assert.strictEqual(parsedTt[0].startMinutes, 810);
  assert.strictEqual(parsedTt[0].endMinutes, 900);
  // Item 1: Period-based fallback format
  assert.strictEqual(parsedTt[1].startTime, '11:00');
  assert.strictEqual(parsedTt[1].endTime, '12:15');
  assert.strictEqual(parsedTt[1].durationMinutes, 75);
  assert.strictEqual(parsedTt[1].startMinutes, 660);
  assert.strictEqual(parsedTt[1].endMinutes, 735);

  // 30-5. mergeDayTimetable time calculation verification
  const mergedCards = mergeDayTimetable([
    {
      id: 'c1',
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
      id: 'c2',
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
  ]);
  assert.strictEqual(mergedCards.length, 1);
  assert.strictEqual(mergedCards[0].startTime, '13:00');
  assert.strictEqual(mergedCards[0].endTime, '15:45');
  assert.strictEqual(mergedCards[0].durationMinutes, 165); // 75 + 15 + 75 = 165 min
  assert.strictEqual(mergedCards[0].timeStr, '13:00 - 15:45');

  // 30-6. getSampleAcademicData validation
  const sampleData = HsctisScraperService.getSampleAcademicData();
  for (const item of sampleData.timetable) {
    assert(item.startTime && item.startTime.length === 5, 'Sample item must have valid startTime');
    assert(item.endTime && item.endTime.length === 5, 'Sample item must have valid endTime');
    assert(typeof item.startMinutes === 'number' && item.startMinutes > 0, 'Sample item startMinutes must be > 0');
    assert(typeof item.endMinutes === 'number' && item.endMinutes > item.startMinutes, 'endMinutes must be > startMinutes');
    assert.strictEqual(item.durationMinutes, item.endMinutes - item.startMinutes, 'durationMinutes check');
    assert.strictEqual(item.timeStr, `${item.startTime} - ${item.endTime}`, 'timeStr format check');
  }

  console.log('  -> Test 30 Time-based Timetable (Pure Time Table Architecture) PASSED');
}

// -------------------------------------------------------------
// Test 31: Phase 5 - 4-Tab Navigation & Login Options Separation
// -------------------------------------------------------------
console.log('\nTest 31: Phase 5 - 4-Tab Architecture & Login Options Separation...');
{
  const { DEFAULT_CONFIG, saveConfig, loadConfig } = await import('../src/services/storage.js');

  // 31-1. DEFAULT_CONFIG default properties
  assert.strictEqual(DEFAULT_CONFIG.rememberId, true, 'DEFAULT_CONFIG.rememberId must default to true');
  assert.strictEqual(DEFAULT_CONFIG.autoLogin, true, 'DEFAULT_CONFIG.autoLogin must default to true');

  // 31-2. saveConfig with rememberId and autoLogin permutations
  // Case A: rememberId=false, autoLogin=false -> both userId and userPw cleared
  await saveConfig({
    ...DEFAULT_CONFIG,
    userId: 'testuser1',
    userPw: 'testpass1',
    rememberId: false,
    autoLogin: false,
  });
  const loadedA = await loadConfig();
  assert.strictEqual(loadedA.userId, '', 'userId must be cleared when rememberId=false');
  assert.strictEqual(loadedA.userPw, '', 'userPw must be cleared when autoLogin=false');
  assert.strictEqual(loadedA.rememberId, false);
  assert.strictEqual(loadedA.autoLogin, false);

  // Case B: rememberId=true, autoLogin=false -> userId saved, userPw cleared
  await saveConfig({
    ...DEFAULT_CONFIG,
    userId: 'testuser2',
    userPw: 'testpass2',
    rememberId: true,
    autoLogin: false,
  });
  const loadedB = await loadConfig();
  assert.strictEqual(loadedB.userId, 'testuser2', 'userId must be preserved when rememberId=true');
  assert.strictEqual(loadedB.userPw, '', 'userPw must be cleared when autoLogin=false');
  assert.strictEqual(loadedB.rememberId, true);
  assert.strictEqual(loadedB.autoLogin, false);

  // Case C: rememberId=true, autoLogin=true -> both userId and userPw saved
  await saveConfig({
    ...DEFAULT_CONFIG,
    userId: 'testuser3',
    userPw: 'testpass3',
    rememberId: true,
    autoLogin: true,
  });
  const loadedC = await loadConfig();
  assert.strictEqual(loadedC.userId, 'testuser3');
  assert.strictEqual(loadedC.userPw, 'testpass3');
  assert.strictEqual(loadedC.rememberId, true);
  assert.strictEqual(loadedC.autoLogin, true);

  console.log('  -> Test 31 Phase 5 - 4-Tab Architecture & Login Options Separation PASSED');
}

// -------------------------------------------------------------
// Test 32: HAR 기반 회귀 테스트 (강의 ID 안정성, 세션 만료 감지, 공지 오탐, 색상 중복, 로그인 옵션)
// -------------------------------------------------------------
console.log('\nTest 32: HAR-based regressions (lecture ID, todo session expiry, urgent body, colors, login options)...');
{
  const { LmsScraperService, stripLectureProgress, isEmergencyNotice } = await import('../src/services/lmsScraper.js');
  const { HttpClient } = await import('../src/services/httpClient.js');
  const { assignDistinctSubjectColors, getSubjectColorIndex } = await import('../src/services/hsctisScraper.js');
  const { DEFAULT_CONFIG, saveConfig, loadConfig } = await import('../src/services/storage.js');

  // 32-1. 진도율이 바뀌어도 강의 ID 유지 (HAR: '4주 1(2%)' 형식)
  assert.strictEqual(stripLectureProgress('4주 1(2%)'), '4주 1');
  assert.strictEqual(stripLectureProgress('sql실습보조동영상(10/5수업보강) (0%)'), 'sql실습보조동영상(10/5수업보강)');
  const lectureLi = pct => `<div class="todolist_pop"><ul><li class="tab tab2"><a href="javascript:fnGoContent('8','C1','A','C1_W','S');"><div class="info"><span class="cata cata_content">콘텐츠</span><span class="lec_name">[2026-2학기)운영체제(D반)]</span><span class="subject">5주 1회차(${pct}%)</span></div><div class="date"><span>(종료시한 : 2026.10.09 23:59:59)</span></div></a></li></ul></div>`;
  const l0 = LmsScraperService.parseTodoListHtml(lectureLi(0)).lectures[0];
  const l50 = LmsScraperService.parseTodoListHtml(lectureLi(50)).lectures[0];
  assert.strictEqual(l0.id, l50.id, 'lecture id must not change with progress');
  assert.strictEqual(l50.progressPercent, 50);

  // 32-2. doTodoList 응답에 todolist_pop이 없으면(로그인 페이지) 세션 만료로 throw
  const origPost = HttpClient.post;
  try {
    HttpClient.post = async () => ({ data: '<html>login</html>', status: 200, headers: {}, url: '' });
    await assert.rejects(() => LmsScraperService.getTodoListHtml('all'), /세션 만료/);
    HttpClient.post = async () => ({ data: '<div class="todolist_pop"></div>', status: 200, headers: {}, url: '' });
    assert.ok((await LmsScraperService.getTodoListHtml('all')).includes('todolist_pop'));
  } finally {
    HttpClient.post = origPost;
  }

  // 32-3. 본문의 일반 단어('중요', '시험')만으로는 긴급 공지가 아님
  assert.strictEqual(isEmergencyNotice('9월 21일 줌 수업 주소', '중요한 내용이니 시험 전에 확인하세요.'), false);
  assert.strictEqual(isEmergencyNotice('수업 공지', '이번 주 수업은 휴강합니다.'), true);

  // 32-4. 시간표 과목 색상은 서로 겹치지 않고, 고정 매핑 과목은 지정 색 유지
  const names = ['운영체제', '데이터베이스', '논리회로', '자율지능IoT시스템', '인지감성AI에이전트', '1인 미디어 만들기', '채플', '알고리즘'];
  const colored = assignDistinctSubjectColors(names.map(n => ({ subjectNm: n, colorIndex: getSubjectColorIndex(n) })));
  assert.strictEqual(new Set(colored.map(c => c.colorIndex)).size, names.length, 'colors must be distinct');
  assert.strictEqual(colored.find(c => c.subjectNm === '운영체제').colorIndex, 4);
  assert.strictEqual(colored.find(c => c.subjectNm === '데이터베이스').colorIndex, 1);

  // 32-5. 아이디 저장 끔 + 자동 로그인 켬 → 아이디 유지 (비밀번호만 남는 상태 방지)
  await saveConfig({ ...DEFAULT_CONFIG, userId: 'testuser4', userPw: 'testpass4', rememberId: false, autoLogin: true });
  const loadedD = await loadConfig();
  assert.strictEqual(loadedD.userId, 'testuser4');
  assert.strictEqual(loadedD.userPw, 'testpass4');

  console.log('  -> Test 32 HAR-based regressions PASSED');
}

// -------------------------------------------------------------
// Test 33: 실제 시간표 HAR (ul72_0272017, 2026-2학기) 파싱 및 메뉴 코드 검증
// -------------------------------------------------------------
console.log('\nTest 33: Real timetable HAR parsing (ul72_0272017) & menu codes...');
{
  const { HsctisScraperService } = await import('../src/services/hsctisScraper.js');
  const { NexacroClient, parseDatasets } = await import('../src/services/nexacroClient.js');
  const { mergeDayTimetable } = await import('../src/components/AcademicView.tsx');

  const harPath = harFile('hsctis.hs.ac.kr_Archive [26-10-04 19-00-00].har');
  if (fs.existsSync(harPath)) {
    const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entry = har.log.entries.find(e => e.request.method === 'POST' && e.request.url.endsWith('/ul/ul72_0272017'));
    const tt = HsctisScraperService['parseTimetableData'](parseDatasets(entry.response.content.text));

    const scheduled = tt.filter(t => !t.unscheduled);
    const find = (nm, day) => mergeDayTimetable(scheduled.filter(t => t.dayOfWeek === day)).find(m => m.subjectNm === nm);

    // 강의실은 CLAS_ROOM_CD 컬럼에서 추출
    assert.strictEqual(find('데이터베이스', 1).classroom, '18308');
    assert.strictEqual(find('데이터베이스', 1).timeStr, '11:00 - 12:15');
    assert.strictEqual(find('자율지능IoT시스템', 1).timeStr, '09:30 - 10:45');
    // 채플은 50분 수업
    assert.strictEqual(find('채플', 1).timeStr, '16:00 - 16:50');
    assert.strictEqual(find('채플', 1).classroom, '채플실');
    // 목요일 운영체제 13:00~15:45 단일 블록
    assert.strictEqual(find('운영체제', 4).durationMinutes, 165);
    assert.strictEqual(find('1인미디어만들기', 3).timeStr, '16:00 - 17:15');
    // "(:~:)" 진로와상담은 시간 미지정 과목으로 분리
    const unscheduled = tt.filter(t => t.unscheduled);
    assert.deepStrictEqual(unscheduled.map(t => t.subjectNm), ['진로와상담']);
    // 과목별 색상 중복 없음
    const colorBySubject = new Map(tt.map(t => [t.subjectNm, t.colorIndex]));
    assert.strictEqual(new Set(colorBySubject.values()).size, colorBySubject.size);
  } else {
    console.log('  (timetable HAR not found, skipping HAR assertions)');
  }

  // 실제 브라우저와 동일한 메뉴 코드로 요청 (2430: 수강신청및시간표조회, 1486: 교양및전공필수이수현황)
  const origPost = NexacroClient.postService;
  const origInit = NexacroClient.initMenu;
  const sent = {};
  try {
    NexacroClient.initMenu = async () => {};
    NexacroClient.postService = async (svc, opts) => {
      sent[svc] = opts.variables.SYSTEM_MENU_CD;
      return { parameters: {}, datasets: {}, errorCode: '0', errorMsg: '' };
    };
    await HsctisScraperService.getTimetable('202400001');
    await HsctisScraperService.getGraduationDiagnosis('202400001');
    assert.strictEqual(sent['ul72_0272017'], '2430');
    assert.strictEqual(sent['um72_0272004'], '1486');
  } finally {
    NexacroClient.postService = origPost;
    NexacroClient.initMenu = origInit;
  }

  console.log('  -> Test 33 Real timetable HAR parsing & menu codes PASSED');
}

// -------------------------------------------------------------
// Test 34: 졸업 기준(um72_0272004) + 성적 기반 이수구분별 취득학점 계산 (실제 HAR)
// -------------------------------------------------------------
console.log('\nTest 34: Graduation requirements (um72_0272004) + credits computed from grades...');
{
  const { HsctisScraperService } = await import('../src/services/hsctisScraper.js');
  const { parseDatasets } = await import('../src/services/nexacroClient.js');
  const gradHar = harFile('hsctis.hs.ac.kr_Archive [26-10-04 19-14-16].har');
  const gradesHar = harFile('hsctis.hs.ac.kr_Archive [26-10-01 00-54-54].har');
  const postText = (file, path) =>
    JSON.parse(fs.readFileSync(file, 'utf8')).log.entries.find(
      e => e.request.method === 'POST' && e.request.url.endsWith(path)
    ).response.content.text;

  if (fs.existsSync(gradHar) && fs.existsSync(gradesHar)) {
    const req = HsctisScraperService.parseGraduationData(parseDatasets(postText(gradHar, '/um/um72_0272004')));
    assert.strictEqual(req.totalRequiredCredits, 130);
    assert.strictEqual(req.generalRequiredCredits, 35);
    assert.strictEqual(req.generalMaxCredits, 45);
    assert.strictEqual(req.majorRequiredCredits, 24);
    assert.strictEqual(req.commonRequiredCredits, 36, '계열공통 기준은 안내문(DAN)에서 추출');
    assert.ok(req.requiredCourses.some(c => c.name === '글쓰기의기초' && c.completedCount === 0));
    assert.ok(req.requiredCourses.some(c => c.name === '채플' && c.completedCount === 3));
    assert.ok(req.requiredCourses.some(c => c.category === '비교과필수' && c.completedCount === null));

    const grades = HsctisScraperService['parseGradesData'](parseDatasets(postText(gradesHar, '/um/um72_0272005')));
    const g = HsctisScraperService.applyGradesToGraduation(req, grades);
    // 재수강 대상·F·괄호학점 제외 시 서버 총 취득학점(COPL_PNT 47.5)과 일치해야 함
    assert.strictEqual(g.totalAcquiredCredits, grades.totalAcquiredCredits);
    assert.strictEqual(g.totalAcquiredCredits, 47.5);
    assert.strictEqual(g.commonAcquiredCredits, 24);
    assert.strictEqual(g.majorAcquiredCredits, 6);
    assert.strictEqual(g.generalAcquiredCredits, 17.5);
    assert.strictEqual(g.status, 'in_progress');
    assert.strictEqual(g.creditsComputed, true);
  } else {
    console.log('  (graduation/grades HAR not found, skipping HAR assertions)');
  }

  // 교양 최대 인정학점 초과분은 총 학점에서 제외
  const base = {
    totalRequiredCredits: 130, totalAcquiredCredits: 0, majorRequiredCredits: 24, majorAcquiredCredits: 0,
    generalRequiredCredits: 35, generalAcquiredCredits: 0, otherAcquiredCredits: 0, completionPercent: 0,
    status: 'in_progress', generalMaxCredits: 45, commonRequiredCredits: 36,
  };
  const subj = (compDiv, credits, grade = 'A0') => ({ subjCode: '', subjNm: 'x', compDiv, credits, grade });
  const capped = HsctisScraperService.applyGradesToGraduation(base, {
    totalAppliedCredits: 0, totalAcquiredCredits: 0, totalGpa: 0,
    semesters: [{ year: '2024', semester: '1', appliedCredits: 0, acquiredCredits: 0, semesterGpa: 0,
      subjects: [subj('교선', 50), subj('계공', 36), subj('전선', 30), subj('일선', 3), subj('전선', 3, 'F')] }],
  });
  assert.strictEqual(capped.generalAcquiredCredits, 50);
  assert.strictEqual(capped.totalAcquiredCredits, 45 + 36 + 30 + 3);
  assert.strictEqual(capped.otherAcquiredCredits, 3);
  assert.strictEqual(capped.status, 'in_progress');

  console.log('  -> Test 34 Graduation requirements + computed credits PASSED');
}

// -------------------------------------------------------------
// Test 35: 디버그 로그 민감정보 마스킹
// -------------------------------------------------------------
console.log('\nTest 35: Debug log redaction...');
{
  const { redactSensitive } = await import('../src/services/debugLog.js');
  const masked = redactSensitive(
    'Cookie: JSESSIONID=abc123; access_token=tok_456&user_pwd=secret {"userPw":"pw!"} ' +
      'https://discord.com/api/webhooks/123/xyz name="access_token" value="zzz"'
  );
  for (const secret of ['abc123', 'tok_456', 'secret', 'pw!', '123/xyz', 'zzz']) {
    assert.ok(!masked.includes(secret), `secret "${secret}" must be masked: ${masked}`);
  }
  assert.ok(masked.includes('JSESSIONID=***'));
  assert.strictEqual(redactSensitive('동기화 완료 {"assignments":9}'), '동기화 완료 {"assignments":9}');
  console.log('  -> Test 35 Debug log redaction PASSED');
}

// -------------------------------------------------------------
// Test 36: 자료실(tab4) 수집 + 홈 카드 설정 정리
// -------------------------------------------------------------
console.log('\nTest 36: Materials (tab4) parsing & home card normalization...');
{
  const { LmsScraperService } = await import('../src/services/lmsScraper.js');
  const { normalizeHomeCards, DEFAULT_HOME_CARDS } = await import('../src/utils/homeCards.ts');

  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-02 18-36-01].har');
  if (fs.existsSync(harPath)) {
    const entries = JSON.parse(fs.readFileSync(harPath, 'utf8')).log.entries.filter(e => e.request.url.includes('doTodoList'));
    const allHtml = entries.find(e => e.request.postData.text.includes('=all')).response.content.text;
    const todo = LmsScraperService.parseTodoListHtml(allHtml);
    assert.strictEqual(todo.materials.length, 59, 'HAR 전체 목록의 자료실 59건');
    assert.ok(todo.materials.some(m => m.title.includes('억지기법과 탐욕적전략')));
    assert.ok(todo.materials.every(m => m.id.includes('_material_')));
  }

  // 기본 순서: 오늘 수업 → 퀵허브 → 요약 → 마감 임박 (나머지는 꺼짐)
  assert.deepStrictEqual(
    DEFAULT_HOME_CARDS.filter(c => c.enabled).map(c => c.id),
    ['todayClasses', 'quickHub', 'summaryChips', 'deadlines']
  );
  // 저장된 순서 유지, 알 수 없는 카드 제거, 빠진 카드는 꺼진 채로 뒤에 추가
  const normalized = normalizeHomeCards([
    { id: 'deadlines', enabled: true },
    { id: 'unknownCard', enabled: true },
    { id: 'todayClasses', enabled: false },
  ]);
  assert.strictEqual(normalized[0].id, 'deadlines');
  assert.strictEqual(normalized[1].id, 'todayClasses');
  assert.strictEqual(normalized[1].enabled, false);
  assert.ok(!normalized.some(c => c.id === 'unknownCard'));
  assert.strictEqual(normalized.length, DEFAULT_HOME_CARDS.length);
  assert.ok(normalized.slice(2).every(c => c.enabled === false));
  assert.strictEqual(normalizeHomeCards(undefined).length, DEFAULT_HOME_CARDS.length);

  console.log('  -> Test 36 Materials & home cards PASSED');
}

// -------------------------------------------------------------
// Test 37: 다른 곳 로그인으로 끊긴 세션의 안내 페이지 판별 (EUC-KR 페이지가 UTF-8로 깨져도 감지)
// -------------------------------------------------------------
console.log('\nTest 37: Kicked-session page detection (incl. EUC-KR mojibake)...');
{
  const { isKickedResponse } = await import('../src/services/sessionGuard.ts');

  // 기기 로그와 같은 형태: EUC-KR 바이트를 UTF-8로 읽어 한글이 깨진 짧은 안내 페이지
  const eucKr = hex => new TextDecoder('utf-8').decode(Buffer.from(hex, 'hex'));
  const page = msg =>
    `<html><head><title>x</title><SCRIPT type=text/javascript>alert('${msg}'); top.location='/main/MainView.dunet'; </SCRIPT></head></html>`;
  const kickedMojibake = page(eucKr('b4d9b8a520504320bfa1bcad20b7ceb1d7c0ce20b5c7befabdc0b4cfb4d92e'));
  const loginRequiredMojibake = page(eucKr('b7ceb1d7c0ce20c8c420c0ccbfebc7cfbdc720bcf620c0d6bdc0b4cfb4d92e'));

  assert.ok(!kickedMojibake.includes('다른'), '테스트 전제: 한글이 깨져 있어야 함');
  assert.strictEqual(isKickedResponse(kickedMojibake), true, '깨진 "다른 PC 에서 로그인" 페이지 감지');
  assert.strictEqual(isKickedResponse(loginRequiredMojibake), false, '"로그인 후 이용" 페이지는 다른 곳 로그인이 아님');
  assert.strictEqual(isKickedResponse(page('다른 PC 에서 로그인 되었습니다.')), true, '정상 디코딩된 안내 페이지 감지');
  assert.strictEqual(isKickedResponse({ data: {} }), false);
  // 일반 페이지에 같은 문장이 들어 있을 뿐이면 감지하지 않음 (공지 본문 등)
  const noticeBody = `<html><body><div class="view_cont">시험 중 다른 PC 에서 로그인 되었습니다 라는 안내가 뜨면 감독관에게 알리세요.</div>${'<p>본문</p>'.repeat(400)}</body></html>`;
  assert.strictEqual(isKickedResponse(noticeBody), false, '긴 일반 페이지의 문장은 무시');
  assert.strictEqual(isKickedResponse('<p>다른 PC 에서 로그인 되었습니다.</p>'), false, 'alert·이동 구조가 없으면 무시');
  assert.strictEqual(isKickedResponse("<script>alert('PC 버전에서만 됩니다');</script>"), false, 'PC가 든 다른 alert는 무시');

  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-04 22-31-46].har');
  if (fs.existsSync(harPath)) {
    const entries = JSON.parse(fs.readFileSync(harPath, 'utf8')).log.entries;
    const mainViews = entries.filter(e => e.request.url.includes('/main/MainView.dunet'));
    assert.strictEqual(isKickedResponse(mainViews[0].response.content.text), true, 'HAR의 실제 안내 페이지 감지');
    const normal = mainViews.find(e => (e.response.content.text || '').length > 10000);
    assert.strictEqual(isKickedResponse(normal.response.content.text), false, '정상 메인 페이지는 감지하지 않음');
  } else {
    console.log('  (HAR 없음: HAR 기반 검증 생략)');
  }

  console.log('  -> Test 37 Kicked-session detection PASSED');
}

// -------------------------------------------------------------
// Test 38: 백그라운드 워커(Java TodoListParser)와 앱(TS)의 할일 항목 ID 일치
//   ID가 다르면 워커가 앱이 이미 본 항목을 새 항목으로 보고 중복 알림 (예: 제목의 &middot;)
// -------------------------------------------------------------
console.log('\nTest 38: Java TodoListParser IDs match TS parseTodoListHtml (과제·강의·퀴즈·과목 공지)...');
{
  const { execFileSync } = await import('child_process');
  const os = await import('os');
  const path = await import('path');
  const { LmsScraperService } = await import('../src/services/lmsScraper.js');

  const harPath = harFile('lms.hs.ac.kr_Archive [26-10-02 18-36-01].har');
  let hasJdk = true;
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' });
  } catch {
    hasJdk = false;
  }

  // 기기(DOM textContent)와 같은 값을 내야 하는 까다로운 경우. 기대 ID는 브라우저 textContent 기준으로 손으로 계산한 값
  const synthetic = `<div class="todolist_pop"><ul>
    <li class="tab tab2"><a href="javascript:fnGoContent('L','202620HS00openclass0201','01','C1');"><span class="subject">심리&middot;아동학 &#39;특강&#39; &amp; Q&amp;A (45%)</span><span class="lec_name">[2026] 열린강좌</span><div class="date"><span>2099.12.31 23:59</span></div></a></li>
    <li class="tab tab5"><a href="javascript:fnGoContent('R','C2','01','');"><span class="subject">보고서&nbsp;제출 (학습시간/기준시간 : 1/2 )</span><span class="lec_name">과목</span><div class="date"><span>2099.12.31 23:59</span></div></a></li>
    <li class="tab tab2"><a href="javascript:fnGoContent('L','C3','01','');"><span class="subject">강의 <b>A</b>B<span class="badge">C</span> 끝 (30%)</span><div class="date"><span>2099.12.31</span></div></a></li>
    <li class="tab tab5"><a href="javascript:fnGoContent('R','C4','01','');"><span class="subject">　과제　제출&hellip;&#x2F;끝&rsquo;　</span></a></li>
    <li class="tab tab7"><a href="javascript:fnGoContent('Q','C5','01','');"><span data-class="subject">미끼1</span><span class="subject-title">미끼2</span><div class="subject">진짜 퀴즈 새 글이 등록되었습니다.</div></a></li>
    <li class="tab tab9"><a href="javascript:fnGoContent('B','C6','01','777');"><span class="subject">휴강 안내 새 글이 등록되었습니다.</span><span class="lec_name">[2026] 과목</span><div class="date"><span>(등록일 : 2026.10.05)</span></div></a></li>
    <li class="tab tab9"><a href="javascript:fnGoContent('B','C7','01','');"><span class="subject">[공지] 시험&middot;범위 &amp; 일정</span></a></li>
  </ul></div>`;
  const expectedSyntheticIds = [
    "202620HS00openclass0201_lecture_심리·아동학 '특강' & Q&A",
    'C2_assignment_보고서 제출 (1/2)',
    'C3_lecture_강의 ABC 끝',
    'C4_assignment_과제 제출…/끝’',
    'C5_quiz_진짜 퀴즈',
    'C6_board_7_777',
    'C7_board_7_[공지] 시험·범위 & 일정',
  ];
  {
    const r = LmsScraperService.parseTodoListHtml(synthetic);
    const tsIds = [...r.assignments, ...r.lectures, ...r.quizzes, ...r.notices].map(x => x.id).sort();
    assert.deepStrictEqual(tsIds, [...expectedSyntheticIds].sort(), 'TS(정규식 경로)가 DOM textContent와 같은 ID를 내야 함');
  }

  if (!hasJdk) {
    console.log('  (javac 없음: Java/TS ID 일치 검증 생략)');
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-xcheck-'));
    const pages = [synthetic];
    if (fs.existsSync(harPath)) {
      for (const e of JSON.parse(fs.readFileSync(harPath, 'utf8')).log.entries) {
        const t = e.response?.content?.text || '';
        if (e.request.url.includes('doTodoList') && t.includes('todolist_pop')) pages.push(t);
      }
    }
    pages.forEach((html, i) => fs.writeFileSync(path.join(tmp, `${String(i).padStart(2, '0')}.html`), html));
    fs.writeFileSync(
      path.join(tmp, 'Main.java'),
      `import java.nio.file.*; import java.util.*;
public class Main { public static void main(String[] a) throws Exception {
  Path[] files = Files.list(Paths.get(a[0])).filter(p -> p.toString().endsWith(".html")).sorted().toArray(Path[]::new);
  for (Path p : files) for (kr.ac.hs.lmsnotifier.TodoListParser.TodoItem it :
      kr.ac.hs.lmsnotifier.TodoListParser.parse(new String(Files.readAllBytes(p), "UTF-8"), 0L))
    System.out.println(p.getFileName() + "\\t" + it.id);
}}`
    );
    const parserSrc = new URL('../android/app/src/main/java/kr/ac/hs/lmsnotifier/TodoListParser.java', import.meta.url).pathname;
    execFileSync('javac', ['-encoding', 'UTF-8', '-d', tmp, parserSrc, path.join(tmp, 'Main.java')]);
    const javaIds = new Set(
      execFileSync('java', ['-cp', tmp, 'Main', tmp], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    );

    const tsIds = new Set();
    pages.forEach((html, i) => {
      const r = LmsScraperService.parseTodoListHtml(html);
      for (const it of [...r.assignments, ...r.lectures, ...r.quizzes, ...r.notices]) tsIds.add(`${String(i).padStart(2, '0')}.html\t${it.id}`);
    });

    const onlyJava = [...javaIds].filter(x => !tsIds.has(x));
    const onlyTs = [...tsIds].filter(x => !javaIds.has(x));
    assert.deepStrictEqual({ onlyJava, onlyTs }, { onlyJava: [], onlyTs: [] }, 'Java/TS 항목 ID가 달라 중복 알림 발생');
    for (const id of expectedSyntheticIds) {
      assert.ok(javaIds.has(`00.html\t${id}`), `Java가 DOM 기준 ID를 내야 함: ${id}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`  ${javaIds.size} IDs identical (${pages.length} pages)`);
  }
  console.log('  -> Test 38 Java/TS todo ID parity PASSED');
}

// -------------------------------------------------------------
// Test 39: PC 세션 보호 판단 (다른 곳 로그인 vs 자연 만료). 시나리오는 기기 로그의 실제 순서 기준
// -------------------------------------------------------------
console.log('\nTest 39: Session guard decisions (kicked / natural expiry / recent-ok heuristic)...');
{
  const guard = await import('../src/services/sessionGuard.ts');
  const { judgeInvalidSession, KICK_WINDOW_MS } = guard;
  const T = 1_800_000_000_000;
  const MIN = 60_000;
  const judge = o => judgeInvalidSession({ okAt: 0, kickedAt: 0, expiredAt: 0, paused: false, now: T, ...o });

  // 기기 로그 02:05:43: 세션 확인 정상(okAt) 직후 과목 목록이 "다른 PC" 응답 → 확정
  assert.deepStrictEqual(judge({ okAt: T - 10, kickedAt: T - 5 }), { kicked: true, naturalExpiry: false, suspected: true });
  // 끊김을 본 뒤 사용자가 다시 로그인(okAt 갱신) → 예전 끊김 기록은 무시. 마지막 정상이 오래전이면 재로그인 허용
  assert.strictEqual(judge({ okAt: T - 40 * MIN, kickedAt: T - 50 * MIN }).suspected, false);
  // 워커가 마지막 정상 이후 "다른 PC" 응답 없이 만료를 봄 → 자연 만료 (최근까지 정상이어도 재로그인 허용)
  assert.deepStrictEqual(judge({ okAt: T - 10 * MIN, expiredAt: T - 2 * MIN }), { kicked: false, naturalExpiry: true, suspected: false });
  // 앱이 "다른 PC" 응답을 받은 뒤 워커가 302를 봄 → 끊김이 우선
  assert.strictEqual(judge({ okAt: T - 10 * MIN, kickedAt: T - 9 * MIN, expiredAt: T - 2 * MIN }).suspected, true);
  // 아무 응답도 못 봤고 최근까지 정상 → 응답을 놓쳤을 수 있으므로 추정
  assert.strictEqual(judge({ okAt: T - 5 * MIN }).suspected, true);
  assert.strictEqual(judge({ okAt: T - KICK_WINDOW_MS - 1 }).suspected, false);
  // 기록이 전혀 없음(첫 실행) → 재로그인 허용
  assert.strictEqual(judge({}).suspected, false);
  // 이미 멈춘 상태는 사용자가 풀 때까지 유지
  assert.strictEqual(judge({ okAt: T - 5 * 60 * MIN, expiredAt: T - MIN, paused: true }).suspected, true);

  // 저장 상태까지 포함한 흐름: 정상 → 끊김 응답 → 자동 판단은 멈춤 → 다시 로그인(정상 확인)하면 해제
  guard.resumeSync();
  guard.markSessionOk();
  guard.markKicked();
  assert.strictEqual(await guard.canRelogin({ enabled: true, interactive: false }), false, '끊김 확인 시 자동 재로그인 금지');
  assert.strictEqual(guard.isSyncPaused(), true);
  await new Promise(r => setTimeout(r, 2));
  guard.markSessionOk();
  assert.strictEqual(guard.isSyncPaused(), false, '다시 정상 확인되면 멈춤 해제');
  // 보호 기능을 끈 경우: 항상 재로그인 허용 + 멈춤 해제
  guard.markKicked();
  assert.strictEqual(await guard.canRelogin({ enabled: false, interactive: false }), true);
  assert.strictEqual(guard.isSyncPaused(), false);

  console.log('  -> Test 39 Session guard PASSED');
}

// -------------------------------------------------------------
// Test 40: 본 항목 기록 상한 + 비밀번호 오류 판별
// -------------------------------------------------------------
console.log('\nTest 40: Seen-key cap & credentials error detection...');
{
  const { mergeSeenKeys } = await import('../src/hooks/useLmsSync.ts');
  const { isCredentialsError, LmsAuthCredentialsError } = await import('../src/services/lmsAuth.ts');

  // 상한(3000)을 넘으면 오래된 것부터 정리하되, 지금 목록에 있는 항목은 아무리 오래됐어도 남김(지우면 중복 알림)
  const old = Array.from({ length: 3500 }, (_, i) => `old_${i}`);
  const current = ['old_0', 'new_1', 'new_2'];
  const merged = mergeSeenKeys(old, current);
  assert.strictEqual(merged.length, 3000);
  for (const k of current) assert.ok(merged.includes(k), `현재 항목 유지: ${k}`);
  assert.ok(merged.includes('old_3499') && !merged.includes('old_1'), '오래된 기록부터 정리');
  assert.strictEqual(new Set(merged).size, merged.length, '중복 없음');
  // 상한 이내면 그대로 합침
  assert.deepStrictEqual(mergeSeenKeys(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);

  // LMS 오류 클래스, 종합정보(HsctisAuthError) 문구 모두 비밀번호 오류로 판별. 네트워크 오류는 아님
  assert.strictEqual(isCredentialsError(new LmsAuthCredentialsError()), true);
  assert.strictEqual(isCredentialsError(new Error('아이디 또는 비밀번호가 올바르지 않습니다.')), true);
  assert.strictEqual(isCredentialsError(new Error('LMS 서버에 연결할 수 없습니다. 인터넷 네트워크 연결을 확인해주세요.')), false);
  assert.strictEqual(isCredentialsError(undefined), false);

  console.log('  -> Test 40 Seen-key cap & credentials detection PASSED');
}

// -------------------------------------------------------------
// Test 41: 배포 앱 전용 정리 (Gemini·디스코드 끔, PC 보호·자동 로그인 고정) + 문제 신고용 로그 기본 꺼짐
// -------------------------------------------------------------
console.log('\nTest 41: Release build policy & report log...');
{
  const dbg = await import('../src/services/debugLog.ts');
  const { isReleaseBuild, applyReleasePolicy } = await import('../src/services/buildPolicy.ts');
  await dbg.initDebugLog(); // Node에서는 네이티브 플러그인이 없어 "디버그 빌드 아님" = 배포 앱으로 동작

  assert.strictEqual(isReleaseBuild(), true);
  const cfg = applyReleasePolicy({
    userId: 'u', userPw: 'p', geminiApiKey: 'KEY', useGeminiSummary: true, discordWebhookUrl: 'https://discord.com/api/webhooks/x',
    protectPcSession: false, autoLogin: false, rememberId: false, syncIntervalMinutes: 30,
  });
  assert.strictEqual(cfg.geminiApiKey, '', 'Gemini 키 무시');
  assert.strictEqual(cfg.useGeminiSummary, false);
  assert.strictEqual(cfg.discordWebhookUrl, '', '디스코드 전송 안 함');
  assert.strictEqual(cfg.protectPcSession, true, 'PC 로그인 보호 항상 켬');
  assert.strictEqual(cfg.autoLogin, true);
  assert.strictEqual(cfg.rememberId, true);
  assert.strictEqual(cfg.userId, 'u');
  assert.strictEqual(cfg.syncIntervalMinutes, 30, '나머지 설정은 그대로');

  // 문제 신고용 로그: 기본 꺼짐 → 켜면 기록, 끄면 다시 기록 안 함
  assert.strictEqual(dbg.isDebugLogEnabled(), false, '배포 앱은 기본으로 로그를 남기지 않음');
  assert.strictEqual(await dbg.setReportLogEnabled(true), true);
  dbg.debugLog('test', '신고용 로그 기록 확인');
  assert.ok((await dbg.getCombinedDebugLog()).includes('신고용 로그 기록 확인'));
  assert.strictEqual(await dbg.setReportLogEnabled(false), false);
  await dbg.clearDebugLogs();
  dbg.debugLog('test', '꺼진 뒤 기록');
  assert.ok(!(await dbg.getCombinedDebugLog()).includes('꺼진 뒤 기록'), '끈 뒤에는 기록 안 함');

  console.log('  -> Test 41 Release policy & report log PASSED');
}

// -------------------------------------------------------------
// Test 42: 기본 기능 — 새 버전 비교, 마감 알림 대상, 뒤로가기 순서·화면 기록, LMS 검색
// -------------------------------------------------------------
console.log('\nTest 42: Update check, reminders, back navigation, search...');
{
  const { compareVersions } = await import('../src/services/updateCheck.ts');
  assert.ok(compareVersions('1.3.0', '1.2.0') > 0);
  assert.ok(compareVersions('v1.10.0', '1.9.9') > 0, '두 자리 버전도 숫자로 비교');
  assert.strictEqual(compareVersions('v1.2.0', '1.2'), 0, 'v 접두사·생략된 0 무시');
  assert.ok(compareVersions('1.2.0', '1.2.1') < 0);

  // 마감 알림 대상: 미제출 과제·퀴즈 + 미수강 강의 중 마감이 남은 것 (강의 제목의 진도율은 뺌)
  const { buildReminderItems } = await import('../src/utils/lmsItems.ts');
  const now = new Date(2026, 9, 5, 12, 0).getTime();
  const iso = (d, h = 23, m = 59) => new Date(2026, 9, d, h, m).toISOString();
  const items = buildReminderItems(
    [
      { id: 'a1', courseNm: '과목A', title: '보고서', deadlineStr: '2026.10.07 23:59', deadlineDate: iso(7), isSubmitted: false },
      { id: 'a2', courseNm: '과목A', title: '제출함', deadlineStr: '', deadlineDate: iso(7), isSubmitted: true },
      { id: 'a3', courseNm: '과목B', title: '지난 과제', deadlineStr: '', deadlineDate: iso(4), isSubmitted: false },
      { id: 'q1', courseNm: '과목B', title: '[퀴즈] 1주차', deadlineStr: '', deadlineDate: iso(6), isSubmitted: false },
      { id: 'a4', courseNm: '과목C', title: '기한 없음', deadlineStr: '', deadlineDate: null, isSubmitted: false },
    ],
    [
      { id: 'l1', courseNm: '과목A', title: '3주차 강의 (45%)', periodStr: '2026.10.01 00:00 ~ 2026.10.08 23:59', isAttended: false },
      { id: 'l2', courseNm: '과목A', title: '2주차 강의 (100%)', periodStr: '2026.10.01 ~ 2026.10.08', isAttended: true },
      { id: 'l3', courseNm: '과목A', title: '1주차 강의', periodStr: '2026.09.01 ~ 2026.09.08', isAttended: false },
    ],
    now
  );
  assert.deepStrictEqual(
    items.map(i => [i.id, i.kind]),
    [['a1', 'assignment'], ['q1', 'quiz'], ['l1', 'lecture']]
  );
  assert.strictEqual(items.find(i => i.id === 'l1').title, '3주차 강의', '강의 진도율은 제목에서 뺌');
  assert.strictEqual(items.find(i => i.id === 'l1').deadlineMs, new Date(2026, 9, 8, 23, 59).getTime());

  // 화면 기록: 홈으로 가면 비움, 같은 화면은 한 번만, 이전 화면부터 거슬러 올라감
  const { nextNavHistory } = await import('../src/utils/navHistory.ts');
  const v = (tab, lmsSub = 'assignments', academic = 'timetable') => ({ tab, lmsSub, academic });
  let h = [];
  h = nextNavHistory(h, v('home'), v('lms'));
  h = nextNavHistory(h, v('lms'), v('lms', 'notices'));
  h = nextNavHistory(h, v('lms', 'notices'), v('academics'));
  assert.deepStrictEqual(h, [v('home'), v('lms'), v('lms', 'notices')]);
  h = nextNavHistory(h, v('academics'), v('lms'));
  assert.deepStrictEqual(h, [v('home'), v('lms', 'notices'), v('academics')], 'LMS로 돌아오면 기록의 LMS는 빠짐');
  assert.deepStrictEqual(nextNavHistory(h, v('lms'), v('lms')), h, '같은 화면이면 그대로');
  assert.deepStrictEqual(nextNavHistory(h, v('lms'), v('home')), [], '홈 탭으로 가면 비움');

  // 뒤로가기: 가장 나중에 연 창 → 먼저 연 창 → 이전 화면(root) → 없으면 false(종료 안내)
  const backNav = await import('../src/services/backNav.ts');
  const calls = [];
  let rootLeft = 1;
  backNav.setRootBack(true, () => {
    if (rootLeft === 0) return false;
    rootLeft--;
    calls.push('root');
    return true;
  });
  const offSubpage = backNav.pushBackHandler(() => calls.push('subpage'));
  const offSheet = backNav.pushBackHandler(() => calls.push('sheet'));
  assert.strictEqual(backNav.canGoBack(), true);
  assert.strictEqual(backNav.handleBack(), true);
  offSheet();
  assert.strictEqual(backNav.handleBack(), true);
  offSubpage();
  assert.strictEqual(backNav.handleBack(), true);
  assert.strictEqual(backNav.handleBack(), false, '돌아갈 곳이 없으면 종료 안내');
  assert.deepStrictEqual(calls, ['sheet', 'subpage', 'root']);
  backNav.setRootBack(false, () => false);
  assert.strictEqual(backNav.canGoBack(), false, '홈에서는 네이티브가 두 번 눌러 종료');

  // LMS 검색: 띄어 쓴 낱말이 모두 제목·과목명에 있으면 일치 (대소문자·띄어쓰기 무시)
  const { matchesQuery } = await import('../src/components/LmsView.tsx');
  const it = { title: 'Python 프로그래밍 과제 2', courseNm: '컴퓨터 개론' };
  assert.ok(matchesQuery(it, 'python 과제'));
  assert.ok(matchesQuery(it, '컴퓨터개론'), '과목명 띄어쓰기 무시');
  assert.ok(matchesQuery(it, '과제 컴퓨터'), '제목과 과목명에 나뉘어 있어도 일치');
  assert.ok(matchesQuery(it, '  '), '빈 검색어는 모두 일치');
  assert.ok(!matchesQuery(it, '과제 자바'), '낱말 하나라도 없으면 불일치');

  console.log('  -> Test 42 Basic features PASSED');
}

console.log('\n======================================================');
console.log('🎉 ALL HSCTIS, NEXACRO, LMS NOTICES, TODOLIST, NOTIFICATIONS & DDAY TESTS PASSED! (42/42)');
console.log('======================================================\n');




