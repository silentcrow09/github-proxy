// options.js
// 加速镜像的增删改查（内置与自定义统一管理）+ 逐镜像验证。
// 镜像清单存 chrome.storage.local（与网络相关，不跨设备同步）；
// 当前生效的镜像存 chrome.storage.sync（跨设备一致的用户选择）。

import {
  PROXIES_KEY, normalizeProxyUrl, isValidProxyUrl,
  getStoredProxies, setStoredProxies, resetProxies,
  nextId, deriveName, DEFAULTS, getConfig, setProxyPrefix, resolveActivePrefix,
  migrateProxiesToLocal, probeMirror, testProxies, getLatencyCache, setLatencyCache,
  LATENCY_TTL_MS,
} from '../src/config.js';

const addForm = document.getElementById('addForm');
const addNameEl = document.getElementById('addName');
const addUrlEl = document.getElementById('addUrl');
const addErrorEl = document.getElementById('addError');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyHintEl = document.getElementById('emptyHint');
const resetEl = document.getElementById('reset');

let currentList = [];       // 内存副本，供点击处理同步取用（避免 await 丢失用户手势）
let editingId = null;       // 正在行内编辑的条目
let activeUrl = null;       // 当前生效的镜像地址
let latencies = {};         // url -> { ms, state, status }

/** 渲染镜像列表。editingId 指定正在行内编辑的那一项。 */
function render(list, editingId = null, draft = null) {
  currentList = list;
  countEl.textContent = list.length;
  emptyHintEl.hidden = list.length !== 0;
  listEl.innerHTML = list.map((p) => {
    if (p.id === editingId) return renderEditingRow(p, draft || { name: p.name, url: p.url });
    return renderRow(p);
  }).join('');
}

/** 普通行：名称、地址、探测结论、"使用中"徽标、操作按钮。 */
function renderRow(p) {
  const info = latencies[p.url];
  const meta = latencyMeta(info);
  const isActive = p.url === activeUrl;
  return `
    <div class="row" data-id="${escAttr(p.id)}">
      <div class="row-info">
        <span class="row-name">${esc(p.name)}${isActive ? '<span class="badge badge-active">使用中</span>' : ''}</span>
        <span class="row-url">${esc(p.url)}</span>
      </div>
      <span class="${meta.cls}" title="${escAttr(meta.title || '')}">${esc(meta.text)}</span>
      <button class="btn btn-sm" data-act="verify" title="授予该域名访问权限后，验证它能否真正代理下载">验证</button>
      <button class="btn btn-sm" data-act="edit">编辑</button>
      <button class="btn-text-danger" data-act="delete" title="删除">删除</button>
    </div>`;
}

/** 探测结论 -> 展示文案。区分"未测速""超时""失效"三种不同含义。 */
function latencyMeta(info) {
  if (!info) return { text: '未测速', cls: 'ms untested', title: '尚未探测该镜像' };
  if (info.state === 'dead') return { text: '超时', cls: 'ms timeout', title: '镜像不可达：连接失败或超时' };
  if (info.state === 'bad') {
    return {
      text: info.status ? `HTTP ${info.status}` : '失效',
      cls: 'ms timeout',
      title: '镜像无法代理下载该资源，换一个镜像',
    };
  }
  const ms = info.ms == null ? '—' : `${info.ms}ms`;
  const cls = info.ms == null ? 'ms' : info.ms < 500 ? 'ms fast' : info.ms < 1500 ? 'ms ok' : 'ms';
  const title = info.state === 'unknown'
    ? '镜像可达，但未返回 CORS 头，无法校验内容'
    : '已验证：能真实代理下载';
  return { text: ms, cls, title };
}

function renderEditingRow(p, draft) {
  return `
    <div class="row editing" data-id="${escAttr(p.id)}">
      <div class="edit-fields">
        <input type="text" class="input edit-name" value="${escAttr(draft.name)}" placeholder="名称" maxlength="40">
        <input type="url" class="input edit-url" value="${escAttr(draft.url)}" placeholder="地址 https://..." required>
      </div>
      <div class="edit-actions">
        <button class="btn btn-sm btn-primary" data-act="save">保存</button>
        <button class="btn btn-sm" data-act="cancel">取消</button>
      </div>
    </div>`;
}

/** 事件委托：编辑/保存/取消/删除/验证。 */
listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.row');
  const id = row?.dataset.id;
  if (!id) return;
  const act = btn.dataset.act;

  if (act === 'edit') {
    const list = await getStoredProxies();
    render(list, id);
    // 渲染后从列表里重新取行：旧的 row 已脱离文档，focus 它没有效果
    listEl.querySelector(`.row[data-id="${CSS.escape(id)}"] .edit-url`)?.focus();
  } else if (act === 'cancel') {
    const list = await getStoredProxies();
    editingId = null;
    render(list);
  } else if (act === 'save') {
    const name = row.querySelector('.edit-name').value;
    const url = row.querySelector('.edit-url').value;
    const err = await update(id, name, url);
    if (err) showRowError(row, err);
    else { editingId = null; const list = await getStoredProxies(); render(list); }
  } else if (act === 'delete') {
    await remove(id);
  } else if (act === 'verify') {
    await verify(id, btn);
  }
});

/** 新增表单。 */
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const err = await add(addNameEl.value, addUrlEl.value);
  if (err) {
    addErrorEl.textContent = err;
    addErrorEl.hidden = false;
  } else {
    addNameEl.value = '';
    addUrlEl.value = '';
    addNameEl.focus();
  }
});

/** 恢复内置默认镜像。 */
resetEl.addEventListener('click', async () => {
  if (!confirm('确定恢复为内置默认镜像？当前列表（含自定义项）将被覆盖。')) return;
  await resetProxies();
  editingId = null;
  await refreshActive();
  const list = await getStoredProxies();
  render(list);
});

