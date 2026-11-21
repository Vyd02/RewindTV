#!/usr/bin/env python3
"""
Real-TV lineups: show and movie channels air only complete episodes and complete movies.

For every show/movie channel list (lists/<decade>/<theme>.json) this keeps:
  * show channels: items that are real episodes (8-65 min each), single episodes or series,
    including "as aired with commercials" uploads; drops clip reels, bumpers, promos, compilations
  * movie channels: single films 1-4 hours long
If fewer than 10 items qualify, the channel keeps its full list (so nothing goes dark).
The untouched list is saved as <theme>.all.json, so this can be undone.

Run after curate.py:  python3 tools/realtv.py
"""
import json
import os
import re
import statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTS = os.path.join(ROOT, 'lists')

SHOW_THEMES = {'tv', 'sitcom', 'cartoons', 'satam', 'anime', 'gameshow', 'nick', 'cn', 'disney', 'toonami', 'swim', 'foxkids',
               'kidswb', 'pbskids', 'nickjr', 'nickatnite', 'boomerang', 'jetix', 'tgif', 'comedycentral', 'scifi', 'abcsat',
               'halloween', 'christmas', 'animalplanet', 'discovery', 'history', 'tlc', 'natgeo', 'foodnetwork', 'ae', 'usa', 'tbs'}
MOVIE_THEMES = {'movies', 'comedyfilm', 'noir', 'western', 'horror'}
MIN_KEEP = 10

CLIP = re.compile(r'bumper|bumps|\bpromos?\b|\bident|station id|sign[- ]?(on|off)|trailers?|teaser|compilation|'
                  r'marathon|\bblock\b|full tape|\btape \d|tapes\b|recording session|commercial (collection|break|block)|'
                  r'commercials only|\bads?\b(?! ?\d)|\bwoc\b|youtube|stream|podcast|reaction|review|let\'?s play|'
                  r'gameplay|walkthrough|unboxing|behind the scenes|making of|\|', re.I)


def real_title(t):
    return len(re.findall(r'[A-Za-z]', t)) >= 4 and not re.fullmatch(r'[\d\s\-_.]+', t)


def show_item(it):
    if CLIP.search(it['t']) or not real_title(it['t']):
        return None
    eps = [e for e in it.get('e', []) if 8 * 60 <= e.get('len', 0) <= 65 * 60 and not CLIP.search(e.get('t', ''))]
    if not eps:
        return None
    if len(eps) >= 2 and not (8 * 60 <= statistics.median(e['len'] for e in eps) <= 65 * 60):
        return None
    return dict(it, e=eps)


def movie_item(it):
    if CLIP.search(it['t']) or not real_title(it['t']) or not it.get('e'):
        return None
    ep = max(it['e'], key=lambda e: e.get('len', 0))
    if not (3600 <= ep.get('len', 0) <= 4 * 3600) or len(it['e']) > 2:
        return None
    return dict(it, e=[ep])


def main():
    report = []
    for dec in sorted(os.listdir(LISTS)):
        d = os.path.join(LISTS, dec)
        if not os.path.isdir(d) or dec in ('ondemand', 'all'):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.json') or f.endswith('.all.json'):
                continue
            theme = f[:-5]
            if theme not in SHOW_THEMES and theme not in MOVIE_THEMES:
                continue
            p, raw = os.path.join(d, f), os.path.join(d, theme + '.all.json')
            cur = json.load(open(p))
            # A list without the 'realtv' flag just came from curate.py: it's the new full list.
            if 'realtv' not in cur or not os.path.exists(raw):
                src = cur
                json.dump(src, open(raw, 'w'), separators=(',', ':'))
            else:
                src = json.load(open(raw))
            fn = movie_item if theme in MOVIE_THEMES else show_item
            keep = [x for x in (fn(it) for it in src.get('items', [])) if x]
            out = dict(src, items=keep, realtv=True) if len(keep) >= MIN_KEEP else dict(src, realtv=False)
            json.dump(out, open(p, 'w'), separators=(',', ':'))
            report.append((dec, theme, len(src.get('items', [])), len(keep), len(keep) >= MIN_KEEP))
    for dec, theme, before, after, used in report:
        print(f'{dec} {theme:14} {before:3} -> {after:3} {"full eps/movies" if used else "kept as-is (too few)"}')
    print('\nchannels now full episodes/movies:', sum(1 for r in report if r[4]), 'of', len(report))


if __name__ == '__main__':
    main()
