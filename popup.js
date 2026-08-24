// popup.js
// 镜像 radio 列表 + 测速。复用 config.js：统一存储的可编辑镜像 + 测速。
import { getConfig, getStoredProxies, testProxies } from './src/config.js';

const enabledEl = document.getElementById('enabled');
const enhancedEl = document.getElementById('enhanced');
const listEl = document.getElementById('proxies');
const retestEl = document.getElementById('retest');
const settingsEl = document.getElementById('settings');
const statusEl = document.getElementById('status');

const latencies = {};   // url -> ms | null

(async () => {
  const cfg = await getConfig();
  enabledEl.checked = cfg.enabled;
  enhancedEl.checked = cfg.enhanced;
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
  if (ms == null) return { text: '超时', cls: 'ms timeout' };
  if (ms < 500) return { text: `${ms}ms`, cls: 'ms fast' };
  if (ms < 1500) return { text: `${ms}ms`, cls: 'ms ok' };
  return { text: `${ms}ms`, cls: 'ms' };
}

function render(list, selectedUrl, testing) {
  listEl.innerHTML = '';
  for (const p of list) {
    const ms = latencies[p.url];
    let meta;
    if (testing && ms === undefined) meta = { text: '测速中', cls: 'ms testing' };
    else meta = latencyMeta(ms);

    const label = document.createElement('label');
    label.className = 'proxy' + (p.url === selectedUrl ? ' active' : '');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'proxy';
    radio.value = p.url;
    if (p.url === selectedUrl) radio.checked = true;
    radio.addEventListener('change', () => select(radio.value));
    label.appendChild(radio);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'proxy-name';

    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = p.name;
    nameSpan.appendChild(nameEl);

    const urlEl = document.createElement('span');
    urlEl.className = 'url';
    urlEl.textContent = p.url;
    nameSpan.appendChild(urlEl);

    label.appendChild(nameSpan);

    const msEl = document.createElement('span');
    msEl.className = meta.cls;
    msEl.textContent = meta.text;
    label.appendChild(msEl);

    listEl.appendChild(label);
  }
}

async function select(url) {
  await chrome.storage.sync.set({ proxyPrefix: url, userSelected: true });   // 粘住
  // 即时高亮当前项
  const cfg = await getConfig();
  const list = await getStoredProxies();
  render(list, cfg.proxyPrefix, false);
}

enabledEl.addEventListener('change', () =>
  chrome.storage.sync.set({ enabled: enabledEl.checked })
);
enhancedEl.addEventListener('change', () =>
  chrome.storage.sync.set({ enhanced: enhancedEl.checked })
);
retestEl.addEventListener('click', async () => {
  retestEl.disabled = true;
  const cfg = await getConfig();
  await measureAndRender(cfg.proxyPrefix, !cfg.userSelected);
  retestEl.disabled = false;
});
settingsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());
