import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const parentDir = path.resolve(rootDir, '..');
const folderName = path.basename(rootDir);
const targetZip = path.resolve(parentDir, 'lms-notifier-app.zip');

console.log(`Packaging clean release archive: ${targetZip} from folder: ${folderName}`);

// Completely exclude build artifacts, debug binaries, node_modules, and cache files
// 서명 키(키스토어)·개인 설정·다른 작업 사본(.worktrees)도 넣지 않음: zip을 남에게 주면 앱 서명 키가 함께 나감
const excludePatterns = [
  '*/node_modules/*',
  '*/.gradle/*',
  '*/build/*',
  '*/dist/*',
  '*/tests/*',
  '*/.git/*',
  '*/.worktrees/*',
  '*.apk',
  '*.aab',
  '*.keystore',
  '*.jks',
  '*keystore.properties',
  '*/local.properties',
  '*/.claude/settings.local.json',
  '*.log',
  '*.env*',
  '*~'
];

const excludeArgs = excludePatterns.map(p => `-x "${p}"`).join(' ');

try {
  if (fs.existsSync(targetZip)) {
    fs.unlinkSync(targetZip);
    console.log('Removed existing archive.');
  }

  const cmd = `cd "${parentDir}" && zip -r "${targetZip}" "${folderName}" ${excludeArgs}`;
  execSync(cmd, { stdio: 'inherit' });

  const stats = fs.statSync(targetZip);
  console.log(`Successfully created clean release zip: ${targetZip} (${(stats.size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error('Failed to create clean zip archive:', err);
  process.exit(1);
}
