/**
 * Test unitaire du parsing de l'URL miroir (hors réseau).
 *
 * fstream.info ne donne plus l'URL dans le href : il sert
 * <a id="mainUrl" href="#" onclick="location.href='...'"> qui pointe vers une
 * page passerelle, laquelle expose le vrai miroir dans var FS_MIRROR="...".
 */

const assert = require('assert');
const { parseMirrorFromHtml } = require('../lib/utils');

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

console.log('\nBase URL parsing\n================\n');

check('fstream.info : onclick prioritaire sur href="#"', () => {
    const html = `<a href="#" class="url-display" id="mainUrl" onclick="location.href='https://fstream.website';return false;">`;
    assert.strictEqual(parseMirrorFromHtml(html), 'https://fstream.website');
});

check('passerelle : var FS_MIRROR', () => {
    const html = `<script>var FS_MIRROR="https://fs16.lol";\nfunction goMirror(){location.href=FS_MIRROR}</script>`;
    assert.strictEqual(parseMirrorFromHtml(html), 'https://fs16.lol');
});

check('ancien format : href absolu dans #mainUrl', () => {
    const html = `<a id="mainUrl" href="https://fs9.lol/">fs9</a>`;
    assert.strictEqual(parseMirrorFromHtml(html), 'https://fs9.lol');
});

check('id avant href, ordre inverse', () => {
    const html = `<a class="x" id="mainUrl" onclick="location.href='https://fs16.lol'" href="#">go</a>`;
    assert.strictEqual(parseMirrorFromHtml(html), 'https://fs16.lol');
});

check('href="#" seul → null (jamais de base URL invalide)', () => {
    const html = `<a id="mainUrl" href="#">indisponible</a>`;
    assert.strictEqual(parseMirrorFromHtml(html), null);
});

check('page du vrai site (aucun marqueur) → null', () => {
    const html = `<div id="dle-content"><div class="short"><a href="/index.php?newsid=15135572">x</a></div></div>`;
    assert.strictEqual(parseMirrorFromHtml(html), null);
});

check('trailing slash retiré', () => {
    const html = `<a id="mainUrl" href="https://fs16.lol//">x</a>`;
    assert.strictEqual(parseMirrorFromHtml(html), 'https://fs16.lol');
});

check('html vide → null', () => {
    assert.strictEqual(parseMirrorFromHtml(''), null);
    assert.strictEqual(parseMirrorFromHtml(null), null);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
