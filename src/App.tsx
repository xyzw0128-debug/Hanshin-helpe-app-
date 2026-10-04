import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Home,
  BookOpen,
  GraduationCap,
  Menu,
  ExternalLink,
  CheckCircle,
  ChevronRight,
  User,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { UserConfig, AppStateData, AssignmentItem, NoticeItem } from './types';
import { loadConfig, saveConfig, clearSecureStorage, loadAppState, saveAppState } from './services/storage';
import { LmsAuthService } from './services/lmsAuth';
import { HsctisAuthService } from './services/hsctisAuth';
import { HsctisScraperService } from './services/hsctisScraper';
import { NotificationService } from './services/notifications';
import { parseNoticeDate } from './utils/date';
import { useLmsSync } from './hooks/useLmsSync';
import { configureBackgroundSync, restoreLmsSession, clearLmsSession } from './services/backgroundSync';
import { initDebugLog, debugLog } from './services/debugLog';

import { Header } from './components/Header';
import { SubjectChips } from './components/SubjectChips';
import { AssignmentCard } from './components/AssignmentCard';
import { LectureCard } from './components/LectureCard';
import { NoticeCard } from './components/NoticeCard';
import { DetailBottomSheet } from './components/DetailBottomSheet';
import { SettingsView } from './components/SettingsView';
import { OnboardingView } from './components/OnboardingView';
import { CampusQuickHub } from './components/CampusQuickHub';
import { AcademicView } from './components/AcademicView';

export type MainTab = 'home' | 'lms' | 'academics' | 'menu';
export type LmsSubTab = 'assignments' | 'lectures' | 'notices';

