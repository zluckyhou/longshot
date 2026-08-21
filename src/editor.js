import { localizeDocument, t } from './i18n.js';

const TAU = Math.PI * 2;
// FixedShot's ink presets, same order and same values, so an annotation drawn
// in one tool matches one drawn in the other.
const SWATCHES = [
  '#ff4f00', '#146cff', '#e5484d', '#1a996e',
  '#c43da6', '#f2ae1f', '#1c1d21', '#ffffff',
];
const HANDLE = 7;
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
  power: 2.5,
  view: { scale: 1, x: 0, y: 0 },
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

function commit() {
  state.history.push(snapshot());
  if (state.history.length > 80) state.history.shift();
  state.future.length = 0;
  refreshChrome();
}

function restore(json) {
  const s = JSON.parse(json);
  state.crop = s.crop;
  state.shapes = s.shapes;
  state.out = s.out;
  state.selected = null;
  fit();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
  refreshChrome();
}

function redo() {
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

function fit() {
  const pad = 28;
  const w = stage.clientWidth - pad * 2;
  const h = stage.clientHeight - pad * 2;
  const scale = Math.min(w / state.crop.w, h / state.crop.h, 1);
  state.view.scale = scale;
  state.view.x = (stage.clientWidth - state.crop.w * scale) / 2;
  state.view.y = (stage.clientHeight - state.crop.h * scale) / 2;
  render();
}

function zoomBy(factor, anchorX, anchorY) {
  const ax = anchorX ?? stage.clientWidth / 2;
  const ay = anchorY ?? stage.clientHeight / 2;
  const [ix, iy] = toImage(ax, ay);
  state.view.scale = Math.min(8, Math.max(0.05, state.view.scale * factor));
  state.view.x = ax - (ix - state.crop.x) * state.view.scale;
  state.view.y = ay - (iy - state.crop.y) * state.view.scale;
  render();
}

/* ---------------------------------------------------------------- drawing */

const dprOf = () => window.devicePixelRatio || 1;

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true });

function pixelate(target, cx, cy, cw, ch, cell, ratio) {
  if (cw < 1 || ch < 1) return;
  const sw = Math.max(1, Math.round(cw / cell));
  const sh = Math.max(1, Math.round(ch / cell));
  scratch.width = sw;
  scratch.height = sh;
  sctx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(target.canvas, cx * ratio, cy * ratio, cw * ratio, ch * ratio, 0, 0, sw, sh);
  target.ctx.imageSmoothingEnabled = false;
  target.ctx.drawImage(scratch, 0, 0, sw, sh, cx, cy, cw, ch);
  target.ctx.imageSmoothingEnabled = true;
}

function loupe(target, cx, cy, r, power, ratio, color) {
  const src = r / power;
  const size = Math.max(1, Math.round(src * 2 * ratio));
  scratch.width = size;
  scratch.height = size;
  sctx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, size, size);
  // Copy first: a canvas drawn onto itself with overlapping rects is fragile.
  sctx.drawImage(
    target.canvas,
    (cx - src) * ratio, (cy - src) * ratio, src * 2 * ratio, src * 2 * ratio,
    0, 0, size, size
  );

  const c = target.ctx;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.clip();
  c.fillStyle = '#fff';
  c.fill();
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(scratch, 0, 0, size, size, cx - r, cy - r, r * 2, r * 2);
  c.restore();

  const rim = Math.max(1.5, r * 0.04);
  const hairline = Math.max(1, rim * 0.55);

  c.save();
  c.shadowColor = 'rgba(32,21,21,0.28)';
  c.shadowBlur = Math.max(2, r * 0.1);
  c.shadowOffsetY = Math.max(1, r * 0.04);
  c.beginPath();
  c.arc(cx, cy, r - rim / 2, 0, TAU);
  c.strokeStyle = color;
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

function textLines(shape) {
  return String(shape.text || '').split('\n');
}

/**
 * Paints image + shapes into `target` using an explicit scale and origin, so
 * the screen preview and the export share one code path.
 */
