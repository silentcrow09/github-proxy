// options.js
// 加速镜像的增删改（内置与自定义统一管理）。数据存 chrome.storage.sync.proxies。
import {
  PROXIES_KEY, normalizeProxyUrl, isValidProxyUrl,
  getStoredProxies, setStoredProxies, resetProxies,
  nextId, deriveName, DEFAULTS,
} from './src/config.js';

const addForm = document.getElementById('addForm');
const addNameEl = document.getElementById('addName');
const addUrlEl = document.getElementById('addUrl');
const addErrorEl = document.getElementById('addError');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyHintEl = document.getElementById('emptyHint');
const resetEl = document.getElementById('reset');

/** 渲染镜像列表。editingId 指定正在行内编辑的那一项。 */
function render(list, editingId = null, draft = null) {
  countEl.textContent = list.length;
  emptyHintEl.hidden = list.length !== 0;
  listEl.innerHTML = list.map((p) => {
    if (p.id === editingId) return renderEditingRow(p, draft || { name: p.name, url: p.url });
    return `
      <div class="row" data-id="${p.id}">
        <div class="row-info">
          <span class="row-name">${esc(p.name)}</span>
          <span class="row-url">${esc(p.url)}</span>
        </div>
        <button class="btn btn-sm" data-act="edit">编辑</button>
        <button class="btn-text-danger" data-act="delete" title="删除">删除</button>
      </div>`;
  }).join('');
}

function renderEditingRow(p, draft) {
  return `
    <div class="row editing" data-id="${p.id}">
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

/** 事件委托：编辑/保存/取消/删除。 */
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
    row.querySelector('.edit-url')?.focus();
  } else if (act === 'cancel') {
    const list = await getStoredProxies();
    render(list);
  } else if (act === 'save') {
    const name = row.querySelector('.edit-name').value;
    const url = row.querySelector('.edit-url').value;
    const err = await update(id, name, url);
    if (err) showRowError(row, err); else { const list = await getStoredProxies(); render(list); }
  } else if (act === 'delete') {
    await remove(id);
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

/** 校验并更新某项。返回错误字符串或 null。 */
async function update(id, rawName, rawUrl) {
  const url = normalizeProxyUrl(rawUrl);
  if (!isValidProxyUrl(url)) return '地址无效：需以 http:// 或 https:// 开头';
  const list = await getStoredProxies();
  if (list.some((p) => p.id !== id && p.url === url)) return '该镜像已存在';
  const item = list.find((p) => p.id === id);
  if (!item) return '条目不存在';
  item.name = rawName.trim() || deriveName(url);
  item.url = url;
  await setStoredProxies(list);
  return null;
}

/** 删除某项。若删的是当前生效镜像，回退到剩余列表首个或默认值。 */
async function remove(id) {
  const list = await getStoredProxies();
  const removed = list.find((p) => p.id === id);
  const next = list.filter((p) => p.id !== id);
  await setStoredProxies(next);
  // 若删的正是当前生效前缀，清除粘住标记，回退到剩余列表首个或默认值
  const cfg = await chrome.storage.sync.get(['proxyPrefix', 'userSelected']);
  if (removed && cfg.proxyPrefix === removed.url) {
    const fallback = next[0]?.url || DEFAULTS.proxyPrefix;
    await chrome.storage.sync.set({ proxyPrefix: fallback, userSelected: false });
  }
  render(next);
}

function hideError() { addErrorEl.hidden = true; addErrorEl.textContent = ''; }
function showRowError(row, msg) {
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
  const list = await getStoredProxies();
  render(list);
  // 其它页面改了 storage → 本页刷新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[PROXIES_KEY]) {
      getStoredProxies().then(render);
    }
  });
})();
