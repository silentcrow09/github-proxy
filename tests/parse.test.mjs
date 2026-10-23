// tests/parse.test.mjs
// 语法守卫：扩展里所有 .js 都必须能被解析成 ES module。
//
// 背景：popup.js 曾因为丢失一行 `function latencyMeta(ms) {` 而整体无法解析，
// 而当时 43 个测试全部通过——因为测试只覆盖 rewrite.js / config.js 两个纯函数，
// UI 层零覆盖。纯函数测试挡不住这种"文件级致命错误"，语法解析可以。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 递归收集目录下的 .js 文件。 */
function collectJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectJs(full, out);
    else if (extname(full) === '.js') out.push(full);
  }
  return out;
}

/** 用 node --check 解析一个文件，返回 { ok, output }。 */
function checkSyntax(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stderr || '') + (r.stdout || '') };
}

test('语法守卫本身有效：故意写坏的 JS 必须被 --check 拦下', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ghp-parse-'));
  try {
    const broken = join(dir, 'broken.mjs');
    // 复现历史上真实发生过的错误：函数声明行丢失
    writeFileSync(broken, "const a = 1;\n  if (a == null) return { x: 1 };\n}\n", 'utf8');
    const r = checkSyntax(broken);
    assert.equal(r.ok, false, '坏文件必须解析失败，否则这道守卫是空转的');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('所有扩展源码都能解析成 ES module', () => {
  const files = [
    ...collectJs(join(ROOT, 'src')),
    ...collectJs(join(ROOT, 'popup')),
    ...collectJs(join(ROOT, 'options')),
  ];
  assert.ok(files.length >= 6, `应至少检查 6 个文件，实际 ${files.length}`);

  const failures = [];
  for (const f of files) {
    const r = checkSyntax(f);
    if (!r.ok) failures.push(`${f.replace(ROOT + '\\', '')}\n${r.output.trim()}`);
  }
  assert.equal(failures.length, 0, '以下文件存在语法错误：\n' + failures.join('\n---\n'));
});

test('manifest.json 是合法 JSON 且必需字段齐全', async () => {
  const { readFileSync } = await import('node:fs');
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.name && m.version, 'name/version 必须存在');
  assert.ok(Array.isArray(m.permissions), 'permissions 应为数组');
  assert.ok(m.content_scripts?.length, '必须有 content script');
  assert.ok(m.background?.service_worker, '必须有 background service worker');
  assert.equal(m.background.type, 'module', 'background 需声明为 module 才能用 import');
});

test('manifest.json: 内置镜像域名都在 host_permissions 里', async () => {
  // 少了主机权限，探测这些镜像就会触发 "blocked by CORS policy"，后台控制台一片红字
  const { readFileSync } = await import('node:fs');
  const { BUILTIN_ORIGINS } = await import('../src/config.js');
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(m.host_permissions));
  for (const origin of BUILTIN_ORIGINS) {
    assert.ok(
      m.host_permissions.includes(origin + '/*'),
      `${origin} 应在 host_permissions 中，否则探测会被 CORS 拦截`,
    );
  }
  assert.ok(m.host_permissions.includes('https://github.com/*'), 'github.com 必须有主机权限');
});
