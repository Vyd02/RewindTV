/* Rewind TV — a 90s cable box that plays the Internet Archive. */
(() => {
'use strict';

const SLOT_MS = 30 * 60 * 1000;      // schedule moves in half-hour blocks, like a real guide
const LIST_ROWS = 400;               // how many items each channel draws from (higher = more variety)
const LIST_TTL = 12 * 3600 * 1000;   // refresh channel lists twice a day
const STALL_MS = 12000;              // skip a tape that won't start (big sharp files need time on Fire TV)
const STATIC_MS = 700;               // static only plays for a beat, then a quiet "TUNING..." card
const ADULT_KEYS = new Set(['xxx', 'skin']);  // channels that can be PIN-locked
const $ = id => document.getElementById(id);

const screen = $('screen'), tv = $('tv');
const NATIVE = !!(window.Android && Android.vLoad);

/* Show script errors on screen instead of failing silently. */
window.addEventListener('error', e => { try { const t = $('toast'); t.textContent = 'Error: ' + e.message + ' (line ' + e.lineno + ')'; t.classList.remove('hidden'); } catch (x) {} });

/* On the Fire TV the picture comes from the TV's own video player underneath this page.
   This stand-in acts like a <video> element so the rest of the code doesn't care which is used. */
function nativeVideo() {
  const L = {};
  const v = {
    _src: '', _t: 0, _d: NaN, readyState: 0, paused: true, startAt: 0, onloadedmetadata: null,
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); },
    emit(t) { (L[t] || []).forEach(f => f()); if (t === 'loadedmetadata' && v.onloadedmetadata) v.onloadedmetadata(); },
    set src(u) { v._src = u; v.readyState = 0; v._t = v.startAt; v._d = NaN; Android.vLoad(u, Math.round(v.startAt * 1000)); },
    get src() { return v._src; },
    getAttribute(k) { return k === 'src' ? (v._src || null) : null; },
    removeAttribute() { v._src = ''; v.readyState = 0; v.startAt = 0; Android.vStop(); },
    load() {},
    play() { v.paused = false; Android.vPlay(); return Promise.resolve(); },
    pause() { v.paused = true; Android.vPause(); },
    get currentTime() { return v._t; },
    set currentTime(x) { if (Math.abs(x - v._t) < 1.5) return; v._t = x; Android.vSeek(Math.round(x * 1000)); },
    get duration() { return v._d; },
  };
  return v;
}
const vid = NATIVE ? nativeVideo() : $('vid');
if (NATIVE) { document.documentElement.classList.add('native'); document.body.classList.add('native'); }
const WEBV = (window.Android && Android.webVersion) ? Android.webVersion() : '';
const VERSION = ((window.Android && Android.version) ? 'v' + Android.version() : 'v1.0.5 or older') + (WEBV ? ' · screen ' + WEBV : '');
$('gVer').textContent = 'Rewind TV ' + VERSION + (NATIVE ? '' : ' · web player');
function _v(type, pos, dur) {
  if (!NATIVE) return;
  vid._t = pos / 1000; if (dur > 0) vid._d = dur / 1000;
  if (type === 'meta') { vid.readyState = 2; vid.emit('loadedmetadata'); vid.emit('loadeddata'); }
  else if (type === 'playing') { vid.readyState = 4; vid.emit('playing'); }
  else if (type === 'waiting') { vid.readyState = 2; vid.emit('waiting'); }
  else if (type === 'ended') vid.emit('ended');
  else if (type === 'error') vid.emit('error');
}
const S = {
  idx: 0, last: 0, token: 0, guide: false, gSel: 0, paused: false,
  lists: {}, meta: {}, playing: null, stallTimer: 0, backAt: 0, digits: '', digitTimer: 0,
  adultUnlocked: false, pinEntry: '', pinMode: null, // null | 'unlock' | 'set' | 'confirm'
};

/* ---------- persistence helpers ---------- */
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
// Per-decade last channel (key) so switching tabs restores where you were.
function lastChFor(dec) { return (store.get('rt:lastCh') || {})[dec] || null; }
function setLastCh(dec, key) {
  const m = store.get('rt:lastCh') || {};
  m[dec] = key;
  store.set('rt:lastCh', m);
}
// Adult lock: simple 4-digit PIN. Empty string = unlocked by default until user sets one.
function adultPin() { return store.get('rt:pin') || ''; }
function setAdultPin(p) { store.set('rt:pin', String(p || '')); }
function isAdultLocked() { return !!adultPin() && !S.adultUnlocked; }
function needsPin(ch) { return !!ch && ADULT_KEYS.has(ch.key.split(':')[1] || ch.key) && isAdultLocked(); }
function askPin(then) {
  S.pinMode = 'unlock'; S.pinEntry = ''; S.pinDigit = 0; S.pendingAction = then;
  toast('🔒 Adult channel · ▲▼ pick each number, OK for next (or use number keys)', 5000);
  showPin();
}

