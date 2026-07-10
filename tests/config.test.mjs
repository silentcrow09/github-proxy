import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizePrefix } from '../src/config.js';

test('normalizePrefix: 已带斜杠保持不变', () => {
  assert.equal(normalizePrefix('https://gh-proxy.org/'), 'https://gh-proxy.org/');
});

test('normalizePrefix: 缺斜杠补上', () => {
  assert.equal(normalizePrefix('https://gh-proxy.org'), 'https://gh-proxy.org/');
});

test('normalizePrefix: 空串回退默认值', () => {
  assert.equal(normalizePrefix(''), DEFAULTS.proxyPrefix);
});

test('normalizePrefix: 非字符串回退默认值', () => {
  assert.equal(normalizePrefix(null), DEFAULTS.proxyPrefix);
  assert.equal(normalizePrefix(undefined), DEFAULTS.proxyPrefix);
});

test('normalizePrefix: 去除首尾空白', () => {
  assert.equal(normalizePrefix('  https://ghproxy.net/  '), 'https://ghproxy.net/');
});

test('DEFAULTS 默认值正确', () => {
  assert.deepEqual(DEFAULTS, { enabled: true, proxyPrefix: 'https://gh-proxy.org/' });
});

test('normalizePrefix: 非 http(s) 前缀回退默认值', () => {
  assert.equal(normalizePrefix('foo/bar/'), DEFAULTS.proxyPrefix);
  assert.equal(normalizePrefix('not-a-url'), DEFAULTS.proxyPrefix);
});

test('normalizePrefix: 接受 http 前缀', () => {
  assert.equal(normalizePrefix('http://localhost:8080/'), 'http://localhost:8080/');
});