function paint(target, scale, ox, oy, ratio = 1) {
  const { ctx: c, canvas: cv } = target;
  const T = (x, y) => [(x - state.crop.x) * scale + ox, (y - state.crop.y) * scale + oy];

  c.save();
  c.clearRect(0, 0, cv.width, cv.height);
  c.imageSmoothingQuality = 'high';
  c.drawImage(
    state.image,
    state.crop.x, state.crop.y, state.crop.w, state.crop.h,
    ox, oy, state.crop.w * scale, state.crop.h * scale
  );

  const list = state.draft ? [...state.shapes, state.draft] : state.shapes;

  for (const s of list) {
    c.save();
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const w = Math.max(1, (s.width || 1) * scale);
    c.lineWidth = w;

    if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'mask') {
      const [x, y] = T(Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h));
      const ww = Math.abs(s.w) * scale;
      const hh = Math.abs(s.h) * scale;
      if (s.type === 'mask') {
        pixelate(target, x, y, ww, hh, Math.max(4, 11 * scale), ratio);
      } else if (s.type === 'rect') {
        c.strokeRect(x + w / 2, y + w / 2, Math.max(0, ww - w), Math.max(0, hh - w));
      } else {
        c.beginPath();
        c.ellipse(x + ww / 2, y + hh / 2, Math.max(0, ww / 2 - w / 2), Math.max(0, hh / 2 - w / 2), 0, 0, TAU);
        c.stroke();
      }
    } else if (s.type === 'arrow') {
      const [x1, y1] = T(s.x1, s.y1);
      const [x2, y2] = T(s.x2, s.y2);
      arrowPath(c, x1, y1, x2, y2, w);
    } else if (s.type === 'pen') {
      c.beginPath();
      s.points.forEach((p, i) => {
        const [px, py] = T(p.x, p.y);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      c.stroke();
    } else if (s.type === 'text') {
      const [x, y] = T(s.x, s.y);
      const size = s.size * scale;
      c.font = `600 ${size}px ${FONT}`;
      c.textBaseline = 'top';
      textLines(s).forEach((line, i) => {
        c.fillText(line, x, y + i * size * 1.3);
      });
    } else if (s.type === 'magnifier') {
      const [x, y] = T(s.cx, s.cy);
      loupe(target, x, y, s.r * scale, s.power, ratio, s.color);
    }
    c.restore();
  }
  c.restore();
}

function drawHandles() {
  const s = selected();
  if (!s) return;
  ctx.save();
  ctx.strokeStyle = '#0091ff';
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
    ctx.strokeStyle = '#0091ff';
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
  $('zoomOutput').value = `${Math.round(state.view.scale * 100)}%`;
  maybeOfferPanHint();
}

/* ------------------------------------------------------------- geometry */

function bounds(s) {
  if (s.type === 'arrow') {
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
    const lines = textLines(s);
    const width = Math.max(...lines.map((l) => l.length)) * s.size * 0.56;
    return { x: s.x, y: s.y, w: Math.max(s.size, width), h: lines.length * s.size * 1.3 };
  }
  if (s.type === 'magnifier') {
    return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
  }
  return {
    x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h),
    w: Math.abs(s.w), h: Math.abs(s.h),
  };
}

function handlesOf(s) {
  if (s.type === 'arrow') {
    return [{ k: 'p1', x: s.x1, y: s.y1 }, { k: 'p2', x: s.x2, y: s.y2 }];
  }
  if (s.type === 'magnifier') return [{ k: 'r', x: s.cx + s.r, y: s.cy }];
  if (s.type === 'pen' || s.type === 'text') return [];
  const b = bounds(s);
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  e.preventDefault(); // keeps Space from scrolling the stage or re-firing a focused button
  setSpaceHeld(true);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') setSpaceHeld(false);
});
window.addEventListener('blur', () => setSpaceHeld(false));

stage.addEventListener('pointerdown', (e) => {
  if (!state.image || e.button !== 0) return;
  if (state.editing) commitText();
  stage.setPointerCapture(e.pointerId);
  const rect = stage.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const [ix, iy] = toImage(vx, vy);

  // Pan is space-drag or middle-drag. Shift is reserved for the tools that
  // constrain with it (square / circle while drawing, aspect-locked resize);
  // when Shift also panned, those constraints were unreachable.
  if (spaceHeld || e.button === 1) {
    drag = { mode: 'pan', vx, vy, ox: state.view.x, oy: state.view.y };
    stage.classList.add('grabbing');
    return;
  }

  if (state.tool === 'crop') {
    drag = { mode: 'crop', ix, iy };
    state.cropRect = { x: ix, y: iy, w: 0, h: 0 };
    return;
  }

  if (state.tool === 'select') {
    const handle = hitHandle(ix, iy);
    if (handle) {
      commit();
      drag = { mode: 'resize', handle: handle.k, start: { ix, iy }, before: JSON.parse(JSON.stringify(selected())) };
      return;
    }
    const hit = hitShape(ix, iy);
    state.selected = hit ? hit.id : null;
    refreshChrome();
    if (hit) {
      commit();
      drag = { mode: 'move', ix, iy, before: JSON.parse(JSON.stringify(hit)) };
    }
    render();
    return;
  }

  if (state.tool === 'text') {
    startText(ix, iy);
    return;
  }

  commit();
  state.draft = newShape(state.tool, ix, iy);
  drag = { mode: 'draw', ix, iy };
  render();
});

