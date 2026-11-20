# Rewind TV

A 90s cable box for Fire TV / Android TV. 23 channels of old cartoons, commercials, reruns, game shows and movies, all streaming free from the [Internet Archive](https://archive.org). Each channel runs on a half-hour schedule that's the same on every TV, so you tune in mid-show like real cable.

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

## Remote

| Button | What it does |
|---|---|
| Up / Down | Channel up / down |
| OK | Open the guide (OK again tunes the highlighted channel) |
| Left | Flashback to the last channel |
| Right | Show what's on |
| Play/Pause | Pause, with a VCR-style readout |
| Rewind / Fast forward | Jump back 15s / ahead 30s |
| Back (twice) | Turn the TV off |

## Add or change channels

Edit `app/src/main/assets/channels.js`. Each channel is just an Internet Archive search. Push to `main` and GitHub builds a new APK automatically.

## Notes

- Videos come from the Internet Archive. What's on each channel depends on what people have uploaded there.
- No content filter: channels show whatever is on the Internet Archive for that search.
- The signing key (`app/rewindtv.keystore`) is committed on purpose so every build can update the last one.
