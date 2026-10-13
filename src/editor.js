import { localizeDocument, t } from './i18n.js';

const TAU = Math.PI * 2;
// FixedShot's ink presets, same order and same values, so an annotation drawn
// in one tool matches one drawn in the other.
const SWATCHES = [
  '#ff4f00', '#146cff', '#e5484d', '#1a996e',
  '#c43da6', '#00a3b4', '#1c1d21', '#ffffff',
];
const HIGHLIGHTS = ['#ffe23d', '#8af082', '#82d6ff', '#ff9ecc'];
const HANDLE = 7;
const MIN_POWER = 1.1;
const MAX_POWER = 12;
const FONT = "'Longshot Sans', system-ui, sans-serif";

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const stage = $('stage');
const textInput = $('textInput');

const state = {
  image: null,
  name: 'Longshot.png',
  crop: { x: 0, y: 0, w: 0, h: 0 },
  shapes: [],
  selected: null,
  tool: 'select',
  color: SWATCHES[0],
  stroke: 4,
  power: 2,
  fontSize: 22,
  textBold: false,
  textPlate: 'solid',
  lineStyle: 'solid',
  maskStyle: 'opaque',
  maskStrength: 16,
  highlightColor: HIGHLIGHTS[0],
  // mode: 'all' | 'width' | null — which fit the view is sitting at, so the
  // toggle button and a window resize can keep it; null after any manual zoom.
  view: { scale: 1, x: 0, y: 0, mode: null },
  out: { w: 0, h: 0, lock: true },
  draft: null,
  cropRect: null,
  editing: null,
  history: [],
  future: [],
};

let nextId = 1;

/* ------------------------------------------------------------------ model */

const snapshot = () =>
  JSON.stringify({ crop: state.crop, shapes: state.shapes, out: state.out });

function commit(before = snapshot()) {
  state.history.push(before);
  if (state.history.length > 80) state.history.shift();
  state.future.length = 0;
  refreshChrome();
}

function restore(json) {
  const s = JSON.parse(json);
  const cropChanged = JSON.stringify(state.crop) !== JSON.stringify(s.crop);
  state.crop = s.crop;
  state.shapes = s.shapes;
  state.out = s.out;
  state.selected = null;
  syncOut();
  if (cropChanged) fit(); else render();
}

function undo() {
  if (drag) { cancelDrag(); return; }
  commitText();
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
  refreshChrome();
}

function redo() {
  if (drag) { cancelDrag(); return; }
  commitText();
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
  refreshChrome();
}

const selected = () => state.shapes.find((s) => s.id === state.selected) || null;

/* ------------------------------------------------------- view transforms */

const toView = (x, y) => [
  (x - state.crop.x) * state.view.scale + state.view.x,
  (y - state.crop.y) * state.view.scale + state.view.y,
];
const toImage = (x, y) => [
  (x - state.view.x) / state.view.scale + state.crop.x,
  (y - state.view.y) / state.view.scale + state.crop.y,
];

const FIT_PAD = 28;

/* Whole shot inside the window, never above 1:1. */
function fit() {
  if (!state.image) return;
  const w = stage.clientWidth - FIT_PAD * 2;
  const h = stage.clientHeight - FIT_PAD * 2;
  const scale = Math.min(w / state.crop.w, h / state.crop.h, 1);
  state.view.scale = scale;
  state.view.x = (stage.clientWidth - state.crop.w * scale) / 2;
  state.view.y = (stage.clientHeight - state.crop.h * scale) / 2;
  state.view.mode = 'all';
  render();
}

/* Shot as wide as the window, top aligned so a long page starts at its head
   and reads down with the wheel. Never above 1:1; a short shot is centred. */
function fitWidth() {
  if (!state.image) return;
  const w = stage.clientWidth - FIT_PAD * 2;
  const h = stage.clientHeight - FIT_PAD * 2;
  const scale = Math.min(w / state.crop.w, 1);
  state.view.scale = scale;
  state.view.x = (stage.clientWidth - state.crop.w * scale) / 2;
  const shown = state.crop.h * scale;
  state.view.y = shown > h ? FIT_PAD : (stage.clientHeight - shown) / 2;
  state.view.mode = 'width';
  render();
}

/* True when fitting to width would show the shot larger than fitting it
   whole — i.e. the capture is taller than the window's shape. */
function enlargeable() {
  const w = stage.clientWidth - FIT_PAD * 2;
  const h = stage.clientHeight - FIT_PAD * 2;
  const widthScale = Math.min(w / state.crop.w, 1);
  const allScale = Math.min(widthScale, h / state.crop.h);
  return widthScale > allScale * 1.02;
}

function toggleFit() {
  if (state.view.mode === 'width') fit(); else fitWidth();
}

/* Window resized: stay at the fit the user chose. At width, keep whatever
   part of the shot is under the top edge, so a long page doesn't jump back
   to its head every time the window changes. */
function refit() {
  if (state.view.mode === 'width') {
    const [, topY] = toImage(0, FIT_PAD);
    fitWidth();
    const shown = state.crop.h * state.view.scale;
    if (shown > stage.clientHeight - FIT_PAD * 2) {
      const y = FIT_PAD - (topY - state.crop.y) * state.view.scale;
      state.view.y = Math.min(FIT_PAD, Math.max(stage.clientHeight - FIT_PAD - shown, y));
      render();
    }
  } else if (state.view.mode === 'all') fit();
  else render();
}

function zoomBy(factor, anchorX, anchorY) {
  if (!state.image) return;
  const ax = anchorX ?? stage.clientWidth / 2;
  const ay = anchorY ?? stage.clientHeight / 2;
  const [ix, iy] = toImage(ax, ay);
  state.view.scale = Math.min(8, Math.max(0.05, state.view.scale * factor));
  state.view.mode = null;
  state.view.x = ax - (ix - state.crop.x) * state.view.scale;
  state.view.y = ay - (iy - state.crop.y) * state.view.scale;
  render();
}

/* ---------------------------------------------------------------- drawing */

const dprOf = () => window.devicePixelRatio || 1;

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true });
// Separate from the pixelation scratch surface: masks may be painted into a lens.
const lensCanvas = document.createElement('canvas');
const lensContext = lensCanvas.getContext('2d');

