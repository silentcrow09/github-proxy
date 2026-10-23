// src/config.js
// 配置默认值、前缀归一化、chrome.storage 读写封装。
//
// 存储分区：
//   chrome.storage.sync  —— 跨设备一致的用户选择（开关、当前镜像、是否手动选过）
//   chrome.storage.local —— 与设备/网络相关（镜像清单、测速缓存、健康状态）
//   镜像清单放 local 的原因：镜像可用性与延迟因网络而异，跨设备同步会互相覆盖。

export const DEFAULTS = { enabled: true, enhanced: false, proxyPrefix: 'https://gh-proxy.org/' };

/** sync 区的默认键集合（getConfig 依据它读取并归一化）。 */
export const SYNC_DEFAULTS = {
  enabled: DEFAULTS.enabled,
  enhanced: DEFAULTS.enhanced,
  proxyPrefix: DEFAULTS.proxyPrefix,
  userSelected: false,
};

/** local 区键名。 */
export const PROXIES_KEY = 'proxies';
export const LATENCY_KEY = 'latency';
export const HEALTH_KEY = 'health';

/**
 * 测速缓存有效期。后台每 5 分钟体检一次；popup 打开时若缓存仍新鲜就不重复全量重测，
 * 避免每次开 popup 都发一轮探测请求。
 */
export const LATENCY_TTL_MS = 5 * 60 * 1000;

