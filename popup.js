// popup.js
// 配置 UI：读写 chrome.storage.sync。复用 config.js 的 DEFAULTS 与 normalizePrefix。
import { DEFAULTS, normalizePrefix } from './src/config.js';

const enabledEl = document.getElementById('enabled');
const prefixEl = document.getElementById('prefix');
const savedEl = document.getElementById('saved');

(async () => {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  enabledEl.checked = cfg.enabled === true;
  prefixEl.value = cfg.proxyPrefix;
})();

function save() {
  chrome.storage.sync.set({
    enabled: enabledEl.checked,
    proxyPrefix: normalizePrefix(prefixEl.value),
  });
  savedEl.hidden = false;
  setTimeout(() => { savedEl.hidden = true; }, 1000);
}

enabledEl.addEventListener('change', save);
prefixEl.addEventListener('change', save);