stage.addEventListener('pointermove', (e) => {
  const rect = stage.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  if (!drag) return;
  const [ix, iy] = toImage(vx, vy);

  if (drag.mode === 'pan') {
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
    if (tiny) {
      state.history.pop();
    } else {
      state.shapes.push(state.draft);
      state.selected = state.draft.id;
    }
    state.draft = null;
  }
  stage.classList.remove('grabbing');
  drag = null;
  refreshChrome();
  render();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener('dblclick', (e) => {
  const rect = stage.getBoundingClientRect();
  const [ix, iy] = toImage(e.clientX - rect.left, e.clientY - rect.top);
  const hit = hitShape(ix, iy);
  if (hit && hit.type === 'text') {
    state.selected = hit.id;
    startText(hit.x, hit.y, hit);
  }
});

stage.addEventListener('wheel', (e) => {
  if (!state.image) return;
  e.preventDefault();
  const rect = stage.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  } else {
    state.view.x -= e.deltaX;
    state.view.y -= e.deltaY;
    render();
  }
}, { passive: false });

/* ---------------------------------------------------------------- shapes */

function newShape(type, x, y) {
  const base = { id: nextId++, type, color: state.color, width: state.stroke };
  if (type === 'arrow') return { ...base, x1: x, y1: y, x2: x, y2: y };
  if (type === 'pen') return { ...base, points: [{ x, y }] };
  if (type === 'magnifier') return { ...base, cx: x, cy: y, r: 1, power: state.power };
  if (type === 'mask') return { ...base, x, y, w: 0, h: 0 };
  return { ...base, x, y, w: 0, h: 0 };
}

function updateDraft(s, start, ix, iy, square) {
  if (s.type === 'arrow') {
    s.x2 = ix;
    s.y2 = iy;
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
      w = Math.sign(w) * m;
      h = Math.sign(h) * m;
    }
    s.w = w;
    s.h = h;
  }
}

function moveShape(s, before, dx, dy) {
  if (!s) return;
  if (s.type === 'arrow') {
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
  if (s.type === 'arrow') {
    if (d.handle === 'p1') { s.x1 = ix; s.y1 = iy; } else { s.x2 = ix; s.y2 = iy; }
    return;
  }
  if (s.type === 'magnifier') {
    s.r = Math.max(8, Math.hypot(ix - s.cx, iy - s.cy));
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

function startText(ix, iy, existing) {
  const shape = existing || { ...newShape('text', ix, iy), size: Math.max(14, state.stroke * 5), text: '' };
  if (!existing) {
    commit();
    state.shapes.push(shape);
    state.selected = shape.id;
  }
  state.editing = shape.id;
  const [vx, vy] = toView(shape.x, shape.y);
  textInput.hidden = false;
  textInput.value = shape.text || '';
  textInput.placeholder = t('textPlaceholder');
  textInput.style.left = `${vx}px`;
  textInput.style.top = `${vy}px`;
  textInput.style.fontSize = `${shape.size * state.view.scale}px`;
  textInput.style.color = shape.color;
  textInput.style.width = `${Math.max(120, stage.clientWidth - vx - 30)}px`;
  textInput.style.height = `${shape.size * state.view.scale * 1.6}px`;
  textInput.focus();
  render();
}

function commitText() {
  const shape = state.shapes.find((s) => s.id === state.editing);
  state.editing = null;
  textInput.hidden = true;
  if (!shape) return;
  shape.text = textInput.value;
  if (!shape.text.trim()) {
    state.shapes = state.shapes.filter((s) => s !== shape);
    state.selected = null;
  }
  refreshChrome();
  render();
}

textInput.addEventListener('input', () => {
  const shape = state.shapes.find((s) => s.id === state.editing);
  if (!shape) return;
  shape.text = textInput.value;
  textInput.style.height = `${textInput.scrollHeight}px`;
  render();
});
textInput.addEventListener('blur', commitText);
textInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); commitText(); }
});

/* --------------------------------------------------------------- export */

async function renderToBlob() {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(state.out.w));
  out.height = Math.max(1, Math.round(state.out.h));
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, out.width, out.height);
  paint({ ctx: octx, canvas: out }, out.width / state.crop.w, 0, 0);
  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), 'image/png');
  });
}

let toastTimer = null;
/* The pan hint is taught once, and not on open: fit() has just sized the shot
   to the window, so panning is pointless until the user zooms past that. */
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
  const blob = await renderToBlob();
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: `Longshot/${state.name}` });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(t('savedToast'));
}

/* ---------------------------------------------------------------- chrome */

function refreshChrome() {
  $('undo').disabled = !state.history.length;
  $('redo').disabled = !state.future.length;
  const s = selected();
  const magnifying = state.tool === 'magnifier' || (s && s.type === 'magnifier');
  $('zoomGroup').hidden = !magnifying;
  $('cropGroup').hidden = state.tool !== 'crop';
  $('styleGroup').hidden = state.tool === 'crop';
  $('fileDims').textContent = `${Math.round(state.out.w)} × ${Math.round(state.out.h)}`;
}

