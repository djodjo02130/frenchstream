const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { scrapeCatalog, scrapeFilmPage, scrapeSeriesPage, findBestMatch, searchFS, scrapeMetadata } = require('./lib/scraper');
const { resolveBaseUrl, getBaseUrl } = require('./lib/utils');
const { resolve } = require('./lib/resolvers');
const cache = require('./lib/cache');

const manifest = {
    id: 'org.frenchstream.addon',
    version: '1.3.2',
    name: 'French Stream',
    description: 'Films et Séries en streaming depuis FrenchStream',
    logo: 'https://fs9.lol/templates/starter/images/logo-fs.svg',
    resources: ['catalog', 'meta', 'stream'],
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
            console.log(`[Search] "${extra.search}" (${type})`);
            const results = await searchFS(extra.search);
            console.log(`[Search] ${results.length} results`);
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

// ── Meta handler ───────────────────────────────────────────────────────────

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[Meta] Request: ${type} ${id}`);
    try {
        await resolveBaseUrl();
        const baseId = id.startsWith('fs:') ? id.split(':')[1] : null;
        if (!baseId) return { meta: null };

        const pageUrl = await findFsPageUrl(baseId, type);
        if (!pageUrl) { console.log(`[Meta] Page not found for fs:${baseId}`); return { meta: null }; }

        const meta = await scrapeMetadata(pageUrl);
        console.log(`[Meta] ${meta.name || baseId}`);

        return {
            meta: {
                id,
                type,
                name: meta.name || baseId,
                poster: meta.poster || null,
                background: meta.background || null,
                description: meta.description || '',
                year: meta.year || undefined,
                genre: meta.genre || [],
                director: meta.director || [],
                cast: meta.cast || [],
                trailers: meta.trailers || [],
            },
        };
    } catch (err) {
        console.error('[Meta] Error:', err.message);
        return { meta: null };
    }
});

async function findFsPageUrl(fsId, type) {
    const cacheKey = `${type}:${fsId}`;
    const cached = cache.get('pageurl', cacheKey);
    if (cached) return cached;

    const { HEADERS } = require('./lib/utils');
    const fetch = require('node-fetch');
    const baseUrl = await resolveBaseUrl();

    const pathPrefixes = type === 'movie'
        ? [`/films/${fsId}-`, `/${fsId}-`]
        : [`/s-tv/${fsId}-`, `/${fsId}-`];

    for (const pathPrefix of pathPrefixes) {
        try {
            const testUrl = `${baseUrl}${pathPrefix}.html`;
            const resp = await fetch(testUrl, { headers: HEADERS, redirect: 'follow' });
            if (resp.ok) {
                cache.set('pageurl', cacheKey, resp.url);
                return resp.url;
            }
        } catch {}
    }
    return null;
}

// ── Stream handler ──────────────────────────────────────────────────────────

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[Stream] Request: ${type} ${id}`);
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
    const pageUrl = await findFsPageUrl(fsId, type);
    if (!pageUrl) return [];

    if (type === 'movie') {
        return await formatStreams(await scrapeFilmPage(pageUrl));
    } else {
        return await formatStreams(await scrapeSeriesPage(pageUrl, episode || 1));
    }
}

async function getStreamsByImdbId(imdbId, type, season, episode) {
    // Use cinemeta to get the title for this IMDB ID
    const title = await getTitleFromCinemeta(imdbId, type);
    if (!title) { console.log(`[Stream] Cinemeta: no title for ${imdbId}`); return []; }
    console.log(`[Stream] Cinemeta: ${imdbId} → "${title}"`);

    // Find the best matching page on FS
    const pageUrl = await findBestMatch(title, type, season);
    if (!pageUrl) { console.log(`[Stream] No match on FS for "${title}"`); return []; }
    console.log(`[Stream] Matched: ${pageUrl}`);

    let rawStreams;
    if (type === 'movie') {
        rawStreams = await scrapeFilmPage(pageUrl);
    } else {
        rawStreams = await scrapeSeriesPage(pageUrl, episode || 1);
    }

    return await formatStreams(rawStreams);
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

async function formatStreams(rawStreams) {
    console.log(`[Stream] Resolving ${rawStreams.length} streams...`);
    const results = await Promise.allSettled(
        rawStreams.map(async (s) => {
            const resolved = await resolve(s.url, s.player);
            const name = `[${s.lang}] ${s.playerName}`;
            const title = `${s.playerName} - ${s.lang}`;

            if (resolved) {
                const isHls = resolved.url.includes('.m3u8');
                const stream = {
                    name,
                    title,
                    url: resolved.url,
                    behaviorHints: {},
                };
                if (isHls) {
                    stream.behaviorHints.notWebReady = true;
                }
                if (resolved.headers && Object.keys(resolved.headers).length > 0) {
                    stream.behaviorHints.proxyHeaders = { request: resolved.headers };
                }
                return stream;
            }

            // Resolver failed or video dead — skip this stream
            console.log(`[Stream] ${s.player} ${s.lang} skipped (resolve failed): ${s.url}`);
            return null;
        })
    );

    return results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
}

// ── Start server ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 7000;

// Resolve the current FS base URL from fstream.info, then start the server
resolveBaseUrl().then(() => {
    serveHTTP(builder.getInterface(), { port: PORT });
    console.log(`FrenchStream addon running at http://localhost:${PORT}/manifest.json`);
    console.log(`Using FS base URL: ${getBaseUrl()}`);
});
