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
