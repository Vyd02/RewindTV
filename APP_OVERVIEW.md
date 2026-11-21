# Rewind TV — full overview (for review)

Rewind TV is a sideloaded **Fire TV / Android TV app** that recreates retro cable TV. Live channels run on a broadcast clock, there are decade tabs (50s–00s), and there's an On Demand section with full movies and full episodes. All video streams from the **Internet Archive** (archive.org). It was inspired by the Roku app "Boared Games TV", but it is an independent build with its own code, name and look.

- **Repo:** https://github.com/Vyd02/RewindTV (public)
- **Install:** Downloader app → `github.com/Vyd02/RewindTV/releases/latest/download/RewindTV.apk`
- **Device:** Insignia Fire TV Edition TV with the Insignia Fire TV remote (channel rocker, ☰ menu, live-TV button, ⏪ ⏯ ⏩)
- **Current version:** APK v1.0.10, plus screen files that update themselves from GitHub

---

## 1. What the user sees

### Live TV (default)
- Opens on the **90s** tab with a TV-turn-on animation, static burst and a green VCR-style channel number in the corner.
- **Channels** are numbered from 1 on each decade tab:
  - Network/block channels: Adult Swim, Toonami, Cartoon Network, Boomerang, Nickelodeon/Nicktoons, Nick Jr., Nick at Nite, Disney Channel, Fox Kids, Kids' WB, One Saturday Morning, Jetix, PBS Kids, TGIF, MTV, VH1, Comedy Central, Sci-Fi Channel, USA Up All Night. Each only appears on the decades it was actually on air.
  - Type channels: cartoons, Saturday morning, commercials, kids network breaks, toy/game ads, classic TV, sitcoms, game shows, music videos, taped-off-TV VHS, news, sports, wrestling, anime, computer TV, weather, infomercials, PSAs, school films, trailers, movies, comedy movies, noir, westerns, horror, late night, softcore ("SKIN").
  - One hardcore adult channel ("After Dark · Hardcore", call sign XXX), shared across all decade tabs. It pulls from a broad Archive search for real porn / adult film / stag / hardcore titles (hundreds of tapes after curation), with gay content and anything that looks underage filtered out.
- **Broadcast clock:** each channel plays its tapes back-to-back around the clock, reshuffled daily. Everyone tuning in at the same moment sees the same thing. Coming back later, the channel has moved on.
  - Long VHS recordings and marathons (over 1 hour) air in rotating half-hour blocks.
  - Movie channels always air whole films, up to 4 hours.
- **Info banner** on tune: channel chip, title, progress bar, "Up next at 7:22p: …", clock.

### Guide (☰, live-TV button, or center button)
- Prevue-style screen: the current channel shrinks into a preview box, with a scrolling grid below.
- **Tabs (◀ ▶):** 50s · 60s · 70s · 80s · 90s · 00s · MOVIES · SHOWS. A red dot marks the decade you're watching.
- Live tabs show **ON NOW** and **UP NEXT** with real start times.
- ⏯ in the guide opens the Blocked Tapes list (unblocks tapes from an older feature).

### On Demand (MOVIES / SHOWS tabs)
- **MOVIES:** about 550 full-length films (1–4 hours) with lengths shown. They play from the start.
- **SHOWS:** about 600 series with about 12,000 full episodes. Pick a show, then an episode, and it plays from the start; the next episode autoplays.
- The guide lands on what you're watching and remembers your scroll spot per tab. The episode list highlights the episode you're on.
- CH ▲▼ while watching On Demand returns to live TV.

### Remote mapping
| Button | Live / On Demand |
|---|---|
| Up/Down, CH ▲▼ | Channel up/down (in the guide: browse; CH jumps 5 or 10) |
| OK / ☰ / live-TV button | Open the guide; OK in the guide tunes or plays |
| Left | Flashback to the last channel |
| Right | Show the info banner |
| ⏯ | Pause with a VCR "PAUSE" readout |
| ⏩ tap / double-tap / hold | +30s / skip to the next show / +30s |
| ⏪ tap / double-tap | −15s / start the show over |
| Back ×2 | TV-off animation, then exit |
| Digits (if present) | Direct channel entry |

---

## 2. Architecture

