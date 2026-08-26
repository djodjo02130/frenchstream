const crypto = require('crypto');
const vm = require('vm');
const nodeFetch = require('node-fetch');
const cache = require('./cache');
const { HEADERS, getBaseUrl } = require('./utils');

const FETCH_TIMEOUT = 5000;

function fetch(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    return nodeFetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Utilities ────────────────────────────────────────────────────────────────

function hostOf(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

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

// FSvid/Vidzy serve this decoy when the decode key doesn't match the embed host.
const DECOY_SOURCE = /\/troll\/master\.m3u8/i;

/**
 * Extract an obfuscated `src:(function(s){...})("<blob>")` IIFE, paren-matched.
 * Returns the IIFE source (call included) or null.
 */
function extractObfuscatedIife(js) {
    const re = /(?:src|file|source)\s*:\s*(\(\s*function\b)/g;
    let m;
    while ((m = re.exec(js))) {
        const open = m.index + m[0].length - m[1].length; // index of the '('
        let depth = 0;
        let i = open;
        for (; i < js.length; i++) {
            if (js[i] === '(') depth++;
            else if (js[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        }
        if (depth !== 0) continue;
        const arg = js.slice(i).match(/^\s*\(\s*(["'])([\s\S]*?)\1\s*\)/);
        if (arg) return js.slice(open, i) + '(' + JSON.stringify(arg[2]) + ')';
    }
    return null;
}

/**
 * Decode the obfuscated player source.
 *
 * FSvid/Vidzy no longer emit `src:"<url>"`. `src` is an IIFE that base64-decodes
 * a blob, reverses it and XORs it with a key seeded by `location.hostname`,
 * falling back to DECOY_SOURCE when the host doesn't match. The constants change
 * between deploys, so evaluate the IIFE in a sandbox instead of reimplementing it.
 *
 * @param {string} js - player JS (unpacked or raw HTML)
 * @param {string} hostname - host of the embed page, used as the decode key
 * @returns {string|null} the direct URL, or null
 */
function decodeObfuscatedSource(js, hostname) {
    if (!js || !hostname) return null;
    const iife = extractObfuscatedIife(js);
    if (!iife) return null;

    // Bare context: no require, no process, no network — only what the snippet needs.
    const sandbox = {
        location: { hostname, host: hostname, href: `https://${hostname}/` },
        atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    };
    try {
        vm.createContext(sandbox);
        const out = vm.runInContext(iife, sandbox, { timeout: 1000 });
        if (typeof out === 'string' && /^https?:\/\//.test(out) && !DECOY_SOURCE.test(out)) {
            return out;
        }
    } catch (err) {
        console.error('[Resolver] obfuscated src decode failed:', err.message);
    }
    return null;
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
        if (m && m[1] && m[1].startsWith('http') && !DECOY_SOURCE.test(m[1])) return m[1];
    }
    return null;
}

// ── Individual resolvers ─────────────────────────────────────────────────────

/**
 * Uqload — source is inside Dean Edwards packed JS: sources:[{file:"<m3u8>"}]
 * (older builds emitted a bare sources:["<mp4>"] in the raw HTML).
 */
async function resolveUqload(embedUrl) {
    const resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: embedUrl },
        redirect: 'follow',
    });
    const html = await resp.text();

    const m = html.match(/sources:\s*\["([^"]+)"\]/);
    if (m && m[1] && m[1].startsWith('http')) {
        return { url: m[1], headers: { Referer: embedUrl } };
    }

    const unpacked = unpackDeanEdwards(html);
    if (unpacked) {
        const direct = extractSourceFromHtml(unpacked);
        if (direct) return { url: direct, headers: { Referer: embedUrl } };
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

function b64urlToBuffer(str) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Filmoon (legacy backend, e.g. bysebuho.com) — 5-step API flow with AES-256-GCM.
 * Flow: details → settings → challenge → attest (ECDSA P-256) → playback → decrypt
 *
 * Still live on some player domains; the newer ones expose POST /api/stream instead.
 */
async function resolveFilmoonLegacy(finalEmbedUrl, videoCode) {
    const embedOrigin = new URL(finalEmbedUrl).origin;

    const apiHeaders = { ...HEADERS, Accept: 'application/json' };

    // Step 1: GET details → get embed_frame_url (player domain)
    const detailsResp = await fetch(`${embedOrigin}/api/videos/${videoCode}/embed/details`, {
        headers: { ...apiHeaders, Referer: finalEmbedUrl, 'x-embed-parent': finalEmbedUrl },
    });
    const details = await detailsResp.json();
    if (!details.embed_frame_url) { console.log(`[Filmoon] ${videoCode}: ${details.error || 'no embed_frame_url'}`); return null; }

    const playerUrl = details.embed_frame_url;
    const playerOrigin = new URL(playerUrl).origin;
    console.log(`[Filmoon] ${videoCode}: player=${playerOrigin}`);

    // Step 2: GET settings (needed for session establishment)
    await fetch(`${playerOrigin}/api/videos/${videoCode}/embed/settings`, {
        headers: { ...apiHeaders, Referer: playerUrl, 'x-embed-parent': finalEmbedUrl },
    });

    // Step 3: POST challenge → get challenge_id + nonce
    const challengeResp = await fetch(`${playerOrigin}/api/videos/access/challenge`, {
        method: 'POST',
        headers: { ...apiHeaders, Referer: playerUrl },
    });
    const challenge = await challengeResp.json();
    if (!challenge.challenge_id || !challenge.nonce) { console.log(`[Filmoon] ${videoCode}: challenge failed`); return null; }

    // Step 4: Generate EC P-256 keypair, sign nonce, build attest body
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const signature = crypto.sign('sha256', Buffer.from(challenge.nonce, 'utf8'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    const jwk = publicKey.export({ format: 'jwk' });

    const viewerId = challenge.viewer_hint || crypto.randomBytes(16).toString('hex');
    const deviceId = crypto.randomBytes(16).toString('hex');

    const attestResp = await fetch(`${playerOrigin}/api/videos/access/attest`, {
        method: 'POST',
        headers: { ...apiHeaders, 'Content-Type': 'application/json', Referer: playerUrl },
        body: JSON.stringify({
            viewer_id: viewerId,
            device_id: deviceId,
            challenge_id: challenge.challenge_id,
            nonce: challenge.nonce,
            signature: signature.toString('base64url'),
            public_key: { crv: jwk.crv, ext: true, key_ops: ['verify'], kty: jwk.kty, x: jwk.x, y: jwk.y },
            client: {
                user_agent: HEADERS['User-Agent'],
                architecture: 'x86', bitness: '64', platform: 'Windows',
                platform_version: '15.0.0', model: '', ua_full_version: '131.0.0.0',
                brand_full_versions: [
                    { brand: 'Not_A Brand', version: '8.0.0.0' },
                    { brand: 'Chromium', version: '131.0.0.0' },
                    { brand: 'Google Chrome', version: '131.0.0.0' },
                ],
                pixel_ratio: 1, screen_width: 1920, screen_height: 1080, color_depth: 24,
                languages: ['en-US', 'en'], timezone: 'Europe/Paris',
                hardware_concurrency: 8, device_memory: 8, touch_points: 0,
                webgl_vendor: 'Google Inc. (NVIDIA)',
                webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)',
                canvas_hash: crypto.randomBytes(32).toString('base64url'),
                audio_hash: crypto.randomBytes(32).toString('base64url'),
                pointer_type: 'fine,hover',
                extra: { vendor: 'Google Inc.', appVersion: HEADERS['User-Agent'].replace('Mozilla/', '') },
            },
            storage: {
                cookie: viewerId, local_storage: viewerId,
                indexed_db: `${viewerId}:${deviceId}`, cache_storage: `${viewerId}:${deviceId}`,
            },
            attributes: { entropy: 'high' },
        }),
    });
    const attest = await attestResp.json();
    if (!attest.token) { console.log(`[Filmoon] ${videoCode}: attest failed`); return null; }
    console.log(`[Filmoon] ${videoCode}: attest OK (confidence=${attest.confidence})`);
    const playbackResp = await fetch(`${playerOrigin}/api/videos/${videoCode}/embed/playback`, {
        method: 'POST',
        headers: { ...apiHeaders, 'Content-Type': 'application/json', Referer: playerUrl, 'x-embed-parent': finalEmbedUrl },
        body: JSON.stringify({
            fingerprint: {
                token: attest.token, viewer_id: attest.viewer_id,
                device_id: attest.device_id, confidence: attest.confidence,
            },
        }),
    });
    const playbackData = await playbackResp.json().catch(() => null);
    if (!playbackData || !playbackData.playback) {
        const reason = playbackData && playbackData.error ? playbackData.error : 'playback failed';
        // 428 captcha_required: this backend now gates playback behind a captcha we
        // can't solve server-side. Nothing to retry — the stream is simply unavailable.
        console.log(`[Filmoon] ${videoCode}: ${reason} (HTTP ${playbackResp.status})`);
        return null;
    }

    // Step 6: Decrypt AES-256-GCM
    const pb = playbackData.playback;
    const key = Buffer.concat([b64urlToBuffer(pb.key_parts[0]), b64urlToBuffer(pb.key_parts[1])]);
    const iv = b64urlToBuffer(pb.iv);
    const payloadBuf = b64urlToBuffer(pb.payload);
    const authTag = payloadBuf.subarray(payloadBuf.length - 16);
    const encrypted = payloadBuf.subarray(0, payloadBuf.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const sources = JSON.parse(decrypted.toString('utf8'));

    // Pick the highest quality source
    if (sources.sources && sources.sources.length > 0) {
        const best = sources.sources.reduce((a, b) => (b.height || 0) > (a.height || 0) ? b : a);
        const url = best.url || best.file || best.src;
        if (url && url.startsWith('http')) {
            return { url, headers: { Referer: playerUrl } };
        }
    }

    return null;
}

function b64urlToBuffer(str) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Filmoon — POST /api/stream {filecode, device} → { streaming_url }
 *
 * The old 5-step flow (details → settings → challenge → ECDSA attest → playback
 * → AES-256-GCM decrypt) is gone: /api/videos/{code}/embed/details now 404s.
 * The token embeds the caller IP, so results must not be cached (see NO_CACHE).
 */
async function resolveFilmoon(embedUrl) {
    // Follow redirects (kakaflix.lol → <player>/e/XXXXX)
    let finalEmbedUrl = embedUrl;
    if (!embedUrl.match(/\/e\/[a-zA-Z0-9]+/)) {
        const redirectResp = await fetch(embedUrl, { headers: HEADERS, redirect: 'follow' });
        finalEmbedUrl = redirectResp.url;
        await redirectResp.text();
        console.log(`[Filmoon] redirect → ${finalEmbedUrl}`);
    }

    const codeMatch = finalEmbedUrl.match(/\/e\/([a-zA-Z0-9]+)/);
    if (!codeMatch) { console.log('[Filmoon] no video code in URL'); return null; }
    const filecode = codeMatch[1];
    const embedOrigin = new URL(finalEmbedUrl).origin;

    const resp = await fetch(`${embedOrigin}/api/stream`, {
        method: 'POST',
        headers: {
            ...HEADERS,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Referer: finalEmbedUrl,
        },
        body: JSON.stringify({ filecode, device: 'web' }),
    });

    let data = null;
    try {
        data = await resp.json();
    } catch (err) {
        // Older player domains (bysebuho.com & co) have no /api/stream at all.
        console.log(`[Filmoon] ${filecode}: /api/stream unavailable (${resp.status}), trying legacy flow`);
        return resolveFilmoonLegacy(finalEmbedUrl, filecode);
    }

    if (!data || !data.streaming_url) {
        console.log(`[Filmoon] ${filecode}: ${data && data.error ? data.error : 'no streaming_url'}`);
        return null;
    }

    return { url: data.streaming_url, headers: { Referer: `${embedOrigin}/` } };
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
    const hostname = hostOf(finalUrl) || hostOf(embedUrl);

    const unpacked = unpackDeanEdwards(html);

    // Main path: src is an obfuscated IIFE keyed on the embed hostname.
    for (const js of [html, unpacked]) {
        if (!js) continue;
        const decoded = decodeObfuscatedSource(js, hostname);
        if (decoded) return { url: decoded, headers: { Referer: finalUrl } };
    }

    // Try to extract source directly (older builds, no POST needed)
    let direct = extractSourceFromHtml(html);
    if (direct) return { url: direct, headers: { Referer: finalUrl } };

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
    const hostname = hostOf(finalUrl) || hostOf(embedUrl);

    const unpacked = unpackDeanEdwards(html);

    // Main path: src is an obfuscated IIFE keyed on the embed hostname.
    for (const js of [unpacked, html]) {
        if (!js) continue;
        const decoded = decodeObfuscatedSource(js, hostname);
        if (decoded) return { url: decoded, headers: {} };
    }

    // Fallback: older builds emitted a literal source.
    for (const js of [unpacked, html]) {
        if (!js) continue;
        const direct = extractSourceFromHtml(js);
        if (direct) return { url: direct, headers: {} };
    }

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
const NO_CACHE = new Set(['dood', 'filmoon']);

/**
 * Resolve an embed URL to a direct video URL.
 * @param {string} embedUrl - The embed/player URL
 * @param {string} playerKey - The player key (e.g. 'vidzy', 'voe')
 * @returns {Promise<{ url: string, headers: object } | null>}
 */
async function resolve(embedUrl, playerKey) {
    const resolver = RESOLVER_MAP[playerKey];
    if (!resolver) { console.log(`[Resolver] ${playerKey}: no resolver`); return null; }

    // Check cache (except for no-cache players)
    if (!NO_CACHE.has(playerKey)) {
        const cached = cache.get('resolved', embedUrl);
        if (cached) { console.log(`[Resolver] ${playerKey}: cache hit`); return cached; }
    }

    try {
        const start = Date.now();
        const result = await resolver(embedUrl);
        const ms = Date.now() - start;
        if (result) {
            console.log(`[Resolver] ${playerKey}: OK (${ms}ms) → ${result.url.substring(0, 70)}...`);
            if (!NO_CACHE.has(playerKey)) cache.set('resolved', embedUrl, result);
        } else {
            console.log(`[Resolver] ${playerKey}: failed (${ms}ms) — ${embedUrl}`);
        }
        return result;
    } catch (err) {
        console.error(`[Resolver] ${playerKey}: error — ${err.message}`);
        return null;
    }
}

module.exports = { resolve, decodeObfuscatedSource, extractSourceFromHtml };
