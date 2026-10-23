// tools/uicheck.mjs
// 前端验收脚本：本地 HTTP 服务 + 注入 chrome API mock + 无头 Chrome 截图。
// 用真实页面、真实 CSS、真实 ES module，只有 chrome.* 被 mock。
//
//   node tools/uicheck.mjs
//
// 产物：.uicheck/popup.png、.uicheck/options.png（该目录已在 .gitignore 中）
// 页面出现 JS 错误时以非零码退出，可直接挂到 CI。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.uicheck');
const PORT = Number(process.env.UICHECK_PORT || 8777);
const DBG = Number(process.env.UICHECK_DEBUG_PORT || 9499);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome/Edge，可用 CHROME_PATH 环境变量指定');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const rel = normalize(p === '/' ? '/popup/popup.html' : p).replace(/^([/\\])+/, '');
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const s = await stat(file);
    if (!s.isFile()) { res.writeHead(404).end('not found'); return; }
    const buf = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      // 必须 no-store：复用同一 profile 时 Chrome 会拿缓存里的旧 CSS/JS，
      // 量到的还是上一版，验证结果会骗人。
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---- chrome API mock（在页面脚本之前注入）----
const MOCK = `(() => {
  const sync = {}, local = {};
  const listeners = [];
  function mkArea(store, areaName) {
    return {
      get: async (key) => {
        if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
        if (Array.isArray(key)) { const o = {}; for (const k of key) if (k in store) o[k] = store[k]; return o; }
        const out = {};
        for (const k of Object.keys(key)) out[k] = k in store ? store[k] : key[k];
        return out;
      },
      set: async (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: store[k], newValue: v };
          store[k] = v;
        }
        for (const fn of listeners) { try { fn(changes, areaName); } catch (e) { console.error(e); } }
      },
      remove: async (k) => { delete store[k]; },
      clear: async () => { for (const k of Object.keys(store)) delete store[k]; },
    };
  }
  globalThis.chrome = {
    storage: {
      sync: mkArea(sync, 'sync'),
      local: mkArea(local, 'local'),
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
    },
    runtime: {
      id: 'mockextensionidmockextensionidmock',
      getURL: (p) => 'http://127.0.0.1:${PORT}/' + p,
      openOptionsPage: () => { console.log('[mock] openOptionsPage'); },
      sendMessage: async () => {},
    },
    permissions: {
      request: async () => false,
      contains: async () => false,
      getAll: async () => ({ origins: [] }),
    },
    action: {
      setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}, setIcon: async () => {},
    },
    alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
  };
  sync.enabled = true;
  sync.enhanced = false;
  sync.proxyPrefix = 'https://gh-proxy.org/';
  sync.userSelected = true;
  local.proxies = [
    { id: 'p1', name: 'gh-proxy.org', url: 'https://gh-proxy.org/' },
    { id: 'p2', name: 'gh-proxy v4',  url: 'https://v4.gh-proxy.org/' },
    { id: 'p3', name: 'gh-proxy cdn', url: 'https://cdn.gh-proxy.org/' },
    { id: 'p4', name: 'ghproxy.net',  url: 'https://ghproxy.net/' },
    { id: 'p5', name: 'ghfast.top',   url: 'https://ghfast.top/' },
    { id: 'p6', name: 'gh-proxy.com', url: 'https://gh-proxy.com/' },
    { id: 'p7', name: 'ghps.cc',      url: 'https://ghps.cc/' },
  ];
  local.latency = {
    'https://gh-proxy.org/':    { ms: 1545, state: 'ok', status: 200, at: Date.now() },
    'https://v4.gh-proxy.org/': { ms: 3192, state: 'ok', status: 200, at: Date.now() },
    'https://cdn.gh-proxy.org/':{ ms: 1885, state: 'ok', status: 200, at: Date.now() },
    'https://ghproxy.net/':     { ms: 6939, state: 'unknown', status: null, at: Date.now() },
    'https://ghfast.top/':      { ms: 1725, state: 'unknown', status: null, at: Date.now() },
    'https://gh-proxy.com/':    { ms: 1248, state: 'ok', status: 200, at: Date.now() },
    'https://ghps.cc/':         { ms: 1512, state: 'unknown', status: null, at: Date.now() },
  };
  local.health = {};
})();`.replace('${PORT}', String(PORT));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + DBG,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/ghprof-uicheck-' + Date.now(),
  '--window-size=900,1000', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ready = false;