```
┌──────────────── Android app (Kotlin) ────────────────┐
│ MainActivity                                         │
│  ├─ NativeVideo: ExoPlayer (Media3) → SurfaceView    │  ← actual video, hardware plane
│  ├─ WebView (transparent) → index.html/app.js        │  ← all UI, guide, logic
│  ├─ Key mapping: remote keys → RT.remote('Name')     │
│  ├─ JS bridge "Android": get(url) (no-CORS fetch),   │
│  │   vLoad/vPlay/vPause/vStop/vSeek/vRect, version,  │
│  │   webVersion, freshWeb, alive, exit               │
│  └─ Error overlay if the page never says alive()     │
│ Updater                                              │
│  ├─ syncWeb: on launch, gets the latest commit SHA,  │
│  │   downloads index.html/style.css/app.js/          │
│  │   channels.js from raw.githubusercontent @SHA     │
│  │   (waits ≤6s), serves them in place of the        │
│  │   bundled assets                                  │
│  └─ checkApk: GitHub releases/latest vs versionCode  │
│      → download APK → system installer (FileProvider)│
└──────────────────────────────────────────────────────┘
          │ fetches at runtime
          ▼
  raw.githubusercontent.com/Vyd02/RewindTV/main/lists/…   (curated tape lists, JSON)
  archive.org/advancedsearch.php  (fallback live search)
  archive.org/metadata/<id>       (fallback per-tape file lookup)
  archive.org/download/<id>/<file> (the video streams)
```

**Why a WebView for UI plus native video?** The first versions used an HTML `<video>` inside the WebView. On the user's Fire TV that showed a black picture with audio. Video now plays in ExoPlayer on a SurfaceView under a transparent WebView, and a JS stand-in object (`nativeVideo()` in app.js) mimics the `<video>` API so the UI logic is the same in a desktop browser (for testing) and on the TV.

**Guide preview box:** in native mode the SurfaceView is resized and moved with a ValueAnimator (`NativeVideo.rect`). The guide's CSS punches a transparent hole (`#gHole`, big box-shadow) where the video shows through.

### Self-update flow
- **Screen/logic changes** (HTML/CSS/JS, channel definitions) apply on the next app launch with no install. A "✨ Updated!" toast shows when new files load.
- **Native changes** need a new APK. The GitHub Actions workflow `.github/workflows/build.yml` builds on every push to main (unless the commit says `[skip ci]`) and publishes release `v1.0.<run_number>` with `RewindTV.apk`. The app downloads it and opens the system installer, which needs one click.
- The signing keystore is committed (`app/rewindtv.keystore`, password `rewindtv`) on purpose, so every CI build can install over the last one. It's a personal sideload app, but this is a known tradeoff.

---

## 3. Content pipeline (tools/)

The Internet Archive has huge amounts of retro TV, but uneven quality: many uploads are 240p/360p re-encodes of YouTube rips. So tapes are pre-checked offline.

1. **`tools/curate.py`** reads the channel definitions from `channels.js` (by evaluating it in node). For each channel it:
   - runs the archive search (sorted by downloads),
   - opens each tape's file list,
   - groups files into episodes and picks the best copy of each,
   - keeps only tapes that pass the quality bar,
   - writes `lists/<decade>/<theme>.json`, plus `lists/all/xxx.json` for the all-years adult channel (keeps ~350 titles so the XXX channel has deep variety),
   - writes `lists/index.json` with per-channel counts. The app hides channels with fewer than 10 tapes.
2. **Quality profiles:**
   - **classic** (50s–70s and the all-years channel): ≥480p, and ≥900 kbps at 480p (higher floors at 576/720/1080).
   - **clean** (80s, 90s, 00s): ≥480p and ≥1800 kbps at 480p (2600 at 720p, 4000 at 1080p). It searches up to 900 deep to find enough.
   - **File choice:** only mp4/m4v/mkv, never `_512kb` copies. The archive's `.ia.mp4` (streaming-ready) wins ties, and each episode keeps up to 2 fallback copies.
3. **`tools/english.py`** keeps English only. It drops tapes whose archive `language` tag isn't English, or whose title marks another language (sub español, legendado, VOSTFR, raw, non-Latin script…). Titles saying English dub/sub always stay. `curate.py` calls it too.
4. **`tools/ondemand.py`** builds `lists/ondemand/movies.json` and `shows.json` from the curated lists:
   - **Movies:** film-library themes, or titles with a "(1987)"-style year; 1–4 hours long.
   - **Shows:** ≥2 episode files with a median length of 8–65 minutes.
   - **Junk filters:** YouTube/reaction/trailer/"Night 3"/compilations, plus titles that are just a year.

