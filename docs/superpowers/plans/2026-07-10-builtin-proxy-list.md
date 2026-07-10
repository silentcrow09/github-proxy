# 内置镜像列表 + 测速择优 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 把 popup 从"可编辑前缀输入框"改成"内置镜像列表 radio + 测速 ms + 默认选最优"。

**Architecture:** `config.js` 新增 `PROXIES` 常量 + `ping()` + `testProxies()`（no-cors fetch 计时，不加权限）。popup 打开时测速、渲染 radio 列表、自动选延迟最低、用户改选粘住。content.js **不变**（依旧读 `proxyPrefix`，靠已有 `storage.onChanged` 实时更新）。

**Tech Stack:** 同主项目 — MV3、原生 ESM、`node:test`。

## Global Constraints

- 内置 7 镜像（见下），用户**不能编辑地址**，只能从列表 radio 单选。
- 测速用 `fetch(url, { mode: 'no-cors', cache: 'no-store' })` + `AbortController` 5s 超时；**不新增任何权限**（不加 host_permissions）。
- 一次只一个镜像生效（存 `proxyPrefix`）。
- `!userSelected` 时默认选延迟最低；全挂回退 `PROXIES[0]`。用户手动选过后 `userSelected=true` 粘住。
- content.js 零改动。
- 无后台 service worker / 定时测速（YAGNI）。
- 提交 conventional commits，无 attribution。

## PROXIES（`config.js` 常量，逐字使用）

```js
export const PROXIES = [
  { name: 'gh-proxy.org',     url: 'https://gh-proxy.org/' },
  { name: 'gh-proxy v4',      url: 'https://v4.gh-proxy.org/' },
  { name: 'gh-proxy cdn',     url: 'https://cdn.gh-proxy.org/' },
  { name: 'ghproxy.net',      url: 'https://ghproxy.net/' },
  { name: 'ghfast.top',       url: 'https://ghfast.top/' },
  { name: 'gh-proxy.com',     url: 'https://gh-proxy.com/' },
  { name: 'ghps.cc',          url: 'https://ghps.cc/' },
];
```

---

## Task 1: config.js 增加 PROXIES + ping + testProxies（TDD 纯数据部分）

**Files:**
- Modify: `src/config.js`
- Modify: `tests/config.test.mjs`

**Interfaces:**
- Produces:
  - `export const PROXIES`：`Array<{ name: string, url: string }>`，7 项，url 均 `https://` 且以 `/` 结尾
  - `export async function ping(url, timeoutMs=5000)` → `number | null`（延迟 ms；超时/失败 null）
  - `export async function testProxies()` → `Promise<Array<{ name, url, ms }>>`（并发测全部）
- 已有导出 `DEFAULTS` / `normalizePrefix` / `getConfig` 保持不变。

- [ ] **Step 1: 写失败测试（PROXIES 形状）**

在 `tests/config.test.mjs` 顶部 import 补上 `PROXIES`，并追加：

```js
import { DEFAULTS, normalizePrefix, PROXIES } from '../src/config.js';

// ...existing tests...

test('PROXIES: 非空数组,每项 {name,url},url 为 https 且以 / 结尾', () => {
  assert.ok(Array.isArray(PROXIES), 'PROXIES 应为数组');
  assert.ok(PROXIES.length >= 7, '至少 7 个镜像');
  for (const p of PROXIES) {
    assert.equal(typeof p.name, 'string', `${JSON.stringify(p)} 应有 name`);
    assert.equal(typeof p.url, 'string', `${JSON.stringify(p)} 应有 url`);
    assert.ok(/^https:\/\//.test(p.url), `${p.url} 应为 https`);
    assert.ok(p.url.endsWith('/'), `${p.url} 应以 / 结尾`);
  }
});

test('PROXIES: url 不重复', () => {
  const urls = PROXIES.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, 'url 不应重复');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/config.test.mjs`
Expected: FAIL（`PROXIES is not defined` / 未导出）

- [ ] **Step 3: 在 `src/config.js` 追加实现**

在 `getConfig` 之后追加（保留已有 DEFAULTS/normalizePrefix/getConfig 不动）：

```js
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
```

> 注：`ping`/`testProxies` 依赖 `fetch`/`performance`（扩展环境与 node18+ 均有），不做单测（涉及网络）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: PASS（rewrite 9 + config 8 = 17，全部 pristine）

- [ ] **Step 5: 提交**

```bash
git add src/config.js tests/config.test.mjs
git commit -m "feat(config): add built-in PROXIES list + ping/testProxies"
```

---

## Task 2: popup 改为镜像列表 + 测速

**Files:**
- Modify: `popup.html`（替换：去 prefix 输入框,加 #proxies 列表容器 + #retest 按钮）
- Modify: `popup.js`（重写：渲染 radio、测速、自动选最优、粘住）

**Interfaces:**
- Consumes（静态 import）: `src/config.js` → `DEFAULTS`, `PROXIES`, `testProxies`
- 读写 `chrome.storage.sync`：`enabled`、`proxyPrefix`、`userSelected`

