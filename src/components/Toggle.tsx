import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string; // 접근성용 이름
  disabled?: boolean;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-10 h-6 flex-shrink-0 rounded-full transition-colors disabled:opacity-40 ${
      checked ? 'bg-hs-700 dark:bg-hs-500' : 'bg-zinc-300 dark:bg-zinc-700'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-4' : ''
      }`}
    />
  </button>
);
