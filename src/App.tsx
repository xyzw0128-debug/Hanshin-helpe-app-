import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Home, BookOpen, GraduationCap, Menu, CheckCircle, MonitorSmartphone, RotateCw, Download, X } from 'lucide-react';
import { UserConfig, AppStateData, AssignmentItem, NoticeItem, StudentProfile, HomeCardSetting } from './types';
import { loadConfig, saveConfig, clearSecureStorage, loadAppState, saveAppState } from './services/storage';
import { LmsAuthService, isCredentialsError } from './services/lmsAuth';
import { NotificationService, onNotificationOpen } from './services/notifications';
import { useLmsSync, syncDeadlineReminders } from './hooks/useLmsSync';
import {
  configureBackgroundSync,
  restoreLmsSession,
  clearLmsSession,
  syncNotificationPrefs,
} from './services/backgroundSync';
import { consumeOpenTarget, openExternal, OpenTarget } from './services/appShell';
import { setRootBack, useBackHandler } from './services/backNav';
import { checkForUpdate, dismissUpdate, isUpdateDismissed, UpdateInfo } from './services/updateCheck';
import { usePullToRefresh, PULL_TRIGGER_PX } from './hooks/usePullToRefresh';
import { initDebugLog, debugLog } from './services/debugLog';
import { applyReleasePolicy } from './services/buildPolicy';
import { canRelogin, isSyncPaused, onSyncPausedChange, resumeSync } from './services/sessionGuard';
import { normalizeHomeCards } from './utils/homeCards';
import { nextNavHistory, sameView, ViewState } from './utils/navHistory';

import { DetailBottomSheet } from './components/DetailBottomSheet';
import type { AcademicSection } from './components/AcademicView';
import { HomeView, HomeNavigateTarget } from './components/HomeView';
import { LmsView, LmsSubTab } from './components/LmsView';
import { MenuView, MenuSubpage } from './components/MenuView';
import { SubpageLayout } from './components/SubpageLayout';
import { ExitHint } from './components/ExitHint';

// 자주 열지 않는 화면은 처음 열 때 불러옴: 학사(종합정보 통신 코드 포함), 설정·홈 편집·앱 정보, 로그인 화면
const AcademicView = lazy(() => import('./components/AcademicView').then(m => ({ default: m.AcademicView })));
const SettingsView = lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })));
const HomeEditView = lazy(() => import('./components/HomeEditView').then(m => ({ default: m.HomeEditView })));
const AppInfoView = lazy(() => import('./components/AppInfoView').then(m => ({ default: m.AppInfoView })));
const LicensesView = lazy(() => import('./components/LicensesView').then(m => ({ default: m.LicensesView })));
const OnboardingView = lazy(() => import('./components/OnboardingView').then(m => ({ default: m.OnboardingView })));
const loadHsctis = () =>
  Promise.all([import('./services/hsctisAuth'), import('./services/hsctisScraper')]).then(([auth, scraper]) => ({
    HsctisAuthService: auth.HsctisAuthService,
    HsctisScraperService: scraper.HsctisScraperService,
  }));

const CREDENTIALS_REJECTED_NOTICE =
  '저장된 비밀번호가 맞지 않아 로그아웃했어요. 포털 비밀번호를 바꿨다면 새 비밀번호로 로그인해 주세요. (여러 번 틀리면 포털 계정이 잠길 수 있어요)';

export type MainTab = 'home' | 'lms' | 'academics' | 'menu';

const SUBPAGE_TITLES: Record<MenuSubpage, string> = {
  settings: '설정',
  homeEdit: '홈 화면 편집',
  appInfo: '앱 정보',
  licenses: '오픈소스 라이선스',
};

const LMS_SUBS: LmsSubTab[] = ['assignments', 'lectures', 'notices', 'materials'];

const EMPTY_STATE: AppStateData = {
  lastSyncTime: null,
  courses: [],
  assignments: [],
  lectures: [],
  notices: [],
  seenItemKeys: [],
  sentReminders: {},
};

/** 백그라운드 동기화는 알림 전용이므로 푸시 알림이 꺼져 있으면 함께 끈다 */
const isBackgroundSyncOn = (cfg: UserConfig) =>
  cfg.backgroundSyncEnabled !== false && cfg.pushNotificationsEnabled !== false;