/** 归一化代理前缀：保证非空且以 '/' 结尾，否则回退 DEFAULTS.proxyPrefix。 */
export function normalizePrefix(p) {
  if (typeof p !== 'string') return DEFAULTS.proxyPrefix;
  const s = p.trim();
  if (s === '') return DEFAULTS.proxyPrefix;
  if (!/^https?:\/\//.test(s)) return DEFAULTS.proxyPrefix;   // 非 http(s) 前缀 → 回退默认
  return s.endsWith('/') ? s : s + '/';
}

// 内置镜像列表：作为首次安装的种子 + 「恢复默认」的来源。只读常量。
export const PROXIES = [
  { name: 'gh-proxy.org',     url: 'https://gh-proxy.org/' },
  { name: 'gh-proxy v4',      url: 'https://v4.gh-proxy.org/' },
  { name: 'gh-proxy cdn',     url: 'https://cdn.gh-proxy.org/' },
  { name: 'ghproxy.net',      url: 'https://ghproxy.net/' },
  { name: 'ghfast.top',       url: 'https://ghfast.top/' },
  { name: 'gh-proxy.com',     url: 'https://gh-proxy.com/' },
  { name: 'ghps.cc',          url: 'https://ghps.cc/' },
];

/**
 * 探测目标：经镜像拉取的一个真实 GitHub 资源。
 *
 * 选 octocat/Hello-World 的源码归档的理由：
 *   - 体积小（258 字节），探测开销可忽略；
 *   - 仓库与 master 分支永久存在，不含版本号（不像 release 资源可能被删）；
 *   - 走的是 /archive/ 路径，与镜像真正要代理的下载路径一致（raw 路径会让部分镜像返回
 *     非预期的 302 Location）。
 */
export const PROBE_TARGET =
  'https://github.com/octocat/Hello-World/archive/refs/heads/master.tar.gz';

/** 自增 id（时间戳 + 随机，非关键路径）。 */
export function nextId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 从 url 猜一个名字（取 host）。 */
export function deriveName(url) {
  try { return new URL(url).host; } catch { return url; }
}

/** 仅校验"是否合法镜像前缀"，不回退默认值（非法返回 false）。 */
export function isValidProxyUrl(url) {
  if (typeof url !== 'string') return false;
  const s = url.trim();
  if (s === '') return false;
  return /^https?:\/\//.test(s);
}

/** 归一化用户输入的镜像地址：trim + 补尾斜杠。空串返回空串。 */
export function normalizeProxyUrl(url) {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  if (s === '') return '';
  return s.endsWith('/') ? s : s + '/';
}

/** 把 PROXIES 常量克隆为带 id 的种子副本（首次安装写入 storage）。 */
export function seedProxies() {
  return PROXIES.map((p) => ({ id: nextId(), name: p.name, url: p.url }));
}

/** 校验 + 归一化单条镜像（补 name、补尾斜杠）。非法条目被丢弃。 */
function normalizeEntry(p) {
  if (!p || !isValidProxyUrl(p.url)) return null;
  const url = normalizeProxyUrl(p.url);
  const name = (typeof p.name === 'string' ? p.name : '').trim() || deriveName(url);
  return { id: typeof p.id === 'string' && p.id ? p.id : nextId(), name, url };
}

/** 规整整个列表：丢弃非法项、按 url 去重（保留首个）。 */
export function normalizeList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const e = normalizeEntry(raw);
    if (!e || seen.has(e.url)) continue;
    seen.add(e.url);
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------- 存储读写

/**
 * 一次性把镜像清单从 sync 迁移到 local。
 * local 已有清单 → 不做任何事；sync 没有清单 → 不做任何事。
 * @returns {Promise<boolean>} 是否发生了迁移
 */
export async function migrateProxiesToLocal() {
  const local = await chrome.storage.local.get(PROXIES_KEY);
  if (local[PROXIES_KEY] !== undefined) return false;
  const sync = await chrome.storage.sync.get(PROXIES_KEY);
  if (sync[PROXIES_KEY] === undefined) return false;
  await chrome.storage.local.set({ [PROXIES_KEY]: sync[PROXIES_KEY] });
  await chrome.storage.sync.remove(PROXIES_KEY);
  return true;
}

/**
 * 读取用户镜像列表（local 区）。
 * 无值或为空 → 写入种子并返回（保证首装/被清空后都有默认镜像）；
 * 已存有数据 → 规整后返回。
 */
export async function getStoredProxies() {
  const stored = await chrome.storage.local.get(PROXIES_KEY);
  const val = stored[PROXIES_KEY];
  const normalized = normalizeList(val);
  if (normalized.length === 0) {
    const seeded = seedProxies();
    await chrome.storage.local.set({ [PROXIES_KEY]: seeded });
    return seeded;
  }
  return normalized;
}

/** 全量写入镜像列表（已规整）。 */
export async function setStoredProxies(list) {
  await chrome.storage.local.set({ [PROXIES_KEY]: normalizeList(list) });
}

/** 恢复内置默认镜像（覆盖当前列表）。 */
export async function resetProxies() {
  const seeded = seedProxies();
  await chrome.storage.local.set({ [PROXIES_KEY]: seeded });
  return seeded;
}

/**
 * 从 chrome.storage.sync 读取并归一化配置。
 * 返回值包含 userSelected —— popup 依它判断"用户是否手动选过镜像"，
 * 手动选过就不再被自动测速覆盖。
 */
export async function getConfig() {
  const stored = await chrome.storage.sync.get(SYNC_DEFAULTS);
  return {
    enabled: stored.enabled === true,
    enhanced: stored.enhanced === true,
    proxyPrefix: normalizePrefix(stored.proxyPrefix),
    userSelected: stored.userSelected === true,
  };
}

/**
 * 当前真正生效的前缀。
 * sync 里同步过来的 proxyPrefix 可能不在本机镜像清单里（镜像清单在 local），
 * 此时回退到本机清单首项，避免"生效的前缀在界面上找不到"。
 */
export async function resolveActivePrefix() {
  const cfg = await getConfig();
  const list = await getStoredProxies();
  if (list.some((p) => p.url === cfg.proxyPrefix)) return cfg.proxyPrefix;
  return list[0]?.url ?? cfg.proxyPrefix;
}

/** 写入"启用/关闭加速"（sync 区）。 */
export function setEnabled(v) {
  return chrome.storage.sync.set({ enabled: !!v });
}

/** 写入"增强模式"（sync 区）。 */
export function setEnhanced(v) {
  return chrome.storage.sync.set({ enhanced: !!v });
}

/**
 * 写入当前生效镜像（sync 区）。
 * @param {string} url         镜像地址
 * @param {boolean} userSelected 是否由用户手动选定（true=粘住，不再被自动测速覆盖）
 */
export function setProxyPrefix(url, userSelected) {
  return chrome.storage.sync.set({
    proxyPrefix: normalizePrefix(url),
    userSelected: !!userSelected,
  });
}

/** 读取测速缓存（local 区）：{ [mirrorUrl]: { ms, state, status, at } } */
export async function getLatencyCache() {
  const stored = await chrome.storage.local.get(LATENCY_KEY);
  const v = stored[LATENCY_KEY];
  return v && typeof v === 'object' ? v : {};
}

/** 写入测速缓存（local 区）。 */
export function setLatencyCache(cache) {
  return chrome.storage.local.set({ [LATENCY_KEY]: cache });
}

/** 读取健康状态（local 区）：{ [mirrorUrl]: { fails, ok, lastMs, lastState, lastChecked } } */
export async function getHealth() {
  const stored = await chrome.storage.local.get(HEALTH_KEY);
  const v = stored[HEALTH_KEY];
  return v && typeof v === 'object' ? v : {};
}

/** 写入健康状态（local 区）。 */
export function setHealth(health) {
  return chrome.storage.local.set({ [HEALTH_KEY]: health });
}

// ---------------------------------------------------------------- 测速

/** 带超时的 AbortController。 */
function abortSignal(timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // 定时器由 fetch 结束时清掉；这里用 WeakRef 式兜底不可行，交给调用方的 finally
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer));
  return { ctrl, cancel: () => clearTimeout(timer) };
}

/** 状态图标的基础名（与 tools/make-icons.ps1 生成的文件名对应）。 */
export const ICON_STATES = { on: 'state-on', off: 'state-off', fail: 'state-fail' };

/** Chrome 会按各尺寸选取图标。 */
export const ICON_SIZES = [16, 32, 48, 128];

/**
 * 三种状态对应的图标路径。
 *
 * 必须用 chrome.runtime.getURL() 拼成**绝对 URL**：
 * chrome.action.setIcon() 的相对路径是按**调用方所在目录**解析的，
 * 而 Service Worker 位于 src/background.js，于是 'icons/x.png' 会被解析成
 * chrome-extension://<id>/src/icons/x.png —— 找不到文件，报 "Failed to fetch"。
 * 绝对 URL 不受调用方位置影响。
 */
