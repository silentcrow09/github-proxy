import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizePrefix, PROXIES, normalizeProxyUrl, isValidProxyUrl, seedProxies, normalizeList, getStoredProxies, PROXIES_KEY } from '../src/config.js';

// ---- chrome.storage.sync mock（仅 getStoredProxies 用到）----
function mockStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (key) => {
          if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
          const out = {};
          for (const k of Object.keys(key)) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => { Object.assign(store, obj); },
      },
    },
  };
  return store;
}

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

test('isValidProxyUrl: http(s) 合法,其余非法', () => {
  assert.equal(isValidProxyUrl('https://x.com/'), true);
  assert.equal(isValidProxyUrl('http://localhost:8080/'), true);
  assert.equal(isValidProxyUrl('ftp://x.com/'), false);
  assert.equal(isValidProxyUrl('foo/bar'), false);
  assert.equal(isValidProxyUrl(''), false);
  assert.equal(isValidProxyUrl(null), false);
});

test('normalizeProxyUrl: trim + 补尾斜杠,空串返回空串', () => {
  assert.equal(normalizeProxyUrl('https://x.com'), 'https://x.com/');
  assert.equal(normalizeProxyUrl('  https://x.com/  '), 'https://x.com/');
  assert.equal(normalizeProxyUrl(''), '');
  assert.equal(normalizeProxyUrl(null), '');
});

test('seedProxies: 从内置常量克隆出带 id 的种子,数量/url 一致,且为新对象', () => {
  const seeded = seedProxies();
  assert.equal(seeded.length, PROXIES.length, '种子数量应等于内置项数');
  for (let i = 0; i < PROXIES.length; i++) {
    assert.equal(seeded[i].name, PROXIES[i].name);
    assert.equal(seeded[i].url, PROXIES[i].url);
    assert.ok(typeof seeded[i].id === 'string' && seeded[i].id.length > 0, '每项应有 id');
    assert.notEqual(seeded[i], PROXIES[i], '应为独立副本而非同一引用');
  }
  const ids = seeded.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, '种子 id 应唯一');
});

test('normalizeList: 丢弃非法项 + 按 url 去重 + 补 name/补尾斜杠', () => {
  const out = normalizeList([
    { id: 'a', name: 'A', url: 'https://a.com' },                              // 合法：补尾斜杠
    { id: 'b', name: '', url: 'https://b.com/' },                             // 合法：补 name
    { id: 'c', name: 'dup', url: 'https://a.com/' },                          // 与 a 去重
    { id: 'd', name: 'bad', url: 'ftp://x.com/' },                            // 非法：丢弃
    { id: 'e', name: 'bad', url: '' },                                        // 非法：丢弃
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://a.com/', '应补尾斜杠');
  assert.equal(out[0].name, 'A');
  assert.equal(out[1].name, 'b.com', '空 name 应回退为 host');
  const urls = out.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, 'url 不应重复');
});

test('normalizeList: 非数组/空数组输入返回空数组', () => {
  assert.deepEqual(normalizeList([]), []);
  assert.deepEqual(normalizeList(null), []);
  assert.deepEqual(normalizeList(undefined), []);
});

test('getStoredProxies: storage 无值时写入并返回默认种子', async () => {
  const store = mockStorage();   // 空存储
  const list = await getStoredProxies();
  assert.equal(list.length, PROXIES.length, '空存储应 seed 出内置镜像数');
  assert.ok(PROXIES_KEY in store, '应已落地写入 storage');
  for (const p of list) assert.ok(p.id, '每项应有 id');
});

test('getStoredProxies: 存空数组 [] 也重新 seed（修复：默认镜像永不被清空）', async () => {
  const store = mockStorage();
  store[PROXIES_KEY] = [];       // 关键回归点：空数组曾导致页面空白
  const list = await getStoredProxies();
  assert.equal(list.length, PROXIES.length, '存空数组应重新 seed 出默认镜像');
});

test('getStoredProxies: 已有数据时规整后原样返回，不重新 seed', async () => {
  const store = mockStorage();
  store[PROXIES_KEY] = [{ id: 'x', name: '我的', url: 'https://mine.com/' }];
  const list = await getStoredProxies();
  assert.equal(list.length, 1, '已有合法数据不应被覆盖');
  assert.equal(list[0].url, 'https://mine.com/');
});
