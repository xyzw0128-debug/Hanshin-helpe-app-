---
name: lms-protocol
description: 한신대 SSO, LMS(*.dunet), HSCTIS(넥사크로 SSV) 통신 구조와 엔드포인트 지도. 로그인 실패, 스크래핑 결과가 비거나 깨짐, 학교 사이트 변경 대응, 새 데이터 항목 추가 작업 시 참고.
user-invocable: false
---

# 한신대 LMS / HSCTIS 통신 구조

코드가 진실의 원천이다. 아래는 지도일 뿐이니 수정 전에 해당 파일을 직접 읽을 것.

## 1. SSO 로그인 (`lmsAuth.ts`, `hsctisAuth.ts`)

공통: `SSO_BASE = https://sso2.hs.ac.kr`, `SSO_CLIENT_ID = 5f0869ab...` (공개 client id), 모바일 Chrome User-Agent.

| 단계 | 요청 | 얻는 것 |
|---|---|---|
| 0 | `GET {SSO_BASE}/` | 로그인 IP 등 초기 쿠키 |
| 1 | `POST {SSO_BASE}/oauth2/authoriza.do` (form, 무작위 `state`, `scope=http://sso.hs.ac.kr`, `redirect_uri=https://sso.hs.ac.kr/sso/loginSuccess.jsp`) | 인증 `code` |
| 2 | `POST {SSO_BASE}/oauth2/token2.do` | HTML 응답에서 `name="access_token" value="..."` 정규식 추출 |
| 3-LMS | `POST/GET https://lms.hs.ac.kr/main/MainView.dunet` | `JSESSIONID`, 메인 HTML(공지 `.learn_pds`) 캐시 |
| 4-LMS | `/lms/common/select/getSessionInfo.dunet` | 실제 학번 `user_no` |
| 3-HSCTIS | `GET https://hsctis.hs.ac.kr/` → `/app-nexa/index.html` | `JSESSIONID` + `access_token` 쿠키 |
| 4-HSCTIS | `/cs/check/pre` → `/cs/init/user` | 세션 프리체크, `USER_ID` |

- SSO 재로그인은 사용자의 PC 쪽 LMS 세션을 끊는다. `isSessionValid()`가 먼저 호출되는 구조를 유지할 것.
- LMS는 계정당 세션 1개. 다른 곳 로그인으로 끊긴 JSESSIONID의 **첫 요청**에 서버가 `alert('다른 PC 에서 로그인 되었습니다.')` 페이지와 새 JSESSIONID를 준다(1회성, HAR 2026-10-04 확인). 이후 요청은 SSO `checkSession.do`로 302. 이 안내 페이지와 `alert('로그인 후 이용하실 수 있습니다.')` 페이지는 **EUC-KR**이라 앱(UTF-8)에서는 한글이 깨지므로 ASCII `alert('… PC …')`로 판별한다. 끊긴 세션도 `getSessionInfo`는 한동안 `user_no`를 돌려주므로 세션 확인만으로는 알 수 없다(기기 로그 2026-10-05 확인). 앱은 `sessionGuard.ts`(HttpClient에서 감지)와 `BackgroundSyncWorker`(`PREF_SESSION_KICKED_AT`)가 이를 기록해 재로그인을 멈춘다.
- 비밀번호 오류는 `LmsAuthCredentialsError` / `HsctisAuthError`로 구분된다. 네트워크 오류와 섞지 말 것.

## 2. LMS 스크래핑 (`lmsScraper.ts`): HTML + 정규식

| 메서드 | 엔드포인트 |
|---|---|
| `getCourses` | `/lms/myLecture/doListView.dunet` |
| `getTodoList` | `POST /lms/myLecture/doTodoList.dunet` (`to_do_type`) — 과제·강의 진도·퀴즈를 한 번에 |
| `getClassroomHtml` | `/lms/class/classroom/doViewClassRoom.dunet` |
| `getPortalNotices` | `/main/MainView.dunet` |
| `getBoardItemDetail` | `/lms/front/boardItem/doViewBoardItem.dunet`, 강의실 게시판은 `doSetSessionClassRoom.dunet` 후 `/lms/class/boardItem/doViewBoardItem.dunet` |