/* ---------- fit the 1920x1080 stage to whatever screen we're on ---------- */
function fit() {
  const w = document.documentElement.clientWidth || innerWidth, h = document.documentElement.clientHeight || innerHeight;
  const s = Math.min(w / 1920, h / 1080);
  tv.style.transform = `translate(${(w - 1920 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fit); fit(); setTimeout(fit, 300); setTimeout(fit, 1500);

/* ---------- networking: native bridge on the Fire TV, fetch in a browser ---------- */
/* ---------- decade tabs ---------- */
let DEC = (store.get('rt:dec') && LINEUPS[store.get('rt:dec')]) ? store.get('rt:dec') : DEFAULT_DECADE;
let CHANNELS = lineup(DEC);

const pending = {}; let reqId = 0;
function get(url) {
  if (window.Android && Android.get) {
    return new Promise((res, rej) => { const id = ++reqId; pending[id] = { res, rej }; Android.get(url, id); });
  }
  return fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
}
function _got(id, ok, body) {
  const p = pending[id]; if (!p) return; delete pending[id];
  ok ? p.res(body) : p.rej(new Error(body));
}
const getJSON = url => get(url).then(JSON.parse);

/* ---------- helpers ---------- */
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, seed) { const r = rng(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pad = n => String(n).padStart(2, '0');
function clock(t = new Date()) { let h = t.getHours() % 12 || 12; return `${h}:${pad(t.getMinutes())}${t.getHours() < 12 ? 'a' : 'p'}`; }
function slotLabel(ms) { return clock(new Date(ms)); }
function cleanTitle(t) { return String(t || 'Untitled').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }

/* ---------- channel lists ---------- */
// Hand-checked tape lists (only sharp, watchable copies) built by tools/curate.py and kept on GitHub.
const LISTS = location.hostname === 'localhost' ? '/lists/' : 'https://raw.githubusercontent.com/Vyd02/RewindTV/main/lists/';
const bust = () => '?h=' + Math.floor(Date.now() / 36e5);
function curated(ch) {
  const [dec, theme] = ch.key.split(':');
  return getJSON(LISTS + dec + '/' + theme + '.json' + bust()).then(d => {
    const docs = (d.items || []).map(x => ({ id: x.id, title: cleanTitle(x.t), eps: x.e }));
    if (docs.length < 5) throw new Error('thin');
    docs.sort((a, b) => a.id < b.id ? -1 : 1);
    return arrange(ch, docs);
  });
}
function loadList(ch) {
  if (ch.special) return Promise.reject(new Error('special'));
  const tag = variantTag(ch, Date.now());
  if (!tag) return loadBase(ch);
  const k = ch.key + '|' + tag;
  if (S.lists[k]) return S.lists[k];
  const [dec] = ch.key.split(':');
  const parts = [tag.includes('sat') ? curated({ key: dec + ':satam' }).catch(() => loadBase(ch)) : loadBase(ch)];
  const sn = tag.includes('halloween') ? 'halloween' : tag.includes('christmas') ? 'christmas' : '';
  if (sn) parts.push(curated({ key: dec + ':' + sn }).catch(() => []));
  return (S.lists[k] = Promise.all(parts).then(([a, b]) => {
    const seen = new Set(), docs = [];
    // Holiday specials mixed in: about one show in four.
    const extra = (b || []).slice(0, Math.max(5, Math.ceil(a.length / 3)));
    for (const x of a.concat(extra)) if (!seen.has(x.id)) { seen.add(x.id); docs.push(x); }
    docs.sort((x, y) => x.id < y.id ? -1 : 1);
    return arrange({ key: k }, docs);
  }).catch(e => { delete S.lists[k]; return loadBase(ch); }));
}
function loadBase(ch) {
  if (S.lists[ch.key]) return S.lists[ch.key];
  return (S.lists[ch.key] = curated(ch).catch(() => { delete S.lists[ch.key]; return searchList(ch); }).then(l => (S.lists[ch.key] = Promise.resolve(l), l)));
}
// Fallback: live search (unchecked quality) if the curated list can't be reached.
function searchList(ch) {
  if (S.lists['s:' + ch.key]) return S.lists['s:' + ch.key];
  const key = 'rt:list:' + ch.key + ':' + hash(ch.q + SAFE);
  const cached = store.get(key);
  if (cached && Date.now() - cached.at < LIST_TTL && cached.docs.length) {
    return Promise.resolve(arrange(ch, cached.docs));
  }
  const url = 'https://archive.org/advancedsearch.php?' + new URLSearchParams([
    ['q', '(' + ch.q + ')' + SAFE], ['fl[]', 'identifier'], ['fl[]', 'title'],
    ['rows', LIST_ROWS], ['sort[]', 'downloads desc'], ['output', 'json'],
  ]);
  const p = getJSON(url).then(d => {
    const docs = d.response.docs.map(x => ({ id: x.identifier, title: cleanTitle(x.title) }));
    if (!docs.length) throw new Error('empty');
    docs.sort((a, b) => a.id < b.id ? -1 : 1);         // same order on every box
    store.set(key, { at: Date.now(), docs });
    return arrange(ch, docs);
  }).catch(e => { delete S.lists['s:' + ch.key]; if (cached) return arrange(ch, cached.docs); throw e; });
  return (S.lists['s:' + ch.key] = p);
}
// A fresh shuffle each week, the same for everybody watching.
function arrange(ch, docs) { const week = Math.floor(Date.now() / (7 * 864e5)); return shuffle(docs, hash(ch.key + ':' + week)); }

/* ---------- live broadcast clock ----------
   Each channel runs its tapes back-to-back, around the clock, reshuffled every day.
   Everyone tuning in at the same moment lands on the same show at the same spot,
   and when you come back later the channel has moved on, like real TV. */
const DAY_MS = 864e5, GUESS_LEN = 22 * 60;
// Movie channels always air the whole film, never a half-hour piece of it.
const MOVIE_THEMES = new Set(['movies', 'comedyfilm', 'noir', 'western', 'horror', 'skin', 'xxx']);
const TL = {};
function timeline(ch, list, t) {
  const day = Math.floor((t - new Date(t).getTimezoneOffset() * 6e4) / DAY_MS);
  const key = ch.key + ':' + day + ':' + list.length;
  if (TL[key]) return TL[key];
  const r = rng(hash(key));
  const entries = [];
  list.forEach((item, i) => {
    const eps = item.eps && item.eps.length ? item.eps : [null];
    // Series with lots of episodes get a couple of random ones today, not all of them.
    const picks = shuffle(eps.map((_, k) => k), hash(key + item.id)).slice(0, Math.min(eps.length, 2));
    for (const k of picks) {
      const len = Math.max(30, (eps[k] && eps[k].len) || GUESS_LEN);
      const whole = len <= 3600 || (MOVIE_THEMES.has(ch.key.split(':')[1]) && len <= 4 * 3600);
      if (whole) { entries.push({ i, slot: k, len, from: 0 }); continue; }
      // Long tapes (full VHS recordings, marathons) air as half-hour blocks, a couple per day.
      const blocks = Math.floor(len / 1800);
      for (const b of shuffle([...Array(blocks).keys()], hash(key + item.id + k)).slice(0, 2))
        entries.push({ i, slot: k, len: Math.min(1800, len - b * 1800), from: b * 1800 });
    }
  });
  const order = shuffle(entries, hash(key + 'order'));
  let acc = 0;
  for (const e of order) { e.at = acc; acc += e.len; }
  return (TL[key] = { order, total: acc, dayStart: day * DAY_MS + new Date(t).getTimezoneOffset() * 6e4 });
}
// What's on at time t: which tape, which episode, when it started.
function scheduleAt(ch, list, t) {
  const tl = timeline(ch, list, t);
  const pos = ((t - tl.dayStart) / 1000) % tl.total;
  let lo = 0, hi = tl.order.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tl.order[mid].at <= pos) lo = mid; else hi = mid - 1; }
  const e = tl.order[lo], into = pos - e.at;
  // 'start' is backdated by the block's position inside the tape, so (now - start) = where to play from.
  return { item: list[e.i], i: e.i, slot: e.slot, from: e.from, start: t - (e.from + into) * 1000,
           airs: t - into * 1000, end: t + (e.len - into) * 1000, tl: lo };
}
// The show after the one at time t.
function nextAfter(ch, list, t) { const now = scheduleAt(ch, list, t); return scheduleAt(ch, list, now.end + 1000); }
// The show at position k in today's running order, starting right now (used after a skip).
function entryAt(ch, list, k) {
  const t = Date.now(), tl = timeline(ch, list, t), n = tl.order.length;
  const idx = ((k % n) + n) % n, e = tl.order[idx];
  return { item: list[e.i], i: e.i, slot: e.slot, from: e.from, start: t - e.from * 1000, airs: t, end: t + e.len * 1000, tl: idx };
}
// When the current block's airtime is over, move on even if the tape keeps going.
function armBlock(sch) {
  clearTimeout(S.blockTimer); S.cur = sch;
  const token = S.token;
  S.blockTimer = setTimeout(() => {
    const p = S.playing;
    if (p && token === S.token && !S.inBreak) { staticOn(); nextNatural(p); }
  }, Math.max(5000, sch.end - Date.now() + 500));
}

/* ---------- item metadata: find the playable video files ---------- */
// Every video gets a list of copies, best quality first. If the best copy won't play
// (or can't keep up with the internet), the next copy down is tried before giving up.
const VID_EXT = NATIVE ? /\.(mp4|m4v|mkv|webm|mpe?g|mov)$/i : /\.mp4$/i;
function videos(item) {
  const id = item.id;
  if (item.eps && item.eps.length) {
    const url = n => 'https://archive.org/download/' + encodeURIComponent(id) + '/' + n.split('/').map(encodeURIComponent).join('/');
    return Promise.resolve(item.eps.map(e => ({
      cands: [e.n].concat(e.a || []).map(url), heights: [e.h], len: e.len || 0, title: e.t ? cleanTitle(e.t) : '',
    })));
  }
  if (S.meta[id]) return S.meta[id];
  return (S.meta[id] = getJSON('https://archive.org/metadata/' + encodeURIComponent(id)).then(m => {
    const files = (m.files || []).filter(f => VID_EXT.test(f.name));
    const height = f => parseInt(f.height, 10) || (/_512kb\./i.test(f.name) ? 240 : 360);
    const fmt = f => (f.format || '').toLowerCase();
    const rank = f => height(f) * 10
      + (/h\.264|mpeg4/.test(fmt(f)) ? 3 : /matroska|h\.265|hevc/.test(fmt(f)) ? 2 : 0)   // easiest to decode wins ties
      + (/\.ia\.mp4$/i.test(f.name) ? 1 : 0)                                         // same quality: the archive's streaming-ready copy starts faster
      + Math.min(0.5, (parseInt(f.size, 10) || 0) / 1e10);
    const groups = {};
    for (const f of files) {
      const base = f.name.replace(/(_512kb)?(\.ia)?\.[a-z0-9]+$/i, '');
      (groups[base] = groups[base] || []).push(f);
    }
    const url = f => 'https://archive.org/download/' + encodeURIComponent(id) + '/' + f.name.split('/').map(encodeURIComponent).join('/');
    const list = Object.keys(groups)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(base => {
        const g = groups[base].sort((a, b) => rank(b) - rank(a));
        const named = g.find(f => (f.title || '').length > 2);
        return {
          cands: g.map(url),
          heights: g.map(height),
          len: Math.max(...g.map(f => parseFloat(f.length) || 0)),
          title: named ? cleanTitle(named.title) : '',
        };
      });
    if (!list.length) throw new Error('no video');
    return list;
  }).catch(e => { delete S.meta[id]; throw e; }));
}

/* ---------- tapes you've blocked (hold fast-forward) ---------- */
// Saved as { id: title }. Older saves were a plain list of ids.
const blockRaw = store.get('rt:block') || {};
const blockMap = Array.isArray(blockRaw) ? Object.fromEntries(blockRaw.map(id => [id, id])) : blockRaw;
const blocked = { has: id => Object.prototype.hasOwnProperty.call(blockMap, id) };
let lastBlock = null;
function saveBlocks() { store.set('rt:block', blockMap); }
function blockCurrent() {
  const p = S.playing; if (!p) return;
  const item = p.list[p.i % p.list.length];
  blockMap[item.id] = item.title; saveBlocks();
  lastBlock = { id: item.id, at: Date.now(), ch: p.ch, list: p.list, i: p.i, ms: Math.round((vid.currentTime || 0) * 1000), slot: p.slot };
  toast('🚫 Blocked “' + item.title.slice(0, 40) + '” · press ⏪ to undo', 10000);
  skip();
}
function undoBlock() {
  const b = lastBlock; lastBlock = null;
  delete blockMap[b.id]; saveBlocks();
  toast('↩ Unblocked. Back to your tape', 2500);
  staticOn();
  play(b.ch, b.list, b.i, b.ms, S.token, 0, b.slot);
}

/* ---------- skip / start over ---------- */
function skipShow() {
  if (S.inBreak) { toast('⏭ Skipping the break', 1500); return endBreak(); }
  const p = S.playing; if (!p) return;
  toast('⏭ Skipping to the next show', 1800);
  skip();
}
function startOver() {
  const p = S.playing; if (!p) return;
  try { vid.currentTime = 0.01; } catch (e) {}
  vid.play().catch(() => {}); S.paused = false;
  vcr('⏮ FROM THE TOP'); setTimeout(() => vcr(''), 1500);
}

/* Blocked Tapes list: open the guide, then press ⏯ */
let blkSel = 0;
function blockedIds() { return Object.keys(blockMap); }
function openBlocked() {
  S.blk = true; blkSel = 0; drawBlocked(); $('toast').classList.add('hidden');
  $('blk').classList.remove('hidden');
}
function closeBlocked() { S.blk = false; $('blk').classList.add('hidden'); }
function drawBlocked() {
  const ids = blockedIds();
  const pinSet = !!adultPin();
  // Extra rows at the bottom for adult lock management.
  const extra = [
    { id: '__pin__', label: pinSet ? '🔒 Change adult PIN (SKIN + XXX)' : '🔒 Set adult PIN (locks SKIN + XXX)' },
    { id: '__clearpin__', label: pinSet ? '🔓 Clear adult PIN (unlock permanently)' : null },
  ].filter(x => x.label);
  const all = ids.map(id => ({ id, label: blockMap[id] })).concat(extra);
  blkSel = Math.max(0, Math.min(blkSel, all.length - 1));
  $('blkList').innerHTML = all.length
    ? all.map((row, k) => `<div class="br${k === blkSel ? ' sel' : ''}">${String(row.label).replace(/</g, '&lt;')}</div>`).join('')
    : '<div class="br empty">Nothing blocked. Hold ⏩ on a tape you never want to see.</div>';
  const top = Math.max(0, blkSel - 3);
  $('blkList').style.transform = `translateY(${-top * 86}px)`;
  S._blkAll = all;
}
function blockedKey(key) {
  const all = S._blkAll || [];
  switch (key) {
    case 'Up': blkSel--; return drawBlocked();
    case 'Down': blkSel++; return drawBlocked();
    case 'OK': {
      if (!all.length) return;
      const row = all[blkSel];
      if (row.id === '__pin__') {
        closeBlocked();
        S.pinMode = 'set'; S.pinEntry = ''; S.pinDigit = 0;
        toast('New adult PIN · ▲▼ pick each number, OK for next', 5000);
        return showPin();
      }
      if (row.id === '__clearpin__') {
        setAdultPin('');
        S.adultUnlocked = true;
        toast('🔓 Adult lock cleared', 2500);
        return drawBlocked();
      }
      // Normal unblock
      const id = row.id; const t = blockMap[id];
      delete blockMap[id]; saveBlocks();
      toast('✅ Unblocked “' + t.slice(0, 40) + '”', 2500);
      const el = $('blkList').children[blkSel];
      if (el) { el.classList.add('gone'); setTimeout(drawBlocked, 350); } else drawBlocked();
      return;
    }
    case 'Back': case 'PlayPause': case 'Left': case 'Guide': return closeBlocked();
  }
}

/* ---------- tuning ---------- */
async function tune(idx, opts = {}) {
  const n = CHANNELS.length;
  idx = ((idx % n) + n) % n;
  const ch = CHANNELS[idx];

  // Adult lock: ask for the PIN first; nothing changes unless it's right.
  if (needsPin(ch) && !opts.force) return askPin(() => tune(idx, { force: true }));

  if (idx !== S.idx && S.idx >= 0) S.last = S.idx;
  S.idx = idx;

  const token = ++S.token;
  S.vod = null; S.offClock = false;
  cancelBreak(); stopSpecial(); tone(false); clearTimeout(S.signT);
  if (S.booted) sfxClunk(); S.booted = true;
  store.set('rt:ch', { dec: ch.dec, num: ch.num, key: ch.key });
  store.set('rt:dec', ch.dec);
  setLastCh(ch.dec, ch.key);
  S.paused = false; vcr('');
  staticOn();
  osd(ch);
  banner(ch, 'Tuning…', '', 0);
  vid.pause(); vid.removeAttribute('src'); vid.load();
  bars(false);
  if (ch.special) return startSpecial(ch);
  if (signOffNow(ch)) return signOff(ch);
  try {
    const list = await loadList(ch);
    if (token !== S.token) return;
    const now = Date.now();
    const sch = scheduleAt(ch, list, now);
    armBlock(sch);
    await play(ch, list, sch.i, now - sch.start, token, 0, sch.slot);
  } catch (e) {
    if (token === S.token) offAir(ch);
  }
}

async function play(ch, list, i, offsetMs, token, tries, slot, k = 0) {
  if (tries > 6) return offAir(ch);
  let hop = 0;
  while (blocked.has(list[i % list.length].id) && hop++ < list.length) { i++; offsetMs = 0; slot = null; clearTimeout(S.blockTimer); }
  const item = list[i % list.length];
  let files;
  try { files = await videos(item); } catch (e) {
    if (token === S.token) return play(ch, list, i + 1, 0, token, tries + 1, slot);
    return;
  }
  if (token !== S.token) return;
  const fi = (slot != null ? slot : i) % files.length;
  const f = files[fi];
  let off = offsetMs / 1000;
  if (f.len > 0) off = off % f.len;
  if (f.len > 0 && f.len - off < 20) off = Math.max(0, f.len - 20);
  const title = files.length > 1 && f.title ? item.title + ' — ' + f.title : item.title;
  const nx = nextAfter(ch, list, Date.now() + 2000), next = nx.item;
  const nxAt = nx.airs || nx.start;
  k = Math.min(k, f.cands.length - 1);
  S.playing = { ch, list, i, f, fi, k, title, token, tries, slot, offsetMs, startOff: off, watched: 0 };

  vid.startAt = off;
  vid.src = f.cands[k];
  vid.onloadedmetadata = () => {
    if (token !== S.token) return;
    if (!f.len && vid.duration) off = off % vid.duration;
    try { vid.currentTime = off; } catch (e) {}
  };
  clearTimeout(S.stallTimer);
  S.stallTimer = setTimeout(() => { if (token === S.token && vid.readyState < 3) downgrade(); }, STALL_MS);
  vid.play().catch(() => {});
  banner(ch, title, 'Up next at ' + clock(new Date(nxAt)) + ': ' + next.title, f.len ? off / f.len : 0);
}

// Best copy won't play or keeps stalling: try the next-best copy of the same video, then move on.
function downgrade() {
  if (S.special || S.inBreak) return;
  const p = S.playing; if (!p) return;
  if (p.k + 1 < p.f.cands.length) {
    const ms = Math.round((vid.currentTime || p.startOff) * 1000);
    return play(p.ch, p.list, p.i, ms, p.token, p.tries, p.slot, p.k + 1);
  }
  skip();
}
function skip() {
  if (S.vod) return vodNext();
  const p = S.playing; if (!p) return;
  staticOn();
  // Step to the next show in today's lineup after the one playing (not "next on the clock",
  // which never changes between quick skips and just bounced between two shows).
  const here = S.cur && S.cur.tl != null ? S.cur.tl : scheduleAt(p.ch, p.list, Date.now()).tl;
  let n = entryAt(p.ch, p.list, here + 1);
  if (n.i === p.i && n.slot === p.slot) n = entryAt(p.ch, p.list, here + 2);
  S.offClock = true;              // after a skip, keep going in order until you change channels
  armBlock(n);
  play(p.ch, p.list, n.i, n.from * 1000, p.token, p.tries + 1, n.slot).then(() => showIdent(p.ch));
}

vid.addEventListener('loadeddata', () => { if (!vid.paused || vid.readyState >= 2) staticOff(); });
vid.addEventListener('playing', () => { clearTimeout(S.stallTimer); staticOff(); bars(false); if (S.playing) S.playing.tries = 0; prefetch(); });
// Look up what's on the channels next door so flipping to them skips the slow lookups.
function prefetch() {
  const n = CHANNELS.length;
  [S.idx + 1, S.idx - 1, S.last].forEach(k => {
    const ch = CHANNELS[((k % n) + n) % n];
    loadList(ch).then(list => videos(scheduleAt(ch, list, Date.now()).item)).catch(() => {});
  });
}
vid.addEventListener('waiting', () => { if (S.special || S.inBreak) return; clearTimeout(S.stallTimer); S.stallTimer = setTimeout(() => { if (vid.readyState < 3 && !S.paused) downgrade(); }, STALL_MS); });
vid.addEventListener('ended', () => {
  if (S.special) return nextTrack();
  if (S.inBreak) return endBreak();
  const p = S.playing; if (!p) return; staticOn(); if (S.vod) return vodNext();
  nextNatural(p);
});
// Go to whatever the channel's clock says is on now. If the clock still says the tape that
// just ended (its real length was shorter than listed), go to the next show from its top.
function followClock(p, tries) {
  if (S.offClock && S.cur) {
    const n = entryAt(p.ch, p.list, S.cur.tl + 1);
    armBlock(n);
    return play(p.ch, p.list, n.i, n.from * 1000, p.token, tries, n.slot);
  }
  const now = Date.now();
  let sch = scheduleAt(p.ch, p.list, now);
  if (S.cur && sch.tl === S.cur.tl) { sch = nextAfter(p.ch, p.list, now); armBlock(sch); return play(p.ch, p.list, sch.i, sch.from * 1000, p.token, tries, sch.slot); }
  armBlock(sch);
  return play(p.ch, p.list, sch.i, now - sch.start, p.token, tries, sch.slot);
}
vid.addEventListener('error', () => {
  if (S.special) return setTimeout(nextTrack, 1500);
  if (S.inBreak) return endBreak();
  if (vid.getAttribute('src')) downgrade();
});

function offAir(ch) {
  staticOff(); bars(true, 'OFF THE AIR');
  banner(ch, 'Off the air', 'Try another channel, or check your internet', 0);
}

/* ---------- static (canvas noise + a little hiss) ---------- */
const sc = $('static'), sx = sc.getContext('2d'), img = sx.createImageData(sc.width, sc.height);
let staticRaf = 0, staticAt = 0, audio = null;
function drawStatic() {
  const d = img.data, roll = (performance.now() / 6) % sc.height;
  for (let y = 0, p = 0; y < sc.height; y++) {
    const band = Math.abs(y - roll) < 10 ? 60 : 0;
    for (let x = 0; x < sc.width; x++, p += 4) {
      const v = Math.min(255, ((Math.random() * 255) | 0) + band);
      d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
    }
  }
  sx.putImageData(img, 0, 0);
  staticRaf = requestAnimationFrame(drawStatic);
}
function hiss(on) {
  try {
    if (!audio) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ac.createGain(); g.gain.value = 0;
      const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
      src.connect(f).connect(g).connect(ac.destination); src.start();
      audio = { ac, g };
    }
    if (audio.ac.state === 'suspended') audio.ac.resume();
    audio.g.gain.setTargetAtTime(on ? 0.05 : 0, audio.ac.currentTime, 0.05);
  } catch (e) {}
}
let staticCut = 0;
function staticOn() {
  staticAt = performance.now(); sc.style.opacity = 1; $('tune').classList.add('hidden');
  if (!staticRaf) drawStatic(); hiss(true);
  clearTimeout(staticCut);
  // After a short burst, drop the static and show a calm "TUNING..." card until the picture arrives.
  staticCut = setTimeout(() => { if (sc.style.opacity === '1') { stopStatic(); $('tune').classList.remove('hidden'); } }, STATIC_MS);
}
function stopStatic() {
  sc.style.opacity = 0; hiss(false);
  setTimeout(() => { if (sc.style.opacity === '0') { cancelAnimationFrame(staticRaf); staticRaf = 0; } }, 300);
}
function staticOff() {
  clearTimeout(staticCut); $('tune').classList.add('hidden');
  const wait = Math.max(0, 250 - (performance.now() - staticAt));
  setTimeout(stopStatic, wait);
}
function bars(on, text) { $('bars').classList.toggle('hidden', !on); if (text) $('barsText').textContent = text; if (on) { clearTimeout(staticCut); $('tune').classList.add('hidden'); stopStatic(); } }

/* ---------- on-screen bits ---------- */
let osdTimer = 0, bannerTimer = 0, toastTimer = 0;
function osd(ch) {
  $('osdNum').textContent = typeof ch.num === 'number' ? pad(ch.num) : ch.num; $('osdCall').textContent = ch.call;
  $('osd').classList.remove('hidden');
  clearTimeout(osdTimer); osdTimer = setTimeout(() => $('osd').classList.add('hidden'), 3500);
}
function vcr(text, blink) { const v = $('vcr'); v.textContent = text; v.classList.toggle('hidden', !text); v.classList.toggle('blink', !!blink); }
function banner(ch, title, next, frac) {
  tv.style.setProperty('--ch', ch.color);
  $('bnNum').textContent = ch.num; $('bnCall').textContent = ch.call; $('bnChan').textContent = ch.dec + ' · ' + ch.name;
  $('bnTitle').textContent = title; $('bnNext').textContent = next || '';
  $('bnFill').style.width = (Math.max(0, Math.min(1, frac)) * 100) + '%';
  showBanner();
}
function showBanner() {
  if (S.guide) return;
  $('banner').classList.remove('hidden');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => $('banner').classList.add('hidden'), 6000);
}
function toast(text, ms = 2000) { const t = $('toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms); }
setInterval(() => {
  $('bnClock').textContent = clock(); $('gClock').textContent = clock();
  const p = S.playing; if (p && p.f.len && vid.currentTime && !S.inBreak && !S.special) $('bnFill').style.width = (vid.currentTime / p.f.len * 100) + '%';
}, 1000);

/* ---------- guide ---------- */
const ROW_H = 96;
const G = { dec: DEC, list: CHANNELS };
const TABS = DECADES.map(d => d.id).concat(['MOVIES', 'SHOWS', 'TAPES']);
const isVod = t => t === 'MOVIES' || t === 'SHOWS' || t === 'TAPES';
function drawTabs() {
  $('gTabs').innerHTML = TABS.map(t =>
    `<div class="tab${t === G.dec ? ' on' : ''}${t === DEC ? ' live' : ''}${isVod(t) ? ' vod' : ''}">${t}</div>`).join('') + '<div id="gTabSel"></div>';
  const k = TABS.indexOf(G.dec), el = $('gTabs').children[k];
  requestAnimationFrame(() => { const sel = $('gTabSel'); if (el && sel) { sel.style.transform = `translateX(${el.offsetLeft}px)`; sel.style.width = el.offsetWidth + 'px'; } });
}
function buildGuide() {
  if (isVod(G.dec)) return buildVod();
  const now = Date.now();
  G.list = G.dec === DEC ? CHANNELS : lineup(G.dec);
  drawTabs();
  $('gNowHead').textContent = 'ON NOW';
  $('gNextHead').textContent = 'UP NEXT';
  $('gRows').innerHTML = G.list.map((ch, k) =>
    `<div class="gr" style="--ch:${ch.color}"><div class="gc"><b>${ch.num}</b>${ch.call}</div>` +
    `<div class="gt now" id="gn${k}">…</div><div class="gt" id="gx${k}">…</div></div>`).join('');
  const dec = G.dec;
  G.list.forEach((ch, k) => {
    if (ch.special) {
      $('gn' + k).textContent = ch.special === 'prevue' ? 'Prevue Guide · scrolling listings' : 'Local on the 8s · your forecast';
      $('gx' + k).textContent = ch.special === 'prevue' ? 'with the classic guide music' : 'with smooth jazz';
      return;
    }
    if (signOffNow(ch)) { $('gn' + k).textContent = 'Signed off for the night'; $('gx' + k).innerHTML = '<span class="tag">5:30a</span>Back on the air'; return; }
    loadList(ch).then(list => {
      if (G.dec !== dec) return;
      const a = scheduleAt(ch, list, now), b = nextAfter(ch, list, now);
      $('gn' + k).textContent = a.item.title;
      $('gx' + k).innerHTML = '<span class="tag">' + clock(new Date(b.airs)) + '</span>' + b.item.title.replace(/</g, '&lt;');
    }).catch(() => { if (G.dec === dec) { $('gn' + k).textContent = 'Off the air'; $('gx' + k).textContent = ''; } });
  });
  $('gRows').classList.remove('swap'); void $('gRows').offsetWidth; $('gRows').classList.add('swap');
}
function moveGuide(k) {
  const n = G.list.length; S.gSel = ((k % n) + n) % n;
  if (isVod(G.dec) && !(G.list[0] && G.list[0].loading)) VODSEL[G.dec] = S.gSel;
  const visible = Math.floor(($('gList').clientHeight || 420) / ROW_H);
  const top = Math.max(0, Math.min(S.gSel - Math.floor(visible / 2), n - visible));
  $('gRows').style.transform = `translateY(${-top * ROW_H}px)`;
  $('gSel').style.transform = `translateY(${(S.gSel - top) * ROW_H}px)`;
}
function switchTab(dir) {
  const k = TABS.indexOf(G.dec);
  const next = TABS[(k + dir + TABS.length) % TABS.length];
  const sel = S.gSel, fromVod = isVod(G.dec);
  G.dec = next; buildGuide();
  moveGuide(isVod(next) || fromVod ? 0 : Math.min(sel, G.list.length - 1));
}

/* ---------- On Demand: full movies and full episodes, from the start ---------- */
const VOD = {}, VODSEL = {};
function loadVod(kind) {
  return VOD[kind] || (VOD[kind] = getJSON(LISTS + 'ondemand/' + kind.toLowerCase() + '.json' + bust())
    .then(d => d.items.map(x => ({ id: x.id, title: cleanTitle(x.t), dec: x.dec, g: x.g, eps: x.e })))
    .catch(e => { delete VOD[kind]; throw e; }));
}
const GENRE = { movies: 'FLIX', comedyfilm: 'LOL', noir: 'NOIR', western: 'OATER', horror: 'FRITE' };
function hm(sec) { const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h}h ${pad(m)}m` : `${m} min`; }
function buildVod() {
  const kind = G.dec;
  if (kind === 'TAPES') return buildTapes();
  drawTabs();
  $('gNowHead').textContent = kind === 'MOVIES' ? 'FULL MOVIES · START TO FINISH' : 'FULL EPISODES';
  $('gNextHead').textContent = kind === 'MOVIES' ? 'LENGTH' : 'EPISODES';
  G.list = [{ loading: true }];
  $('gRows').innerHTML = '<div class="gr"><div class="gc"><b>…</b></div><div class="gt now">Loading the library…</div><div class="gt"></div></div>';
  loadVod(kind).then(items => {
    if (G.dec !== kind) return;
    G.list = items;
    const esc = t => t.replace(/</g, '&lt;');
    $('gRows').innerHTML = items.map(it =>
      `<div class="gr" style="--ch:#ffe066"><div class="gc"><b>${it.dec}</b>${kind === 'MOVIES' ? (GENRE[it.g] || 'FLIX') : 'SHOW'}</div>` +
      `<div class="gt now">${esc(it.title)}</div><div class="gt">${kind === 'MOVIES' ? hm(it.eps[0].len) : it.eps.length + ' episodes'}</div></div>`).join('');
    // Land on what you're watching; else where you last were in this tab; else your decade.
    const watching = S.vod && S.vod.kind === kind ? items.findIndex(it => it.id === S.vod.item.id) : -1;
    const remembered = VODSEL[kind] != null ? VODSEL[kind] : -1;
    const start = Math.max(0, items.findIndex(it => it.dec === DEC));
    moveGuide(watching >= 0 ? watching : remembered >= 0 ? Math.min(remembered, items.length - 1) : start);
  }).catch(() => { if (G.dec === kind) $('gRows').innerHTML = '<div class="gr"><div class="gt now">Couldn\u2019t load On Demand. Check the internet.</div></div>'; });
  $('gRows').classList.remove('swap'); void $('gRows').offsetWidth; $('gRows').classList.add('swap');
}
function buildTapes() {
  drawTabs();
  $('gNowHead').textContent = 'MY TAPES · OK play · ⏩ erase';
  $('gNextHead').textContent = 'TAPED FROM';
  const t = tapes(); G.list = t.length ? t.map(x => Object.assign({}, x, { title: x.title })) : [{ loading: true }];
  const esc = s => String(s).replace(/</g, '&lt;');
  $('gRows').innerHTML = t.length
    ? t.map(x => `<div class="gr" style="--ch:#ff5c8a"><div class="gc"><b>📼</b>${x.dec}</div><div class="gt now">${esc(x.title)}</div><div class="gt">${esc(x.ch)} · ${new Date(x.at).toLocaleDateString()}</div></div>`).join('')
    : '<div class="gr"><div class="gt now">No tapes yet. Double-tap ⏯ on any show to tape it.</div></div>';
  moveGuide(0);
}
function pickVod(k) {
  const it = G.list[k]; if (!it || it.loading) return;
  if (G.dec === 'TAPES') return playVod({ id: it.id, title: it.title, dec: it.dec, eps: it.eps || undefined }, it.slot || 0, 'TAPES');
  VODSEL[G.dec] = k;
  if (G.dec === 'MOVIES') return playVod(it, 0, 'MOVIES');
  const onEp = S.vod && S.vod.item.id === it.id ? S.vod.ep : 0;
  openPicker(it.title, it.eps.map((e, n) => {
    const prog = loadVodProgress(it, n);
    const mark = (S.vod && S.vod.item.id === it.id && n === S.vod.ep) ? '  ▶ watching'
      : (prog > 30 ? '  ⏱ ' + hm(prog) : '');
    return `${pad(n + 1)}. ${e.t ? cleanTitle(e.t) : 'Episode ' + (n + 1)} · ${hm(e.len)}${mark}`;
  }), n => playVod(it, n, 'SHOWS'), onEp);
}
function vodProgressKey(item, ep) { return 'rt:vodpos:' + item.id + ':' + (ep || 0); }
function saveVodProgress() {
  const v = S.vod; if (!v || !vid || !isFinite(vid.currentTime)) return;
  const t = Math.floor(vid.currentTime);
  if (t < 20) return; // don't save tiny progress
  store.set(vodProgressKey(v.item, v.ep), { t, at: Date.now(), title: v.item.title });
}
function loadVodProgress(item, ep) {
  const p = store.get(vodProgressKey(item, ep));
  if (!p || !p.t) return 0;
  // Expire progress after 30 days
  if (Date.now() - (p.at || 0) > 30 * 864e5) return 0;
  return p.t;
}
async function playVod(item, ep, kind) {
  closePicker(); closeGuide();
  S.vod = { item, ep, kind };
  const ch = { num: '▶', call: kind === 'MOVIES' ? 'MOVIE' : 'SHOW', name: 'On Demand', color: '#ffe066', key: 'vod:' + item.id, dec: item.dec };
  const token = ++S.token;
  clearTimeout(S.blockTimer); S.cur = null; S.paused = false; vcr('');
  cancelBreak(); stopSpecial(); tone(false);
  staticOn(); osd(ch);
  vid.pause(); vid.removeAttribute('src'); vid.load();
  const resume = loadVodProgress(item, ep);
  await play(ch, [item], 0, resume * 1000, token, 0, ep);
  if (token !== S.token) return;
  if (resume > 30) toast('▶ Resuming from ' + hm(resume), 2200);
  const next = kind === 'SHOWS' && ep + 1 < item.eps.length ? 'Next: episode ' + (ep + 2) + ' plays automatically' : 'On Demand · ⏪⏪ start over · CH ▲▼ back to live TV';
  $('bnNext').textContent = next; showBanner();
}
function vodNext() {
  const v = S.vod; if (!v) return;
  // Clear progress for the episode that just finished
  try { store.set(vodProgressKey(v.item, v.ep), null); } catch (e) {}
  if (v.kind === 'SHOWS' && v.ep + 1 < v.item.eps.length) return playVod(v.item, v.ep + 1, v.kind);
  S.vod = null; toast('That\u2019s the end. Back to live TV', 2500); tune(S.idx);
}
// Periodically save On Demand progress
setInterval(() => { if (S.vod && !S.paused) saveVodProgress(); }, 15000);

