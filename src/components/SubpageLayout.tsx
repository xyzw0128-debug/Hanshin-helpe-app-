import React from 'react';
import { ChevronLeft } from 'lucide-react';

interface SubpageLayoutProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

/**
 * 설정·홈 편집·앱 정보 같은 하위 화면 공통 레이아웃 (하단 탭을 덮는 전체 화면)
 * 안드로이드 뒤로가기는 App의 history 처리로 onBack과 동일하게 동작
 */
export const SubpageLayout: React.FC<SubpageLayoutProps> = ({ title, onBack, children }) => (
  <div className="absolute inset-0 z-30 flex flex-col bg-zinc-50 dark:bg-zinc-950">
    <div className="flex items-center gap-1 px-2 py-2.5 border-b border-zinc-200/80 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95">
      <button
        onClick={onBack}
        className="p-1.5 rounded-xl text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="뒤로"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <h1 className="text-sm font-black text-zinc-900 dark:text-white">{title}</h1>
    </div>
    <div className="flex-1 overflow-y-auto no-scrollbar p-4">{children}</div>
  </div>
);
