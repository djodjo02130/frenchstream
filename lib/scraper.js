const fetch = require('node-fetch');
const cheerio = require('cheerio');
const cache = require('./cache');
const utils = require('./utils');
const { HEADERS, PLAYER_NAMES, LANG_SUFFIXES, absoluteUrl, extractIdFromUrl, cleanTitle, extractSeasonFromTitle, normalizeForSearch, resolveBaseUrl } = utils;

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
 * Scrape a film page and extract all stream URLs.
 * Returns array of { playerName, lang, url }
 */
async function scrapeFilmPage(pageUrl) {
    const cached = cache.get('streams', pageUrl);
    if (cached) return cached;

    const response = await fetch(pageUrl, { headers: HEADERS });
    const html = await response.text();
    const $ = cheerio.load(html);

    const filmData = $('#film-data');
    if (!filmData.length) return [];

    const streams = [];
    const playerKeys = ['premium', 'vidzy', 'uqload', 'dood', 'voe', 'filmoon'];

    for (const player of playerKeys) {
        for (const [suffix, lang] of Object.entries(LANG_SUFFIXES)) {
            const attr = `data-${player}${suffix}`;
            let url = filmData.attr(attr);
            if (!url || !url.trim()) continue;
            url = url.trim();

            // Netu stores bare video IDs - build the full embed URL
            if (player === 'netu' && !url.startsWith('http')) {
                url = `https://1.multiup.us/player/embed_player.php?vid=${url}&autoplay=no`;
            }

            if (!url.startsWith('http')) continue;

            streams.push({
                player,
                playerName: PLAYER_NAMES[player] || player,
                lang,
                url,
            });
        }
    }

    cache.set('streams', pageUrl, streams);
    return streams;
}

/**
 * Scrape a series page and extract stream URLs for a specific episode.
 * Series pages store episode data in HTML elements:
 *   #episodes-vf-data > div[data-ep][data-vidzy][data-uqload][data-netu][data-voe]
 *   #episodes-vostfr-data > div[data-ep][...]
 * Returns array of { playerName, lang, url }
 */
async function scrapeSeriesPage(pageUrl, episode) {
    const cacheKey = `${pageUrl}:ep${episode}`;
    const cached = cache.get('streams', cacheKey);
    if (cached) return cached;

    const response = await fetch(pageUrl, { headers: HEADERS });
    const html = await response.text();
    const $ = cheerio.load(html);

    const streams = [];
    const epStr = String(episode);
    const playerKeys = ['vidzy', 'uqload', 'voe', 'dood', 'filmoon', 'premium'];

    const langContainers = {
        'VF': '#episodes-vf-data',
        'VOSTFR': '#episodes-vostfr-data',
        'VO': '#episodes-vo-data',
    };

    for (const [lang, selector] of Object.entries(langContainers)) {
        const container = $(selector);
        if (!container.length) continue;

        // Find the episode element by data-ep attribute
        const epEl = container.find(`[data-ep="${epStr}"]`);
        if (!epEl.length) continue;

        for (const player of playerKeys) {
            const url = epEl.attr(`data-${player}`);
            if (url && url.trim()) {
                streams.push({
                    player,
                    playerName: PLAYER_NAMES[player] || player.charAt(0).toUpperCase() + player.slice(1),
                    lang,
                    url: url.trim(),
                });
            }
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

module.exports = {
    searchFS,
    scrapeFilmPage,
    scrapeSeriesPage,
    scrapeCatalog,
    findBestMatch,
};
