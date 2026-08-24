// src/content.js
// 在 github.com 上扫描 Release 下载链接与 clone 输入框，原地改写为加速地址。
// 纯逻辑（rewrite/config）作为 ESM 动态 import（MV3 content script 不支持静态 import）。

(() => {
  let rewrite = null;       // (url, prefix) => string | null
  let proxyPrefix = null;   // 当前生效的代理前缀
  let enhanced = false;     // 增强模式：改写所有 github.com 仓库链接
  let scheduled = false;

  // 保存原始 URL 的 WeakMap，用于禁用加速或切换镜像时还原
  const originalUrls = new WeakMap();

  /** 全量扫描并改写当前页面。 */
  function process() {
    if (!proxyPrefix) return;
    rewriteReleaseLinks();
    rewriteCloneInputs();
  }

  /** 还原所有已改写元素为原始 URL。 */
  function restoreAll() {
    for (const a of document.querySelectorAll('a[href]')) {
      const orig = originalUrls.get(a);
      if (orig !== undefined) {
        a.href = orig;
        originalUrls.delete(a);
      }
    }
    for (const el of document.querySelectorAll('input')) {
      const orig = originalUrls.get(el);
      if (orig !== undefined) {
        el.value = orig;
        originalUrls.delete(el);
      }
    }
    for (const el of document.querySelectorAll('[data-clipboard-copy-text]')) {
      const orig = originalUrls.get(el);
      if (orig !== undefined) {
        el.setAttribute('data-clipboard-copy-text', orig);
        originalUrls.delete(el);
      }
    }
  }

  /** Release 资源：<a href> 命中规则则改写绝对 URL。 */
  function rewriteReleaseLinks() {
    for (const a of document.querySelectorAll('a[href]')) {
      const cur = a.href;                       // 绝对 URL
      const next = rewrite(cur, proxyPrefix, { enhanced });
      if (next && cur !== next) {
        if (!originalUrls.has(a)) originalUrls.set(a, cur);
        a.href = next;
      }
    }
  }

  /** clone 地址：改写 input.value 与 data-clipboard-copy-text 属性。 */
  function rewriteCloneInputs() {
    applyRewrite(
      'input',
      (el) => el.value,
      (el, v) => { el.value = v; },
    );
    applyRewrite(
      '[data-clipboard-copy-text]',
      (el) => el.getAttribute('data-clipboard-copy-text'),
      (el, v) => { el.setAttribute('data-clipboard-copy-text', v); },
    );
  }

  /** 通用改写：选择器 + 取值/设值策略。 */
  function applyRewrite(selector, getter, setter) {
    for (const el of document.querySelectorAll(selector)) {
      const cur = getter(el);
      const next = rewrite(cur, proxyPrefix, { enhanced });
      if (next && cur !== next) {
        if (!originalUrls.has(el)) originalUrls.set(el, cur);
        setter(el, next);
      }
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

      async function applyConfig() {
        const cfg = await getConfig();
        const wasEnabled = proxyPrefix !== null;
        proxyPrefix = cfg.enabled ? cfg.proxyPrefix : null;   // 禁用 → 停止改写
        enhanced = cfg.enhanced === true;
        if (!proxyPrefix) {
          // 禁用加速：还原所有已改写链接
          if (wasEnabled) restoreAll();
        } else {
          // 切换镜像或启用加速：先还原再重新改写，避免前缀叠加
          restoreAll();
          process();
        }
      }

      await applyConfig();                                     // 首次全量
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'data-clipboard-copy-text'],
      });
      // popup 改配置后实时生效（镜像切换/增强模式/开关场景），免刷新
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (!changes.enabled && !changes.proxyPrefix && !changes.enhanced) return;
        applyConfig();
      });
    } catch (err) {
      console.error('[github-proxy] init failed', err);
    }
  })();
})();
