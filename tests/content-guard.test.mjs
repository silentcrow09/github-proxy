// tests/content-guard.test.mjs
// 架构守卫：content script 必须待在扩展的隔离世界里，不能靠动态 import 拉模块。
//
// 背景：src/content.js 曾经用 await import(chrome.runtime.getURL('src/config.js'))
// 把扩展模块动态加载进来。这条路要求把 src/*.js 放进 web_accessible_resources，
// 于是 github.com 上的任意页面都能 fetch(chrome-extension://<id>/src/config.js)
// 把扩展源码读走；而"生效前缀"的兜底逻辑也跟着搬进了页面侧。
//
// 这里锁死三条规则：
//   1) content script 不出现动态 import，也不通过 getURL 取扩展内文件；
//   2) content script 不直接访问存储的数据区（配置由 service worker 下发）；
//   3) manifest 不再把 src/ 下的源码暴露成 web_accessible_resources。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentSrc = readFileSync(join(ROOT, 'src', 'content.js'), 'utf8');
const backgroundSrc = readFileSync(join(ROOT, 'src', 'background.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

test('content script 不用动态 import 加载扩展模块', () => {
  assert.ok(
    !/await\s+import\s*\(/.test(contentSrc),
    'src/content.js 里不应出现 await import(...)：那会把模块逼进 web_accessible_resources',
  );
  assert.ok(
    !/chrome\.runtime\.getURL\s*\(/.test(contentSrc),
    'src/content.js 不应再通过 getURL 取扩展内文件',
  );
});

test('content script 不直接读写存储的数据区', () => {
  assert.ok(
    !/chrome\.storage\.(local|sync|session)\s*[.(]/.test(contentSrc),
    'src/content.js 不应直接访问存储区，配置应由 service worker 算好后下发',
  );
});

test('manifest 不再把扩展源码暴露成 web_accessible_resources', () => {
  const war = manifest.web_accessible_resources;
  if (!war) return;   // 完全没有这个键最好
  const leaked = war.flatMap((e) => e.resources || []).filter((r) => r.startsWith('src/'));
  assert.equal(leaked.length, 0, `这些源码不应暴露给网页：${leaked.join(', ')}`);
});

test('content script 依赖的经典脚本排在它前面', () => {
  const js = manifest.content_scripts?.[0]?.js || [];
  const iRewrite = js.indexOf('src/rewrite.js');
  const iContent = js.indexOf('src/content.js');
  assert.ok(iRewrite >= 0, 'manifest 的 content_scripts.js 必须列出 src/rewrite.js');
  assert.ok(iContent >= 0, 'manifest 的 content_scripts.js 必须列出 src/content.js');
  assert.ok(iRewrite < iContent, 'src/rewrite.js 必须排在 src/content.js 之前（经典脚本按顺序执行）');
});

test('service worker 负责给 content script 下发配置', () => {
  assert.ok(
    backgroundSrc.includes('ghp:get-config'),
    'src/background.js 必须处理 ghp:get-config 消息',
  );
  assert.ok(
    /chrome\.runtime\.onMessage\.addListener/.test(backgroundSrc),
    'src/background.js 必须注册 onMessage 监听器',
  );
});

test('rewrite.js 是双模文件：挂全局 + 供 Node require', () => {
  const rewriteSrc = readFileSync(join(ROOT, 'src', 'rewrite.js'), 'utf8');
  assert.ok(
    /globalThis\.GHP_REWRITE/.test(rewriteSrc),
    'src/rewrite.js 必须把 rewrite 挂到 globalThis.GHP_REWRITE（经典脚本路径）',
  );
  assert.ok(
    /module\.exports/.test(rewriteSrc),
    'src/rewrite.js 必须导出 module.exports（Node require 路径）',
  );
  assert.ok(
    !/^\s*export\s/m.test(rewriteSrc),
    'src/rewrite.js 不能带 ESM export：它要能当经典脚本执行',
  );
});
