import { localizeDocument, t } from './i18n.js';

const DEFAULTS = {
  format: 'png',
  quality: 0.92,
  settleMs: 220,
  hideFixed: true,
  unstick: true,
  preload: true,
  afterCapture: 'editor',
  saveAs: false,
};

const $ = (id) => document.getElementById(id);
const captureBtn = $('capture');
const statusBox = $('status');
const statusText = $('statusText');
const ticks = $('ticks');

const segments = { format: $('format'), afterCapture: $('afterCapture') };
const switches = { hideFixed: $('hideFixed'), unstick: $('unstick'), preload: $('preload') };
const ranges = { quality: $('quality'), settleMs: $('settleMs') };

function readSettings() {
  return {
    format: segments.format.querySelector('[aria-pressed="true"]').dataset.value,
    afterCapture: segments.afterCapture.querySelector('[aria-pressed="true"]').dataset.value,
    quality: Number(ranges.quality.value),
    settleMs: Number(ranges.settleMs.value),
    hideFixed: switches.hideFixed.getAttribute('aria-checked') === 'true',
    unstick: switches.unstick.getAttribute('aria-checked') === 'true',
    preload: switches.preload.getAttribute('aria-checked') === 'true',
    saveAs: false,
  };
}

function applySettings(s) {
  for (const [name, group] of Object.entries(segments)) {
    for (const b of group.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === s[name]));
    }
  }
  for (const [name, el] of Object.entries(switches)) {
    el.setAttribute('aria-checked', String(Boolean(s[name])));
  }
  ranges.quality.value = s.quality;
  ranges.settleMs.value = s.settleMs;
  syncOutputs();
}

function syncOutputs() {
  $('qualityOut').value = `${Math.round(Number(ranges.quality.value) * 100)}%`;
  $('settleOut').value = `${ranges.settleMs.value}ms`;
  $('qualityRow').hidden =
    segments.format.querySelector('[aria-pressed="true"]').dataset.value !== 'jpeg';
}

const persist = async () => {
  syncOutputs();
  await chrome.storage.local.set({ settings: readSettings() });
};

function progress(done, total) {
  if (ticks.childElementCount !== total) {
    ticks.replaceChildren(...Array.from({ length: total }, () => document.createElement('i')));
  }
  [...ticks.children].forEach((el, i) => el.classList.toggle('on', i < done));
}

function show(text, tone = '') {
  statusBox.hidden = false;
  statusText.textContent = text;
  statusText.className = `status-text ${tone}`.trim();
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setBusy(busy) {
  captureBtn.disabled = busy;
  captureBtn.querySelector('.btn-label').textContent = busy ? t('capturing') : t('capture');
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'LS_PROGRESS') return;
  switch (msg.phase) {
    case 'measuring':
      setBusy(true);
      progress(0, 1);
      show(t('stMeasuring'));
      break;
    case 'capturing':
      setBusy(true);
      progress(msg.index, msg.total);
      show(t('stCapturing', msg.index, msg.total));
      break;
    case 'stitching':
      show(t('stStitching'));
      break;
    case 'done': {
      setBusy(false);
      const r = msg.result;
      progress(1, 1);
      const scaled = r.scaled ? t('stScaled') : '';
      show(
        (r.opened
          ? t('stReady', r.width, r.height, r.screens)
          : t('stSaved', r.width, r.height, formatBytes(r.bytes))) + scaled,
        'ok'
      );
      break;
    }
    case 'error':
      setBusy(false);
      progress(0, 1);
      show(msg.error, 'err');
      break;
    default:
      break;
  }
});

captureBtn.addEventListener('click', async () => {
  await persist();
  setBusy(true);
  show(t('stStarting'));
  const reply = await chrome.runtime
    .sendMessage({ type: 'LS_START' })
    .catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
  if (reply && !reply.ok) {
    setBusy(false);
    show(reply.error, 'err');
  }
});

for (const group of Object.values(segments)) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of group.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    persist();
  });
}

for (const el of Object.values(switches)) {
  el.addEventListener('click', () => {
    el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    persist();
  });
}

for (const el of Object.values(ranges)) {
  el.addEventListener('input', syncOutputs);
  el.addEventListener('change', persist);
}

(async () => {
  localizeDocument();
  setBusy(false);
  const stored = await chrome.storage.local.get('settings');
  applySettings({ ...DEFAULTS, ...(stored.settings || {}) });
  const state = await chrome.runtime.sendMessage({ type: 'LS_GET_STATE' }).catch(() => null);
  if (state && state.ok && state.result.busy) {
    setBusy(true);
    show(t('stRunning'));
  }
})();
