import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Home, BookOpen, GraduationCap, Menu, CheckCircle } from 'lucide-react';
import { UserConfig, AppStateData, AssignmentItem, NoticeItem, StudentProfile, HomeCardSetting } from './types';
import { loadConfig, saveConfig, clearSecureStorage, loadAppState, saveAppState } from './services/storage';
import { LmsAuthService } from './services/lmsAuth';
import { HsctisAuthService } from './services/hsctisAuth';
import { HsctisScraperService } from './services/hsctisScraper';
import { NotificationService } from './services/notifications';
import { useLmsSync, syncDeadlineReminders } from './hooks/useLmsSync';
import { configureBackgroundSync, restoreLmsSession, clearLmsSession } from './services/backgroundSync';
import { initDebugLog, debugLog } from './services/debugLog';
import { normalizeHomeCards } from './utils/homeCards';

import { DetailBottomSheet } from './components/DetailBottomSheet';
import { OnboardingView } from './components/OnboardingView';
import { AcademicView, AcademicSection } from './components/AcademicView';
import { HomeView, HomeNavigateTarget } from './components/HomeView';
import { LmsView, LmsSubTab } from './components/LmsView';
import { MenuView, MenuSubpage } from './components/MenuView';
import { SubpageLayout } from './components/SubpageLayout';
import { SettingsView } from './components/SettingsView';
import { HomeEditView } from './components/HomeEditView';
import { AppInfoView } from './components/AppInfoView';

export type MainTab = 'home' | 'lms' | 'academics' | 'menu';