/** 校验并写入新增项。返回错误字符串或 null。 */
async function add(rawName, rawUrl) {
  const url = normalizeProxyUrl(rawUrl);
  if (!isValidProxyUrl(url)) return '地址无效：需以 http:// 或 https:// 开头';
  const list = await getStoredProxies();
  if (list.some((p) => p.url === url)) return '该镜像已存在';
  const name = rawName.trim() || deriveName(url);
  list.push({ id: nextId(), name, url });
  await setStoredProxies(list);
  return null;
}

/**
 * 校验并更新某项。返回错误字符串或 null。
 * 改的若正是当前生效镜像，同步更新生效前缀——否则生效前缀会指向一个已不存在的镜像。
 */
async function update(id, rawName, rawUrl) {
  const url = normalizeProxyUrl(rawUrl);
  if (!isValidProxyUrl(url)) return '地址无效：需以 http:// 或 https:// 开头';
  const list = await getStoredProxies();
  if (list.some((p) => p.id !== id && p.url === url)) return '该镜像已存在';
  const item = list.find((p) => p.id === id);
  if (!item) return '条目不存在';
  const oldUrl = item.url;
  item.name = rawName.trim() || deriveName(url);
  item.url = url;
  await setStoredProxies(list);

  const cfg = await getConfig();
  if (cfg.proxyPrefix === oldUrl && oldUrl !== url) {
    await setProxyPrefix(url, cfg.userSelected);
  }
  return null;
}

/** 删除某项。若删的是当前生效镜像，回退到剩余列表首个。 */
async function remove(id) {
  const list = await getStoredProxies();
  const removed = list.find((p) => p.id === id);
  if (!removed) return;
  // 始终要有一个可用镜像：单选模型下没有镜像就无从生效
  if (list.length <= 1) {
    showRowError(listEl.querySelector(`.row[data-id="${CSS.escape(id)}"]`), '至少保留一个镜像');
    return;
  }
  if (!confirm(`确定删除镜像「${removed.name}」？`)) return;

  const next = list.filter((p) => p.id !== id);
  await setStoredProxies(next);
  const cfg = await getConfig();
  if (cfg.proxyPrefix === removed.url) {
    const fallback = next[0]?.url || DEFAULTS.proxyPrefix;
    await setProxyPrefix(fallback, false);
  }
  await refreshActive();
  render(next);
}

/**
 * 验证单个镜像：先请求该域名的可选主机权限，拿到权限后扩展请求可绕过 CORS，
 * 于是能读到真实状态码，确认它到底能不能代理下载。
 */
async function verify(id, btn) {
  const item = currentList.find((p) => p.id === id);
  if (!item) return;
  let origin = null;
  try { origin = new URL(item.url).origin + '/*'; } catch { /* 非法地址 */ }

  let granted = false;
  if (origin) {
    try {
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch { granted = false; }
  }
  if (!granted) {
    // 没有权限也能测，只是无法校验内容
    btn.disabled = true;
    btn.textContent = '验证中…';
  }

  const r = await probeMirror(item.url);
  latencies[item.url] = { ms: r.ms, state: r.state, status: r.status, at: Date.now() };
  await setLatencyCache(latencies);

  const label = {
    ok: '已验证可用',
    unknown: '可达但未验证',
    bad: `已验证失效（HTTP ${r.status ?? '-'}）`,
    dead: '不可达',
  }[r.state] || '未知';
  btn.textContent = '验证';
  btn.disabled = false;
  btn.title = label + (granted ? '（已授予该域名访问权限）' : '（未授予该域名访问权限，无法校验内容）');

  await refreshActive();
  render(await getStoredProxies(), editingId);
}

/** 刷新"当前生效"镜像，并同步缓存里的探测结论。 */
async function refreshActive() {
  activeUrl = await resolveActivePrefix();
  Object.assign(latencies, await getLatencyCache());
}

/**
 * 缓存过期时后台复测一轮，让列表里的延迟不至于长期停留在"未测速"。
 * 不阻塞页面渲染——先用缓存画出来，测完再刷新。
 */
async function refreshLatencyIfStale() {
  const cache = await getLatencyCache();
  const fresh = Object.values(cache).some((e) => e && e.at && Date.now() - e.at < LATENCY_TTL_MS);
  if (fresh) return;
  const list = await getStoredProxies();
  const tested = await testProxies(list);
  for (const t of tested) {
    latencies[t.url] = { ms: t.ms, state: t.state, status: t.status, at: Date.now() };
  }
  await setLatencyCache(latencies);
  render(await getStoredProxies(), editingId);
}

function hideError() { addErrorEl.hidden = true; addErrorEl.textContent = ''; }
function showRowError(row, msg) {
  if (!row) return;
  let el = row.querySelector('.row-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'error row-error';
    el.style.cssText = 'flex-basis:100%;margin-top:4px;';
    row.appendChild(el);
  }
  el.textContent = msg;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) {
  return String(s ?? '').replace(/["&<>]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** 初始化。 */
(async () => {
  await migrateProxiesToLocal();
  await refreshActive();
  const list = await getStoredProxies();
  render(list);

  // 缓存过期时后台复测（不阻塞首屏）
  refreshLatencyIfStale().catch(() => {});

  // 其它页面改了 storage → 本页刷新（保留正在编辑的行，避免输入被冲掉）
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes[PROXIES_KEY]) {
      await refreshActive();
      render(await getStoredProxies(), editingId);
    } else if (area === 'sync' && (changes.proxyPrefix || changes.enabled)) {
      await refreshActive();
      render(await getStoredProxies(), editingId);
    }
  });
})();
