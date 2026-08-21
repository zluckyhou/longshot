/**
 * Longshot offscreen document.
 *
 * The service worker cannot hold a canvas or mint blob: URLs, so stitching
 * lives here. Segments are drawn as they arrive and released immediately —
 * only the destination canvas is ever held in memory.
 */

// Chrome refuses canvases past these; we scale the output down rather than fail.
const MAX_DIM = 32767;
const MAX_AREA = 268435456;

let canvas = null;
let ctx = null;
let job = null;
let lastUrl = null;

function init({ width, height }) {
  const scale = Math.min(
    1,
    MAX_DIM / width,
    MAX_DIM / height,
    Math.sqrt(MAX_AREA / (width * height))
  );
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));

  canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  job = { scale, width: w, height: h };
  return { width: w, height: h, scale };
}

async function draw({ dataUrl, sx, sy, sw, sh, dy }) {
  if (!ctx) throw new Error('stitcher not initialised');
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const { scale, width } = job;
    // Snap both edges to the same grid the neighbouring segment will use,
    // so rounding can never open a seam between screens.
    const top = Math.round(dy * scale);
    const bottom = Math.round((dy + sh) * scale);
    const cropW = Math.min(sw, Math.max(1, bitmap.width - sx));
    const cropH = Math.min(sh, Math.max(1, bitmap.height - sy));
    ctx.drawImage(
      bitmap,
      sx,
      sy,
      cropW,
      cropH,
      0,
      top,
      width,
      Math.max(1, bottom - top)
    );
  } finally {
    bitmap.close();
  }
  return { ok: true };
}

function toBlob(mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))),
      mime,
      quality
    );
  });
}

async function finish({ format, quality }) {
  if (!canvas) throw new Error('stitcher not initialised');
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await toBlob(mime, format === 'jpeg' ? quality : undefined);

  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);

  const result = {
    url: lastUrl,
    bytes: blob.size,
    width: canvas.width,
    height: canvas.height,
    scale: job.scale,
  };

  canvas = null;
  ctx = null;
  job = null;
  return result;
}

function release() {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = null;
  canvas = null;
  ctx = null;
  job = null;
  return { ok: true };
}

const handlers = {
  OFFSCREEN_INIT: init,
  OFFSCREEN_DRAW: draw,
  OFFSCREEN_FINISH: finish,
  OFFSCREEN_RELEASE: release,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'longshot-offscreen') return;
  const handler = handlers[msg.type];
  if (!handler) return;
  Promise.resolve(handler(msg))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
