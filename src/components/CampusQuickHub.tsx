import React, { useState, useCallback } from 'react';
import { MapPin, Edit3, Library, ExternalLink, Loader2 } from 'lucide-react';
import { launchCampusApp } from '../utils/campusLauncher';

const CampusQuickHubInner: React.FC = () => {
  const [launchingApp, setLaunchingApp] = useState<string | null>(null);

  const handleLaunch = useCallback(async (appKey: 'attendance' | 'sugang' | 'library') => {
    if (launchingApp) return;
    setLaunchingApp(appKey);
    try {
      await launchCampusApp(appKey);
    } catch (e) {
      console.warn('Campus app launch failed', e);
    } finally {
      // 약간의 딜레이 후 해제 (네이티브 전환 시 깜빡임 방지)
      setTimeout(() => setLaunchingApp(null), 500);
    }
  }, [launchingApp]);

  const isDisabled = (appKey: string) => launchingApp !== null && launchingApp !== appKey;
  const isLoading = (appKey: string) => launchingApp === appKey;

  return (
    <div className="bg-gradient-to-br from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-900/90 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-3.5 shadow-sm space-y-2.5">
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-xs font-black tracking-wide text-zinc-900 dark:text-zinc-100">
            캠퍼스 퀵허브
          </h2>
          <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
            원터치 앱 런처
          </span>
        </div>
        <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 flex items-center gap-0.5">
          미설치 시 스토어 이동 <ExternalLink className="w-2.5 h-2.5" />
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* 1. 대면 전자출결 실행 */}
        <button
          onClick={() => handleLaunch('attendance')}
          disabled={isDisabled('attendance')}
          className="flex flex-col items-center justify-center p-2.5 bg-emerald-50/70 hover:bg-emerald-100/80 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 border border-emerald-200/80 dark:border-emerald-800/50 rounded-xl transition-all active:scale-95 text-center group disabled:opacity-40"
          title="한신대 전자출결 앱 실행"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-sm mb-1.5 group-hover:scale-105 transition-transform">
            {isLoading('attendance') ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
          </div>
          <span className="text-xs font-black text-emerald-900 dark:text-emerald-200 leading-tight">
            대면 전자출결
          </span>
          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">
            현장 출석체크
          </span>
        </button>

        {/* 2. 수강신청 */}
        <button
          onClick={() => handleLaunch('sugang')}
          disabled={isDisabled('sugang')}
          className="flex flex-col items-center justify-center p-2.5 bg-blue-50/70 hover:bg-blue-100/80 dark:bg-blue-950/30 dark:hover:bg-blue-900/40 border border-blue-200/80 dark:border-blue-800/50 rounded-xl transition-all active:scale-95 text-center group disabled:opacity-40"
          title="수강신청 공식 앱 실행"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm mb-1.5 group-hover:scale-105 transition-transform">
            {isLoading('sugang') ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
          </div>
          <span className="text-xs font-black text-blue-900 dark:text-blue-200 leading-tight">
            수강신청
          </span>
          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mt-0.5">
            학사일정/희망
          </span>
        </button>

        {/* 3. 한신대 도서관 회원증 */}
        <button
          onClick={() => handleLaunch('library')}
          disabled={isDisabled('library')}
          className="flex flex-col items-center justify-center p-2.5 bg-purple-50/70 hover:bg-purple-100/80 dark:bg-purple-950/30 dark:hover:bg-purple-900/40 border border-purple-200/80 dark:border-purple-800/50 rounded-xl transition-all active:scale-95 text-center group disabled:opacity-40"
          title="한신대 도서관 회원증 실행"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center shadow-sm mb-1.5 group-hover:scale-105 transition-transform">
            {isLoading('library') ? <Loader2 className="w-4 h-4 animate-spin" /> : <Library className="w-4 h-4" />}
          </div>
          <span className="text-xs font-black text-purple-900 dark:text-purple-200 leading-tight">
            도서관 회원증
          </span>
          <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400 mt-0.5">
            모바일 이용증
          </span>
        </button>
      </div>
    </div>
  );
};

export const CampusQuickHub = React.memo(CampusQuickHubInner);
