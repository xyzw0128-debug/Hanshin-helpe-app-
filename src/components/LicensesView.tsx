import React from 'react';

/** 앱에 포함된 오픈소스 (package.json 의존성과 안드로이드 라이브러리) */
const LIBRARIES: Array<{ name: string; license: 'MIT' | 'ISC' | 'Apache-2.0'; copyright: string }> = [
  { name: 'React, React DOM, scheduler', license: 'MIT', copyright: 'Copyright (c) Facebook, Inc. and its affiliates.' },
  { name: 'Capacitor (core, android)', license: 'MIT', copyright: 'Copyright (c) 2017-present Drifty Co.' },
  {
    name: '@capacitor/local-notifications, @capacitor/preferences',
    license: 'MIT',
    copyright: 'Copyright 2020-present Ionic',
  },
  { name: '@aparajita/capacitor-secure-storage', license: 'MIT', copyright: 'Copyright 2020-present Aparajita Fishman' },
  {
    name: 'Lucide (lucide-react)',
    license: 'ISC',
    copyright: 'Copyright (c) Lucide Contributors 2022, portions Cole Bemis 2013-2022 (Feather, MIT)',
  },
  { name: 'AndroidX (AppCompat, Core, Activity, WorkManager 등)', license: 'Apache-2.0', copyright: 'Copyright The Android Open Source Project' },
  { name: 'Material Icons (알림 아이콘)', license: 'Apache-2.0', copyright: 'Copyright Google LLC' },
  { name: 'Tailwind CSS (빌드 시 사용)', license: 'MIT', copyright: 'Copyright (c) Tailwind Labs, Inc.' },
];

const LICENSE_TEXT: Record<'MIT' | 'ISC' | 'Apache-2.0', string> = {
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'Apache-2.0': `Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.`,
};

export const LicensesView: React.FC = () => (
  <div className="space-y-3.5 pb-10">
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800">
      {LIBRARIES.map(lib => (
        <div key={lib.name} className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{lib.name}</span>
            <span className="text-[10px] font-bold text-hs-700 dark:text-hs-300 bg-hs-50 dark:bg-hs-950/60 px-1.5 py-0.5 rounded-md whitespace-nowrap">
              {lib.license}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{lib.copyright}</div>
        </div>
      ))}
    </div>
    {(['MIT', 'ISC', 'Apache-2.0'] as const).map(id => (
      <details key={id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-4 py-3">
        <summary className="text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer">{id} License 전문</summary>
        <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 whitespace-pre-line leading-relaxed mt-2">{LICENSE_TEXT[id]}</p>
      </details>
    ))}
  </div>
);
