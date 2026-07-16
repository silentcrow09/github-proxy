// popup.js
// 镜像 radio 列表 + 测速。复用 config.js：统一存储的可编辑镜像 + 测速。
import { DEFAULTS, getStoredProxies, testProxies } from '../src/config.js';

const enabledEl = document.getElementById('enabled');
const listEl = document.getElementById('proxies');
const retestEl = document.getElementById('retest');
const settingsEl = document.getElementById('settings');
const statusEl = document.getElementById('status');

const latencies = {};   // url -> ms | null

(async () => {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  enabledEl.checked = cfg.enabled === true;
  await measureAndRender(cfg.proxyPrefix, !cfg.userSelected);
})();

/** 测速并渲染。selectedUrl 当前选中；autoSelect=true 时按延迟自动择优。 */
async function measureAndRender(selectedUrl, autoSelect) {
  const list = await getStoredProxies();
  render(list, selectedUrl, true);                  // 先显示"测速中"
  setStatus('测速中…');
  const tested = await testProxies(list);
  for (const t of tested) latencies[t.url] = t.ms;
  const next = autoSelect ? pickBest(tested) : selectedUrl;
  render(list, next, false);
  setStatus(summary(tested));
  if (autoSelect && next && next !== selectedUrl) {
    await chrome.storage.sync.set({ proxyPrefix: next });   // 落地默认最优(不设 userSelected)
  }
}

/** 延迟最低的活镜像；全挂回退第一个。 */
function pickBest(tested) {
  const alive = tested.filter((t) => t.ms != null);
  if (alive.length === 0) return tested[0]?.url;
  return alive.reduce((a, b) => (a.ms <= b.ms ? a : b)).url;
}

function summary(tested) {
  const alive = tested.filter((t) => t.ms != null);
  if (alive.length === 0) return '全部超时';
  return `${alive.length}/${tested.length} 可用`;
}

function setStatus(text) { statusEl.textContent = text; }

/** ms -> 显示文本与颜色档位 */
function latencyMeta(ms) {
  if (ms == null) return { text: '超时', cls: 'ms timeout' };
  if (ms < 500) return { text: `${ms}ms`, cls: 'ms fast' };
  if (ms < 1500) return { text: `${ms}ms`, cls: 'ms ok' };
  return { text: `${ms}ms`, cls: 'ms' };
}

function render(list, selectedUrl, testing) {
  listEl.innerHTML = list.map((p) => {
    const ms = latencies[p.url];
    let meta;
    if (testing && ms === undefined) meta = { text: '测速中', cls: 'ms testing' };
    else meta = latencyMeta(ms);
    const active = p.url === selectedUrl ? 'active' : '';
    const checked = p.url === selectedUrl ? 'checked' : '';
    return `<label class="proxy ${active}">
      <input type="radio" name="proxy" value="${p.url}" ${checked}>
      <span class="proxy-name">
        <span class="name">${esc(p.name)}</span>
        <span class="url">${esc(p.url)}</span>
      </span>
      <span class="${meta.cls}">${meta.text}</span>
    </label>`;
  }).join('');
  for (const r of listEl.querySelectorAll('input[name="proxy"]')) {
    r.addEventListener('change', () => select(r.value));
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function select(url) {
  await chrome.storage.sync.set({ proxyPrefix: url, userSelected: true });   // 粘住
  // 即时高亮当前项
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  const list = await getStoredProxies();
  render(list, cfg.proxyPrefix, false);
}

enabledEl.addEventListener('change', () =>
  chrome.storage.sync.set({ enabled: enabledEl.checked })
);
retestEl.addEventListener('click', async () => {
  retestEl.disabled = true;
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  await measureAndRender(cfg.proxyPrefix, !cfg.userSelected);
  retestEl.disabled = false;
});
settingsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());
