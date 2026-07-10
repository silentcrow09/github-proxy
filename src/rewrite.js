// src/rewrite.js
// 纯函数：判断 URL 是否需要改写为加速地址，是则返回拼接后的 URL，否则 null。

const RELEASE_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/.+$/;
const CLONE_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/;

/**
 * @param {string} url    原始绝对 URL
 * @param {string} prefix 代理前缀，如 "https://gh-proxy.org/"
 * @returns {string|null} 加速 URL；不该改写返回 null
 */
export function rewrite(url, prefix) {
  if (typeof url !== 'string' || typeof prefix !== 'string') return null;
  if (prefix === '') return null;
  if (!/^https:\/\//.test(url)) return null;
  if (url.startsWith(prefix)) return null;          // 幂等
  if (RELEASE_RE.test(url) || CLONE_RE.test(url)) return prefix + url;
  return null;
}