- 대부분 `Referer` 헤더를 확인하므로 요청을 추가할 때 Referer를 빠뜨리지 말 것.
- todo HTML: `<li class="tabN">` 항목, `fnGoContent(...)` 인자, `.subject`, `.lec_name`, `.date span`.
- **`TodoListParser.java`(백그라운드 워커)가 같은 HTML을 Java 정규식으로 따로 파싱한다.** 한쪽을 고치면 다른 쪽도 고칠 것. 앱은 기기에서 DOM `textContent`(엔티티 전체 디코딩)를 쓰므로 Java도 엔티티를 모두 디코딩해야 ID가 맞는다(`&middot;` 중복 알림 사례). Test 38이 검증.
- `to_do_type`별 내용 (HAR 2026-10-02): `proceedable`(기간 내 미완료) = 과제·강의·자료, `complete`(완료) = 제출한 과제·들은 강의·**과목 공지(tab9)**, `incomplete` = 기한이 지난 미완료, `all` = 전부(아직 열리지 않은 강의 포함). 과목 공지는 `proceedable`에 없으므로 워커는 `complete`도 받아 새 공지와 제출 완료(마감 알림 취소)를 확인한다.
- `doTodoList`는 "내 강의" 메뉴(`doListView.dunet?mnid=201008840728`)를 거친 세션에서만 동작한다. 메뉴 진입 없이 바로 POST하면 세션이 정상이어도 HTTP 500 "잘못된 경로입니다"(기기 로그 2026-10-05). 워커는 메뉴 GET 후 POST하고, Referer에도 `mnid`를 넣는다.

## 3. HSCTIS (`nexacroClient.ts`, `hsctisScraper.ts`): 넥사크로 17 SSV

- 요청: `POST`, `Content-Type: text/xml`, `Referer: {HSCTIS_BASE}/app-nexa/index.html`, 쿠키 `access_token`, `JSESSIONID`.
- URL 매핑: 서비스 ID 앞 두 글자가 모듈. 예: `um72_0272005` → `/um/um72_0272005`.
- 페이로드(`buildSsvPayload`):
  - `SSV:utf-8` RS `access_token=...` RS `key=value` RS ... `Dataset:id` RS `_RowType_` US `Col:String(256)` ...
  - 구분자: `RS = \x1e`, `US = \x1f`.
  - `access_token`은 반드시 헤더 바로 다음 첫 변수.
- 응답(`parseDatasets`): `parameters.ErrorCode`가 `0`이 아니면 실패. `ErrorMsg`를 확인할 것.

| 서비스 ID | 용도 |
|---|---|
| `um72_0272005` | 성적 (`getGrades`) |
| `ul72_0272017` | 시간표 (`getTimetable`) |
| `um72_0272004` | 졸업 진단 (`getGraduationDiagnosis`) |

각 `get*` 메서드는 세션 초기화 후 `*AfterInit`을 호출하는 2단 구조다.

## 4. 디버깅 방법

1. `src/services/debugLog.ts`의 디버그 로그(앱 설정에서 켜기)를 공유받아 확인한다. 민감 정보는 `redactSensitive`로 가려져 있다.
2. 브라우저에서 재현: `npm run dev` 후 앱의 `/api/proxy`가 `vite.config.ts` 미들웨어로 학교 서버에 중계된다.
3. 실서버 확인: `tests/test_lms_connection.mjs`, `test_all_courses.mjs`, `test_hsctis_nexacro.mjs`는 `.env`의 실제 계정을 쓴다. **실행 전 사용자에게 확인**하고 반복 실행하지 않는다.
4. 사이트 구조가 바뀐 것으로 보이면 추측으로 정규식을 고치지 말고, 사용자에게 실제 응답 HTML이나 HAR 샘플을 요청한다.