/* A pop-up list to pick from (episodes). */
const PK = { rows: [], sel: 0, onPick: null };
function openPicker(title, rows, onPick, sel = 0) {
  Object.assign(PK, { rows, sel, onPick }); S.pick = true;
  $('pkHead').textContent = title; drawPicker(); $('pick').classList.remove('hidden');
}
function closePicker() { S.pick = false; $('pick').classList.add('hidden'); }
function drawPicker() {
  PK.sel = Math.max(0, Math.min(PK.sel, PK.rows.length - 1));
  const top = Math.max(0, PK.sel - 3);
  $('pkList').innerHTML = PK.rows.map((r, k) => `<div class="br${k === PK.sel ? ' sel' : ''}">${r.replace(/</g, '&lt;')}</div>`).join('');
  $('pkList').style.transform = `translateY(${-top * 86}px)`;
}
function pickerKey(key) {
  switch (key) {
    case 'Up': PK.sel--; return drawPicker();
    case 'Down': PK.sel++; return drawPicker();
    case 'ChannelUp': PK.sel -= 6; return drawPicker();
    case 'ChannelDown': PK.sel += 6; return drawPicker();
    case 'OK': return PK.onPick && PK.onPick(PK.sel);
    case 'Back': case 'Left': case 'Guide': return closePicker();
  }
}

