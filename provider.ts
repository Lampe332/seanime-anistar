/// <reference path="./onlinestream-provider.d.ts" />

// AniStar (anistar.org) online-stream provider for Seanime.
// Search goes through the DLE site search; episodes come from the site's own
// player page, which embeds a JS playlist.

const BASE_URL = "https://anistar.org"
const ANILIST_URL = "https://graphql.anilist.co"
const SERVER_HLS = "AniStar HLS"
const SERVER_MP4 = "AniStar MP4"
const MAX_SEARCH_PAGES = 3
const SERIES_FORMATS = ["TV", "TV_SHORT", "ONA"]
const MEDIA_FIELDS = "id format episodes startDate { year } title { romaji english } synonyms"
const PART_RE = /(?:part|cour)\s*\d+|\d+(?:st|nd|rd|th)\s+cour/gi

// AniList answers per anime: Seanime searches the romaji and the English title back to back,
// and AniList only allows ~30 requests per minute.
const ANILIST_CACHE: Record<number, any> = {}

type PlaylistEntry = {
    title: string
    mediaId: string
    urls: string[]
}

// One AniList entry (the searched anime or one of its prequels) that site entries are checked against.
type TitleSet = {
    primary: string
    titles: string[]
    seasons: string[]
    parts: string[]
    year: number
    episodes: number
}

class Provider {

