'use strict';
/*
 * Feud party game server.
 * One process holds every room in memory. The TV page creates a room, phones
 * join it with a 4-letter code, and the server is the single source of truth:
 * every change is pushed to every screen as a fresh snapshot.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const BANK = require('./questions');

const PORT = process.env.PORT || 3000;
// The pages normally live in a "public" folder. If they were uploaded loose,
// next to this file, serve them from here instead, but only the page files,
// so the questions and server code are never handed to a browser.
const PUB_DIR = path.join(__dirname, 'public');
const FLAT = !fs.existsSync(path.join(PUB_DIR, 'index.html'));
const PUB = FLAT ? __dirname : PUB_DIR;
const PAGE_FILES = new Set(['index.html', 'tv.html', 'common.js', 'editor.js', 'style.css', 'anton.woff2']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json'
};

const FM_TARGET = 200;
const FM_SECONDS = [20, 25];
const MAX_PLAYERS = 40;
const MAX_ROUNDS = 15;
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;

const rooms = new Map();

/* ------------------------------------------------------------------ http */

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
  let p = decodeURIComponent(u.pathname);
  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (p === '/qr.svg') {
    const text = (u.searchParams.get('u') || '').slice(0, 300);
    return QRCode.toString(text || ' ', { type: 'svg', margin: 1, errorCorrectionLevel: 'L' }, (err, svg) => {
      if (err) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' });
      res.end(svg);
    });
  }
  if (p === '/') p = '/index.html';
  if (p === '/tv') p = '/tv.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  if (FLAT && !PAGE_FILES.has(path.relative(PUB, file))) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.woff2' ? 'public, max-age=604800' : 'no-cache'
    });
    res.end(data);
  });
});

/* --------------------------------------------------------------- helpers */

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCode() {
  const letters = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels: no accidental words
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(c)) return c;
  }
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanCustom(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const q of list.slice(0, 200)) {
    if (!q || typeof q !== 'object') continue;
    const text = clean(q.text, 160);
    const answers = [];
    for (const a of Array.isArray(q.answers) ? q.answers.slice(0, 8) : []) {
      if (!a) continue;
      const t = clean(a.text, 40);
      const pts = Math.max(1, Math.min(99, Math.round(Number(a.pts)) || 0));
      if (t) answers.push({ text: t, pts });
    }
    answers.sort((x, y) => y.pts - x.pts);
    if (text && answers.length >= 2) out.push({ text, answers });
  }
  return out;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/* ----------------------------------------------------------------- rooms */

function newRoom() {
  const room = {
    code: makeCode(),
    adminToken: rid(),
    touched: Date.now(),
    displays: new Set(),
    players: new Map(),
    teams: [{ name: '', order: [] }, { name: '', order: [] }],
    hostId: null,
    settings: { fastMoney: true, useCustom: true, packs: ['general'], answerSecs: 10, rounds: 3 },
    custom: [],
    used: new Set(),      // built-in question ids already seen on this TV
    chat: [[], []],       // one private log per team
    chatAll: [],          // everyone: both teams and the host
    chatSeq: 0,
    chatEpoch: 0,         // goes up each time the chats are wiped, so phones clear theirs too
    answerTimer: null,    // optional countdown the host can start
    game: null,
    history: [],
    fx: [],
    fxSeq: 0,
    fmTimer: null
  };
  rooms.set(room.code, room);
  return room;
}

function fx(room, type, data) {
  room.fx.push(Object.assign({ seq: ++room.fxSeq, type }, data || {}));
  if (room.fx.length > 14) room.fx.shift();
}

const pname = (room, id) => { const p = room.players.get(id); return p ? p.name : null; };
const teamName = (room, t) => room.teams[t].name || ('TEAM ' + (t + 1));

function removeFromTeams(room, id) {
  for (const t of room.teams) {
    const i = t.order.indexOf(id);
    if (i >= 0) t.order.splice(i, 1);
  }
}

/* ------------------------------------------------------------- questions */

// Built-in questions from the packs the host switched on (General if none).
function packPool(room) {
  const known = BANK.packs.map(p => p.id);
  const on = (room.settings.packs || []).filter(id => known.includes(id));
  const ids = on.length ? on : ['general'];
  return BANK.main.filter(q => ids.includes(q.pack));
}

