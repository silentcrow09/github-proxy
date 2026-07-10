// src/config.js
// 配置默认值、前缀归一化、从 chrome.storage 读取配置。

export const DEFAULTS = { enabled: true, proxyPrefix: 'https://gh-proxy.org/' };

/** 归一化代理前缀：保证非空且以 '/' 结尾，否则回退 DEFAULTS.proxyPrefix。 */
export function normalizePrefix(p) {
  if (typeof p !== 'string') return DEFAULTS.proxyPrefix;
  const s = p.trim();
  if (s === '') return DEFAULTS.proxyPrefix;
  if (!/^https?:\/\//.test(s)) return DEFAULTS.proxyPrefix;   // 非 http(s) 前缀 → 回退默认
  return s.endsWith('/') ? s : s + '/';
}

/** 从 chrome.storage.sync 读取并归一化配置。仅在扩展环境可用。 */
export async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return {
    enabled: stored.enabled === true,
    proxyPrefix: normalizePrefix(stored.proxyPrefix),
  };
}

// 内置镜像列表（用户只能从这里选,不可编辑地址）。
export const PROXIES = [
  { name: 'gh-proxy.org',     url: 'https://gh-proxy.org/' },
  { name: 'gh-proxy v4',      url: 'https://v4.gh-proxy.org/' },
  { name: 'gh-proxy cdn',     url: 'https://cdn.gh-proxy.org/' },
  { name: 'ghproxy.net',      url: 'https://ghproxy.net/' },
  { name: 'ghfast.top',       url: 'https://ghfast.top/' },
  { name: 'gh-proxy.com',     url: 'https://gh-proxy.com/' },
  { name: 'ghps.cc',          url: 'https://ghps.cc/' },
];

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

/** 并发测全部镜像,返回 [{name,url,ms}]。 */
export async function testProxies() {
  return Promise.all(PROXIES.map(async (p) => ({ ...p, ms: await ping(p.url) })));
}
