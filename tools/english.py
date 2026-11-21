#!/usr/bin/env python3
"""
English-only filter for the tape lists.

A tape is dropped when its Internet Archive language tag says it isn't English, or its
title clearly marks another language (Spanish/Portuguese/French subs or dubs, "raw",
non-Latin script...). Titles that say English dub / English sub always stay.

Run on its own to clean every list in place:  python3 tools/english.py
curate.py also calls keep_english() so future refreshes stay English-only.
"""
import concurrent.futures as cf
import json
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTS = os.path.join(ROOT, 'lists')
CACHE = os.path.join(ROOT, '.cache', 'lang.json')
UA = {'User-Agent': 'RewindTV-curator/1.0 (github.com/Vyd02/RewindTV)'}

ENGLISH_OK = re.compile(r'\benglish\b|\beng\.? ?(dub|sub|subs|subbed|dubbed)\b|\bdubbed\b|\[eng\]|\(eng\)', re.I)
FOREIGN_TITLE = re.compile(
    r'sub(titulad[oa]s?|tit\.?)? ?(espa|esp\b|lat\b|pt\b|br\b|ita\b|fr\b)|espa[nñ]ol|\blatino\b|castellano|'
    r'legendado|dublado|portugu[eê]s|\bvostfr\b|\bvf\b|\bvost\b|fran[cç]ais|deutsch|\bgerman\b|italiano|sub ita|'
    r'\braws?\b|russian|\bhindi\b|\btamil\b|\btelugu\b|\barabic\b|\bkorean\b|\bchinese\b|mandarin|cantonese|'
    r'\bthai\b|polski|nederlands|svenska|magyar|bahasa|tagalog|vietnam|\bturk|doblaje|doblad[oa]|'
    r'\[cdasubs\]|\bsub(s)? (es|pt|fr|it|de)\b', re.I)
NON_LATIN = re.compile(r'[Ѐ-ӿ؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-鿿가-힯]')
ENGLISH_CODES = {'eng', 'en', 'english', 'en-us', 'en-gb', 'american english'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def title_verdict(title):
    if ENGLISH_OK.search(title):
        return True
    if FOREIGN_TITLE.search(title) or NON_LATIN.search(title):
        return False
    return None


def tag_verdict(lang):
    if not lang:
        return None
    vals = [lang] if isinstance(lang, str) else list(lang)
    vals = [v.strip().lower() for v in vals if isinstance(v, str)]
    if not vals:
        return None
    return any(v in ENGLISH_CODES or v.startswith('eng') for v in vals)


def load_cache():
    return json.load(open(CACHE)) if os.path.exists(CACHE) else {}


def save_cache(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(c, open(CACHE, 'w'))


def keep_english(items, cache, workers=16):
    """Filter a list of {'id','t',...} items to English ones. Looks up language tags as needed."""
    todo = [it['id'] for it in items if it['id'] not in cache and title_verdict(it['t']) is None]

    def fetch(i):
        try:
            m = get('https://archive.org/metadata/' + urllib.parse.quote(i) + '/metadata')
            md = m.get('result', m) if isinstance(m, dict) else {}
            return i, md.get('language')
        except Exception:
            return i, None

    with cf.ThreadPoolExecutor(workers) as ex:
        for i, lang in ex.map(fetch, todo):
            cache[i] = lang
    out = []
    for it in items:
        tv = title_verdict(it['t'])
        if tv is True:
            out.append(it)
            continue
        if tv is False:
            continue
        lv = tag_verdict(cache.get(it['id']))
        if lv is False:
            continue
        out.append(it)
    return out


def main():
    cache = load_cache()
    total_before = total_after = 0
    for dec in sorted(os.listdir(LISTS)):
        d = os.path.join(LISTS, dec)
        if not os.path.isdir(d) or dec == "ondemand":
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.json'):
                continue
            p = os.path.join(d, f)
            data = json.load(open(p))
            before = len(data.get('items', []))
            data['items'] = keep_english(data.get('items', []), cache)
            json.dump(data, open(p, 'w'), separators=(',', ':'))
            total_before += before
            total_after += len(data['items'])
            if before - len(data['items']):
                print(f'{dec}/{f[:-5]}: dropped {before - len(data["items"])} of {before}', flush=True)
        save_cache(cache)
    print(f'\nKept {total_after} of {total_before} tapes')


if __name__ == '__main__':
    main()
