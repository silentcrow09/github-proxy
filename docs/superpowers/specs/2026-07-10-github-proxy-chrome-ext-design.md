# GitHub 加速链接 Chrome 扩展 — 设计文档

- 日期：2026-07-10
- 状态：已确认，待实现
- 作者：协作设计（用户 + Claude）

## 1. 目标

做一个 Chrome MV3 扩展，当用户访问 `github.com` 时，**原地**把 Release 资源下载地址和 HTTPS clone（`.git`）地址自动改写为加速地址（在原始 URL 前拼接代理前缀），实现无感加速下载/克隆。

示例：

```
Release 资源：
  https://github.com/user/repo/releases/download/v1.0/app.zip
  → https://gh-proxy.org/https://github.com/user/repo/releases/download/v1.0/app.zip

clone：
  https://github.com/user/repo.git
  → https://gh-proxy.org/https://github.com/user/repo.git
```

## 2. 范围

### v1 改写对象（仅这两类）

| 对象 | 匹配 | 改写位置 |
|---|---|---|
| Release 资源下载 | `^https://github\.com/[^/]+/[^/]+/releases/download/.+` | `<a>` 的 `href` |
| HTTPS clone | `^https://github\.com/[^/]+/[^/]+\.git$`（严格 `.git` 结尾） | clone 输入框：`<input value>`、`data-clipboard-copy-text` 属性、URL 文本元素 |

### 不改写（v1 明确排除）

- 仓库主页 / 文件浏览 / Issue / PR 等页面导航链接
- Download ZIP（archive 类）
- `raw.githubusercontent.com`、gist
- SSH clone（`git@github.com:...`）
- 非加速服务器支持的任何其它资源

> 判断依据：以加速服务器能力为准。v1 保守，只做 Release 资源 + `.git` clone，后续按服务器支持情况扩展。

## 3. 非目标（后续扩展，不在本次范围）

- **多镜像自动选路**：`https://v4.gh-proxy.org/`、`https://cdn.gh-proxy.org/`、`https://ghproxy.net/` 等，按延迟/可用性自动选最优前缀。
- **扩展改写范围**：archive（Download ZIP）、raw、gist。
- **网络层拦截**：不通过 `declarativeNetRequest` 改请求（会破坏页面浏览）。

> 关于自动选路的可扩展性：核心函数 `rewrite(url, prefix)` 把代理前缀当**参数**传入。未来自动选路只需把"prefix 从哪来"从「读单个字符串」换成「从镜像列表里选最优」，**改写逻辑零改动**。因此 v1 不提前搭镜像列表（YAGNI），只存单个可编辑前缀。

## 4. 架构

content script + MutationObserver。原因：用户要"看到/复制的就是加速地址"，只能改 DOM，不能拦截网络请求（拦截会把浏览 GitHub 的页面也重定向到代理，导致打不开）。

```
访问 github.com
   │
content.js 注入
   ├─ 读配置（enabled / proxyPrefix）
   ├─ enabled=false → 什么都不做
   ├─ scanAndRewrite(document)        首次全量扫描改写
   └─ MutationObserver(subtree)
         └─ GitHub 是 SPA，切仓库/展开 Code 面板/翻 Releases
            时动态加载的新链接 → debounce 后重新 scanAndRewrite
```

## 5. 模块划分

| 文件 | 职责 | 依赖 |
|---|---|---|
| `manifest.json` | MV3 配置；content script 匹配 `https://github.com/*`；权限 `storage` + host `github.com` | — |
| `src/rewrite.js` | **纯函数** `rewrite(url, prefix)` → 返回加速 URL 或 `null`。所有匹配规则集中于此 | 无（可独立测试、可被 node 引入） |
| `src/config.js` | `chrome.storage` 读写封装：`getEnabled()`、`getProxyPrefix()` | chrome.storage |
| `src/content.js` | 扫描 DOM + MutationObserver，调用 `rewrite` 改写 href / 输入框值 | rewrite.js, config.js |
| `src/popup.html` + `src/popup.js` | 开关 + 代理前缀输入，写入 `chrome.storage` | chrome.storage |
| `tests/rewrite.test.mjs` | `rewrite` 纯函数单元测试（node `--test` 直跑） | rewrite.js |

## 6. rewrite 函数契约

```js
// src/rewrite.js
/**
 * @param {string} url    原始绝对 URL
 * @param {string} prefix 代理前缀，如 "https://gh-proxy.org/"
 * @returns {string|null} 加速 URL；不该改写则返回 null
 */
export function rewrite(url, prefix) { ... }
```

规则（按顺序短路）：

1. `url` 非字符串 / 非以 `https://` 开头 → `null`
2. 已以 `prefix` 开头（幂等）→ `null`
3. 命中 Release 资源正则 → `prefix + url`
4. 命中 `.git` clone 正则 → `prefix + url`
5. 否则 → `null`

## 7. DOM 改写策略

### Release 资源链接
- 遍历 `<a[href]>`，对每个 href 调 `rewrite`，非 null 则写回 `href`。

### clone 输入框（GitHub DOM 会变，用多选择器兜底）
- `<input>` 的 `value` 命中规则 → 改 `value`
- `[data-clipboard-copy-text]` 属性命中 → 改属性
- 显示 URL 文本的元素（如 `[role="textbox"]`、`clipboard-copy` 内文本）→ 改 `textContent`
- **二次确认**：每个候选值都先过 `rewrite` 判断，命中才改，避免误伤非 clone 的 input

### 性能与安全
- MutationObserver 观察 `subtree` + `childList` + `attributes`，加 debounce（~200ms），避免高频改写卡顿。
- 所有改写幂等：已带前缀的不重复拼接。

## 8. 配置与 popup

- 存储：`chrome.storage.sync`
- 键：
  - `enabled`：bool，默认 `true`
  - `proxyPrefix`：string，默认 `https://gh-proxy.org/`
- popup：
  - 一个开关（启用/禁用）
  - 一个前缀输入框
  - 改动即时或按钮保存（实现时定，倾向即时 `storage.sync.set`）
- content.js 启动读配置；`enabled === false` 时不注册任何改写。

## 9. Manifest V3 权限（最小化）

```json
{
  "permissions": ["storage"],
  "host_permissions": ["https://github.com/*"],
  "content_scripts": [{ "matches": ["https://github.com/*"], "js": ["src/content.js"] }]
}
```

## 10. 测试策略

`rewrite.js` 是纯函数 → node 单测（`node --test`），覆盖：

| 输入 | 期望 |
|---|---|
| `https://github.com/u/r/releases/download/v1/a.zip` | 改写 |
| `https://github.com/u/r.git` | 改写 |
| `https://github.com/u/r`（仓库主页） | `null` |
| `https://github.com/u/r/archive/refs/heads/main.zip`（Download ZIP） | `null` |
| `https://raw.githubusercontent.com/u/r/main/f` | `null` |
| `git@github.com:u/r.git`（SSH） | `null` |
| 已带 prefix 的 URL | `null`（幂等） |
| 非 github / 非 https | `null` |

DOM 改写部分依赖 GitHub 实际页面结构，靠手工验证 + 多选择器兜底。

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| GitHub SPA 动态加载漏改 | MutationObserver + debounce 兜底 |
| GitHub DOM 变更导致选择器失效 | 多选择器 + `rewrite` 规则二次确认 |
| 重复拼接前缀 | rewrite 幂等检查 |
| 误改页面导航链接 | 严格正则，只放行 Release 资源与 `.git` clone |
| 镜像不可用 | prefix 可在 popup 改；v2 自动选路 |
