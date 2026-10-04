import React from 'react';

interface SubjectChipsProps {
  subjects: string[];
  selectedSubject: string;
  onSelectSubject: (sub: string) => void;
}

const SubjectChipsInner: React.FC<SubjectChipsProps> = ({
  subjects,
  selectedSubject,
  onSelectSubject,
}) => {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">과목별 필터</span>
        <span className="text-xs text-zinc-400">
          선택: <b>{selectedSubject}</b>
        </span>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
        {subjects.map(sub => {
          const isSelected = sub === selectedSubject;
          return (
            <button
              key={sub}
              onClick={() => onSelectSubject(sub)}
              className={
                isSelected
                  ? 'px-3 py-1 rounded-full text-xs font-bold bg-hs-700 dark:bg-hs-500 text-white whitespace-nowrap shadow-sm transition-all transform scale-105'
                  : 'px-3 py-1 rounded-full text-xs font-semibold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 whitespace-nowrap transition-all'
              }
            >
              {sub}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const SubjectChips = React.memo(SubjectChipsInner);
