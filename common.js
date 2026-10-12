/* Shared by the TV page and the phone page. */
(function () {
  'use strict';
  var F = window.Feud = {};

  // Change this to rename the game everywhere.
  F.TITLE = 'FRIEND FEUD';

  F.$ = function (sel, root) { return (root || document).querySelector(sel); };
  F.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  F.store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
  };

  /* ---- live connection with automatic reconnect ---- */
  F.connect = function (opts) {
    var ws = null, timer = null, tries = 0, stopped = false;
    function open() {
      timer = null;
      if (stopped) return;
      try {
        ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      } catch (e) { return retry(); }
      var mine = ws;
      mine.onopen = function () {
        tries = 0;
        if (opts.onStatus) opts.onStatus(true);
        var h = opts.hello && opts.hello();
        if (h) mine.send(JSON.stringify(h));
      };
      mine.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        opts.onMessage(m);
      };
      mine.onclose = function () {
        if (ws !== mine) return;
        if (opts.onStatus) opts.onStatus(false);
        retry();
      };
      mine.onerror = function () { try { mine.close(); } catch (e) { /* ignore */ } };
    }
    function retry() {
      if (stopped || timer) return;
      timer = setTimeout(open, Math.min(4000, 300 + 500 * tries++));
    }
    var api = {
      send: function (m) {
        if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
        return false;
      },
      stop: function () { stopped = true; if (timer) clearTimeout(timer); try { ws.close(); } catch (e) { /* ignore */ } }
    };
    open();
    setInterval(function () { api.send({ t: 'ping' }); }, 20000);
    // Keeps a free host from putting the server to sleep mid-party.
    setInterval(function () { try { fetch('/health').catch(function () {}); } catch (e) { /* ignore */ } }, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !stopped && (!ws || ws.readyState > 1)) {
        if (timer) { clearTimeout(timer); timer = null; }
        tries = 0; open();
      }
    });
    return api;
  };

  /* ---- keep the screen awake while the game is open ---- */
  F.stayAwake = function () {
    var lock = null;
    function ask() {
      if (!navigator.wakeLock || document.hidden) return;
      navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
    }
    ask();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ask(); });
    document.addEventListener('click', function once() { if (!lock) ask(); }, { passive: true });
  };

  /* ---- shrink text until it fits on one line ---- */
  F.fit = function (el, min) {
    el.style.fontSize = '';
    var size = parseFloat(getComputedStyle(el).fontSize);
    var floor = min || size * 0.45;
    var guard = 0;
    while (el.scrollWidth > el.clientWidth + 1 && size > floor && guard++ < 60) {
      size -= Math.max(1, size * 0.05);
      el.style.fontSize = size + 'px';
    }
  };

  /* ---- the answer board: 8 flip tiles, 1-4 down the left, 5-8 down the right ---- */
  F.Board = function (root) {
    root.classList.add('board');
    var tiles = [];
    for (var i = 0; i < 8; i++) {
      var t = document.createElement('div');
      t.className = 'tile blank';
      t.innerHTML = '<div class="flip"><div class="face front"><span class="num">' + (i + 1) +
        '</span></div><div class="face back"><span class="ans"></span><span class="pts"></span></div></div>';
      root.appendChild(t);
      tiles.push(t);
    }
    return {
      tiles: tiles,
      update: function (g, animate) {
        for (var i = 0; i < 8; i++) {
          var t = tiles[i];
          var exists = !!g && i < g.count;
          var slot = exists ? g.slots[i] : null;
          t.classList.toggle('blank', !exists);
          if (slot) {
            var ans = t.querySelector('.ans');
            if (ans.textContent !== slot.text) {
              ans.textContent = slot.text;
              t.querySelector('.pts').textContent = slot.pts;
            }
            if (!t.classList.contains('open')) {
              t.classList.toggle('instant', !animate);
              t.classList.add('open');
            }
            F.fit(ans);
          } else if (t.classList.contains('open')) {
            t.classList.add('instant');
            t.classList.remove('open');
          }
        }
      },
      refit: function () {
        for (var i = 0; i < 8; i++) if (tiles[i].classList.contains('open')) F.fit(tiles[i].querySelector('.ans'));
      }
    };
  };

  /* ---- motion helpers ---- */
  var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  F.motionOK = function () { return !(calm && calm.matches); };
  // A one-off animation that leaves no classes or styles behind. Does nothing when the
  // browser can't, or when the person has asked their device for less motion.
  F.anim = function (el, frames, opts) {
    if (!el || !el.animate || !F.motionOK()) return null;
    try { return el.animate(frames, opts); } catch (e) { return null; }
  };
  F.bump = function (el, scale) {
    return F.anim(el, [{ transform: 'scale(1)' }, { transform: 'scale(' + (scale || 1.2) + ')', offset: 0.4 }, { transform: 'scale(1)' }],
      { duration: 380, easing: 'cubic-bezier(.3, 1.3, .5, 1)' });
  };
  // Swap a line of text, with a small rise so the change is noticed.
  F.swapText = function (el, text) {
    if (el.textContent === text) return false;
    el.textContent = text;
    F.anim(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
    return true;
  };

  /* ---- redraw a block of HTML without throwing away what is already on screen ----
     Elements that are still there are kept and only what changed is touched, so buttons keep
     their pressed state, switches slide instead of jumping, lists keep their scroll position,
     and only things that are really new play their entrance animation.
     data-key="..." (or an id) marks an element as "the same one" between redraws.
     data-live means "leave my contents alone": a script is animating them. */
  function keyOf(n) { return n.nodeType === 1 ? (n.getAttribute('data-key') || n.id || null) : null; }
  function morphKids(from, to) {
    var want = {}, cur = from.firstChild, next = to.firstChild, n, k, hit, c, clear;
    function id(x) { var kk = keyOf(x); return kk ? x.nodeName + '|' + kk : null; }
    function drop(x) { if (x === cur) cur = cur.nextSibling; from.removeChild(x); }
    for (n = to.firstChild; n; n = n.nextSibling) if (id(n)) want[id(n)] = 1;
    while (next) {
      n = next; next = next.nextSibling;
      while (cur && id(cur) && !want[id(cur)]) drop(cur);          // keyed, and not coming back
      k = id(n); hit = null;
      for (c = cur; c; c = c.nextSibling) if (k ? id(c) === k : (!id(c) && c.nodeName === n.nodeName)) { hit = c; break; }
      if (hit && hit !== cur) {
        // Clear away whatever stands before the match unless it is wanted later. Moving the
        // match itself would work too, but a moved element replays its entrance animation.
        clear = true;
        for (c = cur; c !== hit; c = c.nextSibling) if (id(c) && want[id(c)]) { clear = false; break; }
        if (clear) while (cur !== hit) drop(cur);
      }
      if (hit) {
        if (hit === cur) cur = cur.nextSibling; else from.insertBefore(hit, cur);
        morphNode(hit, n);
      } else from.insertBefore(n, cur);
    }
    while (cur) drop(cur);
  }
  function morphNode(a, b) {
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    var i, at, name;
    for (i = a.attributes.length - 1; i >= 0; i--) {
      name = a.attributes[i].name;
      if (!b.hasAttribute(name) && name.indexOf('data-fx-') !== 0) a.removeAttribute(name);
    }
    for (i = 0; i < b.attributes.length; i++) {
      at = b.attributes[i];
      if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    }
    if (a.nodeName === 'INPUT' || a.nodeName === 'TEXTAREA') {
      if (document.activeElement !== a) { var v = b.getAttribute('value') || ''; if (a.value !== v) a.value = v; }
      return;
    }
    if (a.nodeName === 'SELECT' && a.options.length === b.options.length) {   // same choices: keep what was picked
      var same = true;
      for (i = 0; i < a.options.length; i++) if (a.options[i].value !== b.options[i].value || a.options[i].text !== b.options[i].text) same = false;
      if (same) return;
    }
    if (a.hasAttribute('data-live')) return;
    morphKids(a, b);
  }
  F.morph = function (root, html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    morphKids(root, t.content);
  };

  /* Numbers marked data-n count up or down to their new value instead of jumping. */
  F.liveCounts = function (root, ms) {
    var els = root.querySelectorAll('[data-n]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], to = Number(el.getAttribute('data-n'));
      if (el._n == null) { el._n = to; el.textContent = to; continue; }
      if (el._n === to) continue;
      var up = to > el._n;
      el._n = to;
      if (!F.motionOK()) { F.countTo(el, to, 0); continue; }
      F.countTo(el, to, ms || 600);
      if (up) F.bump(el, 1.25);
    }
  };

  /* Buttons stay pressed for a beat even on a quick tap, so every tap is felt. */
  F.pressFx = function () {
    var held = null, t0 = 0;
    function release() {
      var b = held; held = null;
      if (b) setTimeout(function () { b.removeAttribute('data-fx-press'); }, Math.max(0, 110 - (performance.now() - t0)));
    }
    document.addEventListener('pointerdown', function (e) {
      var b = e.target.closest ? e.target.closest('button, a.tvbtn, a.link') : null;
      if (!b || b.disabled) return;
      if (held && held !== b) held.removeAttribute('data-fx-press');
      held = b; t0 = performance.now();
      b.setAttribute('data-fx-press', '');
    }, { passive: true });
    ['pointerup', 'pointercancel', 'blur'].forEach(function (ev) { addEventListener(ev, release, { passive: true }); });
    document.addEventListener('touchstart', function () {}, { passive: true });   // lets :active work on iPhones
  };

  /* ---- count a number up or down ---- */
  F.countTo = function (el, to, ms) {
    var from = parseInt(el.textContent, 10) || 0;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (from === to || !ms) { el.textContent = to; return; }
    var t0 = performance.now();
    (function step(now) {
      var k = Math.min(1, (now - t0) / ms);
      el.textContent = Math.round(from + (to - from) * k);
      if (k < 1) el._raf = requestAnimationFrame(step);
    })(t0);
  };

  /* ---- sound effects, synthesized so there are no audio files to load ---- */
  F.sfx = (function () {
    var ctx = null, muted = false;
    function ac() {
      if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(o) {
      var c = ac(); if (!c || muted) return;
      var t = c.currentTime + (o.t || 0), d = o.d || 0.3;
      var osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.g || 0.3, t + 0.012);
      if (o.hold) g.gain.setValueAtTime(o.g || 0.3, t + d - 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g); g.connect(c.destination);
      osc.start(t); osc.stop(t + d + 0.05);
    }
    function bell(f, t, g) {
      tone({ f: f, t: t, d: 1.2, g: g }); tone({ f: f * 2, t: t, d: 0.7, g: g * 0.4 }); tone({ f: f * 3.01, t: t, d: 0.4, g: g * 0.2 });
    }
    function buzzer(t, d) {
      tone({ f: 138, type: 'sawtooth', t: t, d: d, g: 0.35, hold: true });
      tone({ f: 146, type: 'square', t: t, d: d, g: 0.2, hold: true });
      tone({ f: 92, type: 'sawtooth', t: t, d: d, g: 0.3, hold: true });
    }
    return {
      unlock: ac,
      mute: function (v) { muted = v; },
      isMuted: function () { return muted; },
      ding: function () { bell(1318.5, 0, 0.32); },
      bigDing: function () { bell(1318.5, 0, 0.32); bell(1760, 0.16, 0.3); bell(2093, 0.32, 0.28); },
      soft: function () { tone({ f: 880, d: 0.25, g: 0.12 }); },
      strike: function () { buzzer(0, 0.95); },
      buzz: function () { tone({ f: 587, type: 'square', d: 0.1, g: 0.22 }); tone({ f: 880, type: 'square', t: 0.1, d: 0.3, g: 0.22 }); },
      question: function () { tone({ f: 392, type: 'triangle', d: 0.14, g: 0.2 }); tone({ f: 523, type: 'triangle', t: 0.12, d: 0.14, g: 0.2 }); tone({ f: 784, type: 'triangle', t: 0.24, d: 0.3, g: 0.2 }); },
      award: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone({ f: f, type: 'triangle', t: i * 0.11, d: 0.4, g: 0.26 }); }); },
      win: function () {
        [523, 523, 523, 659, 784, 659, 784, 1047].forEach(function (f, i) { tone({ f: f, type: 'triangle', t: i * 0.15, d: i === 7 ? 1.2 : 0.22, g: 0.28 }); });
        [262, 330, 392].forEach(function (f) { tone({ f: f, type: 'sawtooth', t: 1.05, d: 1.2, g: 0.08 }); });
      },
      lose: function () { [392, 370, 349, 330].forEach(function (f, i) { tone({ f: f, type: 'triangle', t: i * 0.25, d: i === 3 ? 0.9 : 0.3, g: 0.24 }); }); },
      tick: function () { tone({ f: 1000, type: 'square', d: 0.04, g: 0.1 }); },
      dup: function () { buzzer(0, 0.18); buzzer(0.26, 0.18); },
      timeUp: function () { buzzer(0, 0.5); buzzer(0.6, 0.7); },
      lock: function () { tone({ f: 660, type: 'triangle', d: 0.09, g: 0.18 }); },
      join: function () { tone({ f: 660, d: 0.09, g: 0.14 }); tone({ f: 990, t: 0.08, d: 0.2, g: 0.14 }); },
      round: function () {
        [392, 523, 659].forEach(function (f, i) { tone({ f: f, type: 'triangle', t: i * 0.1, d: 0.16, g: 0.2 }); });
        bell(1047, 0.32, 0.26);
      },
      whoosh: function () { tone({ f: 220, f2: 880, type: 'sine', d: 0.45, g: 0.08 }); }
    };
  })();
})();
