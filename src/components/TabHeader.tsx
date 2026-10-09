import React from 'react';

/**
 * 탭 상단 바의 구성 요소. 상단 바는 App이 본문 스크롤 영역 밖에 그려서
 * 목록을 내려도 제목·버튼·하위 탭이 화면 위에 남는다.
 */

/** 제목 줄: 제목 · 보조 설명 · 오른쪽 버튼 */
export const HeaderTitleRow: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, subtitle, children }) => (
  <div className="flex items-center gap-2 min-h-[60px] py-2">
    <div className="flex-1 min-w-0">
      <h1 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight truncate">{title}</h1>
      {subtitle && (
        <p className="text-[11px] leading-4 font-semibold text-zinc-500 dark:text-zinc-400 truncate">{subtitle}</p>
      )}
    </div>
    {children && <div className="flex items-center -mr-1.5">{children}</div>}
  </div>
);

export const HeaderIconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, active, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className={`p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60 ${
      active ? 'text-hs-700 dark:text-hs-300' : 'text-zinc-500 dark:text-zinc-400'
    }`}
  >
    {children}
  </button>
);

export interface HeaderTab<T extends string> {
  id: T;
  label: string;
  /** 진행 중·안 읽은 항목 수 (0이면 숨김) */
  badge?: number;
}

/** 상단 바 아래 끝에 붙는 하위 탭 (선택한 탭에 밑줄) */
export function HeaderTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: HeaderTab<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex -mx-2">
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`relative flex-1 flex items-center justify-center gap-1 pt-1.5 pb-2.5 text-xs whitespace-nowrap transition-colors ${
              on ? 'font-black text-hs-700 dark:text-hs-300' : 'font-bold text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {t.label}
            {!!t.badge && (
              <span className="min-w-[16px] px-1 rounded-full bg-hs-700 dark:bg-hs-500 text-white text-[9px] font-black leading-[15px] text-center">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
            {on && <span className="absolute bottom-0 inset-x-3 h-[3px] rounded-t-full bg-hs-700 dark:bg-hs-400" />}
          </button>
        );
      })}
    </div>
  );
}
