import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface OnboardingViewProps {
  onLogin: (userId: string, userPw: string, geminiKey: string, options?: { rememberId: boolean; autoLogin: boolean }) => Promise<void>;
  isLoading: boolean;
  initialUserId?: string;
  initialRememberId?: boolean;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({ onLogin, isLoading, initialUserId = '', initialRememberId = true }) => {
  const [userId, setUserId] = useState(initialUserId);
  const [userPw, setUserPw] = useState('');
  const [rememberId, setRememberId] = useState(initialRememberId);
  const [autoLogin, setAutoLogin] = useState(true);
  const [geminiKey, setGeminiKey] = useState('');
  const [showGeminiField, setShowGeminiField] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBusy = isLoading || isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedId = userId.trim();
    const trimmedPw = userPw.trim();

    if (!trimmedId || !trimmedPw) {
      setErrorMessage('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);
      // 자동 로그인은 저장된 아이디가 있어야 동작하므로 아이디 저장을 함께 적용
      await onLogin(trimmedId, userPw, geminiKey.trim(), { rememberId: rememberId || autoLogin, autoLogin });
    } catch (err: any) {
      setErrorMessage(
        err?.message || '아이디 또는 비밀번호가 올바르지 않습니다. 다시 확인해주세요.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar p-6 flex flex-col justify-center space-y-6 bg-white dark:bg-zinc-900 transition-colors duration-200">
      <div className="text-center space-y-2">
        <div className="w-14 h-14 rounded-2xl bg-hs-700 dark:bg-hs-500 text-white flex items-center justify-center text-2xl font-black mx-auto shadow-lg">
          H
        </div>
        <h2 className="text-xl font-black text-zinc-900 dark:text-white pt-2">한신대 스마트 LMS</h2>
        <p className="text-xs text-zinc-500 leading-relaxed">
          포털 아이디로 로그인하시면<br />
          과제 마감 알림과 AI 공지 요약을 제공합니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3 bg-zinc-50 dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <div>
            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block mb-1">아이디 (ID)</label>
            <input
              type="text"
              placeholder="포털 아이디를 입력하세요"
              value={userId}
              onChange={e => {
                setUserId(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              disabled={isBusy}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block mb-1">비밀번호 (PW)</label>
            <div className="relative flex items-center">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="비밀번호를 입력하세요"
                value={userPw}
                onChange={e => {
                  setUserPw(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={isBusy}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-3 pr-9 py-2.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 로그인 옵션 분리: 아이디 저장 & 자동 로그인 유지 */}
          <div className="flex items-center justify-between pt-1 px-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberId || autoLogin}
                onChange={e => setRememberId(e.target.checked)}
                disabled={isBusy || autoLogin}
                title={autoLogin ? '자동 로그인 사용 시 아이디는 항상 저장됩니다' : undefined}
                className="w-3.5 h-3.5 rounded text-hs-700 dark:text-hs-500 focus:ring-hs-500 border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800"
              />
              <span className="font-semibold text-[11px]">아이디 저장</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoLogin}
                onChange={e => setAutoLogin(e.target.checked)}
                disabled={isBusy}
                className="w-3.5 h-3.5 rounded text-hs-700 dark:text-hs-500 focus:ring-hs-500 border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800"
              />
              <span className="font-semibold text-[11px]">자동 로그인 유지</span>
            </label>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowGeminiField(!showGeminiField)}
              className="text-xs text-hs-700 dark:text-hs-300 underline"
            >
              {showGeminiField ? '▲ Gemini API 키 입력 닫기' : '▼ Gemini API 키 입력 (선택: AI 3줄 요약용)'}
            </button>
            {showGeminiField && (
              <div className="mt-2">
                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    placeholder="AI Studio API 키 입력 (비워두면 기본 요약 사용)"
                    value={geminiKey}
                    onChange={e => setGeminiKey(e.target.value)}
                    disabled={isBusy}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-3 pr-9 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-zinc-400 mt-1.5 leading-normal">
                  ※ AI 요약 시 공지사항 제목 및 본문만 Google Gemini 서버로 전달되며, 학번이나 비밀번호 등 개인 식별 정보는 절대 전송되지 않습니다.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 로그인 실패 에러 메시지 표시 */}
        {errorMessage && (
          <div className="flex items-start space-x-2.5 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-red-600 dark:text-red-400 text-xs transition-all">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium leading-relaxed">{errorMessage}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isBusy}
          className="w-full py-3.5 bg-hs-700 hover:bg-hs-800 dark:bg-hs-500 text-white font-bold text-xs rounded-xl shadow-lg active:scale-98 transition-all disabled:opacity-50 flex items-center justify-center space-x-2"
        >
          {isBusy ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white dark:text-zinc-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>로그인 확인 중...</span>
            </>
          ) : (
            <span>로그인 및 시작하기</span>
          )}
        </button>

        <p className="text-xs text-center text-zinc-400">
          * 입력하신 계정 정보는 외부 서버에 전송되지 않으며 기기 내부에만 안전하게 암호화 보관됩니다.
        </p>
      </form>
    </div>
  );
};
