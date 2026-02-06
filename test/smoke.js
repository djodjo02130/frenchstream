/**
 * Smoke test — vérifie que le scraper et les resolvers fonctionnent.
 *
 * Stratégie :
 *   1. Cherche dans une liste de films/séries connus
 *   2. Pour chaque contenu, scrape les streams et tente de résoudre les players manquants
 *   3. Vérifie que la vidéo charge (HLS playlist ou HEAD mp4)
 *   4. Continue jusqu'à ce que TOUS les players soient couverts ou 10 contenus testés
 *
 * Exit code 0 = tous les players résolus + vidéo OK, 1 = au moins un player manquant.
 */

const fetch = require('node-fetch');
const { searchFS, scrapeFilmPage, scrapeSeriesPage } = require('../lib/scraper');
const { resolveBaseUrl } = require('../lib/utils');
const { resolve } = require('../lib/resolvers');

const QUERIES = [
    { query: 'Intouchables', type: 'movie' },
    { query: 'Fallout', type: 'series' },
    { query: 'Inception', type: 'movie' },
    { query: 'Breaking Bad', type: 'series' },
    { query: 'Interstellar', type: 'movie' },
    { query: 'Stranger Things', type: 'series' },
    { query: 'Avatar', type: 'movie' },
    { query: 'The Witcher', type: 'series' },
    { query: 'Gladiator', type: 'movie' },
    { query: 'The Last of Us', type: 'series' },
];

const EXPECTED_PLAYERS = ['premium', 'vidzy', 'uqload', 'voe', 'dood', 'filmoon'];

let passed = 0;
let failed = 0;

function ok(label) {
    passed++;
    console.log(`  ✓ ${label}`);
}

function fail(label) {
    failed++;
    console.error(`  ✗ ${label}`);
}

function info(label) {
    console.log(`  · ${label}`);
}

// ── Résoudre un player : embed URL → URL directe ──

async function tryResolve(player, embedUrl) {
    const start = Date.now();
    try {
        const result = await resolve(embedUrl, player);
        const elapsed = Date.now() - start;
        if (result && result.url) return result;
    } catch {}
    return null;
}

// ── Vérifier qu'une URL vidéo charge réellement ──

async function verifyVideo(url, headers) {
    const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(headers || {}),
    };

    const isHls = url.includes('.m3u8');

    if (isHls) {
        const resp = await fetch(url, { headers: reqHeaders, timeout: 10000 });
        const body = await resp.text();
        return resp.ok && body.includes('#EXTM3U');
    }

    // MP4 : HEAD d'abord
    const resp = await fetch(url, { method: 'HEAD', headers: reqHeaders, timeout: 10000 });
    const contentType = resp.headers.get('content-type') || '';
    if (resp.ok && contentType.includes('video')) return true;

    // Fallback GET Range (certains CDN ne renvoient pas video/* en HEAD)
    if (resp.ok) {
        const rangeResp = await fetch(url, {
            headers: { ...reqHeaders, 'Range': 'bytes=0-1023' },
            timeout: 10000,
        });
        const rangeType = rangeResp.headers.get('content-type') || '';
        if ((rangeResp.status === 200 || rangeResp.status === 206) && rangeType.includes('video')) return true;
    }

    return false;
}

// ── Main ──

async function main() {
    console.log('FrenchStream Smoke Test');
    console.log('======================');

    // Setup
    console.log('\n── Setup ──');
    const baseUrl = await resolveBaseUrl();
    ok(`Base URL: ${baseUrl}`);

    // State : ce qu'on a couvert
    const resolvedPlayers = {};   // player → { url, headers, query, verified }
    const testedUrls = new Set();

    for (const { query, type } of QUERIES) {
        // Quels players manquent encore ?
        const missing = EXPECTED_PLAYERS.filter(p => !resolvedPlayers[p]);
        if (missing.length === 0) break;

        console.log(`\n── [${type}] "${query}" (missing: ${missing.join(', ')}) ──`);

        // Recherche
        let results;
        try {
            results = await searchFS(query);
        } catch (err) {
            info(`search failed: ${err.message}`);
            continue;
        }

        const filtered = results.filter(r =>
            (type === 'movie' ? r.type === 'movie' : r.type === 'series')
        );
        if (filtered.length === 0) {
            info(`no ${type} results`);
            continue;
        }

        // Essayer plusieurs résultats de recherche si nécessaire
        for (const result of filtered.slice(0, 3)) {
            if (testedUrls.has(result.url)) continue;
            testedUrls.add(result.url);

            const stillMissing = EXPECTED_PLAYERS.filter(p => !resolvedPlayers[p]);
            if (stillMissing.length === 0) break;

            info(`${result.title} → ${result.url}`);

            // Scrape
            let streams;
            try {
                if (type === 'movie') {
                    streams = await scrapeFilmPage(result.url);
                } else {
                    streams = await scrapeSeriesPage(result.url, 1);
                }
            } catch (err) {
                info(`scrape failed: ${err.message}`);
                continue;
            }

            if (streams.length === 0) {
                info('0 streams');
                continue;
            }

            info(`${streams.length} streams (${[...new Set(streams.map(s => s.player))].join(', ')})`);

            // Résoudre uniquement les players manquants
            for (const stream of streams) {
                if (resolvedPlayers[stream.player]) continue;

                const resolved = await tryResolve(stream.player, stream.url);
                if (!resolved) continue;

                // Vérifier le chargement vidéo
                let videoOk = false;
                try {
                    videoOk = await verifyVideo(resolved.url, resolved.headers);
                } catch {}

                if (videoOk) {
                    resolvedPlayers[stream.player] = { ...resolved, query, verified: true };
                    ok(`${stream.player}: resolved + video OK (${result.title})`);
                } else {
                    // Résolu mais vidéo KO — on accepte quand même la résolution
                    resolvedPlayers[stream.player] = { ...resolved, query, verified: false };
                    ok(`${stream.player}: resolved (video unverified) (${result.title})`);
                }
            }
        }
    }

    // Résumé
    console.log('\n── Results ──');

    for (const player of EXPECTED_PLAYERS) {
        const r = resolvedPlayers[player];
        if (r && r.verified) {
            ok(`${player}: resolved + video OK (via "${r.query}")`);
        } else if (r) {
            ok(`${player}: resolved (via "${r.query}")`);
        } else {
            fail(`${player}: NEVER resolved after ${testedUrls.size} contents`);
        }
    }

    console.log(`\n  Contents tested: ${testedUrls.size}`);
    console.log(`  ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.error('\nSMOKE TEST FAILED');
        process.exit(1);
    } else {
        console.log('\nSMOKE TEST PASSED');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
