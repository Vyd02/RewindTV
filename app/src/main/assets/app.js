/* Rewind TV — a 90s cable box that plays the Internet Archive. */
(() => {
'use strict';

const SLOT_MS = 30 * 60 * 1000;      // schedule moves in half-hour blocks, like a real guide
const LIST_ROWS = 250;               // how many items each channel draws from
const LIST_TTL = 12 * 3600 * 1000;   // refresh channel lists twice a day
const STALL_MS = 12000;              // skip a tape that won't start
const STATIC_MS = 900;               // static only plays for a beat, then a quiet "TUNING..." card
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
const VERSION = (window.Android && Android.version) ? 'v' + Android.version() : 'v1.0.5 or older';
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
};

/* ---------- fit the 1920x1080 stage to whatever screen we're on ---------- */
function fit() {
  const w = document.documentElement.clientWidth || innerWidth, h = document.documentElement.clientHeight || innerHeight;
  const s = Math.min(w / 1920, h / 1080);
  tv.style.transform = `translate(${(w - 1920 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fit); fit(); setTimeout(fit, 300); setTimeout(fit, 1500);

/* ---------- networking: native bridge on the Fire TV, fetch in a browser ---------- */
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
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

/* ---------- channel lists ---------- */
function loadList(ch) {
  if (S.lists[ch.num]) return S.lists[ch.num];
  const key = 'rt:list:' + ch.num + ':' + hash(ch.q);
  const cached = store.get(key);
  if (cached && Date.now() - cached.at < LIST_TTL && cached.docs.length) {
    return (S.lists[ch.num] = Promise.resolve(arrange(ch, cached.docs)));
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
  }).catch(e => { delete S.lists[ch.num]; if (cached) return arrange(ch, cached.docs); throw e; });
  return (S.lists[ch.num] = p);
}
// A fresh shuffle each week, the same for everybody watching.
function arrange(ch, docs) { const week = Math.floor(Date.now() / (7 * 864e5)); return shuffle(docs, hash(ch.num + ':' + week)); }

function scheduleAt(ch, list, t) {
  const slot = Math.floor(t / SLOT_MS);
  const i = (slot + hash(ch.call)) % list.length;
  return { item: list[i], i, slot, start: slot * SLOT_MS };
}

/* ---------- item metadata: find the playable video files ---------- */
function videos(id) {
  if (S.meta[id]) return S.meta[id];
  return (S.meta[id] = getJSON('https://archive.org/metadata/' + encodeURIComponent(id)).then(m => {
    const files = (m.files || []).filter(f => /\.mp4$/i.test(f.name));
    // One entry per video: the archive often keeps an original plus its own encodes of it.
    const score = f => /\.ia\.mp4$/i.test(f.name) ? 3 : /_512kb\.mp4$/i.test(f.name) ? 1 : 2;
    const byBase = {};
    for (const f of files) {
      const base = f.name.replace(/(_512kb)?(\.ia)?\.mp4$/i, '');
      if (!byBase[base] || score(f) > score(byBase[base])) byBase[base] = f;
    }
    const list = Object.values(byBase)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(f => ({
        url: 'https://archive.org/download/' + encodeURIComponent(id) + '/' + f.name.split('/').map(encodeURIComponent).join('/'),
        len: parseFloat(f.length) || 0,
        title: cleanTitle((f.title || '').length > 2 ? f.title : ''),
      }));
    if (!list.length) throw new Error('no video');
    return list;
  }).catch(e => { delete S.meta[id]; throw e; }));
}

/* ---------- tuning ---------- */
async function tune(idx, opts = {}) {
  const n = CHANNELS.length;
  idx = ((idx % n) + n) % n;
  if (idx !== S.idx) S.last = S.idx;
  S.idx = idx;
  const ch = CHANNELS[idx];
  const token = ++S.token;
  store.set('rt:ch', ch.num);
  S.paused = false; vcr('');
  staticOn();
  osd(ch);
  banner(ch, 'Tuning…', '', 0);
  vid.pause(); vid.removeAttribute('src'); vid.load();
  bars(false);
  try {
    const list = await loadList(ch);
    if (token !== S.token) return;
    const now = Date.now();
    const sch = scheduleAt(ch, list, now);
    await play(ch, list, sch.i, now - sch.start, token, 0, sch.slot);
  } catch (e) {
    if (token === S.token) offAir(ch);
  }
}

async function play(ch, list, i, offsetMs, token, tries, slot) {
  if (tries > 6) return offAir(ch);
  const item = list[i % list.length];
  let files;
  try { files = await videos(item.id); } catch (e) {
    if (token === S.token) return play(ch, list, i + 1, 0, token, tries + 1, slot);
    return;
  }
  if (token !== S.token) return;
  const f = files[(slot != null ? slot : i) % files.length];
  let off = offsetMs / 1000;
  if (f.len > 0) off = off % f.len;
  if (f.len > 0 && f.len - off < 20) off = 0;           // don't drop in on the end credits
  const title = files.length > 1 && f.title ? item.title + ' — ' + f.title : item.title;
  const next = list[(i + 1) % list.length];
  S.playing = { ch, list, i, f, title, token, tries, startOff: off };

  vid.startAt = off;
  vid.src = f.url;
  vid.onloadedmetadata = () => {
    if (token !== S.token) return;
    if (!f.len && vid.duration) off = off % vid.duration;
    try { vid.currentTime = off; } catch (e) {}
  };
  clearTimeout(S.stallTimer);
  S.stallTimer = setTimeout(() => { if (token === S.token && vid.readyState < 3) skip(); }, STALL_MS);
  vid.play().catch(() => {});
  banner(ch, title, 'Up next: ' + next.title, f.len ? off / f.len : 0);
}

function skip() {
  const p = S.playing; if (!p) return;
  staticOn();
  play(p.ch, p.list, p.i + 1, 0, p.token, p.tries + 1, null);
}

vid.addEventListener('loadeddata', () => { if (!vid.paused || vid.readyState >= 2) staticOff(); });
vid.addEventListener('playing', () => { clearTimeout(S.stallTimer); staticOff(); bars(false); if (S.playing) S.playing.tries = 0; prefetch(); });
// Look up what's on the channels next door so flipping to them skips the slow lookups.
function prefetch() {
  const n = CHANNELS.length;
  [S.idx + 1, S.idx - 1, S.last].forEach(k => {
    const ch = CHANNELS[((k % n) + n) % n];
    loadList(ch).then(list => videos(scheduleAt(ch, list, Date.now()).item.id)).catch(() => {});
  });
}
vid.addEventListener('waiting', () => { clearTimeout(S.stallTimer); S.stallTimer = setTimeout(() => { if (vid.readyState < 3 && !S.paused) skip(); }, STALL_MS); });
vid.addEventListener('ended', () => { const p = S.playing; if (!p) return; staticOn(); play(p.ch, p.list, p.i + 1, 0, p.token, 0, null).then(() => showBanner()); });
vid.addEventListener('error', () => { if (vid.getAttribute('src')) skip(); });

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
  $('osdNum').textContent = pad(ch.num); $('osdCall').textContent = ch.call;
  $('osd').classList.remove('hidden');
  clearTimeout(osdTimer); osdTimer = setTimeout(() => $('osd').classList.add('hidden'), 3500);
}
function vcr(text, blink) { const v = $('vcr'); v.textContent = text; v.classList.toggle('hidden', !text); v.classList.toggle('blink', !!blink); }
function banner(ch, title, next, frac) {
  tv.style.setProperty('--ch', ch.color);
  $('bnNum').textContent = ch.num; $('bnCall').textContent = ch.call; $('bnChan').textContent = ch.name;
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
  const p = S.playing; if (p && p.f.len && vid.currentTime) $('bnFill').style.width = (vid.currentTime / p.f.len * 100) + '%';
}, 1000);

/* ---------- guide ---------- */
const ROW_H = 96;
function buildGuide() {
  const now = Date.now(), slot = Math.floor(now / SLOT_MS) * SLOT_MS;
  $('gNowHead').textContent = 'NOW · ' + slotLabel(slot);
  $('gNextHead').textContent = slotLabel(slot + SLOT_MS);
  $('gRows').innerHTML = CHANNELS.map((ch, k) =>
    `<div class="gr" style="--ch:${ch.color}"><div class="gc"><b>${ch.num}</b>${ch.call}</div>` +
    `<div class="gt now" id="gn${k}">…</div><div class="gt" id="gx${k}">…</div></div>`).join('');
  CHANNELS.forEach((ch, k) => {
    loadList(ch).then(list => {
      const a = scheduleAt(ch, list, now), b = scheduleAt(ch, list, now + SLOT_MS);
      $('gn' + k).textContent = a.item.title; $('gx' + k).textContent = b.item.title;
    }).catch(() => { $('gn' + k).textContent = 'Off the air'; $('gx' + k).textContent = ''; });
  });
}
function moveGuide(k) {
  const n = CHANNELS.length; S.gSel = ((k % n) + n) % n;
  const visible = Math.floor(($('gList').clientHeight || 420) / ROW_H);
  const top = Math.max(0, Math.min(S.gSel - Math.floor(visible / 2), n - visible));
  $('gRows').style.transform = `translateY(${-top * ROW_H}px)`;
  $('gSel').style.transform = `translateY(${(S.gSel - top) * ROW_H}px)`;
}
function openGuide() {
  if (NATIVE) Android.vRect(1054 / 1920, 60 / 1080, 0.42, 0.42);
  S.guide = true; buildGuide(); document.body.classList.add('guide');
  $('guide').classList.remove('hidden'); $('banner').classList.add('hidden');
  moveGuide(S.idx);
}
function closeGuide() { if (NATIVE && S.guide) Android.vRect(0, 0, 1, 1); S.guide = false; document.body.classList.remove('guide'); $('guide').classList.add('hidden'); }

/* ---------- remote ---------- */
function remote(key) {
  if (/^\d$/.test(key)) return digit(key);
  if (S.guide) {
    switch (key) {
      case 'Up': return moveGuide(S.gSel - 1);
      case 'Down': return moveGuide(S.gSel + 1);
      case 'ChannelUp': return moveGuide(S.gSel - 5);
      case 'ChannelDown': return moveGuide(S.gSel + 5);
      case 'OK': case 'Right': { const k = S.gSel; closeGuide(); if (k !== S.idx) tune(k); else showBanner(); return; }
      case 'Back': case 'Guide': case 'Left': return closeGuide();
    }
    return;
  }
  switch (key) {
    case 'Up': case 'ChannelUp': return tune(S.idx + 1);
    case 'Down': case 'ChannelDown': return tune(S.idx - 1);
    case 'OK': case 'Guide': return openGuide();
    case 'Right': return showBanner();
    case 'Left': case 'Flashback': toast('↩ FLASHBACK', 1200); return tune(S.last);
    case 'PlayPause':
      if (vid.paused) { vid.play().catch(() => {}); S.paused = false; vcr('▶ PLAY'); setTimeout(() => { if (!S.paused) vcr(''); }, 1500); }
      else { vid.pause(); S.paused = true; vcr('❚❚ PAUSE', true); }
      return;
    case 'Rewind': try { vid.currentTime = Math.max(0, vid.currentTime - 15); } catch (e) {} vcr('◀◀ REW'); setTimeout(() => vcr(S.paused ? '❚❚ PAUSE' : ''), 1000); return;
    case 'FastForward': try { vid.currentTime += 30; } catch (e) {} vcr('▶▶ FF'); setTimeout(() => vcr(S.paused ? '❚❚ PAUSE' : ''), 1000); return;
    case 'Back':
      if (Date.now() - S.backAt < 2500) return powerOff();
      S.backAt = Date.now(); toast('Press BACK again to turn off'); return;
  }
}
function digit(d) {
  S.digits = (S.digits + d).slice(-2);
  $('osdNum').textContent = S.digits.padEnd(2, '_'); $('osdCall').textContent = '';
  $('osd').classList.remove('hidden'); clearTimeout(osdTimer);
  clearTimeout(S.digitTimer);
  S.digitTimer = setTimeout(() => {
    const k = CHANNELS.findIndex(c => c.num === parseInt(S.digits, 10)); S.digits = '';
    if (k >= 0) { closeGuide(); tune(k); } else { toast('No channel there'); $('osd').classList.add('hidden'); }
  }, 1300);
}
function powerOff() {
  closeGuide(); hiss(false); vid.pause();
  screen.classList.remove('on'); screen.classList.add('off');
  setTimeout(() => { if (window.Android && Android.exit) Android.exit(); }, 650);
}

// Keyboard for testing in a browser.
const KEYMAP = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'OK', ' ': 'OK', Escape: 'Back', Backspace: 'Back',
  PageUp: 'ChannelUp', PageDown: 'ChannelDown', g: 'Guide', p: 'PlayPause', MediaPlayPause: 'PlayPause', ',': 'Rewind', '.': 'FastForward' };
addEventListener('keydown', e => {
  const k = /^\d$/.test(e.key) ? e.key : KEYMAP[e.key];
  if (k) { e.preventDefault(); remote(k); }
});

/* ---------- power on ---------- */
function sleep() { S.slept = true; vid.pause(); hiss(false); }
function wake() { if (S.slept) { S.slept = false; tune(S.idx); } }

window.RT = { remote, _got, _v, sleep, wake, toast: t => toast(t, 5000) };
if (window.Android && Android.alive) Android.alive();

const saved = store.get('rt:ch');
const start = Math.max(0, CHANNELS.findIndex(c => c.num === saved));
S.idx = start; S.last = start;
screen.classList.add('on');
setTimeout(() => screen.classList.remove('on'), 1100);
tune(start);
setTimeout(() => toast('Rewind TV ' + VERSION, 3500), 1200);
// Warm up every channel list in the background so the guide fills in fast.
setTimeout(() => CHANNELS.forEach((ch, k) => setTimeout(() => loadList(ch).catch(() => {}), k * 250)), 3000);
})();
