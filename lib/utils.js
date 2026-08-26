const fetch = require('node-fetch');

const LANDING_URL = 'https://fstream.info/';
let BASE_URL = 'https://fs16.lol'; // fallback, updated dynamically

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
    // FS anti-bot challenge: challenge page sets this cookie via JS then reloads. Send it directly.
    'Cookie': 'fsschal=1',
};

/**
 * Extract the FS mirror URL from a landing/gateway page.
 *
 * Trois formats rencontres :
 *   - passerelle : `var FS_MIRROR="https://fs16.lol";`
 *   - fstream.info (2026-08) : `<a id="mainUrl" href="#" onclick="location.href='...'">`
 *   - ancien format : `<a id="mainUrl" href="https://fsXX.lol">`
 *
 * Retourne null si la page ne contient aucun marqueur (= c'est deja le vrai site).
 */
function parseMirrorFromHtml(html) {
    if (!html) return null;

    const clean = (url) => {
        if (!url || !/^https?:\/\//i.test(url)) return null;
        return url.replace(/\/+$/, '');
    };

    // 1. Gateway pages expose the mirror in a JS var.
    const mirrorVar = html.match(/FS_MIRROR\s*=\s*["']([^"']+)["']/);
    if (mirrorVar) {
        const url = clean(mirrorVar[1]);
        if (url) return url;
    }

    // 2. <a ... id="mainUrl" ...> — attribute order varies, so grab the whole tag first.
    const anchor = html.match(/<a\b[^>]*\bid=["']mainUrl["'][^>]*>/i);
    if (anchor) {
        const tag = anchor[0];
        // onclick redirect wins: href is often just "#".
        const onclick = tag.match(/location\.href\s*=\s*["']([^"']+)["']/i);
        if (onclick) {
            const url = clean(onclick[1]);
            if (url) return url;
        }
        const href = tag.match(/\bhref=["']([^"']+)["']/i);
        if (href) {
            const url = clean(href[1]);
            if (url) return url;
        }
    }

    return null;
}

/**
 * Fetch the current FS base URL, following the landing -> gateway -> mirror chain.
 * Caches for 1 hour.
 */
let _cachedBaseUrl = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_HOPS = 3;

async function resolveBaseUrl() {
    const now = Date.now();
    if (_cachedBaseUrl && (now - _cacheTime) < CACHE_TTL) {
        return _cachedBaseUrl;
    }

    let url = LANDING_URL;
    let resolved = null;

    try {
        for (let hop = 0; hop < MAX_HOPS; hop++) {
            const resp = await fetch(url, {
                headers: { 'User-Agent': HEADERS['User-Agent'], 'Cookie': HEADERS['Cookie'] },
                timeout: 5000,
            });
            const html = await resp.text();
            const next = parseMirrorFromHtml(html);
            // No marker left = this page is the real site.
            if (!next || next === resolved) break;
            resolved = next;
            url = next;
        }
    } catch (err) {
        console.error('[FS] Failed to resolve base URL:', err.message);
    }

    if (resolved) {
        _cachedBaseUrl = resolved;
        _cacheTime = now;
        BASE_URL = resolved;
        console.log(`[FS] Base URL resolved: ${BASE_URL}`);
        return resolved;
    }

    console.error(`[FS] Base URL unresolved, using fallback: ${BASE_URL}`);
    return BASE_URL; // fallback
}

function getBaseUrl() {
    return BASE_URL;
}

const PLAYER_NAMES = {
    premium: 'FSvid',
    vidzy: 'Vidzy',
    uqload: 'Uqload',
    dood: 'Dood',
    voe: 'Voe',
    filmoon: 'Filmoon',
    netu: 'Netu',
};

const LANG_SUFFIXES = {
    '': 'VF',
    'vostfr': 'VOSTFR',
    'vff': 'VFF',
    'vfq': 'VFQ',
};

function absoluteUrl(path) {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return getBaseUrl() + (path.startsWith('/') ? '' : '/') + path;
}

function extractIdFromUrl(url) {
    // Extract FS numeric ID from URL like /films/15124302-slug.html, /s-tv/15124117-slug.html, or /index.php?newsid=15124302
    const match = url.match(/\/(\d+)-/) || url.match(/[?&]newsid=(\d+)/);
    return match ? match[1] : null;
}

function cleanTitle(title) {
    if (!title) return '';
    return title
        .replace(/\s*-\s*Saison\s*\d+/i, '')
        .replace(/\s*-\s*\d{4}$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractSeasonFromTitle(title) {
    const match = title.match(/Saison\s*(\d+)/i);
    return match ? parseInt(match[1]) : null;
}

function normalizeForSearch(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
}

module.exports = {
    get BASE_URL() { return BASE_URL; },
    HEADERS,
    PLAYER_NAMES,
    LANG_SUFFIXES,
    resolveBaseUrl,
    parseMirrorFromHtml,
    getBaseUrl,
    absoluteUrl,
    extractIdFromUrl,
    cleanTitle,
    extractSeasonFromTitle,
    normalizeForSearch,
};
