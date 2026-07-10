// src/content.js
// 在 github.com 上扫描 Release 下载链接与 clone 输入框，原地改写为加速地址。
// 纯逻辑（rewrite/config）作为 ESM 动态 import（MV3 content script 不支持静态 import）。

(() => {
  let rewrite = null;       // (url, prefix) => string | null
  let proxyPrefix = null;   // 当前生效的代理前缀
  let scheduled = false;

  /** 全量扫描并改写当前页面。 */
  function process() {
    if (!proxyPrefix) return;
    rewriteReleaseLinks();
    rewriteCloneInputs();
  }

  /** Release 资源：<a href> 命中规则则改写绝对 URL。 */
  function rewriteReleaseLinks() {
    for (const a of document.querySelectorAll('a[href]')) {
      const cur = a.href;                       // 绝对 URL
      const next = rewrite(cur, proxyPrefix);
      if (next && cur !== next) a.href = next;
    }
  }

  /** clone 地址：改写 input.value 与 data-clipboard-copy-text 属性。 */
  function rewriteCloneInputs() {
    for (const el of document.querySelectorAll('input')) {
      const cur = el.value;
      const next = rewrite(cur, proxyPrefix);
      if (next && cur !== next) el.value = next;
    }
    for (const el of document.querySelectorAll('[data-clipboard-copy-text]')) {
      const cur = el.getAttribute('data-clipboard-copy-text');
      const next = rewrite(cur, proxyPrefix);
      if (next && cur !== next) el.setAttribute('data-clipboard-copy-text', next);
    }
  }

  /** debounce：合并高频 DOM 变更。 */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; process(); }, 200);
  }

  (async () => {
    try {
      const base = chrome.runtime.getURL('src/');
      rewrite = (await import(base + 'rewrite.js')).rewrite;
      const { getConfig } = await import(base + 'config.js');
      const cfg = await getConfig();
      if (!cfg.enabled) return;                 // 禁用 → 完全不介入
      proxyPrefix = cfg.proxyPrefix;
      process();                                // 首次全量
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'data-clipboard-copy-text'],
      });
    } catch (err) {
      console.error('[github-proxy] init failed', err);
    }
  })();
})();
