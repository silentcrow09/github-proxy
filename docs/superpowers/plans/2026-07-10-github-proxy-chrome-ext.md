# GitHub 加速链接 Chrome 扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 Chrome MV3 扩展，在 `github.com` 上原地改写 Release 资源下载链接与 HTTPS `.git` clone 地址为加速地址（拼接代理前缀）。

**Architecture:** content script + MutationObserver 改 DOM（不拦截网络请求）。纯函数 `rewrite(url, prefix)` 集中匹配规则，作为 ESM 被 content.js 动态 `import`（MV3 content script 不支持静态 import，但支持 `chrome.runtime.getURL` + 动态 import，文件需列入 `web_accessible_resources`）。

**Tech Stack:** Chrome Extension Manifest V3、原生 JS（ESM）、`chrome.storage.sync`、Node 内置 `node:test` 做单测。无构建工具、无第三方依赖。

## Global Constraints

（每个任务的需求都隐含包含本节）

- **Manifest V3**，无第三方依赖，无构建步骤。
- **改写范围（严格 v1）**：仅 `^https://github\.com/[^/]+/[^/]+/releases/download/.+$`（Release 资源）与 `^https://github\.com/[^/]+/[^/]+\.git$`（HTTPS clone，严格 `.git` 结尾）。
- **不改**：仓库主页/文件浏览/Issue/PR 等导航链接、Download ZIP、raw、gist、SSH clone（`git@github.com:...`）。
- **默认代理前缀**：`https://gh-proxy.org/`（popup 可改）。
- **幂等**：URL 已以 `prefix` 开头则不再拼接，避免 `gh-proxy.org/gh-proxy.org/...`。
- **权限最小化**：`permissions: ["storage"]`、`host_permissions: ["https://github.com/*"]`。
- **配置存储**：`chrome.storage.sync`，键 `enabled`（bool，默认 true）、`proxyPrefix`（string，默认 `https://gh-proxy.org/`，归一化为以 `/` 结尾）。
- **前缀参数化**：`rewrite(url, prefix)` 的 `prefix` 由调用方传入，为 v2 自动选路预留（v1 不实现选路）。
- **文件编码**：所有源文件 UTF-8、LF；git 提交信息用 conventional commits，无 attribution。

---

## File Structure

| 文件 | 责任 | 类型 |
|---|---|---|
| `src/rewrite.js` | 纯函数 `rewrite(url, prefix)`，所有匹配规则集中于此 | ESM，可被 node 测试与 content.js 动态 import |
| `src/config.js` | `DEFAULTS`、`normalizePrefix(p)`、`getConfig()`；封装 `chrome.storage` 读写 | ESM，被 content.js 动态 import、被 popup.js 静态 import |
| `src/content.js` | 扫描 DOM（Release `a[href]` + clone input/clipboard 属性）+ MutationObserver（debounce）；动态 import rewrite/config | 经典脚本（content script 入口，manifest `js` 引用） |
| `manifest.json` | MV3 配置；content script 匹配 `github.com`；`web_accessible_resources` 放行 rewrite.js/config.js | — |
| `popup.html` | 配置 UI（启用开关 + 前缀输入框） | 引用 `popup.js` 为 module |
| `popup.js` | 读写 `chrome.storage`；复用 config.js 的 `DEFAULTS`/`normalizePrefix` | ESM（extension page，可静态 import） |
| `tests/rewrite.test.mjs` | rewrite 纯函数单测 | ESM，`node --test` |
| `tests/config.test.mjs` | `normalizePrefix` 纯函数单测 | ESM，`node --test` |

> 图标（icons）v1 不做，Chrome 默认显示拼图图标，后续按需补。

---

## Task 1: rewrite.js 纯函数（TDD）

**Files:**
- Create: `src/rewrite.js`
- Test: `tests/rewrite.test.mjs`

**Interfaces:**
- Produces: `export function rewrite(url, prefix)` → `string | null`
  - `url: string`：原始绝对 URL
  - `prefix: string`：代理前缀（如 `"https://gh-proxy.org/"`）
  - 返回拼接后的加速 URL；不该改写返回 `null`

- [ ] **Step 1: 写失败测试**

