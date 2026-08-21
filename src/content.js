/**
 * Longshot content script.
 *
 * Owns everything that needs real page context: finding what actually scrolls,
 * measuring it, neutralising fixed/sticky chrome so it does not repeat on every
 * screen, and stepping the scroll position between captures.
 *
 * Injected on demand by the service worker, so it must tolerate being
 * evaluated more than once in the same document.
 */
(() => {
  if (window.__LONGSHOT_CONTENT__) return;
  window.__LONGSHOT_CONTENT__ = true;

  const STYLE_ID = '__longshot_capture_style__';
  const VIS_ATTR = 'data-longshot-prev-visibility';
  const SCROLLABLE = 8; // px of overflow before we call something scrollable

  const state = {
    active: false,
    origScroll: { x: 0, y: 0 },
    target: null,
    styleEl: null,
    fixedEls: [],
    stickyPatched: [],
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const docScroller = () => document.scrollingElement || document.documentElement;

  function documentHeight() {
    const b = document.body;
    const e = document.documentElement;
    return Math.max(
      b ? b.scrollHeight : 0,
      b ? b.offsetHeight : 0,
      e.clientHeight,
      e.scrollHeight,
      e.offsetHeight
    );
  }

  /**
   * Plenty of sites (SPAs, mail clients, chat apps) pin the document and scroll
   * an inner container instead. Driving window.scrollTo on those pages does
   * nothing, which reads to the user as "it only captured what I could see".
   * So: use the document when it genuinely scrolls, otherwise pick the
   * scrollable element that dominates the viewport.
   */
  function findScrollTarget() {
    const de = docScroller();
    if (documentHeight() - window.innerHeight > SCROLLABLE) return null;
    if (!document.body) return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewportArea = vw * vh;
    let best = null;

    for (const el of document.body.querySelectorAll('*')) {
      if (el === de || el === document.body) continue;
      if (el.scrollHeight - el.clientHeight <= SCROLLABLE) continue;

      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;

      const r = el.getBoundingClientRect();
      const visible =
        Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) *
        Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      // Must own most of the screen — otherwise it is a sidebar or a dropdown.
      if (visible < viewportArea * 0.35) continue;

      const score = visible * (el.scrollHeight / Math.max(1, el.clientHeight));
      if (!best || score > best.score) best = { el, score };
    }

    return best ? best.el : null;
  }

  /** The viewport rectangle whose pixels we keep, in CSS px. */
  function frameOf(el) {
    if (!el) {
      return {
        x: 0,
        y: 0,
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      };
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const left = r.left + (parseFloat(cs.borderLeftWidth) || 0);
    const top = r.top + (parseFloat(cs.borderTopWidth) || 0);
    // Clip to the viewport — pixels outside it were never captured.
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    return {
      x,
      y,
      width: Math.max(1, Math.min(left + el.clientWidth, window.innerWidth) - x),
      height: Math.max(1, Math.min(top + el.clientHeight, window.innerHeight) - y),
    };
  }

  const scrollTopOf = (el) => (el ? el.scrollTop : window.scrollY);
  const maxScrollOf = (el) =>
    el
      ? Math.max(0, el.scrollHeight - el.clientHeight)
      : Math.max(0, documentHeight() - window.innerHeight);

  function setScrollTop(el, y) {
    if (el) el.scrollTop = y;
    else window.scrollTo(state.origScroll.x, y);
  }

  /** One pass over the DOM to classify position:fixed / position:sticky elements. */
  function collectPositioned() {
    const fixed = [];
    const sticky = [];
    if (!document.body) return { fixed, sticky };
    for (const el of document.body.querySelectorAll('*')) {
      let pos;
      try {
        pos = getComputedStyle(el).position;
      } catch {
        continue;
      }
      if (pos === 'fixed') fixed.push(el);
      else if (pos === 'sticky') sticky.push(el);
    }
    return { fixed, sticky };
  }

  function setFixedHidden(hidden) {
    for (const el of state.fixedEls) {
      if (!el.isConnected) continue;
      if (hidden) {
        if (el.hasAttribute(VIS_ATTR)) continue;
        el.setAttribute(VIS_ATTR, el.style.getPropertyValue('visibility'));
        el.style.setProperty('visibility', 'hidden', 'important');
      } else {
        if (!el.hasAttribute(VIS_ATTR)) continue;
        const prev = el.getAttribute(VIS_ATTR);
        el.removeAttribute(VIS_ATTR);
        if (prev) el.style.setProperty('visibility', prev);
        else el.style.removeProperty('visibility');
      }
    }
  }

  /**
   * position:sticky headers are demoted to static so they render exactly once,
   * at their natural place in the flow, instead of riding along with the viewport.
   */
  function unstick(stickyEls) {
    for (const el of stickyEls) {
      state.stickyPatched.push([
        el,
        el.style.getPropertyValue('position'),
        el.style.getPropertyPriority('position'),
      ]);
      el.style.setProperty('position', 'static', 'important');
    }
  }

  function restoreSticky() {
    for (const [el, value, priority] of state.stickyPatched) {
      if (value) el.style.setProperty('position', value, priority);
      else el.style.removeProperty('position');
    }
    state.stickyPatched = [];
  }

  function installStyle() {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // scroll-behavior on * because the scroller may be any element, not just html.
    style.textContent = `
      * { scroll-behavior: auto !important; }
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      *, *::before, *::after {
        transition: none !important;
        animation-play-state: paused !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    state.styleEl = style;
  }

  /** Walk the scroller once so lazy-loaded images and virtualised lists render. */
  async function preload(el, step, settleMs) {
    const limit = maxScrollOf(el);
    for (let y = 0; y < limit; y += step) {
      setScrollTop(el, y);
      await sleep(Math.min(settleMs, 120));
    }
    setScrollTop(el, limit);
    await sleep(Math.min(settleMs, 120));
    setScrollTop(el, 0);
    await sleep(settleMs);
  }

  async function prepare(opts) {
    if (state.active) cleanup();
    state.active = true;
    state.origScroll = { x: window.scrollX, y: window.scrollY };

    installStyle();

    const { fixed, sticky } = collectPositioned();
    state.fixedEls = fixed;
    if (opts.unstick) unstick(sticky);

    const target = findScrollTarget();
    state.target = target;
    if (target) state.origScroll.container = target.scrollTop;

    if (opts.preload) {
      await preload(target, Math.max(1, frameOf(target).height), opts.settleMs);
    }

    // Measure after preload — lazy content usually makes the scroller taller.
    const frame = frameOf(target);
    const maxScroll = maxScrollOf(target);

    // Overlap by a few pixels so rounding never leaves a hairline gap.
    const step = Math.max(1, frame.height - 4);
    const positions = [];
    for (let y = 0; y < maxScroll; y += step) positions.push(y);
    positions.push(maxScroll);

    setScrollTop(target, 0);
    await nextFrame();

    return {
      mode: target ? 'element' : 'document',
      frame,
      dpr: window.devicePixelRatio || 1,
      // What we can actually paint: the first frame plus everything scrolled past.
      contentHeight: maxScroll + frame.height,
      maxScroll,
      positions,
    };
  }

  async function scrollToStep(y, index, opts) {
    // Fixed chrome is kept for the very first screen so a site's header still
    // appears once, then hidden so it does not stamp itself onto every segment.
    if (opts.hideFixed) setFixedHidden(index > 0);
    setScrollTop(state.target, y);
    await sleep(opts.settleMs);
    await nextFrame();
    return { scrollTop: scrollTopOf(state.target) };
  }

  function cleanup() {
    setFixedHidden(false);
    restoreSticky();
    if (state.styleEl && state.styleEl.isConnected) state.styleEl.remove();
    state.styleEl = null;
    state.fixedEls = [];
    if (state.target && state.target.isConnected) {
      state.target.scrollTop = state.origScroll.container || 0;
    }
    state.target = null;
    window.scrollTo(state.origScroll.x, state.origScroll.y);
    state.active = false;
    return { ok: true };
  }

  const handlers = {
    LS_PING: async () => ({ ok: true }),
    LS_PREPARE: (msg) => prepare(msg.opts),
    LS_SCROLL_TO: (msg) => scrollToStep(msg.y, msg.index, msg.opts),
    LS_CLEANUP: async () => cleanup(),
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = msg && handlers[msg.type];
    if (!handler) return;
    Promise.resolve(handler(msg))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  });

  window.addEventListener('pagehide', () => {
    if (state.active) cleanup();
  });
})();
