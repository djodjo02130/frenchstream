const fetch = require('node-fetch');
const cache = require('./cache');
const { HEADERS, getBaseUrl } = require('./utils');

// ── Utilities ────────────────────────────────────────────────────────────────

function rot13(str) {
    return str.replace(/[a-zA-Z]/g, c => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
}

function randomString(len) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Dean Edwards unpacker: detect and unpack eval(function(p,a,c,k,e,d){...})
 * Returns the unpacked JS string or null.
 */
function unpackDeanEdwards(html) {
    const packedMatch = html.match(
        /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'([^']+)'\.split\('\|'\)/s
    );
    if (!packedMatch) return null;

    const [, p, a, c, keywords] = packedMatch;
    const aNum = parseInt(a);
    const cNum = parseInt(c);
    const kWords = keywords.split('|');

    function baseEncode(val, base) {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (val < base) return chars[val] || '';
        return baseEncode(Math.floor(val / base), base) + (chars[val % base] || '');
    }

    let unpacked = p;
    for (let i = cNum - 1; i >= 0; i--) {
        const encoded = baseEncode(i, aNum) || '0';
        if (kWords[i]) {
            unpacked = unpacked.replace(new RegExp('\\b' + encoded + '\\b', 'g'), kWords[i]);
        }
    }

    return unpacked;
}

/**
 * Extract a source URL from common patterns in HTML/JS.
 */
function extractSourceFromHtml(text) {
    // Try file:"..." or source:"..." or src:"..."
    const patterns = [
        /file:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/,
        /source:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/,
        /src:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/,
        /sources:\s*\[\s*\{[^}]*src:\s*"([^"]+)"/,
        /sources:\s*\["([^"]+)"\]/,
    ];
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m && m[1] && m[1].startsWith('http')) return m[1];
    }
    return null;
}

// ── Individual resolvers ─────────────────────────────────────────────────────

/**
 * Uqload — extracts .mp4 from sources:["..."]
 */
async function resolveUqload(embedUrl) {
    const resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: embedUrl },
        redirect: 'follow',
    });
    const html = await resp.text();

    const m = html.match(/sources:\s*\["([^"]+)"\]/);
    if (m && m[1] && m[1].startsWith('http')) {
        return { url: m[1], headers: {} };
    }
    return null;
}

/**
 * Voe — follows JS redirect, decodes obfuscated JSON to get .m3u8
 * Chain: voe.sx → redirect domain → JSON decode → m3u8
 * Decoding: JSON array[0] → ROT13 → strip junk → base64 → char shift -3 → reverse + base64
 */
async function resolveVoe(embedUrl) {
    let resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: getBaseUrl() + '/' },
        redirect: 'follow',
    });
    let html = await resp.text();
    let finalUrl = resp.url;

    // Voe uses a JS redirect: window.location.href = 'https://otherdomain.com/e/...'
    const jsRedirect = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
    if (jsRedirect && jsRedirect[1]) {
        resp = await fetch(jsRedirect[1], {
            headers: { ...HEADERS, Referer: finalUrl },
            redirect: 'follow',
        });
        html = await resp.text();
        finalUrl = resp.url;
    }

    // Look for the JSON script block
    const jsonMatch = html.match(/<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    if (!jsonMatch) {
        const direct = extractSourceFromHtml(html);
        if (direct) return { url: direct, headers: { Referer: finalUrl } };
        return null;
    }

    try {
        // Step 1: Parse JSON (can be array or string)
        const raw = JSON.parse(jsonMatch[1]);
        const encoded = Array.isArray(raw) ? raw[0] : (typeof raw === 'string' ? raw : null);
        if (!encoded) return null;

        // Step 2: ROT13
        let decoded = rot13(encoded);

        // Step 3: Strip non-base64 junk (custom separators like ~@, ^^, %?, etc.)
        decoded = decoded.replace(/[^A-Za-z0-9+/=]/g, '');

        // Step 4: Base64 decode
        decoded = Buffer.from(decoded, 'base64').toString('utf8');

        // Step 5: Shift each char code by -3
        decoded = decoded.split('').map(c => String.fromCharCode(c.charCodeAt(0) - 3)).join('');

        // Step 6: Reverse the string, then base64 decode again
        decoded = decoded.split('').reverse().join('');
        decoded = Buffer.from(decoded, 'base64').toString('utf8');

        // Parse the final result as JSON
        let result;
        try {
            result = JSON.parse(decoded);
        } catch {
            if (decoded.startsWith('http')) {
                return { url: decoded.trim(), headers: { Referer: finalUrl } };
            }
            return null;
        }

        const sourceUrl = result.source || result.file || result.url;
        if (sourceUrl && sourceUrl.startsWith('http')) {
            return { url: sourceUrl, headers: { Referer: finalUrl } };
        }
    } catch (err) {
        console.error('[Resolver] Voe decode error:', err.message);
    }

    const direct = extractSourceFromHtml(html);
    if (direct) return { url: direct, headers: { Referer: finalUrl } };

    return null;
}

/**
 * Dood — constructs temporary .mp4 URL from pass_md5 endpoint
 * NOT cached because URLs are single-use/temporary.
 */