创建 `tests/rewrite.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite } from '../src/rewrite.js';

const P = 'https://gh-proxy.org/';

test('改写 Release 资源下载链接', () => {
  assert.equal(
    rewrite('https://github.com/u/r/releases/download/v1.0/a.zip', P),
    'https://gh-proxy.org/https://github.com/u/r/releases/download/v1.0/a.zip'
  );
});

test('改写 .git clone 地址', () => {
  assert.equal(
    rewrite('https://github.com/u/r.git', P),
    'https://gh-proxy.org/https://github.com/u/r.git'
  );
});

test('不改仓库主页', () => {
  assert.equal(rewrite('https://github.com/u/r', P), null);
});

test('不改 Download ZIP (archive)', () => {
  assert.equal(rewrite('https://github.com/u/r/archive/refs/heads/main.zip', P), null);
});

test('不改 raw.githubusercontent', () => {
  assert.equal(rewrite('https://raw.githubusercontent.com/u/r/main/f.js', P), null);
});

test('不改 SSH clone', () => {
  assert.equal(rewrite('git@github.com:u/r.git', P), null);
});

test('幂等：已带前缀不再拼接', () => {
  assert.equal(rewrite('https://gh-proxy.org/https://github.com/u/r.git', P), null);
});

test('不改非 https / 非 github', () => {
  assert.equal(rewrite('http://github.com/u/r.git', P), null);
  assert.equal(rewrite('https://example.com/u/r.git', P), null);
});

test('prefix 非法时返回 null', () => {
  assert.equal(rewrite('https://github.com/u/r.git', ''), null);
  assert.equal(rewrite('https://github.com/u/r.git', null), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/rewrite.test.mjs`
Expected: FAIL（`Cannot find module '../src/rewrite.js'` 或 `rewrite is not a function`）

- [ ] **Step 3: 写最小实现**

创建 `src/rewrite.js`：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/rewrite.test.mjs`
Expected: PASS（全部 tests pass，`tests N pass`）

- [ ] **Step 5: 提交**

```bash
git add src/rewrite.js tests/rewrite.test.mjs
git commit -m "feat(rewrite): add pure URL rewrite function with tests"
```

---

## Task 2: config.js 存储封装（TDD 纯函数部分）

**Files:**
- Create: `src/config.js`
- Test: `tests/config.test.mjs`

**Interfaces:**
- Produces:
  - `export const DEFAULTS = { enabled: true, proxyPrefix: 'https://gh-proxy.org/' }`
  - `export function normalizePrefix(p)` → `string`（保证非空且以 `/` 结尾，否则回退 DEFAULTS）
  - `export async function getConfig()` → `{ enabled: boolean, proxyPrefix: string }`（依赖 `chrome.storage.sync`，不单测）
- Consumes: 无（Task 1 独立）

- [ ] **Step 1: 写失败测试（normalizePrefix）**

创建 `tests/config.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizePrefix } from '../src/config.js';

test('normalizePrefix: 已带斜杠保持不变', () => {
  assert.equal(normalizePrefix('https://gh-proxy.org/'), 'https://gh-proxy.org/');
});

test('normalizePrefix: 缺斜杠补上', () => {
  assert.equal(normalizePrefix('https://gh-proxy.org'), 'https://gh-proxy.org/');
});

test('normalizePrefix: 空串回退默认值', () => {
  assert.equal(normalizePrefix(''), DEFAULTS.proxyPrefix);
});

test('normalizePrefix: 非字符串回退默认值', () => {
  assert.equal(normalizePrefix(null), DEFAULTS.proxyPrefix);
  assert.equal(normalizePrefix(undefined), DEFAULTS.proxyPrefix);
});

test('normalizePrefix: 去除首尾空白', () => {
  assert.equal(normalizePrefix('  https://ghproxy.net/  '), 'https://ghproxy.net/');
});

