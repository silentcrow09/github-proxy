import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite } from '../src/rewrite.js';

const P = 'https://gh-proxy.org/';

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

test('不改非 https / 非 github', () => {
  assert.equal(rewrite('http://github.com/u/r.git', P), null);
  assert.equal(rewrite('https://example.com/u/r.git', P), null);
});

test('prefix 非法时返回 null', () => {
  assert.equal(rewrite('https://github.com/u/r.git', ''), null);
  assert.equal(rewrite('https://github.com/u/r.git', null), null);
});
