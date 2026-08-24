// src/config.js
// 配置默认值、前缀归一化、从 chrome.storage 读取配置。

export const DEFAULTS = { enabled: true, enhanced: false, proxyPrefix: 'https://gh-proxy.org/' };

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

// 用户可编辑的全部镜像（内置 + 自定义统一存这里）。键：storage.sync.proxies。
export const PROXIES_KEY = 'proxies';

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

/**
 * 读取用户镜像列表。
 * storage 无值或为空 → 写入种子并返回（保证首装/被清空后都有默认镜像）；
 * 已存有数据 → 规整后返回。
 */
export async function getStoredProxies() {
  const stored = await chrome.storage.sync.get(PROXIES_KEY);
  const val = stored[PROXIES_KEY];
  const normalized = normalizeList(val);
  if (normalized.length === 0) {
    const seeded = seedProxies();
    await chrome.storage.sync.set({ [PROXIES_KEY]: seeded });
    return seeded;
  }
  return normalized;
}

/** 全量写入镜像列表（已规整）。 */
export async function setStoredProxies(list) {
  await chrome.storage.sync.set({ [PROXIES_KEY]: normalizeList(list) });
}

/** 恢复内置默认镜像（覆盖当前列表）。 */
export async function resetProxies() {
  const seeded = seedProxies();
  await chrome.storage.sync.set({ [PROXIES_KEY]: seeded });
  return seeded;
}

/** 从 chrome.storage.sync 读取并归一化配置。仅在扩展环境可用。 */
export async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return {
    enabled: stored.enabled === true,
    enhanced: stored.enhanced === true,
    proxyPrefix: normalizePrefix(stored.proxyPrefix),
  };
}

/** 测单个镜像延迟(ms)；超时/失败返回 null。no-cors 计时,无需额外权限。 */
export async function ping(url, timeoutMs = 5000) {
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 并发测全部镜像,返回 [{name,url,ms}]。可传入 list 覆盖默认 PROXIES。 */
export async function testProxies(list = PROXIES) {
  return Promise.all(list.map(async (p) => ({ ...p, ms: await ping(p.url) })));
}
