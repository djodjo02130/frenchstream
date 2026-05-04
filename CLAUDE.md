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

`premium`, `vidzy`, `uqload`, `dood`, `voe`, `filmoon` — voir `lib/resolvers.js`. `netu` apparaît dans la réponse séries mais pas de resolver (skipped).

## Base URL

`fstream.info` → `<a id="mainUrl">` donne le miroir actuel (cache 1h dans `lib/utils.js`).
