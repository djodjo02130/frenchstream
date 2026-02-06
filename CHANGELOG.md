# Changelog

## 1.10.3

- Fix build Docker multi-arch (platforms au pluriel + default ARG)
- Fix fetch is not a function en CI (require node-fetch top level)
- Fix dependabot.yml (ecosystem npm + ignore vulns SDK Stremio)
- Fix CVE path-to-regexp (override 0.1.7 → 0.1.12)
- CodeQL Action v3 → v4
- Mise à jour README

## 1.10.2

- Smoke test : recherche film/série, scrape streams, résolution par player
- Workflow CI quotidien + sur chaque push/PR
- Lancement manuel possible (workflow_dispatch)

## 1.10.1

- Sécurité : ajout workflow CodeQL (analyse code hebdomadaire)
- Ajout SECURITY.md (politique de sécurité)
- Ajout LICENSE (MIT)
- Activation Dependabot vulnerability alerts

## 1.10.0

- CI/CD : GitHub Actions build & push vers GHCR sur chaque push main
- Images pré-buildées par architecture (amd64, aarch64, armv7)
- config.yaml : champ `image` pour installation HA sans build local

## 1.9.1

- Fix permissions scripts s6-overlay (chmod +x run/finish)

## 1.9.0

- Restructuration projet au standard Home Assistant addon
- Dockerfile refait : s6-overlay (rootfs/etc/services.d/) au lieu de CMD
- Ajout traductions options HA (en.yaml, fr.yaml)
- Ajout DOCS.md (onglet documentation dans HA)
- Synchronisation version manifest Stremio

## 1.8.1

- Affichage streams simplifié : nom du player en titre, langue + titre FS en description (ex: "Vidzy" / "VF - Reconnu Coupable")

## 1.8.0

- Migration du scraper vers les APIs JSON de FrenchStream (film_api.php, episodes_nop_api.php)
- Les données players ne sont plus dans les attributs HTML data-* mais chargées via les APIs JSON internes
- Films : GET /engine/ajax/film_api.php?id={newsId} → players par langue (VF, VOSTFR, VFQ, VFF)
- Séries : GET /engine/ajax/episodes_nop_api.php?id={newsId} → épisodes par langue (VF, VOSTFR, VO)

## 1.7.0

- Métadonnées TMDB en français (ou langue choisie) dans le meta handler : titre, synopsis, genres, casting, bande-annonce
- Fonctionne pour les IDs IMDB (`tt`) via `/find` et les IDs FS (`fs:`) via `data-tagz`
- Langue configurable dans Stremio (14 langues : fr-FR, en-US, es-ES, de-DE, etc.) — défaut : fr-FR
- Fallback inchangé sans clé TMDB (Cinemeta pour `tt`, scrape FS pour `fs:`)

## 1.6.0

- Ajout du meta handler TMDB : métadonnées complètes en français via l'API TMDB pour les IDs IMDB et FS
- Poster HD (w500), background (w1280), genres, réalisateur, casting (top 10), bandes-annonces YouTube
- Cache métadonnées TMDB (TTL 2h)
- Fallback sur scrape FS ou Cinemeta si TMDB échoue ou pas de clé

## 1.5.2

- Résolution titre via TMDB API (`/find/{imdb_id}`) pour le stream handler — plus besoin de Cinemeta si clé TMDB configurée
- Fallback automatique sur Cinemeta si TMDB indisponible

## 1.5.1

- Ajout logs détaillés résolution IMDB : méthode utilisée (TMDB/Cinemeta), erreurs API, scrape data-tagz

## 1.5.0

- Résolution IMDB via TMDB : extraction de `data-tagz` (ID TMDB) des pages FS → API TMDB → IMDB ID
- Clé API TMDB configurable dans Home Assistant (`tmdb_api_key`) ou via variable d'env `TMDB_API_KEY`
- Fallback automatique sur Cinemeta si pas de clé TMDB ou si la résolution échoue
- Cache TMDB IDs (24h)

## 1.4.0

- Résolution IMDB IDs dans le catalogue via Cinemeta search — Cinemeta fournit automatiquement les métadonnées
- Fallback `fs:` si Cinemeta ne trouve pas le titre
- Logs catalogue et résolution IMDB

## 1.3.2

- Ajout cache sur `findFsPageUrl` (TTL 2h) — évite les requêtes HTTP redondantes entre meta et stream

## 1.3.1

- Log des recherches catalogue (query + nombre de résultats)

## 1.3.0

- Ajout du meta handler : titre, poster, synopsis, année, genres, réalisateur, acteurs pour les films/séries du catalogue FS
- Cache métadonnées (TTL 2h, max 200 entrées)
- Refactoring `findFsPageUrl` partagé entre meta et stream handlers

## 1.2.3

- Ajout timeout 5s sur tous les fetch des resolvers (évite les blocages sur serveurs lents)

## 1.2.2

- Ajout de logs détaillés : stream handler, resolvers (timing, cache hit), étapes Filmoon

## 1.2.1

- Fix Filmoon : suivre les redirections kakaflix.lol → bysebuho.com avant résolution
- Suppression du fallback `(web)` : les streams non résolus sont ignorés (liens morts, etc.)
- Log des streams skippés pour debug

## 1.2.0

- Ajout du resolver Filmoon : résolution via API (challenge/attest ECDSA P-256 + déchiffrement AES-256-GCM)
- 6/6 resolvers fonctionnels : Premium, Vidzy, Uqload, Voe, Dood, Filmoon — plus de fallback navigateur
- Suppression de Netu (non supporté, inutile)

## 1.1.1

- Fix Uqload : ajout du header Referer (requis pour servir video/mp4, sinon erreur `error_wrong_ip`)

## 1.1.0

- Ajout du module `lib/resolvers.js` : résolution des URLs embed en liens vidéo directs
- Resolvers implémentés : Premium/FSvid (.m3u8), Vidzy (.m3u8), Uqload (.mp4), Voe (.m3u8), Dood (.mp4)
- Fallback `externalUrl` (ouverture navigateur) pour Filmoon et Netu
- `formatStreams()` désormais async avec résolution parallèle (`Promise.allSettled`)
- Support `behaviorHints` : `notWebReady` pour HLS, `proxyHeaders` pour les Referer requis
- Ajout du cache `resolved` (TTL 30min, max 300 entrées) — Dood exclu (URLs temporaires)
- Champ `player` ajouté aux objets stream du scraper

## 1.0.2

- Fix: ajout de `init: false` dans config.yaml (corrige l'erreur s6-overlay PID 1)
- Fix: suppression des services s6 v2 obsolètes (`/etc/services.d/`)
- Ajout de `build.yaml` avec images de base HA officielles par architecture
- Simplification du Dockerfile (install Node.js via apk directement)

## 1.0.1

- Fix: ajout du support s6-overlay pour Home Assistant (service dans `/etc/services.d/`)
- Fix: installation automatique de Node.js si absent de l'image de base
- Fix: remplacement de `--only=production` par `--omit=dev` (npm moderne)
- Fix: correction de l'URL du dépôt GitHub dans le badge HA

## 1.0.0

- Version initiale
- Catalogue films et séries avec pagination
- Recherche par titre
- Extraction des streams multi-players (Vidzy, Uqload, Voe, Dood, Filmoon, Netu, FSvid)
- Support multi-langues (VF, VOSTFR, VFF, VFQ)
- Résolution IMDB via Cinemeta
- URL dynamique FrenchStream via fstream.info
- Support Docker standalone et Home Assistant addon