async function resolveDood(embedUrl) {
    const resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: embedUrl },
        redirect: 'follow',
    });
    const html = await resp.text();
    const finalUrl = resp.url;
    const baseHost = new URL(finalUrl).origin;

    // Extract pass_md5 path and token
    const passMatch = html.match(/\/pass_md5\/([^'"]+)/);
    const tokenMatch = html.match(/[?&]token=([a-zA-Z0-9]+)/);

    if (!passMatch) return null;

    const passPath = `/pass_md5/${passMatch[1]}`;
    const token = tokenMatch ? tokenMatch[1] : '';

    const passResp = await fetch(`${baseHost}${passPath}`, {
        headers: { ...HEADERS, Referer: finalUrl },
    });
    const partialUrl = await passResp.text();

    if (!partialUrl || !partialUrl.startsWith('http')) return null;

    const expiry = Date.now();
    const directUrl = `${partialUrl}${randomString(10)}?token=${token}&expiry=${expiry}`;

    return { url: directUrl, headers: { Referer: finalUrl } };
}

/**
 * Filmoon — unpacks Dean Edwards packed JS to get .m3u8
 */
async function resolveFilmoon(embedUrl) {
    // Filmoon may use an iframe redirect
    let resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: embedUrl },
        redirect: 'follow',
    });
    let html = await resp.text();
    let finalUrl = resp.url;

    // Check for iframe redirect
    const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
    if (iframeMatch && iframeMatch[1]) {
        const iframeUrl = iframeMatch[1].startsWith('http')
            ? iframeMatch[1]
            : new URL(iframeMatch[1], finalUrl).href;
        resp = await fetch(iframeUrl, {
            headers: { ...HEADERS, Referer: finalUrl },
            redirect: 'follow',
        });
        html = await resp.text();
        finalUrl = resp.url;
    }

    // Try Dean Edwards unpacker
    const unpacked = unpackDeanEdwards(html);
    if (unpacked) {
        const fileMatch = unpacked.match(/file:"([^"]+)"/);
        if (fileMatch && fileMatch[1] && fileMatch[1].startsWith('http')) {
            return { url: fileMatch[1], headers: { Referer: finalUrl } };
        }
    }

    // Fallback: try direct patterns in the original HTML
    const direct = extractSourceFromHtml(html);
    if (direct) return { url: direct, headers: { Referer: finalUrl } };

    return null;
}

/**
 * Vidzy — POST op=download1 to bypass countdown, then extract source
 */
async function resolveVidzy(embedUrl) {
    // First fetch to get the form parameters
    const resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: embedUrl },
        redirect: 'follow',
    });
    const html = await resp.text();
    const finalUrl = resp.url;

    // Try to extract source directly first (sometimes available without POST)
    let direct = extractSourceFromHtml(html);
    if (direct) return { url: direct, headers: { Referer: finalUrl } };

    // Try unpacking
    const unpacked = unpackDeanEdwards(html);
    if (unpacked) {
        direct = extractSourceFromHtml(unpacked);
        if (direct) return { url: direct, headers: { Referer: finalUrl } };
    }

    // Try POST form bypass (op=download1)
    const idMatch = html.match(/name="id"\s+value="([^"]+)"/);
    const fileId = idMatch ? idMatch[1] : null;

    if (fileId) {
        try {
            const postResp = await fetch(finalUrl, {
                method: 'POST',
                headers: {
                    ...HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Referer: finalUrl,
                },
                body: `op=download1&id=${fileId}&method_free=Free+Download`,
                redirect: 'follow',
            });
            const postHtml = await postResp.text();

            direct = extractSourceFromHtml(postHtml);
            if (direct) return { url: direct, headers: { Referer: finalUrl } };

            const postUnpacked = unpackDeanEdwards(postHtml);
            if (postUnpacked) {
                direct = extractSourceFromHtml(postUnpacked);
                if (direct) return { url: direct, headers: { Referer: finalUrl } };
            }
        } catch (err) {
            console.error('[Resolver] Vidzy POST error:', err.message);
        }
    }

    return null;
}

/**
 * FSvid/Premium — Dean Edwards packed JS → JWPlayer .m3u8
 * Token valid 24h, CORS open (Access-Control-Allow-Origin: *)
 */
async function resolvePremium(embedUrl) {
    // fsvid.lol blocks requests with self-referrer — use parent site
    const resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: getBaseUrl() + '/' },
        redirect: 'follow',
    });
    const html = await resp.text();
    const finalUrl = resp.url;

    // Try Dean Edwards unpacker (main path)
    const unpacked = unpackDeanEdwards(html);
    if (unpacked) {
        const direct = extractSourceFromHtml(unpacked);
        if (direct) return { url: direct, headers: {} };
    }

    // Fallback: try direct patterns in HTML
    const direct = extractSourceFromHtml(html);
    if (direct) return { url: direct, headers: {} };

    return null;
}

// ── Main resolver dispatch ───────────────────────────────────────────────────

const RESOLVER_MAP = {
    premium: resolvePremium,
    uqload: resolveUqload,
    voe: resolveVoe,
    dood: resolveDood,
    filmoon: resolveFilmoon,
    vidzy: resolveVidzy,
};

// Players that should NOT be cached (temporary URLs)
const NO_CACHE = new Set(['dood']);

/**
 * Resolve an embed URL to a direct video URL.
 * @param {string} embedUrl - The embed/player URL
 * @param {string} playerKey - The player key (e.g. 'vidzy', 'voe')
 * @returns {Promise<{ url: string, headers: object } | null>}
 */
async function resolve(embedUrl, playerKey) {
    const resolver = RESOLVER_MAP[playerKey];
    if (!resolver) return null;

    // Check cache (except for no-cache players)
    if (!NO_CACHE.has(playerKey)) {
        const cached = cache.get('resolved', embedUrl);
        if (cached) return cached;
    }

    try {
        const result = await resolver(embedUrl);
        if (result && !NO_CACHE.has(playerKey)) {
            cache.set('resolved', embedUrl, result);
        }
        return result;
    } catch (err) {
        console.error(`[Resolver] ${playerKey} failed for ${embedUrl}:`, err.message);
        return null;
    }
}

module.exports = { resolve };
