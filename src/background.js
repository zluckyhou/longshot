/**
 * Longshot service worker — orchestrates a capture run.
 *
 * The work is split three ways: this worker drives the sequence and owns the
 * only APIs that need extension privilege (captureVisibleTab, downloads), the
 * content script handles the page, and the offscreen document does the pixels.
 */

const t = (key, ...subs) =>
  chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined) || key;

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

const RESTRICTED = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^edge:\/\//i,
  /^about:/i,
  /^view-source:/i,
  /^devtools:\/\//i,
  /^https:\/\/chromewebstore\.google\.com/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
];

/** Single in-flight run; a second request is rejected rather than interleaved. */
let running = null;
/** Resolves once an editor tab reports it has decoded the image. */
let awaitingEditor = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(stored.settings || {}) };
}

function emit(payload) {
  chrome.runtime.sendMessage({ type: 'LS_PROGRESS', ...payload }).catch(() => {});
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#b8730c' });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    /* tab may be gone */
  }
}

// --- content script -------------------------------------------------------

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'LS_PING' });
    if (pong && pong.ok) return;
  } catch {
    /* not injected yet */
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['src/content.js'],
  });
}

async function callContent(tabId, message) {
  const reply = await chrome.tabs.sendMessage(tabId, message);
  if (!reply) throw new Error(t('errNoPage'));
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

// --- offscreen document ---------------------------------------------------

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Stitch captured screen segments into a single image.',
    });
  } catch (err) {
    // A concurrent createDocument may have won the race; anything else is real.
    if (!/single offscreen/i.test(String(err && err.message))) throw err;
  }
}

async function callOffscreen(type, payload = {}) {
  const reply = await chrome.runtime.sendMessage({
    target: 'longshot-offscreen',
    type,
    ...payload,
  });
  if (!reply) throw new Error('stitcher did not respond');
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

async function releaseOffscreen() {
  await callOffscreen('OFFSCREEN_RELEASE').catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

// --- capture --------------------------------------------------------------

/**
 * captureVisibleTab is quota-limited to a couple of calls per second. Rather
 * than pacing pessimistically, we go fast and back off only when Chrome says no.
 */
async function captureWithRetry(windowId) {
  let backoff = 220;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      const message = String((err && err.message) || err);
      if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message)) throw err;
      await sleep(backoff);
      backoff = Math.min(1200, Math.round(backoff * 1.5));
    }
  }
  throw new Error(t('errThrottled'));
}

function buildFilename(tab, format) {
  let host = 'page';
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '') || 'page';
  } catch {
    /* keep fallback */
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '_').slice(0, 60);
  return `${safeHost}-${stamp}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

function assertCapturable(tab) {
  if (!tab || !tab.id) throw new Error(t('errNoTab'));
  const url = tab.url || '';
  if (!url) throw new Error(t('errUnreadable'));
  if (RESTRICTED.some((re) => re.test(url))) throw new Error(t('errRestricted'));
  if (/^file:\/\//i.test(url)) throw new Error(t('errFile'));
}

async function capture(tab, settings) {
  assertCapturable(tab);
  const tabId = tab.id;

  await ensureContentScript(tabId);
  await ensureOffscreen();

  emit({ phase: 'measuring' });
  const page = await callContent(tabId, { type: 'LS_PREPARE', opts: settings });

  const dpr = page.dpr;
  const total = page.positions.length;
  const frame = page.frame;
  // Horizontal scroll is not stitched — we capture the scroller at its current width.
  await callOffscreen('OFFSCREEN_INIT', {
    width: Math.round(frame.width * dpr),
    height: Math.round(page.contentHeight * dpr),
  });

  try {
    for (let i = 0; i < total; i += 1) {
      const live = await chrome.tabs.get(tabId).catch(() => null);
      if (!live) throw new Error(t('errTabClosed'));
      if (!live.active) throw new Error(t('errTabSwitched'));

      emit({ phase: 'capturing', index: i + 1, total });
      await setBadge(tabId, `${i + 1}/${total}`);

      const at = await callContent(tabId, {
        type: 'LS_SCROLL_TO',
        y: page.positions[i],
        index: i,
        opts: settings,
      });

      const dataUrl = await captureWithRetry(tab.windowId);
      await callOffscreen('OFFSCREEN_DRAW', {
        dataUrl,
        sx: Math.round(frame.x * dpr),
        sy: Math.round(frame.y * dpr),
        sw: Math.round(frame.width * dpr),
        sh: Math.round(frame.height * dpr),
        dy: Math.round(at.scrollTop * dpr),
      });
    }
  } finally {
    await callContent(tabId, { type: 'LS_CLEANUP' }).catch(() => {});
    await setBadge(tabId, '');
  }

  emit({ phase: 'stitching' });
  const image = await callOffscreen('OFFSCREEN_FINISH', {
    format: settings.format,
    quality: settings.quality,
  });

  const filename = buildFilename(tab, settings.format);
  const summary = {
    filename,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    scaled: image.scale < 1,
    screens: total,
    mode: page.mode,
  };

  if (settings.afterCapture === 'editor') {
    await openEditor(image.url, filename);
    return { ...summary, opened: true };
  }

  const downloadId = await chrome.downloads.download({
    url: image.url,
    filename: `Longshot/${filename}`,
    saveAs: settings.saveAs,
  });
  releaseAfterDownload(downloadId);
  return { ...summary, opened: false };
}

/**
 * Hands the stitched image to an editor tab. The blob lives in the offscreen
 * document, so it has to outlive this call until the editor has decoded it —
 * with a ceiling, so a tab the user closes immediately cannot leak it forever.
 */
async function openEditor(blobUrl, filename) {
  const url =
    `${chrome.runtime.getURL('src/editor.html')}` +
    `?src=${encodeURIComponent(blobUrl)}&name=${encodeURIComponent(filename)}`;

  const ready = new Promise((resolve) => {
    awaitingEditor = resolve;
    setTimeout(resolve, 60000);
  });

  await chrome.tabs.create({ url, active: true });
  ready.then(async () => {
    awaitingEditor = null;
    await releaseOffscreen();
  });
}

/** Hold the blob until Chrome has written the file, then let it go. */
function releaseAfterDownload(downloadId) {
  const listener = async (delta) => {
    if (delta.id !== downloadId || !delta.state) return;
    if (delta.state.current === 'in_progress') return;
    chrome.downloads.onChanged.removeListener(listener);
    await releaseOffscreen();
  };
  chrome.downloads.onChanged.addListener(listener);
}

async function startCapture() {
  if (running) throw new Error(t('errBusy'));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await getSettings();

  running = capture(tab, settings)
    .then((result) => {
      emit({ phase: 'done', result });
      return result;
    })
    .catch((err) => {
      const message = String((err && err.message) || err);
      emit({ phase: 'error', error: message });
      throw err;
    })
    .finally(() => {
      running = null;
    });

  return running;
}

// --- entry points ---------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'longshot-offscreen') return;

  if (msg.type === 'LS_START') {
    startCapture()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (msg.type === 'LS_GET_STATE') {
    sendResponse({ ok: true, result: { busy: Boolean(running) } });
    return false;
  }

  if (msg.type === 'LS_EDITOR_READY') {
    if (awaitingEditor) awaitingEditor();
    sendResponse({ ok: true });
    return false;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'capture-full-page') return;
  startCapture().catch(() => {});
});

// Exposed so an automated end-to-end test can drive a run without a UI gesture.
globalThis.__longshot = { startCapture };