export function stateIconPaths() {
  const out = {};
  for (const [state, base] of Object.entries(ICON_STATES)) {
    const map = {};
    for (const size of ICON_SIZES) {
      map[size] = chrome.runtime.getURL(`icons/${base}-${size}.png`);
    }
    out[state] = map;
  }
  return out;
}

/**
 * 内置镜像的 origin 列表。
 * 与 manifest.json 的 host_permissions 一一对应（tests/parse.test.mjs 有断言防止漂移）：
 * 持有主机权限的域名，扩展的请求被浏览器放行、不走 CORS 检查，
 * 因此既能读到真实状态码，也不会在控制台留下 "blocked by CORS policy" 的报错。
 */
export const BUILTIN_ORIGINS = [
  'https://gh-proxy.org',
  'https://v4.gh-proxy.org',
  'https://cdn.gh-proxy.org',
  'https://ghproxy.net',
  'https://ghfast.top',
  'https://gh-proxy.com',
  'https://ghps.cc',
];

/**
 * 该镜像域名能否读到响应体与状态码。
 * 内置镜像由 manifest 授予；自定义镜像需用户在设置页点「验证」授权。
 */
export async function canReadResponse(prefix) {
  let origin;
  try { origin = new URL(prefix).origin; } catch { return false; }
  if (BUILTIN_ORIGINS.includes(origin)) return true;
  try {
    return await chrome.permissions.contains({ origins: [origin + '/*'] });
  } catch {
    return false;
  }
}

/**
 * 真实代理探测：经镜像拉取一个真实 GitHub 资源，校验状态码与内容。
 *
 * 返回 state：
 *   ok      —— 已验证可用（HTTP 200 且响应体非空）
 *   unknown —— 可达但内容无法校验（镜像未返回 CORS 头，浏览器不给读响应体）
 *   bad     —— 已验证失效（镜像回了非 200，例如 404，文件根本代理不出来）
 *   dead    —— 不可达（连接失败或超时）
 *
 * 只有拿到主机权限的域名才走 CORS 模式：
 *   - 有权限：扩展的请求被浏览器放行（不走 CORS 检查），能读到真实状态码，也不会在
 *     控制台留下 "blocked by CORS policy" 的红字；
 *   - 无权限：只能用 no-cors，浏览器不给读状态码（结论只能是"可达"）。
 *     **不要对无权限的域名尝试 CORS** —— 浏览器会在控制台刷报错，JS 侧虽然兜得住，
 *     但用户看到后台报错会以为扩展坏了。
 */
export async function probeMirror(prefix, timeoutMs = 15000) {
  const target = prefix + PROBE_TARGET;
  const t0 = performance.now();

  if (await canReadResponse(prefix)) {
    const a = abortSignal(timeoutMs);
    try {
      const res = await fetch(target, { mode: 'cors', cache: 'no-store', signal: a.ctrl.signal });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) return { ms, state: 'bad', status: res.status, reason: 'HTTP ' + res.status };
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) return { ms, state: 'bad', status: res.status, reason: '空响应' };
      return { ms, state: 'ok', status: res.status, bytes: buf.byteLength };
    } catch {
      // 权限判断与实际不符等意外情况：退回 no-cors 确认可达，不留下 CORS 报错
      return await probeReachable(target, timeoutMs);
    } finally {
      a.cancel();
    }
  }

  return await probeReachable(target, timeoutMs);
}

/** no-cors 探测：只能确认"可达"与耗时，读不到状态码。 */
async function probeReachable(target, timeoutMs) {
  const b = abortSignal(timeoutMs);
  const t0 = performance.now();
  try {
    await fetch(target, { mode: 'no-cors', cache: 'no-store', signal: b.ctrl.signal });
    return { ms: Math.round(performance.now() - t0), state: 'unknown', status: null };
  } catch {
    return { ms: null, state: 'dead', status: null };
  } finally {
    b.cancel();
  }
}

/**
 * 并发探测全部镜像，返回 [{ ...entry, ms, state, status }]。
 * 可传入 list 覆盖默认 PROXIES。
 */
export async function testProxies(list = PROXIES) {
  return Promise.all(list.map(async (p) => {
    const r = await probeMirror(p.url);
    return { ...p, ms: r.ms, state: r.state, status: r.status };
  }));
}

/**
 * 选出"最优镜像"：
 *   1) 先在已验证可用（ok）里挑延迟最低的；
 *   2) 没有已验证可用的，退到"可达但未验证"（unknown）里挑延迟最低的；
 *   3) 全不可达 → 回退清单首项（宁可给用户一个能改的默认值，也别给空）。
 */
export function pickBest(tested) {
  const ok = tested.filter((t) => t.state === 'ok');
  const pool = ok.length ? ok : tested.filter((t) => t.state === 'unknown');
  if (pool.length) return pool.reduce((a, b) => (a.ms <= b.ms ? a : b));
  return tested[0] ?? null;
}
