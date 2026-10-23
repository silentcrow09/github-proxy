// popup.js
// 镜像 radio 列表 + 真实代理测速 + 当前生效镜像状态。
import {
  getConfig, getStoredProxies, testProxies, pickBest,
  setEnabled, setEnhanced, setProxyPrefix, resolveActivePrefix,
  migrateProxiesToLocal, getLatencyCache, setLatencyCache, LATENCY_TTL_MS,
} from '../src/config.js';

const enabledEl = document.getElementById('enabled');
const enhancedEl = document.getElementById('enhanced');
const listEl = document.getElementById('proxies');
const retestEl = document.getElementById('retest');
const settingsEl = document.getElementById('settings');
const statusEl = document.getElementById('status');
const statusBarEl = document.getElementById('statusBar');
const statusMainEl = document.getElementById('statusMain');
const statusWarnEl = document.getElementById('statusWarn');

/** url -> { ms, state, status, at }；state ∈ ok | unknown | bad | dead */
const latencies = {};
let activeUrl = null;      // 当前生效的镜像地址
let currentList = [];

(async () => {
  await migrateProxiesToLocal();
  const cfg = await getConfig();
  enabledEl.checked = cfg.enabled;
  enhancedEl.checked = cfg.enhanced;

  activeUrl = await resolveActivePrefix();
  currentList = await getStoredProxies();

  // 先用缓存渲染，开 popup 不用干等探测
  const cache = await getLatencyCache();
  Object.assign(latencies, cache);
  render(currentList, activeUrl);
  updateStatusBar();

  // 缓存仍新鲜就不重复全量重测（后台每 5 分钟刷新一次）；过期或首次才重测
  const fresh = Object.values(cache).some((e) => e && e.at && Date.now() - e.at < LATENCY_TTL_MS);
  if (fresh) {
    setStatus(summaryFromCache());
  } else {
    refresh(!cfg.userSelected);
  }
})();

/** 重新探测全部镜像并渲染。autoSelect=true 时按探测结果择优。 */
async function refresh(autoSelect) {
  setStatus('测速中…');
  const list = await getStoredProxies();
  currentList = list;
  render(list, activeUrl);

  const tested = await testProxies(list);
  for (const t of tested) {
    latencies[t.url] = { ms: t.ms, state: t.state, status: t.status, at: Date.now() };
  }
  await setLatencyCache(latencies);

  if (autoSelect) {
    const best = pickBest(tested);
    if (best && best.url !== activeUrl) {
      activeUrl = best.url;
      await setProxyPrefix(best.url, false);   // 自动择优不算"用户手动选定"
    }
  }

  render(list, activeUrl);
  setStatus(summary(tested));
  updateStatusBar();
}

/** 统计可用数。 */
function summary(tested) {
  const alive = tested.filter((t) => t.state === 'ok' || t.state === 'unknown');
  if (alive.length === 0) return '全部超时';
  const verified = tested.filter((t) => t.state === 'ok').length;
  return verified ? `${verified}/${tested.length} 已验证` : `${alive.length}/${tested.length} 可用`;
}

/** 用缓存统计可用数（后台体检已刷新过时用这个，不必再跑一轮）。 */
function summaryFromCache() {
  const vals = Object.values(latencies);
  if (!vals.length) return '待测速';
  const alive = vals.filter((v) => v.state === 'ok' || v.state === 'unknown');
  if (alive.length === 0) return '全部超时';
  const verified = vals.filter((v) => v.state === 'ok').length;
  return verified ? `${verified}/${vals.length} 已验证` : `${alive.length}/${vals.length} 可用`;
}

function setStatus(text) { statusEl.textContent = text; }

/**
 * 探测结果 -> 显示文本与颜色档位。
 * 未测速（undefined）与超时（dead）必须区分：
 * "未测速"是还没测，"超时"是测了连不上。
 */
function latencyMeta(info) {
  if (!info) return { text: '未测速', cls: 'ms untested', badge: null };
  if (info.state === 'dead') return { text: '超时', cls: 'ms timeout', badge: null };
  if (info.state === 'bad') {
    return {
      text: info.status ? `HTTP ${info.status}` : '失效',
      cls: 'ms timeout',
      badge: null,
    };
  }
  const ms = info.ms == null ? '—' : `${info.ms}ms`;
  const cls = info.ms == null ? 'ms' : info.ms < 500 ? 'ms fast' : info.ms < 1500 ? 'ms ok' : 'ms';
  // 镜像没返回 CORS 头时只能确认"可达"，无法校验内容
  const badge = info.state === 'unknown'
    ? { text: '未验证', cls: 'badge badge-warn', title: '该镜像未返回 CORS 头，只能确认可达，无法校验内容' }
    : null;
  return { text: ms, cls, badge };
}

/** 渲染镜像列表。 */
function render(list, selectedUrl) {
  listEl.innerHTML = '';
  for (const p of list) {
    const meta = latencyMeta(latencies[p.url]);

    const label = document.createElement('label');
    label.className = 'proxy' + (p.url === selectedUrl ? ' active' : '');
    label.title = p.url;

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

    if (meta.badge) {
      const b = document.createElement('span');
      b.className = meta.badge.cls;
      b.textContent = meta.badge.text;
      b.title = meta.badge.title;
      label.appendChild(b);
    }

    const msEl = document.createElement('span');
    msEl.className = meta.cls;
    msEl.textContent = meta.text;
    label.appendChild(msEl);

    listEl.appendChild(label);
  }

  // 生效镜像可能在可滚动列表的下方，滚进视野里，否则用户看不到当前选中了哪个
  const active = listEl.querySelector('.proxy.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/** 状态条：当前生效镜像 + 探测结论；失效时给出明确告警。 */
function updateStatusBar() {
  const info = latencies[activeUrl];
  const entry = currentList.find((p) => p.url === activeUrl);
  const name = entry ? entry.name : activeUrl;

  let text = `当前生效：${name}`;
  let state = 'idle';
  let warn = '';

  if (!info) {
    text += ' · 待测速';
    state = 'idle';
  } else if (info.state === 'dead') {
    text += ' · 不可用';
    state = 'error';
    warn = '当前镜像连不上，下载会失败。请换一个镜像，或点击「重新测速」。';
  } else if (info.state === 'bad') {
    text += ` · 失效${info.status ? '（HTTP ' + info.status + '）' : ''}`;
    state = 'error';
    warn = '当前镜像无法代理该资源，下载会失败。请换一个镜像，或点击「重新测速」。';
  } else if (info.state === 'unknown') {
    text += ` · ${info.ms}ms（未验证）`;
    state = 'warn';
    warn = '该镜像未返回 CORS 头，只能确认可达、无法校验内容。若下载失败请换一个镜像。';
  } else {
    text += ` · ${info.ms}ms`;
    state = 'ok';
  }

  statusBarEl.dataset.state = state;
  statusMainEl.textContent = text;
  statusWarnEl.textContent = warn;
  statusWarnEl.hidden = !warn;
}

/** 用户手动选择镜像：写入并粘住（userSelected=true），之后不再被自动测速覆盖。 */
async function select(url) {
  activeUrl = url;
  await setProxyPrefix(url, true);
  render(currentList, activeUrl);
  updateStatusBar();
}

enabledEl.addEventListener('change', () => setEnabled(enabledEl.checked));
enhancedEl.addEventListener('change', () => setEnhanced(enhancedEl.checked));

retestEl.addEventListener('click', async () => {
  retestEl.disabled = true;
  try {
    const cfg = await getConfig();
    await refresh(!cfg.userSelected);
  } finally {
    retestEl.disabled = false;
  }
});

settingsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());