function setTool(tool) {
  if (state.editing) commitText();
  state.tool = tool;
  if (tool !== 'select') state.selected = null;
  if (tool !== 'crop') state.cropRect = null;
  for (const b of $('tools').querySelectorAll('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }
  stage.classList.toggle('draw', tool !== 'select');
  refreshChrome();
  render();
}

function applyStyleToSelection(patch) {
  const s = selected();
  if (!s) return;
  commit();
  Object.assign(s, patch);
  render();
}

function buildSwatches() {
  const host = $('swatches');
  host.replaceChildren(
    ...SWATCHES.map((color) => {
      const b = document.createElement('button');
      b.style.background = color;
      b.setAttribute('aria-pressed', String(color === state.color));
      b.addEventListener('click', () => {
        state.color = color;
        for (const other of host.children) {
          other.setAttribute('aria-pressed', String(other === b));
        }
        applyStyleToSelection({ color });
      });
      return b;
    })
  );
}

function syncOut(source) {
  const ratio = state.crop.w / state.crop.h;
  if (state.out.lock) {
    if (source === 'w') state.out.h = Math.round(state.out.w / ratio);
    else state.out.w = Math.round(state.out.h * ratio);
  }
  $('outW').value = Math.round(state.out.w);
  $('outH').value = Math.round(state.out.h);
  refreshChrome();
}

/* ------------------------------------------------------------- shortcuts */

const TOOL_KEYS = {
  v: 'select', x: 'crop', p: 'pen', a: 'arrow',
  r: 'rect', o: 'ellipse', m: 'magnifier', b: 'mask', t: 'text',
};

window.addEventListener('keydown', (e) => {
  if (state.editing) return;
  if (e.target instanceof HTMLInputElement) return;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveImage(); return; }
  if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copyImage(); return; }
  if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
  if (mod) return;

  if (e.key.toLowerCase() === 'c') { e.preventDefault(); copyImage(); return; }
  if (e.key === 'Escape') {
    // One press both drops the selection and disarms the tool. Splitting them
    // over two presses made Escape look broken: a freshly drawn shape is
    // selected, so the first press only deselected and left the tool armed.
    const wasSelected = state.selected !== null;
    state.selected = null;
    if (state.tool !== 'select') setTool('select');
    else if (wasSelected) render();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selected) return;
    e.preventDefault();
    commit();
    state.shapes = state.shapes.filter((s) => s.id !== state.selected);
    state.selected = null;
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
  commit();
  const x = Math.max(state.crop.x, Math.min(r.x, r.x + r.w));
  const y = Math.max(state.crop.y, Math.min(r.y, r.y + r.h));
  const w = Math.min(Math.abs(r.w), state.crop.x + state.crop.w - x);
  const h = Math.min(Math.abs(r.h), state.crop.y + state.crop.h - y);
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
$('zoomFit').addEventListener('click', fit);

$('stroke').addEventListener('input', () => {
  state.stroke = Number($('stroke').value);
  $('strokeOut').value = `${state.stroke}px`;
  const s = selected();
  if (s) { Object.assign(s, s.type === 'text' ? { size: state.stroke * 5 } : { width: state.stroke }); render(); }
});
$('power').addEventListener('input', () => {
  state.power = Number($('power').value);
  $('powerOut').value = `${state.power.toFixed(1)}×`;
  const s = selected();
  if (s && s.type === 'magnifier') { s.power = state.power; render(); }
});
$('lockRatio').addEventListener('click', () => {
  state.out.lock = !state.out.lock;
  $('lockRatio').setAttribute('aria-pressed', String(state.out.lock));
});
$('outW').addEventListener('change', () => {
  state.out.w = Math.max(1, Number($('outW').value));
  syncOut('w');
});
$('outH').addEventListener('change', () => {
  state.out.h = Math.max(1, Number($('outH').value));
  syncOut('h');
});
$('resetSize').addEventListener('click', () => {
  state.out.w = state.crop.w;
  state.out.h = state.crop.h;
  syncOut('w');
});

window.addEventListener('resize', () => render());

/* ------------------------------------------------------------------ boot */

(async () => {
  localizeDocument();
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

  chrome.runtime.sendMessage({ type: 'LS_EDITOR_READY' }).catch(() => {});

  state.crop = { x: 0, y: 0, w: state.image.width, h: state.image.height };
  state.out = { w: state.image.width, h: state.image.height, lock: true };
  $('placeholder').hidden = true;
  syncOut('w');
  refreshChrome();
  $('panWord').textContent = t('panIdle');
  fit();
  viewReady = true;
})();
