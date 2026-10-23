# GitHub 加速链接

Chrome MV3 扩展：访问 `github.com` 时，自动把 **Release 资源下载地址** 和 **HTTPS `.git` clone 地址** 原地改写为国内加速地址（在原链接前拼接代理镜像前缀），实现无感加速下载 / 克隆。

## 功能

- **原地替换**：Release 下载链接、clone 输入框地址直接变成加速地址，复制即用
- **真实代理测速**：探测请求真的经镜像拉一个 GitHub 资源，而不是测镜像首页——首页快不代表能代理下载
- **镜像管理**：设置页可对**所有镜像（含内置项）**添加 / 修改 / 删除，一键「恢复默认镜像」
- **实时切换**：改镜像后，已打开的 GitHub 标签无需刷新即生效
- **严格范围**：默认只改 Release 资源 + `.git` clone，不碰页面导航链接
- **增强模式**：开启后改写页面中所有 GitHub 仓库链接（自动跳过页头/页脚/面包屑等导航区）
- **可见状态**：被改写的链接带绿色小圆点；popup 顶部常驻「当前生效镜像 + 延迟」状态条；**工具栏图标按状态换色**——绿=运行中、红=镜像连续失败、灰=已停用（镜像名与延迟在图标 tooltip 上）
- **故障切换**：后台每 5 分钟体检当前镜像，连续失败 2 次自动切到次优镜像
- **幂等**：重复触发不会 `gh-proxy.org/gh-proxy.org/...`，切换镜像时自动还原旧链接再改写

## 安装

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录
4. 访问任意 GitHub Release 页或仓库「Code」面板即可看到效果
5. 点扩展图标打开 popup，查看测速结果并选择镜像

## 内置镜像（默认）

| 名称 | 地址 |
|---|---|
| gh-proxy.org | `https://gh-proxy.org/` |
| gh-proxy v4 | `https://v4.gh-proxy.org/` |
| gh-proxy cdn | `https://cdn.gh-proxy.org/` |
| ghproxy.net | `https://ghproxy.net/` |
| ghfast.top | `https://ghfast.top/` |
| gh-proxy.com | `https://gh-proxy.com/` |
| ghps.cc | `https://ghps.cc/` |

镜像站点变化频繁，失效的会显示「超时」或「失效」，换一个即可。

### 管理镜像（含内置项）

点 popup 底部「管理加速地址」，或到 `chrome://extensions` → 本扩展 → 「详细信息」→「扩展程序选项」打开设置页：

- **添加**：在「添加镜像」表单填入名称（可选）和地址（`http(s)://` 开头），自动补尾斜杠、按地址去重
- **修改 / 删除**：列表中每项均可行内编辑或删除，**内置项同样可改可删**（但至少保留一个）
- **使用中**：当前生效的镜像在列表里有「使用中」徽标
- **验证**：点「验证」会请求该镜像域名的访问权限，然后真实拉一次下载，确认它到底能不能代理——这是唯一能区分「镜像活着」和「镜像代理不出东西」的办法
- **恢复默认镜像**：点列表标题旁的按钮，用内置默认列表覆盖当前全部镜像
- **实时同步**：改动经 `chrome.storage` 广播，popup 与已打开的 GitHub 页面无需刷新即生效

> 首次安装时，内置 7 个镜像作为种子写入 `chrome.storage`，之后它们与用户添加的镜像一视同仁，全部可编辑。改 `src/config.js` 的 `PROXIES` 常量只会影响「默认值 / 恢复默认」的来源，不会直接覆盖已存储列表。

## 测速口径

探测请求打在 **`prefix + 一个真实的 GitHub 资源`** 上（`octocat/Hello-World` 的源码归档，258 字节，仓库与分支永久存在），而不是镜像首页。

这样测出来的延迟才等于用户实际下载的耗时。结论分四档：

| 结论 | 含义 |
|---|---|
| **已验证** | 读到 HTTP 200 且响应体非空——确认能真正代理下载 |
| **未验证** | 镜像可达，但没权限读响应体，无法校验内容 |
| **失效** | 读到非 200（例如 404）——文件根本代理不出来 |
| **超时** | 连不上 |

**能不能读响应体，取决于该域名有没有主机权限：**

- **内置镜像**：已在 `manifest.json` 的 `host_permissions` 里声明 → 请求被浏览器放行、不走 CORS 检查 → 既能读状态码，**控制台也不会出现 `blocked by CORS policy` 的报错**。
- **自定义镜像**：默认只有 `no-cors` 权限，只能确认"可达"（显示「未验证」）。到设置页点该镜像的「**验证**」授予域名权限后，即可给出确定结论。

> 早前版本对所有镜像都先试一次 CORS 模式，被浏览器拦截时会在后台控制台刷一堆红字，
> 看着像扩展坏了。现在**只对有权限的域名发 CORS 请求**。

## 存储分区

| 区域 | 存放 | 理由 |
|---|---|---|
| `chrome.storage.sync` | `enabled`、`enhanced`、`proxyPrefix`、`userSelected` | 跨设备一致的用户选择 |
| `chrome.storage.local` | 镜像清单、测速缓存、健康状态 | 与本机网络相关，跨设备同步会互相覆盖 |

升级时镜像清单会自动从 sync 迁到 local。

