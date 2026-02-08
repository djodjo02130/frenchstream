const fetch = require('node-fetch');
const cheerio = require('cheerio');
const cache = require('./cache');
const utils = require('./utils');
const { HEADERS, PLAYER_NAMES, absoluteUrl, extractIdFromUrl, cleanTitle, extractSeasonFromTitle, normalizeForSearch, resolveBaseUrl } = utils;

/**
 * Search FrenchStream for a query string.
 * Returns array of { title, url, poster, type }
 */
async function searchFS(query) {
    const cacheKey = query.toLowerCase().trim();
    const cached = cache.get('search', cacheKey);
    if (cached) return cached;

    const response = await fetch(`${utils.BASE_URL}/engine/ajax/search.php`, {
        method: 'POST',
        headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: `query=${encodeURIComponent(query)}`,
    });

    const html = await response.text();
    if (!html || html.trim() === '') return [];

    const $ = cheerio.load(html);
    const results = [];

    $('.search-item').each((_, el) => {
        const onclick = $(el).attr('onclick') || '';
        const urlMatch = onclick.match(/location\.href='([^']+)'/);
        const url = urlMatch ? urlMatch[1] : null;
        const title = $(el).find('.search-title').text().trim();
        const poster = $(el).find('.search-poster img').attr('src') || null;

        if (url && title) {
            const type = url.includes('/s-tv/') || /saison/i.test(url) || /saison/i.test(title) ? 'series' : 'movie';
            results.push({ title, url: absoluteUrl(url), poster, type });
        }
    });

    cache.set('search', cacheKey, results);
    return results;
}

/**
 * Extract the numeric newsId from a FS page URL.
 * e.g. /films/15124241-reconnu-coupable.html → '15124241'
 */
function extractNewsId(pageUrl) {
    const match = pageUrl.match(/\/(\d+)-/);
    return match ? match[1] : null;
}

const FILM_LANG_MAP = { vostfr: 'VOSTFR', vfq: 'VFQ', vff: 'VFF' };

/**
 * Fetch film streams via the JSON API.
 * GET {baseUrl}/engine/ajax/film_api.php?id={newsId}
 * Returns array of { player, playerName, lang, url }
 */
