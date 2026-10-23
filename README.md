<div align="center">

<img src="icon.png" width="96" alt="AniStar logo">

# AniStar for Seanime

Watch anime from [anistar.org](https://anistar.org) inside [Seanime](https://github.com/5rahim/seanime), with Russian voice-over.

![type](https://img.shields.io/badge/Seanime-online%20streaming%20provider-6d28d9)
![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FLampe332%2Fseanime-anistar%2Fmain%2Fmanifest.json&query=%24.version&label=version&color=6d28d9)
![audio](https://img.shields.io/badge/audio-Russian%20dub-555)
![quality](https://img.shields.io/badge/quality-720p%20%7C%20360p-555)

</div>

## Install

In Seanime go to **Extensions** → **Add extension**, paste this URL and confirm:

```
https://raw.githubusercontent.com/Lampe332/seanime-anistar/main/manifest.json
```

Open any anime, switch to **Online streaming** and pick **AniStar (RU)** from the provider dropdown. Updates come through the same URL, so later on a click on **Check for updates** is enough.

## Servers

| Server | Format | Qualities |
|---|---|---|
| AniStar HLS (default) | m3u8 | 720p, 360p |
| AniStar MP4 | mp4 | 720p, 360p |

MP4 is the fallback if HLS gives you trouble. Both run through Seanime's proxy because the site's CDN answers 403 to anything without an anistar.org referer.

## How it finds the right show

AniStar files every show under one Russian title plus a few romaji and English aliases. Its search also returns news posts, manga pages, openings and AMVs right next to the actual anime. The extension drops all of that, then checks what's left against AniList: release year, TV or movie, season number, and "Part 2" style splits. When the numbers don't line up you get "not found", not the wrong season.

Sometimes AniList splits a show that the site keeps in a single entry. Those get mapped onto the right episodes:

| AniList entry | Plays from the site entry |
|---|---|
| SPY×FAMILY Part 2 | *Spy x Family*, episodes 13 to 25 |
| SAKAMOTO DAYS Part 2 | *Sakamoto Days*, episodes 12 to 22 |
| Demon Slayer: Entertainment District Arc | *Kimetsu no Yaiba 2nd Season*, episodes 8 to 18 |

For that, the extension asks AniList once per anime for synonyms and prequels. Seanime only hands over synonyms that contain the word "season", and that misses names like "KnY 3".

A lot of episodes exist twice on the site: the main dub and a multi-voice dub. The main dub wins.

## Tested

Both runs went through Seanime's own extension playground.

- 101 AniList titles, from Naruto and One Piece to shows airing this season, including about 30 sequels and split cours. No wrong matches.
- 44 random playable entries pulled from across the whole site catalogue. 41 found, 3 missed, none matched to the wrong show.

## Known gaps

- Russian dub only, no subtitles. The site burns a 1XBET watermark into its videos, and there's nothing an extension can do about that.
- About the older third of the catalogue still points at dead Flash players (myvi, kiwi, sibnet). Those shows get found but have no episodes.
- Different spelling or season numbering on the site means "not found". Two cases from testing: AniList says *GIRS Crisis* where the site says *Gears Crisis*, and AniList's first season of *Jing: Shuang Cheng* is the site's "2nd Season". **Manual match** in Seanime sorts these out by hand.
- AniList allows roughly 30 requests a minute. If it rate-limits at the wrong moment, split cours go undetected until the next search.
- If AniStar changes its player page or CDN, this breaks. Please open an issue.

## Notes

The extension only reads public pages on anistar.org and hosts no video. The site sits behind Cloudflare: Seanime's fetch gets through, plain scripts usually get a 403.