for (let i = 0; i < 60; i++) {
  try { await fetch(`http://127.0.0.1:${DBG}/json/version`); ready = true; break; } catch { }
  await sleep(500);
}
if (!ready) {
  console.error('FAIL: DevTools 端口未就绪');
  chrome.kill(); server.close(); process.exit(1);
}

async function newPage() {
  const r = await fetch(`http://127.0.0.1:${DBG}/json/new?about:blank`, { method: 'PUT' });
  return r.json();
}

let failures = 0;

async function shoot(path, file, size, waitMs) {
  const page = await newPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  // 必须关缓存：复用同一个 user-data-dir 时 Chrome 会拿旧 CSS/JS，量到的还是上一版
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
  await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${path}` });
  await sleep(waitMs);

  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      status: document.getElementById('status')?.textContent,
      statusMain: document.getElementById('statusMain')?.textContent,
      warn: document.getElementById('statusWarn')?.hidden === false ? document.getElementById('statusWarn')?.textContent : null,
      rows: [...document.querySelectorAll('.proxy')].map(el => el.textContent.replace(/\\s+/g,' ').trim()),
      optRows: [...document.querySelectorAll('#list .row')].map(el => el.textContent.replace(/\\s+/g,' ').trim()),
      count: document.getElementById('count')?.textContent,
      scrollH: document.documentElement.scrollHeight,
      bodyH: Math.round(document.body.getBoundingClientRect().height),
      listH: (() => { const l = document.getElementById('proxies'); return l ? { h: l.getBoundingClientRect().height, scrollH: l.scrollHeight, maxH: getComputedStyle(l).maxHeight } : null; })(),
      blocks: (() => {
        const h = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().height) : null; };
        const warn = document.getElementById('statusWarn');
        return {
          header: h('.header'), main: h('.main'), statusBar: h('#statusBar'),
          warn: warn ? (warn.hidden ? 'hidden' : Math.round(warn.getBoundingClientRect().height)) : null,
          switch1: h('.switch-row:nth-of-type(1)'), switch2: h('.switch-row:nth-of-type(2)'),
          sectionHead: h('.section-head'), list: h('#proxies'),
          retest: h('#retest'), footer: h('.footer'),
        };
      })(),
    })`,
    returnByValue: true,
  });
  console.log('\n=== ' + path + ' ===');
  console.log(probe.result?.result?.value);
  // Chrome 弹窗最高约 600px，超出就只能在弹窗里滚动到底才能按到底部按钮。
  // 注意用 body 的实际高度，不能用 documentElement.scrollHeight——
  // 后者会被模拟视口高度盖住，量到的是视口而不是内容。
  if (path.startsWith('popup/')) {
    const h = JSON.parse(probe.result?.result?.value || '{}').bodyH;
    if (h > 600) { failures++; console.log('!! 弹窗内容高度 ' + h + 'px 超过 Chrome 的 600px 上限'); }
    else console.log('弹窗内容高度 ' + h + 'px（在 600px 上限内）');
  }
  if (errors.length) { failures++; console.log('!! PAGE ERRORS:\n' + errors.join('\n')); }
  else console.log('(no page errors)');

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(file, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', file);
  ws.close();
  await fetch(`http://127.0.0.1:${DBG}/json/close/${page.id}`);
}

// popup 会真的向各镜像发探测请求，给足时间。
// 注意：模拟页是 http://127.0.0.1 源，拿不到真实扩展的主机权限，
// 所以 CORS 依然生效——这里预置了测速缓存，走的是"读缓存直接渲染"这条常见路径。
await shoot('popup/popup.html', join(OUT, 'popup.png'), { w: 340, h: 620 }, 8000);
await shoot('options/options.html', join(OUT, 'options.png'), { w: 860, h: 900 }, 8000);

chrome.kill();
server.close();
process.exit(failures ? 1 : 0);
