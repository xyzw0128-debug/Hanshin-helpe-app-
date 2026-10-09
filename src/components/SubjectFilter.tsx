import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useBackHandler } from '../services/backNav';

interface SubjectFilterProps {
  subjects: string[];
  selectedSubject: string;
  onSelectSubject: (sub: string) => void;
}

/**
 * 과목별 필터: "선택: 전체 ⌄"를 누르면 과목 목록이 작은 창으로 열림.
 * 듣는 과목이 많아도 창이 화면을 덮지 않게 높이를 제한하고 창 안에서 스크롤한다.
 * 바깥을 누르거나 안드로이드 뒤로가기로 닫힘
 */
const SubjectFilterInner: React.FC<SubjectFilterProps> = ({ subjects, selectedSubject, onSelectSubject }) => {
  const [open, setOpen] = useState(false);
  useBackHandler(open, () => setOpen(false));
  const filtered = selectedSubject !== '전체';

  const choose = (sub: string) => {
    onSelectSubject(sub);
    setOpen(false);
  };

  return (
    <div className="relative flex items-center justify-between gap-2 px-1">
      <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 whitespace-nowrap">과목별 필터</span>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-0.5 min-w-0 pl-2.5 pr-1.5 py-1 rounded-full border text-xs transition-colors ${
          filtered
            ? 'bg-hs-50 dark:bg-hs-950/60 border-hs-200 dark:border-hs-800 text-hs-700 dark:text-hs-300'
            : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300'
        }`}
      >
        <span className="truncate">
          선택: <b>{selectedSubject}</b>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        // 창 안에서 목록을 위로 끌어도 당겨서 새로고침이 되지 않게 (hooks/usePullToRefresh.ts)
        <div data-no-pull-refresh className="contents">
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="과목 선택"
            className="absolute right-0 top-full mt-1.5 z-30 w-56 max-h-[min(50vh,18rem)] overflow-y-auto overscroll-contain py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-lg"
          >
            {subjects.map(sub => {
              const on = sub === selectedSubject;
              return (
                <button
                  key={sub}
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(sub)}
                  className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-left text-xs leading-snug ${
                    on
                      ? 'font-bold text-hs-700 dark:text-hs-300 bg-hs-50/70 dark:bg-hs-950/40'
                      : 'font-semibold text-zinc-700 dark:text-zinc-200 active:bg-zinc-100 dark:active:bg-zinc-800'
                  }`}
                >
                  <span className="flex-1 break-keep">{sub}</span>
                  {on && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const SubjectFilter = React.memo(SubjectFilterInner);