async function scrapeFilmPage(pageUrl) {
    const cached = cache.get('streams', pageUrl);
    if (cached) return cached;

    const newsId = extractNewsId(pageUrl);
    if (!newsId) return [];

    const apiUrl = `${utils.getBaseUrl()}/engine/ajax/film_api.php?id=${newsId}`;
    const response = await fetch(apiUrl, { headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' } });
    const data = await response.json();

    if (!data || !data.players) return [];

    const streams = [];
    const playerKeys = ['premium', 'vidzy', 'uqload', 'dood', 'voe', 'filmoon'];

    for (const player of playerKeys) {
        const langs = data.players[player];
        if (!langs || typeof langs !== 'object') continue;

        // Déterminer la langue de "default" : si vostfr existe, default = VOSTFR (VO), sinon default = VF
        const hasVostfr = langs.vostfr && typeof langs.vostfr === 'string' && langs.vostfr.startsWith('http');
        const defaultLang = hasVostfr ? 'VOSTFR' : 'VF';

        for (const [langKey, url] of Object.entries(langs)) {
            if (!url || typeof url !== 'string' || !url.trim() || !url.startsWith('http')) continue;

            let lang;
            if (langKey === 'default') {
                lang = defaultLang;
            } else {
                lang = FILM_LANG_MAP[langKey];
                if (!lang) continue;
            }

            // Skip si on a déjà cette langue pour ce player (default=VOSTFR + vostfr=VOSTFR)
            if (streams.some(s => s.player === player && s.lang === lang)) continue;

            streams.push({
                player,
                playerName: PLAYER_NAMES[player] || player,
                lang,
                url: url.trim(),
            });
        }
    }

    cache.set('streams', pageUrl, streams);
    return streams;
}

const SERIES_LANG_MAP = { vf: 'VF', vostfr: 'VOSTFR', vo: 'VO' };

/**
 * Fetch series episode streams via the JSON API.
 * GET {baseUrl}/engine/ajax/episodes_nop_api.php?id={newsId}
 * Returns array of { player, playerName, lang, url }
 */
async function scrapeSeriesPage(pageUrl, episode) {
    const cacheKey = `${pageUrl}:ep${episode}`;
    const cached = cache.get('streams', cacheKey);
    if (cached) return cached;

    const newsId = extractNewsId(pageUrl);
    if (!newsId) return [];

    const apiUrl = `${utils.getBaseUrl()}/engine/ajax/episodes_nop_api.php?id=${newsId}`;
    const response = await fetch(apiUrl, { headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' } });
    const data = await response.json();

    if (!data) return [];

    const streams = [];
    const epStr = String(episode);
    const playerKeys = ['premium', 'vidzy', 'uqload', 'dood', 'voe', 'filmoon'];

    for (const [langKey, lang] of Object.entries(SERIES_LANG_MAP)) {
        const langContainer = data[langKey];
        if (!langContainer || typeof langContainer !== 'object') continue;

        const epData = langContainer[epStr];
        if (!epData || typeof epData !== 'object') continue;

        for (const player of playerKeys) {
            const url = epData[player];
            if (!url || typeof url !== 'string' || !url.trim() || !url.startsWith('http')) continue;

            streams.push({
                player,
                playerName: PLAYER_NAMES[player] || player.charAt(0).toUpperCase() + player.slice(1),
                lang,
                url: url.trim(),
            });
        }
    }

    cache.set('streams', cacheKey, streams);
    return streams;
}

/**
 * Scrape catalog page (films or series listing).
 * Returns { items: [{ id, title, poster, url, quality, version, type }], hasNext }
 */
async function scrapeCatalog(category, page) {
    const cacheKey = `${category}:${page}`;
    const cached = cache.get('catalog', cacheKey);
    if (cached) return cached;

    // category: 'films' or 's-tv'
    const pageStr = page > 1 ? `page/${page}/` : '';
    const url = `${utils.BASE_URL}/${category}/${pageStr}`;

    const response = await fetch(url, { headers: HEADERS });
    const html = await response.text();
    const $ = cheerio.load(html);

    const items = [];
    const type = category === 'films' ? 'movie' : 'series';

    $('.short').each((_, el) => {
        const linkEl = $(el).find('a.short-poster');
        const href = linkEl.attr('href');
        if (!href) return;

        const img = $(el).find('a.short-poster img');
        const poster = img.attr('src') || null;
        const alt = img.attr('alt') || '';

        const quality = $(el).find('.film-quality').text().trim() || null;
        const version = $(el).find('.film-version').text().trim() || null;

        const fsId = extractIdFromUrl(href);
        const title = alt.replace(/\s*affiche\s*$/i, '').trim();

        if (fsId && title) {
            items.push({
                id: `fs:${fsId}`,
                title,
                poster,
                url: absoluteUrl(href),
                quality,
                version,
                type,
            });
        }
    });

    // Check if there's a next page by looking at pagination
    const hasNext = items.length >= 18;

    const result = { items, hasNext };
    cache.set('catalog', cacheKey, result);
    return result;
}

/**
 * Search FS and find the best matching page for a given title + type + season.
 * Returns the page URL or null.
 */
async function findBestMatch(title, type, season) {
    const results = await searchFS(title);
    if (!results.length) return null;

    const normalizedTitle = normalizeForSearch(title);

    // Filter by type
    const typeFiltered = results.filter(r => {
        if (type === 'movie') return r.type === 'movie';
        if (type === 'series') return r.type === 'series';
        return true;
    });

    const candidates = typeFiltered.length > 0 ? typeFiltered : results;

    // For series, try to find the right season
    if (type === 'series' && season) {
        const seasonMatch = candidates.find(r => {
            const s = extractSeasonFromTitle(r.title);
            return s === season;
        });
        if (seasonMatch) return seasonMatch.url;
    }

    // Score matches by title similarity
    let bestMatch = candidates[0];
    let bestScore = 0;

    for (const candidate of candidates) {
        const candidateNorm = normalizeForSearch(cleanTitle(candidate.title));
        let score = 0;

        if (candidateNorm === normalizedTitle) {
            score = 100;
        } else if (candidateNorm.includes(normalizedTitle) || normalizedTitle.includes(candidateNorm)) {
            score = 80;
        } else {
            // Count common words
            const words1 = normalizedTitle.split(/\s+/);
            const words2 = candidateNorm.split(/\s+/);
            const common = words1.filter(w => words2.includes(w)).length;
            score = (common / Math.max(words1.length, words2.length)) * 60;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
        }
    }

    return bestMatch ? bestMatch.url : null;
}

/**
 * Scrape metadata from a FS page (film or series).
 * Returns { name, poster, background, description, year, genre, director, cast, trailer }
 */
async function scrapeMetadata(pageUrl) {
    const cached = cache.get('meta', pageUrl);
    if (cached) return cached;

    const response = await fetch(pageUrl, { headers: HEADERS });
    const html = await response.text();
    const $ = cheerio.load(html);

    const meta = {};

    // Title from og:title, <h1>, or <title>
    let rawTitle = $('meta[property="og:title"]').attr('content')?.replace(/\s+/g, ' ').trim()
        || $('h1').first().text().replace(/\s+/g, ' ').trim()
        || $('title').text().replace(/ - FrenchStream.*$/i, '').replace(/\s+/g, ' ').trim();
    const yearMatch = rawTitle.match(/\s*-\s*(\d{4})$/);
    if (yearMatch) {
        meta.year = parseInt(yearMatch[1]);
        rawTitle = rawTitle.replace(/\s*-\s*\d{4}$/, '').trim();
    }
    meta.name = rawTitle;

    // Poster & background
    const posterImg = $('.fmain .fposter img, .fpost img').first();
    meta.poster = posterImg.attr('src') || null;
    const bgImg = $('.fmain .fpost-img img, .full-img img').first();
    meta.background = bgImg.attr('src') || null;

    // Description — clean up prefix and normalize whitespace
    let desc = $('#s-desc').text().replace(/\s+/g, ' ').trim();
    desc = desc.replace(/^.*?sans inscription\s*/i, '').trim();
    meta.description = desc || $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() || '';

    // Info list (#s-list li items)
    $('#s-list li, .flist-col li').each((_, el) => {
        const text = $(el).text().trim();
        if (/^ann[ée]e/i.test(text) && !meta.year) {
            const y = text.match(/(\d{4})/);
            if (y) meta.year = parseInt(y[1]);
        } else if (/^genre/i.test(text)) {
            meta.genre = $(el).find('a').map((_, a) => $(a).text().trim()).get();
        } else if (/^r[ée]alisateur|^directeur/i.test(text)) {
            meta.director = $(el).find('a').map((_, a) => $(a).text().trim()).get();
        } else if (/^acteur|^cast/i.test(text)) {
            meta.cast = $(el).find('a').map((_, a) => $(a).text().trim()).get();
        }
    });

    // Trailer (YouTube)
    const trailerMatch = html.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/)
        || html.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/)
        || html.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (trailerMatch) {
        meta.trailers = [{ source: `ytid:${trailerMatch[1]}`, type: 'Trailer' }];
    }

    cache.set('meta', pageUrl, meta);
    return meta;
}

/**
 * Extract TMDB ID from a FS page via data-tagz attribute.
 * Returns { type: 'movie'|'tv', id: '1007734' } or null.
 */
async function scrapeTmdbId(pageUrl) {
    const cached = cache.get('tmdbid', pageUrl);
    if (cached !== undefined) return cached;

    const response = await fetch(pageUrl, { headers: HEADERS });
    const html = await response.text();
    const $ = cheerio.load(html);

    const tagz = $('[data-tagz]').attr('data-tagz') || '';
    const match = tagz.match(/^([fs])-(\d+)$/);
    const result = match ? { type: match[1] === 'f' ? 'movie' : 'tv', id: match[2] } : null;

    cache.set('tmdbid', pageUrl, result);
    console.log(`[TMDB] scrape ${pageUrl} → ${result ? tagz : 'no data-tagz'}`);
    return result;
}

module.exports = {
    searchFS,
    scrapeFilmPage,
    scrapeSeriesPage,
    scrapeCatalog,
    findBestMatch,
    scrapeMetadata,
    scrapeTmdbId,
};