/* ⏩ / ⏪: one tap seeks, two quick taps skip / start over. */
const TAP = {};
function tap(id, single, double) {
  if (TAP[id]) { clearTimeout(TAP[id]); TAP[id] = 0; return double(); }
  TAP[id] = setTimeout(() => { TAP[id] = 0; single(); }, 380);
}
function seekBy(d) {
  try { vid.currentTime = Math.max(0, (vid.currentTime || 0) + d); } catch (e) {}
  vcr(d > 0 ? '▶▶ +' + d + 's' : '◀◀ ' + d + 's'); clearTimeout(S.vcrT); S.vcrT = setTimeout(() => vcr(S.paused ? '❚❚ PAUSE' : ''), 1100);
}
function openGuide() {
  if (NATIVE) Android.vRect(1054 / 1920, 60 / 1080, 0.42, 0.42);
  S.guide = true; G.dec = S.vod ? S.vod.kind : DEC; buildGuide(); document.body.classList.add('guide');
  $('guide').classList.remove('hidden'); $('banner').classList.add('hidden');
  moveGuide(S.vod ? 0 : S.idx);
}
function closeGuide() { if (NATIVE && S.guide) Android.vRect(0, 0, 1, 1); S.guide = false; document.body.classList.remove('guide'); $('guide').classList.add('hidden'); }
function tuneFromGuide(k) {
  if (isVod(G.dec)) return pickVod(k);
  closeGuide();
  if (G.dec !== DEC) {
    const list = G.list, dec = G.dec;
    const go = () => { DEC = dec; CHANNELS = list; store.set('rt:dec', DEC); S.last = S.idx; S.idx = -1; tune(k, { force: true }); };
    // The channel you highlighted is the one you get (PIN first if it's locked).
    return needsPin(list[k]) ? askPin(go) : go();
  }
  if (k !== S.idx) tune(k); else showBanner();
}