const SUBPAGE_TITLES: Record<MenuSubpage, string> = {
  settings: '설정',
  homeEdit: '홈 화면 편집',
  appInfo: '앱 정보',
};

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
  const [state, setState] = useState<AppStateData>(EMPTY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const { isSyncing, performSync } = useLmsSync(config, state, setState, setConfig, setActiveTab, showToast);

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

  // ---------- 하위 화면 · 바텀시트와 안드로이드 뒤로가기 ----------
  // 열 때 history에 항목을 쌓고, 뒤로가기(popstate)에서 가장 위의 화면부터 닫는다.
  // 네이티브(MainActivity)는 WebView에 돌아갈 history가 있으면 앱을 끄지 않고 goBack 한다.
  const overlayRef = useRef({ sheetOpen: false, subpageCount: 0 });
  overlayRef.current = { sheetOpen: !!(selectedAssignment || selectedNotice), subpageCount: subpages.length };

  useEffect(() => {
    const onPopState = () => {
      if (overlayRef.current.sheetOpen) {
        setSelectedAssignment(null);
        setSelectedNotice(null);
      } else if (overlayRef.current.subpageCount > 0) {
        setSubpages(prev => prev.slice(0, -1));
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openSubpage = (page: MenuSubpage) => {
    window.history.pushState({ overlay: 'subpage', page }, '');
    setSubpages(prev => [...prev, page]);
  };
  const closeTopOverlay = () => window.history.back();

  const openAssignment = (a: AssignmentItem) => {
    window.history.pushState({ overlay: 'sheet' }, '');
    setSelectedAssignment(a);
  };

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
    window.history.pushState({ overlay: 'sheet' }, '');
    setSelectedNotice(notice);
    markNoticesRead([notice.id]);
  };

  // ---------- 초기화 ----------
  useEffect(() => {
    async function init() {
      await initDebugLog();
      // 설정과 상태를 병렬 로드 (네이티브 브리지 오버헤드 단축)
      const [cfg, st] = await Promise.all([loadConfig(), loadAppState()]);
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

      if (cfg.pushNotificationsEnabled) {
        await NotificationService.requestPermission();
      }

      // Android WorkManager 백그라운드 동기화 스케줄링 설정
      await configureBackgroundSync(isBackgroundSyncOn(cfg), cfg.syncIntervalMinutes ?? 30);

      // 포그라운드 진입 시: 계정 정보가 있는 경우 세션 유효성 확인 및 무자각 자동 재인증
      if (cfg.userId && cfg.userPw) {
        // Capacitor가 앱 시작 시 지운 LMS 세션 쿠키를 복원 → 세션이 살아 있으면 SSO 재로그인 생략(PC 세션 보호)
        const restored = await restoreLmsSession();
        const isValid = await LmsAuthService.isSessionValid();
        debugLog('app', '시작 시 세션 확인', { restoredCookie: restored, sessionValid: isValid });
        if (!isValid) {
          try {
            await LmsAuthService.login(cfg.userId, cfg.userPw, true);
            performSync(cfg, st, { silent: true });
          } catch (reauthErr) {
            console.warn('Foreground silent re-auth skipped or failed', reauthErr);
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
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [config?.userId, config?.userPw, performSync]);

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
      if (!LmsAuthService.getUserNo()) {
        try {
          await LmsAuthService.login(config.userId, config.userPw);
        } catch (lmsErr) {
          console.warn('LMS login fallback in handleSyncAcademic', lmsErr);
        }
      }
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
      if (changed('ddayReminderEnabled') || changed('threeHourReminderEnabled') || changed('pushNotificationsEnabled')) {
        syncDeadlineReminders(stateRef.current.assignments, next).catch(e => console.warn('Reminder sync failed', e));
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
    const emptyCfg: UserConfig = { ...config, userId: '', userPw: '' };
    setConfig(emptyCfg);
    await saveConfig(emptyCfg);
    await clearSecureStorage();
    await configureBackgroundSync(false, 30);
    await clearLmsSession();

    setState(EMPTY_STATE);
    await saveAppState(EMPTY_STATE);

    setActiveTab('home');
    setSubpages([]);

    await LmsAuthService.logout();
    await HsctisAuthService.logout();
    showToast('로그아웃되었습니다.');
  };

  // ---------- 탭 이동 ----------
  const navigate = (target: HomeNavigateTarget) => {
    if (target.tab === 'lms') setLmsSubTab(target.sub);
    if (target.tab === 'academics' && target.sub) setAcademicSection(target.sub);
    setActiveTab(target.tab);
  };

  const homeCards: HomeCardSetting[] = useMemo(() => normalizeHomeCards(config?.homeCards), [config?.homeCards]);

  const profile: StudentProfile = {
    name: state.profile?.name || LmsAuthService.getUserName() || state.academicData?.gradeSummary?.student?.name || '',
    studentNo: state.profile?.studentNo || LmsAuthService.getUserNo() || config?.userId || '',
    dept: state.profile?.dept || LmsAuthService.getDeptName() || state.academicData?.gradeSummary?.student?.major || '',
    gradeYear: state.academicData?.gradeSummary?.student?.gradeYear,
  };

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
        <OnboardingView
          initialUserId={config.userId || ''}
          initialRememberId={config.rememberId !== false}
          onLogin={async (id, pw, geminiKey, options) => {
            // 1. LMS 서버에 먼저 실제 로그인을 시도하여 검증 (실패 시 에러 발생 -> OnboardingView 에러 표시)
            await LmsAuthService.login(id, pw, true);

            // 2. 검증 성공 시에만 config 저장 및 상태 반영
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
            setActiveTab('home');

            performSync(updated).catch(e => console.error('Initial sync error:', e));
          }}
          isLoading={isSyncing}
        />
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
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 pb-24">
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
            onSubTabChange={setLmsSubTab}
            isSyncing={isSyncing}
            onSync={() => performSync()}
            readNoticeIds={readNoticeIdSet}
            onOpenAssignment={openAssignment}
            onOpenNotice={openNotice}
            onMarkAllRead={() => markNoticesRead(state.notices.map(n => n.id))}
          />
        )}

        {activeTab === 'academics' && (
          <AcademicView
            academicData={state.academicData}
            isLoading={isAcademicSyncing}
            onRefresh={handleSyncAcademic}
            section={academicSection}
            onSectionChange={setAcademicSection}
            hideGrades={config.hideGrades}
          />
        )}

        {activeTab === 'menu' && (
          <MenuView profile={profile} onOpenSubpage={openSubpage} onNavigate={navigate} onLogout={handleLogout} />
        )}
      </div>

      {/* 하위 화면 (설정 · 홈 편집 · 앱 정보) */}
      {topSubpage && (
        <SubpageLayout title={SUBPAGE_TITLES[topSubpage]} onBack={closeTopOverlay}>
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
          {topSubpage === 'appInfo' && <AppInfoView />}
        </SubpageLayout>
      )}

      {/* 상세 바텀시트 */}
      <DetailBottomSheet assignment={selectedAssignment} notice={selectedNotice} onClose={closeTopOverlay} />

      {/* 하단 탭 */}
      <div className="absolute bottom-0 inset-x-0 h-16 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-t border-zinc-200/80 dark:border-zinc-800 flex items-center justify-around px-2 z-20">
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
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
    </div>
  );
};
