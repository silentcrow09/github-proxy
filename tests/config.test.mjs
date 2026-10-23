import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, SYNC_DEFAULTS, normalizePrefix, PROXIES, normalizeProxyUrl, isValidProxyUrl,
  seedProxies, normalizeList, getStoredProxies, setStoredProxies, resetProxies, getConfig,
  setEnabled, setEnhanced, setProxyPrefix, resolveActivePrefix,
  migrateProxiesToLocal, getLatencyCache, setLatencyCache, getHealth, setHealth,
  probeMirror, testProxies, pickBest, PROBE_TARGET, PROXIES_KEY,
} from '../src/config.js';

// ---- chrome.storage mock：区分 sync / local 两个区 ----
function mockStorage() {
  const sync = {};
  const local = {};
  const area = (store) => ({
    get: async (key) => {
      // 与 chrome.storage 语义一致：对象参数时，未存储的 key 返回默认值
      if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
      const out = {};
      for (const k of Object.keys(key)) out[k] = k in store ? store[k] : key[k];
      return out;
    },
    set: async (obj) => { Object.assign(store, obj); },
    remove: async (key) => { delete store[key]; },
  });
  globalThis.chrome = { storage: { sync: area(sync), local: area(local) } };
  return { sync, local };
}

// ---- fetch mock ----
function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => handler(url, opts || {});
}
function resp(status, bodyBytes) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => ({ byteLength: bodyBytes }),
  };
}

// ---- 基础归一化 ----

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
  assert.deepEqual(DEFAULTS, { enabled: true, enhanced: false, proxyPrefix: 'https://gh-proxy.org/' });
});

test('normalizePrefix: 非 http(s) 前缀回退默认值', () => {
  assert.equal(normalizePrefix('foo/bar/'), DEFAULTS.proxyPrefix);
  assert.equal(normalizePrefix('not-a-url'), DEFAULTS.proxyPrefix);
});

test('normalizePrefix: 接受 http 前缀', () => {
  assert.equal(normalizePrefix('http://localhost:8080/'), 'http://localhost:8080/');
});

