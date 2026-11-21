#!/usr/bin/env python3
"""
Rewind TV tape curator.

For every channel on every decade tab, searches the Internet Archive, opens each
tape's file list, and keeps only tapes that are actually watchable on a big TV:
  * a real video file (mp4 / m4v / mkv, never the tiny "_512kb" copies)
  * at least 480 lines tall (what broadcast TV actually was)
  * enough bitrate that it isn't a smeared re-re-encode

Results go to lists/<decade>/<theme>.json, which the app reads instead of searching
live. That also means tuning skips the slow per-tape lookups.

Run:  python3 tools/curate.py            (all decades)
      python3 tools/curate.py 90s        (one decade)
"""
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import english  # noqa: E402  (English-only filter)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNELS_JS = os.path.join(ROOT, 'app/src/main/assets/channels.js')
OUT = os.path.join(ROOT, 'lists')
CACHE = os.path.join(ROOT, '.cache', 'meta.json')

SEARCH_ROWS = 400      # how deep to look per channel
KEEP = 90              # tapes to keep per channel
MAX_EPISODES = 60      # cap for "complete series" items with hundreds of files
MIN_HEIGHT = 480
# Quality floors (kbps by resolution). Older decades keep the looser bar (that's what exists);
# 80s and up must look like a clean broadcast/DVD of the time, not a re-recorded smear.
PROFILES = {
    'classic': {480: 900, 576: 1100, 720: 1800, 1080: 3000},
    'clean':   {480: 1800, 576: 2000, 720: 2600, 1080: 4000},
}
DECADE_PROFILE = {'all': 'classic', '50s': 'classic', '60s': 'classic', '70s': 'classic', '80s': 'clean', '90s': 'clean', '00s': 'clean'}
DEEP_ROWS = {'clean': 900, 'classic': SEARCH_ROWS, 'all': 2500}
VIDEO_EXT = ('.mp4', '.m4v', '.mkv')
UA = {'User-Agent': 'RewindTV-curator/1.0 (github.com/Vyd02/RewindTV)'}


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def lineups():
    """Ask node to evaluate channels.js so the app and the curator share one definition."""
    js = open(CHANNELS_JS).read() + """
;const out = {};
for (const d of DECADES) out[d.id] = lineup(d.id).map(c => ({ key: c.key, call: c.call, q: c.q + SAFE }));
console.log(JSON.stringify(out));"""
    return json.loads(subprocess.run(['node', '-e', js], check=True, capture_output=True, text=True).stdout)


def kbps_floor(h, floors):
    best = 0
    for res, k in sorted(floors.items()):
        if h >= res:
            best = k
    return best