Caches live in `.cache/` (gitignored). The curator was run manually; there's no scheduled refresh.

### Channel definitions (`app/src/main/assets/channels.js`)
- `THEMES` holds each channel's call sign, name, color and archive query. `LINEUPS` sets which themes appear on each decade tab, in dial order. `lineup(dec)` builds the channel list, adds the decade clause, and filters by `window.AVAIL` (from index.json).
- `decadeClause` uses `year:[1990 TO 1999] OR subject:1990s OR subject:"90s" OR title:(1990 OR … 1999)`. Exact year words are used instead of a `title:199*` wildcard, which was about 10× slower on archive.org.
- `SAFE` is added to every query: `mediatype:movies`, a language exclusion, and a list of known watermark uploaders.
- Adult channels also get `NO_MINORS`, which drops anything titled or tagged teen/young/school/etc. plus hentai/animation, and `NO_GAY` (user preference).

---

## 4. Files

```
app/src/main/java/com/vyd02/rewindtv/
  MainActivity.kt   WebView + native video + key mapping + JS bridge + error overlay
  NativeVideo.kt    ExoPlayer on SurfaceView, letterboxing, guide preview resizing, events to JS
  Updater.kt        screen-file sync from GitHub @ latest SHA; APK self-update
app/src/main/assets/
  index.html        layout (screen, OSD, banner, guide, pickers, toasts)
  style.css         1920×1080 stage scaled to fit; CRT on/off animations; guide; panels
  app.js            everything else: lists, broadcast clock, playback, guide, On Demand, remote
  channels.js       channel themes, decade lineups, query filters
  fonts/VT323.ttf   VCR-style font (OFL)
app/src/main/res/   banner (320×180 leanback), icon, FileProvider paths
app/build.gradle.kts  AGP 8.5.2, Kotlin 1.9.24, minSdk 22, target 34, media3 1.3.1, webkit, core
.github/workflows/build.yml  CI build + GitHub release
tools/curate.py, english.py, ondemand.py   content pipeline (Python 3, needs node for channels.js)
lists/              curated JSON (not in the zip if too big; it's in the repo)
README.md           install + remote cheat sheet
```

### Key app.js pieces
- `loadList(ch)`: curated list from GitHub, falling back to live archive search.
- `timeline / scheduleAt / nextAfter`: the daily-shuffled broadcast clock (binary search over cumulative durations).
- `armBlock / followClock`: move on when a half-hour block's airtime ends; resync to the clock when a tape ends.
- `play(...)`: picks the episode file, computes the join offset, sets the source, stall watchdog. `downgrade()` tries the next-best copy before `skip()` moves to the next show.
- `playVod / vodNext / pickVod`: On Demand.
- `remote(key)`: all input handling; `tap()` handles double-tap detection on ⏩/⏪.

---

## 5. Known limitations / open questions for review

1. **Source quality ceiling.** Everything comes from Internet Archive user uploads. Even after filtering, some tapes have burned-in logos (watermarks) and some are mislabeled by decade. There's no automated visual check (blur, watermark, interlacing).
2. **Metadata trust.** Height, length and language come from archive metadata, which can be missing or wrong. Tapes with unknown height are excluded.
3. **Interlaced VHS captures** play without deinterlacing (ExoPlayer/MediaCodec), so combing is possible on 480i sources.
4. **Clock drift.** Curated tapes have real lengths, but search-fallback tapes assume 22 minutes. The clock resyncs when a tape ends.
5. **No authentication.** Archive items behind login (collection `loggedin`) are excluded on the adult channel but not globally.
6. **Committed signing key** and a public repo.
7. **Web-file sync** can't update native code; mismatches are guarded by feature detection (`NATIVE`, `Android.version`).
8. **Testing** was done in headless Chrome at Fire TV's CSS resolution with a stubbed native bridge, and on the real TV by the user. There are no automated tests.
9. **Legal/content.** The app only plays what the Internet Archive serves publicly. Requests to pull from piracy sites (e.g., 9anime) or porn tube sites were declined. Free legal HD services (Tubi, Pluto TV, RetroCrush) were suggested as launch-out channels but not built.

Ideas not yet built: weekly automatic re-curation (a GitHub Action), a "flag bad tape" button that feeds back into curation, launch-out channels to Tubi/Pluto/RetroCrush, commercial breaks inserted between shows, CRT effect as an optional toggle.
