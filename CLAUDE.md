# FrenchStream addon — notes Claude

## Procédure de bump version

Toute modification fonctionnelle = bump SemVer patch et propager dans **4 fichiers** :

1. `package.json` — `"version": "X.Y.Z"`
2. `index.js` — `version: 'X.Y.Z'` (manifest Stremio)
3. `config.yaml` — `version: "X.Y.Z"` (Home Assistant addon)
4. `CHANGELOG.md` — nouvelle entrée `## X.Y.Z` en tête, sous `# Changelog`

Les 4 doivent rester synchros. Oublier `config.yaml` = HA ne voit pas la nouvelle version.

### Commit

Un seul commit pour le bump + le fix :

```
<résumé fix>

Bump X.Y.Z
```

## API endpoints FS (à jour 2026-05)

- Films : `GET {baseUrl}/engine/ajax/film_api.php?id={newsId}` → `{players:{premium:{default,vostfr,vff,vfq},vidzy:{...},...}}`
- Séries : `GET {baseUrl}/engine/ajax/sx.php?p={newsId}` → `{vf:{epNum:{premium,vidzy,uqload,voe,netu}},vostfr:{...},vo:{...}}`

L'ancien endpoint séries `episodes_nop_api.php?id=` est mort (404). Si la JSON parsing casse avec `Unexpected token '<'`, vérifier que l'endpoint existe encore (curl + check `/js/serie-player*.js` du site pour le nom courant).

## Resolvers actifs

`premium`, `vidzy`, `uqload`, `voe`, `filmoon` — voir `lib/resolvers.js`. `netu` apparaît dans la réponse séries mais pas de resolver (skipped).

- `premium` / `vidzy` : `src` est une IIFE obfusquée (base64 + reverse + XOR, clé = `location.hostname`), leurre `/troll/master.m3u8` si l'hôte ne colle pas. Évaluée dans un sandbox `vm` (`decodeObfuscatedSource`) — ne pas ré-implémenter l'algo, les constantes changent.
- `uqload` : source dans le JS packé Dean Edwards.
- `filmoon` : deux backends. Récent (vidaraa.cc) = `POST /api/stream {filecode, device}` → `streaming_url`. Legacy (bysebuho/bysewihe) = flux 5 étapes ECDSA/AES, désormais `428 captcha_required` sur playback → mort en pratique.
- `dood` : `playmogo.com` derrière un challenge JS Cloudflare (403). Non résolvable sans navigateur, marqué optionnel dans le smoke test.

## Base URL

Chaîne : `fstream.info` → `<a id="mainUrl">` (le href vaut `#`, la vraie cible est dans `onclick="location.href='…'"`) → page passerelle qui expose `var FS_MIRROR="https://fsXX.lol"`. `resolveBaseUrl` suit jusqu'à 3 sauts et s'arrête quand la page ne contient plus de marqueur (= vrai site). Cache 1h dans `lib/utils.js`.

Si les catalogues sont vides ou que tout échoue avec `Only absolute URLs are supported`, vérifier d'abord le log `[FS] Base URL resolved:` — une valeur non-absolue veut dire que le format de la landing a encore changé.

## Tests

- `node test/base-url.js` — parsing du miroir (hors réseau)
- `node test/obfuscated-source.js` — décodage de la source obfusquée (hors réseau)
- `node test/smoke.js` — bout en bout (réseau, ~2 min)
