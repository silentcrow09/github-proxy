// src/rewrite.js
// 纯函数：判断 URL 是否需要改写为加速地址，是则返回拼接后的 URL，否则 null。

const RELEASE_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/.+$/;
const CLONE_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/;
const GITHUB_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+/;

// 检测 URL 是否已被代理前缀改写（形如 https://代理域名/https://github.com/...）
const PROXIED_RE = /^https?:\/\/[^/]+\/https:\/\/github\.com\//;

/**
 * @param {string} url    原始绝对 URL
 * @param {string} prefix 代理前缀，如 "https://gh-proxy.org/"
 * @param {object} [opts]  可选参数
 * @param {boolean} [opts.enhanced=false]  增强模式：匹配所有 github.com 仓库链接
 * @returns {string|null} 加速 URL；不该改写返回 null
 */
export function rewrite(url, prefix, opts = {}) {
  if (typeof url !== 'string' || typeof prefix !== 'string') return null;
  if (prefix === '') return null;
  if (!/^https:\/\//.test(url)) return null;
  if (url.startsWith(prefix)) return null;          // 幂等：同一前缀不重复拼接
  if (PROXIED_RE.test(url)) return null;            // 幂等：已被任意代理改写不再拼接
  if (opts.enhanced) {
    if (GITHUB_RE.test(url)) return prefix + url;
  } else {
    if (RELEASE_RE.test(url) || CLONE_RE.test(url)) return prefix + url;
  }
  return null;
}
