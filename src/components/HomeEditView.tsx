import React from 'react';
import { ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { HomeCardSetting } from '../types';
import { HOME_CARD_META, DEFAULT_HOME_CARDS } from '../utils/homeCards';
import { Toggle } from './Toggle';

interface HomeEditViewProps {
  cards: HomeCardSetting[];
  onChange: (cards: HomeCardSetting[]) => void;
}

export const HomeEditView: React.FC<HomeEditViewProps> = ({ cards, onChange }) => {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= cards.length) return;
    const next = [...cards];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggle = (index: number) => {
    onChange(cards.map((c, i) => (i === index ? { ...c, enabled: !c.enabled } : c)));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 px-1">
        홈에 보일 카드를 켜고 끄거나, 화살표로 순서를 바꿀 수 있습니다. 변경 내용은 바로 저장됩니다.
      </p>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800">
        {cards.map((card, index) => {
          const meta = HOME_CARD_META[card.id];
          return (
            <div key={card.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex flex-col">
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-25"
                  aria-label={`${meta.label} 위로`}
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === cards.length - 1}
                  className="p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-25"
                  aria-label={`${meta.label} 아래로`}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold ${card.enabled ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'}`}>
                  {meta.label}
                </div>
                <div className="text-[11px] text-zinc-400 truncate">{meta.description}</div>
              </div>
              <Toggle checked={card.enabled} onChange={() => toggle(index)} label={`${meta.label} 표시`} />
            </div>
          );
        })}
      </div>
      <button
        onClick={() => onChange(DEFAULT_HOME_CARDS.map(c => ({ ...c })))}
        className="w-full py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        기본 구성으로 되돌리기
      </button>
    </div>
  );
};