/*
 * No repeats. room.used remembers every question this TV has shown, oldest first.
 * A deck is every available question exactly once: the never-seen ones first (shuffled),
 * then the already-seen ones starting with whichever was seen longest ago. So nothing
 * comes back until everything else has had a turn, within a game or across games.
 */
const customKey = q => 'q:' + String(q.text).toLowerCase().slice(0, 150);
const usedKey = q => (q.id[0] === 'c' ? customKey(q) : q.id);

function markUsed(room, key) {
  room.used.delete(key);              // re-adding moves it to the "most recent" end
  room.used.add(key);
  if (room.used.size > 3000) room.used.delete(room.used.values().next().value);
}

function freshFirst(room, items) {    // items: [{ id, key }]
  const rank = new Map([...room.used].map((k, i) => [k, i]));
  const fresh = shuffle(items.filter(x => !rank.has(x.key)));
  const seen = items.filter(x => rank.has(x.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
  return { fresh, seen };
}

function buildDeck(room) {
  const mine = room.settings.useCustom ? room.custom.map((q, i) => ({ id: 'c' + i, key: customKey(q) })) : [];
  const built = packPool(room).map(q => ({ id: q.id, key: q.id }));
  const a = freshFirst(room, mine), b = freshFirst(room, built);
  const seen = freshFirst(room, a.seen.concat(b.seen)).seen;     // oldest first, both kinds together
  return a.fresh.concat(b.fresh, seen).map(x => x.id);            // the host's own questions lead
}

function findQuestion(room, id) {
  if (id[0] === 'c') {
    const q = room.custom[Number(id.slice(1))];
    return q ? { id, pack: 'custom', text: q.text, answers: q.answers } : null;
  }
  return BANK.main.find(q => q.id === id) || null;
}

// Like the show, the board gets shorter as the points go up (keyed by single/double/triple).
const ANSWER_RANGE = { 1: [6, 8], 2: [5, 7], 3: [4, 6] };
function answerCount(g) {
  const [lo, hi] = g.sudden ? [4, 5] : (ANSWER_RANGE[g.mult] || [4, 6]);
  return lo + crypto.randomInt(hi - lo + 1);
}

function drawQuestion(room) {
  const g = room.game;
  for (;;) {
    if (!g.deck.length) g.deck = buildDeck(room);      // ran through everything: start again, oldest first
    const q = findQuestion(room, g.deck.shift());
    if (q) {
      const copy = JSON.parse(JSON.stringify(q));
      markUsed(room, usedKey(q));
      if (q.id[0] !== 'c') copy.answers = copy.answers.slice(0, answerCount(g));   // the host's own questions keep every answer
      return copy;
    }
  }
}

function drawFast(room) {
  const parts = freshFirst(room, BANK.fast.map(q => ({ id: q.id, key: q.id })));
  const five = parts.fresh.concat(parts.seen).slice(0, 5).map(x => BANK.fast.find(q => q.id === x.id));
  for (const q of five) markUsed(room, q.id);
  return JSON.parse(JSON.stringify(five));
}

/* ------------------------------------------------------------ game logic */

function snapshot(room) {
  room.history.push(JSON.stringify(room.game));
  if (room.history.length > 60) room.history.shift();
}

function startGame(room) {
  room.history = [];
  room.chat = [[], []];               // every new game starts with empty chats
  room.chatAll = [];
  room.chatEpoch++;
  room.game = {
    phase: 'question', round: 1, mult: 1, sudden: false,
    rounds: room.settings.rounds,       // fixed for this game once it starts
    scores: [0, 0], deck: [], winner: null, fm: null
  };
  room.game.deck = buildDeck(room);
  loadQuestion(room);
  fx(room, 'start');
}

function loadQuestion(room) {
  const g = room.game;
  g.q = drawQuestion(room);
  g.revealed = g.q.answers.map(() => false);
  g.bank = 0;
  g.strikes = 0;
  g.playing = null;
  g.turnIdx = 0;
  g.stealTeam = null;
  g.roundWinner = null;
  g.awarded = 0;
  g.stolen = false;
  g.phase = 'question';
  const base = g.round - 1;
  g.fo = {
    idx: room.teams.map(t => (t.order.length ? base % t.order.length : 0)),
    open: false, buzzed: null, turn: null, tries: 0, first: null, winner: null
  };
}

// Who is answering right now (player id), or null.
function currentAnswerer(room) {
  const g = room.game;
  if (!g) return null;
  if (g.phase === 'faceoff' && g.fo.turn != null) {
    const order = room.teams[g.fo.turn].order;
    if (!order.length) return null;
    return order[(g.fo.idx[g.fo.turn] + Math.floor(g.fo.tries / 2)) % order.length];
  }
  if (g.phase === 'play' && g.playing != null) {
    const order = room.teams[g.playing].order;
    if (!order.length) return null;
    return order[g.turnIdx % order.length];
  }
  return null;
}

function faceoffPlayers(room) {
  const g = room.game;
  return room.teams.map((t, i) => (t.order.length ? t.order[g.fo.idx[i] % t.order.length] : null));
}

function award(room, team, how) {
  const g = room.game;
  g.scores[team] += g.bank;
  g.awarded = g.bank;
  g.roundWinner = team;
  g.bank = 0;
  g.phase = 'roundEnd';
  fx(room, 'award', { team, pts: g.awarded, how });
}

function faceoffWin(room, team) {
  const g = room.game;
  g.fo.winner = team;
  g.fo.turn = null;
  if (g.sudden || g.revealed.every(Boolean)) award(room, team, g.sudden ? 'sudden' : 'clear');
  else g.phase = 'passplay';
}

function faceoffAttempt(room, rank) {   // rank: answer index, or null for a miss
  const fo = room.game.fo;
  const team = fo.turn, other = 1 - team;
  fo.tries++;
  if (fo.tries === 1) {
    if (rank === 0) return faceoffWin(room, team);
    fo.first = { team, rank };
    fo.turn = other;
  } else if (fo.tries === 2) {
    if (rank != null && (fo.first.rank == null || rank < fo.first.rank)) return faceoffWin(room, team);
    if (fo.first.rank != null) return faceoffWin(room, fo.first.team);
    fo.turn = other;                    // both missed: next players, alternating
  } else {
    if (rank != null) return faceoffWin(room, team);
    fo.turn = other;
  }
}

function doBuzz(room, team) {
  const g = room.game;
  if (!g || g.phase !== 'faceoff' || !g.fo.open || g.fo.buzzed != null) return false;
  snapshot(room);
  g.fo.open = false;
  g.fo.buzzed = team;
  g.fo.turn = team;
  fx(room, 'buzz', { team, name: pname(room, currentAnswerer(room)) });
  return true;
}

function doReveal(room, idx) {
  const g = room.game;
  if (!g || !g.q || !Number.isInteger(idx) || idx < 0 || idx >= g.q.answers.length || g.revealed[idx]) return;
  const a = g.q.answers[idx];
  if (g.phase === 'faceoff' && g.fo.turn != null) {
    snapshot(room);
    g.revealed[idx] = true;
    g.bank += a.pts * g.mult;
    fx(room, 'reveal', { idx, top: idx === 0 });
    faceoffAttempt(room, idx);
  } else if (g.phase === 'play') {
    snapshot(room);
    g.revealed[idx] = true;
    g.bank += a.pts * g.mult;
    fx(room, 'reveal', { idx, top: idx === 0 });
    if (g.revealed.every(Boolean)) award(room, g.playing, 'clear');
    else g.turnIdx++;
  } else if (g.phase === 'steal') {
    snapshot(room);
    g.revealed[idx] = true;
    g.stolen = true;
    fx(room, 'reveal', { idx, top: idx === 0 });
    award(room, g.stealTeam, 'steal');
  } else if (g.phase === 'roundEnd' || g.phase === 'gameOver') {
    snapshot(room);
    g.revealed[idx] = true;
    fx(room, 'reveal', { idx, quiet: true });
  }
}

function doMiss(room) {
  const g = room.game;
  if (!g) return;
  if (g.phase === 'faceoff' && g.fo.turn != null) {
    snapshot(room);
    fx(room, 'strike', { n: 1 });
    faceoffAttempt(room, null);
  } else if (g.phase === 'play') {
    snapshot(room);
    g.strikes++;
    fx(room, 'strike', { n: g.strikes });
    g.turnIdx++;
    if (g.strikes >= 3) { g.phase = 'steal'; g.stealTeam = 1 - g.playing; }
  } else if (g.phase === 'steal') {
    snapshot(room);
    fx(room, 'strike', { n: 1 });
    award(room, g.playing, 'defend');
  }
}

function doNext(room) {
  const g = room.game;
  if (!g || g.phase !== 'roundEnd') return;
  snapshot(room);
  if (g.round < g.rounds && !g.sudden) {
    g.round++;
    g.mult = ((g.round - 1) % 3) + 1;   // single, double, triple, then back to single
    loadQuestion(room);
  } else if (g.scores[0] === g.scores[1]) {
    g.sudden = true;
    g.round++;
    g.mult = 3;
    loadQuestion(room);
  } else {
    g.phase = 'gameOver';
    g.winner = g.scores[0] > g.scores[1] ? 0 : 1;
    fx(room, 'win', { team: g.winner });
  }
}

/* ------------------------------------------------------------ fast money */

function clearFmTimer(room) {
  if (room.fmTimer) { clearTimeout(room.fmTimer); room.fmTimer = null; }
}

function fmStart(room, pids) {
  const g = room.game;
  if (!g || g.phase !== 'gameOver' || g.winner == null || !room.settings.fastMoney) return;
  const order = room.teams[g.winner].order;
  if (!order.length) return;
  let a = order.includes(pids && pids[0]) ? pids[0] : order[0];
  let b = order.includes(pids && pids[1]) ? pids[1] : (order[1] || order[0]);
  snapshot(room);
  g.phase = 'fm';
  g.fm = {
    team: g.winner, pids: [a, b], qs: drawFast(room),
    stage: 'ready', turn: 0, cur: 0, endsAt: null,
    picks: [[null, null, null, null, null], [null, null, null, null, null]],
    shown: [0, 0], total: 0, won: null
  };
  fx(room, 'fmIntro');
}

function fmNextOpen(fm, from) {
  for (let k = 1; k <= 5; k++) {
    const i = (from + k) % 5;
    if (fm.picks[fm.turn][i] == null) return i;
  }
  return -1;
}

function fmEndRun(room, timedOut) {
  const fm = room.game.fm;
  clearFmTimer(room);
  fm.stage = 'reveal';
  fm.endsAt = null;
  fx(room, timedOut ? 'fmTimeUp' : 'fmStop');
}

function fmArmTimer(room) {
  clearFmTimer(room);
  const fm = room.game && room.game.fm;
  if (!fm || fm.stage !== 'run' || !fm.endsAt) return;
  room.fmTimer = setTimeout(() => {
    room.fmTimer = null;
    const f = room.game && room.game.fm;
    if (f && f.stage === 'run') { fmEndRun(room, true); pushAll(room); }
  }, Math.max(0, fm.endsAt - Date.now()));
}

function fmAction(room, a, m) {
  const g = room.game;
  const fm = g && g.fm;
  if (!fm || g.phase !== 'fm') return;
  if (a === 'fmClock' && fm.stage === 'ready') {
    snapshot(room);
    fm.stage = 'run';
    fm.cur = 0;
    fm.endsAt = Date.now() + FM_SECONDS[fm.turn] * 1000;
    fmArmTimer(room);
    fx(room, 'fmGo');
  } else if (a === 'fmPick' && fm.stage === 'run') {
    const q = fm.cur, i = m.i;
    if (!Number.isInteger(i) || i < -1 || i >= fm.qs[q].answers.length) return;
    if (fm.turn === 1 && i >= 0 && fm.picks[0][q] && fm.picks[0][q].i === i) {
      return fx(room, 'fmDup', { q });         // same answer as player one: try again
    }
    snapshot(room);
    fm.picks[fm.turn][q] = { i };
    fx(room, 'fmLock', { q });
    const nx = fmNextOpen(fm, q);
    if (nx < 0) fmEndRun(room, false); else fm.cur = nx;
  } else if (a === 'fmPass' && fm.stage === 'run') {
    const nx = fmNextOpen(fm, fm.cur);
    if (nx >= 0 && nx !== fm.cur) { fm.cur = nx; }
  } else if (a === 'fmReveal' && fm.stage === 'reveal') {
    const k = fm.shown[fm.turn];
    if (k >= 5) return;
    snapshot(room);
    const pick = fm.picks[fm.turn][k];
    const pts = pick && pick.i >= 0 ? fm.qs[k].answers[pick.i].pts : 0;
    fm.shown[fm.turn]++;
    fm.total += pts;
    fx(room, 'fmReveal', { turn: fm.turn, q: k, pts });
    if (fm.shown[fm.turn] >= 5 && (fm.turn === 1 || fm.total >= FM_TARGET)) {
      fm.stage = 'done';
      fm.won = fm.total >= FM_TARGET;
      fx(room, fm.won ? 'fmWin' : 'fmLose');
    }
  } else if (a === 'fmNextPlayer' && fm.stage === 'reveal' && fm.turn === 0 && fm.shown[0] >= 5) {
    snapshot(room);
    fm.turn = 1;
    fm.stage = 'ready';
    fm.cur = 0;
  }
}

/* ---------------------------------------------------------- answer timer */

function clearAnswerTimer(room) {
  if (room.answerTimer) { clearTimeout(room.answerTimer.handle); room.answerTimer = null; }
}

function startAnswerTimer(room) {
  const g = room.game;
  const answering = g && ((g.phase === 'faceoff' && g.fo.turn != null) || g.phase === 'play' || g.phase === 'steal');
  if (!answering) return;
  clearAnswerTimer(room);
  const secs = room.settings.answerSecs;
  room.answerTimer = {
    secs,
    endsAt: Date.now() + secs * 1000,
    handle: setTimeout(() => {
      room.answerTimer = null;
      fx(room, 'timeUp');             // just a buzzer: the host decides what it costs
      pushAll(room);
    }, secs * 1000)
  };
  fx(room, 'timerGo', { secs });
}

/* ----------------------------------------------------------- host action */

const KEEPS_TIMER = new Set(['timer', 'adjust', 'move', 'kick', 'settings', 'custom', 'teamName']);

function hostAction(room, m) {
  const g = room.game;
  const a = m.a;
  if (!KEEPS_TIMER.has(a)) clearAnswerTimer(room);   // any game move stops the countdown
  switch (a) {
    case 'timer':
      if (m.stop) { if (room.answerTimer) { clearAnswerTimer(room); fx(room, 'timerStop'); } }
      else startAnswerTimer(room);
      break;
    case 'start':
      if (!g && room.teams[0].order.length && room.teams[1].order.length) startGame(room);
      break;
    case 'settings':
      if (typeof m.fastMoney === 'boolean') room.settings.fastMoney = m.fastMoney;
      if (typeof m.useCustom === 'boolean') room.settings.useCustom = m.useCustom;
      if ([5, 10, 15, 20].includes(m.answerSecs)) room.settings.answerSecs = m.answerSecs;
      if (Number.isInteger(m.rounds) && m.rounds >= 1 && m.rounds <= MAX_ROUNDS && !g) room.settings.rounds = m.rounds;
      if (Array.isArray(m.packs) && !g) {
        room.settings.packs = BANK.packs.map(p => p.id).filter(id => m.packs.includes(id));
      }
      break;
    case 'custom':
      if (!g) room.custom = cleanCustom(m.list);   // only between games
      break;
    case 'teamName':                   // the host can rename either team at any time
      if (m.team === 0 || m.team === 1) {
        const name = clean(m.name, 18).toUpperCase();
        room.teams[m.team].name = name;
        room.teams[m.team].locked = !!name;   // a host-set name sticks; clearing it hands naming back to the team
      }
      break;
    case 'kick': {
      const p = room.players.get(m.id);
      if (p && !p.isHost) dropPlayer(room, p, true);
      break;
    }
    case 'move': {                     // host moves a player to a team
      const p = room.players.get(m.id);
      if (p && !p.isHost && (m.team === 0 || m.team === 1)) {
        removeFromTeams(room, p.id);
        p.team = m.team;
        room.teams[m.team].order.push(p.id);
      }
      break;
    }
    case 'open':
      if (g && g.phase === 'question') {
        snapshot(room);
        g.phase = 'faceoff';
        g.fo.open = true;
        fx(room, 'question');
      }
      break;
    case 'swap':
      if (g && g.phase === 'question') { snapshot(room); loadQuestion(room); }
      break;
    case 'manualBuzz':
      if (m.team === 0 || m.team === 1) doBuzz(room, m.team);
      break;
    case 'clearBuzz':
      if (g && g.phase === 'faceoff' && g.fo.buzzed != null && g.fo.tries === 0) {
        snapshot(room);
        g.fo.buzzed = null; g.fo.turn = null; g.fo.open = true;
        fx(room, 'rebuzz');
      }
      break;
    case 'reveal': doReveal(room, m.idx); break;
    case 'miss': doMiss(room); break;
    case 'passplay':
      if (g && g.phase === 'passplay') {
        snapshot(room);
        g.playing = m.play ? g.fo.winner : 1 - g.fo.winner;
        g.turnIdx = g.fo.idx[g.playing] + 1;
        g.phase = 'play';
        fx(room, 'play', { team: g.playing, passed: !m.play });
      }
      break;
    case 'next': doNext(room); break;
    case 'adjust':
      if (g && (m.team === 0 || m.team === 1) && Number.isFinite(m.delta)) {
        snapshot(room);
        g.scores[m.team] = Math.max(0, g.scores[m.team] + Math.round(m.delta));
      }
      break;
    case 'undo':
      if (g && room.history.length) {
        const keepEnd = g.fm && g.fm.stage === 'run' ? g.fm.endsAt : null;
        room.game = JSON.parse(room.history.pop());
        const fm = room.game.fm;
        if (fm && fm.stage === 'run') {
          if (keepEnd) fm.endsAt = keepEnd;
          if (!fm.endsAt || fm.endsAt <= Date.now()) fmEndRun(room, true); else fmArmTimer(room);
        } else clearFmTimer(room);
        fx(room, 'undo');
      }
      break;
    case 'fmStart': fmStart(room, m.pids); break;
    case 'fmClock': case 'fmPick': case 'fmPass': case 'fmReveal': case 'fmNextPlayer':
      fmAction(room, a, m); break;
    case 'endGame':                    // back to the lobby, teams stay
      clearFmTimer(room);
      room.game = null;
      room.history = [];
      fx(room, 'lobby');
      break;
  }
}

/* ----------------------------------------------------------------- state */

function publicState(room) {
  const g = room.game;
  const pl = id => { const p = room.players.get(id); return p ? { id: p.id, name: p.name, on: p.connected } : null; };
  const s = {
    code: room.code,
    phase: g ? g.phase : 'lobby',
    teams: room.teams.map((t, i) => ({ name: teamName(room, i), named: !!t.name, locked: !!t.locked, players: t.order.map(pl).filter(Boolean) })),
    host: room.hostId ? pl(room.hostId) : null,
    loose: [...room.players.values()].filter(p => p.team == null && !p.isHost).map(p => pl(p.id)),
    settings: room.settings,
    packs: BANK.packs.map(p => ({ id: p.id, name: p.name, blurb: p.blurb, adult: p.adult, count: p.questions.length })),
    maxRounds: MAX_ROUNDS,
    customCount: room.custom.length,
    chatEpoch: room.chatEpoch,
    fx: room.fx,
    game: null
  };
  if (g) {
    const fo = g.fo;
    const ans = currentAnswerer(room);
    s.game = {
      round: g.round, rounds: g.rounds, mult: g.mult, sudden: g.sudden,
      scores: g.scores, bank: g.bank, strikes: g.strikes,
      // Hidden until the face-off is settled, so nobody can buzz early and then read it.
      question: (g.phase === 'question' || g.phase === 'faceoff') ? null : g.q.text,
      pack: g.q.pack === 'custom' ? 'Your questions' : ((BANK.packs.find(p => p.id === g.q.pack) || {}).name || null),
      timer: room.answerTimer ? { left: Math.max(0, room.answerTimer.endsAt - Date.now()), secs: room.answerTimer.secs } : null,
      count: g.q.answers.length,
      slots: g.q.answers.map((a, i) => (g.revealed[i] ? { text: a.text, pts: a.pts } : null)),
      fo: { pids: faceoffPlayers(room), open: fo.open, buzzed: fo.buzzed, turn: fo.turn, winner: fo.winner, tries: fo.tries },
      playing: g.playing, stealTeam: g.stealTeam,
      answerer: ans ? pl(ans) : null,
      roundWinner: g.roundWinner, awarded: g.awarded, stolen: g.stolen,
      winner: g.winner, fm: null
    };
    if (g.fm) {
      const fm = g.fm;
      s.game.fm = {
        team: fm.team, players: fm.pids.map(pl), stage: fm.stage, turn: fm.turn,
        left: fm.endsAt ? Math.max(0, fm.endsAt - Date.now()) : null,
        seconds: FM_SECONDS, target: FM_TARGET, total: fm.total, won: fm.won,
        cover: fm.turn === 1 && (fm.stage === 'ready' || fm.stage === 'run'),
        question: fm.stage === 'run' ? fm.qs[fm.cur].text : null,
        cur: fm.cur,
        rows: [0, 1].map(t => fm.qs.map((q, k) => {
          const pick = fm.picks[t][k];
          if (k < fm.shown[t]) {
            return pick && pick.i >= 0
              ? { text: q.answers[pick.i].text, pts: q.answers[pick.i].pts }
              : { text: pick ? 'NOT ON THE BOARD' : 'NO ANSWER', pts: 0 };
          }
          return pick ? { locked: true } : null;
        }))
      };
    }
  }
  return s;
}

function hostExtras(room) {
  const g = room.game;
  const h = { canUndo: room.history.length > 0, custom: room.custom, bankSize: BANK.main.length };
  if (g) {
    h.question = g.q.text;
    h.answers = g.q.answers.map((a, i) => ({ text: a.text, pts: a.pts, open: g.revealed[i] }));
    if (g.fm) {
      h.fm = { qs: g.fm.qs, picks: g.fm.picks, shown: g.fm.shown };
    }
  }
  return h;
}

function stateFor(room, pub, p) {
  const s = Object.assign({}, pub);
  const g = room.game;
  s.me = { id: p.id, name: p.name, team: p.team, isHost: p.isHost,
    captain: p.team != null && room.teams[p.team].order[0] === p.id };
  if (p.team != null) s.chat = room.chat[p.team];
  if (p.team != null || p.isHost) s.chatAll = room.chatAll;
  if (p.isHost) s.hostView = hostExtras(room);
  if (g && pub.game) {
    const pids = pub.game.fo.pids;
    s.me.faceoff = (g.phase === 'question' || g.phase === 'faceoff') && pids.includes(p.id) && g.fo.buzzed == null;
    // Fast Money: player two must not see player one's answers.
    const fm = g.fm;
    if (fm && fm.turn === 0 && fm.stage !== 'done' && fm.pids[1] === p.id && fm.pids[0] !== p.id) {
      s.game = Object.assign({}, pub.game, { fm: Object.assign({}, pub.game.fm, { rows: null, question: null, blind: true }) });
    }
  }
  return s;
}

function pushAll(room) {
  room.touched = Date.now();
  const pub = publicState(room);
  if (room.displays.size) {
    const d = JSON.stringify({ t: 'state', s: Object.assign({}, pub, { display: true, used: [...room.used] }) });
    for (const ws of room.displays) if (ws.readyState === 1) ws.send(d);
  }
  for (const p of room.players.values()) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'state', s: stateFor(room, pub, p) }));
  }
}

