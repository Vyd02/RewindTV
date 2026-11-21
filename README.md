# Rewind TV

A 90s cable box for Fire TV / Android TV. Dozens of channels of old cartoons, commercials, reruns, game shows, music videos, wrestling, anime and movies, plus late-night softcore (SKIN) and a full hardcore XXX channel with hundreds of real adult videos (straight content only), all streaming free from the [Internet Archive](https://archive.org). Each channel runs on a half-hour schedule that's the same on every TV, so you tune in mid-show like real cable.

## Install on Fire TV

1. Settings → My Fire TV → Developer Options → Install Unknown Apps → turn on **Downloader**
   (No Developer Options? My Fire TV → About → click your device name 7 times.)
2. Install **Downloader** from the Fire TV app store.
3. In Downloader, type this URL:

   ```
   https://github.com/Vyd02/RewindTV/releases/latest/download/RewindTV.apk
   ```

4. Install, then open **Rewind TV** from your apps.

To update, run the same URL again. It installs right over the old version.

## Remote (Insignia / Fire TV)

| Button | What it does |
|---|---|
| Up / Down or CH ▲▼ | Channel up / down |
| OK / Menu (☰) | Open the guide (OK again tunes the highlighted channel) |
| Left | Flashback to the last channel |
| In the guide: ◀ ▶ | Switch tabs: 50s–00s live channels, MOVIES and SHOWS (On Demand) |
| Right | Show what's on |
| Play/Pause | Pause, with a VCR-style readout · in guide opens Blocked Tapes + Adult PIN settings |
| ⏩ tap / double-tap | Fast-forward 30s / skip to the next show |
| ⏪ tap / double-tap | Rewind 15s / start the show over |
| Back (twice) | Turn the TV off |
| Number keys | Direct channel entry · also used to enter the adult PIN |

### Adult lock (SKIN + XXX)
Open the guide → Play/Pause to open Blocked Tapes. At the bottom you’ll see options to **Set adult PIN** or **Clear adult PIN**. Once a PIN is set, tuning to SKIN or XXX asks for the 4-digit code (unlocked for the rest of the session). No number buttons? Use ▲▼ to pick each number and OK to go to the next; ◀ erases, BACK cancels.

### Other quality-of-life
- Remembers the last channel you watched **per decade**
- On Demand resumes where you left off (movies & episodes)
- Faster recovery when a tape fails to start
- Broader, higher-volume hardcore (XXX) channel with gay content filtered out

## Add or change channels

Edit `app/src/main/assets/channels.js`. Each channel is just an Internet Archive search. Push to `main` and GitHub builds a new APK automatically.

## Notes

- Videos come from the Internet Archive. What's on each channel depends on what people have uploaded there.
- Adult channels filter out gay content and anything that looks underage (user preference).
- The signing key (`app/rewindtv.keystore`) is committed on purpose so every build can update the last one.

## Old-school TV features
- **Commercial breaks** between shows: 1–2½ minutes of real commercials from the same decade (double-tap ⏩ skips the break).
- **Station IDs** pop up when a new show starts.
- **Sounds:** TV-on hum, channel-change clunk, power-off zap.
- **Tape it:** double-tap ⏯ on any show to save it to **MY TAPES** (last tab in the guide). OK plays from the start, ⏩ erases.
- **Saturday mornings** (6 AM–noon): cartoon and kids network channels switch to Saturday-morning cartoons.
- **Sign-off** (3:00–5:30 AM): broadcast-style channels go off the air with color bars and the tone.
- **Holiday specials** mixed in: Halloween all October, Christmas from Nov 25 through December.
- **Prevue Guide channel (GUIDE)** and **Local on the 8s weather (LOCAL)** on every decade tab, with the real music.

Restore point before these features: branch `restore-before-oldschool`.
