<img src="icon.png" width="72" align="right" alt="AniStar logo">

# AniStar for Seanime

Online-streaming provider for [Seanime](https://github.com/5rahim/seanime) that plays anime from [anistar.org](https://anistar.org) with **Russian voice-over**.

## Install

1. Open Seanime → **Extensions** → **Add extension**.
2. Paste this URL and confirm:

   ```
   https://raw.githubusercontent.com/Lampe332/seanime-anistar/main/manifest.json
   ```

3. On an anime page open **Online streaming** and pick **AniStar (RU)** as provider.

Seanime checks the same URL for updates.

## What it does

- Searches anistar.org with the AniList titles and picks the right entry: seasons, parts, movies, OVAs and the release year are checked, so sequels don't get mixed up.
- Split cours that the site keeps in one entry are mapped correctly, e.g. *SPY×FAMILY Part 2* plays episodes 13–25 of the site's *Spy x Family* entry.
- Two servers: **AniStar HLS** (720p/360p, default) and **AniStar MP4** (720p/360p).
- When an episode exists twice (main dub and multi-voice dub), the main dub is used.

## Limitations

- Only Russian dub, no subtitles. The site burns an ad watermark into the video.
- Very old entries on the site only have dead Flash players, so they show no episodes.
- Titles spelled differently on the site than on AniList, or with a different season count, are not found. Use **Manual match** in Seanime for those.
- AniList is asked once per anime for synonyms and prequels (rate limit ~30 requests/min). If it is unavailable, split cours are not detected for that moment.

## Notes

The extension only reads public pages of anistar.org and hosts no video. The site is behind Cloudflare; Seanime's built-in fetch gets through, plain scripts usually don't.
