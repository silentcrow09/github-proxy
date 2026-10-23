// 一次性脚本：逐帧截图 + 安全区越界检查。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DBG = 9532;
const OUT = 'D:\\Work\\Projects\\github-proxy\\.uicheck\\frames';
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
  '--remote-debugging-port=' + DBG, '--user-data-dir=' + process.env.TEMP + '/ghprof-sb3',
  '--window-size=1200,2000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${DBG}/json/version`); break; } catch { } await sleep(500); }

const page = await (await fetch(`http://127.0.0.1:${DBG}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 2000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'file:///D:/Work/Projects/github-proxy/docs/douyin-video/storyboard.html' });
await sleep(2500);

// 安全区越界检查：任何有文字的元素都不得越过左右 108px / 底部 250px
const check = await send('Runtime.evaluate', {
  expression: `(() => {
    const L = 108, R = 108, B = 250, T = 100;
    const bad = [];
    document.querySelectorAll('.frame').forEach((f, fi) => {
      const fr = f.getBoundingClientRect();
      f.querySelectorAll('*').forEach(el => {
        if (el === f || el.closest('.meta-bar')) return;
        if (!el.textContent || !el.textContent.trim()) return;
        if (el.children.length) return;          // 只看叶子文字节点
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const over = [];
        if (r.left - fr.left < L - 1) over.push('左 ' + Math.round(fr.left - r.left) + 'px');
        if (fr.right - r.right < R - 1) over.push('右 ' + Math.round(fr.right - r.right) + 'px');
        if (fr.bottom - r.bottom < B - 1) over.push('下 ' + Math.round(fr.bottom - r.bottom) + 'px');
        if (r.top - fr.top < T - 1) over.push('上 ' + Math.round(r.top - fr.top) + 'px');
        if (over.length) bad.push('帧' + (fi + 1) + ' <' + el.tagName.toLowerCase() + ' class="' + (el.className || '-') + '"> ' + over.join(',') + ' | ' + el.textContent.trim().slice(0, 28));
      });
    });
    return JSON.stringify(bad, null, 1);
  })()`,
  returnByValue: true,
});
console.log('=== 安全区越界 ===');
console.log(check.result?.result?.value);

const info = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.frame')].map((f,i)=>{const r=f.getBoundingClientRect();return {i:i+1,x:r.x+window.scrollX,y:r.y+window.scrollY,w:r.width,h:r.height};}))`, returnByValue: true });
const frames = JSON.parse(info.result?.result?.value || '[]');
for (const f of frames) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: f.x, y: f.y, width: f.w, height: f.h, scale: 0.42 } });
  writeFileSync(`${OUT}\\f${f.i}.png`, Buffer.from(shot.result.data, 'base64'));
}
const { execFileSync } = await import('node:child_process');
execFileSync('magick', [...frames.map(f => `${OUT}\\f${f.i}.png`), '-background', '#010409', '-gravity', 'center', '+append', `${OUT}\\sheet.png`]);
console.log('captured', frames.length, 'frames');
chrome.kill(); process.exit(0);
