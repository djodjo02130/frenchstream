const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { scrapeCatalog, scrapeFilmPage, scrapeSeriesPage, findBestMatch, searchFS } = require('./lib/scraper');
const { resolveBaseUrl, getBaseUrl } = require('./lib/utils');
const cache = require('./lib/cache');

const manifest = {
    id: 'org.frenchstream.addon',
    version: '1.0.2',
    name: 'French Stream',
    description: 'Films et Séries en streaming depuis FrenchStream',
    logo: 'https://fs9.lol/templates/starter/images/logo-fs.svg',
    resources: ['catalog', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'movie',
            id: 'frenchstream-films',
            name: 'FrenchStream - Films',
            extra: [
                { name: 'skip', isRequired: false },
                { name: 'search', isRequired: false },
            ],
        },
        {
            type: 'series',
            id: 'frenchstream-series',
            name: 'FrenchStream - Séries',
            extra: [
                { name: 'skip', isRequired: false },
                { name: 'search', isRequired: false },
            ],
        },
    ],
    idPrefixes: ['tt', 'fs:'],
};

const builder = new addonBuilder(manifest);

// ── Catalog handler ─────────────────────────────────────────────────────────

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        await resolveBaseUrl();
        // Handle search
        if (extra && extra.search) {
            const results = await searchFS(extra.search);
            const metas = results
                .filter(r => (type === 'movie' ? r.type === 'movie' : r.type === 'series'))
                .map(r => {
                    const urlMatch = r.url.match(/\/(\d+)-/);
                    const fsId = urlMatch ? urlMatch[1] : r.title;
                    return {
                        id: `fs:${fsId}`,
                        type,
                        name: r.title,
                        poster: r.poster,
                    };
                });
            return { metas };
        }

        // Catalog browsing
        const category = type === 'movie' ? 'films' : 's-tv';
        const skip = extra && extra.skip ? parseInt(extra.skip) : 0;
        const page = Math.floor(skip / 18) + 1;

        const { items } = await scrapeCatalog(category, page);

        const metas = items.map(item => ({
            id: item.id,
            type,
            name: item.title,
            poster: item.poster,
            description: [item.quality, item.version].filter(Boolean).join(' - '),
        }));

        return { metas };
    } catch (err) {
        console.error('Catalog error:', err.message);
        return { metas: [] };
    }
});

// ── Stream handler ──────────────────────────────────────────────────────────

builder.defineStreamHandler(async ({ type, id }) => {
    try {
        await resolveBaseUrl();
        // Parse the ID: can be "fs:12345", "fs:12345:1:3", "tt1234567", "tt1234567:1:3"
        let baseId, season, episode;
        const parts = id.split(':');

        if (id.startsWith('fs:')) {
            baseId = parts[1];
            season = parts[2] ? parseInt(parts[2]) : null;
            episode = parts[3] ? parseInt(parts[3]) : null;
        } else {
            baseId = parts[0];
            season = parts[1] ? parseInt(parts[1]) : null;
            episode = parts[2] ? parseInt(parts[2]) : null;
        }

        let streams = [];

        if (id.startsWith('fs:')) {
            streams = await getStreamsByFsId(baseId, type, season, episode);
        } else if (id.startsWith('tt')) {
            streams = await getStreamsByImdbId(baseId, type, season, episode);
        }

        return { streams };
    } catch (err) {
        console.error('Stream error:', err.message);
        return { streams: [] };
    }
});

async function getStreamsByFsId(fsId, type, season, episode) {
    const { HEADERS } = require('./lib/utils');
    const fetch = require('node-fetch');
    const baseUrl = await resolveBaseUrl();

    // Try multiple URL patterns since FS uses different path prefixes
    const pathPrefixes = type === 'movie'
        ? [`/films/${fsId}-`, `/${fsId}-`]
        : [`/s-tv/${fsId}-`, `/${fsId}-`];

    for (const pathPrefix of pathPrefixes) {
        try {
            const testUrl = `${baseUrl}${pathPrefix}.html`;
            const resp = await fetch(testUrl, { headers: HEADERS, redirect: 'follow' });
            if (resp.ok) {
                const pageUrl = resp.url;
                if (type === 'movie') {
                    return formatStreams(await scrapeFilmPage(pageUrl));
                } else {
                    return formatStreams(await scrapeSeriesPage(pageUrl, episode || 1));
                }
            }
        } catch {}
    }

    return [];
}

async function getStreamsByImdbId(imdbId, type, season, episode) {
    // Use cinemeta to get the title for this IMDB ID
    const title = await getTitleFromCinemeta(imdbId, type);
    if (!title) return [];

    // Find the best matching page on FS
    const pageUrl = await findBestMatch(title, type, season);
    if (!pageUrl) return [];

    let rawStreams;
    if (type === 'movie') {
        rawStreams = await scrapeFilmPage(pageUrl);
    } else {
        rawStreams = await scrapeSeriesPage(pageUrl, episode || 1);
    }

    return formatStreams(rawStreams);
}

async function getTitleFromCinemeta(imdbId, type) {
    const cacheKey = `${type}:${imdbId}`;
    const cached = cache.get('cinemeta', cacheKey);
    if (cached) return cached;

    const fetch = require('node-fetch');
    try {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        const title = data.meta ? data.meta.name : null;
        if (title) cache.set('cinemeta', cacheKey, title);
        return title;
    } catch {
        return null;
    }
}

function formatStreams(rawStreams) {
    return rawStreams.map(s => ({
        name: `[${s.lang}] ${s.playerName}`,
        title: `${s.playerName} - ${s.lang}`,
        url: s.url,
        externalUrl: s.url,
    }));
}

// ── Start server ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 7000;

// Resolve the current FS base URL from fstream.info, then start the server
resolveBaseUrl().then(() => {
    serveHTTP(builder.getInterface(), { port: PORT });
    console.log(`FrenchStream addon running at http://localhost:${PORT}/manifest.json`);
    console.log(`Using FS base URL: ${getBaseUrl()}`);
});
