// src/rewrite.js
// 纯函数：判断 URL 是否需要改写为加速地址，是则返回拼接后的 URL，否则 null。
//
// 加载方式（双模，避免 content script 依赖动态 import）：
//   - 浏览器：作为**经典脚本**列在 manifest 的 content_scripts.js 里（排在 content.js 之前），
//     在扩展的隔离世界里执行，函数挂到 globalThis.GHP_REWRITE；
//   - Node 测试：createRequire 引入，拿到具名导出 rewrite。
//
// 为什么不走 await import(chrome.runtime.getURL('src/rewrite.js'))：
//   那条路要求把本文件放进 web_accessible_resources，等于把扩展源码公开给
//   github.com 上的任意页面（任何脚本都能 fetch(chrome-extension://<id>/src/rewrite.js)）。
//   改成经典脚本后，这条暴露面直接消失。

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
function rewrite(url, prefix, opts = {}) {
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

// 经典脚本路径：浏览器 content script 直接从隔离世界的全局取
if (typeof globalThis !== 'undefined') {
  globalThis.GHP_REWRITE = { rewrite };
}

// Node 路径：createRequire 引入时暴露具名导出（浏览器里 module 不存在，不会触发）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rewrite };
}