/* ---------- remote ---------- */
function remote(key) {
  if (S.pinMode) return pinKey(key);
  if (S.blk) return blockedKey(key);
  if (S.pick) return pickerKey(key);
  if (/^\d$/.test(key)) return digit(key);
  if (S.guide) {
    switch (key) {
      case 'Up': return moveGuide(S.gSel - 1);
      case 'Down': return moveGuide(S.gSel + 1);
      case 'ChannelUp': return moveGuide(S.gSel - (isVod(G.dec) ? 10 : 5));
      case 'ChannelDown': return moveGuide(S.gSel + (isVod(G.dec) ? 10 : 5));
      case 'OK': return tuneFromGuide(S.gSel);
      case 'Left': return switchTab(-1);
      case 'Right': return switchTab(1);
      case 'PlayPause': return openBlocked();
      case 'FastForward': if (G.dec === 'TAPES') return deleteTape(S.gSel); return;
      case 'Back': case 'Guide': return closeGuide();
    }
    return;
  }
  switch (key) {
    case 'Up': case 'ChannelUp': return tune(S.idx + 1);
    case 'Down': case 'ChannelDown': return tune(S.idx - 1);
    case 'OK': case 'Guide': return openGuide();
    case 'Right': return showBanner();
    case 'Left': case 'Flashback': toast('↩ FLASHBACK', 1200); return tune(S.last);
    case 'PlayPause': return tap('pp', togglePause, tapeIt);
    case 'Rewind': return tap('rw', () => seekBy(-15), startOver);
    case 'FastForward': return tap('ff', () => seekBy(30), skipShow);
    case 'Block': return seekBy(30);          // holding ⏩ on the remote
    case 'Back':
      if (Date.now() - S.backAt < 2500) return powerOff();
      S.backAt = Date.now(); toast('Press BACK again to turn off'); return;
  }
}
function digit(d) {
  if (S.pinMode) return pinPush(d);

  // Normal direct channel entry
  S.digits = (S.digits + d).slice(-2);
  $('osdNum').textContent = S.digits.padEnd(2, '_'); $('osdCall').textContent = '';
  $('osd').classList.remove('hidden'); clearTimeout(osdTimer);
  clearTimeout(S.digitTimer);
  S.digitTimer = setTimeout(() => {
    const k = CHANNELS.findIndex(c => c.num === parseInt(S.digits, 10)); S.digits = '';
    if (k >= 0) { closeGuide(); tune(k); } else { toast('No channel there'); $('osd').classList.add('hidden'); }
  }, 1300);
}
/* =====================================================================
   OLD-SCHOOL TV: commercial breaks, station IDs, sounds, Tape it,
   Saturday mornings, overnight sign-off, holiday specials,
   the Prevue guide channel and Local on the 8s weather.
   ===================================================================== */

