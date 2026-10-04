import React from 'react';
import { RotateCw, Sun, Moon } from 'lucide-react';

interface HeaderProps {
  lastSyncTime: string | null;
  isSyncing: boolean;
  onSync: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  lastSyncTime,
  isSyncing,
  onSync,
  isDarkMode,
  onToggleTheme,
}) => {
  const now = new Date();
  const year = now.getFullYear();
  const semester = now.getMonth() >= 7 ? 2 : 1;
  const semesterLabel = `${year}-${semester}학기`;

  return (
    <div className="px-5 py-3.5 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-hs-100 dark:border-hs-900/60 flex items-center justify-between z-10 transition-colors duration-200">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-black text-zinc-900 dark:text-white tracking-tight">한신대 LMS</h2>
          <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-hs-100 dark:bg-hs-900 text-hs-700 dark:text-hs-200">
            {semesterLabel}
          </span>
        </div>
        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          {lastSyncTime ? `${lastSyncTime} 동기화됨` : '동기화 필요'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggleTheme}
          title="테마 전환"
          className="w-11 h-11 rounded-full bg-hs-50 dark:bg-zinc-800 hover:bg-hs-100 dark:hover:bg-zinc-700 active:scale-95 text-zinc-700 dark:text-zinc-200 flex items-center justify-center transition-all shadow-sm"
        >
          {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-zinc-600" />}
        </button>

        <button
          onClick={onSync}
          disabled={isSyncing}
          title="새로고침"
          className="w-11 h-11 rounded-full bg-hs-50 dark:bg-zinc-800 hover:bg-hs-100 dark:hover:bg-zinc-700 active:scale-95 text-zinc-700 dark:text-zinc-200 flex items-center justify-center transition-all shadow-sm disabled:opacity-50"
        >
          <RotateCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-zinc-900 dark:text-white' : ''}`} />
        </button>
      </div>
    </div>
  );
};
