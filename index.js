const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { scrapeCatalog, scrapeFilmPage, scrapeSeriesPage, findBestMatch, searchFS, scrapeMetadata, scrapeTmdbId } = require('./lib/scraper');
const { resolveBaseUrl, getBaseUrl } = require('./lib/utils');
const { resolve } = require('./lib/resolvers');
const cache = require('./lib/cache');

// ── TMDB API key (from HA config or env) ────────────────────────────────────
let TMDB_API_KEY = process.env.TMDB_API_KEY || '';
try {
    const fs = require('fs');
    const options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    if (options.tmdb_api_key) TMDB_API_KEY = options.tmdb_api_key;
} catch {}
if (TMDB_API_KEY) console.log('[TMDB] API key configured');

const manifest = {
    id: 'org.frenchstream.addon',
    version: '1.10.4',
    name: 'French Stream',
    description: 'Films et Séries en streaming depuis FrenchStream',
    logo: 'https://fs9.lol/templates/starter/images/logo-fs.svg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    behaviorHints: { configurable: true },
    config: [
        {
            key: 'language',
            type: 'select',
            title: 'Langue des métadonnées (TMDB)',
            options: ['fr-FR', 'en-US', 'es-ES', 'de-DE', 'it-IT', 'pt-BR', 'nl-NL', 'pl-PL', 'ru-RU', 'ja-JP', 'ko-KR', 'zh-CN', 'ar-SA', 'tr-TR'],
            default: 'fr-FR',
        },
    ],
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
            const filtered = results.filter(r => (type === 'movie' ? r.type === 'movie' : r.type === 'series'));
            const metas = await resolveImdbIds(filtered.map(r => {
                const urlMatch = r.url.match(/\/(\d+)-/);
                const fsId = urlMatch ? urlMatch[1] : r.title;
                return { fsId, type, name: r.title, poster: r.poster, pageUrl: r.url };
            }), type);
            return { metas };
        }

        // Catalog browsing
        const category = type === 'movie' ? 'films' : 's-tv';
        const skip = extra && extra.skip ? parseInt(extra.skip) : 0;
        const page = Math.floor(skip / 18) + 1;

        console.log(`[Catalog] ${type} page ${page}`);
        const { items } = await scrapeCatalog(category, page);

        const metas = await resolveImdbIds(items.map(item => ({
            fsId: item.id.replace('fs:', ''),
            type,
            name: item.title,
            poster: item.poster,
            description: [item.quality, item.version].filter(Boolean).join(' - '),
            pageUrl: item.url,
        })), type);

        return { metas };
    } catch (err) {
        console.error('Catalog error:', err.message);
        return { metas: [] };
    }
});

// ── Meta handler ───────────────────────────────────────────────────────────

