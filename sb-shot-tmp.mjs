import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DBG = 9531;
const OUT = 'D:\\Work\\Projects\\github-proxy\\.uicheck\\frames';
mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
  '--remote-debugging-port=' + DBG, '--user-data-dir=' + process.env.TEMP + '/ghprof-sb2',
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
const info = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.frame')].map((f,i)=>{const r=f.getBoundingClientRect();return {i:i+1,x:r.x+window.scrollX,y:r.y+window.scrollY,w:r.width,h:r.height};}))`, returnByValue: true });
const frames = JSON.parse(info.result?.result?.value || '[]');
// 检查字幕是否溢出
const ov = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.frame')].map((f,i)=>{const s=f.querySelector('.subs');const r=s.getBoundingClientRect();const p=f.getBoundingClientRect();return {f:i+1,over:(r.bottom-p.bottom)>0||(r.top-p.top)<0,lines:Math.round(r.height/72)};}))`, returnByValue: true });
console.log('subtitle check:', ov.result?.result?.value);
for (const f of frames) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: f.x, y: f.y, width: f.w, height: f.h, scale: 0.42 } });
  writeFileSync(`${OUT}\\f${f.i}.png`, Buffer.from(shot.result.data, 'base64'));
}
const { execFileSync } = await import('node:child_process');
execFileSync('magick', [...frames.map(f => `${OUT}\\f${f.i}.png`), '-background', '#010409', '-gravity', 'center', '+append', `${OUT}\\sheet.png`]);
console.log('done');
chrome.kill(); process.exit(0);