test('DEFAULTS 默认值正确', () => {
  assert.deepEqual(DEFAULTS, { enabled: true, proxyPrefix: 'https://gh-proxy.org/' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/config.test.mjs`
Expected: FAIL（`Cannot find module '../src/config.js'`）

- [ ] **Step 3: 写最小实现**

创建 `src/config.js`：

```js
// src/config.js
// 配置默认值、前缀归一化、从 chrome.storage 读取配置。

export const DEFAULTS = { enabled: true, proxyPrefix: 'https://gh-proxy.org/' };

/** 归一化代理前缀：保证非空且以 '/' 结尾，否则回退 DEFAULTS.proxyPrefix。 */
export function normalizePrefix(p) {
  if (typeof p !== 'string') return DEFAULTS.proxyPrefix;
  const s = p.trim();
  if (s === '') return DEFAULTS.proxyPrefix;
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/config.test.mjs`
Expected: PASS

- [ ] **Step 5: 全量测试**

Run: `node --test tests/`
Expected: rewrite + config 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/config.js tests/config.test.mjs
git commit -m "feat(config): add storage config wrapper with normalizePrefix tests"
```

---

## Task 3: content.js DOM 扫描与 MutationObserver

**Files:**
- Create: `src/content.js`

**Interfaces:**
- Consumes（动态 import）:
  - `src/rewrite.js` → `{ rewrite }`
  - `src/config.js` → `{ getConfig }`
- Produces: 无导出（content script 入口，副作用运行）
- 测试：DOM 逻辑依赖 GitHub 实际页面，不做单测，靠 Task 6 手动验证。

- [ ] **Step 1: 写实现**

创建 `src/content.js`：

```js
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
```

> 说明：`input.value` 的程序化修改不会触发 `attributes` observer（value 是 property 非 attribute），但 clone 面板展开是 `childList` 新增节点，会被 `subtree/childList` 捕获后重新全量扫描，从而覆盖。

- [ ] **Step 2: 语法自检**

Run: `node --check src/content.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: 提交**

```bash
git add src/content.js
git commit -m "feat(content): add DOM scanner + MutationObserver bootstrap"
```

---

## Task 4: manifest.json 装配扩展

**Files:**
- Create: `manifest.json`

**Interfaces:**
- 引用 `src/content.js`（content script 入口）
- 将 `src/rewrite.js`、`src/config.js` 列入 `web_accessible_resources`（供 content.js 动态 import）

- [ ] **Step 1: 写实现**

创建 `manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "GitHub 加速链接",
  "version": "0.1.0",
  "description": "在 github.com 上自动把 Release 下载地址与 clone 地址改写为加速地址。",
  "permissions": ["storage"],
  "host_permissions": ["https://github.com/*"],
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    {
      "matches": ["https://github.com/*"],
      "js": ["src/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/rewrite.js", "src/config.js"],
      "matches": ["https://github.com/*"]
    }
  ]
}
```

- [ ] **Step 2: JSON 合法性自检**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: 输出 `manifest OK`

- [ ] **Step 3: 提交**

```bash
git add manifest.json
git commit -m "feat(manifest): wire MV3 manifest with content script and WAR"
```

---

## Task 5: popup 配置 UI

**Files:**
- Create: `popup.html`
- Create: `popup.js`

**Interfaces:**
- Consumes（静态 import）: `src/config.js` → `DEFAULTS`, `normalizePrefix`
- 读写 `chrome.storage.sync`

- [ ] **Step 1: 写 popup.html**

创建 `popup.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>GitHub 加速链接</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 12px; min-width: 280px; }
    label { display: block; margin: 8px 0 4px; }
    input[type="text"] { width: 100%; box-sizing: border-box; padding: 4px; }
    #saved { color: #1a7f37; font-size: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <label><input type="checkbox" id="enabled"> 启用加速</label>
  <label for="prefix">代理前缀</label>
  <input type="text" id="prefix" placeholder="https://gh-proxy.org/">
  <p id="saved" hidden>已保存</p>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 popup.js**

创建 `popup.js`：

```js
// popup.js
// 配置 UI：读写 chrome.storage.sync。复用 config.js 的 DEFAULTS 与 normalizePrefix。
import { DEFAULTS, normalizePrefix } from './src/config.js';

const enabledEl = document.getElementById('enabled');
const prefixEl = document.getElementById('prefix');
const savedEl = document.getElementById('saved');

(async () => {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  enabledEl.checked = cfg.enabled === true;
  prefixEl.value = cfg.proxyPrefix;
})();

function save() {
  chrome.storage.sync.set({
    enabled: enabledEl.checked,
    proxyPrefix: normalizePrefix(prefixEl.value),
  });
  savedEl.hidden = false;
  setTimeout(() => { savedEl.hidden = true; }, 1000);
}

enabledEl.addEventListener('change', save);
prefixEl.addEventListener('change', save);
```

- [ ] **Step 3: 语法自检**

Run: `node --check popup.js`
Expected: 无输出（语法正确）

- [ ] **Step 4: 提交**

```bash
git add popup.html popup.js
git commit -m "feat(popup): add enable toggle + proxy prefix editor"
```

---

## Task 6: 加载扩展并手动端到端验证

**Files:** 无（验证步骤）

> 因 content script 的 DOM 逻辑依赖 GitHub 实际页面结构，本任务为人工验证。GitHub 的 clone 面板 DOM 可能随版本变化，若选择器失效需回到 Task 3 调整 `rewriteCloneInputs` 选择器（增加新选择器即可，`rewrite` 规则会兜底防误伤）。

- [ ] **Step 1: 加载未打包扩展**

1. Chrome 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选 `D:\Projects\github-proxy` 目录
4. 确认扩展出现且无报错（若有错误会在卡片上显示红色「错误」按钮，点击查看 console）

- [ ] **Step 2: 验证 Release 资源改写**

1. 访问任一有 Release 的仓库，如 `https://github.com/cli/cli/releases`
2. 打开浏览器 DevTools → Console，确认无 `[github-proxy] init failed` 报错
3. 鼠标悬停某 Release 资源下载链接（如 `.zip` / `.exe`），确认浏览器左下角状态栏/右键复制链接得到的地址为 `https://gh-proxy.org/https://github.com/.../releases/download/...`
4. 在 DevTools Elements 面板找该 `<a>`，确认 `href` 已带前缀

- [ ] **Step 3: 验证 clone 地址改写**

1. 访问任一仓库主页，如 `https://github.com/cli/cli`
2. 点击绿色「<> Code」按钮展开 clone 面板
3. 确认 HTTPS clone 输入框显示的地址为 `https://gh-proxy.org/https://github.com/cli/cli.git`
4. 点输入框旁的复制按钮，粘贴确认得到加速地址
5. 在 Elements 面板确认 `data-clipboard-copy-text`（如存在）已带前缀

- [ ] **Step 4: 验证导航链接未被破坏**

1. 在仓库列表/主页正常点击仓库名、文件、Issue 等链接
2. 确认能正常跳转，未被重定向到 `gh-proxy.org`（导航链接不应被改写）

- [ ] **Step 5: 验证 popup 配置**

1. 点扩展图标，弹出 popup
2. 关闭「启用加速」→ 刷新 GitHub 页面 → 确认链接恢复原样（未被改写）
3. 重新开启；把代理前缀改为 `https://ghproxy.net/` → 刷新 → 确认链接前缀变为新值
4. 改回 `https://gh-proxy.org/`

- [ ] **Step 6: 验证幂等**

1. 在已改写的 Release 页面多次切换/刷新
2. DevTools 检查任一改写后的 `<a href>`，确认前缀只出现一次（无 `gh-proxy.org/https://gh-proxy.org/...`）

- [ ] **Step 7: 记录验证结果**

如有 DOM 选择器调整，回到 Task 3 修改并重新提交；全部通过后在仓库根 `README.md` 记一句「已验证」（可选）。

---

## Self-Review

**1. Spec coverage:**
- 第 2 节范围（Release 资源 + .git clone）→ Task 1（rewrite 规则）+ Task 3（DOM 改写两类）
- 第 5 节模块划分（rewrite/config/content/manifest/popup/tests）→ Task 1–5 一一对应
- 第 6 节 rewrite 契约（5 条短路规则）→ Task 1 实现 + 9 个测试覆盖
- 第 7 节 DOM 策略（a[href]、input、clipboard 属性、MutationObserver+debounce）→ Task 3
- 第 8 节配置与 popup → Task 2（config）+ Task 5（popup）
- 第 9 节权限（storage + host github.com + WAR）→ Task 4
- 第 10 节测试矩阵 → Task 1 测试逐条对应
- 第 11 节风险对策（幂等、SPA observer、选择器兜底、严格正则）→ Task 1/3 实现内化
- 全部覆盖，无遗漏。

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码；每步含运行命令与期望输出。✓

**3. Type/签名一致性:**
- `rewrite(url, prefix)` —— Task 1 定义，Task 3 调用签名一致（`rewrite(cur, proxyPrefix)`、`rewrite(el.value, proxyPrefix)`）✓
- `getConfig()` —— Task 2 定义返回 `{enabled, proxyPrefix}`，Task 3 解构一致 ✓
- `DEFAULTS` / `normalizePrefix` —— Task 2 定义，Task 5 popup 解构一致 ✓
- 动态 import 路径 `base + 'rewrite.js'`、`base + 'config.js'` 与 manifest `web_accessible_resources` 条目一致 ✓
