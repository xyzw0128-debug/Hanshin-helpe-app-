import React from 'react';
import { LectureItem } from '../types';
import { Check } from 'lucide-react';

interface LectureCardProps {
  item: LectureItem;
}

const LectureCardInner: React.FC<LectureCardProps> = ({ item }) => {
  return (
    <div
      className={`bg-white dark:bg-zinc-900 border ${
        !item.isAttended ? 'border-2 border-amber-500/30' : 'border-zinc-200 dark:border-zinc-800'
      } p-4 rounded-2xl shadow-sm space-y-2.5`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`px-2 py-0.5 text-xs font-bold rounded-md ${
            !item.isAttended
              ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'
              : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {item.periodStr || '출석 기간'}
        </span>
        <span
          className={`text-xs font-bold ${
            !item.isAttended ? 'text-red-600' : 'text-emerald-600 flex items-center gap-1'
          }`}
        >
          {item.isAttended ? (
            <>
              <Check className="w-3.5 h-3.5" /> 출석 인정됨
            </>
          ) : (
            '미수강'
          )}
        </span>
      </div>

      <div>
        <span className="text-xs text-hs-700 dark:text-hs-300 font-semibold">{item.courseNm}</span>
        <h4 className="text-sm font-bold text-zinc-900 dark:text-white mt-0.5">{item.title}</h4>
      </div>

      <div className="space-y-1.5 pt-1">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>
            학습 진도: <b>{item.timeStr || (item.isAttended ? '100%' : '0%')}</b>
          </span>
          <span className={`font-bold ${!item.isAttended ? 'text-red-600' : 'text-emerald-600'}`}>
            {item.progressPercent}%
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${!item.isAttended ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full`}
            style={{ width: `${item.progressPercent}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export const LectureCard = React.memo(LectureCardInner);
