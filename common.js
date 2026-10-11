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
      lock: function () { tone({ f: 660, type: 'triangle', d: 0.09, g: 0.18 }); }
    };
  })();
})();