builder.defineMetaHandler(async ({ type, id, config }) => {
    const lang = (config && config.language) || 'fr-FR';
    console.log(`[Meta] Request: ${type} ${id} (${lang})`);
    try {
        await resolveBaseUrl();

        // ── Try TMDB (localized metadata) if API key configured ──
        if (TMDB_API_KEY) {
            let tmdbInfo = null;

            if (id.startsWith('tt')) {
                // IMDB ID → find TMDB type + ID
                tmdbInfo = await findTmdbInfoByImdb(id, type);
                if (tmdbInfo) console.log(`[Meta] TMDB find: ${id} → ${tmdbInfo.type}/${tmdbInfo.id}`);
            } else if (id.startsWith('fs:')) {
                // FS ID → scrape page for data-tagz → TMDB ID
                const baseId = id.split(':')[1];
                const pageUrl = await findFsPageUrl(baseId, type);
                if (pageUrl) {
                    tmdbInfo = await scrapeTmdbId(pageUrl);
                    if (tmdbInfo) console.log(`[Meta] TMDB scrape: fs:${baseId} → ${tmdbInfo.type}/${tmdbInfo.id}`);
                }
            }

            if (tmdbInfo) {
                const meta = await getMetaFromTmdb(tmdbInfo.type, tmdbInfo.id, lang);
                if (meta) {
                    return {
                        meta: {
                            id,
                            type,
                            name: meta.name,
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
                }
            }
        }

        // ── Fallback: tt IDs → let Cinemeta handle it ──
        const baseId = id.startsWith('fs:') ? id.split(':')[1] : null;
        if (!baseId) return { meta: null };

        // ── Fallback: fs: IDs → scrape FS page ──
        const pageUrl = await findFsPageUrl(baseId, type);
        if (!pageUrl) { console.log(`[Meta] Page not found for fs:${baseId}`); return { meta: null }; }

        const meta = await scrapeMetadata(pageUrl);
        console.log(`[Meta] Scraped: ${meta.name || baseId}`);

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

builder.defineStreamHandler(async ({ type, id, config }) => {
    const lang = (config && config.language) || 'fr-FR';
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
            streams = await getStreamsByImdbId(baseId, type, season, episode, lang);
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
        return await formatStreams(await scrapeFilmPage(pageUrl), pageUrl);
    } else {
        return await formatStreams(await scrapeSeriesPage(pageUrl, episode || 1), pageUrl);
    }
}

async function getStreamsByImdbId(imdbId, type, season, episode, lang) {
    // Get title from TMDB (if key configured) or Cinemeta
    let title = null;
    if (TMDB_API_KEY) {
        title = await getTitleFromTmdb(imdbId, type, lang);
        if (title) console.log(`[Stream] TMDB: ${imdbId} → "${title}"`);
    }
    if (!title) {
        title = await getTitleFromCinemeta(imdbId, type);
        if (title) console.log(`[Stream] Cinemeta: ${imdbId} → "${title}"`);
    }
    if (!title) { console.log(`[Stream] No title found for ${imdbId}`); return []; }

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

    return await formatStreams(rawStreams, pageUrl);
}

async function resolveImdbIds(items, type) {
    const results = await Promise.allSettled(
        items.map(async (item) => {
            let imdbId = null;

            // Try TMDB first if API key is configured
            if (TMDB_API_KEY && item.pageUrl) {
                try {
                    const tmdbInfo = await scrapeTmdbId(item.pageUrl);
                    if (tmdbInfo) {
                        imdbId = await tmdbToImdb(tmdbInfo.type, tmdbInfo.id);
                        if (imdbId) console.log(`[Resolve] "${item.name}" → TMDB ${tmdbInfo.type}/${tmdbInfo.id} → ${imdbId}`);
                    }
                } catch {}
            }

            // Fallback to Cinemeta title search
            if (!imdbId) {
                imdbId = await searchImdbId(item.name, type);
                if (imdbId) console.log(`[Resolve] "${item.name}" → Cinemeta → ${imdbId}`);
                else console.log(`[Resolve] "${item.name}" → not found`);
            }

            return {
                id: imdbId || `fs:${item.fsId}`,
                type,
                name: item.name,
                poster: item.poster,
                description: item.description,
            };
        })
    );
    const resolved = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const imdbCount = resolved.filter(r => r.id.startsWith('tt')).length;
    console.log(`[Catalog] ${resolved.length} items, ${imdbCount} IMDB resolved`);
    return resolved;
}

async function searchImdbId(title, type) {
    const cacheKey = `imdb:${type}:${title}`;
    const cached = cache.get('cinemeta', cacheKey);
    if (cached) return cached;

    const fetch = require('node-fetch');
    try {
        // Clean title: remove year, season info
        const cleanName = title.replace(/\s*\(?\d{4}\)?$/, '').replace(/\s*-?\s*saison\s*\d+/i, '').trim();
        const url = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(cleanName)}.json`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data.metas && data.metas.length > 0) {
            const imdbId = data.metas[0].id;
            cache.set('cinemeta', cacheKey, imdbId);
            return imdbId;
        }
    } catch {}
    return null;
}

async function tmdbToImdb(tmdbType, tmdbId) {
    const cacheKey = `tmdb:${tmdbType}:${tmdbId}`;
    const cached = cache.get('cinemeta', cacheKey);
    if (cached) return cached;

    const fetch = require('node-fetch');
    try {
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        const resp = await fetch(url);
        if (!resp.ok) { console.log(`[TMDB] API error ${resp.status} for ${tmdbType}/${tmdbId}`); return null; }
        const data = await resp.json();
        const imdbId = data.imdb_id;
        if (imdbId) cache.set('cinemeta', cacheKey, imdbId);
        return imdbId || null;
    } catch {
        return null;
    }
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

async function getTitleFromTmdb(imdbId, type, lang) {
    lang = lang || 'fr-FR';
    const cacheKey = `tmdb-title:${imdbId}:${lang}`;
    const cached = cache.get('cinemeta', cacheKey);
    if (cached) return cached;

    const fetch = require('node-fetch');
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=${lang}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        const results = type === 'movie' ? data.movie_results : data.tv_results;
        const title = results && results.length > 0 ? (results[0].title || results[0].name) : null;
        if (title) cache.set('cinemeta', cacheKey, title);
        return title;
    } catch {
        return null;
    }
}

/**
 * Find TMDB type + ID from an IMDB ID via TMDB find endpoint.
 * Returns { type: 'movie'|'tv', id: string } or null.
 */
async function findTmdbInfoByImdb(imdbId, stremioType) {
    const cacheKey = `tmdb-info:${imdbId}`;
    const cached = cache.get('cinemeta', cacheKey);
    if (cached) return cached;

    const fetch = require('node-fetch');
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        const movieResults = data.movie_results || [];
        const tvResults = data.tv_results || [];

        let result = null;
        if (stremioType === 'movie' && movieResults.length > 0) {
            result = { type: 'movie', id: String(movieResults[0].id) };
        } else if (stremioType === 'series' && tvResults.length > 0) {
            result = { type: 'tv', id: String(tvResults[0].id) };
        } else if (movieResults.length > 0) {
            result = { type: 'movie', id: String(movieResults[0].id) };
        } else if (tvResults.length > 0) {
            result = { type: 'tv', id: String(tvResults[0].id) };
        }

        if (result) cache.set('cinemeta', cacheKey, result);
        return result;
    } catch {
        return null;
    }
}

/**
 * Fetch full metadata from TMDB in the requested language.
 * tmdbType: 'movie' or 'tv', tmdbId: TMDB numeric ID string, lang: TMDB locale.
 * Returns a Stremio-compatible meta object or null.
 */
async function getMetaFromTmdb(tmdbType, tmdbId, lang) {
    lang = lang || 'fr-FR';
    const cacheKey = `tmdb-meta:${tmdbType}:${tmdbId}:${lang}`;
    const cached = cache.get('meta', cacheKey);
    if (cached) return cached;

    const fetch = require('node-fetch');
    try {
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=${lang}&append_to_response=credits,videos`;
        const resp = await fetch(url);
        if (!resp.ok) { console.log(`[TMDB] Meta API error ${resp.status} for ${tmdbType}/${tmdbId}`); return null; }
        const d = await resp.json();

        const meta = {
            name: d.title || d.name || null,
            poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
            background: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null,
            description: d.overview || '',
            genre: (d.genres || []).map(g => g.name),
        };

        // Year
        const dateStr = d.release_date || d.first_air_date || '';
        if (dateStr) meta.year = parseInt(dateStr.substring(0, 4));

        // Director (from credits.crew)
        if (d.credits && d.credits.crew) {
            meta.director = d.credits.crew
                .filter(c => c.job === 'Director')
                .map(c => c.name);
        }

        // Cast (top 10)
        if (d.credits && d.credits.cast) {
            meta.cast = d.credits.cast.slice(0, 10).map(c => c.name);
        }

        // Trailers (YouTube)
        if (d.videos && d.videos.results) {
            meta.trailers = d.videos.results
                .filter(v => v.type === 'Trailer' && v.site === 'YouTube')
                .map(v => ({ source: `ytid:${v.key}`, type: 'Trailer' }));
        }

        console.log(`[TMDB] Meta: ${tmdbType}/${tmdbId} → "${meta.name}"`);
        cache.set('meta', cacheKey, meta);
        return meta;
    } catch (err) {
        console.error(`[TMDB] Meta fetch error: ${err.message}`);
        return null;
    }
}

function titleFromPageUrl(pageUrl) {
    if (!pageUrl) return '';
    const match = pageUrl.match(/\/\d+-(.*?)\.html/);
    if (!match) return '';
    return match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function formatStreams(rawStreams, pageUrl) {
    console.log(`[Stream] Resolving ${rawStreams.length} streams...`);
    const fsTitle = titleFromPageUrl(pageUrl);
    const results = await Promise.allSettled(
        rawStreams.map(async (s) => {
            const resolved = await resolve(s.url, s.player);
            const name = s.playerName;
            const title = fsTitle ? `${s.lang} - ${fsTitle}` : s.lang;

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