`userSelected` 记录「用户是否手动选过镜像」：手动选过的镜像会被粘住，测速不会覆盖它。

## 改写规则

| 对象 | 匹配 | 示例 |
|---|---|---|
| Release 资源 | `github.com/{owner}/{repo}/releases/download/...` | `https://gh-proxy.org/https://github.com/u/r/releases/download/v1/a.zip` |
| HTTPS clone | `github.com/{owner}/{repo}.git` | `https://gh-proxy.org/https://github.com/u/r.git` |
| 增强模式-任意仓库链接 | `github.com/{owner}/{repo}`（含主页、Issue、PR 等） | `https://gh-proxy.org/https://github.com/u/r` |

**不改写**：`raw.githubusercontent.com`、gist、SSH clone、GitHub 首页（`github.com` 无仓库路径）。

clone 地址会被写进三处，缺一不可：`<input>` 的 `value`、`data-clipboard-copy-text` 属性、`<clipboard-copy value="…">`（GitHub 复制按钮真正读取的内容）。

## 项目结构

```
manifest.json          MV3 配置（content script + background SW + options_ui）
src/rewrite.js         纯函数 rewrite(url, prefix, opts) → 加速 URL | null（支持增强模式）
src/config.js          默认值 / 存储分区 / 镜像清单 / 真实代理探测 / 择优
src/content.js         DOM 扫描 + MutationObserver，动态 import 上面两个 ESM
src/background.js      Service Worker：工具栏图标变色、周期体检、故障切换
popup/                 状态条 + 镜像 radio 列表 + 测速 UI
options/               镜像管理页（增 / 改 / 删 + 使用中徽标 + 逐镜像验证）
icons/                 设计源文件 icon.svg + 基础图标 + 三种状态色图标（state-on / state-off / state-fail）
tools/uicheck.mjs      无头 Chrome UI 验收（截图 + 报错/高度闸门）
tools/make-icons.ps1   由基础图标重新生成三色状态图标
tests/                 node:test 单测（rewrite + config + 语法守卫）
```

## 工具栏图标

图标底色随运行状态变化，一眼可辨：

| 颜色 | 状态 |
|---|---|
| 绿色 | 已启用，当前镜像正常 |
| 红色 | 已启用，但当前镜像连续失败 |
| 灰色 | 已停用 |

镜像名与延迟放在图标 tooltip 上。

图标的设计源文件是 `icons/icon.svg`，基础图标与三种状态色图标都由它渲染：

```bash
powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
```

> 图形全部由**路径**绘制、不含 `<text>`，所以渲染不依赖任何字体，在任何机器上结果一致
> （旧版图标用 Playfair Display 衬线体，缺字体就会让 "G" 变形）。
> 改设计只需改 `icons/icon.svg` 一处，然后重跑上面的脚本。

## 开发

```bash
# 跑测试（git-bash 上请用显式文件路径，避免目录被当成模块）
node --test tests/rewrite.test.mjs tests/config.test.mjs tests/parse.test.mjs
```

改完代码后到 `chrome://extensions` 点扩展卡片上的「重新加载」即可生效。

## 技术说明

- `rewrite.js` / `config.js` 是 ESM；MV3 content script 不支持静态 `import`，故 `content.js` 用 `chrome.runtime.getURL()` + 动态 `import()` 引入它们（需在 `manifest.json` 的 `web_accessible_resources` 放行）。
- 这样纯逻辑能用 `node --test` 真实单测，又满足 MV3 限制。
- `rewrite(url, prefix, opts)` 把前缀当参数传入，选路逻辑与改写逻辑解耦。
- `content.js` 用 `WeakMap` 保存被改写元素的原始 URL（同时记下写进去的值，用于识别「元素被外部改过」），切换镜像或关闭加速时自动还原。
- `content.js` 的 MutationObserver 会忽略「自己写出来的」变更，避免每次改写都多扫一遍全页。
- **图标路径必须用 `chrome.runtime.getURL()` 拼绝对地址**：`chrome.action.setIcon()` 的相对路径按**调用方所在目录**解析，Service Worker 在 `src/` 下，写 `icons/x.png` 会被解析成 `src/icons/x.png`，报 "Failed to fetch"。
- **语法守卫**：`tests/parse.test.mjs` 会对每个 `.js` 跑一次 `node --check`。UI 层曾因丢失一行函数声明而整体无法解析，而当时的单测全部通过——纯函数测试挡不住文件级致命错误，语法解析可以。

## 权限

| 权限 | 用途 |
|---|---|
| `storage` | 存配置、镜像清单、测速缓存 |
| `alarms` | 后台定期体检当前镜像 |
| `host_permissions: github.com` | 内容脚本运行 + 探测目标在 github.com 上 |
| `host_permissions: 7 个内置镜像域名` | 探测这些镜像时请求不走 CORS，能读真实状态码且不产生控制台报错 |
| `optional_host_permissions` | 设置页「验证」按钮按需申请单个自定义镜像域名，用于校验它真能否代理 |

## 限制 / 后续

- 关闭「启用加速」后，已改写的链接会自动还原为原始 URL（无需刷新页面）
- 增强模式默认关闭；开启后站内导航区（页头/页脚/面包屑/仓库页签）不会被改写
- 单选模式（一次一个镜像生效）；多选故障切换、后台定时测速、raw/archive 改写均为后续