/* ---------- sounds (synthesized, no files) ---------- */
function ac() { hiss(false); return audio && audio.ac; }
function sfxOn() {
  try {
    const a = ac(); if (!a) return; const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(15700, t + 0.9);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 1.5);
    const h = a.createOscillator(), hg = a.createGain();            // low power-on thump
    h.type = 'triangle'; h.frequency.value = 55; hg.gain.setValueAtTime(0.18, t); hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    h.connect(hg).connect(a.destination); h.start(t); h.stop(t + 0.6);
  } catch (e) {}
}
function sfxClunk() {
  try {
    const a = ac(); if (!a) return; const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.15);
  } catch (e) {}
}
function sfxOff() {
  try {
    const a = ac(); if (!a) return; const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.45);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.55);
  } catch (e) {}
}
let toneNode = null;
function tone(on) {
  try {
    if (toneNode) { toneNode.stop(); toneNode = null; }
    if (!on) return;
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 1000; g.gain.value = 0.02; o.connect(g).connect(a.destination); o.start();
    o.stop(a.currentTime + 20); toneNode = o;
  } catch (e) {}
}

/* ---------- station ID before each new show ---------- */
let identT = 0;
function showIdent(ch) {
  if (!ch || ch.special || S.vod) return;
  const el = $('ident');
  el.style.setProperty('--ch', ch.color);
  $('idNum').textContent = ch.num; $('idCall').textContent = ch.call; $('idName').textContent = ch.dec + ' · ' + ch.name;
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  clearTimeout(identT); identT = setTimeout(() => el.classList.remove('go'), 3200);
}

/* ---------- commercial breaks between shows ---------- */
const NO_BREAKS = new Set(['ads', 'kidbreaks', 'toyads', 'gameads', 'infomercial', 'psa', 'trailers', 'music', 'mtv', 'vh1',
  'weather', 'vhs', 'skin', 'xxx', 'latenight']);
const BREAKS = {};
function breakList(dec) {
  return BREAKS[dec] || (BREAKS[dec] = curated({ key: dec + ':ads' }).catch(e => { delete BREAKS[dec]; throw e; }));
}
function wantsBreak(ch) { return ch && !ch.special && !S.vod && !NO_BREAKS.has(ch.key.split(':')[1]) && Math.random() < 0.85; }
async function maybeBreak(ch, then) {
  if (!wantsBreak(ch)) return then();
  let list;
  try { list = await breakList(ch.dec); } catch (e) { return then(); }
  const pool = [];
  list.forEach(it => (it.eps || []).forEach(e => { if ((e.len || 0) > 150) pool.push({ it, e }); }));
  if (!pool.length) return then();
  const { it, e } = pool[Math.floor(Math.random() * pool.length)];
  const dur = 60 + Math.floor(Math.random() * 90);                // 1 to 2.5 minutes of real commercials
  const off = Math.floor(Math.random() * Math.max(1, e.len - dur - 30));
  const token = S.token;
  S.inBreak = { token, then };
  clearTimeout(S.stallTimer);
  vid.startAt = off;
  vid.src = 'https://archive.org/download/' + encodeURIComponent(it.id) + '/' + e.n.split('/').map(encodeURIComponent).join('/');
  vid.onloadedmetadata = () => { try { vid.currentTime = off; } catch (x) {} };
  vid.play().catch(() => {});
  $('banner').classList.add('hidden');
  toast('📺 We’ll be right back', 2500);
  clearTimeout(S.breakTimer);
  S.breakTimer = setTimeout(endBreak, dur * 1000);
  S.breakStall = setTimeout(() => { if (S.inBreak && vid.readyState < 3) endBreak(); }, 12000);
}
function endBreak() {
  const b = S.inBreak; if (!b) return;
  S.inBreak = null; clearTimeout(S.breakTimer); clearTimeout(S.breakStall);
  if (b.token === S.token) { staticOn(); b.then(); }
}
function cancelBreak() { S.inBreak = null; clearTimeout(S.breakTimer); clearTimeout(S.breakStall); }
// A show ended (or its block ran out): break, then whatever's next, with a station ID.
function nextNatural(p) {
  maybeBreak(p.ch, () => {
    if (signOffNow(p.ch)) return signOff(p.ch);
    followClock(p, 0).then(() => { showBanner(); showIdent(p.ch); });
  });
}

