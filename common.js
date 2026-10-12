/* Shared by the TV page and the phone page. */
(function () {
  'use strict';
  var F = window.Feud = {};

  // Change this to rename the game everywhere.
  F.TITLE = 'FRIEND FEUD';
  // Shown small on the start screens. Goes up with every change; CHANGELOG.md says what each one was.
  F.VERSION = '1.6';
  // Shown in the TV lobby while lobby.mp3 is playing. Change it if you change the recording.
  F.MUSIC_CREDIT = 'Music: “Private Eye” by Kevin MacLeod (incompetech.com) · CC BY 3.0';

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
    // A screen left open across an update would keep running the old game. Each page knows which
    // build it is, so whenever it connects (and every few minutes) it asks the server which build
    // is current, and reloads itself if that has changed.
    var myBuild = document.documentElement.getAttribute('data-build');
    function freshCheck() {
      if (!myBuild || !window.fetch) return;
      fetch('/version', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (v) {
        if (!v || v === myBuild) return;
        var last = Number(F.store.get('feud.reloadAt', 0));
        if (Date.now() - last < 30000) return;                     // never loop
        F.store.set('feud.reloadAt', Date.now());
        location.reload();
      }).catch(function () { /* offline: try again next time */ });
    }
    function open() {
      timer = null;
      if (stopped) return;
      try {
        ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      } catch (e) { return retry(); }
      var mine = ws;
      mine.onopen = function () {
        tries = 0;
        freshCheck();
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
    setInterval(function () { try { fetch('/health').catch(function () {}); freshCheck(); } catch (e) { /* ignore */ } }, 4 * 60 * 1000);
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
    var ctx = null, muted = false, master = null;
    function ac() {
      if (!ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (C) { ctx = new C(); master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination); }   // everything goes through one volume
      }
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
      osc.connect(g); g.connect(master);
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
      ctx: ac,
      out: function () { ac(); return master; },
      mute: function (v) { muted = v; if (master) master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.03); },
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
  /* ---- music ----
     Two sources, one switch. If the site has a recording (lobby.mp3, and optionally
     fanfare.mp3), the TV plays that. Otherwise it plays the built-in tune below: an original
     70s-style funk vamp (D minor: Dm7, G7, twice, then Bb7, A7) with a syncopated bass line,
     a horn section riff, clav, claps and cowbell. The built-in parts are scheduled a bar or
     two ahead on the audio clock, so they stay in time even when the page is busy. */
  F.music = (function () {
    var BPM = 112, BEAT = 60 / BPM, S16 = BEAT / 4, BAR = BEAT * 4;
    var VOL = 0.8, STING = 0.7;                 // loop volume, and the fanfare's share of it
    var TARGET = 0.07;                          // how loud a recording should sit (same as the built-in tune)
    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function at(t, pos) { return t + pos * S16; }                     // straight sixteenths
    function noise(c) {
      if (!c._feudNoise) {
        var b = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        c._feudNoise = b;
      }
      return c._feudNoise;
    }
    // one synth note: oscillators -> low-pass filter that opens and closes -> volume envelope
    function voice(c, dest, o) {
      var t = o.t, d = o.d, a = o.a || 0.01, g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = o.q || 0.8;
      if (o.cutA) { f.frequency.setValueAtTime(o.cutA, t); f.frequency.linearRampToValueAtTime(o.cut, t + (o.cutT || 0.03)); }
      else f.frequency.setValueAtTime(o.cut || 2000, t);
      if (o.cut2) f.frequency.exponentialRampToValueAtTime(o.cut2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.g, t + a);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.g * (o.sus == null ? 0.6 : o.sus)), t + Math.max(a + 0.005, d * 0.5));
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      f.connect(g); g.connect(dest);
      var lfo = null, depth = null;
      if (o.vib && d > 0.3) {                   // long horn notes get a little vibrato once they settle
        lfo = c.createOscillator(); depth = c.createGain();
        lfo.frequency.value = 5.6; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(13, t + 0.3);
        lfo.connect(depth); lfo.start(t); lfo.stop(t + d + 0.05);
      }
      (o.tune || [0]).forEach(function (cents) {
        var osc = c.createOscillator();
        osc.type = o.type || 'sawtooth';
        osc.frequency.setValueAtTime(hz(o.m), t);
        if (o.scoop) { osc.detune.setValueAtTime(cents - o.scoop, t); osc.detune.linearRampToValueAtTime(cents, t + 0.04); }   // slides up into the note
        else osc.detune.setValueAtTime(cents, t);
        if (o.fall) { osc.detune.setValueAtTime(cents, t + d * 0.5); osc.detune.linearRampToValueAtTime(cents - o.fall * 100, t + d); }   // drops away at the end
        if (depth) depth.connect(osc.detune);
        osc.connect(f); osc.start(t); osc.stop(t + d + 0.05);
      });
    }
    function bass(c, dest, m, t, d) {
      voice(c, dest, { m: m, t: t, d: d, type: 'sawtooth', g: 0.15, a: 0.006, cutA: 300, cut: 2000, cutT: 0.012, cut2: 420, q: 3, sus: 0.5 });
      voice(c, dest, { m: m, t: t, d: d, type: 'triangle', g: 0.1, a: 0.006, cut: 500, sus: 0.7 });
    }
    function horns(c, dest, notes, t, d, loud, fall) {
      notes.forEach(function (m, k) {
        voice(c, dest, { m: m, t: t, d: d, tune: [-9, 8], g: (loud || 1) * (k === notes.length - 1 ? 0.15 : 0.1), a: 0.016,
          cutA: 700, cut: 4600, cutT: 0.045, cut2: 1900, q: 1, sus: 0.7, scoop: 40, vib: true, fall: fall || 0 });
      });
    }
    function clav(c, dest, notes, t) {
      notes.forEach(function (m) { voice(c, dest, { m: m, t: t, d: 0.085, type: 'square', g: 0.085, a: 0.003, cutA: 4200, cut: 4200, cut2: 900, q: 2, sus: 0.25 }); });
    }
    function kick(c, dest, t) {
      var o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.22);
    }
    function hit(c, dest, t, d, vol, type, freq, q) {     // a burst of filtered noise: hats, snare, claps, cymbal
      var n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      n.buffer = noise(c); n.loop = true; f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + d + 0.02);
    }
    function snare(c, dest, t, vol) {
      vol = vol || 1;
      hit(c, dest, t, 0.12, 0.5 * vol, 'bandpass', 2000, 0.8);
      voice(c, dest, { m: 55, t: t, d: 0.07, type: 'triangle', g: 0.11 * vol, cut: 1200, sus: 0.3 });
    }
    function clap(c, dest, t, vol) {                      // three quick slaps and a tail
      vol = vol || 1;
      [0, 0.011, 0.023].forEach(function (dt) { hit(c, dest, t + dt, 0.018, 0.42 * vol, 'bandpass', 1300, 1.4); });
      hit(c, dest, t + 0.03, 0.1, 0.34 * vol, 'bandpass', 1300, 1.4);
    }
    function cowbell(c, dest, t) {
      var f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2.5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      [562, 845].forEach(function (fr) { var o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 0.15); });
      f.connect(g); g.connect(dest);
    }
    // Each bar: bass [position, note, length], horn hits [position, length, [low..high]], and the clav chord.
    var DM = { bass: [[0, 38, 2], [3, 38, 1], [4, 50, 1], [6, 48, 1], [7, 50, 1], [10, 41, 1], [11, 43, 1], [14, 41, 1], [15, 42, 1]], clav: [65, 72] };
    var G7 = { bass: [[0, 43, 2], [3, 43, 1], [4, 55, 1], [6, 53, 1], [7, 55, 1], [10, 47, 1], [11, 48, 1], [14, 48, 1], [15, 49, 1]], clav: [65, 71] };
    var SONG = [
      { ch: DM, horns: [[0, 1, [57, 60, 65]], [3, 1, [60, 65, 69]], [6, 1, [65, 69, 72]], [8, 3, [69, 72, 77]]] },
      { ch: G7, horns: [[2, 1, [59, 62, 65]], [4, 1, [62, 65, 67]], [7, 5, [65, 67, 71]]], open: true },
      { ch: DM, horns: [[0, 1, [57, 60, 65]], [3, 1, [60, 65, 69]], [6, 1, [65, 69, 72]], [8, 4, [69, 74, 77]]] },
      { ch: G7, horns: [[2, 1, [62, 65, 67]], [4, 1, [65, 67, 71]], [6, 1, [67, 71, 74]], [8, 2, [71, 74, 77]], [12, 3, [67, 71, 74]]], open: true, kick: [0, 7, 10, 14] },
      { ch: DM, horns: [[0, 1, [57, 60, 65]], [3, 1, [60, 65, 69]], [6, 1, [65, 69, 72]], [8, 3, [69, 72, 77]]] },
      { ch: G7, horns: [[2, 1, [59, 62, 65]], [4, 1, [62, 65, 67]], [7, 5, [65, 67, 71]]], open: true },
      { ch: { bass: [[0, 46, 2], [3, 46, 1], [4, 58, 1], [6, 56, 1], [7, 58, 1], [10, 50, 1], [11, 53, 1], [14, 46, 1], [15, 46, 1]], clav: [68, 74] },
        horns: [[0, 2, [58, 62, 65]], [3, 2, [62, 65, 68]], [6, 2, [65, 68, 70]], [10, 5, [68, 70, 74]]] },
      { ch: { bass: [[0, 45, 2], [3, 45, 1], [4, 57, 1], [6, 55, 1], [7, 57, 1], [8, 45, 1], [10, 49, 1], [12, 52, 1], [14, 48, 1], [15, 49, 1]], clav: [67, 73] },
        horns: [[0, 2, [57, 61, 64]], [3, 2, [61, 64, 67]], [6, 2, [64, 67, 69]], [10, 5, [67, 69, 73], 3]], fill: true, kick: [0, 7, 10] }
    ];
    // schedule one bar of the loop, starting at time t, on any audio context
    function bar(c, dest, t, i) {
      var n8 = i % SONG.length, b = SONG[n8], k;
      // The eight bars come round four times before the whole thing repeats: all in, then the horns
      // sit out half a pass, all in again, then the clav and cowbell sit out half a pass.
      var pass = Math.floor(i / SONG.length) % 4, first = n8 < 4;
      var noHorns = pass === 1 && first, thin = pass === 3 && first;
      b.ch.bass.forEach(function (n) { bass(c, dest, n[1], at(t, n[0]), n[2] * S16 * 0.9); });
      if (!noHorns) b.horns.forEach(function (h) { horns(c, dest, h[2], at(t, h[0]), Math.max(0.11, h[1] * S16 - 0.02), 1, h[3]); });
      if (!thin) [2, 5, 7, 10, 13, 15].forEach(function (pos) { clav(c, dest, b.ch.clav, at(t, pos)); });
      for (k = 0; k < 16; k++) {
        if (b.open && k === 14) hit(c, dest, at(t, k), 0.2, 0.2, 'highpass', 6500);                         // open hat
        else if (!(b.open && k === 15)) hit(c, dest, at(t, k), 0.035, k % 4 === 0 ? 0.22 : (k % 2 === 0 ? 0.17 : 0.1), 'highpass', 8000);
      }
      (b.kick || [0, 7, 10]).forEach(function (pos) { kick(c, dest, at(t, pos)); });
      [4, 12].forEach(function (pos) { snare(c, dest, at(t, pos)); clap(c, dest, at(t, pos)); });
      snare(c, dest, at(t, 9), 0.25);                                                                        // ghost note
      if (!thin) [0, 4, 8, 12].forEach(function (pos) { cowbell(c, dest, at(t, pos)); });
      if (b.fill) [12, 13, 14, 15].forEach(function (pos, n) { snare(c, dest, at(t, pos), 0.55 + n * 0.15); });
    }
    // a two-second horn fanfare in the same style, for the start of a round
    function stingAt(c, dest, t) {
      [[0, 62], [1, 65], [2, 67], [3, 69]].forEach(function (n) {
        horns(c, dest, [n[1] - 12, n[1]], at(t, n[0]), 0.11, 1.2);
        hit(c, dest, at(t, n[0]), 0.035, 0.12, 'highpass', 8000);
      });
      snare(c, dest, at(t, 2), 0.6); snare(c, dest, at(t, 3), 0.8);
      var T = at(t, 4);                                    // the big chord: D7 with the sharp nine, the funk chord
      horns(c, dest, [54, 60, 66, 72, 77], T, 1.25, 1.25, 5);
      bass(c, dest, 38, T, 0.6); kick(c, dest, T); snare(c, dest, T, 1); clap(c, dest, T);
      hit(c, dest, T, 1.2, 0.2, 'highpass', 5000);         // cymbal
    }

    /* ---- a real recording, if one has been added to the site ---- */
    var FILES = { loop: '/lobby.mp3', sting: '/fanfare.mp3' }, rec = {}, state = {};
    function edges(buf) {                                  // where the music really starts and ends, so silence isn't looped
      var d = buf.getChannelData(0), n = d.length, a = 0, b = n - 1, quiet = 0.004;
      while (a < n && Math.abs(d[a]) < quiet) a++;
      while (b > a && Math.abs(d[b]) < quiet) b--;
      if (b - a < buf.sampleRate) return { from: 0, to: buf.duration };          // nothing to speak of: leave it alone
      return { from: Math.max(0, a / buf.sampleRate - 0.02), to: Math.min(buf.duration, b / buf.sampleRate + 0.3) };
    }
    function level(buf, e) {                               // quiet a loud master down to sit where the built-in tune does
      e = e || edges(buf);
      var d = buf.getChannelData(0), i0 = Math.floor(e.from * buf.sampleRate), n = Math.min(d.length, Math.floor(e.to * buf.sampleRate), i0 + buf.sampleRate * 120), sum = 0, count = 0;
      for (var i = i0; i < n; i += 7) { sum += d[i] * d[i]; count++; }
      var rms = Math.sqrt(sum / Math.max(1, count));
      return rms > 0.0005 ? Math.max(0.05, Math.min(1.5, TARGET / rms)) : 1;
    }
    function load(kind, then) {
      if (state[kind]) return;
      var c = F.sfx.ctx(); if (!c || !window.fetch) return;
      state[kind] = 'loading';
      fetch(FILES[kind]).then(function (r) { if (!r.ok) throw new Error('none'); return r.arrayBuffer(); })
        .then(function (ab) { return new Promise(function (res, rej) { c.decodeAudioData(ab, res, rej); }); })
        .then(function (buf) { var e = edges(buf); rec[kind] = { buf: buf, gain: level(buf, e), from: e.from, to: e.to }; state[kind] = 'ready'; if (then) then(); })
        .catch(function () { state[kind] = 'none'; });       // no file (or not audio): the built-in tune carries on
    }

    var want = false, scene = null, bus = null, timer = null, src = null, mode = null, nextBar = 0, idx = 0;
    function playing() { return !!mode; }
    function tick() {
      var c = F.sfx.ctx(); if (!c || !bus || mode !== 'built-in') return;
      if (nextBar < c.currentTime) nextBar = c.currentTime + 0.08;                // fell behind (tab was asleep): pick up cleanly
      while (nextBar < c.currentTime + 1.6) { bar(c, bus, nextBar, idx++); nextBar += BAR; }
    }
    function start() {
      var c = F.sfx.ctx(); if (!c || playing()) return;
      bus = c.createGain(); bus.gain.setValueAtTime(0.0001, c.currentTime);
      bus.connect(F.sfx.out());
      if (rec.loop) {
        mode = 'recording';
        src = c.createBufferSource(); src.buffer = rec.loop.buf; src.loop = true;
        src.loopStart = rec.loop.from; src.loopEnd = rec.loop.to;                 // loop the music, not the silence around it
        src.connect(bus); src.start(0, rec.loop.from);
        bus.gain.exponentialRampToValueAtTime(rec.loop.gain, c.currentTime + 0.9);
      } else {
        mode = 'built-in';
        bus.gain.exponentialRampToValueAtTime(VOL, c.currentTime + 0.9);
        nextBar = c.currentTime + 0.12; idx = 0;
        tick(); timer = setInterval(tick, 250);
        load('loop', function () { if (mode === 'built-in') { stop(); sync(); } });   // a recording turned up: switch over to it
      }
      load('sting');
      if (api.onChange) api.onChange(mode);
    }
    function stop() {
      if (!playing()) return;
      clearInterval(timer); timer = null; mode = null;
      if (api.onChange) api.onChange(mode);
      var c = F.sfx.ctx(), old = bus, oldSrc = src; bus = null; src = null;
      if (!c || !old) return;
      old.gain.cancelScheduledValues(c.currentTime); old.gain.setTargetAtTime(0.0001, c.currentTime, 0.12);    // fade out, then cut off whatever was queued
      setTimeout(function () { try { if (oldSrc) oldSrc.stop(); old.disconnect(); } catch (e) { /* already gone */ } }, 700);
    }
    function sync() { if (want && scene) start(); else stop(); }
    var api = {
      isOn: function () { return want; },
      set: function (on) { want = !!on; sync(); },                    // the person's choice: music on or off
      scene: function (name) { scene = name || null; sync(); },       // where the game is: music plays in some places only
      sting: function () {
        var c = F.sfx.ctx(); if (!c) return;
        var g = c.createGain(); g.connect(F.sfx.out());
        if (rec.sting) {
          g.gain.value = Math.min(1.5, rec.sting.gain * 1.5);
          var s = c.createBufferSource(); s.buffer = rec.sting.buf; s.connect(g); s.start(0, rec.sting.from);
          s.onended = function () { try { g.disconnect(); } catch (e) { /* already gone */ } };
        } else {
          g.gain.value = VOL * STING;
          stingAt(c, g, c.currentTime + 0.05);
          setTimeout(function () { try { g.disconnect(); } catch (e) { /* already gone */ } }, 4000);
          load('sting');
        }
      },
      source: function () { return mode; },                           // 'recording', 'built-in', or null when silent
      _playing: playing, _bar: bar, _sting: stingAt, _BAR: BAR, _BEAT: BEAT, _VOL: VOL, _STING: STING, _bars: SONG.length, _song: SONG, _level: level, _edges: edges,
      _rec: function () { return rec.loop ? { from: rec.loop.from, to: rec.loop.to, gain: rec.loop.gain, length: rec.loop.buf.duration } : null; }
    };
    return api;
  })();
})();
