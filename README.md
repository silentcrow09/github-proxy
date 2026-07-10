# GitHub 加速链接

Chrome MV3 扩展：访问 `github.com` 时，自动把 **Release 资源下载地址** 和 **HTTPS `.git` clone 地址** 原地改写为国内加速地址（在原链接前拼接代理镜像前缀），实现无感加速下载 / 克隆。

## 功能

- **原地替换**：Release 下载链接、clone 输入框地址直接变成加速地址，复制即用
- **内置 7 个镜像 + 测速**：popup 里 radio 列表，每项显示延迟 `ms`，默认勾选当前网络最快的那个
- **实时切换**：在 popup 改镜像后，已打开的 GitHub 标签无需刷新即生效
- **严格范围**：只改 Release 资源 + `.git` clone，不碰页面导航链接（不影响正常浏览）
- **幂等**：重复触发不会 `gh-proxy.org/gh-proxy.org/...`
- **零额外权限**：测速用 `fetch(no-cors)` 计时，仅需 `storage` + `github.com` 主机权限

## 安装

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录
4. 访问任意 GitHub Release 页或仓库「Code」面板即可看到效果
5. 点扩展图标打开 popup，测速并选择镜像

## 内置镜像

| 名称 | 地址 |
|---|---|
| gh-proxy.org | `https://gh-proxy.org/` |
| gh-proxy v4 | `https://v4.gh-proxy.org/` |
| gh-proxy cdn | `https://cdn.gh-proxy.org/` |
| ghproxy.net | `https://ghproxy.net/` |
| ghfast.top | `https://ghfast.top/` |
| gh-proxy.com | `https://gh-proxy.com/` |
| ghps.cc | `https://ghps.cc/` |

镜像站点变化频繁，失效的会显示「超时」，换一个即可。要增删镜像，编辑 `src/config.js` 的 `PROXIES` 常量（`{ name, url }`，url 须为 `https://` 且以 `/` 结尾）。

## 改写规则

| 对象 | 匹配 | 示例 |
|---|---|---|
| Release 资源 | `github.com/{owner}/{repo}/releases/download/...` | `https://gh-proxy.org/https://github.com/u/r/releases/download/v1/a.zip` |
| HTTPS clone | `github.com/{owner}/{repo}.git` | `https://gh-proxy.org/https://github.com/u/r.git` |

**不改写**：仓库主页 / 文件浏览 / Issue / PR 等导航链接、Download ZIP、`raw.githubusercontent.com`、gist、SSH clone。

## 项目结构

```
manifest.json          MV3 配置（content script + web_accessible_resources）
src/rewrite.js         纯函数 rewrite(url, prefix) → 加速 URL | null
src/config.js          DEFAULTS / normalizePrefix / getConfig / PROXIES / ping / testProxies
src/content.js         DOM 扫描 + MutationObserver，动态 import 上面两个 ESM
popup.html / popup.js  镜像 radio 列表 + 测速 UI
tests/                 node:test 单测（rewrite + config）
```

## 开发

```bash
# 跑测试（git-bash 上请用显式文件路径，避免目录被当成模块）
node --test tests/rewrite.test.mjs tests/config.test.mjs
```

改完代码后到 `chrome://extensions` 点扩展卡片上的「重新加载」即可生效。

## 技术说明

- `rewrite.js` / `config.js` 是 ESM；MV3 content script 不支持静态 `import`，故 `content.js` 用 `chrome.runtime.getURL()` + 动态 `import()` 引入它们（需在 `manifest.json` 的 `web_accessible_resources` 放行）。
- 这样纯逻辑能用 `node --test` 真实单测，又满足 MV3 限制。
- `rewrite(url, prefix)` 把前缀当参数传入，选路逻辑（当前：测速择优）与改写逻辑解耦，后续做故障切换不碰改写。

## 限制 / 后续

- 关闭「启用加速」后，已改写的链接需刷新页面才会还原（新链接不再改写）
- 单选模式（一次一个镜像生效）；多选故障切换、后台定时测速、raw/archive 改写均为后续