    getSettings(): Settings {
        return {
            episodeServers: [SERVER_HLS, SERVER_MP4],
            supportsDub: true,
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = this.toSearchQuery(opts.query)
        if (query.length < 3) return []

        // DLE needs every word to match: "Shingeki no Kyojin 3" or "...: Tensaitachi no ..." (site: "Tensai-tachi")
        // find nothing, so retry without sequel numbers, then with only the part before the subtitle.
        const baseQuery = query
            .replace(/\b(\d+(st|nd|rd|th)\s+(season|cour)|(season|part|cour)\s+\d+|\d+)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
        const mainTitle = this.toSearchQuery(opts.query.split(/:|\s-\s/)[0])

        const { self, prequels } = await this.franchise(opts, query)
        const playlists: Record<string, EpisodeDetails[]> = {}
        const tried: Record<string, boolean> = {}
        // Last resort: AniList synonyms, the site often uses one of them ("Hitori no Shita: The Outcast 3" for "Yi Ren Zhi Xia 3").
        const synonyms = self.titles.filter(t => /^[\x20-\x7E]+$/.test(t)).map(t => this.toSearchQuery(t)).slice(0, 8)
        const attempts: [string, string][] = [[query, query], [baseQuery, query], [mainTitle, query]]
        for (const synonym of synonyms) attempts.push([synonym, synonym])
        for (const [siteQuery, matchQuery] of attempts) {
            if (siteQuery.length < 3 || tried[siteQuery]) continue
            tried[siteQuery] = true
            const results = await this.searchSite(siteQuery, matchQuery, opts, self, prequels, playlists)
            if (results.length > 0) return results
        }
        return []
    }

    private async searchSite(
        siteQuery: string,
        matchQuery: string,
        opts: SearchOptions,
        self: TitleSet,
        prequels: TitleSet[],
        playlists: Record<string, EpisodeDetails[]>,
    ): Promise<SearchResult[]> {
        const direct: SearchResult[] = []
        const continued: SearchResult[] = []
        const seen: Record<string, boolean> = {}
        const media = opts.media
        const isSeries = media.format === "TV" || media.format === "TV_SHORT"

        for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
            let body = "do=search&subaction=search&titleonly=3&story=" + encodeURIComponent(siteQuery)
            if (page > 1) body += `&search_start=${page}&full_search=0&result_from=${(page - 1) * 10 + 1}`

            const res = await fetch(`${BASE_URL}/index.php?do=search`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": `${BASE_URL}/`,
                },
                body,
            })
            const html = await res.text()

            for (const chunk of html.split('<div class="news"').slice(1)) {
                const m = chunk.match(/<div class="title_left">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<p class="tags">([\s\S]*?)<\/p>/)
                if (!m) continue
                const href = m[1]
                const fullTitle = this.decodeEntities(m[2])
                const tags = m[3]
                const info = chunk.replace(/<[^>]+>/g, " ")

                // Search also returns news, manga, AMVs, openings and hentai parodies.
                if (!/anistar\.org\/anime\//.test(tags)) continue
                if (!media.isAdult && /anistar\.org\/hentai\//.test(tags)) continue
                if (/\b(OP|ED)\s*\d+|\bAMV\b|опенинг|эндинг|трейлер|\btrailer\b|\[(Manga|Манга)\]/i.test(fullTitle)) continue

                // "ОВА" must be a whole uppercase word, or it would hit "пожал-ова-ть" and the like.
                const isFilm = /Серии:[^.]{0,40}фильм/i.test(info)
                    || /\b(movie|film|gekijouban|OVA|OAD)\b/i.test(fullTitle)
                    || /[Фф]ильм|(^|[^А-Яа-яЁё])ОВА([^А-Яа-яЁё]|$)/.test(fullTitle)
                if (isSeries && isFilm) continue
                if (media.format === "MOVIE" && /Серии:\s*ТВ/i.test(info)) continue

                const year = parseInt((info.match(/Год выпуска:\s*(\d{4})/) || [])[1]) || 0
                const idMatch = href.match(/\/(\d+)-[^/]*\.html/)
                if (!idMatch || seen[idMatch[1]]) continue
                const newsId = idMatch[1]
                const url = href.startsWith("http") ? href : BASE_URL + href

                const title = this.buildTitle(fullTitle, matchQuery)
                if (!title) continue
                // Long site subtitles ("Yami Shibai - Japanese Ghost Stories [ТВ-4]") pull plain similarity down:
                // containing every word of the query counts too, but only when both years are known and agree.
                const sameYear = !!year && !!self.year && Math.abs(year - self.year) <= 1
                const simSelf = Math.max(this.similarity(title, matchQuery), sameYear && this.containsWords(title, matchQuery) ? 0.6 : 0)
                const matchesSelf = this.yearFits(year, self.year) && this.fits(title, self) && simSelf >= 0.5

                // Is this really the entry of a prequel? Later cours often continue inside it
                // ("SPY×FAMILY Part 2" = episodes 13-25 of "Spy x Family", "Yuukaku-hen" = 8-18 of "Kimetsu no Yaiba 2nd Season").
                let owner = -1
                let simOwner = 0
                for (let k = 0; k < prequels.length && owner === -1; k++) {
                    const t = this.buildTitle(fullTitle, prequels[k].primary)
                    if (!t || !this.yearFits(year, prequels[k].year) || !this.fits(t, prequels[k])) continue
                    const sim = this.bestSimilarity(t, prequels[k].titles)
                    if (sim >= 0.5) {
                        owner = k
                        simOwner = sim
                    }
                }

                if (owner === -1) {
                    if (!matchesSelf) continue
                    seen[newsId] = true
                    direct.push({ id: newsId, title, url, subOrDub: "dub" })
                    continue
                }

                const before = prequels.slice(0, owner + 1)
                const offset = before.some(p => !p.episodes) ? 0 : before.reduce((sum, p) => sum + p.episodes, 0)
                if (!playlists[newsId]) playlists[newsId] = await this.episodeList(newsId)
                const last = playlists[newsId].reduce((max, e) => Math.max(max, e.number), 0)
                const prefersSelf = matchesSelf && Math.max(simSelf, this.bestSimilarity(title, self.titles)) >= simOwner
                const longerThanSelf = self.episodes ? last > self.episodes : !prefersSelf

                seen[newsId] = true
                if (offset && longerThanSelf && last - offset >= Math.min(self.episodes || 1, 3)) {
                    continued.push({ id: `${newsId}~${offset}`, title: opts.query, url, subOrDub: "dub" })
                } else if (prefersSelf) {
                    direct.push({ id: newsId, title, url, subOrDub: "dub" })
                }
            }

            if (!html.includes(`list_submit(${page + 1})`)) break
        }

        // A dedicated entry beats a continuation inside an older one.
        return direct.concat(continued)
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        // "8643~12": the anime continues in entry 8643 after its episode 12 (see searchSite).
        const [newsId, offsetText] = id.split("~")
        const offset = parseInt(offsetText) || 0
        const episodes = await this.episodeList(newsId)
        if (!offset) return episodes
        return episodes
            .filter(e => e.number > offset)
            .map(e => ({ id: e.id, number: e.number - offset, url: e.url, title: e.title }))
    }

    private async episodeList(id: string): Promise<EpisodeDetails[]> {
        const playerUrl = this.playerUrl(id)
        const entries = this.parsePlaylist(await this.getText(playerUrl))

        // "Серия 12" = episode 12; specials ("Спешл 1") and half-episodes ("Серия 12.5") are skipped.
        // Episodes often come twice ("Серия 5" + "Серия 5 Многоголосая озвучка"): prefer the plain one.
        const byNumber: Record<number, { entry: PlaylistEntry, plain: boolean }> = {}
        for (const entry of entries) {
            const m = entry.title.match(/^[СC]ерия\s+(\d+)(?![.,]?\d)(.*)$/)
            if (!m) continue
            const number = parseInt(m[1])
            const plain = /^\s*(END)?\s*$/i.test(m[2])
            const current = byNumber[number]
            if (!current || (plain && !current.plain)) byNumber[number] = { entry, plain }
        }

        const episodes: EpisodeDetails[] = Object.keys(byNumber).map(k => {
            const entry = byNumber[parseInt(k)].entry
            return { id: `${id}:${entry.mediaId}`, number: parseInt(k), url: playerUrl, title: entry.title }
        })

        // Movies / OVA-only pages have no "Серия N" entries: number them in order.
        if (episodes.length === 0) {
            entries.forEach((entry, i) => {
                episodes.push({ id: `${id}:${entry.mediaId}`, number: i + 1, url: playerUrl, title: entry.title })
            })
        }

        return episodes.sort((a, b) => a.number - b.number)
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const [newsId, mediaId] = episode.id.split(":")
        // Re-read the player every time: the MP4 links are signed and expire.
        const entries = this.parsePlaylist(await this.getText(this.playerUrl(newsId)))
        const entry = entries.find(e => e.mediaId === mediaId)
        if (!entry) throw new Error(`Episode ${mediaId} not found in AniStar playlist`)

        const wantHls = server !== SERVER_MP4
        const byQuality: Record<string, VideoSource> = {}

        for (const url of entry.urls) {
            const isHls = url.includes(".m3u8")
            const isMp4 = !isHls && url.includes("sfhd.an-media.org")
            if (wantHls ? !isHls : !isMp4) continue

            const q = url.match(/\/(\d{3,4})\.mp4/)
            const quality = q ? `${q[1]}p` : "auto"
            if (byQuality[quality]) continue
            byQuality[quality] = { url, type: isHls ? "m3u8" : "mp4", quality, subtitles: [] }
        }

        const videoSources = Object.keys(byQuality)
            .map(k => byQuality[k])
            .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))
        if (videoSources.length === 0) throw new Error(`No ${server} sources for this episode`)

