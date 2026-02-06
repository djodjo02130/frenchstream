const fetch = require('node-fetch');

const LANDING_URL = 'https://fstream.info/';
let BASE_URL = 'https://fs9.lol'; // fallback, updated dynamically

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
};

/**
 * Fetch the current FS base URL from fstream.info landing page.
 * The URL is in: <a id="mainUrl" href="https://fsXX.lol">
 * Caches for 1 hour.
 */
let _cachedBaseUrl = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function resolveBaseUrl() {
    const now = Date.now();
    if (_cachedBaseUrl && (now - _cacheTime) < CACHE_TTL) {
        return _cachedBaseUrl;
    }

    try {
        const resp = await fetch(LANDING_URL, {
            headers: { 'User-Agent': HEADERS['User-Agent'] },
            timeout: 5000,
        });
        const html = await resp.text();
        const match = html.match(/href="([^"]+)"[^>]*id="mainUrl"/);
        if (match && match[1]) {
            _cachedBaseUrl = match[1].replace(/\/+$/, '');
            _cacheTime = now;
            BASE_URL = _cachedBaseUrl;
            console.log(`[FS] Base URL resolved: ${BASE_URL}`);
            return _cachedBaseUrl;
        }
    } catch (err) {
        console.error('[FS] Failed to resolve base URL:', err.message);
    }

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
    // Extract FS numeric ID from URL like /films/15124302-slug.html or /s-tv/15124117-slug.html
    const match = url.match(/\/(\d+)-/);
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
    getBaseUrl,
    absoluteUrl,
    extractIdFromUrl,
    cleanTitle,
    extractSeasonFromTitle,
    normalizeForSearch,
};