/* ---------- Saturday mornings, overnight sign-off, holidays ---------- */
const KID_THEMES = new Set(['cartoons', 'cn', 'nick', 'foxkids', 'kidswb', 'disney', 'abcsat', 'toonami', 'boomerang', 'jetix', 'nickjr', 'pbskids']);
const SIGNOFF_THEMES = new Set(['tv', 'sitcom', 'gameshow', 'news', 'nickatnite', 'pbskids', 'nickjr', 'psa', 'school']);
const SEASON_THEMES = new Set(['cartoons', 'satam', 'tv', 'sitcom', 'cn', 'nick', 'disney', 'foxkids', 'kidswb', 'abcsat', 'boomerang',
  'nickjr', 'pbskids', 'movies', 'horror', 'comedyfilm', 'toonami', 'nickatnite', 'gameshow']);
function avail(dec, theme) { return ((window.AVAIL && window.AVAIL[dec]) || {})[theme] || 0; }
function season(t) {
  const d = new Date(t), m = d.getMonth(), day = d.getDate();
  if (m === 9) return 'halloween';
  if ((m === 10 && day >= 25) || m === 11) return 'christmas';
  return '';
}
function saturdayMorning(t) { const d = new Date(t); return d.getDay() === 6 && d.getHours() >= 6 && d.getHours() < 12; }
function variantTag(ch, t) {
  if (!ch || ch.special || ch.key.startsWith('vod:') || ch.key.startsWith('all:')) return '';
  const [dec, theme] = ch.key.split(':'); const tags = [];
  if (saturdayMorning(t) && KID_THEMES.has(theme) && avail(dec, 'satam') >= 10) tags.push('sat');
  const sn = season(t);
  if (sn && SEASON_THEMES.has(theme) && avail(dec, sn) >= 5 && !(sn === 'halloween' && KID_THEMES.has(theme) && theme === 'nickjr')) tags.push(sn);
  return tags.join('+');
}
function signOffNow(ch, t = Date.now()) {
  if (!ch || ch.special) return false;
  const d = new Date(t), m = d.getHours() * 60 + d.getMinutes();
  return SIGNOFF_THEMES.has(ch.key.split(':')[1]) && m >= 180 && m < 330;        // 3:00 to 5:30 AM
}
function signOff(ch) {
  cancelBreak(); clearTimeout(S.blockTimer); clearTimeout(S.stallTimer);
  vid.pause(); vid.removeAttribute('src'); vid.load();
  staticOff(); bars(true, 'SIGN OFF · BACK AT 5:30 AM');
  banner(ch, 'This station has signed off for the night', 'Programming returns at 5:30 AM · try another channel', 0);
  tone(true);
  const back = new Date(); back.setHours(5, 30, 5, 0);
  const token = S.token;
  clearTimeout(S.signT); S.signT = setTimeout(() => { if (token === S.token) tune(S.idx, { force: true }); }, Math.max(5000, back - Date.now()));
}

/* ---------- Tape it (double-tap ⏯) and MY TAPES ---------- */
function tapes() { return store.get('rt:tapes') || []; }
function tapeIt() {
  const p = S.playing; if (!p || S.special || S.inBreak) return;
  const item = p.list[p.i % p.list.length];
  const ep = item.eps && item.eps[p.fi] ? [item.eps[p.fi]] : null;
  const t = tapes().filter(x => !(x.id === item.id && x.slot === p.fi));
  t.unshift({ id: item.id, title: p.title || item.title, dec: p.ch.dec, eps: ep, slot: ep ? 0 : p.fi, ch: p.ch.call, at: Date.now() });
  store.set('rt:tapes', t.slice(0, 100));
  vcr('● REC'); setTimeout(() => vcr(S.paused ? '❚❚ PAUSE' : ''), 1800);
  toast('📼 Taped! Find it in the guide under MY TAPES', 3000);
}
function deleteTape(k) {
  const t = tapes(); if (!t[k]) return;
  const gone = t.splice(k, 1)[0]; store.set('rt:tapes', t);
  toast('🗑 Erased “' + gone.title.slice(0, 40) + '”', 2000);
  buildGuide(); moveGuide(Math.min(k, Math.max(0, t.length - 1)));
}

/* ---------- special channels: Prevue guide + Local on the 8s ---------- */
const MUSIC = {
  prevue: ['prevueguidemusic1991', 'prevue-music-for-cer-two', 'cer-two-interstitial-music-prevue'],
  local: ['weatherscanlocalmusic', 'Weatherscanmusic-bytheweatherchannel', 'the-weather-channel-presents-the-best-of-smooth-jazz-full-album'],
};
const TRACKS = {};
async function nextTrack() {
  const kind = S.special; if (!kind) return;
  const ids = MUSIC[kind]; const id = ids[Math.floor(Math.random() * ids.length)];
  try {
    if (!TRACKS[id]) TRACKS[id] = (await getJSON('https://archive.org/metadata/' + id)).files.filter(f => /\.mp3$/i.test(f.name)).map(f => f.name);
    const list = TRACKS[id]; if (!list.length) throw 0;
    const n = list[Math.floor(Math.random() * list.length)];
    if (S.special !== kind) return;
    vid.startAt = 0; vid.src = 'https://archive.org/download/' + id + '/' + n.split('/').map(encodeURIComponent).join('/');
    vid.onloadedmetadata = null; vid.play().catch(() => {});
  } catch (e) { setTimeout(() => { if (S.special === kind) nextTrack(); }, 4000); }
}
function stopSpecial() {
  if (!S.special) return;
  S.special = null; clearInterval(S.specialT); clearInterval(S.wxPageT);
  $('prevue').classList.add('hidden'); $('wx').classList.add('hidden');
  document.body.classList.remove('special');
}
function startSpecial(ch) {
  clearTimeout(S.stallTimer); clearTimeout(S.blockTimer);
  S.special = ch.special; document.body.classList.add('special');
  vid.pause(); vid.removeAttribute('src'); vid.load();
  staticOff(); bars(false);
  if (ch.special === 'prevue') startPrevue(ch); else startLocal(ch);
  nextTrack();
}
function startPrevue(ch) {
  banner(ch, 'Prevue Guide', 'Scrolling listings for every channel', 0);
  $('pvDec').textContent = ch.dec;
  const chans = CHANNELS.filter(c => !c.special && !c.key.startsWith('all:') && !ADULT_KEYS.has(c.key.split(':')[1]));
  const now = Date.now(), esc = t => String(t).replace(/</g, '&lt;');
  const rows = chans.map((c, k) => `<div class="pr" style="--ch:${c.color}"><b>${c.num}</b><i>${c.call}</i><span id="pv${k}">…</span><em id="pn${k}"></em></div>`).join('');
  $('pvRows').innerHTML = rows + rows;                                 // twice, for a seamless loop
  $('pvRows').style.animationDuration = (chans.length * 3.2) + 's';
  const promos = [];
  chans.forEach((c, k) => loadList(c).then(list => {
    const a = scheduleAt(c, list, now), b = nextAfter(c, list, now);
    document.querySelectorAll('#pv' + k).forEach(el => el.textContent = a.item.title);
    document.querySelectorAll('#pn' + k).forEach(el => el.textContent = clock(new Date(b.airs)) + ' ' + b.item.title);
    promos.push({ c, title: b.item.title, at: b.airs });
  }).catch(() => {}));
  let pi = 0;
  const promo = () => {
    if (!promos.length) return;
    const p = promos[pi++ % promos.length];
    const box = $('pvPromo'); box.style.setProperty('--ch', p.c.color);
    $('pvWhen').textContent = 'COMING UP AT ' + clock(new Date(p.at)).toUpperCase();
    $('pvTitle').textContent = p.title; $('pvCh').textContent = 'CH ' + p.c.num + ' · ' + p.c.call;
    box.classList.remove('flip'); void box.offsetWidth; box.classList.add('flip');
  };
  setTimeout(promo, 2500); S.specialT = setInterval(promo, 7000);
  $('prevue').classList.remove('hidden');
}
const WMO = { 0: 'Sunny', 1: 'Mostly Sunny', 2: 'Partly Cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain', 71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy Showers', 85: 'Snow Showers', 86: 'Snow Showers', 95: 'T-Storms', 96: 'T-Storms', 99: 'T-Storms' };
async function startLocal(ch) {
  banner(ch, 'Local on the 8s', 'Your local forecast', 0);
  $('wx').classList.remove('hidden');
  $('wxCity').textContent = 'FINDING YOUR AREA…'; $('wxBody').innerHTML = '';
  try {
    const loc = store.get('rt:loc') && Date.now() - store.get('rt:loc').at < 864e5 ? store.get('rt:loc') : await getJSON('https://ipwho.is/');
    if (loc && loc.latitude) store.set('rt:loc', Object.assign({}, loc, { at: loc.at || Date.now() }));
    const f = await getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,pressure_msl' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6');
    if (S.special !== 'local') return;
    const c = f.current, d = f.daily, dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((c.wind_direction_10m || 0) / 45) % 8];
    const day = k => new Date(d.time[k] + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const pages = [
      ['CURRENT CONDITIONS', `<div class="wxNow"><div class="wxTemp">${Math.round(c.temperature_2m)}°</div><div class="wxCond">${WMO[c.weather_code] || ''}</div></div>
        <div class="wxList"><div>Humidity <b>${c.relative_humidity_2m}%</b></div><div>Wind <b>${dir} ${Math.round(c.wind_speed_10m)} mph</b></div>
        <div>Feels like <b>${Math.round(c.apparent_temperature)}°</b></div><div>Pressure <b>${(c.pressure_msl * 0.02953).toFixed(2)} in</b></div></div>`],
      ['LOCAL FORECAST', `<div class="wxText">TODAY: ${WMO[d.weather_code[0]] || ''}. High ${Math.round(d.temperature_2m_max[0])}°.
        Chance of rain ${d.precipitation_probability_max[0] || 0}%.<br><br>TONIGHT: Low ${Math.round(d.temperature_2m_min[0])}°.<br><br>
        TOMORROW: ${WMO[d.weather_code[1]] || ''}. High ${Math.round(d.temperature_2m_max[1])}°, low ${Math.round(d.temperature_2m_min[1])}°.</div>`],
      ['EXTENDED FORECAST', `<div class="wxDays">${[1, 2, 3, 4, 5].map(k => `<div class="wxDay"><b>${day(k)}</b><span>${WMO[d.weather_code[k]] || ''}</span>
        <em>${Math.round(d.temperature_2m_max[k])}°</em><i>${Math.round(d.temperature_2m_min[k])}°</i></div>`).join('')}</div>`],
    ];
    $('wxCity').textContent = String(loc.city || 'YOUR AREA').toUpperCase();
    let k = 0;
    const show = () => {
      const [h, body] = pages[k++ % pages.length];
      $('wxHead').textContent = h; $('wxBody').innerHTML = body;
      $('wxBody').classList.remove('in'); void $('wxBody').offsetWidth; $('wxBody').classList.add('in');
    };
    show(); S.wxPageT = setInterval(show, 9000);
  } catch (e) { $('wxCity').textContent = 'WEATHER DATA UNAVAILABLE'; }
}
setInterval(() => { $('wxClock').textContent = clock(); }, 1000);

