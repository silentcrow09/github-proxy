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
