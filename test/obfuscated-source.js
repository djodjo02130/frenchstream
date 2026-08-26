/**
 * Test unitaire du décodage de la source obfusquée (hors réseau).
 *
 * FSvid/Vidzy ne publient plus `src:"<url>"` : src est une IIFE qui XOR-décode
 * un blob base64 avec une clé dérivée de location.hostname, et renvoie un leurre
 * ".../troll/master.m3u8" si l'hôte ne correspond pas.
 */

const assert = require('assert');
const { decodeObfuscatedSource, extractSourceFromHtml } = require('../lib/resolvers');

let passed = 0;
let failed = 0;

function check(label, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${label}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${label} — ${err.message}`);
    }
}

const DECOY = 'https://s1.fsvid.lol/troll/master.m3u8';

// Encodeur inverse de l'algo du player (mêmes constantes que le site).
function encode(url, hostname, seed = 0x3d, step = 89) {
    let H = 0;
    for (let j = 0; j < hostname.length; j++) H = (H + hostname.charCodeAt(j)) & 255;
    let a = '';
    for (let i = 0; i < url.length; i++) {
        const kk = (seed + i * step + H) & 255;
        a += String.fromCharCode(url.charCodeAt(i) ^ kk);
    }
    const b = a.split('').reverse().join('');
    return Buffer.from(b, 'binary').toString('base64');
}

function playerJs(blob, seed = 0x3d, step = 89) {
    return `var player=videojs('vjsplayer',{sources:[{src:(function(s){var h=(location&&location.hostname)||"",H=0;`
        + `for(var j=0;j<h.length;j++){H=(H+h.charCodeAt(j))&255}`
        + `var b=atob(s),a=b.split("").reverse().join(""),r="";`
        + `for(var i=0;i<a.length;i++){var kk=(${seed}+i*${step}+H)&255;r+=String.fromCharCode(a.charCodeAt(i)^kk)}`
        + `return/^https?:/.test(r)?r:"${DECOY}"})("${blob}"),type:"application/x-mpegURL"}]});`;
}

console.log('\nObfuscated source decoding\n==========================\n');

const TARGET = 'https://s1.fsvid.lol/hls2/01/00030/abc_n/master.m3u8?t=xyz&e=86400';

check('décode la vraie URL avec le bon hostname', () => {
    const js = playerJs(encode(TARGET, 'fsvid.lol'));
    assert.strictEqual(decodeObfuscatedSource(js, 'fsvid.lol'), TARGET);
});

check('constantes différentes (seed/step) : évaluation, pas de dur-codage', () => {
    const js = playerJs(encode(TARGET, 'vidzy.org', 0x11, 37), 0x11, 37);
    assert.strictEqual(decodeObfuscatedSource(js, 'vidzy.org'), TARGET);
});

check('mauvais hostname → leurre rejeté, retourne null', () => {
    const js = playerJs(encode(TARGET, 'fsvid.lol'));
    assert.strictEqual(decodeObfuscatedSource(js, 'wrong.host'), null);
});

check('pas d IIFE → null', () => {
    assert.strictEqual(decodeObfuscatedSource('var x = 1; file:"https://a/b.m3u8"', 'fsvid.lol'), null);
    assert.strictEqual(decodeObfuscatedSource('', 'fsvid.lol'), null);
});

check('IIFE qui boucle → timeout, pas de blocage', () => {
    const js = 'src:(function(s){while(true){}})("x")';
    assert.strictEqual(decodeObfuscatedSource(js, 'fsvid.lol'), null);
});

check('IIFE sans accès réseau ni process', () => {
    const js = `src:(function(s){return typeof process==="undefined"?"https://ok/x.m3u8":"https://leak/x.m3u8"})("x")`;
    assert.strictEqual(decodeObfuscatedSource(js, 'fsvid.lol'), 'https://ok/x.m3u8');
});

check('extractSourceFromHtml rejette le leurre littéral', () => {
    assert.strictEqual(extractSourceFromHtml(`file:"${DECOY}"`), null);
    assert.strictEqual(extractSourceFromHtml('file:"https://real.tld/a/master.m3u8"'), 'https://real.tld/a/master.m3u8');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