test('SYNC_DEFAULTS: 必须包含 userSelected（popup 依它判断是否手动选过）', () => {
  assert.ok('userSelected' in SYNC_DEFAULTS, 'userSelected 必须在 sync 默认键里');
  assert.equal(SYNC_DEFAULTS.userSelected, false);
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
    { id: 'a', name: 'A', url: 'https://a.com' },
    { id: 'b', name: '', url: 'https://b.com/' },
    { id: 'c', name: 'dup', url: 'https://a.com/' },
    { id: 'd', name: 'bad', url: 'ftp://x.com/' },
    { id: 'e', name: 'bad', url: '' },
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

// ---- 镜像清单（local 区） ----

test('getStoredProxies: local 无值时写入并返回默认种子', async () => {
  const { local } = mockStorage();
  const list = await getStoredProxies();
  assert.equal(list.length, PROXIES.length, '空存储应 seed 出内置镜像数');
  assert.ok(PROXIES_KEY in local, '应已落地写入 local 区');
});

test('getStoredProxies: 存空数组 [] 也重新 seed（默认镜像永不被清空）', async () => {
  const { local } = mockStorage();
  local[PROXIES_KEY] = [];
  const list = await getStoredProxies();
  assert.equal(list.length, PROXIES.length, '存空数组应重新 seed 出默认镜像');
});

test('getStoredProxies: 已有数据时规整后原样返回，不重新 seed', async () => {
  const { local } = mockStorage();
  local[PROXIES_KEY] = [{ id: 'x', name: '我的', url: 'https://mine.com/' }];
  const list = await getStoredProxies();
  assert.equal(list.length, 1, '已有合法数据不应被覆盖');
  assert.equal(list[0].url, 'https://mine.com/');
});

test('setStoredProxies: 写入后读取应一致（已规整）', async () => {
  mockStorage();
  await setStoredProxies([
    { id: 'a', name: '镜像A', url: 'https://a.com' },
    { id: 'b', name: '镜像B', url: 'https://b.com/' },
  ]);
  const list = await getStoredProxies();
  assert.equal(list.length, 2);
  assert.equal(list[0].url, 'https://a.com/', '应补尾斜杠');
  assert.equal(list[1].url, 'https://b.com/');
});

test('setStoredProxies: 去重 + 丢弃非法项', async () => {
  mockStorage();
  await setStoredProxies([
    { id: 'a', name: 'A', url: 'https://a.com/' },
    { id: 'b', name: 'dup', url: 'https://a.com/' },
    { id: 'c', name: 'bad', url: 'ftp://x.com/' },
  ]);
  const list = await getStoredProxies();
  assert.equal(list.length, 1);
  assert.equal(list[0].url, 'https://a.com/');
});

test('resetProxies: 恢复内置默认镜像', async () => {
  mockStorage();
  await setStoredProxies([{ id: 'x', name: '自定义', url: 'https://custom.com/' }]);
  const list = await resetProxies();
  assert.equal(list.length, PROXIES.length, '应恢复为内置镜像数量');
  for (let i = 0; i < PROXIES.length; i++) assert.equal(list[i].url, PROXIES[i].url);
  const stored = await getStoredProxies();
  assert.equal(stored.length, PROXIES.length);
});

// ---- 迁移：sync -> local ----

test('migrateProxiesToLocal: sync 有清单时迁到 local 并清掉 sync', async () => {
  const { sync, local } = mockStorage();
  sync[PROXIES_KEY] = [{ id: 'x', name: '旧', url: 'https://old.com/' }];
  const moved = await migrateProxiesToLocal();
  assert.equal(moved, true);
  assert.equal(local[PROXIES_KEY].length, 1, '清单应落到 local');
  assert.ok(!(PROXIES_KEY in sync), 'sync 里的旧清单应被移除');
});

test('migrateProxiesToLocal: local 已有清单时不迁移（幂等）', async () => {
  const { sync, local } = mockStorage();
  local[PROXIES_KEY] = [{ id: 'y', name: '新', url: 'https://new.com/' }];
  sync[PROXIES_KEY] = [{ id: 'x', name: '旧', url: 'https://old.com/' }];
  const moved = await migrateProxiesToLocal();
  assert.equal(moved, false);
  assert.equal(local[PROXIES_KEY][0].url, 'https://new.com/', 'local 已有数据不应被覆盖');
  assert.ok(PROXIES_KEY in sync, '未迁移时不应动 sync');
});

// ---- 配置（sync 区） ----

test('getConfig: 默认值正确', async () => {
  mockStorage();
  const cfg = await getConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.enhanced, false);
  assert.equal(cfg.proxyPrefix, DEFAULTS.proxyPrefix);
  assert.equal(cfg.userSelected, false, '必须返回 userSelected');
});

test('getConfig: 归一化 proxyPrefix', async () => {
  const { sync } = mockStorage();
  sync.proxyPrefix = 'https://ghproxy.net';
  sync.enabled = false;
  sync.enhanced = true;
  const cfg = await getConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.enhanced, true);
  assert.equal(cfg.proxyPrefix, 'https://ghproxy.net/', '应补尾斜杠');
});

test('getConfig: 非法 proxyPrefix 回退默认', async () => {
  const { sync } = mockStorage();
  sync.proxyPrefix = 'not-a-url';
  const cfg = await getConfig();
  assert.equal(cfg.proxyPrefix, DEFAULTS.proxyPrefix);
});

test('getConfig: 必须读出已存储的 userSelected（回归：手动选择必须粘住）', async () => {
  const { sync } = mockStorage();
  sync.userSelected = true;
  sync.proxyPrefix = 'https://ghproxy.net/';
  const cfg = await getConfig();
  assert.equal(cfg.userSelected, true, 'userSelected 必须从 storage 读出');
  assert.equal(cfg.proxyPrefix, 'https://ghproxy.net/');
});

test('setProxyPrefix: 写入前缀与 userSelected', async () => {
  const { sync } = mockStorage();
  await setProxyPrefix('https://x.com', true);
  assert.equal(sync.proxyPrefix, 'https://x.com/', '应补尾斜杠');
  assert.equal(sync.userSelected, true);
  await setProxyPrefix('https://y.com', false);
  assert.equal(sync.userSelected, false);
});

test('setEnabled / setEnhanced: 写入布尔值', async () => {
  const { sync } = mockStorage();
  await setEnabled(false);
  await setEnhanced(true);
  assert.equal(sync.enabled, false);
  assert.equal(sync.enhanced, true);
});

test('resolveActivePrefix: 前缀在清单内时原样返回', async () => {
  const { sync, local } = mockStorage();
  local[PROXIES_KEY] = [{ id: 'a', name: 'A', url: 'https://a.com/' }];
  sync.proxyPrefix = 'https://a.com/';
  assert.equal(await resolveActivePrefix(), 'https://a.com/');
});

test('resolveActivePrefix: 前缀不在本机清单时回退到清单首项（回归：不能指向不存在的镜像）', async () => {
  const { sync, local } = mockStorage();
  local[PROXIES_KEY] = [{ id: 'a', name: 'A', url: 'https://a.com/' }];
  sync.proxyPrefix = 'https://other-device.com/';   // 从别的设备同步过来的
  assert.equal(await resolveActivePrefix(), 'https://a.com/');
});