/* -------------------------------------------------------------- messages */

function dropPlayer(room, p, kicked) {
  removeFromTeams(room, p.id);
  if (room.hostId === p.id) room.hostId = null;
  room.players.delete(p.id);
  if (p.ws) {
    send(p.ws, { t: 'left', kicked: !!kicked });
    p.ws.room = null; p.ws.pid = null;
  }
}

function attach(ws, room, p) {
  if (p.ws && p.ws !== ws) {
    send(p.ws, { t: 'left', replaced: true });
    p.ws.room = null; p.ws.pid = null;
    try { p.ws.close(); } catch (e) { /* ignore */ }
  }
  p.ws = ws; p.connected = true;
  ws.room = room; ws.pid = p.id;
}

function onMessage(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'ping') return;

  if (m.t === 'create') {
    const room = newRoom();
    if (Array.isArray(m.used)) for (const id of m.used.slice(-3000)) if (typeof id === 'string' && id) room.used.add(id.slice(0, 160));
    room.custom = cleanCustom(m.custom);
    ws.room = room; ws.display = true; ws.admin = true;
    room.displays.add(ws);
    send(ws, { t: 'created', code: room.code, token: room.adminToken });
    return pushAll(room);
  }

  if (m.t === 'watch') {
    const room = rooms.get(clean(m.code, 4).toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'noroom', msg: 'That game is no longer running.' });
    ws.room = room; ws.display = true; ws.admin = m.token === room.adminToken;
    room.displays.add(ws);
    send(ws, { t: 'watching', code: room.code, admin: ws.admin });
    return pushAll(room);
  }

  if (m.t === 'join') {
    const room = rooms.get(clean(m.code, 4).toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'noroom', msg: "Can't find that room. Check the 4-letter code on the TV." });
    const name = clean(m.name, 12).toUpperCase();
    if (!name) return send(ws, { t: 'error', msg: 'Enter your name.' });
    let p = [...room.players.values()].find(x => x.name === name);
    if (p) {
      if (p.connected) return send(ws, { t: 'error', msg: 'Someone is already playing as ' + name + '. Pick another name.' });
      p.token = rid();                // same name, they dropped: let them back in
    } else {
      if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'This room is full.' });
      p = { id: rid(6), token: rid(), name, team: null, isHost: false, connected: true, ws: null };
      room.players.set(p.id, p);
    }
    attach(ws, room, p);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    return pushAll(room);
  }

  if (m.t === 'rejoin') {
    const room = rooms.get(clean(m.code, 4).toUpperCase());
    const p = room && [...room.players.values()].find(x => x.token === m.token);
    if (!p) return send(ws, { t: 'error', code: 'noroom', msg: 'That game has ended.' });
    attach(ws, room, p);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    return pushAll(room);
  }

  const room = ws.room;
  if (!room) return;

  if (ws.display) {
    if (m.t === 'custom' && ws.admin && !room.game) { room.custom = cleanCustom(m.list); pushAll(room); }
    return;
  }

  const p = room.players.get(ws.pid);
  if (!p) return;
  const g = room.game;

  switch (m.t) {
    case 'team': {
      if (m.team !== 0 && m.team !== 1) break;
      if (g && p.team != null) break;           // no switching sides mid-game
      if (p.isHost) { if (g) break; p.isHost = false; room.hostId = null; }
      removeFromTeams(room, p.id);
      p.team = m.team;
      room.teams[m.team].order.push(p.id);
      break;
    }
    case 'teamName':
      if (p.team != null && room.teams[p.team].order[0] === p.id && !room.teams[p.team].locked) {
        room.teams[p.team].name = clean(m.name, 18).toUpperCase();
      }
      break;
    case 'host': {
      if (m.on) {
        const cur = room.hostId && room.players.get(room.hostId);
        if (cur && cur.id !== p.id && cur.connected) {
          send(ws, { t: 'error', msg: cur.name + ' is already the host.' });
          break;
        }
        if (cur) cur.isHost = false;
        removeFromTeams(room, p.id);
        p.team = null; p.isHost = true; room.hostId = p.id;
      } else if (p.isHost && !g) {
        p.isHost = false; room.hostId = null;
      }
      break;
    }
    case 'chat': {
      const text = clean(m.text, 200);
      if (!text) break;
      let log;
      if (m.to === 'all') {
        if (p.team == null && !p.isHost) break;
        log = room.chatAll;
        log.push({ id: ++room.chatSeq, from: p.id, name: p.name, team: p.isHost ? 'host' : p.team, text });
      } else {
        if (p.team == null) break;
        log = room.chat[p.team];
        log.push({ id: ++room.chatSeq, from: p.id, name: p.name, text });
      }
      if (log.length > 80) log.shift();
      break;
    }
    case 'buzz':
      if (g && p.team != null && faceoffPlayers(room)[p.team] === p.id) doBuzz(room, p.team);
      break;
    case 'leave':
      dropPlayer(room, p, false);
      break;
    case 'h':
      if (p.isHost) hostAction(room, m);
      break;
    default:
      return;
  }
  pushAll(room);
}

function onClose(ws) {
  const room = ws.room;
  if (!room) return;
  if (ws.display) { room.displays.delete(ws); return; }
  const p = room.players.get(ws.pid);
  if (p && p.ws === ws) {
    p.connected = false; p.ws = null;
    // Nobody picked a side yet and the game hasn't started: just forget them.
    if (!room.game && p.team == null && !p.isHost) room.players.delete(p.id);
    pushAll(room);
  }
}

/* ------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    try { onMessage(ws, m); } catch (e) { console.error('message error', e); }
  });
  ws.on('close', () => { try { onClose(ws); } catch (e) { console.error('close error', e); } });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > ROOM_IDLE_MS) { clearFmTimer(room); clearAnswerTimer(room); rooms.delete(code); }
  }
}, 30000);

if (require.main === module) {
  server.listen(PORT, () => console.log('Feud server running on port ' + PORT));
}

module.exports = { server, rooms };
