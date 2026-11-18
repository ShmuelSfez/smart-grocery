// Regenerates gemini/skills/code-infra/references/file-inventory.md from the live repo.
// Run from repo root: node gemini/skills/code-infra/scripts/update-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT = path.join(ROOT, 'gemini', 'skills', 'code-infra', 'references', 'file-inventory.md');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.vercel', 'exports']);
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.webmanifest']);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(ent.name)) continue;
    if (dir === ROOT && ent.name === 'data') continue; // generated /data/v1/ is gitignored
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function extractExports(content) {
  const names = [];
  for (const m of content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.push(m[1]);
  }
  if (/export\s+default\s+/.test(content)) names.push('default');
  return names;
}

const files = walk(ROOT).sort();
const rows = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel === 'gemini/skills/code-infra/references/file-inventory.md') continue;
  const ext = path.extname(f);
  if (TEXT_EXT.has(ext)) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split(/\r?\n/).length;
    const exps = ext === '.js' || ext === '.mjs' ? extractExports(text) : [];
    rows.push(`| \`${rel}\` | ${lines} | ${exps.length ? exps.map((e) => `\`${e}\``).join(', ') : '—'} |`);
  } else {
    const size = fs.statSync(f).size;
    rows.push(`| \`${rel}\` | binary (${size} B) | — |`);
  }
}

let testSummary = 'not run';
try {
  const out = execSync('node --test tests/', { cwd: ROOT, encoding: 'utf8' });
  const pass = out.match(/# pass (\d+)/)?.[1] || '?';
  const fail = out.match(/# fail (\d+)/)?.[1] || '?';
  testSummary = `${pass} pass, ${fail} fail`;
} catch (err) {
  testSummary = 'FAILED';
}

let lastCommit = 'none';
try {
  lastCommit = execSync('git log -1 --format="%h %cs %s"', { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {}

const body = `- **Latest Commit:** \`${lastCommit}\`
- **Unit Tests (\`npm test\`):** ${testSummary}

| File | Lines / Size | Exports |
| :--- | :--- | :--- |
${rows.join('\n')}
`;

const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
const stripHeader = (s) => s.replace(/^#[^\n]*\n\n- \*\*Updated:\*\* [^\n]*\n/, '');
if (stripHeader(prev) === body) {
  console.log(`No changes in ${path.relative(ROOT, OUT)} (tests: ${testSummary})`);
  process.exit(0);
}

const md = `# Codebase File Inventory (Auto-Generated)

- **Updated:** ${new Date().toISOString()}
${body}`;

fs.writeFileSync(OUT, md, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)} (${rows.length} files, tests: ${testSummary})`);