export const App: React.FC = () => {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [state, setState] = useState<AppStateData>(EMPTY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  // 비밀번호 오류로 로그인 화면에 돌아왔을 때 보여 줄 안내
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [lmsSubTab, setLmsSubTab] = useState<LmsSubTab>('assignments');
  const [academicSection, setAcademicSection] = useState<AcademicSection>('timetable');
  const [subpages, setSubpages] = useState<MenuSubpage[]>([]);
  const [isAcademicSyncing, setIsAcademicSyncing] = useState(false);

  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentItem | null>(null);
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [systemDark, setSystemDark] = useState<boolean>(
    () => !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2500);
  };

  // ---------- 화면 이동과 안드로이드 뒤로가기 ----------
  // 화면(탭·LMS 하위 탭·학사 섹션)을 옮길 때마다 직전 화면을 기록해 두고, 뒤로가기는 열린 창을 먼저 닫은 뒤
  // 기록을 거슬러 이전 화면 → 홈으로 돌아간다. 홈 탭으로 가면 기록을 비워 홈에서는 "한 번 더 누르면 종료".
  // (WebView history는 쓰지 않음: services/backNav.ts 참고)
  const [navHistory, setNavHistory] = useState<ViewState[]>([]);
  const viewRef = useRef<ViewState>({ tab: activeTab, lmsSub: lmsSubTab, academic: academicSection });
  viewRef.current = { tab: activeTab, lmsSub: lmsSubTab, academic: academicSection };

  const applyView = (v: ViewState) => {
    setActiveTab(v.tab);
    setLmsSubTab(v.lmsSub);
    setAcademicSection(v.academic);
  };

  const goTo = useCallback((patch: Partial<ViewState>) => {
    const cur = viewRef.current;
    const next: ViewState = { ...cur, ...patch };
    if (sameView(cur, next)) return;
    setNavHistory(h => nextNavHistory(h, cur, next));
    viewRef.current = next;
    applyView(next);
  }, []);

  const switchTab = useCallback((tab: MainTab) => goTo({ tab }), [goTo]);

  const goHome = useCallback(() => {
    setNavHistory([]);
    viewRef.current = { ...viewRef.current, tab: 'home' };
    setActiveTab('home');
  }, []);

  // 저장된 비밀번호가 틀림(포털 비밀번호 변경 등) → 더 시도하지 않고 로그인 화면으로.
  // 아이디와 화면 데이터(본 항목 기록 포함)는 남겨 같은 계정으로 다시 로그인하면 알림이 쏟아지지 않게 함
  const handleCredentialsRejected = useCallback(async (cfg?: UserConfig) => {
    const base = cfg || configRef.current;
    if (!base) return;
    debugLog('auth', '저장된 비밀번호 거부 → 로그인 화면으로');
    const next: UserConfig = { ...base, userPw: '', rememberId: true };
    setConfig(next);
    setSubpages([]);
    setSelectedAssignment(null);
    setSelectedNotice(null);
    setLmsQuery(null);
    goHome();
    setLoginNotice(CREDENTIALS_REJECTED_NOTICE);
    try {
      await saveConfig(next); // 비밀번호가 비면 보안 저장소의 비밀번호도 지움
      await configureBackgroundSync(false, base.syncIntervalMinutes ?? 30);
      await clearLmsSession();
      await LmsAuthService.logout();
    } catch (e) {
      console.warn('Credentials-rejected cleanup failed', e);
    }
  }, [goHome]);

  const { isSyncing, performSync } = useLmsSync(
    config,
    state,
    setState,
    setConfig,
    switchTab,
    showToast,
    handleCredentialsRejected
  );

  // 다른 곳(PC) 로그인 의심으로 자동 동기화를 멈춘 상태
  const [syncPaused, setSyncPaused] = useState<boolean>(isSyncPaused);
  useEffect(() => onSyncPausedChange(setSyncPaused), []);

  // ---------- 테마 (시스템 / 라이트 / 다크) ----------
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const themeMode = config?.themeMode || 'system';
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // ---------- 하위 화면 · 바텀시트 (뒤로가기로 가장 위의 것부터 닫힘) ----------
  const sheetOpen = !!(selectedAssignment || selectedNotice);
  const closeSheet = () => {
    setSelectedAssignment(null);
    setSelectedNotice(null);
  };
  const closeTopSubpage = () => setSubpages(prev => prev.slice(0, -1));
  useBackHandler(subpages.length > 0, closeTopSubpage);
  useBackHandler(sheetOpen, closeSheet);

  // LMS 검색 (null = 닫힘). 뒤로가기로 닫고, 다른 탭으로 가면 닫음
  const [lmsQuery, setLmsQuery] = useState<string | null>(null);
  useBackHandler(lmsQuery !== null && activeTab === 'lms', () => setLmsQuery(null));
  useEffect(() => {
    if (activeTab !== 'lms') setLmsQuery(null);
  }, [activeTab]);

  const openSubpage = (page: MenuSubpage) => setSubpages(prev => [...prev, page]);

  const openAssignment = (a: AssignmentItem) => setSelectedAssignment(a);

  // ---------- 공지 읽음 ----------
  const readNoticeIdSet = useMemo(() => new Set(state.readNoticeIds || []), [state.readNoticeIds]);

  const markNoticesRead = (ids: string[]) => {
    const current = new Set(stateRef.current.readNoticeIds || []);
    const toAdd = ids.filter(id => !current.has(id));
    if (toAdd.length === 0) return;
    const nextState = { ...stateRef.current, readNoticeIds: [...current, ...toAdd] };
    setState(nextState);
    saveAppState(nextState);
  };

  const openNotice = (notice: NoticeItem) => {
    setSelectedNotice(notice);
    markNoticesRead([notice.id]);
  };

  // ---------- 초기화 ----------
  useEffect(() => {
    async function init() {
      await initDebugLog();
      // 설정과 상태를 병렬 로드 (네이티브 브리지 오버헤드 단축)
      const [loadedCfg, st] = await Promise.all([loadConfig(), loadAppState()]);
      // 배포 앱에서 숨긴 기능(Gemini·디스코드·PC 보호 스위치·계정 설정)의 값을 고정 (initDebugLog 이후여야 빌드 종류를 앎)
      const cfg = applyReleasePolicy(loadedCfg);
      setConfig(cfg);
      debugLog('app', '앱 시작', {
        hasAccount: !!(cfg.userId && cfg.userPw),
        backgroundSync: isBackgroundSyncOn(cfg),
        interval: cfg.syncIntervalMinutes,
        cachedAssignments: st.assignments?.length ?? 0,
      });
      // 기존에 저장된 샘플/데모 데이터가 있으면 정리하여 실제 계정 데이터와 혼동 방지
      if (st.academicData && st.academicData.lastUpdated === '동기화 대기 중') {
        st.academicData = undefined;
      }
      setState(st);

      const hasAccount = !!(cfg.userId && cfg.userPw);
      // 저장된 목록으로 마감 알림을 다시 예약 (강제 종료·정확한 알람 권한 해제 때 시스템이 알람을 지우므로)
      if (hasAccount) {
        syncDeadlineReminders(st.assignments || [], st.lectures || [], cfg).catch(e => console.warn('Reminder sync failed', e));
      }
      // 알림 권한, 백그라운드 동기화 예약, 세션 쿠키 복원은 서로 독립이라 함께 처리 (시작 대기 시간 단축)
      // Capacitor가 앱 시작 시 지운 LMS 세션 쿠키를 복원 → 세션이 살아 있으면 SSO 재로그인 생략(PC 세션 보호)
      const [, , , restoreResult] = await Promise.all([
        cfg.pushNotificationsEnabled ? NotificationService.requestPermission() : Promise.resolve(),
        configureBackgroundSync(isBackgroundSyncOn(cfg) && hasAccount, cfg.syncIntervalMinutes ?? 30),
        syncNotificationPrefs(cfg),
        hasAccount ? restoreLmsSession() : Promise.resolve({ restored: false, hasCookie: false }),
      ]);

      // 포그라운드 진입 시: 계정 정보가 있는 경우 세션 유효성 확인 및 무자각 자동 재인증
      if (hasAccount) {
        const { restored, hasCookie } = restoreResult;
        const session = await LmsAuthService.checkSession();
        debugLog('app', '시작 시 세션 확인', { restoredCookie: restored, hasCookie, session });
        if (session === 'error') {
          // 네트워크 오류: 세션이 끊겼는지 알 수 없으므로 재로그인하지 않고 캐시 화면 유지
        } else if (session === 'invalid') {
          // 세션 쿠키 자체가 없으면 끊긴 게 아니라 처음부터 세션이 없는 것이므로 다른 곳 로그인을 의심하지 않음
          // (restored=false는 "이미 쿠키가 있어 복원할 필요가 없었음"일 수도 있으므로 hasCookie로 판단)
          const allowed =
            !hasCookie && !isSyncPaused()
              ? true
              : await canRelogin({ enabled: cfg.protectPcSession !== false, interactive: false });
          if (!allowed) {
            debugLog('app', '다른 곳 로그인 의심 → 시작 시 재로그인 생략');
            return;
          }
          try {
            await LmsAuthService.login(cfg.userId, cfg.userPw, true);
            performSync(cfg, st, { silent: true });
          } catch (reauthErr) {
            if (isCredentialsError(reauthErr)) handleCredentialsRejected(cfg);
            else console.warn('Foreground silent re-auth skipped or failed', reauthErr);
          }
        } else {
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

        const session = await LmsAuthService.checkSession();
        debugLog('app', '포그라운드 복귀 세션 확인', { session });
        if (session === 'invalid') {
          if (!(await canRelogin({ enabled: config.protectPcSession !== false, interactive: false }))) {
            debugLog('app', '다른 곳 로그인 의심 → 복귀 시 재로그인 생략');
            return;
          }
          try {
            await LmsAuthService.login(config.userId, config.userPw, true);
            performSync(config, undefined, { silent: true });
          } catch (err) {
            if (isCredentialsError(err)) handleCredentialsRejected(config);
            else console.warn('Silent re-auth on foreground resume error', err);
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [config?.userId, config?.userPw, config?.protectPcSession, performSync, handleCredentialsRejected]);

  // ---------- 학사 동기화 ----------
  const academicSyncFailedRef = useRef(false);

  const handleSyncAcademic = async () => {
    if (!config?.userId || !config?.userPw) {
      showToast('로그인을 위해 아이디와 비밀번호를 먼저 입력해주세요.');
      return;
    }
    setIsAcademicSyncing(true);
    try {
      showToast('종합정보시스템에서 시간표·성적을 불러오는 중...');
      // 학번은 종합정보 로그인(/cs/init/user)이 직접 주고, LMS 학번은 보조값일 뿐이므로
      // LMS SSO 로그인(PC 세션을 끊음)은 하지 않고 세션이 살아 있을 때만 세션 확인으로 채운다
      if (!LmsAuthService.getUserNo()) {
        await LmsAuthService.checkSession();
      }
      const { HsctisAuthService, HsctisScraperService } = await loadHsctis();
      await HsctisAuthService.login(config.userId, config.userPw, true);
      const academicData = await HsctisScraperService.getAllAcademicData(config.userId);
      const nextState = { ...stateRef.current, academicData };
      stateRef.current = nextState;
      setState(nextState);
      saveAppState(nextState);
      academicSyncFailedRef.current = false;
      debugLog('academic', '학사 동기화 완료', {
        semesters: academicData.gradeSummary?.semesters.length ?? 0,
        timetableSlots: academicData.timetable.length,
        graduation: academicData.graduation
          ? `${academicData.graduation.totalAcquiredCredits}/${academicData.graduation.totalRequiredCredits}`
          : null,
      });
      showToast('학사 정보를 갱신했습니다.');
    } catch (e: any) {
      console.warn('Academic sync error', e);
      academicSyncFailedRef.current = true;
      if (isCredentialsError(e)) {
        handleCredentialsRejected();
        return;
      }
      showToast('종합정보 연결 실패: ' + (e.message || '인증 정보를 확인해주세요.'));
    } finally {
      setIsAcademicSyncing(false);
    }
  };

  // 학사 탭 전환 시 학사 데이터가 없으면 자동 동기화 시도 (실패 후 무한 재시도 방지)
  useEffect(() => {
    if (
      activeTab === 'academics' &&
      config?.userId &&
      config?.userPw &&
      !state.academicData &&
      !isAcademicSyncing &&
      !academicSyncFailedRef.current
    ) {
      handleSyncAcademic();
    }
  }, [activeTab, config?.userId, config?.userPw, state.academicData, isAcademicSyncing]);

  // ---------- 설정 (즉시 적용) ----------
  const updateConfig = useCallback(
    async (patch: Partial<UserConfig>) => {
      if (!config) return;
      const next: UserConfig = { ...config, ...patch };
      setConfig(next);
      try {
        await saveConfig(next);
      } catch (e: any) {
        showToast(e.message || '설정 저장에 실패했습니다.');
        return;
      }

      const changed = (k: keyof UserConfig) => patch[k] !== undefined && patch[k] !== config[k];
      if (changed('pushNotificationsEnabled') && next.pushNotificationsEnabled) {
        await NotificationService.requestPermission();
      }
      if (changed('backgroundSyncEnabled') || changed('pushNotificationsEnabled') || changed('syncIntervalMinutes')) {
        await configureBackgroundSync(isBackgroundSyncOn(next), next.syncIntervalMinutes ?? 30);
      }
      if (changed('protectPcSession') && next.protectPcSession === false) {
        resumeSync();
      }
      if (changed('ddayReminderEnabled') || changed('threeHourReminderEnabled') || changed('pushNotificationsEnabled')) {
        syncDeadlineReminders(stateRef.current.assignments, stateRef.current.lectures, next).catch(e =>
          console.warn('Reminder sync failed', e)
        );
      }
      if (changed('pushNotificationsEnabled') || changed('newAssignmentAlert') || changed('newNoticeAlert')) {
        syncNotificationPrefs(next);
      }
    },
    [config]
  );

  const changeAccount = async (userId: string, userPw: string): Promise<boolean> => {
    if (!config) return false;
    try {
      await LmsAuthService.login(userId, userPw, true);
      const next = { ...config, userId, userPw };
      setConfig(next);
      await saveConfig(next);
      showToast('계정 정보를 확인하고 저장했습니다.');
      performSync(next);
      return true;
    } catch (e: any) {
      showToast('변경 실패: ' + (e.message || '아이디 또는 비밀번호가 올바르지 않습니다.'));
      return false;
    }
  };

  const handleLogout = async () => {
    if (!config) return;
    // 아이디 저장(또는 아이디 저장을 포함하는 자동 로그인)이 켜져 있으면 다음 로그인 화면에 아이디를 남긴다
    const keepId = config.rememberId !== false || config.autoLogin !== false;
    const emptyCfg: UserConfig = {
      ...config,
      userId: keepId ? config.userId : '',
      userPw: '',
      // 비밀번호가 비면 saveConfig는 rememberId만 보고 아이디 보존을 정하므로, 자동 로그인으로 보존한 경우도 맞춰 둠
      rememberId: keepId ? true : config.rememberId,
    };
    setConfig(emptyCfg);
    await saveConfig(emptyCfg);
    await clearSecureStorage();
    await configureBackgroundSync(false, 30);
    await clearLmsSession();
    resumeSync(); // 다른 곳 로그인 의심으로 멈춘 상태가 다음 로그인으로 넘어가지 않게

    setState(EMPTY_STATE);
    await saveAppState(EMPTY_STATE);

    setSubpages([]);
    closeSheet();
    goHome();

    await LmsAuthService.logout();
    // 종합정보 모듈을 이번 실행에서 불러온 적이 없으면 세션도 없으므로 정리할 것이 없음
    await loadHsctis().then(m => m.HsctisAuthService.logout()).catch(() => undefined);
    showToast('로그아웃되었습니다.');
  };

  // ---------- 탭 이동 ----------
  const navigate = (target: HomeNavigateTarget) => {
    if (target.tab === 'lms') goTo({ tab: 'lms', lmsSub: target.sub });
    else goTo({ tab: 'academics', ...(target.sub ? { academic: target.sub } : {}) });
  };

  const homeCards: HomeCardSetting[] = useMemo(() => normalizeHomeCards(config?.homeCards), [config?.homeCards]);

  const profile: StudentProfile = {
    name: state.profile?.name || LmsAuthService.getUserName() || state.academicData?.gradeSummary?.student?.name || '',
    studentNo: state.profile?.studentNo || LmsAuthService.getUserNo() || config?.userId || '',
    dept: state.profile?.dept || LmsAuthService.getDeptName() || state.academicData?.gradeSummary?.student?.major || '',
    gradeYear: state.academicData?.gradeSummary?.student?.gradeYear,
  };

  // ---------- 뒤로가기: 열린 창이 없을 때 → 이전 화면 → 홈 ----------
  const loggedIn = !!(config?.userId && config?.userPw);
  const navHistoryRef = useRef(navHistory);
  navHistoryRef.current = navHistory;
  useEffect(() => {
    setRootBack(loggedIn && (navHistory.length > 0 || activeTab !== 'home'), () => {
      if (!loggedIn) return false;
      const history = navHistoryRef.current;
      const prev = history[history.length - 1];
      if (prev) {
        const rest = history.slice(0, -1);
        navHistoryRef.current = rest; // 빠르게 연달아 눌러도 같은 화면을 두 번 꺼내지 않게
        setNavHistory(rest);
        viewRef.current = prev;
        applyView(prev);
        return true;
      }
      if (viewRef.current.tab !== 'home') {
        goHome();
        return true;
      }
      return false;
    });
  }, [loggedIn, navHistory, activeTab, goHome]);
  useEffect(() => () => setRootBack(false, () => false), []);

  // ---------- 알림·위젯을 눌러 연 화면 ----------
  // 항목이 아직 목록에 없으면(백그라운드에서 먼저 알게 된 새 항목) 동기화가 끝난 뒤 한 번 더 찾아 연다
  const pendingOpenItemRef = useRef<{ sub: LmsSubTab; itemId: string } | null>(null);
  const tryOpenPendingItem = () => {
    const pending = pendingOpenItemRef.current;
    if (!pending) return;
    const st = stateRef.current;
    if (pending.sub === 'assignments') {
      const a = st.assignments.find(x => x.id === pending.itemId);
      if (a) {
        pendingOpenItemRef.current = null;
        setSelectedNotice(null);
        setSelectedAssignment(a);
      }
    } else if (pending.sub === 'notices') {
      const n = st.notices.find(x => x.id === pending.itemId);
      if (n) {
        pendingOpenItemRef.current = null;
        setSelectedAssignment(null);
        openNotice(n);
      }
    } else {
      pendingOpenItemRef.current = null;
    }
  };
  const openTargetRef = useRef<(t: OpenTarget) => void>(() => undefined);
  openTargetRef.current = (t: OpenTarget) => {
    if (!t.target || !loggedIn) return;
    debugLog('app', '알림으로 열기', { target: t.target, hasItem: !!t.itemId });
    setSubpages([]);
    closeSheet();
    setLmsQuery(null);
    const [tab, sub] = t.target.split(':');
    if (tab === 'lms' && LMS_SUBS.includes(sub as LmsSubTab)) {
      goTo({ tab: 'lms', lmsSub: sub as LmsSubTab });
      pendingOpenItemRef.current = t.itemId ? { sub: sub as LmsSubTab, itemId: t.itemId } : null;
      tryOpenPendingItem();
    } else if (tab === 'home') {
      goHome();
    }
  };
  useEffect(() => {
    if (!loggedIn) return;
    const run = (t: OpenTarget) => openTargetRef.current(t);
    consumeOpenTarget().then(run);
    const onEvent = () => consumeOpenTarget().then(run);
    window.addEventListener('hsOpenTarget', onEvent);
    const off = onNotificationOpen(extra => run({ target: extra.open, itemId: extra.itemId }));
    return () => {
      window.removeEventListener('hsOpenTarget', onEvent);
      off();
    };
  }, [loggedIn]);
  useEffect(tryOpenPendingItem, [state.assignments, state.notices]);
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    if (wasSyncingRef.current && !isSyncing) {
      tryOpenPendingItem();
      pendingOpenItemRef.current = null; // 동기화 뒤에도 없으면 포기 (나중에 뜬금없이 열리지 않게)
    }
    wasSyncingRef.current = isSyncing;
  }, [isSyncing]);

  // ---------- 새 버전 안내 (GitHub Releases) ----------
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    if (!loggedIn) return;
    checkForUpdate().then(info => {
      if (info && !isUpdateDismissed(info.version)) setUpdateInfo(info);
    });
  }, [loggedIn]);

  // ---------- 당겨서 새로고침 (홈·LMS) ----------
  // 학사 탭은 새로고침마다 종합정보 SSO 로그인을 하므로 실수로 당겨 로그인되지 않게 새로고침 버튼으로만
  const contentRef = useRef<HTMLDivElement>(null);
  const pullDistance = usePullToRefresh(contentRef, {
    enabled: loggedIn && (activeTab === 'home' || activeTab === 'lms') && !isSyncing,
    onRefresh: () => performSync(),
  });

  if (!config) {
    return (
      <div className="min-h-screen max-w-md mx-auto bg-white dark:bg-zinc-900 p-4 space-y-4">
        <div className="h-12 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-zinc-200 dark:bg-zinc-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // 최초 로그인 온보딩 화면
  if (!config.userId || !config.userPw) {
    return (
      <div className="flex flex-col h-screen max-w-md mx-auto bg-white dark:bg-zinc-900">
        <Suspense fallback={<div className="flex-1" />}>
        <OnboardingView
          initialUserId={config.userId || ''}
          initialRememberId={config.rememberId !== false}
          notice={loginNotice}
          onLogin={async (id, pw, geminiKey, options) => {
            // 1. LMS 서버에 먼저 실제 로그인을 시도하여 검증 (실패 시 에러 발생 -> OnboardingView 에러 표시)
            await LmsAuthService.login(id, pw, true);

            // 다른 계정으로 로그인하면 이전 계정의 화면 데이터·본 항목 기록을 비움
            const switchingUser = !!config.userId && config.userId !== id;
            if (switchingUser) {
              setState(EMPTY_STATE);
              stateRef.current = EMPTY_STATE;
              await saveAppState(EMPTY_STATE);
            }

            // 2. 검증 성공 시에만 config 저장 및 상태 반영
            const updated: UserConfig = applyReleasePolicy({
              ...config,
              userId: id,
              userPw: pw,
              geminiApiKey: geminiKey,
              rememberId: options?.rememberId ?? true,
              autoLogin: options?.autoLogin ?? true,
            });
            await saveConfig(updated);
            setConfig(updated);
            setLoginNotice(null);

            // 로그아웃 때 꺼 둔 백그라운드 동기화를 설정대로 다시 켬
            if (updated.pushNotificationsEnabled) await NotificationService.requestPermission();
            await configureBackgroundSync(isBackgroundSyncOn(updated), updated.syncIntervalMinutes ?? 30);
            await syncNotificationPrefs(updated);

            performSync(updated, switchingUser ? EMPTY_STATE : undefined).catch(e =>
              console.error('Initial sync error:', e)
            );
          }}
          isLoading={isSyncing}
        />
        </Suspense>
        <ExitHint bottomClass="bottom-6" />
      </div>
    );
  }

  const topSubpage = subpages[subpages.length - 1];

  const tabs: Array<{ id: MainTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: '홈', icon: Home },
    { id: 'lms', label: 'LMS', icon: BookOpen },
    { id: 'academics', label: '학사', icon: GraduationCap },
    { id: 'menu', label: '전체메뉴', icon: Menu },
  ];

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden relative">
      {/* 동기화 진행 표시 (상단 얇은 막대) */}
      {(isSyncing || isAcademicSyncing) && (
        <div className="absolute top-0 inset-x-0 h-0.5 z-40 overflow-hidden bg-hs-100 dark:bg-hs-950">
          <div className="h-full w-1/3 bg-hs-600 dark:bg-hs-400 animate-[syncbar_1.2s_ease-in-out_infinite]" />
        </div>
      )}

      {/* 토스트 */}
      {toastMessage && (
        <div className="toast-anim absolute top-3 inset-x-4 bg-hs-800 dark:bg-hs-500 text-white px-4 py-2.5 rounded-2xl shadow-xl z-50 flex items-center gap-2 text-xs font-semibold">
          <CheckCircle className="w-4 h-4 text-emerald-400 dark:text-emerald-300 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 메인 콘텐츠 (탭별로 내용이 곧 상단) */}
      <div ref={contentRef} className="flex-1 overflow-y-auto no-scrollbar p-4 pb-24">
        {/* 당겨서 새로고침 표시 */}
        {pullDistance > 0 && (
          <div className="flex flex-col items-center justify-end overflow-hidden" style={{ height: pullDistance }}>
            <RotateCw
              className={`w-5 h-5 mb-1 ${pullDistance >= PULL_TRIGGER_PX ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-400'}`}
              style={{ transform: `rotate(${pullDistance * 4}deg)` }}
            />
            <span className="text-[10px] font-semibold text-zinc-400 mb-2">
              {pullDistance >= PULL_TRIGGER_PX ? '놓으면 새로고침' : '당겨서 새로고침'}
            </span>
          </div>
        )}
        {updateInfo && activeTab === 'home' && (
          <div className="mb-3.5 p-3 bg-hs-50 dark:bg-hs-950/60 border border-hs-200 dark:border-hs-900 rounded-2xl flex items-center gap-2.5">
            <Download className="w-5 h-5 text-hs-700 dark:text-hs-300 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-hs-900 dark:text-hs-100">새 버전 {updateInfo.version}이 나왔어요</div>
              <div className="text-[11px] text-hs-800/80 dark:text-hs-300/80 mt-0.5">받은 APK를 설치하면 데이터는 그대로 유지돼요.</div>
            </div>
            <button
              onClick={() => openExternal(updateInfo.url)}
              className="px-2.5 py-1.5 bg-hs-700 dark:bg-hs-500 text-white text-[11px] font-bold rounded-xl whitespace-nowrap"
            >
              받기
            </button>
            <button
              onClick={() => {
                dismissUpdate(updateInfo.version);
                setUpdateInfo(null);
              }}
              className="p-1 text-hs-700/60 dark:text-hs-300/60"
              aria-label="업데이트 안내 닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {syncPaused && (activeTab === 'home' || activeTab === 'lms') && (
          <div className="mb-3.5 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl flex items-start gap-2.5">
            <MonitorSmartphone className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-amber-900 dark:text-amber-200">다른 곳에서 LMS 사용 중인 것 같아요</div>
              <div className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5 leading-snug">
                PC 쪽 로그인이 끊기지 않도록 자동 동기화를 멈췄어요. 다시 로그인하면 그쪽 LMS는 로그아웃돼요.
              </div>
            </div>
            <button
              onClick={() => {
                resumeSync();
                performSync(undefined, undefined, { forceLogin: true });
              }}
              disabled={isSyncing}
              className="self-center px-2.5 py-1.5 bg-amber-600 dark:bg-amber-500 text-white text-[11px] font-bold rounded-xl whitespace-nowrap disabled:opacity-50"
            >
              다시 로그인
            </button>
          </div>
        )}
        {activeTab === 'home' && (
          <HomeView
            state={state}
            cards={homeCards}
            displayName={profile.name || '한신인'}
            isSyncing={isSyncing}
            onSync={() => performSync()}
            readNoticeIds={readNoticeIdSet}
            onOpenAssignment={openAssignment}
            onOpenNotice={openNotice}
            onNavigate={navigate}
            onEditHome={() => openSubpage('homeEdit')}
          />
        )}

        {activeTab === 'lms' && (
          <LmsView
            state={state}
            subTab={lmsSubTab}
            onSubTabChange={sub => goTo({ lmsSub: sub })}
            query={lmsQuery}
            onQueryChange={setLmsQuery}
            isSyncing={isSyncing}
            onSync={() => performSync()}
            readNoticeIds={readNoticeIdSet}
            onOpenAssignment={openAssignment}
            onOpenNotice={openNotice}
            onMarkAllRead={() => markNoticesRead(state.notices.map(n => n.id))}
          />
        )}

        {activeTab === 'academics' && (
          <Suspense fallback={<div className="h-40 bg-zinc-200/60 dark:bg-zinc-800/60 rounded-2xl animate-pulse" />}>
          <AcademicView
            academicData={state.academicData}
            isLoading={isAcademicSyncing}
            onRefresh={handleSyncAcademic}
            section={academicSection}
            onSectionChange={sec => goTo({ academic: sec })}
            hideGrades={config.hideGrades}
          />
          </Suspense>
        )}

        {activeTab === 'menu' && (
          <MenuView profile={profile} onOpenSubpage={openSubpage} onNavigate={navigate} onLogout={handleLogout} />
        )}
      </div>

      {/* 하위 화면 (설정 · 홈 편집 · 앱 정보) */}
      {topSubpage && (
        <SubpageLayout title={SUBPAGE_TITLES[topSubpage]} onBack={closeTopSubpage}>
          <Suspense fallback={null}>
          {topSubpage === 'settings' && (
            <SettingsView
              config={config}
              onUpdate={updateConfig}
              onChangeAccount={changeAccount}
              onOpenHomeEdit={() => openSubpage('homeEdit')}
            />
          )}
          {topSubpage === 'homeEdit' && (
            <HomeEditView cards={homeCards} onChange={cards => updateConfig({ homeCards: cards })} />
          )}
          {topSubpage === 'appInfo' && <AppInfoView onOpenLicenses={() => openSubpage('licenses')} />}
          {topSubpage === 'licenses' && <LicensesView />}
          </Suspense>
        </SubpageLayout>
      )}

      {/* 상세 바텀시트 */}
      <DetailBottomSheet assignment={selectedAssignment} notice={selectedNotice} onClose={closeSheet} />

      {/* 하단 탭 */}
      <div className="absolute bottom-0 inset-x-0 h-16 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-t border-zinc-200/80 dark:border-zinc-800 flex items-center justify-around px-2 z-20">
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`relative flex flex-col items-center gap-1 flex-1 py-1 transition-colors ${
                active ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              {active && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-hs-700 dark:bg-hs-400" />}
              <t.icon className="w-5 h-5" />
              <span className={`text-[11px] ${active ? 'font-bold' : 'font-semibold'}`}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* 홈에서 첫 번째 뒤로가기 → "한 번 더 누르면 종료" (하단 탭 바로 위) */}
      <ExitHint />
    </div>
  );
};