- [ ] **Step 1: 重写 `popup.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>GitHub 加速链接</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 12px; min-width: 300px; }
    .enable { display: block; font-weight: 600; margin-bottom: 8px; }
    #proxies { margin-bottom: 8px; }
    .proxy { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
    .ms { color: #57606a; font-size: 12px; min-width: 64px; text-align: right; }
    .ms.timeout { color: #cf222e; }
    #retest { width: 100%; padding: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <label class="enable"><input type="checkbox" id="enabled"> 启用加速</label>
  <div id="proxies"></div>
  <button id="retest">重新测速</button>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 重写 `popup.js`**

```js
// popup.js
// 内置镜像列表 radio + 测速。复用 config.js 的 DEFAULTS/PROXIES/testProxies。
import { DEFAULTS, PROXIES, testProxies } from './src/config.js';

const enabledEl = document.getElementById('enabled');
const listEl = document.getElementById('proxies');
const retestEl = document.getElementById('retest');

const latencies = {};   // url -> ms | null

(async () => {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  enabledEl.checked = cfg.enabled === true;
  await measureAndRender(cfg.proxyPrefix, !cfg.userSelected);
})();

async function measureAndRender(selectedUrl, autoSelect) {
  render(PROXIES, selectedUrl, true);                 // 先显示"测速中"
  const tested = await testProxies();
  for (const t of tested) latencies[t.url] = t.ms;
  const next = autoSelect ? pickBest(tested) : selectedUrl;
  render(PROXIES, next, false);
  if (autoSelect && next && next !== selectedUrl) {
    await chrome.storage.sync.set({ proxyPrefix: next });   // 落地默认最优(不设 userSelected)
  }
}

/** 延迟最低的活镜像；全挂回退 PROXIES[0]。 */
function pickBest(tested) {
  const alive = tested.filter((t) => t.ms != null);
  if (alive.length === 0) return PROXIES[0].url;
  return alive.reduce((a, b) => (a.ms <= b.ms ? a : b)).url;
}

function render(list, selectedUrl, testing) {
  listEl.innerHTML = list.map((p) => {
    const ms = latencies[p.url];
    let label, cls = 'ms';
    if (testing && ms === undefined) label = '测速中…';
    else if (ms == null) { label = '超时'; cls = 'ms timeout'; }
    else label = `${ms}ms`;
    const checked = p.url === selectedUrl ? 'checked' : '';
    return `<label class="proxy"><span><input type="radio" name="proxy" value="${p.url}" ${checked}> ${p.name}</span><span class="${cls}">${label}</span></label>`;
  }).join('');
  for (const r of listEl.querySelectorAll('input[name="proxy"]')) {
    r.addEventListener('change', () => select(r.value));
  }
}

async function select(url) {
  await chrome.storage.sync.set({ proxyPrefix: url, userSelected: true });   // 粘住
}

enabledEl.addEventListener('change', () =>
  chrome.storage.sync.set({ enabled: enabledEl.checked })
);
retestEl.addEventListener('click', async () => {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  await measureAndRender(cfg.proxyPrefix, !cfg.userSelected);
});
```

- [ ] **Step 3: 语法自检**

Run: `node --check popup.js`
Expected: 无输出

- [ ] **Step 4: 全量测试（确保没碰坏 config 单测）**

Run: `node --test tests/`
Expected: 17/17 PASS

- [ ] **Step 5: 提交**

```bash
git add popup.html popup.js
git commit -m "feat(popup): built-in proxy radio list + latency test + auto best"
```

---

## Task 3: 加载扩展并手动验证（用户）

- [ ] 1. `chrome://extensions` → 对已加载扩展点「重新加载」
- [ ] 2. 点扩展图标 → popup 显示 7 个镜像 radio，每项后面有 `xxx ms` 或 `超时` 或 `测速中…`
- [ ] 3. 默认勾选项是延迟最低的那个（手动核对）
- [ ] 4. 手动点选另一个镜像 → 关 popup → 打开任一 GitHub Release/仓库页 → 链接前缀已是新选的镜像
- [ ] 5. 打开 GitHub 标签的同时,在 popup 改选镜像 → **不刷新**,标签里链接前缀实时变（storage.onChanged 生效）
- [ ] 6. 点「重新测速」→ ms 刷新；如未手动改过,默认项可能随测速结果切换到新的最低
- [ ] 7. 开关「启用加速」仍正常（关→刷新→链接还原）

---

## Self-Review

- Spec 第 8 节（内置镜像+测速+单选+粘住）→ Task 1（PROXIES/ping/testProxies）+ Task 2（popup）
- PROXIES 7 项与用户确认清单一致；ping 用 no-cors 不加权限；单选 radio；auto-select + sticky；content.js 不变 → 全覆盖
- 无占位符；代码完整；命令与期望输出齐全
- 类型一致：`testProxies()` 返回 `[{name,url,ms}]`，Task 2 解构 `tested` 使用 `t.ms`/`t.url` 一致；`ping`/`testProxies` 在 config.js 定义,popup import 名一致