        return {
            server: wantHls ? SERVER_HLS : SERVER_MP4,
            // The CDN answers 403 without this Referer; Seanime proxies the stream with it.
            headers: { "Referer": `${BASE_URL}/` },
            videoSources,
        }
    }

    private playerUrl(newsId: string): string {
        return `${BASE_URL}/test/player2/videoas_p2p_new.php?id=${newsId}`
    }

    private async getText(url: string): Promise<string> {
        const res = await fetch(url, { headers: { "Referer": `${BASE_URL}/` } })
        if (!res.ok) throw new Error(`AniStar request failed (${res.status}): ${url}`)
        return res.text()
    }

    // The player page holds `var playlst=[{ title:"Серия 1", media_id:"60976", ..., files:[...], files_mp4:[...], files_as:[...] }, ...]`.
    private parsePlaylist(html: string): PlaylistEntry[] {
        const entries: PlaylistEntry[] = []
        const re = /title:"([^"]*)",\s*media_id:"(\d+)"([\s\S]*?)files_as:\[([\s\S]*?)\]/g
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
            const urls: string[] = []
            const fileRe = /file:"(https?:\/\/[^"]+)"/g
            let f: RegExpExecArray | null
            const block = m[3] + m[4]
            while ((f = fileRe.exec(block)) !== null) {
                if (urls.indexOf(f[1]) === -1) urls.push(f[1])
            }
            entries.push({ title: m[1].trim(), mediaId: m[2], urls })
        }
        return entries
    }

    // The searched anime plus up to three TV/ONA prequels from AniList. Seanime only hands over synonyms
    // containing "season", so the full list ("KnY 3") also comes from here. Without AniList, prequels stay empty.
    private async franchise(opts: SearchOptions, query: string): Promise<{ self: TitleSet, prequels: TitleSet[] }> {
        const media = opts.media
        let node: any = ANILIST_CACHE[media.id] || null
        if (!node) {
            try {
                let fields = MEDIA_FIELDS
                for (let i = 0; i < 3; i++) fields = `${MEDIA_FIELDS} relations { edges { relationType node { ${fields} } } }`
                const res = await fetch(ANILIST_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ query: `query ($id: Int) { Media(id: $id, type: ANIME) { ${fields} } }`, variables: { id: media.id } }),
                })
                if (res.ok) node = JSON.parse(await res.text()).data.Media
            } catch (e) {
                node = null
            }
            if (node) ANILIST_CACHE[media.id] = node
        }

        const selfTitles = [opts.query, media.romajiTitle || "", media.englishTitle || ""].concat(media.synonyms || [])
        if (node) selfTitles.push(node.title.romaji || "", node.title.english || "", ...this.latinSynonyms(node))
        const self = this.titleSet(query, selfTitles, opts.year || 0, media.episodeCount || (node && node.episodes) || 0)

        const prequels: TitleSet[] = []
        for (let depth = 0; node && depth < 3; depth++) {
            const edges = ((node.relations && node.relations.edges) || []).filter((e: any) => e.relationType === "PREQUEL")
            // Prefer the series prequel; a movie in between is passed through but never counted.
            const next = edges.find((e: any) => SERIES_FORMATS.indexOf(e.node.format) !== -1) || edges[0]
            node = next ? next.node : null
            if (node && SERIES_FORMATS.indexOf(node.format) !== -1) {
                const titles = [node.title.romaji || "", node.title.english || ""].concat(this.latinSynonyms(node))
                prequels.push(this.titleSet(this.toSearchQuery(node.title.romaji || ""), titles, (node.startDate && node.startDate.year) || 0, node.episodes || 0))
            }
        }
        return { self, prequels }
    }

    private titleSet(primary: string, titles: string[], year: number, episodes: number): TitleSet {
        const all = titles.filter(t => /^[\x20-\x7E]+$/.test(t)).join(" / ")
        return { primary, titles: titles.filter(t => !!t), seasons: this.seasonNumbersOf(all), parts: this.partNumbersOf(all), year, episodes }
    }

    private latinSynonyms(node: any): string[] {
        return (node.synonyms || []).filter((s: string) => /^[\x20-\x7E]+$/.test(s))
    }

    // Anything numbered that AniList does not know is another season/movie, and the anime's own
    // sequel number must show up in the site title ("Re:Zero 2nd Season" is not the Director's Cut).
    private fits(title: string, set: TitleSet): boolean {
        const seasons = this.seasonNumbersOf(title)
        const parts = this.partNumbersOf(title)
        if (seasons.some(n => set.seasons.indexOf(n) === -1) || parts.some(n => set.parts.indexOf(n) === -1)) return false
        return this.seasonNumbersOf(set.primary).every(n => seasons.indexOf(n) !== -1)
            && this.partNumbersOf(set.primary).every(n => parts.indexOf(n) !== -1)
    }

    private yearFits(siteYear: number, year: number): boolean {
        return !siteYear || !year || Math.abs(siteYear - year) <= 1
    }

    private bestSimilarity(title: string, titles: string[]): number {
        return titles.reduce((best, t) => Math.max(best, this.similarity(title, t)), 0)
    }

    // DLE expects windows-1251 and matches whole words: non-ASCII (ō, ū, ×…) and punctuation
    // ("Kimi no Na wa.", "Re:Zero", "Steins;Gate", "BLEACH: ... - Ketsubetsu-tan") would make the search come back empty.
    private toSearchQuery(query: string): string {
        return query
            .replace(/[’‘]/g, "'")
            .replace(/[ōŌ]/g, "o").replace(/[ūŪ]/g, "u").replace(/[āĀ]/g, "a")
            .replace(/[ēĒ]/g, "e").replace(/[īĪ]/g, "i")
            .replace(/[^\x20-\x7E]+/g, " ")
            .replace(/\s+-\s+/g, " ")
            .replace(/[:;!?.,()\[\]"\/~]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
    }

    // Titles look like "Русское название / Romaji Title / English Title".
    // Seanime matches against AniList's latin titles, so keep the latin alias closest to the query.
    // Sequels often list the plain franchise name as an alias ("One Punch Man TV-3 / ... / One Punch Man"),
    // so a season marker from a sibling alias, or a part marker anywhere, is added back to keep S1 and S3 apart.
    private buildTitle(fullTitle: string, query: string): string | null {
        const aliases = this.latinAliases(fullTitle)
        if (aliases.length === 0) return null

        let title = aliases[0]
        for (const alias of aliases) {
            if (this.similarity(alias, query) > this.similarity(title, query)) title = alias
        }

        const season = aliases.join(" / ").match(/season\s*(\d+)|(\d+)(?:st|nd|rd|th)?\s+season/i)
        const seasonNum = season ? parseInt(season[1] || season[2]) : 1
        if (seasonNum > 1 && !/\d/.test(title)) title += ` Season ${seasonNum}`

        const part = fullTitle.match(/(?:part|часть)\s*(\d+)/i)
        if (part && parseInt(part[1]) > 1 && !/part/i.test(title)) title += ` Part ${part[1]}`

        return title
    }

    private latinAliases(fullTitle: string): string[] {
        const aliases: string[] = []
        for (const rawPart of fullTitle.split(/\s+\/\s*|\s*\/\s+/)) {
            // "ТВ-3" / "TV-3" -> "Season 3" like AniList; "(TV)" and "[ТВ-1]" just mean the first series.
            const part = rawPart
                .replace(/ТВ/g, "TV")
                .replace(/[\[(]\s*TV\s*[\])]/gi, " ")
                .replace(/(^|[\s\[(])TV[\s-]*(\d+)/gi, (_: string, pre: string, n: string) => n === "1" ? pre : `${pre}Season ${n}`)
            const latinLetters = (part.match(/[A-Za-z]/g) || []).length
            const otherChars = (part.match(/[^\x00-\x7F]/g) || []).length
            if (latinLetters < 2 || otherChars >= latinLetters) continue

            const clean = part.replace(/[^\x20-\x7E]+/g, " ").replace(/[\[(]\s*-?\d*\s*[\])]/g, "").replace(/\s+/g, " ").trim()
            if (clean) aliases.push(clean)
        }
        return aliases
    }

    // Sequel numbers in a title ("2nd Season", "TV 3", "III", "100"); "Part N" / "Cour N" is counted separately,
    // years like "(2011)" and a plain "1" (first season) are ignored.
    private seasonNumbersOf(s: string): string[] {
        const roman: Record<string, string> = { II: "2", III: "3", IV: "4", VI: "6", VII: "7", VIII: "8", IX: "9" }
        const rest = s.replace(PART_RE, " ")
        const nums = (rest.match(/\d+/g) || []).filter(n => !/^(19|20)\d\d$/.test(n)).map(n => String(parseInt(n)))
        for (const word of rest.split(/[^A-Za-z]+/)) {
            if (roman[word]) nums.push(roman[word])
        }
        return nums.filter(n => n !== "1")
    }

    private partNumbersOf(s: string): string[] {
        return (s.match(PART_RE) || []).map(p => String(parseInt(p.replace(/\D/g, "")))).filter(n => n !== "1")
    }

    private containsWords(title: string, query: string): boolean {
        const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => !!w)
        const have = words(title)
        const want = words(query)
        return want.length > 0 && want.every(w => have.indexOf(w) !== -1)
    }

    private similarity(a: string, b: string): number {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
        const x = norm(a)
        const y = norm(b)
        if (!x || !y) return 0
        return 1 - this.levenshtein(x, y) / Math.max(x.length, y.length)
    }

    private decodeEntities(s: string): string {
        return s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    }

    private levenshtein(a: string, b: string): number {
        const prev: number[] = []
        for (let j = 0; j <= b.length; j++) prev[j] = j
        for (let i = 1; i <= a.length; i++) {
            let diag = prev[0]
            prev[0] = i
            for (let j = 1; j <= b.length; j++) {
                const tmp = prev[j]
                prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
                diag = tmp
            }
        }
        return prev[b.length]
    }
}