/* ---------- PIN entry (number keys, or ▲▼ + OK on remotes without numbers) ---------- */
function showPin() {
  const shown = '•'.repeat(S.pinEntry.length) + (S.pinEntry.length < 4 ? String(S.pinDigit || 0) : '');
  $('osdNum').textContent = shown.padEnd(4, '_');
  $('osdCall').textContent = 'PIN';
  $('osd').classList.remove('hidden'); clearTimeout(osdTimer);
}
function endPin(msg, ms) {
  S.pinMode = null; S.pinEntry = ''; S.pendingPin = null; S.pendingAction = null;
  if (msg) toast(msg, ms || 2500);
  setTimeout(() => $('osd').classList.add('hidden'), 1200);
}
function pinKey(key) {
  if (/^\d$/.test(key)) return pinPush(key);
  switch (key) {
    case 'Up': S.pinDigit = ((S.pinDigit || 0) + 1) % 10; return showPin();
    case 'Down': S.pinDigit = ((S.pinDigit || 0) + 9) % 10; return showPin();
    case 'OK': case 'Right': return pinPush(String(S.pinDigit || 0));
    case 'Left': S.pinEntry = S.pinEntry.slice(0, -1); return showPin();
    case 'Back': case 'Guide': return endPin('PIN cancelled', 1500);
  }
}
function pinPush(d) {
  S.pinEntry = (S.pinEntry + d).slice(0, 4); S.pinDigit = 0;
  showPin();
  if (S.pinEntry.length < 4) return;
  const entered = S.pinEntry; S.pinEntry = '';
  if (S.pinMode === 'unlock') {
    if (entered === adultPin()) {
      S.adultUnlocked = true;
      const then = S.pendingAction;
      endPin('🔓 Unlocked for this session');
      if (then) then();
    } else endPin('❌ Wrong PIN', 2000);
    return;
  }
  if (S.pinMode === 'set') {
    S.pendingPin = entered; S.pinMode = 'confirm';
    toast('Enter the same PIN again to confirm', 3000);
    return showPin();
  }
  if (S.pinMode === 'confirm') {
    if (entered === S.pendingPin) { setAdultPin(entered); S.adultUnlocked = false; endPin('🔒 Adult lock set · SKIN & XXX now need the PIN', 4000); }
    else endPin('PINs didn’t match · try again', 2500);
  }
}

function togglePause() {
  if (vid.paused) { vid.play().catch(() => {}); S.paused = false; vcr('▶ PLAY'); setTimeout(() => { if (!S.paused) vcr(''); }, 1500); }
  else { vid.pause(); S.paused = true; vcr('❚❚ PAUSE', true); }
}
function powerOff() {
  sfxOff(); stopSpecial(); tone(false);
  closeGuide(); hiss(false); vid.pause();
  screen.classList.remove('on'); screen.classList.add('off');
  setTimeout(() => { if (window.Android && Android.exit) Android.exit(); }, 650);
}

// Keyboard for testing in a browser.
const KEYMAP = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'OK', ' ': 'OK', Escape: 'Back', Backspace: 'Back',
  PageUp: 'ChannelUp', PageDown: 'ChannelDown', g: 'Guide', p: 'PlayPause', MediaPlayPause: 'PlayPause', ',': 'Rewind', '.': 'FastForward', b: 'Block' };
addEventListener('keydown', e => {
  const k = /^\d$/.test(e.key) ? e.key : KEYMAP[e.key];
  if (k) { e.preventDefault(); remote(k); }
});

/* ---------- power on ---------- */
function sleep() { S.slept = true; vid.pause(); hiss(false); }
function wake() { if (S.slept) { S.slept = false; tune(S.idx); } }

window.RT = { remote, _got, _v, sleep, wake, toast: t => toast(t, 5000), _end: () => S.playing && nextNatural(S.playing) };
if (window.Android && Android.alive) Android.alive();

function boot() {
  // Prefer the last channel we were on in this decade; fall back to global last channel.
  const lastKey = lastChFor(DEC);
  const saved = store.get('rt:ch');
  let start = -1;
  if (lastKey) start = CHANNELS.findIndex(c => c.key === lastKey);
  if (start < 0 && saved) start = CHANNELS.findIndex(c => saved.key ? c.key === saved.key : (c.num === saved.num && c.dec === saved.dec));
  if (start < 0) start = 0;
  S.idx = start; S.last = start;
  setTimeout(() => screen.classList.remove('on'), 1100);
  sfxOn();
  tune(start);
}
// Which channels have enough clean tapes (from the curator); thin ones are left off the dial.
screen.classList.add('on');
staticOn();
Promise.race([getJSON(LISTS + 'index.json' + bust()), new Promise((_, no) => setTimeout(no, 5000))])
  .then(ix => { window.AVAIL = ix; CHANNELS = lineup(DEC); G.list = CHANNELS; })
  .catch(() => {})
  .then(boot);
setTimeout(() => toast((window.Android && Android.freshWeb && Android.freshWeb()) ? '✨ Updated! New changes loaded' : 'Rewind TV ' + VERSION, 3500), 1200);
// Warm up every channel list in the background so the guide fills in fast.
setTimeout(() => CHANNELS.forEach((ch, k) => setTimeout(() => loadList(ch).catch(() => {}), k * 250)), 3000);
})();