function pixelate(target, cx, cy, cw, ch, cell, ratio) {
  const rx = typeof ratio === 'number' ? ratio : ratio.x;
  const ry = typeof ratio === 'number' ? ratio : ratio.y;
  if (cw < 1 || ch < 1) return;
  const sw = Math.max(1, Math.round(cw / cell));
  const sh = Math.max(1, Math.round(ch / cell));
  scratch.width = sw;
  scratch.height = sh;
  sctx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(target.canvas, cx * rx, cy * ry, cw * rx, ch * ry, 0, 0, sw, sh);
  target.ctx.imageSmoothingEnabled = false;
  target.ctx.drawImage(scratch, 0, 0, sw, sh, cx, cy, cw, ch);
  target.ctx.imageSmoothingEnabled = true;
}

/** Repaint original pixels and earlier annotations at the lens's final resolution.
 * Never magnify the downsampled viewport, or recursively magnify another lens.
 */
function loupe(target, shape, cx, cy, r, scale, ratio, sourceShapes) {
  if (r < 3) return;
  const rx = typeof ratio === 'number' ? ratio : ratio.x;
  const ry = typeof ratio === 'number' ? ratio : ratio.y;
  const power = Math.max(MIN_POWER, Math.min(MAX_POWER, shape.power));
  // Only allocate the visible portion, including for partly offscreen lenses.
  const left = Math.max(0, cx - r);
  const top = Math.max(0, cy - r);
  const right = Math.min(target.canvas.width / rx, cx + r);
  const bottom = Math.min(target.canvas.height / ry, cy + r);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;
  lensCanvas.width = Math.max(1, Math.ceil(width * rx));
  lensCanvas.height = Math.max(1, Math.ceil(height * ry));
  lensContext.setTransform(rx, 0, 0, ry, 0, 0);
  const magnifiedScale = scale * power;
  paint(
    { ctx: lensContext, canvas: lensCanvas }, magnifiedScale,
    cx - left - (shape.cx - state.crop.x) * magnifiedScale,
    cy - top - (shape.cy - state.crop.y) * magnifiedScale,
    ratio,
    sourceShapes.filter(s => s.type !== 'magnifier'),
    // At/above native pixels, preserve edges rather than soften them again.
    magnifiedScale * Math.max(rx, ry) < 1
  );

  const c = target.ctx;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.clip();
  c.fillStyle = '#fff';
  c.fill();
  c.imageSmoothingEnabled = false;
  c.drawImage(lensCanvas, 0, 0, width * rx, height * ry, left, top, width, height);
  c.restore();

  const rim = Math.max(1.5, r * 0.04);
  const hairline = Math.max(1, rim * 0.55);

  c.save();
  c.shadowColor = 'rgba(32,21,21,0.28)';
  c.shadowBlur = Math.max(2, r * 0.1);
  c.shadowOffsetY = Math.max(1, r * 0.04);
  c.beginPath();
  c.arc(cx, cy, r - rim / 2, 0, TAU);
  c.strokeStyle = shape.color;
  c.lineWidth = rim;
  c.stroke();
  c.restore();

  c.save();
  c.beginPath();
  c.arc(cx, cy, r - rim - hairline / 2, 0, TAU);
  c.strokeStyle = 'rgba(255,254,251,0.85)';
  c.lineWidth = hairline;
  c.stroke();
  c.restore();
}

function arrowPath(c, x1, y1, x2, y2, width) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(width * 3.2, 9);
  const backX = x2 - Math.cos(angle) * head * 0.82;
  const backY = y2 - Math.sin(angle) * head * 0.82;

  c.lineCap = 'round';
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(backX, backY);
  c.stroke();

  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(
    x2 - Math.cos(angle - 0.42) * head,
    y2 - Math.sin(angle - 0.42) * head
  );
  c.lineTo(backX, backY);
  c.lineTo(
    x2 - Math.cos(angle + 0.42) * head,
    y2 - Math.sin(angle + 0.42) * head
  );
  c.closePath();
  c.fill();
}

const measureCanvas = document.createElement('canvas');
const measureContext = measureCanvas.getContext('2d');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One measured layout for Chinese/Latin hit testing, plates and exported text. */
function textLayout(shape) {
  const size = shape.size;
  const px = Math.max(size * 0.24, 4);
  const py = Math.max(size * 0.18, 3);
  const cap = Math.max(size, shape.boxWidth || shape.maxWidth || state.crop.x + state.crop.w - shape.x - 2 * px);
  measureContext.font = `${shape.bold ? 700 : 400} ${size}px ${FONT}`;
  const lines = [];
  for (const paragraph of String(shape.text || '').split('\n')) {
    let line = '';
    for (const { segment } of graphemes.segment(paragraph)) {
      if (line && measureContext.measureText(line + segment).width > cap) {
        lines.push(line);
        line = '';
      }
      line += segment;
    }
    lines.push(line);
  }
  const width = shape.boxWidth ? cap : Math.max(size, ...lines.map(line => measureContext.measureText(line).width));
  return { lines, width, height: lines.length * size * 1.3, px, py, cap };
}

/** FixedShot's light-first text plate switches to dark for light ink. */
function contrastColors(color) {
  const channels = color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
  const [r, g, b] = channels.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const dark = 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) < 2.6;
  return { plate: dark ? 'rgba(24,26,31,0.9)' : 'rgba(255,255,255,0.92)', halo: dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.72)' };
}

function paintText(c, s, x, y, scale) {
  const layout = textLayout(s);
  const size = s.size * scale;
  const colors = contrastColors(s.color);
  const plate = s.plate || 'plain';
  if (plate !== 'plain') {
    c.beginPath();
    c.roundRect(x, y, (layout.width + 2 * layout.px) * scale, (layout.height + 2 * layout.py) * scale, Math.max(5, s.size * 0.36) * scale);
    if (plate === 'solid') { c.fillStyle = colors.plate; c.fill(); }
    c.strokeStyle = s.color;
    c.globalAlpha = 0.58;
    c.lineWidth = Math.max(1, scale);
    c.stroke();
    c.globalAlpha = 1;
  }
  c.font = `${s.bold ? 700 : 400} ${size}px ${FONT}`;
  c.textBaseline = 'alphabetic';
  const metrics = c.measureText('Mg中文');
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  const baseline = (size * 1.3 - ascent - descent) / 2 + ascent;
  c.fillStyle = s.color;
  layout.lines.forEach((line, i) => {
    const tx = x + layout.px * scale;
    const ty = y + layout.py * scale + i * size * 1.3 + baseline;
    if (plate === 'plain') {
      c.strokeStyle = colors.halo;
      c.lineWidth = Math.max(1, size * 0.1);
      c.strokeText(line, tx, ty);
    }
    c.fillText(line, tx, ty);
  });
}

/**
 * Paints image + shapes into `target` using an explicit scale and origin, so
 * the screen preview and the export share one code path.
 */
