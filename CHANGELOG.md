# Changelog

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
