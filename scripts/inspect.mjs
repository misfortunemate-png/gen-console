#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let green = 0, red = 0;
function ok(msg) { console.log(`  ✔ ${msg}`); green++; }
function ng(msg) { console.error(`  ✘ ${msg}`); red++; }

console.log('\n[1] マニフェスト照合');
for (const f of ['docs/spec-v1.1.md']) {
  if (existsSync(resolve(ROOT, f))) ok(f);
  else ng(`${f} が存在しない`);
}

console.log('\n[2] _STATUS.md 行数');
const statusPath = resolve(ROOT, '_STATUS.md');
if (existsSync(statusPath)) {
  const lines = readFileSync(statusPath, 'utf-8').trimEnd().split('\n').length;
  if (lines <= 30) ok(`${lines} 行 ≤30`);
  else ng(`${lines} 行 > 30（要圧縮）`);
} else {
  ng('_STATUS.md が存在しない');
}

console.log('\n[3] 版確認 R-012');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
ok(`package.json version = ${pkg.version}`);
try {
  const r = await fetch('http://127.0.0.1:3000/healthz');
  if (r.ok) {
    const d = await r.json();
    if (d.version === pkg.version) ok(`/healthz version = ${d.version} 一致`);
    else ng(`/healthz version=${d.version} ≠ package.json ${pkg.version}`);
  } else {
    ng(`/healthz HTTP ${r.status}`);
  }
} catch {
  console.log('  ⚠ サーバー未起動 → /healthz スキップ');
}

console.log('\n[4] ui build 警告なし');
try {
  const out = execSync('npm run build 2>&1', {
    cwd: resolve(ROOT, 'ui'),
    encoding: 'utf-8',
    timeout: 120000,
  });
  const warns = out.split('\n').filter(l => /\bwarn\b/i.test(l) && l.trim().length > 0);
  if (warns.length === 0) ok('ビルド成功・警告なし');
  else {
    ng(`警告 ${warns.length} 件`);
    warns.forEach(w => console.error(`    ${w.trim()}`));
  }
} catch (e) {
  ng(`ビルド失敗: ${e.message.split('\n')[0]}`);
}

console.log(`\n${'─'.repeat(40)}`);
if (red === 0) console.log(`✅ ALL GREEN (${green} 項目)`);
else console.log(`❌ ${red} 項目 NG / ${green} 項目 OK`);
process.exit(red > 0 ? 1 : 0);