function paint(target, scale, ox, oy, ratio = 1, shapes = null, smoothImage = true) {
  const { ctx: c, canvas: cv } = target;
  const T = (x, y) => [(x - state.crop.x) * scale + ox, (y - state.crop.y) * scale + oy];

  c.save();
  c.clearRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = smoothImage;
  c.imageSmoothingQuality = 'high';
  c.drawImage(
    state.image,
    state.crop.x, state.crop.y, state.crop.w, state.crop.h,
    ox, oy, state.crop.w * scale, state.crop.h * scale
  );

  c.beginPath();
  c.rect(ox, oy, state.crop.w * scale, state.crop.h * scale);
  c.clip();
  const list = shapes ?? (state.draft ? [...state.shapes, state.draft] : state.shapes);

  for (const [index, s] of list.entries()) {
    if (target.canvas === canvas && s.id === state.editing) continue;
    c.save();
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const w = Math.max(0.1, (s.width || 1) * scale);
    c.lineWidth = w;
    if (s.lineStyle === 'dashed' && ['line', 'arrow', 'rect', 'ellipse'].includes(s.type)) c.setLineDash([w * 4, w * 3]);

    if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'mask' || s.type === 'highlight') {
      const [x, y] = T(Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h));
      const ww = Math.abs(s.w) * scale;
      const hh = Math.abs(s.h) * scale;
      if (s.type === 'highlight') {
        c.globalAlpha = 0.36;
        c.fillRect(x, y, ww, hh);
      } else if (s.type === 'mask') {
        if (s.maskStyle === 'opaque') {
          c.fillStyle = '#1c1d21';
          c.fillRect(x, y, ww, hh);
        } else {
          pixelate(target, x, y, ww, hh, Math.max(1, (s.strength || 16) * scale), ratio);
        }
      } else if (s.type === 'rect') {
        c.strokeRect(x + w / 2, y + w / 2, Math.max(0, ww - w), Math.max(0, hh - w));
      } else {
        c.beginPath();
        c.ellipse(x + ww / 2, y + hh / 2, Math.max(0, ww / 2 - w / 2), Math.max(0, hh / 2 - w / 2), 0, 0, TAU);
        c.stroke();
      }
    } else if (s.type === 'arrow' || s.type === 'line') {
      const [x1, y1] = T(s.x1, s.y1);
      const [x2, y2] = T(s.x2, s.y2);
      if (s.type === 'arrow') arrowPath(c, x1, y1, x2, y2, w);
      else { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
    } else if (s.type === 'pen') {
      c.beginPath();
      s.points.forEach((p, i) => {
        const [px, py] = T(p.x, p.y);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      if (s.points.length === 1) {
        const [x, y] = T(s.points[0].x, s.points[0].y);
        c.arc(x, y, w / 2, 0, TAU);
        c.fill();
      } else c.stroke();
    } else if (s.type === 'text') {
      const [x, y] = T(s.x, s.y);
      paintText(c, s, x, y, scale);
    } else if (s.type === 'number') {
      const [x, y] = T(s.x, s.y);
      c.beginPath(); c.arc(x, y, s.r * scale, 0, TAU); c.fill();
      c.strokeStyle = contrastColors(s.color).halo;
      c.lineWidth = Math.max(1, 2 * scale); c.stroke();
      c.fillStyle = contrastColors(s.color).plate;
      c.font = `700 ${s.r * 1.15 * scale}px ${FONT}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(s.number), x, y);
    } else if (s.type === 'magnifier') {
      const [x, y] = T(s.cx, s.cy);
      loupe(target, s, x, y, s.r * scale, scale, ratio, list.slice(0, index));
    }
    c.restore();
  }
  c.restore();
}

function drawHandles() {
  const s = selected();
  if (!s || state.editing) return;
  ctx.save();
  ctx.strokeStyle = '#ff4f00';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  const box = bounds(s);
  const [bx, by] = toView(box.x, box.y);
  const bw = box.w * state.view.scale;
  const bh = box.h * state.view.scale;
  ctx.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.setLineDash([]);
  for (const h of handlesOf(s)) {
    const [hx, hy] = toView(h.x, h.y);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#ff4f00';
    ctx.beginPath();
    ctx.rect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawCropOverlay() {
  if (state.tool !== 'crop') return;
  const r = state.cropRect;
  ctx.save();
  ctx.fillStyle = 'rgba(25,24,20,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (r) {
    const [x, y] = toView(Math.min(r.x, r.x + r.w), Math.min(r.y, r.y + r.h));
    const w = Math.abs(r.w) * state.view.scale;
    const h = Math.abs(r.h) * state.view.scale;
    ctx.clearRect(x, y, w, h);
    paintRegion(x, y, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText(
      `${Math.round(Math.abs(r.w))} × ${Math.round(Math.abs(r.h))}`,
      x + 6,
      Math.max(14, y - 6)
    );
  }
  ctx.restore();
}

/** Re-paints one rectangle of the composed image (used to punch through the crop scrim). */
function paintRegion(x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  paint({ ctx, canvas }, state.view.scale, state.view.x, state.view.y, dprOf());
  ctx.restore();
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(stage.clientWidth * dpr);
  const h = Math.round(stage.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
  if (!state.image) return;
  paint({ ctx, canvas }, state.view.scale, state.view.x, state.view.y, dprOf());
  drawCropOverlay();
  drawHandles();
  positionTextInput();
  if (selected()?.type === 'text' && document.activeElement !== $('fontSize')) $('fontSize').value = Math.round(selected().size * state.view.scale);
  $('zoomOutput').value = `${Math.round(state.view.scale * 100)}%`;
  refreshZoomChrome();
  maybeOfferPanHint();
}

/* Two controls, one rule: each offers the fit you are not at. The sub-bar
   button sits at width → offers the whole shot, anywhere else → offers width.
   The lens over the canvas is the long-image affordance: a "zoom in" pill in
   the middle of a shot that opened whole and small, which becomes a "fit all"
   pill in the corner once the shot is bigger than the window. It steps aside
   while a drawing tool is armed so it never sits on top of a stroke. */
function refreshZoomChrome() {
  const atWidth = state.view.mode === 'width';
  $('zoomFitWord').textContent = t(atWidth ? 'zoomFitAll' : 'zoomFitWidth');
  $('zoomFitKey').textContent = atWidth ? '⌘0' : '⌘1';
  $('zoomFit').title = t(atWidth ? 'zoomFitAllTitle' : 'zoomFitWidthTitle');

  const lens = $('lens');
  const atAll = state.view.mode === 'all';
  const show = state.image && state.tool === 'select' && !state.editing && !state.selected
    && (atAll ? enlargeable() && !state.shapes.length : true);
  lens.hidden = !show;
  if (!show) return;
  lens.dataset.state = atAll ? 'in' : 'out';
  $('lensWord').textContent = t(atAll ? 'lensIn' : 'zoomFitAll');
  $('lensKey').textContent = atAll ? '⌘1' : '⌘0';
  lens.title = t(atAll ? 'zoomFitWidthTitle' : 'zoomFitAllTitle');
}

/* ------------------------------------------------------------- geometry */

function bounds(s) {
  if (s.type === 'arrow' || s.type === 'line') {
    return {
      x: Math.min(s.x1, s.x2),
      y: Math.min(s.y1, s.y2),
      w: Math.abs(s.x2 - s.x1),
      h: Math.abs(s.y2 - s.y1),
    };
  }
  if (s.type === 'pen') {
    const xs = s.points.map((p) => p.x);
    const ys = s.points.map((p) => p.y);
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (s.type === 'text') {
    const layout = textLayout(s);
    return { x: s.x, y: s.y, w: layout.width + 2 * layout.px, h: layout.height + 2 * layout.py };
  }
  if (s.type === 'number') return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
  if (s.type === 'magnifier') {
    return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
  }
  return {
    x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h),
    w: Math.abs(s.w), h: Math.abs(s.h),
  };
}

function handlesOf(s) {
  if (s.type === 'arrow' || s.type === 'line') {
    return [{ k: 'p1', x: s.x1, y: s.y1 }, { k: 'p2', x: s.x2, y: s.y2 }];
  }
  if (s.type === 'magnifier') return [{ k: 'r', x: s.cx + s.r, y: s.cy }];
  if (s.type === 'pen' || s.type === 'number') return [];
  const b = bounds(s);
  if (s.type === 'text') {
    return [{ k: 'w', x: b.x, y: b.y + b.h / 2 }, { k: 'e', x: b.x + b.w, y: b.y + b.h / 2 }];
  }
  return [
    { k: 'nw', x: b.x, y: b.y },
    { k: 'ne', x: b.x + b.w, y: b.y },
    { k: 'sw', x: b.x, y: b.y + b.h },
    { k: 'se', x: b.x + b.w, y: b.y + b.h },
  ];
}

function hitShape(ix, iy) {
  const pad = 10 / state.view.scale;
  for (let i = state.shapes.length - 1; i >= 0; i -= 1) {
    const b = bounds(state.shapes[i]);
    if (ix >= b.x - pad && ix <= b.x + b.w + pad && iy >= b.y - pad && iy <= b.y + b.h + pad) {
      return state.shapes[i];
    }
  }
  return null;
}

function hitHandle(ix, iy) {
  const s = selected();
  if (!s) return null;
  const pad = (HANDLE + 3) / state.view.scale;
  return handlesOf(s).find((h) => Math.abs(h.x - ix) < pad && Math.abs(h.y - iy) < pad) || null;
}

/* -------------------------------------------------------------- pointers */

let drag = null;

let spaceHeld = false;

function setSpaceHeld(on) {
  if (spaceHeld === on) return;
  spaceHeld = on;
  stage.classList.toggle('grab', on && !!state.image);
  // The chip reports the mode instead of instructing: a user who has pressed
  // Space once never has to wonder again whether it took.
  $('panChip').dataset.armed = String(on);
  $('panWord').textContent = t(on ? 'panActive' : 'panIdle');
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || state.editing) return;
  if (e.target.matches('input, textarea, select') || e.target.isContentEditable) return;
  e.preventDefault(); // keeps Space from scrolling the stage or re-firing a focused button
  setSpaceHeld(true);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') setSpaceHeld(false);
});
window.addEventListener('blur', () => setSpaceHeld(false));

stage.addEventListener('pointerdown', (e) => {
  if (!state.image || (e.button !== 0 && e.button !== 1)) return;
  if (e.target.closest('textarea, button')) return;
  // Prevent the canvas's default mousedown from stealing the new editor's focus.
  e.preventDefault();
  if (state.editing) commitText();
  const rect = stage.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const [ix, iy] = toImage(vx, vy);

  // Pan is space-drag or middle-drag. Shift is reserved for the tools that
  // constrain with it (square / circle while drawing, aspect-locked resize);
  // when Shift also panned, those constraints were unreachable.
  if (spaceHeld || e.button === 1) {
    stage.setPointerCapture(e.pointerId);
    drag = { mode: 'pan', vx, vy, ox: state.view.x, oy: state.view.y };
    stage.classList.add('grabbing');
    return;
  }

  if (state.tool !== 'select' && !insideCrop(ix, iy)) return;
  if (state.tool !== 'text') stage.setPointerCapture(e.pointerId);

  if (state.tool === 'crop') {
    drag = { mode: 'crop', ix, iy };
    state.cropRect = { x: ix, y: iy, w: 0, h: 0 };
    return;
  }

  const handle = hitHandle(ix, iy);
  const hit = hitShape(ix, iy);
  // FixedShot leaves drawings unselected, then lets any annotation tool pick
  // them up directly; selecting V first is not required.
  if (state.tool === 'select' || handle || hit) {
    stage.setPointerCapture(e.pointerId);
    if (handle) {
      drag = { snapshot: snapshot(), mode: 'resize', handle: handle.k, start: { ix, iy }, before: JSON.parse(JSON.stringify(selected())) };
      return;
    }
    state.selected = hit ? hit.id : null;
    refreshChrome();
    if (hit) {
      drag = { snapshot: snapshot(), mode: 'move', ix, iy, before: JSON.parse(JSON.stringify(hit)) };
    }
    render();
    return;
  }

  if (state.tool === 'text') {
    startText(ix, iy);
    return;
  }

  if (state.tool === 'number') {
    commit();
    const shape = newShape('number', ix, iy);
    state.shapes.push(shape);
    state.selected = null;
    refreshChrome();
    render();
    return;
  }
  state.selected = null;
  state.draft = newShape(state.tool, ix, iy);
  drag = { mode: 'draw', ix, iy, snapshot: snapshot() };
  render();
});

stage.addEventListener('pointermove', (e) => {
  const rect = stage.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  if (!drag) return;
  const [ix, iy] = toImage(vx, vy);

  if (drag.mode === 'pan') {
    if (state.view.mode === 'all') state.view.mode = null;
    state.view.x = drag.ox + (vx - drag.vx);
    state.view.y = drag.oy + (vy - drag.vy);
  } else if (drag.mode === 'crop') {
    state.cropRect = { x: drag.ix, y: drag.iy, w: ix - drag.ix, h: iy - drag.iy };
  } else if (drag.mode === 'draw') {
    updateDraft(state.draft, drag, ix, iy, e.shiftKey);
  } else if (drag.mode === 'move') {
    moveShape(selected(), drag.before, ix - drag.ix, iy - drag.iy);
  } else if (drag.mode === 'resize') {
    resizeShape(selected(), drag, ix, iy, e.shiftKey);
  }
  render();
});

function endDrag() {
  if (!drag) return;
  if (drag.mode === 'draw' && state.draft) {
    const b = bounds(state.draft);
    const tiny = b.w < 4 && b.h < 4 && state.draft.type !== 'pen';
    if (!tiny) {
      commit(drag.snapshot);
      state.shapes.push(state.draft);
      state.selected = null;
    }
    state.draft = null;
  }
  if ((drag.mode === 'move' || drag.mode === 'resize') && drag.snapshot !== snapshot()) commit(drag.snapshot);
  stage.classList.remove('grabbing');
  drag = null;
  refreshChrome();
  render();
}
stage.addEventListener('pointerup', endDrag);
function cancelDrag() {
  if (!drag) return;
  const before = drag.snapshot;
  drag = null;
  state.draft = null;
  state.cropRect = null;
  stage.classList.remove('grabbing');
  if (before) restore(before);
  refreshChrome();
  render();
}
stage.addEventListener('pointercancel', cancelDrag);
stage.addEventListener('lostpointercapture', cancelDrag);

stage.addEventListener('dblclick', (e) => {
  if (e.target.closest('textarea, button') || state.editing || state.tool === 'crop') return;
  const rect = stage.getBoundingClientRect();
  const [ix, iy] = toImage(e.clientX - rect.left, e.clientY - rect.top);
  const hit = hitShape(ix, iy);
  if (hit && hit.type === 'text') {
    state.selected = hit.id;
    startText(hit.x, hit.y, hit);
  }
});

stage.addEventListener('wheel', (e) => {
  if (!state.image || e.target === textInput) return;
  e.preventDefault();
  const rect = stage.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  } else {
    state.view.x -= e.deltaX;
    state.view.y -= e.deltaY;
    if (state.view.mode === 'all') state.view.mode = null;
    render();
  }
}, { passive: false });

function insideCrop(x, y) {
  return x >= state.crop.x && x <= state.crop.x + state.crop.w && y >= state.crop.y && y <= state.crop.y + state.crop.h;
}

function constrainedEnd(x, y, ex, ey, constrain) {
  if (!constrain) return { x: ex, y: ey };
  const angle = Math.round(Math.atan2(ey - y, ex - x) / (Math.PI / 4)) * Math.PI / 4;
  const length = Math.hypot(ex - x, ey - y);
  return { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
}

/* ---------------------------------------------------------------- shapes */

function newShape(type, x, y) {
  const base = { id: nextId++, type, color: state.color, width: state.stroke, lineStyle: state.lineStyle };
  if (type === 'number') return { ...base, x, y, r: 16 / state.view.scale, number: Math.max(0, ...state.shapes.filter(s => s.type === 'number').map(s => s.number)) + 1 };
  if (type === 'highlight') return { ...base, color: state.highlightColor, x, y, w: 0, h: 0 };
  if (type === 'arrow' || type === 'line') return { ...base, x1: x, y1: y, x2: x, y2: y };
  if (type === 'pen') return { ...base, points: [{ x, y }] };
  if (type === 'magnifier') return { ...base, cx: x, cy: y, r: 1, power: state.power };
  if (type === 'mask') return { ...base, x, y, w: 0, h: 0, maskStyle: state.maskStyle, strength: state.maskStrength };
  return { ...base, x, y, w: 0, h: 0 };
}

function updateDraft(s, start, ix, iy, square) {
  if (s.type === 'arrow' || s.type === 'line') {
    const end = constrainedEnd(start.ix, start.iy, ix, iy, square);
    s.x2 = end.x;
    s.y2 = end.y;
  } else if (s.type === 'pen') {
    s.points.push({ x: ix, y: iy });
  } else if (s.type === 'magnifier') {
    s.r = Math.max(6, Math.hypot(ix - start.ix, iy - start.iy));
    s.cx = start.ix;
    s.cy = start.iy;
  } else {
    let w = ix - start.ix;
    let h = iy - start.iy;
    if (square) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = (Math.sign(w) || 1) * m;
      h = (Math.sign(h) || 1) * m;
    }
    s.w = w;
    s.h = h;
  }
}

function moveShape(s, before, dx, dy) {
  if (!s) return;
  if (s.type === 'arrow' || s.type === 'line') {
    s.x1 = before.x1 + dx; s.y1 = before.y1 + dy;
    s.x2 = before.x2 + dx; s.y2 = before.y2 + dy;
  } else if (s.type === 'pen') {
    s.points = before.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  } else if (s.type === 'magnifier') {
    s.cx = before.cx + dx; s.cy = before.cy + dy;
  } else {
    s.x = before.x + dx; s.y = before.y + dy;
  }
}

function resizeShape(s, d, ix, iy, square) {
  if (!s) return;
  const b = d.before;
  if (s.type === 'arrow' || s.type === 'line') {
    const movingStart = d.handle === 'p1';
    const end = constrainedEnd(movingStart ? b.x2 : b.x1, movingStart ? b.y2 : b.y1, ix, iy, square);
    if (movingStart) { s.x1 = end.x; s.y1 = end.y; } else { s.x2 = end.x; s.y2 = end.y; }
    return;
  }
  if (s.type === 'magnifier') {
    // Keep the sampled source radius stable: enlarging the lens enlarges its
    // content, rather than just showing more pixels at an unchanged power.
    const sourceRadius = b.r / b.power;
    const requestedRadius = Math.max(8, Math.hypot(ix - b.cx, iy - b.cy));
    s.power = Math.max(MIN_POWER, Math.min(MAX_POWER, requestedRadius / sourceRadius));
    s.r = sourceRadius * s.power;
    $('power').value = s.power;
    $('powerOut').value = `${s.power.toFixed(1)}×`;
    return;
  }
  if (s.type === 'text') {
    const box = bounds(b);
    const inset = textLayout(b).px * 2;
    const minimum = b.size + inset;
    if (d.handle === 'w') {
      s.x = Math.min(ix, box.x + box.w - minimum);
      s.boxWidth = box.x + box.w - s.x - inset;
    } else s.boxWidth = Math.max(minimum, ix - box.x) - inset;
    return;
  }
  const left = Math.min(b.x, b.x + b.w);
  const top = Math.min(b.y, b.y + b.h);
  const right = left + Math.abs(b.w);
  const bottom = top + Math.abs(b.h);
  let x1 = d.handle.includes('w') ? ix : left;
  let y1 = d.handle.includes('n') ? iy : top;
  let x2 = d.handle.includes('e') ? ix : right;
  let y2 = d.handle.includes('s') ? iy : bottom;
  if (square) {
    const m = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (d.handle.includes('w')) x1 = x2 - m; else x2 = x1 + m;
    if (d.handle.includes('n')) y1 = y2 - m; else y2 = y1 + m;
  }
  s.x = Math.min(x1, x2);
  s.y = Math.min(y1, y2);
  s.w = Math.abs(x2 - x1);
  s.h = Math.abs(y2 - y1);
}

/* ------------------------------------------------------------------ text */

let textBefore = null;
let composing = false;

/** Text edits are a transaction: Escape restores it, completion records it once. */
function startText(ix, iy, existing) {
  if (state.editing) commitText();
  textBefore = snapshot();
  const size = state.fontSize / state.view.scale;
  const shape = existing || {
    ...newShape('text', ix, iy), size, text: '', bold: state.textBold, plate: state.textPlate,
    x: Math.min(ix, state.crop.x + state.crop.w - size * 2),
    y: Math.min(iy, state.crop.y + state.crop.h - size * 1.8),
  };
  if (!existing) {
    shape.x = Math.max(state.crop.x, shape.x);
    shape.y = Math.max(state.crop.y, shape.y);
    shape.maxWidth = Math.max(size, state.crop.x + state.crop.w - shape.x - 2 * Math.max(size * 0.24, 4));
    state.shapes.push(shape);
  }
  state.selected = shape.id;
  state.editing = shape.id;
  setSpaceHeld(false);
  textInput.hidden = false;
  textInput.value = shape.text || '';
  textInput.placeholder = t('textPlaceholder');
  textInput.setAttribute('aria-label', t('toolText'));
  $('textHint').hidden = false;
  refreshChrome();
  render();
  textInput.focus({ preventScroll: true });
  textInput.setSelectionRange(textInput.value.length, textInput.value.length);
}

function positionTextInput() {
  if (!state.editing) return;
  const shape = selected();
  if (!shape) return;
  const scale = state.view.scale;
  const layout = textLayout(shape);
  const [vx, vy] = toView(shape.x, shape.y);
  const natural = textLayout({ ...shape, text: shape.text || t('textPlaceholder') });
  const colors = contrastColors(shape.color);
  Object.assign(textInput.style, {
    left: `${vx}px`, top: `${vy}px`, fontSize: `${shape.size * scale}px`,
    fontWeight: shape.bold ? '700' : '400', color: shape.color,
    background: shape.plate === 'solid' ? colors.plate : 'transparent',
    textShadow: shape.plate === 'plain' ? `0 0 2px ${colors.halo}` : 'none',
    padding: `${layout.py * scale}px ${layout.px * scale}px`,
    borderRadius: `${Math.max(5, shape.size * 0.36) * scale}px`,
    width: `${Math.min(layout.cap, natural.width + 1 / scale) * scale}px`,
    height: `${layout.height * scale}px`,
  });
}

function finishText(cancel = false) {
  if (!state.editing) return;
  const shape = selected();
  if (cancel) {
    state.shapes = JSON.parse(textBefore).shapes;
  } else if (shape) {
    shape.text = textInput.value.trim();
    if (!shape.text) state.shapes = state.shapes.filter(s => s !== shape);
    if (snapshot() !== textBefore) commit(textBefore);
  }
  state.editing = null;
  textBefore = null;
  composing = false;
  textInput.hidden = true;
  $('textHint').hidden = true;
  state.selected = null;
  setTool('select');
}

function commitText() { finishText(false); }

// Native text selection must never bubble into canvas drawing or capture.
textInput.addEventListener('pointerdown', e => e.stopPropagation());
textInput.addEventListener('dblclick', e => e.stopPropagation());
textInput.addEventListener('input', () => {
  const shape = selected();
  if (!state.editing || !shape) return;
  shape.text = textInput.value;
  render();
});
textInput.addEventListener('compositionstart', () => { composing = true; });
textInput.addEventListener('compositionend', () => { composing = false; });
textInput.addEventListener('blur', e => {
  // Properties can take focus without ending text entry.
  if (e.relatedTarget?.closest('#styleGroup, #textGroup')) return;
  commitText();
});
textInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.isComposing || composing || e.keyCode === 229) return;
  if (e.key === 'Escape') { e.preventDefault(); finishText(true); }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveImage(); }
});

/* --------------------------------------------------------------- export */

async function renderToBlob() {
  endDrag();
  commitText();
  if (!state.image) throw new Error('no image');
  if (state.out.w > 32767 || state.out.h > 32767 || state.out.w * state.out.h > 2 ** 28) {
    throw new Error('export exceeds canvas limits');
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(state.out.w));
  out.height = Math.max(1, Math.round(state.out.h));
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, out.width, out.height);
  const scaleX = out.width / state.crop.w;
  const scaleY = out.height / state.crop.h;
  // paint uses a uniform logical scale; stretch its final composition in Y.
  octx.setTransform(1, 0, 0, scaleY / scaleX, 0, 0);
  paint({ ctx: octx, canvas: out }, scaleX, 0, 0, { x: 1, y: scaleY / scaleX });
  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), 'image/png');
  });
}

let toastTimer = null;
/* The pan hint is taught once, the first time the shot overflows the window:
   never on open (fit() has just sized it to fit), but right after the lens or
   a zoom takes it past that, which is exactly when panning starts to matter. */
const PAN_HINT_KEY = 'longshot.panHintSeen';
let viewReady = false;
let panHintDone = true;
try { panHintDone = localStorage.getItem(PAN_HINT_KEY) === '1'; } catch { panHintDone = true; }

function maybeOfferPanHint() {
  if (panHintDone || !viewReady || !state.image) return;
  const overflows = state.crop.w * state.view.scale > stage.clientWidth + 1
    || state.crop.h * state.view.scale > stage.clientHeight + 1;
  if (!overflows) return;
  panHintDone = true;
  try { localStorage.setItem(PAN_HINT_KEY, '1'); } catch { /* private mode */ }

  const key = document.createElement('kbd');
  key.textContent = 'Space';
  const text = document.createElement('span');
  text.textContent = t('panHint');
  const el = $('toast');
  el.replaceChildren(key, text);
  el.classList.add('with-key');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

function toast(message) {
  const el = $('toast');
  el.classList.remove('with-key');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

async function copyImage() {
  try {
    const blob = await renderToBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(t('copied'));
  } catch {
    toast(t('copyFailed'));
  }
}

async function saveImage() {
  try {
    const blob = await renderToBlob();
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: `Longshot/${state.name}` });
      toast(t('savedToast'));
    } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  } catch { toast(t('saveFailed')); }
}

/* ---------------------------------------------------------------- chrome */

/** Selected annotations determine the property bar, as in FixedShot. */
function propertyType() { return selected()?.type || state.tool; }

function refreshChrome() {
  $('undo').disabled = !state.history.length;
  $('redo').disabled = !state.future.length;
  $('copy').disabled = $('save').disabled = !state.image;
  const s = selected();
  const type = propertyType();
  const stroke = s?.width ?? state.stroke;
  const color = s?.color || (type === 'highlight' ? state.highlightColor : state.color);
  $('zoomGroup').hidden = type !== 'magnifier';
  $('cropGroup').hidden = state.tool !== 'crop';
  $('styleGroup').hidden = ['crop', 'select', 'mask'].includes(type);
  $('strokeGroup').hidden = !['pen', 'line', 'arrow', 'rect', 'ellipse'].includes(type);
  $('lineGroup').hidden = !['line', 'arrow', 'rect', 'ellipse'].includes(type);
  $('textGroup').hidden = type !== 'text';
  $('maskGroup').hidden = type !== 'mask';
  $('selectionGroup').hidden = !s || !!state.editing;
  $('textHint').hidden = !state.editing;
  $('stroke').value = stroke;
  $('strokeOut').value = `${stroke}px`;
  $('power').value = s?.power ?? state.power;
  $('powerOut').value = `${Number($('power').value).toFixed(1)}×`;
  $('lineStyle').value = s?.lineStyle || state.lineStyle;
  $('fontSize').value = Math.round(s?.type === 'text' ? s.size * state.view.scale : state.fontSize);
  $('textBold').setAttribute('aria-pressed', String(s?.bold ?? state.textBold));
  $('textPlate').value = s?.plate || state.textPlate;
  $('maskStyle').value = s?.maskStyle || state.maskStyle;
  $('maskStrength').value = s?.strength || state.maskStrength;
  $('maskStrength').disabled = $('maskStyle').value === 'opaque';
  $('customColor').value = color;
  const palette = type === 'highlight' ? HIGHLIGHTS : SWATCHES;
  for (const [i, button] of [...$('swatches').children].entries()) {
    button.hidden = i >= palette.length;
    if (button.hidden) continue;
    button.dataset.color = palette[i];
    button.style.background = palette[i];
    button.title = palette[i];
    button.setAttribute('aria-label', `${t('colorLabel')} ${palette[i]}`);
    button.setAttribute('aria-pressed', String(palette[i] === color));
  }
  $('fileDims').textContent = `${Math.round(state.out.w)} × ${Math.round(state.out.h)}`;
  $('outW').value = Math.round(state.out.w);
  $('outH').value = Math.round(state.out.h);
  $('lockRatio').setAttribute('aria-pressed', String(state.out.lock));
}

function setTool(tool) {
  if (state.editing) commitText();
  if (drag) cancelDrag();
  state.tool = tool;
  if (tool !== 'select') state.selected = null;
  if (tool !== 'crop') state.cropRect = null;
  for (const b of $('tools').querySelectorAll('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }
  stage.classList.toggle('draw', tool !== 'select');
  stage.classList.toggle('text-tool', tool === 'text');
  refreshChrome();
  render();
}

function applyStyleToSelection(patch, record = true) {
  const s = selected();
  if (!s || Object.entries(patch).every(([key, value]) => s[key] === value)) return;
  if (record && !state.editing) commit();
  Object.assign(s, patch);
  refreshChrome();
  render();
}

function chooseColor(color, record = true) {
  if (propertyType() === 'highlight') state.highlightColor = color;
  else state.color = color;
  applyStyleToSelection({ color }, record);
  refreshChrome();
}

function buildSwatches() {
  $('swatches').replaceChildren(...SWATCHES.map(color => {
    const button = document.createElement('button');
    button.dataset.color = color;
    button.addEventListener('click', () => chooseColor(button.dataset.color));
    return button;
  }));
}

function deleteSelection() {
  if (!state.selected || state.editing) return;
  commit();
  state.shapes = state.shapes.filter(s => s.id !== state.selected);
  state.selected = null;
  refreshChrome();
  render();
}

function duplicateSelection() {
  const original = selected();
  if (!original || state.editing) return;
  commit();
  const copy = structuredClone(original);
  copy.id = nextId++;
  moveShape(copy, original, 16 / state.view.scale, 16 / state.view.scale);
  if (copy.type === 'number') copy.number = Math.max(...state.shapes.filter(s => s.type === 'number').map(s => s.number)) + 1;
  state.shapes.push(copy);
  state.selected = copy.id;
  refreshChrome();
  render();
}

function syncOut(source) {
  const ratio = state.crop.w / state.crop.h;
  if (state.out.lock && source) {
    if (source === 'w') state.out.h = Math.max(1, Math.round(state.out.w / ratio));
    else state.out.w = Math.max(1, Math.round(state.out.h * ratio));
  }
  $('outW').value = Math.round(state.out.w);
  $('outH').value = Math.round(state.out.h);
  refreshChrome();
}

/* ------------------------------------------------------------- shortcuts */

const TOOL_KEYS = {
  v: 'select', k: 'crop', x: 'crop', p: 'pen', l: 'line', a: 'arrow', h: 'highlight', n: 'number',
  r: 'rect', o: 'ellipse', m: 'magnifier', b: 'mask', t: 'text',
};

window.addEventListener('keydown', (e) => {
  if (state.editing) return;
  if (e.target.matches('input, textarea, select') || e.target.isContentEditable || e.isComposing) return;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveImage(); return; }
  if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copyImage(); return; }
  if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
  if (mod && e.key === '1') { e.preventDefault(); fitWidth(); return; }
  if (mod) return;

  if (e.key.toLowerCase() === 'c') { e.preventDefault(); copyImage(); return; }
  if (e.key === 'Escape') {
    if (drag) cancelDrag();
    // One press both drops the selection and disarms the tool. Splitting them
    // over two presses made Escape look broken: a freshly drawn shape is
    // selected, so the first press only deselected and left the tool armed.
    const wasSelected = state.selected !== null;
    state.selected = null;
    if (state.tool !== 'select') setTool('select');
    else if (wasSelected) { refreshChrome(); render(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selected) return;
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (selected() && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) / state.view.scale;
    commit();
    const shape = selected();
    moveShape(shape, structuredClone(shape), e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    render();
    return;
  }
  if (e.key === 'Enter' && state.tool === 'crop' && state.cropRect) { applyCrop(); return; }
  const tool = TOOL_KEYS[e.key.toLowerCase()];
  if (tool) { e.preventDefault(); setTool(tool); }
});

/* ------------------------------------------------------------------ crop */

function applyCrop() {
  const r = state.cropRect;
  if (!r || Math.abs(r.w) < 8 || Math.abs(r.h) < 8) return;
  const x = Math.max(state.crop.x, Math.min(r.x, r.x + r.w));
  const y = Math.max(state.crop.y, Math.min(r.y, r.y + r.h));
  const right = Math.min(state.crop.x + state.crop.w, Math.max(r.x, r.x + r.w));
  const bottom = Math.min(state.crop.y + state.crop.h, Math.max(r.y, r.y + r.h));
  const w = Math.floor(right - x);
  const h = Math.floor(bottom - y);
  if (w < 8 || h < 8) return;
  commit();
  state.crop = { x, y, w, h };
  state.out = { w, h, lock: state.out.lock };
  state.cropRect = null;
  setTool('select');
  syncOut('w');
  fit();
}

/* ------------------------------------------------------------------ wire */

$('tools').addEventListener('click', (e) => {
  const b = e.target.closest('.tool');
  if (b) setTool(b.dataset.tool);
});
$('undo').addEventListener('click', () => { undo(); render(); });
$('redo').addEventListener('click', () => { redo(); render(); });
$('copy').addEventListener('click', copyImage);
$('save').addEventListener('click', saveImage);
$('applyCrop').addEventListener('click', applyCrop);
$('cancelCrop').addEventListener('click', () => { state.cropRect = null; setTool('select'); });
$('zoomIn').addEventListener('click', () => zoomBy(1.2));
$('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
$('zoomFit').addEventListener('click', toggleFit);
$('lens').addEventListener('click', toggleFit);
// The lens lives inside the stage; a press on it must not start a drag.
$('lens').addEventListener('pointerdown', (e) => e.stopPropagation());

// Keep text focus when clicking style buttons; form fields may still take focus.
$('sub').addEventListener('pointerdown', e => {
  if (state.editing && e.target.closest('#styleGroup, #textGroup') && e.target.closest('button')) e.preventDefault();
});
$('textBold').addEventListener('click', () => {
  state.textBold = !(selected()?.bold ?? state.textBold);
  applyStyleToSelection({ bold: state.textBold });
  refreshChrome();
});
$('textPlate').addEventListener('change', () => {
  state.textPlate = $('textPlate').value;
  applyStyleToSelection({ plate: state.textPlate });
  textInputFocus();
});
$('fontSize').addEventListener('change', () => {
  state.fontSize = Math.min(96, Math.max(12, Number($('fontSize').value) || 22));
  applyStyleToSelection({ size: state.fontSize / state.view.scale });
  refreshChrome();
  textInputFocus();
});
function textInputFocus() { if (state.editing) textInput.focus({ preventScroll: true }); }
$('lineStyle').addEventListener('change', () => {
  state.lineStyle = $('lineStyle').value;
  applyStyleToSelection({ lineStyle: state.lineStyle });
});
$('maskStyle').addEventListener('change', () => {
  state.maskStyle = $('maskStyle').value;
  applyStyleToSelection({ maskStyle: state.maskStyle });
  refreshChrome();
});

/** A slider/color-picker gesture is one undo step, independent of input count. */
function bindContinuousStyle(id, update) {
  const input = $(id);
  let before = null;
  input.addEventListener('input', () => {
    if (!state.editing && before === null) before = snapshot();
    update(input.value);
    refreshChrome();
    render();
  });
  const finish = () => {
    if (before !== null && before !== snapshot()) commit(before);
    before = null;
  };
  input.addEventListener('change', finish);
  input.addEventListener('blur', finish);
}
bindContinuousStyle('stroke', value => {
  state.stroke = Number(value);
  applyStyleToSelection({ width: state.stroke }, false);
});
bindContinuousStyle('power', value => {
  state.power = Number(value);
  applyStyleToSelection({ power: state.power }, false);
});
bindContinuousStyle('maskStrength', value => {
  state.maskStrength = Number(value);
  applyStyleToSelection({ strength: state.maskStrength }, false);
});
bindContinuousStyle('customColor', value => chooseColor(value, false));
$('duplicateShape').addEventListener('click', duplicateSelection);
$('deleteShape').addEventListener('click', deleteSelection);
$('lockRatio').addEventListener('click', () => {
  commit();
  state.out.lock = !state.out.lock;
  refreshChrome();
});
for (const dimension of ['w', 'h']) {
  const input = $(dimension === 'w' ? 'outW' : 'outH');
  input.addEventListener('change', () => {
    const value = Math.min(32767, Math.max(1, Math.round(Number(input.value) || 1)));
    if (value !== state.out[dimension]) {
      commit();
      state.out[dimension] = value;
      syncOut(dimension);
    } else refreshChrome();
  });
}
$('resetSize').addEventListener('click', () => {
  if (state.out.w === state.crop.w && state.out.h === state.crop.h) return;
  commit();
  state.out.w = state.crop.w;
  state.out.h = state.crop.h;
  syncOut();
});

window.addEventListener('resize', refit);

/* ------------------------------------------------------------------ boot */

(async () => {
  localizeDocument();
  for (const button of $('tools').querySelectorAll('.tool')) {
    button.title += ` (${button.dataset.key})`;
    button.setAttribute('aria-label', button.title);
  }
  refreshZoomChrome();
  buildSwatches();
  $('colorLabel').textContent = t('colorLabel');
  $('stroke').value = state.stroke;
  $('strokeOut').value = `${state.stroke}px`;
  $('power').value = state.power;
  $('powerOut').value = `${state.power.toFixed(1)}×`;

  const params = new URLSearchParams(location.search);
  state.name = params.get('name') || state.name;
  $('fileName').textContent = state.name;

  const src = params.get('src');
  try {
    if (!src) throw new Error('no source');
    const blob = await (await fetch(src)).blob();
    state.image = await createImageBitmap(blob);
  } catch {
    $('placeholder').textContent = t('loadFailed');
    return;
  }

  await document.fonts.ready;
  chrome.runtime.sendMessage({ type: 'LS_EDITOR_READY' }).catch(() => {});

  state.crop = { x: 0, y: 0, w: state.image.width, h: state.image.height };
  state.out = { w: state.image.width, h: state.image.height, lock: true };
  $('placeholder').hidden = true;
  syncOut('w');
  refreshChrome();
  $('panWord').textContent = t('panIdle');
  viewReady = true;
  fit();
})();
