// Publishes built `data/v1/` directory to a clean single-commit orphan `gh-pages` branch
// so GitHub Pages serves `/smart-grocery/data/v1/*` without accumulating daily history bloat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dataDir = path.resolve(process.argv[2] || 'data/v1');
if (!fs.existsSync(path.join(dataDir, 'meta.json'))) {
  console.error(`Missing ${path.join(dataDir, 'meta.json')} – run pipeline/build.mjs first.`);
  process.exit(1);
}

const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-pages-'));

try {
  const destV1 = path.join(tmpDir, 'data', 'v1');
  fs.mkdirSync(path.dirname(destV1), { recursive: true });
  fs.cpSync(dataDir, destV1, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.nojekyll'), '');

  const runGit = (args) => execFileSync('git', args, { cwd: tmpDir, stdio: 'inherit' });
  runGit(['init', '-b', 'gh-pages']);
  runGit(['config', 'user.name', process.env.GIT_AUTHOR_NAME || 'SmartCart Bot']);
  runGit(['config', 'user.email', process.env.GIT_AUTHOR_EMAIL || 'actions@users.noreply.github.com']);
  runGit(['add', '-A']);
  runGit(['commit', '-q', '-m', `Publish Price Transparency data (${new Date().toISOString()})`]);
  runGit(['push', '--force', remoteUrl, 'gh-pages:gh-pages']);
  console.log('Published data/v1 to origin/gh-pages successfully.');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
