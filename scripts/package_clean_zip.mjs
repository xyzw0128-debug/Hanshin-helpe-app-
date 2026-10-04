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
const excludePatterns = [
  '*/node_modules/*',
  '*/.gradle/*',
  '*/build/*',
  '*/dist/*',
  '*/tests/*',
  '*/.git/*',
  '*.apk',
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