export const App: React.FC = () => {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [state, setState] = useState<AppStateData>({
    lastSyncTime: null,
    courses: [],
    assignments: [],
    lectures: [],
    notices: [],
    seenItemKeys: [],
    sentReminders: {},
  });

  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [lmsSubTab, setLmsSubTab] = useState<LmsSubTab>('assignments');
  const [isAcademicSyncing, setIsAcademicSyncing] = useState<boolean>(false);
  const [selectedSubject, setSelectedSubject] = useState<string>('전체');
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<'all' | 'unsubmitted' | 'submitted'>('all');

  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentItem | null>(null);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2500);
  };

  const { isSyncing, performSync } = useLmsSync(
    config,
    state,
    setState,
    setConfig,
    setActiveTab,
    showToast
  );

  const changeTab = (tab: MainTab, subTab?: LmsSubTab) => {
    setActiveTab(tab);
    if (subTab) setLmsSubTab(subTab);
    setSelectedSubject('전체');
    setAssignmentStatusFilter('all');
  };

  // 탭(홈, 과제, 강의, 공지 등) 전환 시 과목별 필터를 항상 '전체'로 자동 초기화
  useEffect(() => {
    setSelectedSubject('전체');
    setAssignmentStatusFilter('all');
  }, [activeTab]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    async function init() {
      await initDebugLog();
      // 설정과 상태를 병렬 로드 (네이티브 브리지 오버헤드 단축)
      const [cfg, st] = await Promise.all([loadConfig(), loadAppState()]);
      setConfig(cfg);
      debugLog('app', '앱 시작', {
        hasAccount: !!(cfg.userId && cfg.userPw),
        backgroundSync: cfg.backgroundSyncEnabled !== false,
        interval: cfg.syncIntervalMinutes,
        cachedAssignments: st.assignments?.length ?? 0,
      });
      // 기존에 저장된 샘플/데모 데이터가 있으면 정리하여 실제 계정 데이터와 혼동 방지
      if (st.academicData && st.academicData.lastUpdated === '동기화 대기 중') {
        st.academicData = undefined;
      }
      setState(st);

      // 푸시 알림 권한 요청
      if (cfg.pushNotificationsEnabled) {
        await NotificationService.requestPermission();
      }

      // Android WorkManager 백그라운드 동기화 스케줄링 설정
      await configureBackgroundSync(
        cfg.backgroundSyncEnabled !== false,
        cfg.syncIntervalMinutes ?? 30
      );

      // 포그라운드 진입 시: 계정 정보가 있는 경우 세션 유효성 확인 및 무자각 자동 재인증
      if (cfg.userId && cfg.userPw) {
        // Capacitor가 앱 시작 시 지운 LMS 세션 쿠키를 복원 → 세션이 살아 있으면 SSO 재로그인 생략(PC 세션 보호)
        const restored = await restoreLmsSession();
        const isValid = await LmsAuthService.isSessionValid();
        debugLog('app', '시작 시 세션 확인', { restoredCookie: restored, sessionValid: isValid });
        if (!isValid) {
          // 세션 만료 시 백그라운드 무자각 자동 재로그인 및 데이터 갱신
          try {
            await LmsAuthService.login(cfg.userId, cfg.userPw, true);
            performSync(cfg, st, { silent: true });
          } catch (reauthErr) {
            console.warn('Foreground silent re-auth skipped or failed', reauthErr);
          }
        } else {
          // 세션이 유효한 경우에도 포그라운드 앱 구동 시 최신 데이터 무자각 동기화
          performSync(cfg, st, { silent: true });
        }
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 앱 화면 복귀(포그라운드 전환) 시 세션 만료 감지 및 무자각 자동 재인증
  const lastResumeSyncRef = useRef<number>(Date.now());
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && config?.userId && config?.userPw) {
        const now = Date.now();
        if (now - lastResumeSyncRef.current < 10000) return;
        lastResumeSyncRef.current = now;

        const isValid = await LmsAuthService.isSessionValid();
        debugLog('app', '포그라운드 복귀 세션 확인', { sessionValid: isValid });
        if (!isValid) {
          try {
            await LmsAuthService.login(config.userId, config.userPw, true);
            performSync(config, undefined, { silent: true });
          } catch (err) {
            console.warn('Silent re-auth on foreground resume error', err);
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [config?.userId, config?.userPw, performSync]);

  const academicSyncFailedRef = useRef(false);

  const handleSyncAcademic = async () => {
    if (!config?.userId || !config?.userPw) {
      showToast('로그인을 위해 아이디와 비밀번호를 먼저 입력해주세요.');
      return;
    }
    setIsAcademicSyncing(true);
    try {
      showToast('종합정보시스템 인증 및 성적/시간표 조회 중...');
      if (!LmsAuthService.getUserNo()) {
        try {
          await LmsAuthService.login(config.userId, config.userPw);
        } catch (lmsErr) {
          console.warn('LMS login fallback in handleSyncAcademic', lmsErr);
        }
      }
      await HsctisAuthService.login(config.userId, config.userPw, true);
      const academicData = await HsctisScraperService.getAllAcademicData(config.userId);
      setState(prev => ({ ...prev, academicData }));
      saveAppState({ ...state, academicData });
      academicSyncFailedRef.current = false;
      debugLog('academic', '학사 동기화 완료', {
        semesters: academicData.gradeSummary?.semesters.length ?? 0,
        timetableSlots: academicData.timetable.length,
        graduation: academicData.graduation
          ? `${academicData.graduation.totalAcquiredCredits}/${academicData.graduation.totalRequiredCredits}`
          : null,
      });
      showToast('종합정보시스템 학사 데이터 갱신 완료!');
    } catch (e: any) {
      console.warn('Academic sync error', e);
      academicSyncFailedRef.current = true;
      showToast('종합정보 연결 실패: ' + (e.message || '인증 정보를 확인해주세요.'));
    } finally {
      setIsAcademicSyncing(false);
    }
  };

  // 학사 탭 전환 시 학사 데이터가 없으면 자동 동기화 시도 (실패 후 무한 재시도 방지)
  useEffect(() => {
    if (activeTab === 'academics' && config?.userId && config?.userPw && !state.academicData && !isAcademicSyncing && !academicSyncFailedRef.current) {
      handleSyncAcademic();
    }
  }, [activeTab, config?.userId, config?.userPw, state.academicData, isAcademicSyncing]);

  const handleSaveConfig = async (newCfg: UserConfig) => {
    await configureBackgroundSync(
      newCfg.backgroundSyncEnabled !== false,
      newCfg.syncIntervalMinutes ?? 30
    );

    if (newCfg.userId !== config?.userId || newCfg.userPw !== config?.userPw) {
      try {
        await LmsAuthService.login(newCfg.userId, newCfg.userPw, true);
        setConfig(newCfg);
        await saveConfig(newCfg);
        showToast('계정 정보가 확인되어 저장되었습니다.');
        performSync(newCfg);
      } catch (e: any) {
        showToast('저장 실패: ' + (e.message || '아이디 또는 비밀번호가 올바르지 않습니다.'));
      }
      return;
    }

    try {
      setConfig(newCfg);
      await saveConfig(newCfg);
      showToast('설정이 저장되었습니다.');
      performSync(newCfg);
    } catch (e: any) {
      showToast(e.message || '설정 저장에 실패했습니다.');
    }
  };

  const handleLogout = async () => {
    if (!config) return;
    const emptyCfg: UserConfig = { ...config, userId: '', userPw: '' };
    setConfig(emptyCfg);
    await saveConfig(emptyCfg);
    await clearSecureStorage();
    await configureBackgroundSync(false, 30);
    await clearLmsSession();

    // 1. 이전 사용자 수강 과목 및 과제 캐시 초기화
    const emptyState: AppStateData = {
      lastSyncTime: null,
      courses: [],
      assignments: [],
      lectures: [],
      notices: [],
      seenItemKeys: [],
      sentReminders: {},
      academicData: undefined,
    };
    setState(emptyState);
    await saveAppState(emptyState);

    // 2. 화면 탭과 필터를 홈 기본 상태로 리셋
    setActiveTab('home');
    setSelectedSubject('전체');
    setAssignmentStatusFilter('all');

    // 3. 세션 종료
    await LmsAuthService.logout();
    await HsctisAuthService.logout();
    showToast('로그아웃되었습니다.');
  };

  // 과목 목록
  const subjectList = useMemo(() => 
    ['전체', ...Array.from(new Set(state.courses.map(c => c.course_nm)))],
    [state.courses]
  );

  // 필터링된 과제
  const filteredAssignments = useMemo(() => {
    const seen = new Set<string>();
    const deduplicated = state.assignments.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    let result = deduplicated;
    if (selectedSubject !== '전체') result = result.filter(a => a.courseNm.includes(selectedSubject));
    if (assignmentStatusFilter === 'unsubmitted') result = result.filter(a => !a.isSubmitted);
    else if (assignmentStatusFilter === 'submitted') result = result.filter(a => a.isSubmitted);
    return result;
  }, [state.assignments, selectedSubject, assignmentStatusFilter]);

  // 필터링 및 날짜순(최신순) 정렬된 공지사항
  const filteredNotices = useMemo(() => {
    let result = [...state.notices];
    if (selectedSubject !== '전체') result = result.filter(n => n.courseNm.includes(selectedSubject));
    result.sort((a, b) => parseNoticeDate(b.dateStr) - parseNoticeDate(a.dateStr));
    return result;
  }, [state.notices, selectedSubject]);

  // 공지 읽음 상태 (공지를 열거나 '모두 읽음'을 누를 때만 읽음 처리)
  const readNoticeIdSet = useMemo(() => new Set(state.readNoticeIds || []), [state.readNoticeIds]);
  const unreadNoticeCount = useMemo(
    () => state.notices.filter(n => !readNoticeIdSet.has(n.id)).length,
    [state.notices, readNoticeIdSet]
  );

  const markNoticesRead = (ids: string[]) => {
    const current = new Set(state.readNoticeIds || []);
    const toAdd = ids.filter(id => !current.has(id));
    if (toAdd.length === 0) return;
    const nextState = { ...state, readNoticeIds: [...current, ...toAdd] };
    setState(nextState);
    saveAppState(nextState);
  };

  const openNotice = (notice: NoticeItem) => {
    setSelectedNotice(notice);
    markNoticesRead([notice.id]);
  };

  // 홈 탭 마감 과제 수: 기한이 지난 미제출 과제는 제외
  const pendingAssignmentCount = useMemo(() => {
    const nowMs = Date.now();
    return state.assignments.filter(
      a => !a.isSubmitted && (!a.deadlineDate || new Date(a.deadlineDate).getTime() > nowMs)
    ).length;
  }, [state.assignments]);

  // 홈 탭의 긴급 공지 (전체 공지 중 최신 긴급 공지만 선별 노출)
  const urgentNotice = useMemo(() => 
    state.notices.find(n => n.isUrgent),
    [state.notices]
  );

  if (!config) {
    return (
      <div className="min-h-screen max-w-md mx-auto bg-white dark:bg-zinc-900 p-4 space-y-4">
        <div className="h-12 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl animate-pulse" />)}
        </div>
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-zinc-200 dark:bg-zinc-800 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  // 최초 로그인 온보딩 화면
  if (!config.userId || !config.userPw) {
    return (
      <div className="flex flex-col h-screen max-w-md mx-auto bg-white dark:bg-zinc-900">
        <OnboardingView
          initialUserId={config.userId || ''}
          initialRememberId={config.rememberId !== false}
          onLogin={async (id, pw, geminiKey, options) => {
            // 1. LMS 서버에 먼저 실제 로그인을 시도하여 검증 (실패 시 에러 발생 -> OnboardingView 에러 표시)
            await LmsAuthService.login(id, pw, true);

            // 2. 검증 성공 시에만 config 저장 및 상태 반영 (이 시점에 메인 대시보드로 진입)
            const updated: UserConfig = {
              ...config,
              userId: id,
              userPw: pw,
              geminiApiKey: geminiKey,
              rememberId: options?.rememberId ?? true,
              autoLogin: options?.autoLogin ?? true,
            };
            await saveConfig(updated);
            setConfig(updated);

            // 3. 반드시 'home' 메인 화면으로 전환
            setActiveTab('home');
            setSelectedSubject('전체');
            setAssignmentStatusFilter('all');

            // 4. 메인 대시보드 진입 후 과목 및 과제 동기화 실행
            performSync(updated).catch(e => {
              console.error('Initial sync error:', e);
            });
          }}
          isLoading={isSyncing}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden relative">
      {/* 상단 앱바 */}
      <Header
        lastSyncTime={state.lastSyncTime}
        isSyncing={isSyncing}
        onSync={() => performSync()}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
      />

      {/* 토스트 팝업 */}
      {toastMessage && (
        <div className="toast-anim absolute top-16 inset-x-4 bg-hs-800 dark:bg-hs-500 text-white px-4 py-2.5 rounded-2xl shadow-xl z-50 flex items-center gap-2 text-xs font-semibold">
          <CheckCircle className="w-4 h-4 text-emerald-400 dark:text-emerald-300 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 메인 스크롤 콘텐츠 */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-3.5 pb-24">
        {/* [1. 홈 탭] */}
        {activeTab === 'home' && (
          <div className="space-y-3.5">
            {/* 학생 프로필 요약 카드 */}
            <div className="bg-gradient-to-br from-hs-800 via-hs-700 to-hs-900 rounded-3xl p-4 text-white shadow-md relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-inner">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-base font-black tracking-tight">
                        {LmsAuthService.getUserName() || '한신인'}
                      </h2>
                      <span className="text-[10px] bg-white/20 text-white font-bold px-1.5 py-0.5 rounded-full">
                        재학생
                      </span>
                    </div>
                    <p className="text-xs text-hs-200 font-medium">
                      {LmsAuthService.getDeptName() ? `${LmsAuthService.getDeptName()} · ` : ''}학번 {LmsAuthService.getUserNo() || config.userId}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-hs-200 block font-semibold">스마트 알리미</span>
                  <span className="text-xs font-black text-emerald-300 flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    동기화 활성
                  </span>
                </div>
              </div>
            </div>

            {/* 캠퍼스 퀵허브 (원터치 외부 공식 앱 런처) */}
            <CampusQuickHub />

            {/* 긴급 공지 배너 (학교 지정 [긴급] 또는 AI가 판별한 긴급 공지일 때만 노출) */}
            {urgentNotice && urgentNotice.isUrgent && (
              <div
                onClick={() => openNotice(urgentNotice)}
                className="p-4 bg-red-50 dark:bg-red-950/40 border-2 border-red-200 dark:border-red-800/60 rounded-2xl shadow-sm cursor-pointer active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center flex-shrink-0 font-bold text-sm shadow-sm">
                    !
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-red-600 dark:text-red-400 tracking-wide">
                          긴급 필독 공지
                        </span>
                        <span className="text-xs text-hs-700 dark:text-hs-300 font-semibold">• {urgentNotice.courseNm}</span>
                      </div>
                      <span className="text-xs text-zinc-400">터치 시 전문 ›</span>
                    </div>
                    <h3 className="text-xs font-black text-zinc-900 dark:text-white truncate mt-0.5">
                      {urgentNotice.title}
                    </h3>
                    {urgentNotice.summaryLines && urgentNotice.summaryLines.length > 0 && (
                      <div className="mt-2 p-2.5 bg-white dark:bg-zinc-900 rounded-xl border border-red-100 dark:border-red-900/40">
                        <p className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed font-medium">
                          {urgentNotice.summaryLines[0]}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 통계 메트릭 카드 (클릭 시 LMS 탭 해당 서브탭으로 이동) */}
            <div className="grid grid-cols-3 gap-2">
              <div
                onClick={() => changeTab('lms', 'assignments')}
                className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-3 rounded-2xl text-center shadow-sm cursor-pointer active:scale-95 transition-all hover:border-hs-300"
              >
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">마감 과제</span>
                <span className="text-xl font-black text-red-600 dark:text-red-400">
                  {pendingAssignmentCount}
                  <span className="text-xs font-semibold text-zinc-400 ml-0.5">건</span>
                </span>
              </div>
              <div
                onClick={() => changeTab('lms', 'lectures')}
                className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-3 rounded-2xl text-center shadow-sm cursor-pointer active:scale-95 transition-all hover:border-hs-300"
              >
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">미수강 강의</span>
                <span className="text-xl font-black text-amber-600 dark:text-amber-400">
                  {state.lectures.filter(l => !l.isAttended).length}
                  <span className="text-xs font-semibold text-zinc-400 ml-0.5">개</span>
                </span>
              </div>
              <div
                onClick={() => changeTab('lms', 'notices')}
                className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-3 rounded-2xl text-center shadow-sm cursor-pointer active:scale-95 transition-all hover:border-hs-300"
              >
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">안 읽은 공지</span>
                <span className="text-xl font-black text-hs-700 dark:text-hs-300">
                  {unreadNoticeCount}
                  <span className="text-xs font-semibold text-zinc-400 ml-0.5">건</span>
                </span>
              </div>
            </div>

            {/* 과목 필터 칩 */}
            <SubjectChips
              subjects={subjectList}
              selectedSubject={selectedSubject}
              onSelectSubject={setSelectedSubject}
            />

            {/* 오늘 & 마감 임박 과제 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-hs-700 dark:bg-hs-400"></span> 과제 현황
                </h3>
                <button
                  onClick={() => changeTab('lms', 'assignments')}
                  className="text-xs font-bold text-hs-700 dark:text-hs-300 hover:underline"
                >
                  전체보기 ›
                </button>
              </div>

              {filteredAssignments.length === 0 ? (
                <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-1">
                  <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                  <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                    {state.courses.length === 0 ? 'LMS 동기화를 진행해주세요.' : '등록된 마감 과제가 없습니다.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredAssignments.slice(0, 5).map(item => (
                    <AssignmentCard
                      key={item.id}
                      item={item}
                      onClick={() => setSelectedAssignment(item)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* LMS 바로가기 링크 */}
            <div className="p-3 bg-hs-50 dark:bg-hs-950/50 rounded-2xl border border-hs-200 dark:border-hs-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-hs-700 dark:text-hs-400" />
                <span className="text-xs font-semibold text-hs-800 dark:text-hs-200">한신대 LMS 공식 포털</span>
              </div>
              <a
                href="https://lms.hs.ac.kr"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 bg-hs-700 hover:bg-hs-800 dark:bg-hs-500 text-white text-xs font-bold rounded-lg shadow-sm"
              >
                웹 열기 ↗
              </a>
            </div>
          </div>
        )}

        {/* [2. LMS 탭 (통합 3종 서브탭: 과제·퀴즈 | 온라인 강의 | 공지·자료실)] */}
        {activeTab === 'lms' && (
          <div className="space-y-3.5">
            {/* 상단 3개 서브탭 네비게이터 */}
            <div className="flex p-1 bg-zinc-200/80 dark:bg-zinc-900 rounded-2xl text-xs font-bold shadow-inner">
              <button
                onClick={() => setLmsSubTab('assignments')}
                className={`flex-1 py-2 text-center rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  lmsSubTab === 'assignments'
                    ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <span>과제·퀴즈</span>
                {state.assignments.filter(a => !a.isSubmitted).length > 0 && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 rounded-full text-[10px] font-black">
                    {state.assignments.filter(a => !a.isSubmitted).length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setLmsSubTab('lectures')}
                className={`flex-1 py-2 text-center rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  lmsSubTab === 'lectures'
                    ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <span>온라인 강의</span>
                {state.lectures.filter(l => !l.isAttended).length > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 rounded-full text-[10px] font-black">
                    {state.lectures.filter(l => !l.isAttended).length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setLmsSubTab('notices')}
                className={`flex-1 py-2 text-center rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  lmsSubTab === 'notices'
                    ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <span>공지·자료실</span>
                {unreadNoticeCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-hs-100 text-hs-700 dark:bg-hs-950 dark:text-hs-300 rounded-full text-[10px] font-black">
                    {unreadNoticeCount}
                  </span>
                )}
              </button>
            </div>

            {/* 서브탭 1: 과제·퀴즈 */}
            {lmsSubTab === 'assignments' && (
              <div className="space-y-3">
                <div className="flex p-1 bg-zinc-100 dark:bg-zinc-900/60 rounded-xl text-xs font-bold border border-zinc-200/60 dark:border-zinc-800">
                  <button
                    onClick={() => setAssignmentStatusFilter('all')}
                    className={`flex-1 py-1.5 text-center rounded-lg transition-all ${
                      assignmentStatusFilter === 'all'
                        ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    전체 ({state.assignments.length})
                  </button>
                  <button
                    onClick={() => setAssignmentStatusFilter('unsubmitted')}
                    className={`flex-1 py-1.5 text-center rounded-lg transition-all ${
                      assignmentStatusFilter === 'unsubmitted'
                        ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    미제출 ({state.assignments.filter(a => !a.isSubmitted).length})
                  </button>
                  <button
                    onClick={() => setAssignmentStatusFilter('submitted')}
                    className={`flex-1 py-1.5 text-center rounded-lg transition-all ${
                      assignmentStatusFilter === 'submitted'
                        ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    제출완료 ({state.assignments.filter(a => a.isSubmitted).length})
                  </button>
                </div>

                <SubjectChips
                  subjects={subjectList}
                  selectedSubject={selectedSubject}
                  onSelectSubject={setSelectedSubject}
                />

                {filteredAssignments.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-1">
                    <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">조건에 맞는 과제가 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredAssignments.map(item => (
                      <AssignmentCard
                        key={item.id}
                        item={item}
                        onClick={() => setSelectedAssignment(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 서브탭 2: 온라인 강의 */}
            {lmsSubTab === 'lectures' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
                  <span className="font-semibold">학기 온라인 동영상 강의 진도율</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                    {state.lectures.filter(l => !l.isAttended).length}개 미수강
                  </span>
                </div>

                <SubjectChips
                  subjects={subjectList}
                  selectedSubject={selectedSubject}
                  onSelectSubject={setSelectedSubject}
                />

                {state.lectures.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-1">
                    <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">등록된 온라인 강의가 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {state.lectures
                      .filter(l => selectedSubject === '전체' || l.courseNm.includes(selectedSubject))
                      .map(item => (
                        <LectureCard key={item.id} item={item} />
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* 서브탭 3: 공지·자료실 */}
            {lmsSubTab === 'notices' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs px-1">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-zinc-500 font-semibold">전체 공지사항</span>
                    <span className="text-xs font-bold text-hs-700 dark:text-hs-300 bg-hs-50 dark:bg-hs-950/60 px-2 py-0.5 rounded-full border border-hs-200 dark:border-hs-800">
                      📅 최신 날짜순 정렬
                    </span>
                  </div>
                  <button
                    onClick={() => markNoticesRead(state.notices.map(n => n.id))}
                    disabled={unreadNoticeCount === 0}
                    className="text-xs font-bold text-hs-700 dark:text-hs-200 bg-hs-100 dark:bg-hs-900 px-2 py-0.5 rounded-full flex items-center gap-1 active:scale-95 transition-all disabled:opacity-40"
                  >
                    <CheckCircle className="w-3 h-3" />
                    모두 읽음
                  </button>
                </div>

                <SubjectChips
                  subjects={subjectList}
                  selectedSubject={selectedSubject}
                  onSelectSubject={setSelectedSubject}
                />

                {filteredNotices.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-1">
                    <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">공지사항이 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredNotices.map(item => (
                      <NoticeCard
                        key={item.id}
                        item={item}
                        isRead={readNoticeIdSet.has(item.id)}
                        onClick={() => openNotice(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* [3. 학사/성적 탭 (종합정보)] */}
        {activeTab === 'academics' && (
          <AcademicView
            academicData={state.academicData}
            isLoading={isAcademicSyncing}
            onRefresh={handleSyncAcademic}
          />
        )}

        {/* [4. 전체메뉴 탭] */}
        {activeTab === 'menu' && (
          <div className="space-y-4 pb-6">
            {/* 프로필 & 로그아웃 카드 */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-hs-100 dark:bg-hs-950 border border-hs-200 dark:border-hs-800 text-hs-700 dark:text-hs-300 flex items-center justify-center font-black">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-zinc-900 dark:text-white">
                      {LmsAuthService.getUserName() || '한신대학교 학생'}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      학번 {LmsAuthService.getUserNo() || config.userId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/50 flex items-center gap-1 transition-all active:scale-95"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>로그아웃</span>
                </button>
              </div>
            </div>

            {/* 한신대 주요 시스템 빠른 바로가기 */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-4 shadow-sm space-y-2.5">
              <h4 className="text-xs font-black text-zinc-800 dark:text-zinc-200 px-1">캠퍼스 주요 시스템 바로가기</h4>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href="https://lms.hs.ac.kr"
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-hs-50 dark:hover:bg-hs-950/50 border border-zinc-200/70 dark:border-zinc-700/60 rounded-2xl flex items-center justify-between transition-colors"
                >
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100 block">한신대 LMS</span>
                    <span className="text-[10px] text-zinc-400">공식 학습관리포털</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>

                <a
                  href="https://hsctis.hs.ac.kr"
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-hs-50 dark:hover:bg-hs-950/50 border border-zinc-200/70 dark:border-zinc-700/60 rounded-2xl flex items-center justify-between transition-colors"
                >
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100 block">종합정보시스템</span>
                    <span className="text-[10px] text-zinc-400">학적/성적/등록</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>

                <a
                  href="https://sugang.hs.ac.kr"
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-hs-50 dark:hover:bg-hs-950/50 border border-zinc-200/70 dark:border-zinc-700/60 rounded-2xl flex items-center justify-between transition-colors"
                >
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100 block">수강신청 시스템</span>
                    <span className="text-[10px] text-zinc-400">정규 및 계절수강</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>

                <a
                  href="https://hslib.hs.ac.kr"
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-hs-50 dark:hover:bg-hs-950/50 border border-zinc-200/70 dark:border-zinc-700/60 rounded-2xl flex items-center justify-between transition-colors"
                >
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100 block">중앙도서관</span>
                    <span className="text-[10px] text-zinc-400">도서검색/열람실</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>
              </div>
            </div>

            {/* 환경설정 뷰 내장 */}
            <SettingsView
              config={config}
              onSaveConfig={handleSaveConfig}
              onLogout={handleLogout}
            />
          </div>
        )}
      </div>

      {/* 상세 바텀시트 모달 */}
      <DetailBottomSheet
        assignment={selectedAssignment}
        notice={selectedNotice}
        onClose={() => {
          setSelectedAssignment(null);
          setSelectedNotice(null);
        }}
      />

      {/* 하단 고정 네비게이션 바 (모바일 표준 4탭) */}
      <div className="absolute bottom-0 inset-x-0 h-16 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-t border-zinc-200/80 dark:border-zinc-800 flex items-center justify-around px-2 z-20 transition-colors duration-200">
        <button
          onClick={() => changeTab('home')}
          className={`relative flex flex-col items-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'home' ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {activeTab === 'home' && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-hs-700 dark:bg-hs-400" />}
          <Home className="w-5 h-5" />
          <span className={`text-[11px] ${activeTab === 'home' ? 'font-bold' : 'font-semibold'}`}>홈</span>
        </button>

        <button
          onClick={() => changeTab('lms')}
          className={`relative flex flex-col items-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'lms' ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {activeTab === 'lms' && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-hs-700 dark:bg-hs-400" />}
          <BookOpen className="w-5 h-5" />
          <span className={`text-[11px] ${activeTab === 'lms' ? 'font-bold' : 'font-semibold'}`}>LMS</span>
        </button>

        <button
          onClick={() => changeTab('academics')}
          className={`relative flex flex-col items-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'academics' ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {activeTab === 'academics' && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-hs-700 dark:bg-hs-400" />}
          <GraduationCap className="w-5 h-5" />
          <span className={`text-[11px] ${activeTab === 'academics' ? 'font-bold' : 'font-semibold'}`}>학사</span>
        </button>

        <button
          onClick={() => changeTab('menu')}
          className={`relative flex flex-col items-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'menu' ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {activeTab === 'menu' && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-hs-700 dark:bg-hs-400" />}
          <Menu className="w-5 h-5" />
          <span className={`text-[11px] ${activeTab === 'menu' ? 'font-bold' : 'font-semibold'}`}>전체메뉴</span>
        </button>
      </div>
    </div>
  );
};
