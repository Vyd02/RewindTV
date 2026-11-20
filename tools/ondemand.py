#!/usr/bin/env python3
"""
Builds the On Demand catalog from the checked tape lists (run tools/curate.py first).

  lists/ondemand/movies.json  full-length films (1h-4h), sharpest copies only
  lists/ondemand/shows.json   series with real episode files (8-65 min each)
"""
import json
import os
import re
import statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTS = os.path.join(ROOT, 'lists')
OUT = os.path.join(LISTS, 'ondemand')

MOVIE_THEMES = ['movies', 'comedyfilm', 'noir', 'western', 'horror']
SHOW_THEMES = ['tv', 'sitcom', 'cartoons', 'satam', 'anime', 'gameshow', 'nick', 'cn', 'disney', 'toonami', 'swim',
               'foxkids', 'kidswb', 'pbskids', 'nickjr', 'nickatnite', 'boomerang', 'jetix', 'tgif', 'comedycentral',
               'scifi', 'abcsat']
NOT_A_SHOW = re.compile(r'commercial|bumper|bumps|promo|\bads?\b|ident|station|sign[- ]?(on|off)|trailer|'
                        r'recording|vhs tape|broadcast|marathon|compilation|block\b|airing|full tape|tape \d', re.I)
DECADES = ['50s', '60s', '70s', '80s', '90s', '00s']
JUNK = re.compile(r'youtube|stream|podcast|vlog|reaction|review|let\'?s play|gameplay|walkthrough|trailer|teaser|'
                  r'\bnight \d+\b|\bpart \d+\b|\bep(isode)?\.? ?\d+\b|music video|full album|concert|interview|'
                  r'behind the scenes|making of|unboxing|\|', re.I)
YEAR_IN_TITLE = re.compile(r'[\(\[]\s*(19[2-9]\d|200\d)\s*[\)\]]')
# Collections that are actual film libraries (the rest need a "(1987)"-style year in the title to count)
FILM_LIBRARY_THEMES = {'movies', 'noir', 'comedyfilm'}


def real_title(t):
    return len(re.findall(r'[A-Za-z]', t)) >= 4 and not re.fullmatch(r'[\d\s\-_.]+', t)


def load(dec, theme):
    p = os.path.join(LISTS, dec, theme + '.json')
    return json.load(open(p)).get('items', []) if os.path.exists(p) else []


def main():
    os.makedirs(OUT, exist_ok=True)
    movies, seen = [], set()
    for dec in DECADES:
        for th in MOVIE_THEMES:
            for it in load(dec, th):
                if it['id'] in seen or not it.get('e') or JUNK.search(it['t']) or not real_title(it['t']):
                    continue
                if th not in FILM_LIBRARY_THEMES and not YEAR_IN_TITLE.search(it['t']):
                    continue
                ep = max(it['e'], key=lambda e: e.get('len', 0))
                if 3600 <= ep.get('len', 0) <= 4 * 3600 and len(it['e']) <= 2:
                    seen.add(it['id'])
                    movies.append({'id': it['id'], 't': it['t'], 'dec': dec, 'g': th, 'e': [ep]})
    shows, seen = [], set()
    for dec in DECADES:
        for th in SHOW_THEMES:
            for it in load(dec, th):
                eps = it.get('e') or []
                if it['id'] in seen or len(eps) < 2 or NOT_A_SHOW.search(it['t']) or JUNK.search(it['t']) or not real_title(it['t']):
                    continue
                lens = [e.get('len', 0) for e in eps if e.get('len')]
                if not lens or not (8 * 60 <= statistics.median(lens) <= 65 * 60):
                    continue
                keep = [e for e in eps if 5 * 60 <= e.get('len', 0) <= 90 * 60]
                if len(keep) < 2:
                    continue
                seen.add(it['id'])
                shows.append({'id': it['id'], 't': it['t'], 'dec': dec, 'g': th, 'e': keep})
    movies.sort(key=lambda m: (DECADES.index(m['dec']), m['t'].lower()))
    shows.sort(key=lambda s: (DECADES.index(s['dec']), s['t'].lower()))
    json.dump({'items': movies}, open(os.path.join(OUT, 'movies.json'), 'w'), separators=(',', ':'))
    json.dump({'items': shows}, open(os.path.join(OUT, 'shows.json'), 'w'), separators=(',', ':'))
    print('movies', len(movies), {d: sum(1 for m in movies if m['dec'] == d) for d in DECADES})
    print('shows', len(shows), {d: sum(1 for s in shows if s['dec'] == d) for d in DECADES},
          'episodes', sum(len(s['e']) for s in shows))


if __name__ == '__main__':
    main()
