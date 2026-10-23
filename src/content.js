// src/content.js
// 在 github.com 上扫描 Release 下载链接与 clone 输入框，原地改写为加速地址。
//
// 两条硬约束（tests/content-guard.test.mjs 会守住）：
//   1) 不做动态 import，不加载任何扩展内模块。
//      rewrite() 由 src/rewrite.js 以经典脚本形式先加载（见 manifest 的 content_scripts.js），
//      挂在隔离世界的 globalThis.GHP_REWRITE 上。
//      改成经典脚本后，就不必把 src/*.js 放进 web_accessible_resources，
//      也就不会把扩展源码暴露给 github.com 上的任意页面。
//   2) 不直接读写 chrome.storage 的数据区。
//      配置（开关 / 当前镜像 / 增强模式）由 Service Worker 算好后用消息下发，
//      content script 只发一条 ghp:get-config 消息。

(() => {
  const { rewrite } = globalThis.GHP_REWRITE || {};
  let proxyPrefix = null;   // 当前生效的代理前缀
  let enhanced = false;     // 增强模式：改写所有 github.com 仓库链接
  let scheduled = false;

  // 保存原始 URL 的 WeakMap，用于禁用加速或切换镜像时还原。
  // 值形如 { orig, applied }：orig 是 GitHub 原始地址，applied 是我们写进去的加速地址。
  // 记录 applied 是为了识别"元素被外部改过"——此时 orig 需要更新，否则还原会还原成旧地址。
  const originalUrls = new WeakMap();

  // 本轮由我们自己写入的元素：MutationObserver 回调里据此忽略"自己触发的变更"，
  // 避免每次改写都多扫一遍全页。
  let selfTouched = new WeakSet();

  // 增强模式下不加速的导航性容器（页头/页脚/面包屑/仓库页签等）。
  // 这些链接属于站内导航，走了代理会拖慢页面并破坏 SPA 语义。
  const NAV_SELECTOR = [
    'header', 'footer', 'nav', '[role="navigation"]',
    '[aria-label*="Breadcrumb"]', '.breadcrumb',
    '.UnderlineNav', '.UnderlineNav-body', '.js-repo-nav',
    '#repository-container-header', '.pagehead-actions',
  ].join(',');

  const MARKER_CSS = `
a[data-ghp-accelerated="1"]::after {
  content: "";
  display: inline-block;
  width: 5px; height: 5px;
  margin-left: 4px;
  vertical-align: middle;
  border-radius: 50%;
  background: #1a7f37;
  opacity: .8;
}
`;

  /** 注入"已加速"小圆点样式。 */
  function injectMarkerStyle() {
    if (document.getElementById('ghp-marker-style')) return;
    const style = document.createElement('style');
    style.id = 'ghp-marker-style';
    style.textContent = MARKER_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /** 该元素是否是站内导航（增强模式下跳过）。 */
  function isNavigational(el) {
    try { return !!el.closest(NAV_SELECTOR); } catch { return false; }
  }

  /**
   * clone 相关字段的读写方式。
   * input 用 value；[data-clipboard-copy-text] 用该属性；
   * <clipboard-copy value="…"> 是 GitHub 复制按钮真正读取的内容，一并处理。
   */
  function fieldAccessor(el) {
    if (el.tagName === 'INPUT') {
      return { get: () => el.value, set: (v) => { el.value = v; } };
    }
    if (el.hasAttribute('data-clipboard-copy-text')) {
      return { get: () => el.getAttribute('data-clipboard-copy-text'), set: (v) => el.setAttribute('data-clipboard-copy-text', v) };
    }
    if (el.tagName === 'CLIPBOARD-COPY' && el.hasAttribute('value')) {
      return { get: () => el.getAttribute('value'), set: (v) => el.setAttribute('value', v) };
    }
    return null;
  }

  const FIELD_SELECTOR = 'input, [data-clipboard-copy-text], clipboard-copy[value]';

  /**
   * 记录原始值并写回加速值。
   * 若元素此前被我们改写过、但当前值不等于我们写进去的值，说明 GitHub 换了新地址，
   * 这时要把 orig 更新成新值，否则禁用加速后会还原成过期链接。
   */
  function applyRewrite(el, cur, next, setter) {
    const rec = originalUrls.get(el);
    if (!rec || rec.applied !== cur) {
      originalUrls.set(el, { orig: cur, applied: next });
    }
    selfTouched.add(el);
    setter(next);
  }

  /** 全量扫描并改写当前页面。 */
  function process() {
    if (!proxyPrefix || typeof rewrite !== 'function') return;

    for (const a of document.querySelectorAll('a[href]')) {
      const cur = a.href;                       // 绝对 URL
      if (enhanced && isNavigational(a)) continue;
      const next = rewrite(cur, proxyPrefix, { enhanced });
      if (next && cur !== next) {
        applyRewrite(a, cur, next, (v) => { a.href = v; });
        a.setAttribute('data-ghp-accelerated', '1');
        selfTouched.add(a);
      }
    }

    for (const el of document.querySelectorAll(FIELD_SELECTOR)) {
      const acc = fieldAccessor(el);
      if (!acc) continue;
      const cur = acc.get();
      if (typeof cur !== 'string') continue;
      const next = rewrite(cur, proxyPrefix, { enhanced });
      if (next && cur !== next) {
        applyRewrite(el, cur, next, acc.set);
      }
    }
  }

  /** 还原所有已改写元素为原始 URL。 */
  function restoreAll() {
    for (const a of document.querySelectorAll('a[href]')) {
      const rec = originalUrls.get(a);
      if (rec === undefined) continue;
      a.href = rec.orig;
      a.removeAttribute('data-ghp-accelerated');
      originalUrls.delete(a);
      selfTouched.add(a);
    }
    for (const el of document.querySelectorAll(FIELD_SELECTOR)) {
      const rec = originalUrls.get(el);
      if (rec === undefined) continue;
      const acc = fieldAccessor(el);
      if (acc) acc.set(rec.orig);
      originalUrls.delete(el);
      selfTouched.add(el);
    }
  }

  /** debounce：合并高频 DOM 变更。 */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; process(); }, 200);
  }

  /**
   * 向 Service Worker 要当前配置。
   * Service Worker 那边已经把"生效前缀"的兜底逻辑（同步过来的前缀不在本机镜像清单里时
   * 回退到清单首项）算好了，这里拿到的就是最终生效值。
   * @returns {Promise<{enabled:boolean, enhanced:boolean, proxyPrefix:string|null}|null>}
   */
  function requestConfig() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        chrome.runtime.sendMessage({ type: 'ghp:get-config' }, (res) => {
          // 必须在回调里读 lastError，否则控制台会刷 "Unchecked runtime.lastError"
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn('[github-proxy] 取配置失败:', err.message);
            done(null);
            return;
          }
          done(res || null);
        });
      } catch (err) {
        console.warn('[github-proxy] 取配置失败:', err);
        done(null);
      }
    });
  }

  /** 用下发的配置重算生效状态，并按需还原 / 重写页面。 */
  async function applyConfig() {
    const cfg = await requestConfig();
    if (!cfg) return;

    const wasEnabled = proxyPrefix !== null;
    proxyPrefix = cfg.enabled ? (cfg.proxyPrefix || null) : null;
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

  (async () => {
    try {
      if (typeof rewrite !== 'function') {
        console.error('[github-proxy] 未加载到 rewrite 模块，检查 manifest 的 content_scripts.js 顺序');
        return;
      }

      injectMarkerStyle();

      await applyConfig();                                     // 首次全量
      new MutationObserver((records) => {
        // 忽略"我们自己写出来的"变更：只处理目标不在 selfTouched 里的记录
        const relevant = records.filter((r) => {
          const t = r.target;
          if (!t || typeof t.nodeType !== 'number' || t.nodeType !== 1) return true;
          return !selfTouched.has(t);
        });
        selfTouched = new WeakSet();
        if (relevant.length === 0) return;
        schedule();
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'value', 'data-clipboard-copy-text'],
      });

      // popup / 设置页改配置后实时生效（镜像切换/增强模式/开关/清单变更），免刷新。
      // 这里只监听变更事件、不读数据区：具体值仍由 Service Worker 计算后下发。
      // sync 区放开关与当前镜像，local 区放镜像清单。
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' && area !== 'local') return;
        if (!changes.enabled && !changes.proxyPrefix && !changes.enhanced && !changes.proxies) return;
        applyConfig();
      });
    } catch (err) {
      console.error('[github-proxy] init failed', err);
    }
  })();
})();
