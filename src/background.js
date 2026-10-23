// src/background.js
// Service Worker：维护工具栏徽标、定期体检当前生效镜像、连续失败时自动切换到次优镜像。
//
// 不申请 notifications 权限——徽标变红 + popup 里的告警条已经足够让用户察觉，
// 避免为了提示而多要一个权限。

import {
  getConfig, getStoredProxies, probeMirror, testProxies, pickBest,
  setProxyPrefix, resolveActivePrefix, migrateProxiesToLocal,
  getLatencyCache, setLatencyCache, getHealth, setHealth,
} from './config.js';

const ALARM_NAME = 'ghp-health-check';
const CHECK_INTERVAL_MIN = 5;
const FAIL_THRESHOLD = 2;        // 连续失败几次才切换镜像
const HEALTH_WINDOW_MS = 30 * 60 * 1000;

/** 更新工具栏徽标：开关状态用文字，镜像健康度用颜色，详情放 tooltip。 */
async function updateBadge() {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'GitHub 加速：已停用' });
    return;
  }

  const list = await getStoredProxies();
  const active = await resolveActivePrefix();
  const entry = list.find((p) => p.url === active);
  const name = entry ? entry.name : active;

  const health = await getHealth();
  const rec = health[active];
  const failing = rec && (rec.fails || 0) > 0;

  await chrome.action.setBadgeText({ text: 'ON' });
  await chrome.action.setBadgeBackgroundColor({
    color: failing ? '#cf222e' : '#1a7f37',
  });

  let detail = '可用';
  if (failing) detail = `连续失败 ${rec.fails} 次`;
  else if (rec && rec.lastMs != null) detail = `${rec.lastMs}ms`;
  await chrome.action.setTitle({ title: `GitHub 加速：${name} · ${detail}` });
}

/**
 * 体检：探测当前生效镜像，更新健康状态；连续失败达到阈值就重新择优并切换。
 */
async function healthCheck() {
  const cfg = await getConfig();
  if (!cfg.enabled) { await updateBadge(); return; }

  const list = await getStoredProxies();
  if (!list.length) return;

  const active = await resolveActivePrefix();
  const r = await probeMirror(active);

  const health = await getHealth();
  const rec = health[active] || { fails: 0, ok: 0 };
  if (r.state === 'ok' || r.state === 'unknown') {
    rec.fails = 0;
    rec.ok = (rec.ok || 0) + 1;
  } else {
    rec.fails = (rec.fails || 0) + 1;
  }
  rec.lastMs = r.ms;
  rec.lastState = r.state;
  rec.lastChecked = Date.now();
  health[active] = rec;

  // 探针结果同步进测速缓存，popup 打开时可直接用
  const cache = await getLatencyCache();
  cache[active] = { ms: r.ms, state: r.state, status: r.status, at: Date.now() };
  await setLatencyCache(cache);

  if (rec.fails >= FAIL_THRESHOLD) {
    // 当前镜像连续失败 → 全体复测，挑一个真正可用的换上去
    const tested = await testProxies(list);
    const best = pickBest(tested);
    if (best && best.url !== active) {
      await setProxyPrefix(best.url, false);
      health[active] = { ...rec, switchedAt: Date.now() };
      health[best.url] = {
        ...(health[best.url] || { fails: 0, ok: 0 }),
        fails: 0,
        lastMs: best.ms,
        lastState: best.state,
        lastChecked: Date.now(),
      };
    }
  }

  await setHealth(health);
  await updateBadge();
}

/** 清理过期的健康记录，避免 local 区无限增长。 */
async function pruneHealth() {
  const health = await getHealth();
  const now = Date.now();
  let changed = false;
  for (const [url, rec] of Object.entries(health)) {
    if (!rec || !rec.lastChecked || now - rec.lastChecked > HEALTH_WINDOW_MS * 4) {
      delete health[url];
      changed = true;
    }
  }
  if (changed) await setHealth(health);
}

// ---- 生命周期 ----

chrome.runtime.onInstalled.addListener(async () => {
  await migrateProxiesToLocal();
  await getStoredProxies();       // 首次安装写入种子
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MIN });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateProxiesToLocal();
  await updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  healthCheck()
    .then(pruneHealth)
    .catch((err) => console.error('[github-proxy] health check failed', err));
});

// 配置变化 → 立刻刷新徽标
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.enabled || changes.proxyPrefix)) {
    updateBadge().catch(() => {});
  }
});