// ---- 测速缓存与健康状态（local 区） ----

test('getLatencyCache / setLatencyCache: 读写往返', async () => {
  const { local } = mockStorage();
  assert.deepEqual(await getLatencyCache(), {});
  await setLatencyCache({ 'https://a.com/': { ms: 123, state: 'ok' } });
  assert.equal(local.latency['https://a.com/'].ms, 123);
  assert.equal((await getLatencyCache())['https://a.com/'].state, 'ok');
});

test('getHealth / setHealth: 读写往返', async () => {
  const { local } = mockStorage();
  assert.deepEqual(await getHealth(), {});
  await setHealth({ 'https://a.com/': { fails: 2, ok: 1 } });
  assert.equal(local.health['https://a.com/'].fails, 2);
  assert.equal((await getHealth())['https://a.com/'].ok, 1);
});

// ---- 真实代理探测 ----

test('PROBE_TARGET: 指向一个真实的 github.com 资源', () => {
  assert.ok(PROBE_TARGET.startsWith('https://github.com/'), '探测目标必须是 github.com 资源');
  assert.ok(PROBE_TARGET.length > 0);
});

test('probeMirror: CORS 可读且 200 → ok', async () => {
  mockStorage();
  mockFetch(async () => resp(200, 258));
  const r = await probeMirror('https://m.com/');
  assert.equal(r.state, 'ok');
  assert.equal(r.status, 200);
  assert.equal(r.bytes, 258);
  assert.ok(typeof r.ms === 'number');
});

test('probeMirror: 探测请求必须打在真实代理路径上（不是镜像首页）', async () => {
  mockStorage();
  let hit = null;
  mockFetch(async (url) => { hit = url; return resp(200, 258); });
  await probeMirror('https://m.com/');
  assert.equal(hit, 'https://m.com/' + PROBE_TARGET, '应请求 prefix + 真实资源');
});

test('probeMirror: 返回非 200 → bad（镜像代理不出东西）', async () => {
  mockStorage();
  mockFetch(async () => resp(404, 13));
  const r = await probeMirror('https://m.com/');
  assert.equal(r.state, 'bad');
  assert.equal(r.status, 404);
});

test('probeMirror: 200 但响应体为空 → bad', async () => {
  mockStorage();
  mockFetch(async () => resp(200, 0));
  const r = await probeMirror('https://m.com/');
  assert.equal(r.state, 'bad');
});

test('probeMirror: CORS 被拒但 no-cors 通 → unknown（可达但无法校验内容）', async () => {
  mockStorage();
  mockFetch(async (url, opts) => {
    if (opts.mode === 'cors') throw new TypeError('Failed to fetch');
    return resp(200, 258);
  });
  const r = await probeMirror('https://m.com/');
  assert.equal(r.state, 'unknown');
  assert.equal(r.status, null);
  assert.ok(typeof r.ms === 'number');
});

test('probeMirror: 两种模式都失败 → dead（不可达）', async () => {
  mockStorage();
  mockFetch(async () => { throw new TypeError('Failed to fetch'); });
  const r = await probeMirror('https://m.com/');
  assert.equal(r.state, 'dead');
  assert.equal(r.ms, null);
});

// ---- 择优 ----

test('pickBest: 优先在已验证可用里选延迟最低的', () => {
  const tested = [
    { url: 'a', ms: 900, state: 'unknown' },
    { url: 'b', ms: 300, state: 'ok' },
    { url: 'c', ms: 100, state: 'ok' },
  ];
  assert.equal(pickBest(tested).url, 'c');
});

test('pickBest: 没有已验证可用时，退到可达但未验证的里选', () => {
  const tested = [
    { url: 'a', ms: 900, state: 'unknown' },
    { url: 'b', ms: 300, state: 'unknown' },
    { url: 'c', ms: null, state: 'dead' },
  ];
  assert.equal(pickBest(tested).url, 'b');
});

test('pickBest: 全挂时回退到清单首项', () => {
  const tested = [{ url: 'a', ms: null, state: 'dead' }];
  assert.equal(pickBest(tested).url, 'a');
  assert.equal(pickBest([]), null);
});

test('testProxies: 逐个探测并带回 state', async () => {
  mockStorage();
  mockFetch(async () => resp(200, 258));
  const tested = await testProxies([{ name: 'A', url: 'https://a.com/' }]);
  assert.equal(tested.length, 1);
  assert.equal(tested[0].state, 'ok');
  assert.equal(tested[0].name, 'A');
});
