import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizePrefix, PROXIES } from '../src/config.js';

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

test('PROXIES: 非空数组,每项 {name,url},url 为 https 且以 / 结尾', () => {
  assert.ok(Array.isArray(PROXIES), 'PROXIES 应为数组');
  assert.ok(PROXIES.length >= 7, '至少 7 个镜像');
  for (const p of PROXIES) {
    assert.equal(typeof p.name, 'string', `${JSON.stringify(p)} 应有 name`);
    assert.equal(typeof p.url, 'string', `${JSON.stringify(p)} 应有 url`);
    assert.ok(/^https:\/\//.test(p.url), `${p.url} 应为 https`);
    assert.ok(p.url.endsWith('/'), `${p.url} 应以 / 结尾`);
  }
});

test('PROXIES: url 不重复', () => {
  const urls = PROXIES.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, 'url 不应重复');
});
