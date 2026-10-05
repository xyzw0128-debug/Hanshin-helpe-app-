import React, { useEffect, useState } from 'react';

/** MainActivity가 첫 번째 뒤로가기에서 보내는 이벤트. 2초 안에 한 번 더 누르면 앱이 닫힘 */
export const EXIT_HINT_EVENT = 'hsBackExitHint';
const EXIT_HINT_MS = 2000; // MainActivity.EXIT_CONFIRM_WINDOW_MS와 같은 값

/** 하단 탭 바로 위에 뜨는 "한 번 더 누르면 종료" 안내 */
export const ExitHint: React.FC<{ bottomClass?: string }> = ({ bottomClass = 'bottom-20' }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), EXIT_HINT_MS);
    };
    window.addEventListener(EXIT_HINT_EVENT, show);
    return () => {
      window.removeEventListener(EXIT_HINT_EVENT, show);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;
  return (
    <div className={`fixed inset-x-0 ${bottomClass} flex justify-center z-50 pointer-events-none px-4`}>
      <div className="toast-anim px-4 py-2 rounded-full bg-zinc-900/90 dark:bg-zinc-700/95 text-white text-xs font-semibold shadow-lg">
        뒤로 버튼을 한 번 더 누르면 종료돼요
      </div>
    </div>
  );
};
