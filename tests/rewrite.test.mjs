import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// src/rewrite.js 是"经典脚本 + Node 可 require"的双模文件：
// 浏览器里作为经典脚本先加载（挂在 globalThis.GHP_REWRITE），
// Node 里用 createRequire 拿具名导出。
const require = createRequire(import.meta.url);
const { rewrite } = require('../src/rewrite.js');

const P = 'https://gh-proxy.org/';
const P2 = 'https://ghproxy.net/';

test('改写 Release 资源下载链接', () => {
  assert.equal(
    rewrite('https://github.com/u/r/releases/download/v1.0/a.zip', P),
    'https://gh-proxy.org/https://github.com/u/r/releases/download/v1.0/a.zip'
  );
});

test('改写 .git clone 地址', () => {
  assert.equal(
    rewrite('https://github.com/u/r.git', P),
    'https://gh-proxy.org/https://github.com/u/r.git'
  );
});

test('不改仓库主页', () => {
  assert.equal(rewrite('https://github.com/u/r', P), null);
});

test('不改 Download ZIP (archive)', () => {
  assert.equal(rewrite('https://github.com/u/r/archive/refs/heads/main.zip', P), null);
});

test('不改 raw.githubusercontent', () => {
  assert.equal(rewrite('https://raw.githubusercontent.com/u/r/main/f.js', P), null);
});

test('不改 SSH clone', () => {
  assert.equal(rewrite('git@github.com:u/r.git', P), null);
});

test('幂等：已带前缀不再拼接', () => {
  assert.equal(rewrite('https://gh-proxy.org/https://github.com/u/r.git', P), null);
});

test('幂等：已被其他代理改写不再拼接（防链式叠加）', () => {
  assert.equal(rewrite('https://ghproxy.net/https://github.com/u/r.git', P), null);
  assert.equal(rewrite('https://gh-proxy.org/https://github.com/u/r.git', P2), null);
});

test('不改非 https / 非 github', () => {
  assert.equal(rewrite('http://github.com/u/r.git', P), null);
  assert.equal(rewrite('https://example.com/u/r.git', P), null);
});

test('prefix 非法时返回 null', () => {
  assert.equal(rewrite('https://github.com/u/r.git', ''), null);
  assert.equal(rewrite('https://github.com/u/r.git', null), null);
});

// ---- 增强模式 ----

test('增强模式：改写仓库主页', () => {
  assert.equal(
    rewrite('https://github.com/u/r', P, { enhanced: true }),
    'https://gh-proxy.org/https://github.com/u/r'
  );
});

test('增强模式：改写仓库 issues 页', () => {
  assert.equal(
    rewrite('https://github.com/u/r/issues', P, { enhanced: true }),
    'https://gh-proxy.org/https://github.com/u/r/issues'
  );
});

test('增强模式：改写仓库 pulls 页', () => {
  assert.equal(
    rewrite('https://github.com/u/r/pulls', P, { enhanced: true }),
    'https://gh-proxy.org/https://github.com/u/r/pulls'
  );
});

test('增强模式：改写 Release 下载链接', () => {
  assert.equal(
    rewrite('https://github.com/u/r/releases/download/v1.0/a.zip', P, { enhanced: true }),
    'https://gh-proxy.org/https://github.com/u/r/releases/download/v1.0/a.zip'
  );
});

test('增强模式：不改 github.com 首页', () => {
  assert.equal(rewrite('https://github.com/', P, { enhanced: true }), null);
});

test('增强模式：不改 github.com 无仓库路径', () => {
  assert.equal(rewrite('https://github.com/features', P, { enhanced: true }), null);
  assert.equal(rewrite('https://github.com/login', P, { enhanced: true }), null);
});

test('增强模式：不改非 github 链接', () => {
  assert.equal(rewrite('https://example.com/u/r', P, { enhanced: true }), null);
});

test('增强模式：幂等检查仍生效', () => {
  assert.equal(rewrite('https://gh-proxy.org/https://github.com/u/r', P, { enhanced: true }), null);
  assert.equal(rewrite('https://ghproxy.net/https://github.com/u/r', P, { enhanced: true }), null);
});

test('增强模式：默认关闭不影响原有行为', () => {
  assert.equal(rewrite('https://github.com/u/r', P), null);
  assert.equal(rewrite('https://github.com/u/r/issues', P), null);
});