def summarize(meta, floors):
    """Turn an item's metadata into playable episode groups that pass the quality bar."""
    files = [f for f in meta.get('files', []) if f.get('name', '').lower().endswith(VIDEO_EXT)
             and '_512kb' not in f['name'].lower()]
    groups = {}
    for f in files:
        base = re.sub(r'(_512kb)?(\.ia)?\.[a-z0-9]+$', '', f['name'], flags=re.I)
        groups.setdefault(base, []).append(f)
    eps = []
    for base in sorted(groups, key=lambda b: [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', b)]):
        cands = []
        for f in groups[base]:
            h = int(float(f.get('height') or 0))
            L = float(f.get('length') or 0) if re.match(r'^[\d.]+$', str(f.get('length') or '')) else 0
            size = int(f.get('size') or 0)
            kbps = size * 8 / L / 1000 if L > 0 else 0
            ok = h >= MIN_HEIGHT and kbps >= kbps_floor(h, floors)
            # streaming-ready archive copy wins ties; then sharper; then more bitrate
            score = (ok, h, f['name'].lower().endswith('.ia.mp4'), kbps)
            cands.append((score, f, h, L))
        cands.sort(key=lambda c: c[0], reverse=True)
        top = cands[0]
        if not top[0][0]:
            continue
        ep = {'n': top[1]['name'], 'h': top[2], 'len': round(top[3])}
        alts = [c[1]['name'] for c in cands[1:] if c[0][0]]
        if alts:
            ep['a'] = alts[:2]
        t = (top[1].get('title') or '').strip()
        if len(t) > 2:
            ep['t'] = t[:120]
        eps.append(ep)
        if len(eps) >= MAX_EPISODES:
            break
    return eps


def write_index():
    """lists/index.json = how many clean tapes each channel has. The app hides channels under 10."""
    ix = {}
    for dec in sorted(os.listdir(OUT)):
        d = os.path.join(OUT, dec)
        if not os.path.isdir(d):
            continue
        ix[dec] = {}
        for f in sorted(os.listdir(d)):
            if f.endswith('.json'):
                ix[dec][f[:-5]] = len(json.load(open(os.path.join(d, f))).get('items', []))
    json.dump(ix, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)


def main():
    args = sys.argv[1:]
    keys = {k for a in args if a.startswith('--only=') for k in a.split('=', 1)[1].split(',')}
    only = {a for a in args if not a.startswith('--')}
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    langcache = english.load_cache()
    allcache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    if allcache and 'classic' not in allcache and 'clean' not in allcache:
        allcache = {'classic': allcache}      # older single-profile cache
    LU0 = lineups()
    LU, seen_keys = {}, set()
    for dec, chans in LU0.items():
        for ch in chans:
            if ch['key'] in seen_keys:
                continue
            seen_keys.add(ch['key'])
            LU.setdefault(ch['key'].split(':')[0], []).append(ch)
    report = []
    for dec, chans in LU.items():
        if only and dec not in only:
            continue
        os.makedirs(os.path.join(OUT, dec), exist_ok=True)
        prof = DECADE_PROFILE.get(dec, 'classic')
        floors = PROFILES[prof]
        cache = allcache.setdefault(prof, {})
        for ch in chans:
            theme = ch['key'].split(':')[1]
            if keys and ch['key'] not in keys and theme not in keys:
                continue
            url = 'https://archive.org/advancedsearch.php?' + urllib.parse.urlencode([
                ('q', ch['q']), ('fl[]', 'identifier'), ('fl[]', 'title'),
                ('rows', DEEP_ROWS['all'] if dec == 'all' else DEEP_ROWS[prof]), ('sort[]', 'downloads desc'), ('output', 'json')])
            try:
                docs = get(url)['response']['docs']
            except Exception as e:
                report.append((dec, ch['call'], 'SEARCH FAILED', str(e)[:60]))
                continue

            need = [d['identifier'] for d in docs if d['identifier'] not in cache]

            def fetch(i):
                try:
                    return i, summarize(get('https://archive.org/metadata/' + urllib.parse.quote(i)), floors)
                except Exception:
                    return i, None

            # Look up tapes in batches until we have enough good ones.
            kept = []
            pos = 0
            with cf.ThreadPoolExecutor(16) as ex:
                while pos < len(docs) and len(kept) < (440 if dec == 'all' else KEEP):
                    batch = docs[pos:pos + 48]
                    pos += 48
                    todo = [d['identifier'] for d in batch if d['identifier'] not in cache]
                    for i, eps in ex.map(fetch, todo):
                        if eps is not None:
                            cache[i] = eps
                    for d in batch:
                        eps = cache.get(d['identifier'])
                        if eps:
                            kept.append({'id': d['identifier'], 't': re.sub(r'\s+', ' ', str(d.get('title') or d['identifier']).replace('_', ' ')).strip()[:140], 'e': eps})
            kept = english.keep_english(kept, langcache)[:(400 if dec == 'all' else KEEP)]
            english.save_cache(langcache)
            json.dump({'call': ch['call'], 'q': ch['q'], 'updated': time.strftime('%Y-%m-%d'), 'items': kept},
                      open(os.path.join(OUT, dec, theme + '.json'), 'w'), separators=(',', ':'))
            report.append((dec, ch['call'], len(kept), f'checked {pos if pos < len(docs) else len(docs)} of {len(docs)}'))
            print(f'{dec} {ch["call"]:6} kept {len(kept):3}  (looked at {min(pos, len(docs))}/{len(docs)})', flush=True)
            json.dump(allcache, open(CACHE, 'w'))
    write_index()
    thin = [r for r in report if not isinstance(r[2], int) or r[2] < 15]
    print('\nThin or failed channels:', thin or 'none')


if __name__ == '__main__':
    if sys.argv[1:] == ['--index']:
        write_index()
    else:
        main()
